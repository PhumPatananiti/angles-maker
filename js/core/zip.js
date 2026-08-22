/* Angles Maker — minimal ZIP writer, stored (no compression).
   PNG is already deflated; re-deflating it buys nothing and would pull in a
   compressor. Verified against `unzip -t` in the test suite. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});

  function dosDateTime(date) {
    const d = date || new Date();
    const y = Math.max(1980, d.getFullYear());
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31),
      date: (((y - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
    };
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }

  function makeZip(entries, date) {
    const stamp = dosDateTime(date);
    const files = entries.map(e => {
      const name = utf8(e.name);
      const data = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data);
      return { name, data, crc: AM.util.crc32(data) };
    });

    let size = 0;
    for (const f of files) size += 30 + f.name.length + f.data.length + 46 + f.name.length;
    size += 22;
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    let at = 0;
    const offsets = [];

    for (const f of files) {
      offsets.push(at);
      dv.setUint32(at, 0x04034b50, true);
      dv.setUint16(at + 4, 20, true);
      dv.setUint16(at + 6, 0x0800, true);   // UTF-8 names
      dv.setUint16(at + 8, 0, true);        // stored
      dv.setUint16(at + 10, stamp.time, true);
      dv.setUint16(at + 12, stamp.date, true);
      dv.setUint32(at + 14, f.crc, true);
      dv.setUint32(at + 18, f.data.length, true);
      dv.setUint32(at + 22, f.data.length, true);
      dv.setUint16(at + 26, f.name.length, true);
      dv.setUint16(at + 28, 0, true);
      at += 30;
      out.set(f.name, at); at += f.name.length;
      out.set(f.data, at); at += f.data.length;
    }

    const dirStart = at;
    files.forEach((f, i) => {
      dv.setUint32(at, 0x02014b50, true);
      dv.setUint16(at + 4, 20, true);
      dv.setUint16(at + 6, 20, true);
      dv.setUint16(at + 8, 0x0800, true);
      dv.setUint16(at + 10, 0, true);
      dv.setUint16(at + 12, stamp.time, true);
      dv.setUint16(at + 14, stamp.date, true);
      dv.setUint32(at + 16, f.crc, true);
      dv.setUint32(at + 20, f.data.length, true);
      dv.setUint32(at + 24, f.data.length, true);
      dv.setUint16(at + 28, f.name.length, true);
      dv.setUint16(at + 30, 0, true);
      dv.setUint16(at + 32, 0, true);
      dv.setUint16(at + 34, 0, true);
      dv.setUint16(at + 36, 0, true);
      dv.setUint32(at + 38, 0, true);
      dv.setUint32(at + 42, offsets[i], true);
      at += 46;
      out.set(f.name, at); at += f.name.length;
    });

    dv.setUint32(at, 0x06054b50, true);
    dv.setUint16(at + 4, 0, true);
    dv.setUint16(at + 6, 0, true);
    dv.setUint16(at + 8, files.length, true);
    dv.setUint16(at + 10, files.length, true);
    dv.setUint32(at + 12, at - dirStart, true);
    dv.setUint32(at + 16, dirStart, true);
    dv.setUint16(at + 20, 0, true);
    return out;
  }

  AM.zip = { makeZip };
})(typeof globalThis !== 'undefined' ? globalThis : this);
