document.addEventListener('DOMContentLoaded', () => {
    const wrapper = document.querySelector('.editor-wrapper');
    const divider = document.querySelector('.panel-divider');
    let ratio = Number(localStorage.getItem('editorRatio')) || 50;
    function updatePanels(value) {
        ratio = Math.max(25, Math.min(75, value));
        wrapper.style.setProperty('--editor-ratio', `${ratio}%`);
        divider.setAttribute('aria-valuenow', Math.round(ratio));
    }
    function persist() { localStorage.setItem('editorRatio', ratio); }
    divider.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        divider.setPointerCapture(event.pointerId);
        divider.classList.add('dragging');
        document.body.classList.add('resizing');
        event.preventDefault();
    });
    divider.addEventListener('pointermove', event => {
        if (!divider.hasPointerCapture(event.pointerId)) return;
        const bounds = wrapper.getBoundingClientRect();
        updatePanels((event.clientX - bounds.left) / bounds.width * 100);
    });
    function stopDragging() {
        divider.classList.remove('dragging');
        document.body.classList.remove('resizing');
        persist();
    }
    divider.addEventListener('pointerup', event => {
        if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
        stopDragging();
    });
    divider.addEventListener('lostpointercapture', stopDragging);
    divider.addEventListener('pointercancel', stopDragging);
    divider.addEventListener('dblclick', () => { updatePanels(50); persist(); });
    divider.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
        event.preventDefault();
        updatePanels(event.key === 'Home' ? 50 : ratio + (event.key === 'ArrowRight' ? 5 : -5));
        persist();
    });
    updatePanels(ratio);
});
