const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launcher, chooseDir, mergePath, install, remove, status } = require('../tui-command');

test('the launcher runs the editor with the app Node runtime', () => {
    const text = launcher({ platform: 'darwin', execPath: '/Apps/FgSNotes.app/Contents/MacOS/FgSNotes', tuiPath: "/Apps/O'Hara/tui.js" });
    assert.match(text, /ELECTRON_RUN_AS_NODE=1/);
    assert.match(text, /exec '\/Apps\/FgSNotes\.app\/Contents\/MacOS\/FgSNotes' '\/Apps\/O'\\''Hara\/tui\.js'/);
    const win = launcher({ platform: 'win32', execPath: 'C:\\Program Files\\FgSNotes.exe', tuiPath: 'C:\\Program Files\\resources\\tui.js' });
    assert.match(win, /ELECTRON_RUN_AS_NODE=1/);
    assert.match(win, /"C:\\Program Files\\FgSNotes.exe"/);
});

test('mac asks for a password only when /usr/local/bin is locked', () => {
    const dirs = ['/usr/local/bin', '/Users/me/.local/bin'];
    assert.deepEqual(chooseDir({
        platform: 'darwin', dirs, envPath: '/usr/local/bin:/usr/bin', canWrite: dir => dir !== '/usr/local/bin'
    }), { dir: '/usr/local/bin', elevated: true });
    assert.deepEqual(chooseDir({
        platform: 'darwin', dirs, envPath: '/usr/local/bin:/usr/bin', canWrite: () => true
    }), { dir: '/usr/local/bin', elevated: false });
});

test('install writes the command and remove deletes it', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-cmd-'));
    const bin = path.join(home, 'bin');
    const editor = path.join(home, 'tui.js');
    fs.writeFileSync(editor, '');
    const options = {
        fs, platform: 'linux', home, places: [bin], envPath: `${bin}:/usr/bin`,
        execPath: '/app/fgsnotes', tuiPath: editor
    };
    const placed = install(options);
    assert.equal(placed.ok, true);
    assert.equal(placed.onPath, true);
    const script = fs.readFileSync(path.join(bin, 'fgsnotes'), 'utf8');
    assert.match(script, /ELECTRON_RUN_AS_NODE=1/);
    assert.match(script, new RegExp(editor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(status(options).current, true);
    assert.equal(remove(options).removed, true);
    assert.equal(status(options).installed, false);
    fs.rmSync(home, { recursive: true, force: true });
});

test('a locked mac directory is installed through the password prompt', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-cmd-'));
    const editor = path.join(home, 'tui.js');
    const tmp = path.join(home, 'staging');
    fs.writeFileSync(editor, '');
    let command = '';
    const result = install({
        fs, platform: 'darwin', home, places: ['/usr/local/bin'], envPath: '/usr/local/bin',
        execPath: '/Apps/FgSNotes', tuiPath: editor, tmpFile: tmp, canWrite: () => false,
        elevate: line => { command = line; }
    });
    assert.equal(result.ok, true);
    assert.match(command, /cp '/);
    assert.match(command, /chmod 755 '\/usr\/local\/bin\/fgsnotes'/);
    assert.match(fs.readFileSync(tmp, 'utf8'), /ELECTRON_RUN_AS_NODE=1/);
    fs.rmSync(home, { recursive: true, force: true });
});

test('a missing editor is not installed', () => {
    const result = install({
        fs, platform: 'linux', home: '/tmp', places: ['/nowhere'], envPath: '',
        execPath: '/app', tuiPath: path.join(os.tmpdir(), 'missing-fgs-tui.js'), canWrite: () => true
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /не входит в эту сборку/);
});

test('windows path gains the command directory once', () => {
    const dir = 'C:\\Users\\me\\AppData\\Local\\FgSNotes\\bin';
    const next = mergePath('C:\\Windows', dir, 'win32');
    assert.equal(next, 'C:\\Windows;' + dir);
    assert.equal(mergePath(next, dir, 'win32'), next);
});
