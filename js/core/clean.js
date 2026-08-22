/* Angles Maker — turn a crop of a photo into line art fit for a document.
   This, not the cropping, is what the tool is actually for: a screenshot of a
   page photo is grey, shadowed and skewed; this makes it black on white. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});

  const DEFAULTS = {
    mode: 'gray',      // 'gray' | 'bw' | 'transparent'
    black: 0.30,       // flattened value at or below this becomes solid black
    white: 0.80,       // at or above this becomes paper white — also wipes bleed-through
    bolder: false,     // thicken strokes by 1px, for figures that print small
    padding: 0.03,     // fraction of the longer side
    minPadding: 8
  };

  function cleanCrop(rgba, w, h, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const img = AM.image;
    let gray = img.toGray(rgba, w, h);

    /* Local background, so a shadow falling across one corner of the crop does
       not turn into a grey wash in the exported figure. */
    const r = Math.max(6, Math.min(60, Math.round(Math.min(w, h) / 8)));
    gray = img.flattenImage(gray, w, h, r);
    if (o.bolder) gray = img.minFilter(gray, w, h, 1);
    gray = img.levels(gray, Math.round(o.black * 255), Math.round(o.white * 255));
    if (o.mode === 'bw') {
      for (let i = 0; i < gray.length; i++) gray[i] = gray[i] < 128 ? 0 : 255;
    }

    const pad = Math.max(o.minPadding | 0, Math.round((o.padding || 0) * Math.max(w, h)));
    const W = w + pad * 2, H = h + pad * 2;
    const out = new Uint8ClampedArray(W * H * 4);
    const transparent = o.mode === 'transparent';
    if (!transparent) out.fill(255);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const sx = x - pad, sy = y - pad;
        const inside = sx >= 0 && sy >= 0 && sx < w && sy < h;
        const v = inside ? gray[sy * w + sx] : 255;
        if (transparent) {
          out[p] = out[p + 1] = out[p + 2] = 0;
          out[p + 3] = 255 - v;
        } else {
          out[p] = out[p + 1] = out[p + 2] = v;
          out[p + 3] = 255;
        }
      }
    }
    return { data: out, width: W, height: H };
  }

  AM.clean = { cleanCrop, DEFAULTS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
