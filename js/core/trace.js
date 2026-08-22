/* Angles Maker — recover a figure's geometry from its own pixels, no model.
   A Hough transform finds the straight strokes, which is what these diagrams
   are almost entirely made of. What it cannot do is read "82°" off the page —
   so it does not try. The numbers are typed by the person who is already
   looking at the original crop, which is both instant and correct, and which
   the model demonstrably got wrong. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});

  const DEFAULTS = {
    inkBelow: 140,          // the crop arrives cleaned: paper white, ink black
    thetaSteps: 360,        // half a degree
    minLengthFrac: 0.22,    // of the crop's diagonal
    gapTolerance: 8,        // px of white a stroke may jump (a crossing line, a label)
    perpTolerance: 2.2,     // px either side of the ideal line that still counts as on it
    mergeAngle: 4 * Math.PI / 180,
    mergeDistance: 7,
    parallelTolerance: 3.5 * Math.PI / 180,
    joinRadius: 9,          // points closer than this are the same point
    maxLines: 14,
    arcSearch: 2.2          // x the arc radius, how far from a vertex to look for an arc mark
  };

  function inkPoints(gray, w, h, o) {
    const pts = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (gray[y * w + x] < o.inkBelow) pts.push(x, y);
    }
    return pts;
  }

  /* Straight strokes stand out in Hough space; letters and arcs do not. */
  function hough(pts, w, h, o) {
    const T = o.thetaSteps;
    const diag = Math.ceil(Math.hypot(w, h));
    const R = diag * 2 + 1;
    const acc = new Int32Array(T * R);
    const cos = new Float64Array(T), sin = new Float64Array(T);
    for (let t = 0; t < T; t++) {
      const a = Math.PI * t / T;
      cos[t] = Math.cos(a); sin[t] = Math.sin(a);
    }
    const stride = Math.max(1, Math.ceil(pts.length / 2 / 24000));
    for (let i = 0; i < pts.length; i += 2 * stride) {
      const x = pts[i], y = pts[i + 1];
      for (let t = 0; t < T; t++) {
        const r = Math.round(x * cos[t] + y * sin[t]) + diag;
        acc[t * R + r]++;
      }
    }
    return { acc, T, R, diag, cos, sin, stride };
  }

  function peaks(H, o, minVotes) {
    const { acc, T, R } = H;
    const found = [];
    for (let t = 0; t < T; t++) {
      for (let r = 1; r < R - 1; r++) {
        const v = acc[t * R + r];
        if (v < minVotes) continue;
        let best = true;
        for (let dt = -2; dt <= 2 && best; dt++) {
          const tt = (t + dt + T) % T;
          for (let dr = -4; dr <= 4; dr++) {
            if (!dt && !dr) continue;
            const rr = r + dr;
            if (rr < 0 || rr >= R) continue;
            if (acc[tt * R + rr] > v) { best = false; break; }
          }
        }
        if (best) found.push({ t, r, votes: v });
      }
    }
    found.sort((a, b) => b.votes - a.votes);
    return found.slice(0, o.maxLines * 3);
  }

  /* A peak gives an infinite line; the drawing contains a piece of it. Walk the
     line and keep the stretches that actually have ink under them. */
  function segmentsOnLine(gray, w, h, theta, rho, o, minLen) {
    const dx = -Math.sin(theta), dy = Math.cos(theta);
    const px = Math.cos(theta) * rho, py = Math.sin(theta) * rho;
    const reach = Math.ceil(Math.hypot(w, h));
    const hasInk = (x, y) => {
      for (let k = -o.perpTolerance; k <= o.perpTolerance; k += 1) {
        const sx = Math.round(x + Math.cos(theta) * k), sy = Math.round(y + Math.sin(theta) * k);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        if (gray[sy * w + sx] < o.inkBelow) return true;
      }
      return false;
    };
    const out = [];
    let runStart = null, gap = 0, lastInk = null;
    for (let s = -reach; s <= reach; s++) {
      const x = px + dx * s, y = py + dy * s;
      const inside = x >= -1 && y >= -1 && x <= w && y <= h;
      const ink = inside && hasInk(x, y);
      if (ink) {
        if (runStart === null) runStart = s;
        lastInk = s;
        gap = 0;
      } else if (runStart !== null) {
        gap++;
        if (gap > o.gapTolerance) {
          if (lastInk - runStart >= minLen) {
            out.push({ x1: px + dx * runStart, y1: py + dy * runStart,
                       x2: px + dx * lastInk, y2: py + dy * lastInk,
                       theta, rho, length: lastInk - runStart });
          }
          runStart = null; gap = 0;
        }
      }
    }
    if (runStart !== null && lastInk - runStart >= minLen) {
      out.push({ x1: px + dx * runStart, y1: py + dy * runStart,
                 x2: px + dx * lastInk, y2: py + dy * lastInk,
                 theta, rho, length: lastInk - runStart });
    }
    return out;
  }

  const angleDiff = (a, b) => {
    let d = Math.abs(a - b) % Math.PI;
    return Math.min(d, Math.PI - d);
  };

  function mergeSegments(segs, o) {
    const kept = [];
    for (const s of segs.slice().sort((a, b) => b.length - a.length)) {
      let dup = false;
      for (const k of kept) {
        if (angleDiff(s.theta, k.theta) > o.mergeAngle) continue;
        /* distance from this segment's midpoint to the other's infinite line */
        const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
        const d = Math.abs(mx * Math.cos(k.theta) + my * Math.sin(k.theta) - k.rho);
        if (d < o.mergeDistance) { dup = true; break; }
      }
      if (!dup) kept.push(s);
      if (kept.length >= o.maxLines) break;
    }
    return kept;
  }

  function intersect(a, b) {
    const d = Math.cos(a.theta) * Math.sin(b.theta) - Math.sin(a.theta) * Math.cos(b.theta);
    if (Math.abs(d) < 1e-9) return null;
    return {
      x: (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / d,
      y: (b.rho * Math.cos(a.theta) - a.rho * Math.cos(b.theta)) / d
    };
  }

  const onSegment = (s, p, slack) => {
    const t = ((p.x - s.x1) * (s.x2 - s.x1) + (p.y - s.y1) * (s.y2 - s.y1)) /
              ((s.x2 - s.x1) ** 2 + (s.y2 - s.y1) ** 2 || 1);
    return t >= -slack && t <= 1 + slack;
  };

  function traceFigure(gray, w, h, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const G = AM.geometry;
    const diag = Math.hypot(w, h);
    const minLen = o.minLengthFrac * diag;

    const pts = inkPoints(gray, w, h, o);
    if (pts.length < 40) return null;
    const H = hough(pts, w, h, o);
    const minVotes = Math.max(12, Math.round(minLen / H.stride * 0.55));
    const raw = [];
    for (const pk of peaks(H, o, minVotes)) {
      const theta = Math.PI * pk.t / H.T;
      const rho = pk.r - H.diag;
      raw.push.apply(raw, segmentsOnLine(gray, w, h, theta, rho, o, minLen));
    }
    const segs = mergeSegments(raw, o);
    if (!segs.length) return null;

    /* Points: every crossing, plus the ends of each stroke. Anything closer
       together than joinRadius is one point, not two. */
    const points = [];
    const addPoint = p => {
      for (const q of points) {
        if (Math.hypot(q.x - p.x, q.y - p.y) < o.joinRadius) return q;
      }
      const q = { x: p.x, y: p.y, id: null };
      points.push(q);
      return q;
    };
    const crossings = [];
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if (angleDiff(segs[i].theta, segs[j].theta) < o.parallelTolerance) continue;
        const p = intersect(segs[i], segs[j]);
        if (!p || p.x < -8 || p.y < -8 || p.x > w + 8 || p.y > h + 8) continue;
        if (!onSegment(segs[i], p, 0.12) || !onSegment(segs[j], p, 0.12)) continue;
        crossings.push({ point: addPoint(p), a: i, b: j });
      }
    }
    for (const s of segs) { addPoint({ x: s.x1, y: s.y1 }); addPoint({ x: s.x2, y: s.y2 }); }

    /* Reading order gives the letters, so they run the way a reader expects. */
    points.sort((p, q) => (p.y - q.y) || (p.x - q.x));
    const NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    points.forEach((p, i) => { p.id = i < NAMES.length ? NAMES[i] : 'p' + (i + 1); });

    const fig = G.create();
    const scale = 10 / Math.max(w, h);
    for (const p of points) fig.points[p.id] = { x: p.x * scale, y: p.y * scale, label: p.id };

    const nearest = (x, y) => {
      let best = null, bd = Infinity;
      for (const p of points) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    };
    segs.forEach((s, i) => {
      const a = nearest(s.x1, s.y1), b = nearest(s.x2, s.y2);
      if (!a || !b || a === b) return;
      fig.lines.push({ id: 'l' + i, a: a.id, b: b.id, kind: 'segment', ticks: 0 });
    });

    /* Strokes at the same angle are a parallel family — the thing the whole
       chapter is about, and the one relationship worth asserting. */
    const groups = [];
    for (const line of fig.lines) {
      const s = segs[+line.id.slice(1)];
      let placed = false;
      for (const g of groups) {
        if (angleDiff(g.theta, s.theta) < o.parallelTolerance) { g.ids.push(line.id); placed = true; break; }
      }
      if (!placed) groups.push({ theta: s.theta, ids: [line.id] });
    }
    for (const g of groups) {
      if (g.ids.length < 2) continue;
      for (let i = 1; i < g.ids.length; i++) {
        fig.constraints.push({ type: 'parallel', lines: [g.ids[0], g.ids[i]] });
      }
      for (const id of g.ids) {
        const line = G.lineById(fig, id);
        if (line) line.ticks = groups.indexOf(g) + 1;
      }
    }

    /* An angle at every crossing, with no value: the drawing is recovered, the
       numbers are for the person reading the original to supply. */
    const seen = new Set();
    for (const c of crossings) {
      const la = 'l' + c.a, lb = 'l' + c.b;
      const A = G.lineById(fig, la), B = G.lineById(fig, lb);
      if (!A || !B) continue;
      const key = c.point.id + '|' + la + '|' + lb;
      if (seen.has(key)) continue;
      seen.add(key);
      const from = A.a === c.point.id ? A.b : A.a;
      const to = B.a === c.point.id ? B.b : B.a;
      if (from === c.point.id || to === c.point.id) continue;
      fig.angles.push({ vertex: c.point.id, from, to, label: '' });
    }

    G.captureSigns(fig);
    fig.notes = '';
    fig.conflicts = [];
    fig.traced = true;
    return fig;
  }

  AM.trace = { traceFigure, DEFAULTS, angleDiff, intersect };
})(typeof globalThis !== 'undefined' ? globalThis : this);
