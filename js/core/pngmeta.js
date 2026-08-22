/* Angles Maker — stamp a resolution into a PNG.
   canvas.toBlob writes no pHYs chunk, so Word assumes 96 dpi and drops a
   900px figure onto the page nine inches wide. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});
  const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

  function isPng(b) {
    if (!b || b.length < 8) return false;
    for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) return false;
    return true;
  }
  const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const type = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

  function chunk(name, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, AM.util.crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  function setPngDpi(bytes, dpi) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!isPng(b) || !dpi) return b;
    const ppu = Math.round(dpi / 0.0254);
    const data = new Uint8Array(9);
    const dv = new DataView(data.buffer);
    dv.setUint32(0, ppu); dv.setUint32(4, ppu); data[8] = 1; // unit: metre
    const phys = chunk('pHYs', data);

    const parts = [b.subarray(0, 8)];
    let i = 8, inserted = false;
    while (i + 8 <= b.length) {
      const len = u32(b, i), name = type(b, i + 4), end = i + 12 + len;
      if (end > b.length) break;
      if (name !== 'pHYs') parts.push(b.subarray(i, end));
      if (name === 'IHDR') { parts.push(phys); inserted = true; }
      i = end;
    }
    if (!inserted) return b;
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  function getPngDpi(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!isPng(b)) return null;
    let i = 8;
    while (i + 8 <= b.length) {
      const len = u32(b, i), name = type(b, i + 4);
      if (name === 'pHYs') {
        const unit = b[i + 8 + 8];
        return unit === 1 ? u32(b, i + 8) * 0.0254 : null;
      }
      i += 12 + len;
    }
    return null;
  }

  AM.pngmeta = { setPngDpi, getPngDpi, isPng };
})(typeof globalThis !== 'undefined' ? globalThis : this);
