/* Angles Maker — skew estimation by projection profile.
   Works on the ink point set rather than on rotated copies of the image: one
   pass over ~40k points per candidate angle instead of a full resample. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});

  function collectPoints(mask, w, h, maxPoints) {
    let total = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) total++;
    const stride = Math.max(1, Math.ceil(total / (maxPoints || 40000)));
    const xs = [], ys = [];
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (n++ % stride) continue;
        xs.push(x - w / 2);
        ys.push(y - h / 2);
      }
    }
    return { xs, ys, total };
  }

  /* Destination row for a point once the image is rotated by rad, matching
     image.rotateGray: dv = x*sin + y*cos. */
  function profileScore(pts, rad, span) {
    const sin = Math.sin(rad), cos = Math.cos(rad);
    const hist = new Float64Array(span);
    const off = span / 2;
    const { xs, ys } = pts;
    for (let i = 0; i < xs.length; i++) {
      const v = (xs[i] * sin + ys[i] * cos + off) | 0;
      if (v >= 0 && v < span) hist[v]++;
    }
    let score = 0;
    for (let i = 0; i < span; i++) score += hist[i] * hist[i];
    return score;
  }

  function estimateSkew(mask, w, h, opts) {
    const o = opts || {};
    const maxDeg = o.maxDegrees === undefined ? 10 : o.maxDegrees;
    const pts = collectPoints(mask, w, h, o.maxPoints);
    const span = Math.ceil(Math.sqrt(w * w + h * h)) + 2;
    if (pts.xs.length < 200) return { radians: 0, degrees: 0, prominence: 0, applied: false };

    const scores = [];
    let best = { deg: 0, score: -1 };
    for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += 0.5) {
      const s = profileScore(pts, deg * Math.PI / 180, span);
      scores.push(s);
      if (s > best.score) best = { deg, score: s };
    }
    for (let deg = best.deg - 0.5; deg <= best.deg + 0.5 + 1e-9; deg += 0.1) {
      const s = profileScore(pts, deg * Math.PI / 180, span);
      if (s > best.score) best = { deg, score: s };
    }
    const sorted = scores.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] || 1;
    const prominence = best.score / median;
    /* A curled page gives a flat score curve; rotating on that noise makes
       things worse, so leave it alone and let the user use the slider. */
    const applied = prominence >= (o.minProminence === undefined ? 1.05 : o.minProminence)
                    && Math.abs(best.deg) > 0.15;
    const deg = applied ? best.deg : 0;
    return { radians: deg * Math.PI / 180, degrees: deg, prominence, applied,
             bestDegrees: best.deg };
  }

  AM.deskew = { estimateSkew, profileScore, collectPoints };
})(typeof globalThis !== 'undefined' ? globalThis : this);
