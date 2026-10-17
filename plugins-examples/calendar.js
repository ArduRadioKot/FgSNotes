// ==FgsPlugin==
// @name        Календарь
// @version     2.0
// @description Календарь в стиле Apple Calendar на отдельной вкладке: день, неделя и месяц, свои события, даты и задачи из заметки, импорт и экспорт .ics.
// @author      FgSNotes
// ==/FgsPlugin==
// В заметке ищутся даты ГГГГ-ММ-ДД: задача «- [ ] 2026-10-20 Отчёт» появится в календаре красным цветом.
// Двойной щелчок по дню или по времени создаёт событие, щелчок по событию открывает его.

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const CALENDARS = [
    { id: 'note', name: 'Из заметки', color: '#ff3b30', readonly: true },
    { id: 'my', name: 'Мои события', color: '#0a84ff' },
    { id: 'import', name: 'Импортированные', color: '#34c759' }
];
const HOUR = 52;          // px per hour in the day and week views

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = text => { const [y, m, d] = text.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const weekStart = d => addDays(d, -((d.getDay() + 6) % 7));
const minutes = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const hhmm = mins => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sameDay = (a, b) => iso(a) === iso(b);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// --- .ics ------------------------------------------------------------------------------------------------------------------------
function parseIcs(text) {
    const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const events = [];
    let cur = null;
    const when = (value, params) => {
        const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value);
        if (!m) return null;
        if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };
        const d = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return { date: iso(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
    };
    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') cur = { rrule: '' };
        else if (line === 'END:VEVENT') { if (cur && cur.date) events.push(cur); cur = null; }
        else if (cur) {
            const m = /^([A-Z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
            if (!m) continue;
            const [, name, params, value] = m;
            if (name === 'SUMMARY') cur.title = value.replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\n/gi, ' ');
            else if (name === 'DESCRIPTION') cur.notes = value.replace(/\\n/gi, '\n').replace(/\\,/g, ',');
            else if (name === 'RRULE') cur.rrule = value;
            else if (name === 'DTSTART') { const w = when(value, params); if (w) { cur.date = w.date; cur.start = w.time; cur.allDay = !w.time; } }
            else if (name === 'DTEND') { const w = when(value, params); if (w) { cur.endDate = w.date; cur.end = w.time; } }
        }
    }
    return events.map(e => {
        const out = { id: uid(), title: e.title || 'Без названия', date: e.date, allDay: !!e.allDay, start: e.start || '', end: e.end || '', notes: e.notes || '', calendar: 'import', rrule: e.rrule };
        // all-day DTEND is exclusive in iCalendar
        if (e.endDate && e.allDay) { const last = iso(addDays(fromIso(e.endDate), -1)); if (last > e.date) out.endDate = last; }
        else if (e.endDate && e.endDate > e.date) out.endDate = e.endDate;
        return out;
    });
}
// Simple repeating rules (daily, weekly, monthly, yearly with COUNT or UNTIL) become separate events for up to three years.
function expand(events) {
    const out = [];
    const limit = addDays(new Date(), 365 * 3);
    for (const e of events) {
        out.push(e);
        const rule = Object.fromEntries((e.rrule || '').split(';').map(p => p.split('=')));
        if (!rule.FREQ) continue;
        const step = { DAILY: d => addDays(d, 1), WEEKLY: d => addDays(d, 7), MONTHLY: d => new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()), YEARLY: d => new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()) }[rule.FREQ];
        if (!step) continue;
        const every = Math.max(1, parseInt(rule.INTERVAL, 10) || 1), count = parseInt(rule.COUNT, 10) || 400;
        const until = rule.UNTIL ? fromIso(`${rule.UNTIL.slice(0, 4)}-${rule.UNTIL.slice(4, 6)}-${rule.UNTIL.slice(6, 8)}`) : limit;
        let d = fromIso(e.date);
        for (let n = 1; n < count; n++) {
            for (let k = 0; k < every; k++) d = step(d);
            if (d > until || d > limit) break;
            const shift = Math.round((d - fromIso(e.date)) / 864e5);
            out.push({ ...e, id: e.id + '#' + n, date: iso(d), endDate: e.endDate ? iso(addDays(fromIso(e.endDate), shift)) : '' });
        }
    }
    return out;
}
function toIcs(events) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const text = s => String(s || '').replace(/[,;\\]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const body = events.map(e => {
        const day = e.date.replace(/-/g, '');
        const dtstart = e.allDay ? `DTSTART;VALUE=DATE:${day}` : `DTSTART:${day}T${(e.start || '09:00').replace(':', '')}00`;
        const endDay = (e.endDate || e.date).replace(/-/g, '');
        const dtend = e.allDay ? `DTEND;VALUE=DATE:${iso(addDays(fromIso(e.endDate || e.date), 1)).replace(/-/g, '')}` : `DTEND:${endDay}T${(e.end || e.start || '10:00').replace(':', '')}00`;
        return ['BEGIN:VEVENT', `UID:${e.id}@fgsnotes`, `DTSTAMP:${stamp}`, dtstart, dtend, `SUMMARY:${text(e.title)}`, ...(e.notes ? [`DESCRIPTION:${text(e.notes)}`] : []), 'END:VEVENT'].join('\r\n');
    });
    return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FgSNotes//Calendar//RU\r\n${body.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
}

// --- events from the note --------------------------------------------------------------------------------------------------
function noteEvents() {
    const note = fgs.documents().find(d => d.active);
    const out = [];
    (note ? note.content : '').split('\n').forEach((line, index) => {
        const m = /(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(line);
        if (!m || isNaN(fromIso(m[1]))) return;
        const task = /^\s*[-*]\s+\[( |x)\]/i.exec(line);
        const title = line.replace(/^\s*[-*]\s+(\[[ xX]\]\s*)?/, '').replace(m[0], '').replace(/^[\s:–—-]+/, '').trim() || m[1];
        out.push({ id: 'note-' + index, title, date: m[1], allDay: !m[2], start: m[2] || '', end: '', calendar: 'note', task: !!task, done: !!task && task[1] !== ' ', line: index });
    });
    return out;
}

fgs.addStyle(`
.cal { --cal-line: color-mix(in srgb, var(--text-color) 12%, transparent); --cal-red: #ff3b30; display: grid; grid-template-columns: 236px minmax(0, 1fr); height: 100%; min-height: 0; color: var(--text-color); font-size: 13px; user-select: none; position: relative; }
.cal-side { display: flex; flex-direction: column; gap: 18px; padding: 16px 14px; border-right: 1px solid var(--cal-line); overflow: auto; }
.cal-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.cal button { font: inherit; color: inherit; cursor: pointer; }
.cal-mini-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-weight: 600; }
.cal-mini-head button, .cal-nav button { border: 0; background: transparent; border-radius: 6px; width: 24px; height: 24px; color: var(--text-muted); }
.cal-mini-head button:hover, .cal-nav button:hover { background: var(--hover-color); color: var(--text-color); }
.cal-mini { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px 0; text-align: center; font-size: 12px; }
.cal-mini span.dow { color: var(--text-muted); font-size: 11px; padding: 2px 0; }
.cal-mini button { height: 26px; border: 0; border-radius: 50%; background: transparent; position: relative; }
.cal-mini button.out { color: var(--text-muted); opacity: .55; }
.cal-mini button:hover { background: var(--hover-color); }
.cal-mini button.today { background: var(--cal-red); color: #fff; font-weight: 600; }
.cal-mini button.sel:not(.today) { background: var(--active-bg); font-weight: 600; }
.cal-mini button.dot::after { content: ''; position: absolute; left: 50%; bottom: 1px; width: 3px; height: 3px; margin-left: -1.5px; border-radius: 50%; background: currentColor; opacity: .6; }
.cal-side h4 { margin: 0 0 6px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
.cal-list { display: grid; gap: 2px; }
.cal-check { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
.cal-check:hover { background: var(--hover-color); }
.cal-check i { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--c); background: var(--c); flex: none; }
.cal-check.off i { background: transparent; }
.cal-up { display: grid; gap: 6px; }
.cal-up button { display: grid; grid-template-columns: 8px 1fr; gap: 8px; align-items: start; padding: 4px 6px; border: 0; border-radius: 6px; background: transparent; text-align: left; }
.cal-up button:hover { background: var(--hover-color); }
.cal-up i { width: 8px; height: 8px; margin-top: 4px; border-radius: 50%; background: var(--c); }
.cal-up small { display: block; color: var(--text-muted); }
.cal-bar { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--cal-line); }
.cal-title { font-size: 22px; font-weight: 400; letter-spacing: -.01em; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cal-title b { font-weight: 700; }
.cal-nav { display: flex; align-items: center; gap: 2px; margin-left: auto; }
.cal-nav .today-btn { width: auto; padding: 0 12px; border: 1px solid var(--cal-line); border-radius: 6px; height: 26px; margin: 0 4px; color: var(--text-color); }
.cal-seg { display: inline-flex; padding: 2px; border-radius: 8px; background: var(--active-bg); }
.cal-seg button { height: 24px; padding: 0 14px; border: 0; border-radius: 6px; background: transparent; }
.cal-seg button.on { background: var(--card-bg); box-shadow: 0 1px 2px var(--shadow-color); font-weight: 600; }
.cal-plus { width: 28px; height: 28px; border: 0; border-radius: 50%; background: var(--active-bg); font-size: 18px; line-height: 1; }
.cal-plus:hover { background: var(--hover-color); }
.cal-view { flex: 1; min-height: 0; overflow: auto; }
/* month */
.cal-month { display: grid; grid-template-rows: auto 1fr; height: 100%; min-height: 420px; }
.cal-dows, .cal-weeks { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.cal-dows div { padding: 8px 10px 6px; text-align: right; color: var(--text-muted); font-size: 12px; border-left: 1px solid var(--cal-line); }
.cal-dows div:first-child { border-left: 0; }
.cal-weeks { grid-auto-rows: minmax(92px, 1fr); }
.cal-cell { border-top: 1px solid var(--cal-line); border-left: 1px solid var(--cal-line); padding: 4px 4px 2px; min-width: 0; overflow: hidden; display: flex; flex-direction: column; gap: 2px; }
.cal-cell:nth-child(7n+1) { border-left: 0; }
.cal-cell.out .num { color: var(--text-muted); }
.cal-cell.sel { background: color-mix(in srgb, var(--text-color) 5%, transparent); }
.cal-cell .num { align-self: flex-end; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px; display: grid; place-items: center; font-size: 13px; }
.cal-cell.today .num { background: var(--cal-red); color: #fff; font-weight: 600; }
.cal-cell .num.first { font-weight: 700; }
.cal-ev { display: flex; align-items: center; gap: 5px; padding: 1px 5px; border: 0; border-radius: 4px; background: transparent; text-align: left; font-size: 12px; line-height: 1.5; width: 100%; min-width: 0; color: var(--text-color); }
.cal-ev .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-ev .tm { color: var(--text-muted); flex: none; margin-left: auto; }
.cal-ev .d { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
.cal-ev.allday { background: color-mix(in srgb, var(--c) 26%, transparent); color: color-mix(in srgb, var(--c) 70%, var(--text-color)); font-weight: 500; }
.cal-ev.done .t { text-decoration: line-through; opacity: .6; }
.cal-ev:hover { background: color-mix(in srgb, var(--c) 18%, transparent); }
.cal-more { color: var(--text-muted); font-size: 11.5px; padding: 0 6px; }
/* day / week */
.cal-head { display: grid; grid-template-columns: 52px repeat(var(--n), minmax(0, 1fr)); border-bottom: 1px solid var(--cal-line); }
.cal-sticky { position: sticky; top: 0; z-index: 3; background: var(--card-bg); }
.cal-head .col { padding: 8px 6px 6px; text-align: center; border-left: 1px solid var(--cal-line); display: grid; gap: 2px; justify-items: center; }
.cal-head .col .w { color: var(--text-muted); font-size: 12px; }
.cal-head .col .n { min-width: 28px; height: 28px; padding: 0 6px; border-radius: 14px; display: grid; place-items: center; font-size: 18px; }
.cal-head .col.today .n { background: var(--cal-red); color: #fff; font-weight: 600; }
.cal-head .col.today .w { color: var(--cal-red); }
.cal-allday { display: grid; grid-template-columns: 52px repeat(var(--n), minmax(0, 1fr)); border-bottom: 1px solid var(--cal-line); }
.cal-allday .lbl { padding: 6px 6px 0 0; text-align: right; color: var(--text-muted); font-size: 11px; }
.cal-allday .col { border-left: 1px solid var(--cal-line); padding: 3px; display: grid; gap: 2px; align-content: start; min-height: 26px; }
.cal-grid { display: grid; grid-template-columns: 52px repeat(var(--n), minmax(0, 1fr)); position: relative; }
.cal-hours > div { height: ${HOUR}px; position: relative; }
.cal-hours span { position: absolute; top: -7px; right: 8px; font-size: 11px; color: var(--text-muted); }
.cal-hours > div:first-child span { display: none; }
.cal-day { position: relative; border-left: 1px solid var(--cal-line); background-image: linear-gradient(to bottom, var(--cal-line) 1px, transparent 1px); background-size: 100% ${HOUR}px; }
.cal-day.today { background-color: color-mix(in srgb, var(--cal-red) 4%, transparent); }
.cal-block { position: absolute; left: 2px; right: 3px; padding: 3px 6px; border: 0; border-radius: 6px; background: color-mix(in srgb, var(--c) 24%, var(--card-bg)); color: color-mix(in srgb, var(--c) 62%, var(--text-color)); text-align: left; overflow: hidden; font-size: 12px; line-height: 1.3; }
.cal-block b { display: block; font-weight: 600; }
.cal-block span { opacity: .8; }
.cal-block:hover { background: color-mix(in srgb, var(--c) 34%, var(--card-bg)); }
.cal-block.done b { text-decoration: line-through; }
.cal-now { position: absolute; left: 0; right: 0; height: 0; border-top: 2px solid var(--cal-red); z-index: 1; pointer-events: none; }
.cal-now::before { content: ''; position: absolute; left: -5px; top: -6px; width: 10px; height: 10px; border-radius: 50%; background: var(--cal-red); }
/* sheet */
.cal-veil { position: absolute; inset: 0; z-index: 10; display: grid; place-items: center; background: rgba(0, 0, 0, .28); }
.cal-sheet { width: min(380px, calc(100% - 24px)); padding: 16px; border-radius: 12px; background: var(--card-bg); box-shadow: 0 18px 48px var(--shadow-color), inset 0 0 0 1px var(--cal-line); display: grid; gap: 10px; user-select: text; }
.cal-sheet input[type="text"], .cal-sheet input[type="date"], .cal-sheet input[type="time"], .cal-sheet select, .cal-sheet textarea { width: 100%; padding: 7px 9px; border: 1px solid var(--cal-line); border-radius: 7px; background: var(--code-bg); color: inherit; font: inherit; }
.cal-sheet textarea { min-height: 64px; resize: vertical; }
.cal-sheet .title { font-size: 17px; font-weight: 600; }
.cal-sheet .row { display: flex; align-items: center; gap: 8px; }
.cal-sheet .row > label { color: var(--text-muted); width: 74px; flex: none; }
.cal-sheet .row > :not(label) { flex: 1; min-width: 0; }
.cal-sheet .acts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.cal-sheet .acts .spacer { flex: 1; }
.cal-sheet button { height: 30px; padding: 0 14px; border: 0; border-radius: 7px; background: var(--active-bg); }
.cal-sheet button.primary { background: var(--accent-color); color: var(--accent-text); }
.cal-sheet button.danger { color: var(--cal-red); }
.cal-menu { position: absolute; z-index: 9; right: 18px; top: 52px; min-width: 200px; padding: 5px; border-radius: 10px; background: var(--card-bg); box-shadow: 0 12px 32px var(--shadow-color), inset 0 0 0 1px var(--cal-line); display: grid; }
.cal-menu button { height: 30px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; text-align: left; }
.cal-menu button:hover { background: var(--hover-color); }
@media (max-width: 860px) { .cal { grid-template-columns: 1fr; } .cal-side { display: none; } .cal-title { font-size: 18px; } }
`);

const open = () => {
    const tab = fgs.openTab({ key: 'calendar', title: 'Календарь', icon: 'calendar', render: build });
    if (tab && !tab.created) tab.element.nbRefresh && tab.element.nbRefresh();
};

function build(root, tab) {
    let view = fgs.storage.get('view', 'month');
    let cursor = new Date();
    let selected = iso(new Date());
    let stored = fgs.storage.get('events', []);
    let hidden = new Set(fgs.storage.get('hidden', []));
    let events = [];
    let timer = 0;

    const calendarOf = id => CALENDARS.find(c => c.id === id) || CALENDARS[1];
    const save = () => { fgs.storage.set('events', stored); };
    function collect() {
        events = [...noteEvents(), ...expand(stored)].filter(e => !hidden.has(e.calendar));
    }
    const eventsOn = key => events.filter(e => e.date <= key && key <= (e.endDate || e.date))
        .sort((a, b) => (b.allDay - a.allDay) || (a.start || '').localeCompare(b.start || '') || a.title.localeCompare(b.title));

    // --- pieces ---
    function titleText() {
        if (view === 'month') return `<b>${MONTHS[cursor.getMonth()][0].toUpperCase() + MONTHS[cursor.getMonth()].slice(1)}</b> ${cursor.getFullYear()}`;
        if (view === 'day') return `<b>${cursor.getDate()} ${MONTHS_OF[cursor.getMonth()]}</b> ${cursor.getFullYear()}`;
        const s = weekStart(cursor), e = addDays(s, 6);
        return s.getMonth() === e.getMonth() ? `<b>${s.getDate()}–${e.getDate()} ${MONTHS_OF[e.getMonth()]}</b> ${e.getFullYear()}` : `<b>${s.getDate()} ${MONTHS_OF[s.getMonth()].slice(0, 3)} – ${e.getDate()} ${MONTHS_OF[e.getMonth()].slice(0, 3)}</b> ${e.getFullYear()}`;
    }
    function miniMonth() {
        const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1), start = weekStart(first), today = iso(new Date());
        let html = `<div class="cal-mini-head"><span>${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}</span><span><button data-a="mprev" aria-label="Предыдущий месяц">‹</button><button data-a="mnext" aria-label="Следующий месяц">›</button></span></div><div class="cal-mini">${WEEKDAYS.map(d => `<span class="dow">${d}</span>`).join('')}`;
        for (let i = 0; i < 42; i++) {
            const d = addDays(start, i), key = iso(d);
            html += `<button data-day="${key}" class="${d.getMonth() !== cursor.getMonth() ? 'out ' : ''}${key === today ? 'today ' : ''}${key === selected ? 'sel ' : ''}${eventsOn(key).length ? 'dot' : ''}">${d.getDate()}</button>`;
        }
        return html + '</div>';
    }
    function upcoming() {
        const list = [];
        for (let i = 0; i < 14 && list.length < 6; i++) { const key = iso(addDays(new Date(), i)); for (const e of eventsOn(key)) if (list.length < 6 && (i > 0 || e.allDay || (e.start || '') >= hhmm(new Date().getHours() * 60 + new Date().getMinutes()) || true)) list.push({ e, key }); }
        return list.length ? list.map(({ e, key }) => `<button data-open="${esc(e.id)}" style="--c:${calendarOf(e.calendar).color}"><i></i><span>${esc(e.title)}<small>${fromIso(key).getDate()} ${MONTHS_OF[fromIso(key).getMonth()]}${e.start ? ', ' + e.start : ''}</small></span></button>`).join('') : '<div style="color:var(--text-muted);padding:4px 6px">Ничего не запланировано</div>';
    }
    function evPill(e) {
        const c = calendarOf(e.calendar).color;
        const timed = !e.allDay && e.start;
        return `<button class="cal-ev ${e.allDay ? 'allday' : ''} ${e.done ? 'done' : ''}" style="--c:${c}" data-open="${esc(e.id)}" title="${esc(e.title)}">${e.allDay ? '' : '<span class="d"></span>'}<span class="t">${e.task ? (e.done ? '☑ ' : '☐ ') : ''}${esc(e.title)}</span>${timed ? `<span class="tm">${e.start}</span>` : ''}</button>`;
    }

    // --- views ---
    function monthView() {
        const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1), start = weekStart(first), today = iso(new Date());
        const rows = Math.ceil(((first.getDay() + 6) % 7 + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) / 7);
        let cells = '';
        for (let i = 0; i < rows * 7; i++) {
            const d = addDays(start, i), key = iso(d), list = eventsOn(key);
            const shown = list.slice(0, 3);
            cells += `<div class="cal-cell ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${key === today ? 'today' : ''} ${key === selected ? 'sel' : ''}" data-cell="${key}"><span class="num ${d.getDate() === 1 ? 'first' : ''}">${d.getDate() === 1 ? d.getDate() + ' ' + MONTHS_OF[d.getMonth()].slice(0, 3) : d.getDate()}</span>${shown.map(evPill).join('')}${list.length > 3 ? `<span class="cal-more">ещё ${list.length - 3}</span>` : ''}</div>`;
        }
        return `<div class="cal-month"><div class="cal-dows">${WEEKDAYS.map(d => `<div>${d}</div>`).join('')}</div><div class="cal-weeks" style="grid-template-rows:repeat(${rows},minmax(92px,1fr))">${cells}</div></div>`;
    }
    function packed(list) {
        // Overlapping timed events share the width of the day.
        const items = list.map(e => ({ e, from: minutes(e.start), to: Math.max(minutes(e.start) + 30, e.end && e.end > e.start ? minutes(e.end) : minutes(e.start) + 60) })).sort((a, b) => a.from - b.from);
        const cols = [];
        for (const it of items) {
            let c = cols.findIndex(end => end <= it.from);
            if (c < 0) { c = cols.length; cols.push(0); }
            cols[c] = it.to; it.col = c;
        }
        for (const it of items) it.cols = Math.max(...items.filter(o => o.from < it.to && o.to > it.from).map(o => o.col)) + 1;
        return items;
    }
    function timeGrid(days) {
        const today = iso(new Date());
        const head = `<div class="cal-head" style="--n:${days.length}"><div></div>${days.map(d => `<div class="col ${iso(d) === today ? 'today' : ''}"><span class="w">${WEEKDAYS[(d.getDay() + 6) % 7]}</span><span class="n">${d.getDate()}</span></div>`).join('')}</div>`;
        const allday = `<div class="cal-allday" style="--n:${days.length}"><div class="lbl">весь день</div>${days.map(d => `<div class="col" data-cell="${iso(d)}">${eventsOn(iso(d)).filter(e => e.allDay || !e.start).map(evPill).join('')}</div>`).join('')}</div>`;
        const hours = `<div class="cal-hours">${Array.from({ length: 24 }, (_, h) => `<div><span>${pad(h)}:00</span></div>`).join('')}</div>`;
        const cols = days.map(d => {
            const key = iso(d);
            const blocks = packed(eventsOn(key).filter(e => !e.allDay && e.start)).map(({ e, from, to, col, cols }) => {
                const c = calendarOf(e.calendar).color;
                return `<button class="cal-block ${e.done ? 'done' : ''}" style="--c:${c};top:${from / 60 * HOUR}px;height:${Math.max(22, (to - from) / 60 * HOUR - 2)}px;left:calc(${col / cols * 100}% + 2px);right:calc(${(cols - col - 1) / cols * 100}% + 3px)" data-open="${esc(e.id)}"><b>${esc(e.title)}</b><span>${e.start}${e.end ? '–' + e.end : ''}</span></button>`;
            }).join('');
            const now = new Date();
            return `<div class="cal-day ${key === today ? 'today' : ''}" data-slot="${key}" style="height:${24 * HOUR}px">${blocks}${key === today ? `<div class="cal-now" style="top:${(now.getHours() * 60 + now.getMinutes()) / 60 * HOUR}px"></div>` : ''}</div>`;
        }).join('');
        return `<div class="cal-sticky">${head}${allday}</div><div class="cal-grid" style="--n:${days.length}">${hours}${cols}</div>`;
    }

    // --- event sheet ---
    function sheet(initial) {
        const e = { title: '', date: selected, endDate: '', allDay: false, start: '09:00', end: '10:00', calendar: 'my', notes: '', ...initial };
        const isNew = !stored.some(s => s.id === e.id);
        const veil = document.createElement('div');
        veil.className = 'cal-veil';
        veil.innerHTML = `<div class="cal-sheet" role="dialog" aria-label="Событие">
            <input type="text" class="title" placeholder="Новое событие" value="${esc(e.title)}">
            <div class="row"><label>Календарь</label><select id="cs-cal">${CALENDARS.filter(c => !c.readonly).map(c => `<option value="${c.id}" ${c.id === e.calendar ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>
            <div class="row"><label>Весь день</label><input type="checkbox" id="cs-all" ${e.allDay ? 'checked' : ''} style="flex:none"></div>
            <div class="row"><label>Начало</label><input type="date" id="cs-date" value="${e.date}"><input type="time" id="cs-start" value="${e.start || '09:00'}"></div>
            <div class="row"><label>Конец</label><input type="date" id="cs-end-date" value="${e.endDate || e.date}"><input type="time" id="cs-end" value="${e.end || '10:00'}"></div>
            <textarea id="cs-notes" placeholder="Заметки">${esc(e.notes || '')}</textarea>
            <div class="acts">${isNew ? '' : '<button type="button" class="danger" data-s="del">Удалить</button>'}<button type="button" data-s="insert" title="Вставить дату в заметку">Дата в заметку</button><span class="spacer"></span><button type="button" data-s="cancel">Отмена</button><button type="button" class="primary" data-s="save">Сохранить</button></div></div>`;
        root.querySelector('.cal').append(veil);
        const q = s => veil.querySelector(s);
        const sync = () => { q('#cs-start').style.visibility = q('#cs-end').style.visibility = q('#cs-all').checked ? 'hidden' : ''; };
        q('#cs-all').addEventListener('change', sync); sync();
        setTimeout(() => q('.title').focus(), 0);
        const close = () => veil.remove();
        veil.addEventListener('mousedown', ev => { if (ev.target === veil) close(); });
        veil.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } else if (ev.key === 'Enter' && ev.target.matches('input')) q('[data-s="save"]').click(); });
        veil.addEventListener('click', ev => {
            const b = ev.target.closest('[data-s]');
            if (!b) return;
            if (b.dataset.s === 'cancel') close();
            else if (b.dataset.s === 'del') { stored = stored.filter(s => s.id !== e.id); save(); close(); draw(); }
            else if (b.dataset.s === 'insert') { tab.backToNote(); fgs.editor.insert(q('#cs-date').value); close(); }
            else {
                const next = { ...e, title: q('.title').value.trim() || 'Новое событие', calendar: q('#cs-cal').value, allDay: q('#cs-all').checked, date: q('#cs-date').value || e.date, start: q('#cs-start').value, end: q('#cs-end').value, notes: q('#cs-notes').value, endDate: q('#cs-end-date').value };
                if (next.endDate <= next.date) next.endDate = '';
                if (!next.allDay && next.endDate && next.endDate === next.date) next.endDate = '';
                stored = isNew ? [...stored, { ...next, id: next.id || uid() }] : stored.map(s => (s.id === e.id ? next : s));
                save(); close(); selected = next.date; cursor = fromIso(next.date); draw();
            }
        });
    }
    function openEvent(id) {
        const found = events.find(e => e.id === id);
        if (!found) return;
        if (found.calendar === 'note') {
            tab.backToNote();
            setTimeout(() => { const area = document.getElementById('markdown-editor'); const offset = area.value.split('\n').slice(0, found.line).join('\n').length + (found.line ? 1 : 0); area.focus(); area.setSelectionRange(offset, offset); }, 60);
            return;
        }
        const base = id.includes('#') ? id.split('#')[0] : id;
        sheet(stored.find(s => s.id === base) || found);
    }

    // --- drawing ---
    function draw() {
        collect();
        const scrollTop = (root.querySelector('.cal-view') || {}).scrollTop;
        root.innerHTML = `<div class="cal">
            <aside class="cal-side">
                <div>${miniMonth()}</div>
                <div><h4>Календари</h4><div class="cal-list">${CALENDARS.map(c => `<label class="cal-check ${hidden.has(c.id) ? 'off' : ''}" style="--c:${c.color}" data-cal="${c.id}"><i></i><span>${c.name}</span></label>`).join('')}</div></div>
                <div><h4>Ближайшие</h4><div class="cal-up">${upcoming()}</div></div>
            </aside>
            <section class="cal-main">
                <div class="cal-bar"><div class="cal-title">${titleText()}</div>
                    <div class="cal-seg" role="group" aria-label="Вид">${[['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц']].map(([id, n]) => `<button data-calview="${id}" class="${view === id ? 'on' : ''}">${n}</button>`).join('')}</div>
                    <div class="cal-nav"><button data-a="prev" aria-label="Назад">‹</button><button class="today-btn" data-a="today">Сегодня</button><button data-a="next" aria-label="Вперёд">›</button></div>
                    <button class="cal-plus" data-a="new" aria-label="Новое событие" title="Новое событие">+</button>
                    <button class="cal-plus" data-a="menu" aria-label="Ещё" title="Импорт и экспорт">…</button>
                </div>
                <div class="cal-view">${view === 'month' ? monthView() : view === 'week' ? timeGrid(Array.from({ length: 7 }, (_, i) => addDays(weekStart(cursor), i))) : timeGrid([cursor])}</div>
            </section></div>`;
        const scroller = root.querySelector('.cal-view');
        scroller.scrollTop = scrollTop !== undefined && view !== 'month' ? scrollTop : (view === 'month' ? 0 : Math.max(0, (new Date().getHours() - 2) * HOUR));
    }

    const step = dir => {
        if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
        else cursor = addDays(cursor, dir * (view === 'week' ? 7 : 1));
        selected = iso(cursor); draw();
    };
    root.addEventListener('click', async event => {
        const t = event.target;
        let el;
        if ((el = t.closest('[data-open]'))) return openEvent(el.dataset.open);
        if ((el = t.closest('[data-calview]'))) { view = el.dataset.calview; fgs.storage.set('view', view); return draw(); }
        if ((el = t.closest('[data-cal]'))) { event.preventDefault(); hidden.has(el.dataset.cal) ? hidden.delete(el.dataset.cal) : hidden.add(el.dataset.cal); fgs.storage.set('hidden', [...hidden]); return draw(); }
        if ((el = t.closest('[data-day]'))) { selected = el.dataset.day; cursor = fromIso(selected); return draw(); }
        if ((el = t.closest('[data-cell]'))) { if (selected !== el.dataset.cell) { selected = el.dataset.cell; root.querySelectorAll('.cal-cell.sel').forEach(c => c.classList.remove('sel')); el.classList.add('sel'); } return; }
        if ((el = t.closest('[data-a]'))) {
            const a = el.dataset.a;
            root.querySelectorAll('.cal-menu').forEach(m => m.remove());
            if (a === 'prev') step(-1); else if (a === 'next') step(1);
            else if (a === 'today') { cursor = new Date(); selected = iso(cursor); draw(); }
            else if (a === 'mprev') { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); draw(); }
            else if (a === 'mnext') { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); draw(); }
            else if (a === 'new') sheet({ date: selected });
            else if (a === 'menu') {
                const menu = document.createElement('div');
                menu.className = 'cal-menu';
                menu.innerHTML = '<button data-m="import">Импортировать .ics…</button><button data-m="export">Экспортировать мои события (.ics)</button><button data-m="insert">Вставить выбранную дату в заметку</button>';
                root.querySelector('.cal').append(menu);
                setTimeout(() => document.addEventListener('mousedown', function off(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', off); } }), 0);
            }
            return;
        }
        if ((el = t.closest('[data-m]'))) {
            el.closest('.cal-menu').remove();
            if (el.dataset.m === 'import') {
                const file = await fgs.pickFile({ accept: '.ics,text/calendar' });
                if (!file) return;
                const imported = parseIcs(file.data);
                stored = [...stored.filter(s => s.calendar !== 'import'), ...imported.slice(0, 5000)];
                save(); fgs.notify(`Импортировано событий: ${imported.length}`); draw();
            } else if (el.dataset.m === 'export') {
                const mine = stored.filter(s => s.calendar !== 'import');
                if (!mine.length) { fgs.notify('Своих событий пока нет'); return; }
                fgs.download('fgsnotes-calendar.ics', toIcs(mine), 'text/calendar;charset=utf-8');
            } else { tab.backToNote(); fgs.editor.insert(selected); }
        }
    });
    root.addEventListener('dblclick', event => {
        if (event.target.closest('[data-open]') || event.target.closest('.cal-veil')) return;
        const cell = event.target.closest('[data-cell]');
        if (cell) { selected = cell.dataset.cell; return sheet({ date: selected, allDay: true }); }
        const slot = event.target.closest('[data-slot]');
        if (slot) {
            const rect = slot.getBoundingClientRect(), mins = Math.floor((event.clientY - rect.top) / HOUR * 4) * 15;
            sheet({ date: slot.dataset.slot, start: hhmm(mins), end: hhmm(mins + 60) });
        }
    });
    // keep the red "now" line and the note's dates current
    timer = setInterval(() => { if (root.isConnected && root.offsetParent) draw(); }, 60000);
    tab.element.nbRefresh = draw;
    tab.element.addEventListener('plugin-view-show', draw);     // the note may have changed while another tab was in front
    fgs.onUnload(() => clearInterval(timer));
    draw();
}

fgs.addButton({ title: 'Календарь', icon: 'calendar', run: open });
