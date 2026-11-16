// The same insertions as the formatting toolbar in the window.
const FORMATS = {
    heading: ['## ', '', 'Заголовок', true],
    bold: ['**', '**', 'текст'],
    italic: ['*', '*', 'текст'],
    strike: ['~~', '~~', 'текст'],
    underline: ['<u>', '</u>', 'текст'],
    list: ['- ', '', 'Элемент списка', true],
    task: ['- [ ] ', '', 'Новая задача', true],
    quote: ['> ', '', 'Цитата', true],
    link: ['[', '](https://example.com)', 'текст ссылки'],
    image: ['![', '](https://example.com/image.png)', 'Описание изображения'],
    code: ['```\n', '\n```', 'код', true],
    cell: ['```js-cell\n', '\n```', 'console.log("Привет!");', true],
    sup: ['<sup>', '</sup>', 'текст'],
    sub: ['<sub>', '</sub>', 'текст']
};

function applyFormat(buffer, name, translate) {
    const spec = FORMATS[name];
    if (!spec) return false;
    const sel = buffer.selection();
    const from = sel ? sel.from : buffer.cursor;
    const to = sel ? sel.to : buffer.cursor;
    const picked = buffer.text.slice(from, to);
    const selected = picked || (translate ? translate(spec[2]) : spec[2]);
    const block = !!spec[3];
    const prefix = block && from > 0 && buffer.text[from - 1] !== '\n' ? '\n' : '';
    const suffix = block && to < buffer.text.length && buffer.text[to] !== '\n' ? '\n' : '';
    const replacement = prefix + spec[0] + selected + spec[1] + suffix;
    const selFrom = from + prefix.length + spec[0].length;
    buffer.replaceRange(from, to, replacement, selFrom, selFrom + selected.length);
    return true;
}

module.exports = { FORMATS, applyFormat };
