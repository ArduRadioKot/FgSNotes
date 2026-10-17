// ==FgsPlugin==
// @name        Импорт из HTML
// @version     1.0
// @description Превращает HTML-страницу или экспорт из Notion, OneNote и Evernote в Markdown-заметку: заголовки, списки, таблицы, ссылки, код.
// @author      FgSNotes
// ==/FgsPlugin==
// Аналог Importer из Obsidian. Выберите файл .html, .htm, .md или .txt: результат откроется в новой заметке.

const clean = text => text.replace(/[ \t]+/g, ' ');
function inline(node) {
    let out = '';
    for (const child of node.childNodes) {
        if (child.nodeType === 3) { out += clean(child.textContent); continue; }
        if (child.nodeType !== 1) continue;
        const tag = child.tagName.toLowerCase(), inner = () => inline(child);
        if (tag === 'strong' || tag === 'b') out += `**${inner().trim()}**`;
        else if (tag === 'em' || tag === 'i') out += `*${inner().trim()}*`;
        else if (tag === 'del' || tag === 's') out += `~~${inner().trim()}~~`;
        else if (tag === 'code') out += '`' + child.textContent + '`';
        else if (tag === 'a') out += child.getAttribute('href') ? `[${inner().trim() || child.getAttribute('href')}](${child.getAttribute('href')})` : inner();
        else if (tag === 'img') out += child.getAttribute('src') ? `![${child.getAttribute('alt') || ''}](${child.getAttribute('src')})` : '';
        else if (tag === 'br') out += '\n';
        else if (!['script', 'style', 'noscript', 'head'].includes(tag)) out += inner();
    }
    return out;
}
function list(node, depth) {
    const ordered = node.tagName.toLowerCase() === 'ol';
    let n = 0, out = '';
    for (const item of node.children) {
        if (item.tagName.toLowerCase() !== 'li') continue;
        n++;
        const nested = [...item.children].filter(child => /^(ul|ol)$/i.test(child.tagName));
        const copy = item.cloneNode(true);
        copy.querySelectorAll('ul, ol').forEach(el => el.remove());
        out += `${'  '.repeat(depth)}${ordered ? n + '.' : '-'} ${inline(copy).trim()}\n`;
        for (const sub of nested) out += list(sub, depth + 1);
    }
    return out;
}
function table(node) {
    const rows = [...node.querySelectorAll('tr')].map(row => [...row.children].map(cell => inline(cell).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')));
    if (!rows.length) return '';
    const width = Math.max(...rows.map(row => row.length));
    const pad = row => `| ${[...row, ...Array(width - row.length).fill('')].join(' | ')} |`;
    return [pad(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(pad)].join('\n') + '\n\n';
}
function blocks(node) {
    let out = '';
    for (const child of node.childNodes) {
        if (child.nodeType === 3) { const t = clean(child.textContent).trim(); if (t) out += t + '\n\n'; continue; }
        if (child.nodeType !== 1) continue;
        const tag = child.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) out += `${'#'.repeat(Number(tag[1]))} ${inline(child).trim()}\n\n`;
        else if (tag === 'p') { const t = inline(child).trim(); if (t) out += t + '\n\n'; }
        else if (tag === 'ul' || tag === 'ol') out += list(child, 0) + '\n';
        else if (tag === 'pre') out += '```\n' + child.textContent.replace(/\n$/, '') + '\n```\n\n';
        else if (tag === 'blockquote') out += blocks(child).trim().split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
        else if (tag === 'table') out += table(child);
        else if (tag === 'hr') out += '---\n\n';
        else if (['script', 'style', 'noscript', 'head', 'nav', 'footer'].includes(tag)) continue;
        else if (['div', 'section', 'article', 'main', 'body', 'html', 'header', 'figure', 'span', 'li'].includes(tag)) out += blocks(child);
        else { const t = inline(child).trim(); if (t) out += t + '\n\n'; }
    }
    return out;
}
function convert(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = (doc.querySelector('title') || {}).textContent || '';
    const text = blocks(doc.body).replace(/\n{3,}/g, '\n\n').trim() + '\n';
    return { title: title.trim(), text };
}

fgs.addButton({
    title: 'Импорт из HTML',
    icon: 'download',
    async run() {
        const file = await fgs.pickFile({ accept: '.html,.htm,.md,.txt,text/html,text/markdown,text/plain' });
        if (!file) return;
        const name = file.name.replace(/\.[^.]+$/, '');
        const result = /\.html?$/i.test(file.name) ? convert(file.data) : { title: '', text: file.data };
        fgs.createDocument(result.title || name, result.text);
        fgs.notify(`Импортировано: ${result.title || name}`);
    }
});
