// ==FgsPlugin==
// @name        Текст с картинки
// @version     1.0
// @description Распознаёт текст на скриншоте или фотографии (русский и английский) и вставляет его в заметку. При первом запуске скачивает модель распознавания, нужен интернет; дальше она хранится в браузере.
// @author      FgSNotes
// ==/FgsPlugin==
// Распознавание выполняет библиотека Tesseract.js прямо на вашем устройстве: картинка никуда не отправляется.

const SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
function loadLibrary() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = SRC;
        script.onload = () => resolve(window.Tesseract);
        script.onerror = () => reject(new Error('Не удалось загрузить распознавание: проверьте интернет'));
        document.head.appendChild(script);
    });
}

fgs.addButton({
    title: 'Текст с картинки (OCR)',
    icon: 'image',
    run() {
        const { body, close } = fgs.modal({ title: 'Текст с картинки', width: 560 });
        body.innerHTML = `<div class="pm-row"><button class="pm-btn primary" id="ocr-pick">Выбрать картинку</button>
            <select id="ocr-lang" style="width:auto"><option value="rus+eng">Русский и английский</option><option value="eng">Английский</option><option value="rus">Русский</option></select></div>
            <div class="pm-muted" id="ocr-msg">Поддерживаются PNG, JPG и WebP.</div>
            <textarea id="ocr-out" rows="9" style="margin-top:8px;display:none" aria-label="Распознанный текст"></textarea>
            <div class="pm-row" id="ocr-actions" style="display:none"><button class="pm-btn primary" id="ocr-insert">Вставить в заметку</button><button class="pm-btn" id="ocr-copy">Скопировать</button></div>`;
        const msg = body.querySelector('#ocr-msg'), out = body.querySelector('#ocr-out'), actions = body.querySelector('#ocr-actions');
        body.querySelector('#ocr-pick').addEventListener('click', async () => {
            const file = await fgs.pickFile({ accept: 'image/png,image/jpeg,image/webp,image/bmp', as: 'dataUrl' });
            if (!file) return;
            try {
                msg.textContent = 'Загружаю распознавание…';
                const T = await loadLibrary();
                const worker = await T.createWorker(body.querySelector('#ocr-lang').value, 1, { logger: m => { if (m.status) msg.textContent = `${m.status}${m.progress ? ' ' + Math.round(m.progress * 100) + '%' : ''}`; } });
                const { data } = await worker.recognize(file.data);
                await worker.terminate();
                out.value = data.text.trim();
                out.style.display = actions.style.display = '';
                msg.textContent = out.value ? 'Готово. Проверьте текст: ошибки в мелком шрифте возможны.' : 'Текст не найден.';
            } catch (error) { msg.textContent = error.message || String(error); }
        });
        body.querySelector('#ocr-insert').addEventListener('click', () => { fgs.editor.insert(out.value); close(); });
        body.querySelector('#ocr-copy').addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(out.value); fgs.notify('Скопировано'); });
    }
});
