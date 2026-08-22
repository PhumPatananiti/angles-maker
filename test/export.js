/* Angles Maker — export path: crop, clean, PNG, dpi, zip. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('../js/core/util.js');
require('../js/core/image.js');
require('../js/core/deskew.js');
require('../js/core/detect.js');
require('../js/core/synth.js');
require('../js/core/pipeline.js');
require('../js/core/clean.js');
require('../js/core/pngmeta.js');
require('../js/core/zip.js');
const png = require('./png.js');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let failures = 0, checks = 0;
const check = (name, ok, detail) => {
  checks++; if (!ok) failures++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

console.log('export path');
const page = AM.synth.makePage({ seed: 7, skewDegrees: 3 });
/* Analyse small, export from full resolution — the same split the app uses. */
const res = AM.pipeline.analyzePage(page.rgba, page.width, page.height, { analysisWidth: 800 });

const grayFull = AM.image.toGray(page.rgba, page.width, page.height);
const deskewed = AM.image.rotateGray(grayFull, page.width, page.height, res.skew.radians, 245);
const dW = deskewed.width, dH = deskewed.height;
const rgbaFull = AM.image.grayToRGBA(deskewed.data, dW, dH);

const entries = [];
res.boxes.forEach((box, i) => {
  const b = AM.pipeline.boxToFullRes(box, res.scale);
  const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
  const cw = Math.min(dW, b.x + b.w) - x0, ch = Math.min(dH, b.y + b.h) - y0;
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const src = ((y0 + y) * dW + x0) * 4;
    crop.set(rgbaFull.subarray(src, src + cw * 4), y * cw * 4);
  }
  const cleaned = AM.clean.cleanCrop(crop, cw, ch, { mode: 'gray' });
  let bytes = new Uint8Array(png.encodeRGBA(cleaned.data, cleaned.width, cleaned.height));
  bytes = AM.pngmeta.setPngDpi(bytes, 300);
  const name = 'q' + String(i + 1).padStart(2, '0') + '.png';
  fs.writeFileSync(path.join(OUT, name), bytes);
  entries.push({ name, data: bytes });

  if (i === 0) {
    /* Paper must come out white and ink must come out black; a grey wash is
       the whole failure mode this step exists to prevent. */
    const g = AM.image.toGray(cleaned.data, cleaned.width, cleaned.height);
    let white = 0, black = 0, mid = 0;
    for (const v of g) { if (v >= 250) white++; else if (v <= 12) black++; else mid++; }
    check('paper is white after cleanup', white / g.length > 0.85,
          (100 * white / g.length).toFixed(1) + '% pure white');
    check('ink survives cleanup', black > 200, black + ' pure black pixels');
    check('little grey left', mid / g.length < 0.08, (100 * mid / g.length).toFixed(1) + '% grey');
  }
});
check('one png per figure', entries.length === res.boxes.length && entries.length === 4,
      entries.length + ' files');

const dpi = AM.pngmeta.getPngDpi(entries[0].data);
check('png carries 300 dpi', dpi !== null && Math.abs(dpi - 300) < 1, String(dpi && dpi.toFixed(2)));
const noMeta = new Uint8Array(png.encodeRGBA(new Uint8ClampedArray(4 * 4 * 4), 4, 4));
check('a png without pHYs reads back as null', AM.pngmeta.getPngDpi(noMeta) === null);
const twice = AM.pngmeta.setPngDpi(AM.pngmeta.setPngDpi(noMeta, 150), 300);
check('stamping twice replaces rather than appends',
      Math.abs(AM.pngmeta.getPngDpi(twice) - 300) < 1 && twice.length === AM.pngmeta.setPngDpi(noMeta, 300).length);

const zipBytes = AM.zip.makeZip(entries, new Date(2024, 0, 15, 12, 0, 0));
const zipPath = path.join(OUT, 'figures.zip');
fs.writeFileSync(zipPath, zipBytes);
try {
  const t = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' });
  check('unzip -t accepts the archive', /No errors detected/.test(t), t.trim().split('\n').pop());
  const l = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
  check('archive lists every figure', entries.every(e => l.includes(e.name)), entries.length + ' names');
  const extractDir = path.join(OUT, 'unzipped');
  fs.rmSync(extractDir, { recursive: true, force: true });
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', extractDir]);
  const back = fs.readFileSync(path.join(extractDir, entries[0].name));
  check('extracted file is byte-identical', Buffer.compare(back, Buffer.from(entries[0].data)) === 0,
        back.length + ' bytes');
} catch (e) {
  check('unzip -t accepts the archive', false, String(e.message).slice(0, 200));
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
