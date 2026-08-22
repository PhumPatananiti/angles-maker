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

/* A decoder, so photographs and screenshots can be fixtures rather than
   something only a browser can open. Handles the 8-bit RGB and RGBA files that
   screenshots and phone cameras produce; anything else is refused loudly. */
function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('not a PNG');
  let i = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (depth !== 8) throw new Error('unsupported bit depth ' + depth);
  if (interlace) throw new Error('interlaced PNG not supported');
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : 0;
  if (!channels) throw new Error('unsupported colour type ' + color);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  const gray = new Uint8Array(w * h);
  for (let p2 = 0, n = 0; n < w * h; n++, p2 += channels) {
    gray[n] = channels === 1 ? out[p2]
            : (out[p2] * 77 + out[p2 + 1] * 151 + out[p2 + 2] * 28) >> 8;
  }
  return { width: w, height: h, gray, channels };
}

module.exports = { encodeRGBA, fromGray, drawBox, decode };
