// ==FgsPlugin==
// @name        Таблицы
// @version     1.0
// @description Две кнопки: вставка пустой таблицы нужного размера и выравнивание столбцов таблицы под курсором, чтобы исходный текст читался.
// @author      FgSNotes
// ==/FgsPlugin==

const cells = line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
const isRow = line => /^\s*\|.*\|\s*$/.test(line);
const isDivider = line => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line);

function align(text) {
    const rows = text.split('\n').map(line => ({ divider: isDivider(line), cells: cells(line) }));
    const width = Math.max(...rows.map(r => r.cells.length));
    const widths = Array.from({ length: width }, (_, i) => Math.max(3, ...rows.filter(r => !r.divider).map(r => (r.cells[i] || '').length)));
    return rows.map(r => '| ' + widths.map((w, i) => {
        const cell = r.cells[i] || '';
        if (!r.divider) return cell.padEnd(w);
        const left = cell.startsWith(':'), right = cell.endsWith(':');
        return (left ? ':' : '-') + '-'.repeat(w - 2) + (right ? ':' : '-');
    }).join(' | ') + ' |').join('\n');
}

fgs.addButton({
    title: 'Выровнять таблицу под курсором',
    icon: 'columns',
    run() {
        const area = document.getElementById('markdown-editor');
        const text = area.value, at = area.selectionStart;
        const lines = text.split('\n');
        let offset = 0, row = 0;
        for (; row < lines.length; row++) { if (at <= offset + lines[row].length) break; offset += lines[row].length + 1; }
        if (row >= lines.length || !isRow(lines[row])) { fgs.notify('Поставьте курсор внутрь таблицы'); return; }
        let top = row, bottom = row;
        while (top > 0 && isRow(lines[top - 1])) top--;
        while (bottom < lines.length - 1 && isRow(lines[bottom + 1])) bottom++;
        const from = lines.slice(0, top).join('\n').length + (top ? 1 : 0), to = from + lines.slice(top, bottom + 1).join('\n').length;
        fgs.editor.replace(from, to, align(lines.slice(top, bottom + 1).join('\n')));
        fgs.notify('Таблица выровнена');
    }
});

fgs.addButton({
    title: 'Вставить таблицу',
    icon: 'list',
    run() {
        const { body, close } = fgs.modal({ title: 'Новая таблица', width: 360 });
        body.innerHTML = '<div class="pm-row"><label>Столбцов <input type="text" id="mt-c" value="3" style="width:70px" inputmode="numeric"></label><label>Строк <input type="text" id="mt-r" value="3" style="width:70px" inputmode="numeric"></label></div><div class="pm-row"><button class="pm-btn primary" id="mt-go">Вставить</button></div>';
        body.querySelector('#mt-go').addEventListener('click', () => {
            const c = Math.min(12, Math.max(1, parseInt(body.querySelector('#mt-c').value, 10) || 3)), r = Math.min(50, Math.max(1, parseInt(body.querySelector('#mt-r').value, 10) || 3));
            const head = Array.from({ length: c }, (_, i) => `Столбец ${i + 1}`);
            const table = [head, head.map(() => '---'), ...Array.from({ length: r }, () => head.map(() => ''))];
            close();
            fgs.editor.insert('\n' + align(table.map(row => '| ' + row.join(' | ') + ' |').join('\n')) + '\n');
        });
    }
});
