// Bundles the live Markdown editor (CodeMirror 6) into src/live-editor.js. Run after changing live-editor/index.js.
const esbuild = require('esbuild');
const path = require('path');
esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'live-editor', 'index.js')],
    outfile: path.join(__dirname, '..', 'src', 'live-editor.js'),
    bundle: true, minify: true, format: 'iife', globalName: 'FgsLiveEditor', target: ['chrome110', 'safari16'], legalComments: 'none'
}).then(() => console.log('Live editor bundle ready: src/live-editor.js')).catch(() => process.exit(1));
