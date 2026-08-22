/* Angles Maker — fold the app into one HTML file.
   ES modules cannot load from file://, but a single document with everything
   inline opens by double-click, with no server and nothing to install. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) =>
  '<style>\n' + read(href) + '</style>');

html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const code = read(src);
  if (code.includes('</' + 'script>')) throw new Error(src + ' contains a script end tag');
  return '<script>\n' + code + '</script>';
});

html = html.replace('<title>Angles Maker</title>',
  '<title>Angles Maker</title>\n<!-- single-file build; edit the sources and re-run tools/bundle.js -->');

const dir = path.join(root, 'dist');
fs.mkdirSync(dir, { recursive: true });
/* Two copies of the same bytes: index.html is what a web host serves at /, and
   angles-maker.html is what someone right-clicks and saves to run offline. */
fs.writeFileSync(path.join(dir, 'angles-maker.html'), html);
fs.writeFileSync(path.join(dir, 'index.html'), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log('wrote dist/index.html and dist/angles-maker.html (' + kb + ' KB each, no external files)');
if (/(src|href)="(?!data:)[^"]+"/.test(html.replace(/<a [^>]*>/g, ''))) {
  console.warn('warning: a reference to an external file survived bundling');
}
