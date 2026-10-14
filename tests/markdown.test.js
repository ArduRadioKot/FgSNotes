const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMarkdown } = require('../src/markdown');

test('unordered and ordered lists end before the next section', () => {
    const html = parseMarkdown('- First\n- Second\n\n## Heading\n\n1. One\n2. Two');
    assert.match(html, /<ul><li>First<\/li><li>Second<\/li><\/ul>\n<h2/);
    assert.match(html, /<ol start="1"><li>One<\/li><li>Two<\/li><\/ol>/);
});
test('code stays literal instead of becoming headings, links or HTML', () => {
    assert.equal(parseMarkdown('```js\n# literal\n**bold**\n<script>alert(1)</script>\n```'), '<pre><code class="language-js"># literal\n**bold**\n&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>');
});
test('images are parsed before links and unsafe URLs are excluded', () => {
    assert.match(parseMarkdown('![Description](https://example.com/image.png)'), /<img src="https:\/\/example.com\/image.png" alt="Description"/);
    assert.doesNotMatch(parseMarkdown('[click](javascript:alert(1))'), /href=/);
});
test('task lists preserve checked state and nested lists', () => {
    const html = parseMarkdown('- [x] Done\n- [ ] Pending\n  - Child');
    assert.match(html, /disabled checked><span>Done<\/span>/);
    assert.match(html, /disabled><span>Pending<\/span><ul><li>Child<\/li><\/ul>/);
});
test('table of contents uses existing unique heading targets', () => {
    const html = parseMarkdown('[toc]\n\n# Same\n\n## Same');
    assert.match(html, /href="#heading-1"/);
    assert.match(html, /id="heading-1"/);
    assert.match(html, /href="#heading-2"/);
    assert.match(html, /id="heading-2"/);
});
test('tables preserve empty cells and inline formatting', () => {
    const html = parseMarkdown('| A | B |\n| --- | --- |\n| **yes** | |');
    assert.match(html, /<td><strong>yes<\/strong><\/td><td><\/td>/);
});

test('LaTeX: inline and block formulas keep their source, prices stay text', () => {
    const inline = parseMarkdown('Area $a_1*b_2$ costs $5 or $10');
    assert.match(inline, /<span class="math" data-tex="a_1\*b_2">/);
    assert.match(inline, /costs \$5 or \$10/);
    assert.match(parseMarkdown('$$\n\\int_0^1 x\\,dx\n$$'), /<div class="math-block" data-tex="\\int_0\^1 x\\,dx">/);
    assert.match(parseMarkdown('$$E=mc^2$$'), /<div class="math-block" data-tex="E=mc\^2">/);
});
test('LaTeX: formulas inside code stay literal', () => {
    assert.doesNotMatch(parseMarkdown('`$x$`'), /class="math"/);
});

test('js-cell fences become runnable notebook cells, plain js stays a code sample', () => {
    const cell = parseMarkdown('```js-cell\nconsole.log(1 < 2)\n```');
    assert.match(cell, /<div class="nb-cell" data-code="console\.log\(1 &lt; 2\)">/);
    const plain = parseMarkdown('```js\nlet a = 1\n```');
    assert.doesNotMatch(plain, /nb-cell/);
    assert.match(plain, /<pre><code class="language-js">/);
});
