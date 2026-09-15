function escapeMarkdownHTML(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function markdownInline(source) {
    const fragments = [];
    const keep = html => `\u0000${fragments.push(html) - 1}\u0000`;
    const safeURL = url => /^(?:https?:\/\/|mailto:|#|\.\.?\/)/i.test(url) || !/^[\w\s]*:|^\/\//.test(url);
    let text = source.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${escapeMarkdownHTML(code)}</code>`));
    text = text.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (_, alt, url) => safeURL(url) ? keep(`<img src="${escapeMarkdownHTML(url)}" alt="${escapeMarkdownHTML(alt)}" loading="lazy">`) : escapeMarkdownHTML(alt));
    text = text.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, url) => safeURL(url) ? keep(`<a href="${escapeMarkdownHTML(url)}">${escapeMarkdownHTML(label)}</a>`) : escapeMarkdownHTML(label));
    text = escapeMarkdownHTML(text)
        .replace(/&lt;(\/?(?:u|sup|sub))&gt;/g, '<$1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/~~(.+?)~~/g, '<del>$1</del>');
    return text.replace(/\u0000(\d+)\u0000/g, (_, index) => fragments[index]);
}
function parseMarkdown(source) {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const headings = [];
    let headingId = 0;
    const isList = line => /^(\s*)([-+*]|\d+\.)\s+(.+)$/.exec(line);
    const isTableDivider = line => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || '');
    const tableCells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => markdownInline(cell.trim()));
    function blocks(input) {
        const result = [];
        let i = 0;
        const special = index => /^(?:#{1,6}\s|```|\s*>|\[toc\]$|\s*(?:[-*_]){3,}\s*$)/i.test(input[index]) || isList(input[index]) || isTableDivider(input[index + 1]);
        while (i < input.length) {
            const line = input[i];
            if (!line.trim()) { i++; continue; }
            if (/^```/.test(line)) {
                const language = line.slice(3).trim().replace(/[^\w-]/g, '');
                const code = [];
                i++;
                while (i < input.length && !/^```/.test(input[i])) code.push(input[i++]);
                if (i < input.length) i++;
                result.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${escapeMarkdownHTML(code.join('\n'))}</code></pre>`);
                continue;
            }
            const heading = /^(#{1,6})\s+(.+)$/.exec(line);
            if (heading) {
                const id = `heading-${++headingId}`;
                headings.push({ level: heading[1].length, title: heading[2], id });
                result.push(`<h${heading[1].length} id="${id}">${markdownInline(heading[2])}</h${heading[1].length}>`);
                i++; continue;
            }
            if (/^\[toc\]$/i.test(line)) { result.push('<nav class="table-of-contents" aria-label="Оглавление">{{toc}}</nav>'); i++; continue; }
            if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { result.push('<hr>'); i++; continue; }
            if (/^\s*>/.test(line)) {
                const quote = [];
                while (i < input.length && /^\s*>/.test(input[i])) quote.push(input[i++].replace(/^\s*>\s?/, ''));
                result.push(`<blockquote>${blocks(quote)}</blockquote>`); continue;
            }
            if (line.includes('|') && isTableDivider(input[i + 1])) {
                const headers = tableCells(line);
                i += 2;
                const rows = [];
                while (i < input.length && input[i].includes('|') && input[i].trim()) {
                    rows.push(`<tr>${tableCells(input[i++]).map(cell => `<td>${cell}</td>`).join('')}</tr>`);
                }
                result.push(`<table><thead><tr>${headers.map(cell => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
                continue;
            }
            const list = isList(line);
            if (list) {
                const baseIndent = list[1].length;
                const ordered = /\d/.test(list[2]);
                const tag = ordered ? 'ol' : 'ul';
                const items = [];
                while (i < input.length) {
                    const item = isList(input[i]);
                    if (!item || item[1].length !== baseIndent || /\d/.test(item[2]) !== ordered) break;
                    const task = /^\[([ xX])\]\s+(.*)$/.exec(item[3]);
                    let content = task ? `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}><span>${markdownInline(task[2])}</span>` : markdownInline(item[3]);
                    i++;
                    const nested = [];
                    while (i < input.length && input[i].trim() && /^\s+/.test(input[i]) && input[i].match(/^\s*/)[0].length > baseIndent) nested.push(input[i++].slice(baseIndent + 2));
                    if (nested.length) content += blocks(nested);
                    items.push(`<li${task ? ' class="todo-item"' : ''}>${content}</li>`);
                }
                result.push(`<${tag}${ordered ? ` start="${parseInt(list[2], 10)}"` : ''}>${items.join('')}</${tag}>`);
                continue;
            }
            const paragraph = [markdownInline(line).replace(/ {2}$/, '<br>')];
            i++;
            while (i < input.length && input[i].trim() && !special(i)) paragraph.push(markdownInline(input[i++]).replace(/ {2}$/, '<br>'));
            result.push(`<p>${paragraph.join('\n')}</p>`);
        }
        return result.join('\n');
    }
    const html = blocks(lines);
    const toc = `<ul class="toc-list">${headings.map(heading => `<li style="margin-left:${(heading.level - 1) * 12}px"><a href="#${heading.id}">${markdownInline(heading.title)}</a></li>`).join('')}</ul>`;
    return html.replace(/\{\{toc\}\}/g, toc);
}
if (typeof module !== 'undefined') module.exports = { parseMarkdown };
