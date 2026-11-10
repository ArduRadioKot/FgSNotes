// Gives the phone apps the version from package.json: versionName/versionCode in the Android project and
// MARKETING_VERSION/CURRENT_PROJECT_VERSION in the Xcode project. Part of `npm run cap:sync`.
// The build number is major*10000 + minor*100 + patch, so it only ever grows with the version.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const [major, minor, patch] = version.split(/[.-]/).map(Number);
if (![major, minor, patch].every(Number.isInteger)) throw new Error(`Cannot read version "${version}"`);
const build = major * 10000 + minor * 100 + patch;
const name = `${major}.${minor}.${patch}`;

function rewrite(file, replacements) {
    const full = path.join(root, file);
    let text = fs.readFileSync(full, 'utf8');
    for (const [pattern, value] of replacements) {
        if (!pattern.test(text)) throw new Error(`${file}: nothing matches ${pattern}`);
        text = text.replace(pattern, value);
    }
    fs.writeFileSync(full, text);
}
rewrite('android/app/build.gradle', [[/versionCode \d+/, `versionCode ${build}`], [/versionName "[^"]*"/, `versionName "${name}"`]]);
rewrite('ios/App/App.xcodeproj/project.pbxproj', [[/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${name};`], [/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`]]);
console.log(`Phone apps set to version ${name} (build ${build})`);
