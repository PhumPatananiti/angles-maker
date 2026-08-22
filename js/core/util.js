/* Angles Maker — shared helpers. Loads as a classic script in the browser and
   via require() in Node; both just attach to a global AM namespace. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, seed) {
    let c = (seed === undefined ? 0xFFFFFFFF : seed) >>> 0;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);

  /* p in [0,1]. Sorts a copy, so callers keep their array. */
  function percentile(values, p) {
    if (!values.length) return 0;
    const a = Array.prototype.slice.call(values).sort((x, y) => x - y);
    const i = clamp(Math.round((a.length - 1) * p), 0, a.length - 1);
    return a[i];
  }

  /* Bounding box of a w x h rectangle rotated by rad. Must match the canvas
     convention exactly: both scales rotate about their own centre, so this is
     linear in scale and box_fullres === box_analysis / s. */
  function rotatedSize(w, h, rad) {
    const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    return { w: Math.round(w * c + h * s), h: Math.round(w * s + h * c) };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  /* Gap between two rectangles: 0 if they touch or overlap. */
  function rectGap(a, b) {
    const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
    const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
    return Math.sqrt(dx * dx + dy * dy);
  }

  function unionRect(a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }

  function intersectionOverUnion(a, b) {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    if (x2 <= x || y2 <= y) return 0;
    const inter = (x2 - x) * (y2 - y);
    return inter / (a.w * a.h + b.w * b.h - inter);
  }

  /* Zip entry names come from a user-editable label. */
  function sanitizeName(name, fallback) {
    let s = String(name == null ? '' : name)
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/^\.+/, '')
      .trim();
    if (s.length > 80) s = s.slice(0, 80);
    return s || (fallback || 'figure');
  }

  function uniqueName(name, taken) {
    if (!taken.has(name)) { taken.add(name); return name; }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let i = 2, candidate;
    do { candidate = stem + '-' + i + ext; i++; } while (taken.has(candidate));
    taken.add(candidate);
    return candidate;
  }

  AM.util = { crc32, clamp, percentile, rotatedSize, rectsOverlap, rectGap, unionRect,
              intersectionOverUnion, sanitizeName, uniqueName };
})(typeof globalThis !== 'undefined' ? globalThis : this);
