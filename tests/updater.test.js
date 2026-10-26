const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, pickAsset, installPlan, describeRelease } = require('../updater');

const assets = [
    { name: 'FgSNotes-2.5.5-arm64.dmg' },
    { name: 'FgSNotes-2.5.5-x64.dmg' },
    { name: 'FgSNotes-2.5.5.AppImage' },
    { name: 'fgsnotes-2.5.5.tar.gz' },
    { name: 'FgSNotes-Setup-2.5.5.exe' },
    { name: 'FgSNotes-Portable-2.5.5.exe' }
];

test('versions compare numerically and ignore a leading v', () => {
    assert.equal(compareVersions('2.5.6', '2.5.5'), 1);
    assert.equal(compareVersions('v2.5.5', '2.5.5'), 0);
    assert.equal(compareVersions('2.9.0', '2.10.0'), -1);
    assert.equal(compareVersions('1.0', '1.0.1'), -1);
});

test('the asset matches the computer, including a portable Windows build', () => {
    assert.equal(pickAsset(assets, { platform: 'darwin', arch: 'arm64' }).name, 'FgSNotes-2.5.5-arm64.dmg');
    assert.equal(pickAsset(assets, { platform: 'darwin', arch: 'x64' }).name, 'FgSNotes-2.5.5-x64.dmg');
    assert.equal(pickAsset(assets, { platform: 'win32', arch: 'x64' }).name, 'FgSNotes-Setup-2.5.5.exe');
    assert.equal(pickAsset(assets, { platform: 'win32', arch: 'x64', portable: true }).name, 'FgSNotes-Portable-2.5.5.exe');
    assert.equal(pickAsset(assets, { platform: 'linux', arch: 'x64', appImage: true }).name, 'FgSNotes-2.5.5.AppImage');
    assert.equal(pickAsset([], { platform: 'darwin', arch: 'arm64' }), null);
});

test('a newer release is offered with an install plan the running app can apply', () => {
    const info = describeRelease({ tag_name: 'v2.6.0', body: 'Исправления', html_url: 'https://github.com/ArduRadioKot/FgSNotes/releases/tag/v2.6.0', assets }, '2.5.6', { platform: 'darwin', arch: 'arm64' });
    assert.equal(info.available, true);
    assert.equal(info.latest, '2.6.0');
    assert.equal(info.asset.name, 'FgSNotes-2.5.5-arm64.dmg');
    assert.equal(installPlan({ platform: 'darwin' }, info.asset), 'mac');
    assert.equal(installPlan({ platform: 'linux', appImage: true }, { name: 'FgSNotes-2.5.5.AppImage' }), 'appimage');
    assert.equal(installPlan({ platform: 'linux' }, { name: 'fgsnotes-2.5.5.tar.gz' }), 'manual');
    assert.equal(describeRelease({ tag_name: 'v2.5.6', assets }, '2.5.6', { platform: 'darwin', arch: 'arm64' }).available, false);
});
