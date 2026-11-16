// Terminal colours for the editor's syntax tokens (the dark theme in src/styles/base.css).
const { highlightMarkdown } = require('../src/highlight');

const CLASS = {
    'tok-keyword': { color: '173' },
    'tok-string': { color: '108' },
    'tok-number': { color: '73' },
    'tok-comment': { dim: true, italic: true, color: '245' },
    'tok-function': { color: '74' },
    'tok-type': { color: '179' },
    'tok-field': { color: '176' },
    'tok-variable': { color: '176' },
    'tok-tag': { color: '179' },
    'tok-attr': { color: '250' },
    'tok-annotation': { color: '143' },
    'tok-literal': { color: '173' },
    'tok-md-heading': { bold: true, color: '80' },
    'tok-md-mark': { color: '243' },
    'tok-md-bold': { bold: true },
    'tok-md-italic': { italic: true },
    'tok-md-strike': { strike: true, dim: true },
    'tok-md-code': { color: '108' },
    'tok-md-link': { underline: true, color: '80' },
    'tok-md-url': { dim: true, color: '245' },
    'tok-md-list': { color: '173' },
    'tok-md-task': { color: '176' },
    'tok-md-quote': { italic: true, dim: true },
    'tok-md-fence': { color: '243' }
};

function paintStyle(flags) {
    const parts = [];
    if (flags.bold) parts.push('1');
    if (flags.dim) parts.push('2');
    if (flags.italic) parts.push('3');
    if (flags.underline) parts.push('4');
    if (flags.strike) parts.push('9');
    if (flags.color) parts.push('38;5;' + flags.color);
    return parts.length ? '\x1b[' + parts.join(';') + 'm' : '';
}

function styleFromStack(stack) {
    const flags = {};
    for (const cls of stack) {
        for (const name of String(cls || '').split(/\s+/)) if (CLASS[name]) Object.assign(flags, CLASS[name]);
    }
    return paintStyle(flags);
}

function decode(entity) {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === '#39') return "'";
    if (entity[0] === '#' && entity[1] === 'x') return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity[0] === '#') return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return '&' + entity + ';';
}

// Turn highlighter HTML back into lines of plain text plus style spans. The text stays 1:1 with the source.
function htmlToRuns(html) {
    const lines = [{ text: '', spans: [] }];
    const stack = [];
    let i = 0;
    const source = String(html || '');
    const emit = ch => {
        const line = lines[lines.length - 1];
        const style = styleFromStack(stack);
        const from = line.text.length;
        line.text += ch;
        if (!style) return;
        const prev = line.spans[line.spans.length - 1];
        if (prev && prev.to === from && prev.style === style) prev.to = line.text.length;
        else line.spans.push({ from, to: line.text.length, style });
    };
    while (i < source.length) {
        if (source[i] === '<') {
            const end = source.indexOf('>', i);
            if (end < 0) { emit(source.slice(i)); break; }
            const tag = source.slice(i + 1, end).trim();
            i = end + 1;
            if (tag[0] === '/') stack.pop();
            else if (!tag.endsWith('/')) {
                const cls = /class="([^"]*)"/.exec(tag);
                stack.push(cls ? cls[1] : '');
            }
            continue;
        }
        if (source[i] === '&') {
            const end = source.indexOf(';', i);
            if (end < 0) { emit(source[i++]); continue; }
            emit(decode(source.slice(i + 1, end)));
            i = end + 1;
            continue;
        }
        if (source[i] === '\n') { lines.push({ text: '', spans: [] }); i++; continue; }
        emit(source[i++]);
    }
    return lines;
}

let cached = { text: null, lines: [] };

function highlightedLines(text) {
    const source = String(text || '');
    if (cached.text === source) return cached.lines;
    if (source.length > 300000) {
        cached = { text: source, lines: source.split('\n').map(line => ({ text: line, spans: [] })) };
        return cached.lines;
    }
    const visual = htmlToRuns(highlightMarkdown(source));
    const lines = source.split('\n').map((line, index) => {
        const got = visual[index];
        if (!got || got.text !== line) return { text: line, spans: [] };
        return got;
    });
    cached = { text: source, lines };
    return lines;
}

module.exports = { paintStyle, htmlToRuns, highlightedLines, CLASS };
