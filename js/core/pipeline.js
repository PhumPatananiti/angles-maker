/* Angles Maker — page analysis, start to finish.
   The app and the test suite both call analyzePage(); there is no second
   implementation that could drift from the tested one. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});

  const DEFAULTS = {
    analysisWidth: 1600,   // long side used for analysis, not for export
    bgRadius: 0,           // 0 = derive from image size
    sauvolaWindow: 0,
    sauvolaK: 0.25,
    absMax: 200,
    deskew: true,
    maxSkewDegrees: 10,
    forcedAngle: null      // radians, set by the manual rotation slider
  };

  function analyzePage(rgba, width, height, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const img = AM.image;

    let gray = img.toGray(rgba, width, height);
    let w = width, h = height, scale = 1;
    const longSide = Math.max(width, height);
    if (o.analysisWidth && longSide > o.analysisWidth) {
      const target = Math.round(width * (o.analysisWidth / longSide));
      const ds = img.downscaleGray(gray, width, height, target);
      gray = ds.data; w = ds.width; h = ds.height; scale = ds.width / width;
    }

    const flat = img.flattenImage(gray, w, h, o.bgRadius || 0);
    const mask = img.sauvola(flat, w, h, {
      window: o.sauvolaWindow || 0, k: o.sauvolaK, absMax: o.absMax
    });

    let skew = { radians: 0, degrees: 0, prominence: 0, applied: false };
    if (o.forcedAngle !== null && o.forcedAngle !== undefined) {
      skew = { radians: o.forcedAngle, degrees: o.forcedAngle * 180 / Math.PI,
               prominence: 0, applied: o.forcedAngle !== 0, forced: true };
    } else if (o.deskew) {
      skew = AM.deskew.estimateSkew(mask, w, h, { maxDegrees: o.maxSkewDegrees });
    }

    let dFlat = { data: flat, width: w, height: h };
    let dMask = { data: mask, width: w, height: h };
    if (skew.radians) {
      dFlat = img.rotateGray(flat, w, h, skew.radians, 255);
      dMask = img.rotateMask(mask, w, h, skew.radians);
    }

    const det = AM.detect.detectFigures(dFlat.data, dMask.data, dFlat.width, dFlat.height, o.detect);

    return {
      scale,                       // analysis px per original px
      analysis: { gray, flat, mask, width: w, height: h },
      skew,
      deskewed: { flat: dFlat.data, mask: dMask.data, width: dFlat.width, height: dFlat.height },
      boxes: det.boxes,            // in deskewed ANALYSIS coordinates
      textHeight: det.textHeight,
      rejected: det.rejected,
      textRects: det.textRects,
      comps: det.comps
    };
  }

  /* Deskewed analysis box -> deskewed full-resolution box. Both scales rotate
     about their own centre and rotatedSize is linear in scale, so this is a
     plain division. Asserted in test/run.js. */
  function boxToFullRes(box, scale) {
    return {
      x: Math.round(box.x / scale), y: Math.round(box.y / scale),
      w: Math.round(box.w / scale), h: Math.round(box.h / scale)
    };
  }

  AM.pipeline = { analyzePage, boxToFullRes, DEFAULTS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
