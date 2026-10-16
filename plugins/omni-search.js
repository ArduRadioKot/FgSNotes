// ==FgsPlugin==
// @name        Поиск по заметкам
// @version     1.0
// @description Быстрый поиск по всем открытым заметкам с подсветкой совпадений и переходом к нужному месту. Сочетание Ctrl/⌘+Shift+F.
// @author      FgSNotes
// ==/FgsPlugin==
// Аналог Omnisearch из Obsidian. Слова из запроса ищутся по отдельности; заголовок заметки весит больше текста.

const esc = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function search(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const results = [];
    for (const doc of fgs.documents()) {
        const lower = doc.content.toLowerCase(), title = doc.title.toLowerCase();
        let score = 0, first = -1;
        for (const word of words) {
            let count = 0, at = lower.indexOf(word);
            if (at < 0 && !title.includes(word)) { score = -1; break; }
            if (first < 0 || (at >= 0 && at < first)) first = at;
            while (at >= 0 && count < 50) { count++; at = lower.indexOf(word, at + word.length); }
            score += count + (title.includes(word) ? 10 : 0);
        }
        if (score <= 0) continue;
        const from = Math.max(0, first - 50);
        let snippet = doc.content.slice(from, first + 110).replace(/\s+/g, ' ');
        results.push({ doc, score, first, snippet: (from ? '…' : '') + snippet });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 30);
}
function open() {
    const { body, close } = fgs.modal({ title: 'Поиск по заметкам', width: 640 });
    body.innerHTML = '<input type="search" id="os-in" placeholder="Что найти?" aria-label="Запрос"><div id="os-out" role="listbox" style="margin-top:10px;display:grid;gap:4px"></div>';
    const input = body.querySelector('#os-in'), out = body.querySelector('#os-out');
    let found = [];
    const draw = () => {
        const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
        found = search(input.value);
        const mark = text => words.reduce((html, word) => html.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `\u0001${m}\u0002`), esc(text)).replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>');
        out.innerHTML = found.length ? found.map((hit, i) => `<button type="button" class="pm-btn" role="option" data-i="${i}" style="height:auto;text-align:left;padding:8px 10px"><strong>${mark(hit.doc.title)}</strong>${hit.doc.active ? ' <span class="pm-muted">(открыта)</span>' : ''}<br><span class="pm-muted">${mark(hit.snippet)}</span></button>`).join('')
            : `<p class="pm-muted">${input.value.trim() ? 'Ничего не найдено в открытых заметках.' : 'Начните печатать запрос.'}</p>`;
    };
    out.addEventListener('click', event => {
        const button = event.target.closest('[data-i]');
        if (!button) return;
        const hit = found[Number(button.dataset.i)];
        close();
        fgs.openDocument(hit.doc.id);
        setTimeout(() => {
            const area = document.getElementById('markdown-editor');
            const at = hit.doc.content.toLowerCase().indexOf(input.value.toLowerCase().split(/\s+/)[0]);
            if (at >= 0) { area.focus(); area.setSelectionRange(at, at + input.value.trim().split(/\s+/)[0].length); }
        }, 80);
    });
    input.addEventListener('input', draw);
    draw();
    setTimeout(() => input.focus(), 0);
}
const onKey = event => { if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyF') { event.preventDefault(); open(); } };
document.addEventListener('keydown', onKey);
fgs.onUnload(() => document.removeEventListener('keydown', onKey));
fgs.addButton({ title: 'Поиск по заметкам (Ctrl/⌘+Shift+F)', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>', run: open });
