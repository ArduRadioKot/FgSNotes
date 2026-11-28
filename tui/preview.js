// A terminal preview of the same Markdown the window renders: tables, lists, quotes and coloured code.
const { parseMarkdown } = require('../src/markdown');
const { highlightCode } = require('../src/highlight');
const { paintStyle, htmlToRuns } = require('./syntax');
const { textWidth, clipText } = require('./width');

const VOID = new Set(['input', 'img', 'br', 'hr', 'wbr']);
const BLOCK = new Set(['p', 'pre', 'ul', 'ol', 'blockquote', 'table', 'hr', 'div', 'nav', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function decodeAll(text) {
    return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|#39);/g, (_, entity) => {
        if (entity === 'amp') return '&';
        if (entity === 'lt') return '<';
        if (entity === 'gt') return '>';
        if (entity === 'quot') return '"';
        if (entity === '#39') return "'";
        if (entity[0] === '#' && entity[1] === 'x') return String.fromCodePoint(parseInt(entity.slice(2), 16));
        if (entity[0] === '#') return String.fromCodePoint(parseInt(entity.slice(1), 10));
        return '&' + entity + ';';
    });
}

function parseTag(raw) {
    const self = raw.endsWith('/');
    const body = (self ? raw.slice(0, -1) : raw).trim();
    const nameMatch = /^([A-Za-z][\w:-]*)/.exec(body);
    if (!nameMatch) return null;
    const attrs = {};
    const rest = body.slice(nameMatch[0].length);
    for (const match of rest.matchAll(/([\w:-]+)(?:\s*=\s*"([^"]*)")?/g)) attrs[match[1]] = match[2] === undefined ? '' : decodeAll(match[2]);
    return { name: nameMatch[1].toLowerCase(), attrs, self };
}

function parseHtml(html) {
    const root = { tag: 'root', attrs: {}, children: [] };
    const stack = [root];
    let i = 0;
    const source = String(html || '');
    while (i < source.length) {
        if (source[i] !== '<') {
            const next = source.indexOf('<', i);
            const raw = source.slice(i, next < 0 ? source.length : next);
            i = next < 0 ? source.length : next;
            const text = decodeAll(raw);
            if (text) stack[stack.length - 1].children.push(text);
            continue;
        }
        const end = source.indexOf('>', i);
        if (end < 0) { stack[stack.length - 1].children.push(source.slice(i)); break; }
        const body = source.slice(i + 1, end).trim();
        i = end + 1;
        if (body[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
        const parsed = parseTag(body);
        if (!parsed) continue;
        const node = { tag: parsed.name, attrs: parsed.attrs, children: [] };
        stack[stack.length - 1].children.push(node);
        if (!parsed.self && !VOID.has(parsed.name)) stack.push(node);
    }
    return root;
}

function blank() {
    return { text: '', spans: [], kind: '', gutter: '', cursor: -1, sel: null, marks: [] };
}

function lineFrom(text, spans, kind) {
    return { text, spans: spans || [], kind: kind || '', gutter: '', cursor: -1, sel: null, marks: [] };
}

function runsToLine(runs, kind) {
    let text = '';
    const spans = [];
    for (const run of runs) {
        if (!run.text) continue;
        const from = text.length;
        text += run.text;
        if (run.style) spans.push({ from, to: text.length, style: run.style });
    }
    return lineFrom(text, spans, kind);
}

function joinBlocks(groups) {
    const lines = [];
    for (const group of groups) {
        if (!group || !group.length) continue;
        if (lines.length) lines.push(blank());
        lines.push(...group);
    }
    return lines;
}

function flagsFor(node, parent) {
    const next = Object.assign({}, parent || {});
    if (!node || typeof node !== 'object') return next;
    const tag = node.tag;
    if (tag === 'strong' || tag === 'b' || tag === 'th') next.bold = true;
    else if (tag === 'em' || tag === 'i') next.italic = true;
    else if (tag === 'del' || tag === 's') { next.strike = true; next.dim = true; }
    else if (tag === 'code') next.color = '108';
    else if (tag === 'a') { next.color = '80'; next.underline = true; }
    else if (/^h[1-6]$/.test(tag)) { next.bold = true; next.color = '80'; }
    const cls = (node.attrs && node.attrs.class) || '';
    if (/(^|\s)math(\s|$)/.test(cls) || cls.indexOf('math-') === 0) next.dim = true;
    return next;
}

function inlineRuns(node, flags) {
    if (typeof node === 'string') return [{ text: node.replace(/[ \t]*\n[ \t]*/g, ' '), style: paintStyle(flags || {}) }];
    if (!node || node.tag === 'input') return [];
    if (node.tag === 'br') return [{ text: '\n', style: '' }];
    if (node.tag === 'img') return [{ text: '[' + (node.attrs.alt || 'image') + ']', style: paintStyle({ dim: true }) }];
    const next = flagsFor(node, flags);
    const out = [];
    for (const child of node.children) out.push(...inlineRuns(child, next));
    return out;
}

function wrapRuns(runs, width, kind) {
    const limit = Math.max(1, width);
    const flat = [];
    for (const run of runs) {
        if (run.text === '\n') { flat.push({ br: true }); continue; }
        for (const ch of run.text) flat.push({ ch, style: run.style });
    }
    if (!flat.some(item => item.br) && flat.reduce((sum, item) => sum + textWidth(item.ch), 0) <= limit) return [runsToLine(runs, kind)];
    const lines = [];
    let line = [];
    const lineWidth = () => line.reduce((sum, item) => sum + textWidth(item.ch), 0);
    const commit = count => {
        const slice = line.slice(0, count);
        while (slice.length && slice[slice.length - 1].ch === ' ') slice.pop();
        if (slice.length || !lines.length) lines.push(charsToLine(slice, kind));
        line = line.slice(count);
        while (line.length && line[0].ch === ' ') line.shift();
    };
    for (const item of flat) {
        if (item.br) {
            lines.push(charsToLine(line, kind));
            line = [];
            continue;
        }
        line.push(item);
        if (line.length > 1 && lineWidth() > limit) {
            let space = -1;
            for (let i = 0; i < line.length - 1; i++) if (line[i].ch === ' ') space = i;
            if (space > 0) commit(space);
            else {
                const extra = line.pop();
                lines.push(charsToLine(line, kind));
                line = [extra];
            }
        }
    }
    if (line.length) lines.push(charsToLine(line, kind));
    return lines.length ? lines : [blank()];
}

function charsToLine(chars, kind) {
    return runsToLine(chars.map(item => ({ text: item.ch, style: item.style })), kind);
}

function prefix(line, pre, style) {
    const shift = pre.length;
    const spans = [];
    if (style && shift) spans.push({ from: 0, to: shift, style });
    for (const span of line.spans || []) spans.push({ from: span.from + shift, to: span.to + shift, style: span.style });
    return lineFrom(pre + line.text, spans, line.kind);
}

function clipLine(line, width) {
    if (!line || line.text.length <= width) return line || blank();
    const text = line.text.slice(0, width);
    const spans = (line.spans || []).map(span => ({ from: span.from, to: Math.min(span.to, width), style: span.style })).filter(span => span.to > span.from);
    return lineFrom(text, spans, line.kind);
}

function blockChildren(node) {
    return node.children.filter(child => typeof child !== 'string' || child.trim());
}

function textContent(node) {
    if (typeof node === 'string') return node;
    return (node.children || []).map(textContent).join('');
}

function renderPre(node, width) {
    const code = (node.children || []).find(child => child && child.tag === 'code') || node;
    const lang = ((code.attrs && code.attrs.class) || '').replace(/^language-/, '');
    const raw = textContent(code).replace(/\n$/, '');
    const inner = Math.max(1, width - 2);
    const dim = paintStyle({ dim: true });
    const lines = [];
    if (lang && lang !== 'js-cell') lines.push(prefix(clipLine(lineFrom(lang, [{ from: 0, to: Math.min(lang.length, inner), style: dim }], 'code'), inner), '│ ', dim));
    for (const line of htmlToRuns(highlightCode(raw, lang === 'js-cell' ? 'js' : lang))) {
        lines.push(prefix(clipLine(lineFrom(line.text, line.spans, ''), inner), '│ ', dim));
    }
    return lines;
}

function renderQuote(node, width) {
    const inner = Math.max(4, width - 2);
    const lines = joinBlocks(blockChildren(node).map(child => renderBlock(child, inner)));
    return lines.map(line => prefix(line, '│ ', paintStyle({ dim: true })));
}

function renderItem(li, width, checked) {
    const base = checked ? { strike: true, dim: true } : {};
    const lines = [];
    let inline = [];
    const flush = () => {
        if (!inline.length) return;
        lines.push(...wrapRuns(inline, width, ''));
        inline = [];
    };
    for (const child of li.children) {
        if (typeof child === 'string') { inline.push(...inlineRuns(child, base)); continue; }
        if (child.tag === 'input') continue;
        if (BLOCK.has(child.tag) && child.tag !== 'p') { flush(); lines.push(...renderBlock(child, width)); continue; }
        if (child.tag === 'p') { flush(); lines.push(...renderBlock(child, width)); continue; }
        inline.push(...inlineRuns(child, base));
    }
    flush();
    return lines.length ? lines : [blank()];
}

function renderList(node, width) {
    const ordered = node.tag === 'ol';
    let number = parseInt(node.attrs.start || '1', 10) || 1;
    const lines = [];
    for (const child of node.children) {
        if (!child || child.tag !== 'li') continue;
        const todo = (child.attrs.class || '') === 'todo-item';
        // The checkbox sits inside the item's <label>, so it is looked for at any depth.
        const hasChecked = node => !!node && node.tag !== undefined && ((node.tag === 'input' && Object.prototype.hasOwnProperty.call(node.attrs, 'checked')) || (node.children || []).some(hasChecked));
        const checked = todo && hasChecked(child);
        const marker = todo ? (checked ? '☑ ' : '☐ ') : ordered ? (number++) + '. ' : '• ';
        const contentWidth = Math.max(4, width - marker.length);
        const pieces = renderItem(child, contentWidth, checked);
        pieces.forEach((line, index) => {
            const pad = index === 0 ? marker : ' '.repeat(marker.length);
            const style = index === 0 ? paintStyle(checked ? { dim: true, strike: true } : { color: '173' }) : '';
            lines.push(prefix(line, pad, style));
        });
    }
    return lines;
}

function clipRuns(runs, max) {
    if (max < 1) return [{ text: '', style: '' }];
    let left = max;
    const out = [];
    for (const run of runs) {
        if (left <= 0) break;
        const size = textWidth(run.text);
        if (size <= left) { out.push(run); left -= size; continue; }
        out.push({ text: left > 1 ? clipText(run.text, left - 1) + '…' : clipText(run.text, left), style: run.style });
        left = 0;
    }
    return out.length ? out : [{ text: '', style: '' }];
}

function padRuns(runs, width) {
    const size = runs.reduce((sum, run) => sum + textWidth(run.text), 0);
    if (size >= width) return runs;
    return runs.concat([{ text: ' '.repeat(width - size), style: '' }]);
}

function rowCells(table) {
    const rows = [];
    const walk = node => {
        for (const child of node.children || []) {
            if (!child || typeof child === 'string') continue;
            if (child.tag === 'tr') rows.push(child.children.filter(cell => cell && (cell.tag === 'th' || cell.tag === 'td')));
            else walk(child);
        }
    };
    walk(table);
    return rows;
}

function rule(widths, left, mid, right) {
    const text = left + widths.map(size => '─'.repeat(size + 2)).join(mid) + right;
    return lineFrom(text, [{ from: 0, to: text.length, style: paintStyle({ dim: true }) }], 'rule');
}

function renderTable(node, width) {
    const rows = rowCells(node);
    if (!rows.length) return [];
    const cols = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const dim = paintStyle({ dim: true });
    const cells = rows.map(row => row.map((cell, index) => {
        const runs = [];
        for (const child of cell.children) runs.push(...inlineRuns(child, cell.tag === 'th' ? { bold: true } : {}));
        return runs.length ? runs : [{ text: '', style: '' }];
    }));
    let widths = [];
    for (let col = 0; col < cols; col++) {
        widths[col] = 1;
        for (const row of cells) {
            const text = (row[col] || []).reduce((sum, run) => sum + run.text, '');
            if (textWidth(text) > widths[col]) widths[col] = textWidth(text);
        }
    }
    const overhead = cols + 1 + cols * 2;
    let budget = Math.max(cols, width - overhead);
    let used = widths.reduce((sum, size) => sum + size, 0);
    while (used > budget) {
        let widest = 0;
        for (let i = 1; i < widths.length; i++) if (widths[i] > widths[widest]) widest = i;
        if (widths[widest] <= 1) break;
        widths[widest]--;
        used--;
    }
    const border = (row, left, mid, right) => {
        const runs = [{ text: left, style: dim }];
        for (let i = 0; i < cols; i++) {
            runs.push({ text: ' ', style: '' });
            runs.push(...padRuns(clipRuns(row[i] || [{ text: '', style: '' }], widths[i]), widths[i]));
            runs.push({ text: ' ', style: '' });
            runs.push({ text: i === cols - 1 ? right : mid, style: dim });
        }
        return runsToLine(runs, '');
    };
    const lines = [rule(widths, '┌', '┬', '┐'), border(cells[0], '│', '│', '│'), rule(widths, '├', '┼', '┤')];
    for (let i = 1; i < cells.length; i++) lines.push(border(cells[i], '│', '│', '│'));
    lines.push(rule(widths, '└', '┴', '┘'));
    return lines.map(line => clipLine(line, width));
}

function renderBlock(node, width) {
    if (!node || typeof node === 'string') return wrapRuns(inlineRuns(node, {}), width, '');
    const tag = node.tag;
    if (/^h[1-6]$/.test(tag)) return wrapRuns(inlineRuns(node, {}), width, 'h');
    if (tag === 'p') return wrapRuns(inlineRuns(node, {}), width, '');
    if (tag === 'pre') return renderPre(node, width);
    if (tag === 'blockquote') return renderQuote(node, width);
    if (tag === 'ul' || tag === 'ol') return renderList(node, width);
    if (tag === 'table') return renderTable(node, width);
    if (tag === 'hr') {
        const text = '─'.repeat(Math.max(1, width));
        return [lineFrom(text, [{ from: 0, to: text.length, style: paintStyle({ dim: true }) }], 'rule')];
    }
    if (tag === 'div' && (node.attrs.class || '').includes('nb-cell')) {
        const pre = node.children.find(child => child && child.tag === 'pre');
        return pre ? renderPre(pre, width) : [];
    }
    if (tag === 'div' && (node.attrs.class || '').includes('math-block')) {
        return wrapRuns([{ text: textContent(node).trim(), style: paintStyle({ dim: true, italic: true }) }], width, '');
    }
    if (tag === 'nav' || tag === 'div') return joinBlocks(blockChildren(node).map(child => renderBlock(child, width)));
    return wrapRuns(inlineRuns(node, {}), width, '');
}

function renderDocument(html, width) {
    const tree = parseHtml(html);
    return joinBlocks(blockChildren(tree).map(child => renderBlock(child, width)));
}

let cache = { key: '', lines: [] };

function previewText(text, width = 80) {
    const size = Math.max(4, width || 80);
    const source = String(text || '');
    const key = size + '\n' + source;
    if (cache.key === key) return cache.lines;
    cache = { key, lines: source.trim() ? renderDocument(parseMarkdown(source), size) : [] };
    return cache.lines;
}

function previewRows(text, width, height, scroll, delta) {
    const lines = previewText(text, width);
    let top = Math.max(0, (scroll.preview || 0) + (delta || 0));
    top = lines.length ? Math.min(top, lines.length - 1) : 0;
    scroll.preview = top;
    const rows = [];
    for (let i = 0; i < height; i++) rows.push(lines[top + i] ? clipLine(lines[top + i], width) : blank());
    return rows;
}

function linkScroll(text, width, height, scroll) {
    const lines = previewText(text, width);
    const sourceCount = String(text || '').split('\n').length;
    const sourceRange = Math.max(1, sourceCount - height);
    const previewRange = Math.max(0, lines.length - height);
    const fraction = Math.min(1, Math.max(0, (scroll.top || 0) / sourceRange));
    scroll.preview = Math.round(fraction * previewRange);
}

module.exports = { previewText, previewRows, linkScroll };
