// A small Obsidian plugin host. It loads a plugin folder (manifest.json + main.js + optional styles.css)
// and maps the calls most plugins make onto FgSNotes. The markdown parser is not replaced: a post processor
// only receives the preview element after the app has already rendered it.
(function () {
    const fill = (text, vars) => vars ? Object.keys(vars).reduce((out, name) => out.split('{' + name + '}').join(String(vars[name])), text) : text;
    const tr = (key, vars) => (typeof t === 'function' ? t(key, vars) : fill(key, vars));

    function toCommonJs(source) {
        let code = String(source || '');
        if (!/\b(import|export)\b/.test(code)) return code;
        code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]obsidian['"]\s*;?/g, (_, names) => `const {${names}} = require('obsidian');`);
        code = code.replace(/import\s+(\w+)\s*from\s*['"]obsidian['"]\s*;?/g, (_, name) => `const ${name} = require('obsidian');`);
        code = code.replace(/export\s+default\s+/g, 'module.exports = ');
        if (/\bimport\s+/.test(code) || /\bexport\s+/.test(code)) throw new Error(tr('Плагин Obsidian импортирует модули, которых здесь нет. Нужен собранный main.js, которому достаточно obsidian.'));
        return code;
    }

    function loadClass(source, obsidian) {
        const module = { exports: {} };
        const require = name => {
            if (name === 'obsidian') return obsidian;
            throw new Error(tr('Плагин Obsidian импортирует модули, которых здесь нет. Нужен собранный main.js, которому достаточно obsidian.'));
        };
        const fn = new Function('require', 'module', 'exports', toCommonJs(source));
        fn(require, module, module.exports);
        const exported = module.exports && (module.exports.__esModule && module.exports.default ? module.exports.default : (module.exports.default || module.exports));
        if (typeof exported !== 'function') throw new Error(tr('Плагин Obsidian не экспортирует класс.'));
        return exported;
    }

    // Files picked together, or a folder listing: manifest.json and main.js are required, styles.css is optional.
    function bundleFromFiles(entries) {
        const list = entries || [];
        const named = name => list.find(entry => new RegExp('(?:^|/)' + name + '$').test(String(entry.name || '').replace(/\\/g, '/')));
        const manifestEntry = named('manifest.json');
        const mainEntry = named('main.js');
        if (!manifestEntry || !mainEntry) return null;
        let manifest;
        try { manifest = JSON.parse(String(manifestEntry.text || manifestEntry.data || '')); } catch { return null; }
        if (!manifest || typeof manifest !== 'object') return null;
        const id = String(manifest.id || 'plugin').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80) || 'plugin';
        const css = named('styles.css');
        return { id, manifest, main: String(mainEntry.text || mainEntry.data || ''), css: css ? String(css.text || css.data || '') : '' };
    }

    function elementOf(tag) {
        if (typeof document === 'undefined') return { textContent: '', className: '', append() {}, replaceChildren() {}, remove() {}, addEventListener() {}, removeEventListener() {}, empty() { return this; }, setText() { return this; }, createEl() { return elementOf('div'); }, createDiv(opts) { return this.createEl('div', opts); } };
        const node = document.createElement(tag || 'div');
        node.empty = () => { node.replaceChildren(); return node; };
        node.setText = text => { node.textContent = text == null ? '' : String(text); return node; };
        node.createEl = (name, opts = {}) => {
            const child = elementOf(name);
            if (opts.cls) child.className = opts.cls;
            if (opts.text != null) child.textContent = String(opts.text);
            node.append(child);
            return child;
        };
        node.createDiv = opts => node.createEl('div', opts);
        return node;
    }

    function createRuntime(hooks) {
        const notes = () => (hooks.notes ? hooks.notes() : []);
        const editor = hooks.editor || { get: () => '', set() {}, insert() {}, selection: () => '' };
        const commands = [];
        const cleanups = [];

        class Component {
            constructor() { this._clean = []; }
            register(fn) { if (typeof fn === 'function') this._clean.push(fn); return fn; }
            registerDomEvent(el, type, fn) {
                if (!el || !el.addEventListener) return;
                el.addEventListener(type, fn);
                this.register(() => el.removeEventListener(type, fn));
            }
            registerInterval(fn, ms) {
                const id = setInterval(fn, ms);
                this.register(() => clearInterval(id));
                return id;
            }
            registerEvent() { return null; }
            load() {}
            unload() {
                const list = this._clean.splice(0);
                list.forEach(fn => { try { fn(); } catch { /* a plugin cleanup can fail on the way out */ } });
            }
            onunload() {}
        }

        class TFile {
            constructor(note) {
                const title = String((note && note.title) || 'note.md');
                this.path = /\.(md|markdown|txt)$/i.test(title) ? title : `${title}.md`;
                this.name = this.path.split('/').pop();
                this.basename = this.name.replace(/\.[^.]+$/, '');
                this.extension = (this.name.match(/\.([^.]+)$/) || [, 'md'])[1];
                this.id = note && note.id;
                this._content = note && note.content ? String(note.content) : '';
            }
        }
        const files = () => notes().map(note => new TFile(note));

        class Plugin extends Component {
            constructor(app, manifest) {
                super();
                this.app = app;
                this.manifest = manifest || {};
            }
            async onload() {}
            addRibbonIcon(icon, title, callback) {
                if (hooks.addButton) hooks.addButton({ title: String(title || this.manifest.name || 'Obsidian'), icon: 'sparkles', run: () => { try { callback(); } catch (error) { console.error(error); } } });
            }
            addCommand(command) {
                if (!command) return;
                commands.push(command);
                const run = () => {
                    try {
                        if (typeof command.callback === 'function') command.callback();
                        else if (typeof command.checkCallback === 'function' && command.checkCallback(true)) command.checkCallback(false);
                    } catch (error) { console.error(error); }
                };
                if (hooks.addButton) hooks.addButton({ title: String(command.name || command.id || 'Command'), icon: 'sparkles', run });
            }
            addStatusBarItem() {
                const el = elementOf('span');
                el.className = 'obsidian-status';
                if (typeof document !== 'undefined') {
                    const bar = document.querySelector('.status-bar');
                    if (bar) bar.append(el);
                }
                this.register(() => el.remove && el.remove());
                return el;
            }
            registerMarkdownPostProcessor(fn) {
                if (!hooks.onPreview || typeof fn !== 'function') return;
                hooks.onPreview(root => {
                    const file = app.workspace.getActiveFile();
                    fn(root, { sourcePath: file ? file.path : '' });
                });
            }
            async loadData() { return hooks.storage ? hooks.storage.get('data', {}) : {}; }
            async saveData(data) { if (hooks.storage) hooks.storage.set('data', data); }
            addSettingTab(tab) { this._settings = tab; }
        }

        class Notice {
            constructor(message) { if (hooks.notify) hooks.notify(typeof message === 'string' ? message : (message && message.message) || ''); }
        }
        class PluginSettingTab {
            constructor(app, plugin) {
                this.app = app;
                this.plugin = plugin;
                this.containerEl = elementOf('div');
            }
            display() {}
            hide() {}
        }
        class Setting {
            constructor(container) { this.containerEl = container; }
            setName() { return this; }
            setDesc() { return this; }
            setClass() { return this; }
            addText(cb) { if (cb) cb({ setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; } }); return this; }
            addTextArea(cb) { return this.addText(cb); }
            addToggle(cb) { if (cb) cb({ setValue() { return this; }, onChange() { return this; } }); return this; }
            addDropdown(cb) { if (cb) cb({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
            addButton(cb) { if (cb) cb({ setButtonText() { return this; }, setIcon() { return this; }, onClick() { return this; } }); return this; }
        }
        class Modal {
            constructor(app) {
                this.app = app;
                this.titleEl = { _text: '', setText: text => { this._text = String(text); } };
                this.contentEl = elementOf('div');
            }
            open() {
                if (!hooks.modal) { if (this.onOpen) this.onOpen(); return; }
                const box = hooks.modal({ title: this.titleEl._text || (this.manifest && this.manifest.name) || '' });
                this.contentEl = box.body;
                this._close = box.close;
                if (this.onOpen) this.onOpen();
            }
            close() { if (this._close) this._close(); if (this.onClose) this.onClose(); }
        }

        const app = {
            vault: {
                getMarkdownFiles: files,
                getFiles: files,
                getAbstractFileByPath(path) { return files().find(file => file.path === path) || null; },
                async read(file) { return file && file._content ? file._content : ''; },
                async cachedRead(file) { return app.vault.read(file); },
                async create(name, content) {
                    if (hooks.createDocument) hooks.createDocument(String(name || 'note.md'), String(content || ''));
                    return new TFile({ title: name, content });
                },
                async modify(file, content) {
                    if (file && file.id != null && hooks.openDocument) hooks.openDocument(file.id);
                    editor.set(String(content || ''));
                },
                adapter: {
                    async read(path) { const file = app.vault.getAbstractFileByPath(path); return file ? file._content : ''; },
                    async exists() { return false; },
                    async write() { throw new Error(tr('Запись файлов с диска из плагина Obsidian недоступна.')); }
                }
            },
            workspace: {
                getActiveFile() {
                    const list = notes();
                    const active = list.find(note => note.active) || list[0];
                    return active ? new TFile(active) : null;
                },
                getActiveViewOfType() {
                    return {
                        file: app.workspace.getActiveFile(),
                        editor: {
                            getValue: () => editor.get(),
                            setValue: text => editor.set(text),
                            replaceSelection: text => editor.insert(text),
                            getSelection: () => editor.selection()
                        },
                        getViewType: () => 'markdown'
                    };
                },
                on() { return { unload() {} }; }
            },
            commands: {
                list: () => commands.slice(),
                executeCommandById(id) {
                    const command = commands.find(item => item.id === id);
                    if (!command) return false;
                    if (typeof command.callback === 'function') command.callback();
                    else if (typeof command.checkCallback === 'function') command.checkCallback(false);
                    return true;
                }
            },
            keymap: { pushScope() {}, popScope() {} }
        };
        const obsidian = { Plugin, Notice, PluginSettingTab, TFile, Component, Modal, Setting, MarkdownView: class MarkdownView {}, MarkdownRenderer: { async render() {} } };

        return {
            app,
            obsidian,
            commands,
            cleanups,
            async start(source, manifest) {
                const Ctor = loadClass(source, obsidian);
                const plugin = new Ctor(app, manifest || {});
                plugin.manifest = Object.assign({}, manifest || {}, plugin.manifest);
                if (plugin.load) await plugin.load();
                if (plugin.onload) await plugin.onload();
                cleanups.push(() => { try { if (plugin.onunload) plugin.onunload(); } catch { /* leaving */ } try { plugin.unload(); } catch { /* leaving */ } });
                return plugin;
            }
        };
    }

    const api = { toCommonJs, loadClass, bundleFromFiles, createRuntime };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else window.FgsObsidian = api;
})();
