// Copies the QR code generator from node_modules into src/vendor/qrcode. Run after updating qrcode-generator.
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'src', 'vendor', 'qrcode');
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'node_modules', 'qrcode-generator', 'dist', 'qrcode.js'), path.join(target, 'qrcode.js'));
console.log('QR generator copied to src/vendor/qrcode');
