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
    minLengthFrac: 0.20,    // of the crop's diagonal
    gapFrac: 0.020,         // of the diagonal: white a stroke may jump (a crossing line, a label)
    perpFrac: 0.004,        // of the diagonal: how far off the ideal line still counts as on it
    mergeAngle: 7 * Math.PI / 180,
    mergeDistanceFrac: 0.022,  // a printed stroke wobbles into several Hough peaks
    collinearGap: 0.10,     // of the diagonal: two stretches of one stroke, rejoined
    parallelTolerance: 4 * Math.PI / 180,
    joinRadius: 0.045,      // of the diagonal — points closer than this are one point
    minAngleDeg: 12,        // below this two strokes are the same direction, not an angle
    maxLines: 14,
    lineClear: 3.2,         // px: ink further than this from every stroke is "something else"
    arcMinRadiusFrac: 0.04, // of the crop diagonal
    arcMaxRadiusFrac: 0.30,
    arcMaxRadialSpread: 0.34,  // an arc keeps a near-constant distance from its vertex
    arcMinSweepDeg: 16,
    /* Heads were being missed on every real page: the thresholds were pixel
       counts taken from 300px test drawings, and a scanned figure is twice
       that across with heads four times the area. Everything scales now. */
    arrowRadiusFrac: 0.045,   // of the diagonal, from the stroke's end
    arrowMinAreaFrac: 0.00004,
    arrowMinTotalAreaFrac: 0.00018,
    arrowMaxAreaFrac: 0.006,
    arrowMinFill: 0.30        // a head is a solid wedge; an arc or a chevron is a thin curve
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

  /* One wobbly stroke can survive as two collinear pieces with a gap between
     them. Rejoin those, or the figure gains lines it never had and an "angle"
     of 175 degrees between two halves of the same line. */
  function joinCollinear(segs, o, diag) {
    const out = segs.slice();
    let merged = true;
    while (merged) {
      merged = false;
      outer:
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const a = out[i], b = out[j];
          if (angleDiff(a.theta, b.theta) > o.mergeAngle) continue;
          const mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2;
          if (Math.abs(mx * Math.cos(a.theta) + my * Math.sin(a.theta) - a.rho) > o.mergeDistance) continue;
          const ends = [[a.x1, a.y1], [a.x2, a.y2]], other = [[b.x1, b.y1], [b.x2, b.y2]];
          let gap = Infinity;
          for (const e of ends) for (const f of other) gap = Math.min(gap, Math.hypot(e[0] - f[0], e[1] - f[1]));
          if (gap > o.collinearGap * diag) continue;
          const all = ends.concat(other);
          let best = null, bestD = -1;
          for (let p = 0; p < all.length; p++) for (let q = p + 1; q < all.length; q++) {
            const d = Math.hypot(all[p][0] - all[q][0], all[p][1] - all[q][1]);
            if (d > bestD) { bestD = d; best = [all[p], all[q]]; }
          }
          out.splice(j, 1);
          out[i] = { x1: best[0][0], y1: best[0][1], x2: best[1][0], y2: best[1][1],
                     theta: a.theta, rho: a.rho, length: bestD };
          merged = true;
          break outer;
        }
      }
    }
    return out;
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

  /* Everything that is not one of the straight strokes: the angle arcs, the
     arrowheads, the printed labels. Thrown away until now, and it is exactly
     what says WHICH angle the page marks and which strokes carry arrows. */
  function residual(gray, w, h, segs, o) {
    const mask = new Uint8Array(w * h);
    const dist2ToSeg = (x, y, s) => {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((x - s.x1) * dx + (y - s.y1) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.x1 + t * dx - x, py = s.y1 + t * dy - y;
      return px * px + py * py;
    };
    const clear2 = o.lineClear * o.lineClear;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (gray[y * w + x] >= o.inkBelow) continue;
        let near = false;
        for (let i = 0; i < segs.length && !near; i++) if (dist2ToSeg(x, y, segs[i]) <= clear2) near = true;
        if (!near) mask[y * w + x] = 1;
      }
    }
    const cc = AM.image.connectedComponents(mask, w, h, null);
    const parts = [];
    for (const c of cc.comps) {
      if (c.area < 8) continue;
      parts.push(c);
    }
    /* pixel lists, so an arc can be measured rather than guessed at */
    const byId = new Map(parts.map(c => [c.id, { comp: c, xs: [], ys: [] }]));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = cc.labels[y * w + x];
        if (id < 0) continue;
        const rec = byId.get(id);
        if (rec) { rec.xs.push(x); rec.ys.push(y); }
      }
    }
    return Array.from(byId.values());
  }

  /* An arc holds a near-constant distance from its vertex and sweeps an angle.
     A printed label does neither, which is what separates them. */
  function arcAt(part, vx, vy, o, diag) {
    const { xs, ys } = part;
    const n = xs.length;
    if (n < 8) return null;
    let sum = 0, sum2 = 0, minA = Infinity, maxA = -Infinity;
    const angles = [];
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - vx, dy = ys[i] - vy;
      const r = Math.hypot(dx, dy);
      sum += r; sum2 += r * r;
      angles.push(Math.atan2(dy, dx));
    }
    const mean = sum / n;
    if (mean < o.arcMinRadiusFrac * diag || mean > o.arcMaxRadiusFrac * diag) return null;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    if (sd / mean > o.arcMaxRadialSpread) return null;
    /* sweep, measured about the circular mean so it does not break at pi */
    let sx = 0, sy = 0;
    for (const a of angles) { sx += Math.cos(a); sy += Math.sin(a); }
    const mid = Math.atan2(sy, sx);
    for (const a of angles) {
      let d = a - mid;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (d < minA) minA = d;
      if (d > maxA) maxA = d;
    }
    const sweep = (maxA - minA) * 180 / Math.PI;
    if (sweep < o.arcMinSweepDeg) return null;
    return { radius: mean, bisector: mid, sweep };
  }

  function traceFigure(gray, w, h, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const G = AM.geometry;
    const diag = Math.hypot(w, h);
    const minLen = o.minLengthFrac * diag;
    /* Resolve every "fraction of the figure" into pixels once. A threshold in
       bare pixels only ever suits the drawing it was tuned on. */
    o.gapTolerance = Math.max(4, Math.round(o.gapFrac * diag));
    o.perpTolerance = Math.max(1.5, o.perpFrac * diag);
    o.mergeDistance = Math.max(5, o.mergeDistanceFrac * diag);
    o.arrowRadius = Math.max(8, o.arrowRadiusFrac * diag);
    o.arrowMinArea = Math.max(6, o.arrowMinAreaFrac * w * h);
    o.arrowMinTotalArea = Math.max(20, o.arrowMinTotalAreaFrac * w * h);
    o.arrowMaxArea = Math.max(200, o.arrowMaxAreaFrac * w * h);

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
    const segs = joinCollinear(mergeSegments(raw, o), o, diag);
    if (!segs.length) return null;

    /* Points: every crossing, plus the ends of each stroke. Anything closer
       together than joinRadius is one point, not two. */
    const points = [];
    const joinR = o.joinRadius < 1 ? o.joinRadius * diag : o.joinRadius;
    const addPoint = p => {
      for (const q of points) {
        if (Math.hypot(q.x - p.x, q.y - p.y) < joinR) return q;
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

    /* Which angle does the page actually mark? Whichever one the arc is drawn
       in. Offering the wrong quadrant is not a cosmetic slip: on this chapter's
       figures the four angles at a crossing are two different values, and a
       label typed into the wrong one states a relationship the question does
       not make. */
    const parts = residual(gray, w, h, segs, o);
    const used = new Set();
    /* Flag anything arc-shaped about any crossing, so the arrowhead pass can
       never mistake one for a head even if no angle ended up using it. */
    for (const part of parts) {
      for (const c of crossings) {
        if (arcAt(part, c.point.x, c.point.y, o, diag)) { part.isArc = true; break; }
      }
    }

    /* A point far enough along a line from the vertex to name a direction. */
    const rayTowards = (line, vertexId, dirX, dirY) => {
      const v = points.find(p => p.id === vertexId);
      const ends = [line.a, line.b].map(id => points.find(p => p.id === id));
      let best = null, bestDot = -Infinity;
      for (const e of ends) {
        if (!e || e === v) continue;
        const dx = e.x - v.x, dy = e.y - v.y;
        const len = Math.hypot(dx, dy) || 1;
        const dot = (dx / len) * dirX + (dy / len) * dirY;
        if (dot > bestDot) { bestDot = dot; best = e; }
      }
      return best;
    };

    const seen = new Set();
    for (const c of crossings) {
      const la = 'l' + c.a, lb = 'l' + c.b;
      const A = G.lineById(fig, la), B = G.lineById(fig, lb);
      if (!A || !B) continue;
      const key = c.point.id + '|' + la + '|' + lb;
      if (seen.has(key)) continue;
      seen.add(key);
      const V = c.point;

      let arc = null;
      for (const part of parts) {
        if (used.has(part)) continue;
        const a = arcAt(part, V.x, V.y, o, diag);
        if (a && (!arc || a.radius < arc.radius)) { arc = a; arc.part = part; }
      }

      const ua = { x: -Math.sin(segs[c.a].theta), y: Math.cos(segs[c.a].theta) };
      const ub = { x: -Math.sin(segs[c.b].theta), y: Math.cos(segs[c.b].theta) };
      let pick = { a: ua, b: ub };
      if (arc) {
        used.add(arc.part);
        const want = { x: Math.cos(arc.bisector), y: Math.sin(arc.bisector) };
        let bestScore = -Infinity;
        for (const sa of [1, -1]) {
          for (const sb of [1, -1]) {
            const ax = ua.x * sa, ay = ua.y * sa, bx = ub.x * sb, by = ub.y * sb;
            let mx = ax + bx, my = ay + by;
            const m = Math.hypot(mx, my) || 1;
            const score = (mx / m) * want.x + (my / m) * want.y;
            if (score > bestScore) { bestScore = score; pick = { a: { x: ax, y: ay }, b: { x: bx, y: by } }; }
          }
        }
      }
      const from = rayTowards(A, V.id, pick.a.x, pick.a.y);
      const to = rayTowards(B, V.id, pick.b.x, pick.b.y);
      if (!from || !to || from.id === V.id || to.id === V.id) continue;
      /* Two nearly-collinear strokes are not an angle worth offering; 175
         degrees is a straight line with a kink, and filling it in means
         nothing. */
      const spread = Math.abs(G.signedAngle(
        { x: V.x, y: V.y }, { x: from.x, y: from.y }, { x: to.x, y: to.y })) * 180 / Math.PI;
      if (spread < o.minAngleDeg || spread > 180 - o.minAngleDeg) continue;
      fig.angles.push({ vertex: V.id, from: from.id, to: to.id, label: '',
                        fromArc: !!arc });
    }

    /* Arrowheads at a stroke's ends make it a line or a ray, which is how a
       textbook draws these and how they should come back out. */
    for (let i = 0; i < segs.length; i++) {
      const line = G.lineById(fig, 'l' + i);
      if (!line) continue;
      const s = segs[i];
      /* An arrowhead is a small SOLID wedge sitting at the end of a stroke.
         An angle arc and a parallel-marker chevron are thin curves, and they
         also sit near where strokes meet — reading either as a head promotes a
         short segment to a line that then shoots off the page, which is what
         happened to a zig-zag figure. Fill separates them. */
      /* Removing the stroke cuts a head into an upper and a lower wedge, so the
         pieces around one end are weighed together rather than each on its own. */
      const headAt = (x, y) => {
        let total = 0;
        for (const p of parts) {
          if (used.has(p) || p.isArc) continue;
          if (p.comp.area < o.arrowMinArea || p.comp.area > o.arrowMaxArea) continue;
          if (p.comp.fill < o.arrowMinFill) continue;
          const cx = (p.comp.x0 + p.comp.x1) / 2, cy = (p.comp.y0 + p.comp.y1) / 2;
          if (Math.hypot(cx - x, cy - y) <= o.arrowRadius) total += p.comp.area;
        }
        return total >= o.arrowMinTotalArea && total <= o.arrowMaxArea;
      };
      const startHead = headAt(s.x1, s.y1), endHead = headAt(s.x2, s.y2);
      /* Draw the head where the head is. Promoting the stroke to an infinite
         line instead made every figure sprawl far past the extent it has on
         the page, because the renderer then runs it to the edge of the canvas. */
      if (startHead && endHead) line.arrows = 'both';
      else if (startHead) line.arrows = 'start';
      else if (endHead) line.arrows = 'end';
    }

    G.captureSigns(fig);
    fig.notes = '';
    fig.conflicts = [];
    fig.traced = true;
    return fig;
  }

  AM.trace = { traceFigure, DEFAULTS, angleDiff, intersect };
})(typeof globalThis !== 'undefined' ? globalThis : this);
