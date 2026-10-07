// Live Markdown editor (CodeMirror 6). Formatting is applied as you type: headings, emphasis, links, lists, tasks and
// code blocks render in place, and the Markdown marks are hidden everywhere except around the cursor.
// `attach` makes it look like the original <textarea> to the rest of the app (value, selection, events).
import { EditorState } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';

const hide = Decoration.replace({});
const mark = className => Decoration.mark({ class: className });
const lineClass = className => Decoration.line({ class: className });

class BulletWidget extends WidgetType {
    eq() { return true; }
    toDOM() { const dot = document.createElement('span'); dot.className = 'cm-bullet'; dot.textContent = '•'; return dot; }
}
class RuleWidget extends WidgetType {
    eq() { return true; }
    toDOM() { const rule = document.createElement('span'); rule.className = 'cm-hr'; return rule; }
}
class TaskWidget extends WidgetType {
    constructor(checked) { super(); this.checked = checked; }
    eq(other) { return other.checked === this.checked; }
    toDOM(view) {
        const box = document.createElement('span');
        box.className = 'cm-task' + (this.checked ? ' cm-task-on' : '');
        box.setAttribute('role', 'checkbox');
        box.setAttribute('aria-checked', String(this.checked));
        box.addEventListener('mousedown', event => event.preventDefault());
        box.addEventListener('click', event => {
            event.preventDefault();
            const from = view.posAtDOM(box);
            view.dispatch({ changes: { from: from + 1, to: from + 2, insert: this.checked ? ' ' : 'x' } });
        });
        return box;
    }
    ignoreEvent() { return true; }
}

function buildDecorations(view) {
    const { state } = view;
    const doc = state.doc;
    const selection = state.selection.ranges;
    const near = (from, to) => selection.some(range => range.from <= to && range.to >= from);
    const lineActive = (from, to) => {
        const first = doc.lineAt(from).number, last = doc.lineAt(Math.min(to, doc.length)).number;
        return selection.some(range => doc.lineAt(range.from).number <= last && doc.lineAt(range.to).number >= first);
    };
    const ranges = [];
    const add = (from, to, decoration) => { if (to >= from) ranges.push(decoration.range(from, to)); };
    const addLine = (pos, className) => ranges.push(lineClass(className).range(doc.lineAt(pos).from));
    const eachLine = (from, to, className) => {
        for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) ranges.push(lineClass(className).range(doc.line(n).from));
    };

    for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
            from, to,
            enter(node) {
                const name = node.name;
                let match;
                if ((match = /^ATXHeading([1-6])$/.exec(name))) { addLine(node.from, 'cm-h' + match[1]); return; }
                if (name === 'SetextHeading1' || name === 'SetextHeading2') { eachLine(node.from, node.to, 'cm-h' + name.slice(-1)); return; }
                if (name === 'HeaderMark') {
                    if (!lineActive(node.from, node.to)) {
                        const line = doc.lineAt(node.from);
                        add(node.from, Math.min(line.to, node.to + (doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0)), hide);
                    }
                    return;
                }
                if (name === 'StrongEmphasis') add(node.from, node.to, mark('cm-strong'));
                else if (name === 'Emphasis') add(node.from, node.to, mark('cm-em'));
                else if (name === 'Strikethrough') add(node.from, node.to, mark('cm-strike'));
                else if (name === 'InlineCode') add(node.from, node.to, mark('cm-icode'));
                else if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
                    const parent = node.node.parent;
                    if (parent && !near(parent.from, parent.to)) add(node.from, node.to, hide);
                } else if (name === 'CodeMark') {
                    const parent = node.node.parent;
                    if (parent && parent.name === 'InlineCode') { if (!near(parent.from, parent.to)) add(node.from, node.to, hide); }
                    else add(node.from, node.to, mark('cm-fence-mark'));
                } else if (name === 'Link') {
                    const marks = node.node.getChildren('LinkMark');
                    if (marks.length >= 2) {
                        add(marks[0].to, marks[1].from, mark('cm-link'));
                        if (!near(node.from, node.to)) { add(marks[0].from, marks[0].to, hide); add(marks[1].from, node.to, hide); }
                    }
                } else if (name === 'Blockquote') eachLine(node.from, node.to, 'cm-quote');
                else if (name === 'QuoteMark') {
                    if (!lineActive(node.from, node.to)) add(node.from, Math.min(doc.lineAt(node.from).to, node.to + (doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0)), hide);
                } else if (name === 'ListMark') {
                    const text = doc.sliceString(node.from, node.to);
                    if (/^[-*+]$/.test(text)) { if (!lineActive(node.from, node.to)) add(node.from, node.to, Decoration.replace({ widget: new BulletWidget() })); }
                    else add(node.from, node.to, mark('cm-listnum'));
                } else if (name === 'TaskMarker') {
                    const checked = /x/i.test(doc.sliceString(node.from, node.to));
                    if (!lineActive(node.from, node.to)) add(node.from, node.to, Decoration.replace({ widget: new TaskWidget(checked) }));
                    if (checked) add(node.to, doc.lineAt(node.to).to, mark('cm-done'));
                } else if (name === 'HorizontalRule') {
                    if (!lineActive(node.from, node.to)) add(node.from, node.to, Decoration.replace({ widget: new RuleWidget() }));
                } else if (name === 'FencedCode' || name === 'CodeBlock') {
                    eachLine(node.from, node.to, 'cm-codeline');
                    addLine(node.from, 'cm-codeline-first');
                    addLine(node.to, 'cm-codeline-last');
                    if (name === 'FencedCode') {
                        const info = node.node.getChild('CodeInfo');
                        const text = node.node.getChild('CodeText');
                        if (info) add(info.from, info.to, mark('tok-annotation'));
                        if (text && text.to - text.from < 60000 && window.tokenizeCode) {
                            const source = doc.sliceString(text.from, text.to);
                            const language = info ? doc.sliceString(info.from, info.to).trim() : '';
                            for (const token of window.tokenizeCode(source, language)) add(text.from + token.start, text.from + token.end, mark('tok-' + token.type));
                        }
                    }
                    return name === 'FencedCode' ? false : undefined;
                } else if (name === 'Table') eachLine(node.from, node.to, 'cm-tableline');
            }
        });
    }
    return Decoration.set(ranges, true);
}

const liveDecorations = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = buildDecorations(view); }
    update(update) {
        if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = buildDecorations(update.view);
    }
}, { decorations: plugin => plugin.decorations });

// Mod-i in the default keymap selects the parent syntax node; the app uses it for italics.
const keys = defaultKeymap.filter(binding => binding.key !== 'Mod-i');

function attach(textarea, host) {
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    let silent = false;
    const extensions = [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, extensions: [GFM] }),
        liveDecorations,
        keymap.of([...keys, ...historyKeymap, indentWithTab]),
        EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'sentences', 'aria-label': 'Редактор Markdown', 'aria-multiline': 'true' }),
        EditorView.updateListener.of(update => {
            if (update.docChanged && !silent) {
                nativeValue.set.call(textarea, update.state.doc.toString());
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            } else if (update.selectionSet) {
                textarea.dispatchEvent(new Event('select'));
            }
        }),
        EditorView.domEventHandlers({
            focus: () => { textarea.dispatchEvent(new FocusEvent('focus')); },
            blur: () => { textarea.dispatchEvent(new FocusEvent('blur')); },
            click: () => { textarea.dispatchEvent(new Event('click')); },
            keyup: () => { textarea.dispatchEvent(new Event('keyup')); }
        })
    ];
    const create = doc => EditorState.create({ doc, extensions });
    const view = new EditorView({ state: create(textarea.value), parent: host });
    const select = (anchor, head) => view.dispatch({ selection: { anchor: Math.min(anchor, view.state.doc.length), head: Math.min(head, view.state.doc.length) } });

    // The hidden <textarea> stays the app's model: reads and writes are redirected to the editor.
    const define = (key, descriptor) => Object.defineProperty(textarea, key, { configurable: true, ...descriptor });
    define('value', {
        get: () => view.state.doc.toString(),
        set: value => {
            nativeValue.set.call(textarea, String(value));
            silent = true; view.setState(create(String(value))); silent = false;
        }
    });
    define('selectionStart', { get: () => view.state.selection.main.from });
    define('selectionEnd', { get: () => view.state.selection.main.to });
    define('setSelectionRange', { value: (start, end) => select(start, end) });
    define('setRangeText', { value: (text, start, end, mode) => {
        const from = start === undefined ? view.state.selection.main.from : start, to = end === undefined ? view.state.selection.main.to : end;
        view.dispatch({ changes: { from, to, insert: text } });
        if (mode === 'end') select(from + text.length, from + text.length);
        else if (mode === 'select') select(from, from + text.length);
    } });
    define('focus', { value: () => view.focus() });
    define('blur', { value: () => view.contentDOM.blur() });
    define('scrollTop', { get: () => view.scrollDOM.scrollTop, set: value => { view.scrollDOM.scrollTop = value; } });

    return {
        view,
        destroy() {
            const doc = view.state.doc.toString();
            for (const key of ['value', 'selectionStart', 'selectionEnd', 'setSelectionRange', 'setRangeText', 'focus', 'blur', 'scrollTop']) delete textarea[key];
            nativeValue.set.call(textarea, doc);
            view.destroy();
        }
    };
}

export { attach };
