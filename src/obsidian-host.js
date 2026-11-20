// A small Obsidian plugin host. It loads a plugin folder (manifest.json + main.js + optional styles.css)
// and maps the calls most plugins make onto FgSNotes. The markdown parser is not replaced: a post processor
// only receives the preview element after the app has already rendered it.
(function () {
    const fill = (text, vars) => vars ? Object.keys(vars).reduce((out, name) => out.split('{' + name + '}').join(String(vars[name])), text) : text;
    const tr = (key, vars) => (typeof t === 'function' ? t(key, vars) : fill(key, vars));

    function toCommonJs(source) {
        let code = String(source || '');
        // Community builds (Excalidraw and others) are already CommonJS; the words "import"/"export"
        // still appear inside the minified text, so do not treat them as ESM.
        if (/\brequire\s*\(/.test(code) && /\b(module\.exports|exports\.|exports\s*=)/.test(code)) return code;
        if (!/\b(import|export)\b/.test(code)) return code;
        code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]obsidian['"]\s*;?/g, (_, names) => `const {${names}} = require('obsidian');`);
        code = code.replace(/import\s+(\w+)\s*from\s*['"]obsidian['"]\s*;?/g, (_, name) => `const ${name} = require('obsidian');`);
        code = code.replace(/export\s+default\s+/g, 'module.exports = ');
        if (/\bimport\s+/.test(code) || /\bexport\s+/.test(code)) throw new Error(tr('Плагин Obsidian импортирует модули, которых здесь нет. Нужен собранный main.js, которому достаточно obsidian.'));
        return code;
    }

    // Obsidian ships CodeMirror with the app; community builds (Excalidraw) require those packages.
    // Provide inert stand-ins so the plugin class can load; missing API still surfaces as an onload error.
    function stubModule() {
        const self = new Proxy(function Stub() { return self; }, {
            get(_target, prop) {
                if (prop === '__esModule') return true;
                if (prop === 'default') return self;
                if (prop === 'prototype') return {};
                if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf') return () => '';
                return self;
            },
            apply() { return self; },
            construct() { return self; }
        });
        return self;
    }
    const STUB_PACKAGES = new Set([
        '@codemirror/view', '@codemirror/state', '@codemirror/language', '@codemirror/commands',
        '@lezer/common', '@lezer/highlight', '@lezer/lr'
    ]);

    function loadClass(source, obsidian) {
        const module = { exports: {} };
        const require = name => {
            if (name === 'obsidian') return obsidian;
            if (STUB_PACKAGES.has(name)) return stubModule();
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

    function patchDom() {
        if (typeof Element === 'undefined' || Element.prototype.hasClass) return;
        Element.prototype.hasClass = function (name) { return this.classList.contains(name); };
        Element.prototype.addClass = function (...names) { this.classList.add(...names); return this; };
        Element.prototype.removeClass = function (...names) { this.classList.remove(...names); return this; };
        Element.prototype.toggleClass = function (name, on) { this.classList.toggle(name, on); return this; };
        Element.prototype.setAttrs = function (attrs) {
            Object.keys(attrs || {}).forEach(key => {
                if (attrs[key] == null) this.removeAttribute(key);
                else this.setAttribute(key, String(attrs[key]));
            });
            return this;
        };
        if (!Element.prototype.empty) Element.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
        if (!Element.prototype.setText) Element.prototype.setText = function (text) { this.textContent = text == null ? '' : String(text); return this; };
        if (!Element.prototype.createEl) {
            Element.prototype.createEl = function (name, opts = {}) {
                const child = document.createElement(name || 'div');
                if (opts.cls) child.className = opts.cls;
                if (opts.text != null) child.textContent = String(opts.text);
                if (opts.attr) child.setAttrs(opts.attr);
                this.append(child);
                return child;
            };
            Element.prototype.createDiv = function (opts) { return this.createEl('div', opts); };
            Element.prototype.createSpan = function (opts) { return this.createEl('span', opts); };
        }
        if (typeof document !== 'undefined' && document.body && !document.body.hasClass) {
            // body may already be an Element; prototypes cover it after the patch above.
        }
    }

    function elementOf(tag) {
        if (typeof document === 'undefined') {
            const node = {
                textContent: '', className: '', children: [],
                append(...nodes) { this.children.push(...nodes); },
                replaceChildren() { this.children = []; },
                remove() {},
                addEventListener() {},
                removeEventListener() {},
                classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
                hasClass(name) { return false; },
                addClass() { return this; },
                removeClass() { return this; },
                empty() { this.children = []; return this; },
                setText(text) { this.textContent = text == null ? '' : String(text); return this; },
                createEl() { return elementOf('div'); },
                createDiv(opts) { return this.createEl('div', opts); }
            };
            return node;
        }
        patchDom();
        const node = document.createElement(tag || 'div');
        node.empty = () => { node.replaceChildren(); return node; };
        node.setText = text => { node.textContent = text == null ? '' : String(text); return node; };
        node.createEl = (name, opts = {}) => {
            const child = elementOf(name);
            if (opts.cls) child.className = opts.cls;
            if (opts.text != null) child.textContent = String(opts.text);
            if (opts.attr && child.setAttrs) child.setAttrs(opts.attr);
            node.append(child);
            return child;
        };
        node.createDiv = opts => node.createEl('div', opts);
        return node;
    }

    function createRuntime(hooks) {
        patchDom();
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

        const viewFactories = new Map();
        const openLeaves = [];

        class ItemView extends Component {
            constructor(leaf) {
                super();
                this.leaf = leaf || null;
                this.containerEl = elementOf('div');
                this.containerEl.className = 'view-content';
                this.contentEl = this.containerEl;
                this.app = app;
            }
            getViewType() { return 'item'; }
            getDisplayText() { return 'View'; }
            getIcon() { return 'file'; }
            async onOpen() {}
            async onClose() {}
            async setState() {}
            getState() { return {}; }
        }

        class TextFileView extends ItemView {
            constructor(leaf) {
                super(leaf);
                this.file = null;
                this.data = '';
            }
            getViewData() { return this.data; }
            setViewData(data) { this.data = data == null ? '' : String(data); }
            clear() { this.data = ''; }
            async save() {
                if (!this.file) return;
                await app.vault.modify(this.file, this.getViewData());
            }
        }

        class WorkspaceLeaf {
            constructor() {
                this.view = null;
                this._tab = null;
            }
            getViewState() {
                return { type: this.view && this.view.getViewType ? this.view.getViewType() : 'empty', state: this.view && this.view.getState ? this.view.getState() : {} };
            }
            async setViewState(state = {}) {
                const type = String(state.type || '');
                const factory = viewFactories.get(type);
                if (!factory) {
                    this.view = null;
                    return this;
                }
                if (this.view && this.view.onClose) {
                    try { await this.view.onClose(); } catch { /* previous view leaving */ }
                }
                if (this.view && this.view.unload) {
                    try { this.view.unload(); } catch { /* previous view leaving */ }
                }
                const view = factory(this);
                this.view = view;
                if (view && view.setState) await view.setState(state.state || {}, state);
                if (hooks.openTab) {
                    const title = () => (view && view.getDisplayText ? view.getDisplayText() : type) || type;
                    this._tab = hooks.openTab({
                        key: `obsidian-view:${type}:${openLeaves.indexOf(this)}`,
                        title: title(),
                        icon: (view && view.getIcon && view.getIcon()) || 'file',
                        render: host => {
                            host.replaceChildren();
                            if (view && view.containerEl) host.append(view.containerEl);
                        },
                        onClose: () => {
                            Promise.resolve(view && view.onClose && view.onClose()).catch(() => {});
                            if (view && view.unload) view.unload();
                            this.view = null;
                            this._tab = null;
                        }
                    });
                }
                if (view && view.onOpen) await view.onOpen();
                app.workspace.activeLeaf = this;
                return this;
            }
            openFile = async (file) => {
                if (!file) return this;
                if (this.view && typeof this.view.setViewData === 'function') {
                    this.view.file = file;
                    this.view.setViewData(await app.vault.read(file), false);
                }
                return this;
            };
            detach() {
                if (this._tab && this._tab.close) this._tab.close();
                this.view = null;
                this._tab = null;
                const index = openLeaves.indexOf(this);
                if (index >= 0) openLeaves.splice(index, 1);
            }
        }

        class Plugin extends Component {
            constructor(appRef, manifest) {
                super();
                this.app = appRef;
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
            registerView(type, factory) {
                if (!type || typeof factory !== 'function') return;
                viewFactories.set(String(type), factory);
                this.register(() => viewFactories.delete(String(type)));
            }
            registerExtensions(extensions, viewType) {
                // Drawing files open through registerView; extensions are recorded only.
                this._extensions = (this._extensions || []).concat({ extensions, viewType });
            }
            registerEditorExtension() {}
            registerEditorSuggest() {}
            registerHoverLinkSource() {}
            registerEvent() { return null; }
            registerObsidianProtocolHandler() {}
            registerMarkdownCodeBlockProcessor() {}
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
                    async read(path) {
                        const file = app.vault.getAbstractFileByPath(path);
                        return file ? file._content : '';
                    },
                    async exists(path) {
                        return !!app.vault.getAbstractFileByPath(path);
                    },
                    async write(path, data) {
                        const name = String(path || 'note.md');
                        const content = data == null ? '' : String(data);
                        const existing = app.vault.getAbstractFileByPath(name);
                        if (existing) {
                            existing._content = content;
                            if (existing.id != null && hooks.openDocument) hooks.openDocument(existing.id);
                            editor.set(content);
                            return;
                        }
                        if (hooks.createDocument) hooks.createDocument(name, content);
                    },
                    async mkdir() {},
                    async remove() {},
                    async list() { return { files: files().map(file => file.path), folders: [] }; },
                    getName() { return 'FgSNotes'; },
                    getBasePath() { return ''; }
                }
            },
            workspace: {
                activeLeaf: null,
                getActiveFile() {
                    const list = notes();
                    const active = list.find(note => note.active) || list[0];
                    return active ? new TFile(active) : null;
                },
                getActiveViewOfType(type) {
                    if (app.workspace.activeLeaf && app.workspace.activeLeaf.view) {
                        const view = app.workspace.activeLeaf.view;
                        if (!type || (view.getViewType && view.getViewType() === type) || view instanceof type) return view;
                    }
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
                getLeaf(newLeaf) {
                    if (!newLeaf && app.workspace.activeLeaf) return app.workspace.activeLeaf;
                    const leaf = new WorkspaceLeaf();
                    openLeaves.push(leaf);
                    app.workspace.activeLeaf = leaf;
                    return leaf;
                },
                getMostRecentLeaf() { return app.workspace.activeLeaf || app.workspace.getLeaf(true); },
                getLeavesOfType(type) {
                    return openLeaves.filter(leaf => leaf.view && leaf.view.getViewType && leaf.view.getViewType() === type);
                },
                async openLinkText(linktext) {
                    const path = String(linktext || '').split('|')[0].split('#')[0].trim();
                    if (!path) return;
                    const file = app.vault.getAbstractFileByPath(path) || app.vault.getAbstractFileByPath(path.endsWith('.md') ? path : `${path}.md`);
                    const leaf = app.workspace.getLeaf(false);
                    if (file) await leaf.openFile(file);
                    else if (hooks.createDocument) {
                        hooks.createDocument(path.endsWith('.md') ? path : `${path}.md`, '');
                        const created = app.vault.getAbstractFileByPath(path) || app.vault.getAbstractFileByPath(`${path}.md`);
                        if (created) await leaf.openFile(created);
                    }
                },
                on() { return { unload() {} }; },
                off() {},
                trigger() {},
                onLayoutReady(fn) { if (typeof fn === 'function') setTimeout(fn, 0); },
                iterateAllLeaves(fn) { openLeaves.forEach(leaf => fn(leaf)); },
                containerEl: typeof document !== 'undefined' ? document.body : elementOf('div'),
                rootSplit: null
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
            keymap: { pushScope() {}, popScope() {} },
            metadataCache: {
                getFileCache() { return null; },
                on() { return { unload() {} }; },
                getFirstLinkpathDest(linkpath) {
                    const path = String(linkpath || '');
                    return app.vault.getAbstractFileByPath(path) || app.vault.getAbstractFileByPath(path.endsWith('.md') ? path : `${path}.md`);
                }
            }
        };
        const MarkdownView = class MarkdownView extends TextFileView {
            getViewType() { return 'markdown'; }
        };
        class TFolder {
            constructor(path) {
                this.path = String(path || '');
                this.name = this.path.split('/').pop() || '';
                this.children = [];
            }
            isRoot() { return !this.path || this.path === '/'; }
        }
        class Menu {
            constructor() { this.items = []; }
            addItem(cb) {
                const item = { setTitle() { return this; }, setIcon() { return this; }, onClick() { return this; }, setSection() { return this; } };
                if (cb) cb(item);
                this.items.push(item);
                return this;
            }
            addSeparator() { return this; }
            showAtMouseEvent() { return this; }
            showAtPosition() { return this; }
        }
        class FuzzySuggestModal extends Modal {
            setPlaceholder() { return this; }
            getItems() { return []; }
            getItemText(item) { return String(item); }
            onChooseItem() {}
        }
        class Scope {
            register() { return this; }
            unregister() { return this; }
        }
        class BaseComponent {
            constructor() { this.disabled = false; }
            then(cb) { if (cb) cb(this); return this; }
            setDisabled(v) { this.disabled = !!v; return this; }
        }
        class ValueComponent extends BaseComponent {
            constructor() { super(); this._value = null; }
            getValue() { return this._value; }
            setValue(v) { this._value = v; return this; }
            onChange() { return this; }
        }
        class AbstractInputSuggest extends Component {
            constructor(appRef, inputEl) { super(); this.app = appRef; this.inputEl = inputEl; }
            open() {}
            close() {}
            setValue() { return this; }
            getValue() { return ''; }
        }
        class MarkdownRenderChild extends Component {
            constructor(containerEl) { super(); this.containerEl = containerEl || elementOf('div'); }
        }
        class FileView extends ItemView {
            constructor(leaf) { super(leaf); this.file = null; }
            getViewType() { return 'file'; }
            async onLoadFile() {}
            async onUnloadFile() {}
        }
        class EditableFileView extends TextFileView {
            getViewType() { return 'editable-file'; }
        }
        const stubClass = (Base = Component) => class extends Base {};
        const obsidianBase = {
            Plugin, Notice, PluginSettingTab, TFile, TFolder, Component, Modal, Setting, ItemView, TextFileView, FileView, EditableFileView, WorkspaceLeaf,
            MarkdownView, MarkdownRenderer: { async renderMarkdown() {}, async render() {} }, MarkdownRenderChild,
            Menu, FuzzySuggestModal, Scope, BaseComponent, ValueComponent, AbstractInputSuggest,
            HoverPopover: stubClass(), PopoverSuggest: stubClass(), SuggestModal: class extends Modal {},
            EditorSuggest: stubClass(), ViewPlugin: stubClass(), Task: stubClass(),
            normalizePath: p => String(p || '').replace(/\\/g, '/'),
            requestUrl: async () => ({ status: 404, json: null, text: '', arrayBuffer: new ArrayBuffer(0) }),
            debounce: (fn) => Object.assign((...args) => fn(...args), { cancel() {} }),
            getLanguage: () => (typeof window !== 'undefined' && window.FgsI18n && window.FgsI18n.language === 'ru' ? 'ru' : 'en'),
            setIcon() {},
            getIcon: () => null,
            getIconIds: () => [],
            moment: (() => {
                const m = () => ({ format: () => '', add() { return this; }, subtract() { return this; }, valueOf: () => Date.now(), toDate: () => new Date() });
                m.locale = () => {};
                return m;
            })(),
            Platform: { isDesktop: true, isMobile: false, isDesktopApp: true, isPhone: false, isTablet: false, isMacOS: true, isWin: false, isLinux: false }
        };
        // Unknown named exports become inert classes so community builds (Excalidraw) can evaluate.
        const obsidian = new Proxy(obsidianBase, {
            get(target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop !== 'string' || prop.startsWith('_')) return undefined;
                const made = stubClass(prop.includes('Modal') ? Modal : prop.includes('View') ? ItemView : Component);
                target[prop] = made;
                return made;
            }
        });

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
