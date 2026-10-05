// Offline syntax highlighting: a small tokenizer for code blocks plus a Markdown highlighter for the editor.
// Output is escaped HTML with <span class="tok-*"> wrappers, coloured by the theme tokens in styles.css.
(function (root) {
    const escapeHTML = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const words = list => `\\b(?:${list.split(' ').join('|')})\\b`;

    const cLikeKeywords = 'abstract as async await break case catch class const continue debugger default delete do else enum export extends final finally for from function get if implements import in instanceof interface let namespace new of override package private protected public readonly return set static super switch this throw try type typeof var void volatile while with yield fn impl mod pub use mut match loop trait struct where func go defer chan select range int long float double char bool string boolean unsigned signed extern inline template typename virtual operator';
    const pythonKeywords = 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls';
    const shellKeywords = 'if then else elif fi for while do done case esac function in return export local source alias cd echo exit set unset sudo';
    const sqlKeywords = 'select from where insert into values update set delete create alter drop table index view join left right inner outer full on group by order having limit offset as and or not null is in like between distinct union all case when then else end primary key foreign references default unique count sum avg min max';
    const literals = 'true false null undefined nil None True False NaN Infinity';

    const number = '\\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b';
    const dq = '"(?:\\\\.|[^"\\\\\\n])*"';
    const sq = "'(?:\\\\.|[^'\\\\\\n])*'";
    const bt = '`(?:\\\\[\\s\\S]|[^`\\\\])*`';
    const call = '\\b[A-Za-z_$][\\w$]*(?=\\s*\\()';
    const typeName = '\\b[A-Z][A-Za-z0-9_]*\\b';

    const cLike = [
        ['comment', '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)'],
        ['string', `${dq}|${sq}|${bt}`],
        ['annotation', '@[A-Za-z_][\\w.]*'],
        ['keyword', words(cLikeKeywords)],
        ['literal', words(literals)],
        ['number', number],
        ['function', call],
        ['type', typeName]
    ];
    const python = [
        ['comment', '#[^\\n]*'],
        ['string', `(?:[rbfRBF]{0,2})(?:"""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$)|${dq}|${sq})`],
        ['annotation', '@[A-Za-z_][\\w.]*'],
        ['keyword', words(pythonKeywords)],
        ['literal', words(literals)],
        ['number', number],
        ['function', call],
        ['type', typeName]
    ];
    const shell = [
        ['comment', '(?:^|\\s)#[^\\n]*'],
        ['string', `${dq}|${sq}`],
        ['variable', '\\$(?:\\{[^}]*\\}|[A-Za-z_]\\w*|\\d)'],
        ['keyword', words(shellKeywords)],
        ['number', number],
        ['attr', '(?:^|\\s)--?[A-Za-z][\\w-]*']
    ];
    const yaml = [
        ['comment', '#[^\\n]*'],
        ['string', `${dq}|${sq}`],
        ['field', '^[ \\t-]*[\\w.-]+(?=:)'],
        ['literal', words('true false null yes no on off')],
        ['number', number]
    ];
    const json = [
        ['field', `${dq}(?=\\s*:)`],
        ['string', dq],
        ['literal', words('true false null')],
        ['number', '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?']
    ];
    const markup = [
        ['comment', '<!--[\\s\\S]*?(?:-->|$)'],
        ['tag', '<\\/?[A-Za-z][\\w:.-]*|\\/?>'],
        ['attr', '[A-Za-z_:][\\w:.-]*(?=\\s*=)'],
        ['string', `${dq}|${sq}`]
    ];
    const css = [
        ['comment', '\\/\\*[\\s\\S]*?(?:\\*\\/|$)'],
        ['string', `${dq}|${sq}`],
        ['annotation', '@[\\w-]+'],
        ['number', '#[0-9a-fA-F]{3,8}\\b|-?\\d*\\.?\\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\\b'],
        ['attr', '[\\w-]+(?=\\s*:(?!:))'],
        ['tag', '[.#][\\w-]+|::?[\\w-]+'],
        ['function', call]
    ];
    const sql = [
        ['comment', '--[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)'],
        ['string', sq],
        ['keyword', words(sqlKeywords)],
        ['literal', words('true false null')],
        ['number', number],
        ['function', call]
    ];
    const languages = {
        c: cLike, cpp: cLike, java: cLike, js: cLike, jsx: cLike, ts: cLike, tsx: cLike, javascript: cLike, typescript: cLike,
        cs: cLike, csharp: cLike, go: cLike, rust: cLike, rs: cLike, kotlin: cLike, kt: cLike, swift: cLike, php: cLike, dart: cLike,
        python: python, py: python, ruby: python, rb: python, toml: python,
        sh: shell, bash: shell, shell: shell, zsh: shell, console: shell,
        yaml: yaml, yml: yaml, json: json, jsonc: json,
        html: markup, xml: markup, svg: markup, vue: markup,
        css: css, scss: css, less: css,
        sql: sql
    };
    const generic = [['string', `${dq}|${sq}`], ['number', number]];
    const compiled = new Map();

    function compile(rules, flags) {
        const key = rules + flags;
        if (!compiled.has(key)) compiled.set(key, new RegExp(rules.map(rule => `(${rule[1]})`).join('|'), `g${flags}`));
        return compiled.get(key);
    }

    function highlightCode(code, language = '') {
        const name = String(language).toLowerCase();
        const rules = languages[name] || generic;
        const pattern = compile(rules, name === 'sql' ? 'im' : 'm');
        pattern.lastIndex = 0;
        let html = '', last = 0, match;
        while ((match = pattern.exec(code))) {
            if (!match[0]) { pattern.lastIndex++; continue; }
            const group = match.findIndex((value, index) => index > 0 && value !== undefined) - 1;
            // Shell comments and flags are matched with a leading space; keep it outside the span.
            const lead = /^\s/.test(match[0]) && (rules[group][0] === 'comment' || rules[group][0] === 'attr') ? 1 : 0;
            html += escapeHTML(code.slice(last, match.index + lead));
            html += `<span class="tok-${rules[group][0]}">${escapeHTML(match[0].slice(lead))}</span>`;
            last = match.index + match[0].length;
        }
        return html + escapeHTML(code.slice(last));
    }

    // Markdown highlighting for the editor overlay. Keeps the text 1:1 so it lines up with the textarea.
    function highlightInlineText(text) {
        return escapeHTML(text)
            .replace(/(!?\[)([^\]\n]*)(\]\()([^)\n]*)(\))/g, '<span class="tok-md-mark">$1</span><span class="tok-md-link">$2</span><span class="tok-md-mark">$3</span><span class="tok-md-url">$4</span><span class="tok-md-mark">$5</span>')
            .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '<span class="tok-md-mark">$1</span><span class="tok-md-bold">$2</span><span class="tok-md-mark">$1</span>')
            .replace(/(^|[^*\w])(\*|_)(?=\S)([^*_\n]*?\S)\2(?![*\w])/g, '$1<span class="tok-md-mark">$2</span><span class="tok-md-italic">$3</span><span class="tok-md-mark">$2</span>')
            .replace(/(~~)(?=\S)([^\n]*?\S)\1/g, '<span class="tok-md-mark">$1</span><span class="tok-md-strike">$2</span><span class="tok-md-mark">$1</span>')
            .replace(/(&lt;\/?[A-Za-z][^&\n]*?&gt;)/g, '<span class="tok-tag">$1</span>');
    }
    // Code spans are cut out first so emphasis markers inside them stay literal.
    function highlightInline(line) {
        return line.split(/((`+)[^`\n]+?\2)/).reduce((html, part, index, parts) => {
            if (index % 3 === 2) return html;
            return html + (index % 3 === 1 ? `<span class="tok-md-code">${escapeHTML(part)}</span>` : highlightInlineText(part));
        }, '');
    }
    function highlightMarkdown(source) {
        const lines = source.split('\n');
        const out = [];
        let fence = null, buffer = [];
        const flush = () => { if (buffer.length) out.push(highlightCode(buffer.join('\n'), fence.language)); buffer = []; };
        for (const line of lines) {
            const open = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w+-]*)(.*)$/);
            if (fence) {
                if (open && open[2][0] === fence.marker && open[2].length >= fence.length && !open[3] && !open[4].trim()) {
                    flush();
                    out.push(`<span class="tok-md-fence">${escapeHTML(line)}</span>`);
                    fence = null;
                } else buffer.push(line);
                continue;
            }
            if (open) {
                fence = { marker: open[2][0], length: open[2].length, language: open[3] };
                out.push(`<span class="tok-md-fence">${escapeHTML(open[1] + open[2])}</span><span class="tok-annotation">${escapeHTML(open[3])}</span>${escapeHTML(open[4])}`);
                continue;
            }
            let match;
            if ((match = line.match(/^(#{1,6})(\s+)(.*)$/))) out.push(`<span class="tok-md-mark">${match[1]}</span>${match[2]}<span class="tok-md-heading">${highlightInline(match[3])}</span>`);
            else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) out.push(`<span class="tok-md-mark">${escapeHTML(line)}</span>`);
            else if ((match = line.match(/^(\s*)(&gt;|>)(\s?)(.*)$/))) out.push(`${match[1]}<span class="tok-md-mark">&gt;</span>${match[3]}<span class="tok-md-quote">${highlightInline(match[4])}</span>`);
            else if ((match = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\])?(\s?)(.*)$/))) out.push(`${match[1]}<span class="tok-md-list">${match[2]}</span>${match[3]}${match[4] ? `<span class="tok-md-task">${match[4]}</span>` : ''}${match[5]}${highlightInline(match[6])}`);
            else out.push(highlightInline(line));
        }
        if (fence) flush();
        return out.join('\n');
    }

    const api = { highlightCode, highlightMarkdown, escapeHTML };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
