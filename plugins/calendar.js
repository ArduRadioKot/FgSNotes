// ==FgsPlugin==
// @name        Календарь
// @version     1.0
// @description Месяц с датами из заметки (2026-10-20, в том числе в задачах) и событиями из файлов .ics. Вставка даты по клику, экспорт задач с датами в .ics.
// @author      FgSNotes
// ==/FgsPlugin==
// Аналог Full Calendar из Obsidian. Даты ищутся в формате ГГГГ-ММ-ДД; задача «- [ ] 2026-10-20 Отчёт» попадёт в календарь и в экспорт.

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function parseIcs(text) {
    const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const events = [];
    let current = null;
    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') current = {};
        else if (line === 'END:VEVENT') { if (current && current.date) events.push(current); current = null; }
        else if (current) {
            const m = /^(DTSTART|SUMMARY)[^:]*:(.*)$/.exec(line);
            if (!m) continue;
            if (m[1] === 'SUMMARY') current.title = m[2].replace(/\\,/g, ',').replace(/\\n/g, ' ');
            else { const d = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(m[2]); if (d) { current.date = `${d[1]}-${d[2]}-${d[3]}`; current.time = d[4] ? `${d[4]}:${d[5]}` : ''; } }
        }
    }
    return events;
}
function noteItems(text) {
    const items = [];
    for (const line of text.split('\n')) {
        const m = /(\d{4}-\d{2}-\d{2})/.exec(line);
        if (!m) continue;
        const task = /^\s*[-*]\s+\[( |x)\]/i.exec(line);
        items.push({ date: m[1], title: line.replace(/^\s*[-*]\s+(\[[ xX]\]\s*)?/, '').replace(m[1], '').trim() || m[1], task: !!task, done: !!task && task[1] !== ' ' });
    }
    return items;
}
function toIcs(items) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const events = items.map((it, i) => `BEGIN:VEVENT\r\nUID:fgsnotes-${Date.now()}-${i}@fgsnotes\r\nDTSTAMP:${stamp}\r\nDTSTART;VALUE=DATE:${it.date.replace(/-/g, '')}\r\nSUMMARY:${it.title.replace(/[,;]/g, ' ')}\r\nEND:VEVENT`);
    return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FgSNotes//Calendar//RU\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
}

fgs.addButton({
    title: 'Календарь',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="10.5" rx="1.5"/><path d="M2 7h12M5.5 2v3M10.5 2v3"/></svg>',
    run() {
        const imported = fgs.storage.get('events', []);
        const { body } = fgs.modal({ title: 'Календарь', width: 760 });
        let view = new Date(); view.setDate(1);
        let picked = iso(new Date());
        body.innerHTML = `<div class="pm-row"><button class="pm-btn" data-a="prev" aria-label="Предыдущий месяц">‹</button><strong id="cal-title" style="min-width:150px;text-align:center"></strong><button class="pm-btn" data-a="next" aria-label="Следующий месяц">›</button><button class="pm-btn" data-a="today">Сегодня</button><span style="flex:1"></span><button class="pm-btn" data-a="import">Импорт .ics</button><button class="pm-btn" data-a="export">Экспорт задач в .ics</button></div>
            <div id="cal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px"></div><div id="cal-day" style="margin-top:12px"></div>`;
        const grid = body.querySelector('#cal-grid'), day = body.querySelector('#cal-day');
        const itemsFor = () => {
            const note = fgs.documents().find(d => d.active);
            const map = new Map();
            const add = it => { if (!map.has(it.date)) map.set(it.date, []); map.get(it.date).push(it); };
            noteItems(note ? note.content : '').forEach(it => add({ ...it, source: 'заметка' }));
            imported.forEach(it => add({ ...it, source: 'календарь' }));
            return map;
        };
        const draw = () => {
            const map = itemsFor(), today = iso(new Date());
            body.querySelector('#cal-title').textContent = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;
            const first = new Date(view.getFullYear(), view.getMonth(), 1), offset = (first.getDay() + 6) % 7;
            const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
            let html = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(n => `<div class="pm-muted" style="text-align:center">${n}</div>`).join('') + '<div></div>'.repeat(offset);
            for (let d = 1; d <= days; d++) {
                const key = iso(new Date(view.getFullYear(), view.getMonth(), d)), n = (map.get(key) || []).length;
                html += `<button type="button" class="pm-btn" data-day="${key}" style="height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;${key === today ? 'box-shadow:inset 0 0 0 1px var(--accent-color);' : ''}${key === picked ? 'background:var(--accent-color);color:var(--accent-text);' : ''}">${d}<small style="opacity:.8">${n ? '•'.repeat(Math.min(n, 3)) : '&nbsp;'}</small></button>`;
            }
            grid.innerHTML = html;
            const list = map.get(picked) || [];
            day.innerHTML = `<div class="pm-row"><strong>${picked}</strong><button class="pm-btn" data-a="insert">Вставить дату в заметку</button></div>` + (list.length ? list.map(it => `<div class="pm-muted" style="padding:4px 0">${it.task ? (it.done ? '☑' : '☐') : '•'} ${esc(it.time ? it.time + ' ' : '')}${esc(it.title)} <em>(${it.source})</em></div>`).join('') : '<div class="pm-muted">На этот день ничего нет.</div>');
        };
        body.addEventListener('click', async event => {
            const d = event.target.closest('[data-day]');
            if (d) { picked = d.dataset.day; draw(); return; }
            const a = event.target.closest('[data-a]');
            if (!a) return;
            if (a.dataset.a === 'prev') { view.setMonth(view.getMonth() - 1); draw(); }
            else if (a.dataset.a === 'next') { view.setMonth(view.getMonth() + 1); draw(); }
            else if (a.dataset.a === 'today') { view = new Date(); view.setDate(1); picked = iso(new Date()); draw(); }
            else if (a.dataset.a === 'insert') fgs.editor.insert(picked);
            else if (a.dataset.a === 'import') {
                const file = await fgs.pickFile({ accept: '.ics,text/calendar' });
                if (!file) return;
                const events = parseIcs(file.data);
                imported.splice(0, imported.length, ...events.slice(0, 5000));
                fgs.storage.set('events', imported);
                fgs.notify(`Импортировано событий: ${events.length}`);
                draw();
            } else if (a.dataset.a === 'export') {
                const tasks = noteItems((fgs.documents().find(x => x.active) || { content: '' }).content).filter(it => it.task && !it.done);
                if (!tasks.length) { fgs.notify('Нет невыполненных задач с датой'); return; }
                fgs.download('fgsnotes-tasks.ics', toIcs(tasks), 'text/calendar;charset=utf-8');
            }
        });
        draw();
    }
});
