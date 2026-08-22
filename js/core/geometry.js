/* Angles Maker — the figure model and its constraint solver.
   Points are the only degrees of freedom. Everything a user can change — an
   angle's value, which lines are parallel — is a constraint, and the solver
   moves points until the constraints hold. Seeded from where the figure
   already is, so of all the configurations that satisfy the constraints it
   settles on the one nearest the original. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});
  const TAU = Math.PI * 2;

  const norm = a => { while (a <= -Math.PI) a += TAU; while (a > Math.PI) a -= TAU; return a; };
  const dir = (p, q) => Math.atan2(q.y - p.y, q.x - p.x);

  /* Signed turn from ray v->f to ray v->t, in (-pi, pi]. Signed rather than
     absolute so a figure cannot quietly flip over while being solved. */
  function signedAngle(v, f, t) {
    return norm(dir(v, t) - dir(v, f));
  }

  function create() {
    return { points: {}, lines: [], constraints: [], angles: [], labels: [] };
  }

  function clone(fig) { return JSON.parse(JSON.stringify(fig)); }

  function pointList(fig) {
    return Object.keys(fig.points).filter(id => !fig.points[id].fixed);
  }

  function lineById(fig, id) {
    for (const l of fig.lines) if (l.id === id) return l;
    return null;
  }

  /* Each constraint contributes one residual, in units comparable to each other:
     angles in radians, positions relative to the figure's own scale. */
  function residual(fig, c) {
    const P = fig.points;
    switch (c.type) {
      case 'angle': {
        const v = P[c.vertex], f = P[c.from], t = P[c.to];
        if (!v || !f || !t) return 0;
        const have = signedAngle(v, f, t);
        const want = (c.sign || (have < 0 ? -1 : 1)) * c.value * Math.PI / 180;
        return norm(have - want);
      }
      case 'parallel': {
        const a = lineById(fig, c.lines[0]), b = lineById(fig, c.lines[1]);
        if (!a || !b) return 0;
        const da = dir(P[a.a], P[a.b]), db = dir(P[b.a], P[b.b]);
        /* sin of the difference: zero when parallel OR antiparallel, which is
           what "parallel lines" means here — direction of travel is arbitrary. */
        return Math.sin(norm(db - da));
      }
      case 'onLine': {
        const p = P[c.point], l = lineById(fig, c.line);
        if (!p || !l) return 0;
        const a = P[l.a], b = P[l.b];
        const ux = b.x - a.x, uy = b.y - a.y;
        const len = Math.hypot(ux, uy) || 1e-9;
        return ((p.x - a.x) * uy - (p.y - a.y) * ux) / len;
      }
      case 'length': {
        const a = P[c.from], b = P[c.to];
        return Math.hypot(b.x - a.x, b.y - a.y) - c.value;
      }
      case 'equalLength': {
        const a = P[c.from], b = P[c.to], c2 = P[c.from2], d = P[c.to2];
        return Math.hypot(b.x - a.x, b.y - a.y) - Math.hypot(d.x - c2.x, d.y - c2.y);
      }
      default:
        return 0;
    }
  }

  function residuals(fig, anchors, weight, diag) {
    const out = fig.constraints.filter(c => c.enabled !== false).map(c => residual(fig, c));
    /* A weak pull back towards where each point started. Constraints alone
       rarely pin a figure down completely — satisfy "this angle is 55°" and a
       free point is at liberty to fly across the page on its way there. This
       keeps the drawing recognisably the one the user was looking at. */
    if (anchors && weight) {
      for (const id in anchors) {
        const p = fig.points[id];
        if (!p) continue;
        out.push(weight * (p.x - anchors[id].x) / diag);
        out.push(weight * (p.y - anchors[id].y) / diag);
      }
    }
    return out;
  }

  function getVars(fig, ids) {
    const v = new Float64Array(ids.length * 2);
    ids.forEach((id, i) => { v[i * 2] = fig.points[id].x; v[i * 2 + 1] = fig.points[id].y; });
    return v;
  }
  function setVars(fig, ids, v) {
    ids.forEach((id, i) => { fig.points[id].x = v[i * 2]; fig.points[id].y = v[i * 2 + 1]; });
  }

  /* Dense Gaussian elimination with partial pivoting. n is small — twice the
     number of movable points — so nothing cleverer is warranted. */
  function solveLinear(A, b, n) {
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-12) continue;
      const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        if (!f) continue;
        for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
      }
    }
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.abs(M[i][i]) < 1e-12 ? 0 : M[i][n] / M[i][i];
    return x;
  }

  function cost(fig, anchors, weight, diag) {
    let s = 0;
    for (const r of residuals(fig, anchors, weight, diag)) s += r * r;
    return s;
  }

  /* Two passes. The first carries the anchor pull, so the figure keeps its
     shape while it moves; the second drops the anchors and, starting from that
     result, drives the real constraints to zero. Nearest-looking and exact,
     rather than a compromise between the two. */
  function solve(figure, options) {
    const o = options || {};
    const w = o.anchorWeight === undefined ? 0.35 : o.anchorWeight;
    if (w > 0) {
      const anchors = {};
      for (const id in figure.points) anchors[id] = { x: figure.points[id].x, y: figure.points[id].y };
      const b = bounds(figure);
      const diag = Math.hypot(b.w, b.h) || 1;
      run(figure, o, anchors, w, diag);
    }
    return run(figure, o, null, 0, 1);
  }

  function run(figure, options, anchors, weight, diag) {
    const o = Object.assign({ iterations: 60, tolerance: 1e-9, step: 1e-6 }, options || {});
    const fig = figure;
    const ids = pointList(fig);
    const active = fig.constraints.filter(c => c.enabled !== false);
    if (!ids.length || !active.length) return { ok: true, iterations: 0, cost: cost(fig) };

    const n = ids.length * 2;
    let lambda = 1e-3;
    let best = cost(fig, anchors, weight, diag);
    let iterations = 0;

    for (let it = 0; it < o.iterations; it++) {
      iterations++;
      if (best < o.tolerance) break;
      const x0 = getVars(fig, ids);
      const r0 = residuals(fig, anchors, weight, diag);
      const m = r0.length;

      /* Numeric Jacobian: m residuals by n variables. */
      const J = [];
      for (let i = 0; i < m; i++) J.push(new Float64Array(n));
      for (let j = 0; j < n; j++) {
        const x = Float64Array.from(x0);
        x[j] += o.step;
        setVars(fig, ids, x);
        const r1 = residuals(fig, anchors, weight, diag);
        for (let i = 0; i < m; i++) J[i][j] = (r1[i] - r0[i]) / o.step;
      }
      setVars(fig, ids, x0);

      /* Normal equations (J'J + lambda I) dx = -J'r */
      const A = [];
      for (let i = 0; i < n; i++) A.push(new Array(n).fill(0));
      const g = new Float64Array(n);
      for (let k = 0; k < m; k++) {
        const row = J[k];
        for (let i = 0; i < n; i++) {
          g[i] += row[i] * r0[k];
          for (let j = 0; j < n; j++) A[i][j] += row[i] * row[j];
        }
      }

      let improved = false;
      for (let attempt = 0; attempt < 8 && !improved; attempt++) {
        const Ad = A.map((row, i) => {
          const copy = row.slice();
          copy[i] += lambda * (1 + Math.abs(row[i]));
          return copy;
        });
        const dx = solveLinear(Ad, Array.from(g, v => -v), n);
        const x = Float64Array.from(x0);
        for (let i = 0; i < n; i++) x[i] += dx[i];
        setVars(fig, ids, x);
        const c = cost(fig, anchors, weight, diag);
        if (c < best) { best = c; lambda = Math.max(1e-9, lambda * 0.4); improved = true; }
        else { setVars(fig, ids, x0); lambda *= 4; }
      }
      if (!improved) break;
    }
    const finalCost = cost(fig, null, 0, 1);
    return { ok: finalCost < 1e-6, iterations, cost: finalCost, residual: Math.sqrt(finalCost) };
  }

  /* What the figure currently measures, whatever the labels claim. The editor
     shows this next to the label so a drawing that disagrees with its own
     caption cannot go unnoticed. */
  function measure(fig, a) {
    const v = fig.points[a.vertex], f = fig.points[a.from], t = fig.points[a.to];
    if (!v || !f || !t) return null;
    return Math.abs(signedAngle(v, f, t)) * 180 / Math.PI;
  }

  /* Record the orientation of every angle constraint as it stands now, so the
     solver preserves which side of the line the angle is on. */
  function captureSigns(fig) {
    for (const c of fig.constraints) {
      if (c.type !== 'angle' || c.sign) continue;
      const v = fig.points[c.vertex], f = fig.points[c.from], t = fig.points[c.to];
      if (v && f && t) c.sign = signedAngle(v, f, t) < 0 ? -1 : 1;
    }
    return fig;
  }

  function bounds(fig) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id in fig.points) {
      const p = fig.points[id];
      if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
    }
    if (!isFinite(x0)) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: x0, y: y0, w: Math.max(1e-6, x1 - x0), h: Math.max(1e-6, y1 - y0) };
  }

  AM.geometry = { create, clone, solve, measure, residual, residuals, cost,
                  signedAngle, captureSigns, bounds, lineById, solveLinear };
})(typeof globalThis !== 'undefined' ? globalThis : this);
