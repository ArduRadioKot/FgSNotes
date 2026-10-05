const { test } = require('node:test');
const assert = require('node:assert/strict');
const { highlightCode, highlightMarkdown } = require('../src/highlight');

test('code tokens are wrapped and HTML is escaped', () => {
    const html = highlightCode('const a = "<b>"; // note\nfoo(1)', 'js');
    assert.match(html, /<span class="tok-keyword">const<\/span>/);
    assert.match(html, /<span class="tok-string">&quot;|<span class="tok-string">"&lt;b&gt;"<\/span>/);
    assert.match(html, /<span class="tok-comment">\/\/ note<\/span>/);
    assert.match(html, /<span class="tok-function">foo<\/span>/);
    assert.doesNotMatch(html, /<b>/);
});
test('code text survives highlighting unchanged for every supported language', () => {
    const sample = 'x = "a" # c\n<div class="a">1</div> {"k": [1, true]} SELECT 1; $HOME -f';
    for (const lang of ['js', 'python', 'sh', 'json', 'html', 'css', 'sql', 'yaml', 'unknown', '']) {
        const text = highlightCode(sample, lang).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        assert.equal(text, sample, lang);
    }
});
test('markdown highlighting keeps text 1:1 and marks structure', () => {
    const source = '# Title\n\n**bold** and *it* `code *x*` [a](http://x)\n- [x] done\n> quote\n```js\nlet a = 1\n```\n';
    const html = highlightMarkdown(source);
    assert.equal(html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), source);
    assert.match(html, /tok-md-heading/);
    assert.match(html, /tok-md-bold">bold/);
    assert.match(html, /tok-md-code">`code \*x\*`/);
    assert.match(html, /tok-md-task/);
    assert.match(html, /tok-keyword">let/);
});
