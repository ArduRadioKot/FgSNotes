const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toCommonJs, bundleFromFiles, createRuntime } = require('../src/obsidian-host');

test('an Obsidian folder needs a manifest and a main file', () => {
    assert.equal(bundleFromFiles([{ name: 'main.js', text: 'module.exports = class {}' }]), null);
    const bundle = bundleFromFiles([
        { name: 'demo/manifest.json', text: JSON.stringify({ id: 'demo.plugin', name: 'Demo', version: '1.2.0', description: 'A demo' }) },
        { name: 'demo/main.js', text: 'module.exports = class {}' },
        { name: 'demo/styles.css', text: '.x{color:red}' }
    ]);
    assert.equal(bundle.id, 'demo.plugin');
    assert.equal(bundle.manifest.name, 'Demo');
    assert.equal(bundle.css, '.x{color:red}');
});

test('a commonjs plugin and an export-default plugin both load onto the notes', async () => {
    const buttons = [];
    const notices = [];
    const runtime = createRuntime({
        notes: () => [{ id: 7, title: 'Лекция.md', content: 'Клетки делятся.', active: true }],
        editor: { get: () => 'Клетки делятся.', set() {}, insert() {}, selection: () => '' },
        notify: text => notices.push(text),
        addButton: spec => buttons.push(spec),
        onPreview() {},
        storage: { get: (_, fallback) => fallback, set() {} }
    });
    await runtime.start(`
        const { Plugin } = require('obsidian');
        module.exports = class extends Plugin {
            async onload() { this.addRibbonIcon('star', 'Звезда', () => {}); }
        };
    `, { id: 'ribbon', name: 'Ribbon' });
    assert.equal(buttons[0].title, 'Звезда');
    await runtime.start(toCommonJs(`
        import { Plugin, Notice } from 'obsidian';
        export default class Hello extends Plugin {
            async onload() {
                new Notice('готово');
                this.addCommand({ id: 'count', name: 'Счёт', callback: () => this._n = this.app.vault.getMarkdownFiles().length });
            }
        }
    `), { id: 'hello', name: 'Hello' });
    assert.equal(notices[0], 'готово');
    const count = buttons.find(button => button.title === 'Счёт');
    count.run();
    assert.equal(runtime.commands.find(command => command.id === 'count') != null, true);
    const files = runtime.app.vault.getMarkdownFiles();
    assert.equal(files[0].basename, 'Лекция');
    assert.equal(await runtime.app.vault.read(files[0]), 'Клетки делятся.');
});

test('a plugin cannot import other packages, and a post processor does not replace markdown', async () => {
    await assert.rejects(() => createRuntime({ notes: () => [] }).start(`import { x } from 'left-pad'; export default class {}`), /obsidian/);
    const seen = [];
    const runtime = createRuntime({
        notes: () => [],
        onPreview: fn => seen.push(fn)
    });
    await runtime.start(`
        const { Plugin } = require('obsidian');
        module.exports = class extends Plugin {
            onload() { this.registerMarkdownPostProcessor(el => { el.dataset.touched = '1'; }); }
        };
    `, { id: 'pp' });
    assert.equal(seen.length, 1);
    const root = { dataset: {}, sourcePath: '' };
    seen[0](root);
    assert.equal(root.dataset.touched, '1');
    assert.equal(runtime.obsidian.MarkdownRenderer != null, true);
});
