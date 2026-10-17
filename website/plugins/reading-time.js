// ==FgsPlugin==
// @name        Время чтения
// @version     1.0
// @description Показывает над предпросмотром, сколько минут займёт чтение заметки
// @author      FgSNotes
// ==/FgsPlugin==
fgs.addStyle('.reading-time { margin: 0 0 1em; color: var(--text-muted); font-size: .9em; }');
fgs.onPreview(preview => {
    const words = preview.innerText.trim().split(/\s+/).filter(Boolean).length;
    if (!words) return;
    const note = document.createElement('p');
    note.className = 'reading-time';
    note.textContent = `Чтение: ${Math.max(1, Math.round(words / 180))} мин`;
    preview.prepend(note);
});
