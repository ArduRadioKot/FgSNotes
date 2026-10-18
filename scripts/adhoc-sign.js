// electron-builder afterPack hook. The project is built without an Apple Developer ID ("identity": null), so electron-builder
// does not sign the app at all and the bundle keeps a broken signature (Electron's binary is signed, our resources are not).
// On Apple Silicon macOS refuses such an app once it was downloaded: "FgSNotes is damaged and can't be opened".
// An ad-hoc signature over the whole bundle makes it valid, so macOS only asks to confirm the first launch.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
    if (context.electronPlatformName !== 'darwin') return;
    const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
    console.log(`  • ad-hoc signed ${path.basename(app)}`);
};
