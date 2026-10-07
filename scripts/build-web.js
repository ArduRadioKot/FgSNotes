// Builds the web bundle for Capacitor: a copy of src/ with index.html, without desktop-only files.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'src');
const target = path.join(root, 'www');
const skip = new Set(['icon.icns', 'MarkDownEditor.html']);
const skipDirs = new Set(['liquid-glass']);          // the glass playground is a desktop tool
const skipFiles = new Set(['liquid-glass/liquid-glass.css']);

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

function copy(dir, relative = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = path.posix.join(relative, entry.name);
        if (skip.has(entry.name) && !relative) continue;
        if (entry.isDirectory()) {
            if (skipDirs.has(rel)) continue;
            fs.mkdirSync(path.join(target, rel), { recursive: true });
            copy(path.join(dir, entry.name), rel);
        } else if (!skipFiles.has(rel)) {
            fs.copyFileSync(path.join(dir, entry.name), path.join(target, rel));
        }
    }
}
copy(source);

// Native shell: the page is index.html and has no desktop-only scripts or styles.
let html = fs.readFileSync(path.join(source, 'MarkDownEditor.html'), 'utf8');
html = html
    .replace(/\s*<link rel="stylesheet" href="liquid-glass\/liquid-glass.css" \/>/, '')
    .replace(/\s*<script src="liquid-glass\/[a-z-]+\.js"><\/script>/g, '');
fs.writeFileSync(path.join(target, 'index.html'), html);
console.log(`Web bundle ready: ${path.relative(root, target)}/ (${fs.readdirSync(target).length} entries)`);
