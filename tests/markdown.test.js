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
