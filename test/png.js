/* Minimal PNG writer, for looking at what the tests produced. Node only. */
const zlib = require('zlib');
require('../js/core/util.js');

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(AM.util.crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodeRGBA(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4)
      .copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function fromGray(g, w, h) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    rgba[p] = rgba[p + 1] = rgba[p + 2] = g[i]; rgba[p + 3] = 255;
  }
  return rgba;
}

function drawBox(rgba, w, h, box, color, thickness) {
  const t = thickness || 2;
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = (y * w + x) * 4;
    rgba[p] = color[0]; rgba[p + 1] = color[1]; rgba[p + 2] = color[2]; rgba[p + 3] = 255;
  };
  const x0 = Math.round(box.x), y0 = Math.round(box.y);
  const x1 = Math.round(box.x + box.w), y1 = Math.round(box.y + box.h);
  for (let k = 0; k < t; k++) {
    for (let x = x0; x <= x1; x++) { put(x, y0 + k); put(x, y1 - k); }
    for (let y = y0; y <= y1; y++) { put(x0 + k, y); put(x1 - k, y); }
  }
}

module.exports = { encodeRGBA, fromGray, drawBox };
