// ==FgsPlugin==
// @name        Шаблоны
// @version     1.0
// @description Готовые шаблоны заметок: день, встреча, проект, книга, чек-лист. Подставляют дату, время и название; свои шаблоны сохраняются из выделенного текста.
// @author      FgSNotes
// ==/FgsPlugin==
// В шаблоне работают метки {{date}}, {{time}}, {{weekday}}, {{title}} и {{cursor}} (куда встанет курсор).

const BUILT_IN = [
    { name: 'Заметка дня', text: '# {{date}}, {{weekday}}\n\n## План\n\n- [ ] \n- [ ] \n- [ ] \n\n## Что сделал\n\n{{cursor}}\n\n## Мысли\n\n' },
    { name: 'Встреча', text: '# Встреча: {{title}}\n\n**Дата:** {{date}} {{time}}\n**Участники:** \n\n## Повестка\n\n1. \n\n## Решения\n\n- {{cursor}}\n\n## Задачи\n\n- [ ] \n' },
    { name: 'План проекта', text: '# {{title}}\n\n## Цель\n\n{{cursor}}\n\n## Этапы\n\n| Этап | Срок | Статус |\n| --- | --- | --- |\n|  | {{date}} |  |\n\n## Риски\n\n- \n' },
    { name: 'Заметка о книге', text: '# {{title}}\n\n**Автор:** \n**Прочитано:** {{date}}\n**Оценка:** /5\n\n## О чём\n\n{{cursor}}\n\n## Цитаты\n\n> \n\n## Что запомнилось\n\n- \n' },
    { name: 'Чек-лист', text: '## {{title}}\n\n- [ ] {{cursor}}\n- [ ] \n- [ ] \n' }
];
const fill = (text, title) => {
    const now = new Date();
    return text.replace(/\{\{date\}\}/g, now.toISOString().slice(0, 10)).replace(/\{\{time\}\}/g, now.toTimeString().slice(0, 5))
        .replace(/\{\{weekday\}\}/g, now.toLocaleDateString('ru-RU', { weekday: 'long' })).replace(/\{\{title\}\}/g, title);
};
function insert(template) {
    const title = (fgs.editor.selection() || '').trim().split('\n')[0] || 'Без названия';
    const text = fill(template.text, title);
    const at = text.indexOf('{{cursor}}');
    const area = document.getElementById('markdown-editor');
    const start = area.selectionStart;
    fgs.editor.insert(text.replace('{{cursor}}', ''));
    if (at >= 0) area.setSelectionRange(start + at, start + at);
}

fgs.addButton({
    title: 'Шаблоны',
    icon: 'documents',
    run() {
        const { body, close } = fgs.modal({ title: 'Шаблоны', width: 520 });
        const custom = () => fgs.storage.get('custom', []);
        const draw = () => {
            const all = [...BUILT_IN, ...custom().map(t => ({ ...t, own: true }))];
            body.innerHTML = '<div style="display:grid;gap:6px" id="tp-list"></div><div class="pm-row"><button class="pm-btn" id="tp-save">Сохранить выделенный текст как шаблон</button></div><p class="pm-muted">Если выделить слово перед выбором шаблона, оно станет {{title}}.</p>';
            const list = body.querySelector('#tp-list');
            all.forEach((t, i) => {
                const row = document.createElement('div');
                row.className = 'pm-row'; row.style.margin = 0;
                row.innerHTML = '<button type="button" class="pm-btn" style="flex:1;text-align:left"></button>' + (t.own ? '<button type="button" class="pm-btn" aria-label="Удалить шаблон">Удалить</button>' : '');
                row.firstChild.textContent = t.name;
                row.firstChild.addEventListener('click', () => { close(); insert(t); });
                if (t.own) row.lastChild.addEventListener('click', () => { fgs.storage.set('custom', custom().filter(c => c.name !== t.name)); draw(); });
                list.append(row);
            });
            body.querySelector('#tp-save').addEventListener('click', () => {
                const text = fgs.editor.selection();
                if (!text.trim()) { fgs.notify('Сначала выделите текст шаблона'); return; }
                const name = text.trim().split('\n')[0].slice(0, 40);
                fgs.storage.set('custom', [...custom().filter(c => c.name !== name), { name, text }]);
                draw();
            });
        };
        draw();
    }
});
