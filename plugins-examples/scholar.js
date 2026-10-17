// ==FgsPlugin==
// @name        Научная статья по ссылке
// @version     1.1
// @description Вставьте ссылку на arXiv или DOI статьи: плагин создаст заметку с названием, авторами, аннотацией и записью BibTeX. Данные берутся из открытой базы OpenAlex, нужен интернет.
// @author      FgSNotes
// ==/FgsPlugin==
// Аналог Scholar из Obsidian. Подходит ссылка вида arxiv.org/abs/1706.03762, номер 1706.03762 или DOI (10.1038/nature14539).

const parse = text => {
    const t = text.trim().replace(/\.pdf$/i, '');
    const doi = /(10\.\d{4,9}\/[^\s"<>]+)/i.exec(t);
    if (doi && !/arxiv\.org/i.test(t)) return doi[1];
    const ax = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:)?(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i.exec(t);
    return ax ? `10.48550/arXiv.${ax[1]}` : null;
};
const abstractOf = index => {
    if (!index) return '';
    const words = [];
    for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
    return words.join(' ');
};

async function load(doi) {
    const response = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`);
    if (response.status === 404) throw new Error('Статья не найдена. Проверьте ссылку или номер');
    if (!response.ok) throw new Error(`База ответила кодом ${response.status}`);
    const w = await response.json();
    const authors = (w.authorships || []).map(a => a.author.display_name);
    const year = w.publication_year || '';
    const venue = (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '';
    const arxiv = /arxiv\.(?:org\/abs\/|)(\d{4}\.\d{4,5})/i.exec(doi + ' ' + (w.ids && w.ids.doi || '') + ' ' + ((w.locations || []).map(l => l.landing_page_url).join(' ')));
    const link = arxiv ? `https://arxiv.org/abs/${arxiv[1]}` : (w.primary_location && w.primary_location.landing_page_url) || `https://doi.org/${doi}`;
    const key = `${(authors[0] || 'paper').split(' ').pop().toLowerCase().replace(/[^a-z]/g, '') || 'paper'}${year}`;
    return [
        `# ${w.display_name}`, '',
        `**Авторы:** ${authors.join(', ')}`, '',
        `**Год:** ${year}${venue ? ` · ${venue}` : ''}`, '',
        `[Статья](${link})${arxiv ? ` · [PDF](https://arxiv.org/pdf/${arxiv[1]})` : ''}`, '',
        '## Аннотация', '', abstractOf(w.abstract_inverted_index) || '_Аннотации в базе нет._', '',
        '## Заметки', '', '- ', '',
        '## BibTeX', '', '```bibtex',
        `@article{${key},`, `  title   = {${w.display_name}},`, `  author  = {${authors.join(' and ')}},`, `  year    = {${year}},`, ...(venue ? [`  journal = {${venue}},`] : []), `  url     = {${link}}`, '}', '```', ''
    ].join('\n');
}

fgs.addButton({
    title: 'Научная статья по ссылке',
    icon: 'external',
    run() {
        const { body, close } = fgs.modal({ title: 'Научная статья по ссылке', width: 520 });
        body.innerHTML = `<p class="pm-muted">Ссылка на arXiv, номер статьи (1706.03762) или DOI</p>
            <div class="pm-row"><input type="text" id="ax-in" placeholder="https://arxiv.org/abs/1706.03762"></div>
            <div class="pm-row"><button class="pm-btn primary" id="ax-go">Создать заметку</button><span class="pm-muted" id="ax-msg"></span></div>`;
        const input = body.querySelector('#ax-in'), msg = body.querySelector('#ax-msg');
        const go = async () => {
            const doi = parse(input.value);
            if (!doi) { msg.textContent = 'Не нашёл номер arXiv или DOI в этой строке'; return; }
            msg.textContent = 'Загружаю…';
            try {
                const text = await load(doi);
                fgs.createDocument(/^# (.+)/.exec(text)[1].slice(0, 60), text);
                close();
            } catch (error) { msg.textContent = /Failed to fetch|NetworkError/.test(error.message) ? 'Нет доступа к базе: проверьте интернет' : error.message; }
        };
        body.querySelector('#ax-go').addEventListener('click', go);
        input.addEventListener('keydown', event => { if (event.key === 'Enter') go(); });
        setTimeout(() => input.focus(), 0);
    }
});
