// ==FgsPlugin==
// @name        Презентация
// @version     1.0
// @description Собирает слайды из заметки и показывает их на весь экран. Слайды разделяются строкой ---, а без неё — заголовками первого и второго уровня. Экспорт в PDF через печать.
// @author      FgSNotes
// ==/FgsPlugin==
// Аналог Advanced Slides из Obsidian. Управление: стрелки, пробел, PageUp/PageDown, Home/End, F — полный экран, Esc — выход.

fgs.addStyle(`
.sl-back { position: fixed; inset: 0; z-index: 9500; display: flex; flex-direction: column; background: #101214; color: #f2f4f5; }
.sl-stage { flex: 1; display: grid; place-items: center; padding: 4vh 6vw; overflow: hidden; }
.sl-slide { width: min(1100px, 100%); max-height: 100%; overflow: auto; font-size: clamp(18px, 2.6vw, 34px); line-height: 1.45; }
.sl-slide h1 { font-size: 1.9em; line-height: 1.15; margin: 0 0 .5em; } .sl-slide h2 { font-size: 1.45em; margin: 0 0 .5em; } .sl-slide h3 { margin: 0 0 .4em; }
.sl-slide pre { padding: .7em 1em; border-radius: 10px; background: #1c1f23; font-size: .7em; overflow: auto; } .sl-slide img { max-width: 100%; max-height: 60vh; }
.sl-slide ul, .sl-slide ol { padding-left: 1.2em; } .sl-slide table { border-collapse: collapse; } .sl-slide td, .sl-slide th { border: 1px solid #444; padding: .2em .6em; }
.sl-bar { display: flex; align-items: center; gap: 8px; padding: 8px 14px; font-size: 13px; color: #aab; }
.sl-bar button { height: 30px; padding: 0 12px; border: 0; border-radius: 8px; background: rgba(255,255,255,.1); color: inherit; font: inherit; cursor: pointer; }
.sl-bar button:hover { background: rgba(255,255,255,.2); } .sl-grow { flex: 1; }
.sl-progress { height: 3px; background: rgba(255,255,255,.12); } .sl-progress i { display: block; height: 100%; background: var(--accent-color, #21aabe); transition: width .2s; }
.sl-print { display: none; }
@media print {
  body.sl-printing > *:not(.sl-print) { display: none !important; }
  body.sl-printing .sl-print { display: block; }
  .sl-print .sl-page { box-sizing: border-box; height: 100vh; padding: 12vh 8vw; page-break-after: always; color: #111; background: #fff; font-size: 28px; line-height: 1.4; display: flex; flex-direction: column; justify-content: center; }
  .sl-print .sl-page pre { background: #f2f2f2; padding: .5em; font-size: 18px; white-space: pre-wrap; } .sl-print img { max-width: 100%; max-height: 55vh; }
}`);

function split(text) {
    if (/^\s*(?:---|\*\*\*)\s*$/m.test(text)) {
        const parts = [];
        let current = [], code = false;
        for (const line of text.split('\n')) {
            if (/^```/.test(line)) code = !code;
            if (!code && /^\s*(?:---|\*\*\*)\s*$/.test(line)) { parts.push(current.join('\n')); current = []; } else current.push(line);
        }
        parts.push(current.join('\n'));
        return parts.map(part => part.trim()).filter(Boolean);
    }
    const parts = [];
    let current = [], code = false;
    for (const line of text.split('\n')) {
        if (/^```/.test(line)) code = !code;
        if (!code && /^#{1,2}\s/.test(line) && current.join('').trim()) { parts.push(current.join('\n')); current = []; }
        current.push(line);
    }
    parts.push(current.join('\n'));
    return parts.map(part => part.trim()).filter(Boolean);
}

function present() {
    const doc = fgs.documents().find(d => d.active);
    const slides = split(doc ? doc.content : '');
    if (!slides.length) { fgs.notify('В заметке нет текста для слайдов'); return; }
    let index = 0;
    const back = document.createElement('div');
    back.className = 'sl-back';
    back.innerHTML = '<div class="sl-progress"><i></i></div><div class="sl-stage"><div class="sl-slide"></div></div><div class="sl-bar"><span id="sl-n"></span><span class="sl-grow"></span><button type="button" data-a="prev">Назад</button><button type="button" data-a="next">Дальше</button><button type="button" data-a="pdf">Сохранить в PDF</button><button type="button" data-a="full">На весь экран</button><button type="button" data-a="close">Закрыть</button></div>';
    const slide = back.querySelector('.sl-slide');
    const show = i => {
        index = Math.max(0, Math.min(slides.length - 1, i));
        slide.innerHTML = fgs.markdown(slides[index]);
        back.querySelector('#sl-n').textContent = `${index + 1} / ${slides.length}`;
        back.querySelector('.sl-progress i').style.width = `${(index + 1) / slides.length * 100}%`;
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); if (document.fullscreenElement) document.exitFullscreen(); back.remove(); };
    function pdf() {
        const print = document.createElement('div');
        print.className = 'sl-print';
        print.innerHTML = slides.map(text => `<div class="sl-page">${fgs.markdown(text)}</div>`).join('');
        document.body.append(print);
        document.body.classList.add('sl-printing');
        const done = () => { document.body.classList.remove('sl-printing'); print.remove(); window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        setTimeout(() => { window.print(); setTimeout(done, 1500); }, 60);
    }
    function onKey(event) {
        const keys = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };
        if (event.key in keys) { event.preventDefault(); event.stopPropagation(); show(index + keys[event.key]); }
        else if (event.key === 'Home') show(0);
        else if (event.key === 'End') show(slides.length - 1);
        else if (event.key.toLowerCase() === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else back.requestFullscreen && back.requestFullscreen(); }
        else if (event.key === 'Escape') { event.stopPropagation(); close(); }
    }
    back.addEventListener('click', event => {
        const a = event.target.closest('[data-a]');
        if (!a) return;
        ({ prev: () => show(index - 1), next: () => show(index + 1), pdf, close, full: () => back.requestFullscreen && back.requestFullscreen() })[a.dataset.a]();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    fgs.onUnload(close);
    show(0);
}
fgs.addButton({ title: 'Презентация из заметки', icon: 'expand', run: present });
