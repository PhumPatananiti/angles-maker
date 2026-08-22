/* Angles Maker — synthetic workbook page.
   Doubles as the app's "Load demo page" and as the regression fixture. It is
   deliberately built out of the cases that broke earlier designs: oblique
   transversals, figures made of disconnected strokes, an answer column close to
   the figure, labels sitting on the strokes, bleed-through, a dark page edge,
   an illumination gradient and a few degrees of skew. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function Canvas(w, h) {
    this.w = w; this.h = h;
    this.g = new Uint8Array(w * h).fill(255);
  }
  Canvas.prototype.blend = function (x, y, a, ink) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = y * this.w + x;
    this.g[i] = Math.min(this.g[i], Math.round(this.g[i] * (1 - a) + ink * a));
    if (this.track && a > 0.25 && ink < 160) {
      const t = this.track;
      if (x < t.x0) t.x0 = x; if (y < t.y0) t.y0 = y;
      if (x > t.x1) t.x1 = x; if (y > t.y1) t.y1 = y;
    }
  };
  /* Ground truth is the exact extent of the ink a figure laid down, so the
     tests measure the detector rather than an arbitrary margin. */
  Canvas.prototype.beginTrack = function () { this.track = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 }; };
  Canvas.prototype.endTrack = function () {
    const t = this.track; this.track = null;
    return { x: t.x0, y: t.y0, w: t.x1 - t.x0 + 1, h: t.y1 - t.y0 + 1 };
  };
  Canvas.prototype.line = function (x0, y0, x1, y1, width, ink) {
    const hw = (width || 2) / 2;
    const k = ink === undefined ? 20 : ink;
    const minX = Math.floor(Math.min(x0, x1) - hw - 1), maxX = Math.ceil(Math.max(x0, x1) + hw + 1);
    const minY = Math.floor(Math.min(y0, y1) - hw - 1), maxY = Math.ceil(Math.max(y0, y1) + hw + 1);
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let t = ((x - x0) * dx + (y - y0) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = x0 + t * dx - x, py = y0 + t * dy - y;
        const d = Math.sqrt(px * px + py * py);
        this.blend(x, y, Math.max(0, Math.min(1, hw + 0.5 - d)), k);
      }
    }
  };
  Canvas.prototype.rect = function (x, y, w, h, ink) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.blend(xx, yy, 1, ink);
  };
  Canvas.prototype.frame = function (x, y, w, h, t, ink) {
    this.line(x, y, x + w, y, t, ink); this.line(x, y + h, x + w, y + h, t, ink);
    this.line(x, y, x, y + h, t, ink); this.line(x + w, y, x + w, y + h, t, ink);
  };

  /* A row of glyph-shaped marks with occasional marks above the body, which is
     what makes the text-height estimator's job realistic. */
  function textRun(cv, x, y, width, th, rnd, ink) {
    let cx = x;
    const stroke = Math.max(1.5, th * 0.11);
    while (cx < x + width) {
      const gw = th * (0.45 + rnd() * 0.35);
      if (cx + gw > x + width) break;
      const n = 2 + (rnd() * 2 | 0);
      for (let i = 0; i < n; i++) {
        const gx = cx + gw * (i / n) + gw * 0.1;
        if (rnd() < 0.55) cv.line(gx, y, gx, y + th, stroke, ink);
        else cv.line(gx, y + th * 0.45, gx + gw * 0.55, y + th * (rnd() < 0.5 ? 0.1 : 0.95), stroke, ink);
      }
      if (rnd() < 0.3) cv.line(cx + gw * 0.3, y - th * 0.42, cx + gw * 0.55, y - th * 0.42, stroke, ink);
      cx += gw + th * (0.16 + rnd() * 0.14);
    }
  }

  function label(cv, x, y, chars, th, rnd, ink) {
    textRun(cv, x, y, chars * th * 0.62, th, rnd, ink);
  }

  /* Each figure returns the ground-truth box of everything it drew. */
  const FIGURES = {
    /* Two parallels cut by an oblique transversal, with angle labels on it. */
    transversal(cv, x, y, s, th, rnd, ink) {
      const w = s * 2.2, h = s * 1.3;
      cv.line(x, y + h * 0.15, x + w, y + h * 0.15, 2.4, ink);
      cv.line(x, y + h * 0.85, x + w, y + h * 0.85, 2.4, ink);
      const ang = 62 * Math.PI / 180;
      const cx = x + w * 0.45, len = h * 0.95;
      cv.line(cx - Math.cos(ang) * len, y + h * 0.15 - Math.sin(ang) * 0 - h * 0.12,
              cx + Math.cos(ang) * len, y + h * 0.85 + h * 0.12, 2.4, ink);
      label(cv, x + w * 0.52, y + h * 0.19, 3, th * 0.8, rnd, ink);
      label(cv, x + w * 0.3, y + h * 0.66, 3, th * 0.8, rnd, ink);
      label(cv, x - th * 0.1, y + h * 0.15 - th * 1.1, 1, th * 0.8, rnd, ink);
    },
    /* Triangle with an internal parallel segment; labels inside the figure. */
    triangle(cv, x, y, s, th, rnd, ink) {
      const w = s * 1.7, h = s * 1.35;
      const ax = x + w * 0.42, ay = y;
      cv.line(ax, ay, x, y + h, 2.4, ink);
      cv.line(ax, ay, x + w, y + h, 2.4, ink);
      cv.line(x, y + h, x + w, y + h, 2.4, ink);
      cv.line(x + w * 0.19, y + h * 0.55, x + w * 0.69, y + h * 0.55, 2.4, ink);
      label(cv, ax - th * 0.4, ay + th * 0.5, 2, th * 0.8, rnd, ink);
      label(cv, x + w * 0.3, y + h * 0.6, 4, th * 0.8, rnd, ink);
      label(cv, x + w * 0.12, y + h - th * 1.3, 3, th * 0.8, rnd, ink);
    },
    /* Five parallel lines that never touch each other. */
    ladder(cv, x, y, s, th, rnd, ink) {
      const w = s * 1.9, gap = s * 0.24;
      for (let i = 0; i < 5; i++) {
        cv.line(x, y + i * gap, x + w, y + i * gap, 2.4, ink);
        cv.line(x + w * 0.42, y + i * gap - 4, x + w * 0.5, y + i * gap, 2, ink);
        cv.line(x + w * 0.42, y + i * gap + 4, x + w * 0.5, y + i * gap, 2, ink);
      }
    },
    /* Zig-zag between two rays, touching nothing, at 20 and 35 degrees. */
    zigzag(cv, x, y, s, th, rnd, ink) {
      const w = s * 2.0, h = s * 1.15;
      cv.line(x, y, x + w, y, 2.4, ink);
      cv.line(x, y + h, x + w, y + h, 2.4, ink);
      const p = [[x + w * 0.22, y + h * 0.12], [x + w * 0.62, y + h * 0.40],
                 [x + w * 0.30, y + h * 0.66], [x + w * 0.74, y + h * 0.88]];
      for (let i = 0; i < p.length - 1; i++) cv.line(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], 2.4, ink);
      label(cv, x + w * 0.26, y + h * 0.16, 3, th * 0.8, rnd, ink);
    }
  };

  function makePage(opts) {
    const o = Object.assign({
      width: 1200, height: 1600, textHeight: 22, seed: 7, skewDegrees: 3,
      shadow: true, noise: 6, ghost: true, darkEdge: true, header: true, choices: true
    }, opts || {});
    const rnd = mulberry32(o.seed);
    const cv = new Canvas(o.width, o.height);
    const th = o.textHeight;
    const truth = [], choiceRects = [];
    const margin = Math.round(o.width * 0.09);

    if (o.header) {
      cv.rect(margin + 40, 40, o.width - margin * 2 - 80, th * 2.6, 35);
      cv.line(margin, 30, o.width - margin, 30, 1.5, 120);
    }
    if (o.darkEdge) {
      /* The facing page and the dark surround beyond the book's edge. */
      cv.rect(0, 0, 26, o.height, 60);
      for (let y = 120; y < o.height - 120; y += th * 2.6) textRun(cv, 30, y, 22, th * 0.8, rnd, 90);
    }

    const kinds = ['transversal', 'triangle', 'ladder', 'zigzag'];
    let y = 40 + th * 5;
    const figX = margin + 40;
    for (let q = 0; q < kinds.length; q++) {
      textRun(cv, margin, y, o.width - margin * 2 - 120, th, rnd, 25);
      y += th * 2.2;
      const s = Math.min(230, (o.height - y) / 2.6);
      cv.beginTrack();
      FIGURES[kinds[q]](cv, figX, y, s, th, rnd, 25);
      const box = cv.endTrack();
      truth.push(box);
      if (o.choices) {
        /* 2.5 text heights to the right of the figure: close enough that a
           sloppy grouping radius swallows it. */
        const cx = box.x + box.w + th * 2.5;
        for (let i = 0; i < 4; i++) {
          const cy = box.y + th * 1.2 + i * th * 2.2;
          textRun(cv, cx, cy, th * 4.2, th, rnd, 25);
          choiceRects.push({ x: cx, y: cy - th * 0.5, w: th * 4.2, h: th * 1.6 });
        }
      }
      y += box.h + th * 1.6;
    }

    if (o.ghost) {
      /* Bleed-through: real line art, ~25% contrast, mirrored position. */
      const gy = Math.min(o.height - 260, 220);
      FIGURES.triangle(cv, o.width - margin - 250, gy, 150, th, mulberry32(3), 200);
    }

    const truthSource = truth.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
    const choiceSource = choiceRects.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h }));

    let g = cv.g, W = o.width, H = o.height;
    if (o.skewDegrees) {
      const r = AM.image.rotateGray(g, W, H, o.skewDegrees * Math.PI / 180, 245);
      /* Ground truth follows the same centre-to-centre rotation. */
      const rad = o.skewDegrees * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      const map = (px, py) => {
        const dx = px - W / 2, dy = py - H / 2;
        return { x: cos * dx - sin * dy + r.width / 2, y: sin * dx + cos * dy + r.height / 2 };
      };
      const remap = box => {
        const pts = [map(box.x, box.y), map(box.x + box.w, box.y),
                     map(box.x, box.y + box.h), map(box.x + box.w, box.y + box.h)];
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        return { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
                 w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
                 h: Math.max.apply(null, ys) - Math.min.apply(null, ys) };
      };
      for (let i = 0; i < truth.length; i++) truth[i] = remap(truth[i]);
      for (let i = 0; i < choiceRects.length; i++) choiceRects[i] = remap(choiceRects[i]);
      g = r.data; W = r.width; H = r.height;
    }

    /* Also hand back the pre-rotation boxes: taking the axis-aligned bounds of
       a rotated rectangle inflates it, and a test that rotates ground truth
       twice measures its own arithmetic instead of the detector. */
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let yy = 0; yy < H; yy++) {
      for (let xx = 0; xx < W; xx++) {
        const i = yy * W + xx;
        let v = g[i];
        if (o.shadow) {
          /* Corner shadow plus a soft gradient, like a phone photo of a book. */
          const nx = xx / W, ny = yy / H;
          const shade = 1 - 0.34 * Math.pow(Math.max(0, nx - 0.45) / 0.55, 1.6)
                          - 0.20 * Math.pow(Math.max(0, ny - 0.55) / 0.45, 1.7)
                          - 0.10 * (1 - ny);
          v = v * Math.max(0.35, shade);
        }
        if (o.noise) v += (rnd() - 0.5) * o.noise;
        const c = v < 0 ? 0 : v > 255 ? 255 : v | 0;
        const p = i * 4;
        rgba[p] = c; rgba[p + 1] = c; rgba[p + 2] = Math.min(255, c + 4); rgba[p + 3] = 255;
      }
    }
    return { rgba, width: W, height: H, truth, choiceRects, textHeight: th,
             truthSource, choiceSource, sourceWidth: o.width, sourceHeight: o.height,
             skewRadians: (o.skewDegrees || 0) * Math.PI / 180 };
  }

  AM.synth = { makePage, FIGURES, mulberry32 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
