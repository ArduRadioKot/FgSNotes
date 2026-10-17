// ==FgsPlugin==
// @name        Вставить дату
// @version     1.0
// @description Кнопка в панели форматирования вставляет сегодняшнюю дату и время
// @author      FgSNotes
// ==/FgsPlugin==
fgs.addButton({
    title: 'Вставить дату и время',
    icon: 'history',
    run: editor => {
        editor.insert(new Date().toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' }));
        fgs.notify('Дата вставлена');
    }
});
