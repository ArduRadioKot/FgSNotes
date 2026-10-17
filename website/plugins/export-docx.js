// ==FgsPlugin==
// @name        Экспорт заметки
// @version     1.0
// @description Сохраняет текущую заметку как Word (.docx), HTML, простой текст или PDF. Работает без Pandoc и без интернета.
// @author      FgSNotes
// ==/FgsPlugin==
// Для самых частых случаев. В .docx попадают заголовки, абзацы, списки, цитаты, код, таблицы, жирный, курсив и ссылки;
// картинки заменяются подписью.

// --- a minimal ZIP writer (stored, no compression): .docx is a zip of XML files ---------------------------------------------
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = bytes => { let c = 0xFFFFFFFF; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    for (const [name, text] of Object.entries(files)) {
        const nameBytes = enc.encode(name), data = enc.encode(text), crc = crc32(data);
        const head = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), 0, 0]);
        parts.push(head, nameBytes, data);
        central.push(new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(offset)]), nameBytes);
        offset += head.length + nameBytes.length + data.length;
    }
    const centralSize = central.reduce((s, p) => s + p.length, 0), count = Object.keys(files).length;
    const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(count), ...u16(count), ...u32(centralSize), ...u32(offset), 0, 0]);
    return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// --- Markdown -> WordprocessingML -------------------------------------------------------------------------------------------
const x = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const run = (text, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
function inline(text, base = '') {
    let out = '';
    const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|~~([^~]+)~~|`([^`]+)`|!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\(([^)]+)\))/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
        if (m.index > last) out += run(text.slice(last, m.index), base);
        if (m[2] || m[3]) out += run(m[2] || m[3], base + '<w:b/>');
        else if (m[4] || m[5]) out += run(m[4] || m[5], base + '<w:i/>');
        else if (m[6]) out += run(m[6], base + '<w:strike/>');
        else if (m[7]) out += run(m[7], base + '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="EEEEEE"/>');
        else if (m[8] !== undefined) out += run(`[${m[8] || 'рисунок'}]`, base + '<w:i/>');
        else out += run(`${m[9]} (${m[10]})`, base + '<w:color w:val="1F6FEB"/><w:u w:val="single"/>');
        last = m.index + m[0].length;
    }
    return out + (last < text.length ? run(text.slice(last), base) : '');
}
const para = (content, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${content}</w:p>`;
function body(markdown) {
    const lines = markdown.replace(/\r/g, '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let m;
        if (/^```/.test(line)) {
            const code = [];
            while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
            for (const c of code.length ? code : ['']) out.push(para(run(c, '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/>'), '<w:shd w:val="clear" w:fill="F3F3F3"/><w:spacing w:after="0"/>'));
        } else if ((m = /^(#{1,6})\s+(.*)/.exec(line))) out.push(para(inline(m[2]), `<w:pStyle w:val="Heading${Math.min(m[1].length, 3)}"/>`));
        else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) out.push(para('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>'));
        else if ((m = /^(\s*)[-*+]\s+(?:\[([ xX])\]\s+)?(.*)/.exec(line))) out.push(para(inline((m[2] ? (m[2] === ' ' ? '☐ ' : '☑ ') : '• ') + m[3]), `<w:ind w:left="${360 + Math.floor(m[1].length / 2) * 360}" w:hanging="260"/><w:spacing w:after="40"/>`));
        else if ((m = /^(\s*)(\d+)[.)]\s+(.*)/.exec(line))) out.push(para(inline(`${m[2]}. ${m[3]}`), `<w:ind w:left="${360 + Math.floor(m[1].length / 2) * 360}" w:hanging="300"/><w:spacing w:after="40"/>`));
        else if (/^>\s?/.test(line)) out.push(para(inline(line.replace(/^>\s?/, ''), '<w:i/>'), '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="AAAAAA"/></w:pBdr><w:ind w:left="360"/>'));
        else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-+/.test(lines[i + 1] || '')) {
            const rows = [];
            while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i]) || rows.length === 0) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())); i++; }
            i--;
            const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:color="999999"/>`).join('');
            out.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${rows.map((r, ri) => `<w:tr>${r.map(c => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(inline(c, ri ? '' : '<w:b/>'))}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`, para(''));
        } else if (!line.trim()) continue;
        else {
            const text = [line];
            while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i + 1])) text.push(lines[++i]);
            out.push(para(inline(text.join(' ')), '<w:spacing w:after="120"/>'));
        }
    }
    return out.join('');
}
function docx(markdown) {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const style = (id, name, size, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/>${extra}</w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
    return zip({
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${style('Heading1', 'heading 1', 40)}${style('Heading2', 'heading 2', 32)}${style('Heading3', 'heading 3', 26)}</w:styles>`,
        'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body(markdown)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
    });
}

// --- other formats ----------------------------------------------------------------------------------------------------------
const html = (title, markdown) => `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${x(title)}</title><style>body{max-width:760px;margin:40px auto;padding:0 20px;font:16px/1.6 system-ui,sans-serif;color:#222}pre{background:#f4f4f4;padding:12px;border-radius:8px;overflow:auto}code{background:#f4f4f4;padding:1px 4px;border-radius:4px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 10px}blockquote{margin:0;padding-left:14px;border-left:3px solid #bbb;color:#555}img{max-width:100%}</style></head><body>${fgs.markdown(markdown)}</body></html>`;
const plain = markdown => markdown.replace(/^```.*$/gm, '').replace(/^#{1,6}\s+/gm, '').replace(/(\*\*|__|~~|`)/g, '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
function pdf(markdown) {
    fgs.addStyle('@media print { body.ex-printing > *:not(.ex-print) { display: none !important } body.ex-printing .ex-print { display: block } } .ex-print { display: none } .ex-print { color: #111; background: #fff; padding: 0 12mm; font: 14px/1.6 system-ui, sans-serif } .ex-print pre { background: #f3f3f3; padding: 8px; white-space: pre-wrap } .ex-print img { max-width: 100% }');
    const box = document.createElement('div');
    box.className = 'ex-print';
    box.innerHTML = fgs.markdown(markdown);
    document.body.append(box);
    document.body.classList.add('ex-printing');
    const done = () => { document.body.classList.remove('ex-printing'); box.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(done, 1500); }, 60);
}

fgs.addButton({
    title: 'Экспорт заметки (Word, HTML, PDF)',
    icon: 'download',
    run() {
        const note = fgs.documents().find(d => d.active) || { title: 'Заметка', content: '' };
        const base = (note.title || 'Заметка').replace(/\.md$/i, '').replace(/[\\/:*?"<>|]/g, '_');
        const { body, close } = fgs.modal({ title: 'Экспорт заметки', width: 420 });
        body.innerHTML = '<div style="display:grid;gap:6px"><button class="pm-btn" data-f="docx">Word (.docx)</button><button class="pm-btn" data-f="html">Веб-страница (.html)</button><button class="pm-btn" data-f="pdf">PDF (через печать)</button><button class="pm-btn" data-f="txt">Простой текст (.txt)</button></div>';
        body.addEventListener('click', event => {
            const f = (event.target.closest('[data-f]') || {}).dataset && event.target.closest('[data-f]').dataset.f;
            if (!f) return;
            close();
            if (f === 'docx') fgs.download(`${base}.docx`, docx(note.content));
            else if (f === 'html') fgs.download(`${base}.html`, html(base, note.content), 'text/html;charset=utf-8');
            else if (f === 'txt') fgs.download(`${base}.txt`, plain(note.content));
            else pdf(note.content);
        });
    }
});
