/* Angles Maker — pixel operations. Pure JS on plain typed arrays, no DOM, so the
   same code runs in the browser and under Node for tests. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});
  const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);

  function toGray(rgba, w, h) {
    const g = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) {
      g[i] = (rgba[p] * 77 + rgba[p + 1] * 151 + rgba[p + 2] * 28) >> 8;
    }
    return g;
  }

  function grayToRGBA(g, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) {
      out[p] = out[p + 1] = out[p + 2] = g[i];
      out[p + 3] = 255;
    }
    return out;
  }

  /* Sliding-window 1D maximum, O(n) via a monotonic deque. dir 1 = max, -1 = min. */
  function slide1D(src, dst, len, stride, offset, r, dir) {
    const idx = new Int32Array(len);
    let head = 0, tail = 0;
    const val = i => dir > 0 ? src[offset + i * stride] : -src[offset + i * stride];
    for (let i = 0; i < len + r; i++) {
      if (i < len) {
        while (tail > head && val(idx[tail - 1]) <= val(i)) tail--;
        idx[tail++] = i;
      }
      const o = i - r;
      if (o >= 0) {
        while (idx[head] < o - r) head++;
        dst[offset + o * stride] = src[offset + idx[head] * stride];
      }
    }
  }

  /* Separable morphology over a (2rx+1) x (2ry+1) rectangle. */
  function morphXY(src, w, h, rx, ry, dir) {
    let cur = src;
    if (rx > 0) {
      const tmp = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) slide1D(cur, tmp, w, 1, y * w, rx, dir);
      cur = tmp;
    }
    if (ry > 0) {
      const out = new Uint8Array(w * h);
      for (let x = 0; x < w; x++) slide1D(cur, out, h, w, x, ry, dir);
      cur = out;
    }
    return cur === src ? src.slice() : cur;
  }
  function morph(src, w, h, r, dir) { return morphXY(src, w, h, r, r, dir); }
  const maxFilter = (s, w, h, r) => morph(s, w, h, r, 1);
  const minFilter = (s, w, h, r) => morph(s, w, h, r, -1);

  /* Summed-area table, (w+1) x (h+1), for O(1) window means. */
  function integral(src, w, h, square) {
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        const v = src[y * w + x];
        rowSum += square ? v * v : v;
        I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + rowSum;
      }
    }
    return I;
  }

  function boxMean(I, w, x0, y0, x1, y1) {
    const W = w + 1;
    const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
    return s / ((x1 - x0) * (y1 - y0));
  }

  function boxBlur(src, w, h, r) {
    const I = integral(src, w, h, false);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        out[y * w + x] = boxMean(I, w, x0, y0, x1, y1) + 0.5;
      }
    }
    return out;
  }

  /* Paper estimate: ink is dark and thin, so a local maximum wipes it out and
     leaves the illumination field. Clamped at 60 so a near-black region (the
     dark surround beyond the page edge) cannot blow up the division. */
  function estimateBackground(gray, w, h, radius) {
    const r = radius || Math.max(6, Math.round(0.02 * Math.min(w, h)));
    const bg = maxFilter(gray, w, h, r);
    const smooth = boxBlur(bg, w, h, Math.max(2, r >> 1));
    for (let i = 0; i < smooth.length; i++) if (smooth[i] < 60) smooth[i] = 60;
    return smooth;
  }

  /* Divide out the illumination field: paper -> ~255, ink keeps its contrast. */
  function flatten(gray, bg, w, h) {
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = clamp((gray[i] * 255 / bg[i]) | 0, 0, 255);
    return out;
  }

  function flattenImage(gray, w, h, radius) {
    return flatten(gray, estimateBackground(gray, w, h, radius), w, h);
  }

  /* Sauvola local threshold plus an absolute gate. The gate is what removes
     bleed-through from the reverse side of the page: it is real line art and
     locally high-contrast, so an adaptive threshold alone will keep it. */
  function sauvola(gray, w, h, opts) {
    const o = opts || {};
    const win = Math.max(7, o.window || Math.round(0.04 * Math.min(w, h)) | 1);
    const k = o.k === undefined ? 0.25 : o.k;
    const R = 128;
    const absMax = o.absMax === undefined ? 200 : o.absMax;
    const I = integral(gray, w, h, false), I2 = integral(gray, w, h, true);
    const r = win >> 1;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = gray[i];
        if (v > absMax) continue;
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const mean = boxMean(I, w, x0, y0, x1, y1);
        const meanSq = boxMean(I2, w, x0, y0, x1, y1);
        const sd = Math.sqrt(Math.max(0, meanSq - mean * mean));
        if (v < mean * (1 + k * (sd / R - 1))) mask[i] = 1;
      }
    }
    return mask;
  }

  function dilateMask(mask, w, h, r) { return morph(mask, w, h, r, 1); }
  function erodeMask(mask, w, h, r) { return morph(mask, w, h, r, -1); }

  /* Black/white point stretch. bp/wp are 0..255 on the flattened image. */
  function levels(gray, bp, wp) {
    const out = new Uint8Array(gray.length);
    const span = Math.max(1, wp - bp);
    for (let i = 0; i < gray.length; i++) out[i] = clamp(((gray[i] - bp) * 255 / span) | 0, 0, 255);
    return out;
  }

  /* Bilinear resample. Uses the same centre-to-centre convention as
     canvas translate(W/2,H/2) -> rotate(rad) -> drawImage(-w/2,-h/2). */
  function rotateGray(src, w, h, rad, fill) {
    const size = AM.util.rotatedSize(w, h, rad);
    const W = size.w, H = size.h;
    const dst = new Uint8Array(W * H);
    if (fill) dst.fill(fill);
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const cx = w / 2, cy = h / 2, ux = W / 2, uy = H / 2;
    for (let v = 0; v < H; v++) {
      const dv = v - uy;
      for (let u = 0; u < W; u++) {
        const du = u - ux;
        const x = cos * du + sin * dv + cx;
        const y = -sin * du + cos * dv + cy;
        if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) continue;
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
        const a = src[y0 * w + x0], b = src[y0 * w + x0 + 1];
        const c = src[(y0 + 1) * w + x0], d = src[(y0 + 1) * w + x0 + 1];
        dst[v * W + u] = (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) +
                          c * (1 - fx) * fy + d * fx * fy) | 0;
      }
    }
    return { data: dst, width: W, height: H };
  }

  function rotateMask(src, w, h, rad) {
    const g = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) g[i] = src[i] ? 255 : 0;
    const r = rotateGray(g, w, h, rad, 0);
    const m = new Uint8Array(r.data.length);
    for (let i = 0; i < m.length; i++) m[i] = r.data[i] > 127 ? 1 : 0;
    return { data: m, width: r.width, height: r.height };
  }

  function downscaleGray(src, w, h, targetW) {
    const scale = targetW / w;
    const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
    const out = new Uint8Array(W * H);
    const bx = w / W, by = h / H;
    for (let y = 0; y < H; y++) {
      const y0 = (y * by) | 0, y1 = Math.min(h, Math.max(y0 + 1, ((y + 1) * by) | 0));
      for (let x = 0; x < W; x++) {
        const x0 = (x * bx) | 0, x1 = Math.min(w, Math.max(x0 + 1, ((x + 1) * bx) | 0));
        let s = 0, n = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += src[yy * w + xx]; n++; }
        out[y * W + x] = n ? (s / n) | 0 : 255;
      }
    }
    return { data: out, width: W, height: H, scale: W / w };
  }

  /* Two-pass connected components (8-connected) with union-find.
     `stats` accumulates the mean flattened darkness per component, which is how
     bleed-through gets separated from real ink. */
  function connectedComponents(mask, w, h, grayForStats) {
    const labels = new Int32Array(w * h);
    const parent = [0];
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
    let next = 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        let best = 0;
        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dy === 0 && dx >= 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w) continue;
            const l = labels[ny * w + nx];
            if (!l) continue;
            best = best ? (union(best, l), Math.min(find(best), find(l))) : l;
          }
        }
        if (!best) { best = next; parent[next] = next; next++; }
        labels[i] = best;
      }
    }
    const remap = new Int32Array(next);
    let count = 0;
    for (let l = 1; l < next; l++) if (find(l) === l) remap[l] = count++;
    const comps = [];
    for (let i = 0; i < count; i++) {
      comps.push({ id: i, x0: 1e9, y0: 1e9, x1: -1, y1: -1, area: 0, darkSum: 0,
                   maxRunH: 0, maxRunV: 0 });
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const l = labels[i];
        if (!l) { labels[i] = -1; continue; }
        const id = remap[find(l)];
        labels[i] = id;
        const c = comps[id];
        if (x < c.x0) c.x0 = x;
        if (y < c.y0) c.y0 = y;
        if (x > c.x1) c.x1 = x;
        if (y > c.y1) c.y1 = y;
        c.area++;
        if (grayForStats) c.darkSum += 255 - grayForStats[i];
      }
    }
    /* Longest unbroken run of one label, per direction. Only used to tell a
       drawn straight line (one continuous stroke, possibly carrying arrowheads
       that inflate its bounding box) from a line of text (broken between
       glyphs) — both are wide and flat, and nothing else separates them. */
    for (let y = 0; y < h; y++) {
      let run = 0, prev = -1;
      for (let x = 0; x <= w; x++) {
        const id = x < w ? labels[y * w + x] : -1;
        if (id === prev && id >= 0) run++;
        else {
          if (prev >= 0 && run > comps[prev].maxRunH) comps[prev].maxRunH = run;
          prev = id; run = 1;
        }
      }
    }
    for (let x = 0; x < w; x++) {
      let run = 0, prev = -1;
      for (let y = 0; y <= h; y++) {
        const id = y < h ? labels[y * w + x] : -1;
        if (id === prev && id >= 0) run++;
        else {
          if (prev >= 0 && run > comps[prev].maxRunV) comps[prev].maxRunV = run;
          prev = id; run = 1;
        }
      }
    }
    for (const c of comps) {
      c.w = c.x1 - c.x0 + 1;
      c.h = c.y1 - c.y0 + 1;
      c.fill = c.area / (c.w * c.h);
      c.darkness = c.area ? c.darkSum / c.area / 255 : 0;
      c.rect = { x: c.x0, y: c.y0, w: c.w, h: c.h };
    }
    return { labels, comps };
  }

  AM.image = { toGray, grayToRGBA, maxFilter, minFilter, morphXY, integral, boxMean, boxBlur,
               estimateBackground, flatten, flattenImage, sauvola, dilateMask, erodeMask,
               levels, rotateGray, rotateMask, downscaleGray, connectedComponents };
})(typeof globalThis !== 'undefined' ? globalThis : this);
