// Copies KaTeX (script, stylesheet, woff2 fonts only) from node_modules into src/vendor/katex. Run after updating katex.
const fs = require('fs');
const path = require('path');
const dist = path.join(__dirname, '..', 'node_modules', 'katex', 'dist');
const target = path.join(__dirname, '..', 'src', 'vendor', 'katex');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(dist, 'katex.min.js'), path.join(target, 'katex.min.js'));
// Chromium and WebKit both read woff2, so the woff/ttf fallbacks are dropped.
const css = fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf8')
    .replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\),url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g, '');
fs.writeFileSync(path.join(target, 'katex.min.css'), css);
for (const file of fs.readdirSync(path.join(dist, 'fonts'))) {
    if (file.endsWith('.woff2')) fs.copyFileSync(path.join(dist, 'fonts', file), path.join(target, 'fonts', file));
}
console.log('KaTeX copied to src/vendor/katex');
