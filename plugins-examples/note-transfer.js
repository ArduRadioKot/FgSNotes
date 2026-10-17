// ==FgsPlugin==
// @name        Перенос заметок
// @version     1.0
// @description Сохраняет все открытые заметки одним файлом и загружает их на другом устройстве. Файл можно положить в папку Syncthing, iCloud, Dropbox или отправить себе.
// @author      FgSNotes
// ==/FgsPlugin==
// Замена синхронизации (в Obsidian для этого берут Syncthing): FgSNotes сам ничего не отправляет, перенос делаете вы. Формат файла — обычный JSON.

fgs.addButton({
    title: 'Перенос заметок между устройствами',
    icon: 'refresh',
    run() {
        const { body, close } = fgs.modal({ title: 'Перенос заметок', width: 560 });
        const docs = fgs.documents();
        body.innerHTML = `<p class="pm-muted">Откройте это окно на обоих устройствах: на одном сохраните файл, на другом загрузите его. Положите файл в папку Syncthing, iCloud Drive или Dropbox — и переносить заметки можно без ручной отправки.</p>
            <div class="pm-row"><button class="pm-btn primary" data-a="save">Сохранить ${docs.length} ${docs.length === 1 ? 'заметку' : 'заметок'} в файл</button><button class="pm-btn" data-a="load">Загрузить из файла</button></div><div class="pm-muted" id="nt-msg"></div>`;
        const msg = body.querySelector('#nt-msg');
        body.addEventListener('click', async event => {
            const a = event.target.closest('[data-a]');
            if (!a) return;
            if (a.dataset.a === 'save') {
                const bundle = { format: 'fgsnotes-bundle', version: 1, saved: new Date().toISOString(), notes: docs.map(d => ({ title: d.title, content: d.content })) };
                fgs.download(`fgsnotes-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json');
                msg.textContent = 'Файл сохранён.';
            } else {
                const file = await fgs.pickFile({ accept: '.json,application/json' });
                if (!file) return;
                let bundle;
                try { bundle = JSON.parse(file.data); } catch { msg.textContent = 'Это не файл переноса: не удалось прочитать JSON.'; return; }
                if (bundle.format !== 'fgsnotes-bundle' || !Array.isArray(bundle.notes)) { msg.textContent = 'Это не файл переноса FgSNotes.'; return; }
                // A note that is already open with the same text is skipped; one with the same title and other text is added as a copy.
                const have = new Set(fgs.documents().map(d => d.title + '\u0000' + d.content));
                let added = 0;
                for (const note of bundle.notes) {
                    if (typeof note.content !== 'string' || have.has(note.title + '\u0000' + note.content)) continue;
                    fgs.createDocument(String(note.title || 'Заметка'), note.content);
                    added++;
                }
                msg.textContent = added ? `Добавлено заметок: ${added}.` : 'Все заметки из файла уже открыты.';
                if (added) setTimeout(close, 900);
            }
        });
    }
});
