const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const i18n = require('../src/i18n');

test('english translation and russian fallback', () => {
    i18n.setLanguage('en');
    assert.equal(i18n.t('Настройки'), 'Settings');
    assert.equal(i18n.t('Доступна версия {version}', { version: '9.9.9' }), 'Version 9.9.9 is available');
    i18n.setLanguage('ru');
    assert.equal(i18n.t('Настройки'), 'Настройки');
    assert.equal(i18n.language, 'ru');
});

test('interface copy has no em dash or en dash', () => {
    const dash = /[—–]/;
    for (const [key, value] of Object.entries(i18n.EN)) {
        assert.equal(dash.test(key), false, key);
        assert.equal(dash.test(value), false, value);
    }
    const html = fs.readFileSync(path.join(__dirname, '../src/MarkDownEditor.html'), 'utf8');
    assert.equal(dash.test(html), false);
});
