document.addEventListener('DOMContentLoaded', () => {
    const editorWrapper = document.querySelector('.editor-wrapper');
    const panelDivider = document.querySelector('.panel-divider');
    const editorColumn = document.querySelector('.editor-column');
    const previewColumn = document.querySelector('.preview-column');

    let isDragging = false;
    let startX;
    let startWidth;

    // Функция для обновления размеров панелей
    function updatePanels(width) {
        const wrapperWidth = editorWrapper.offsetWidth;
        const minWidth = 200; // Минимальная ширина панели
        const dividerWidth = 4; // Ширина разделителя

        // Ограничиваем ширину панелей
        if (width < minWidth) width = minWidth;
        if (width > wrapperWidth - minWidth - dividerWidth) {
            width = wrapperWidth - minWidth - dividerWidth;
        }

        // Обновляем размеры панелей
        editorColumn.style.width = `${width}px`;
        previewColumn.style.width = `${wrapperWidth - width - dividerWidth}px`;
    }

    // Обработчик начала перетаскивания
    panelDivider.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startWidth = editorColumn.offsetWidth;
        panelDivider.classList.add('dragging');
        
        // Предотвращаем выделение текста при перетаскивании
        e.preventDefault();
    });

    // Обработчик движения мыши
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const newWidth = startWidth + deltaX;
        updatePanels(newWidth);
    });

    // Обработчик окончания перетаскивания
    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        
        isDragging = false;
        panelDivider.classList.remove('dragging');
    });

    // Обработчик изменения размера окна
    window.addEventListener('resize', () => {
        if (!isDragging) {
            const currentWidth = editorColumn.offsetWidth;
            updatePanels(currentWidth);
        }
    });

    // Инициализация размеров при загрузке
    const initialWidth = editorWrapper.offsetWidth / 2;
    updatePanels(initialWidth);
}); 