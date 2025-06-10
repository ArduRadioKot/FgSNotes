document.addEventListener('DOMContentLoaded', () => {
    const editorWrapper = document.querySelector('.editor-wrapper');
    const panelDivider = document.querySelector('.panel-divider');
    const editorColumn = document.querySelector('.editor-column');
    const previewColumn = document.querySelector('.preview-column');

    let isDragging = false;
    let startX;
    let startWidth;

    function updatePanels(width) {
        const wrapperWidth = editorWrapper.offsetWidth;
        const minWidth = 200;
        const dividerWidth = 4;

        if (width < minWidth) width = minWidth;
        if (width > wrapperWidth - minWidth - dividerWidth) {
            width = wrapperWidth - minWidth - dividerWidth;
        }

        editorColumn.style.width = `${width}px`;
        previewColumn.style.width = `${wrapperWidth - width - dividerWidth}px`;
    }

    panelDivider.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startWidth = editorColumn.offsetWidth;
        panelDivider.classList.add('dragging');
        
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const newWidth = startWidth + deltaX;
        updatePanels(newWidth);
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        
        isDragging = false;
        panelDivider.classList.remove('dragging');
    });

    window.addEventListener('resize', () => {
        if (!isDragging) {
            const currentWidth = editorColumn.offsetWidth;
            updatePanels(currentWidth);
        }
    });

    const initialWidth = editorWrapper.offsetWidth / 2;
    updatePanels(initialWidth);
}); 