const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchText } = require('../src/find');

test('search finds every match, ignores case unless asked, and does not overlap itself', () => {
    assert.deepEqual(searchText('Aa aa AA', 'aa', false), [{ from: 0, to: 2 }, { from: 3, to: 5 }, { from: 6, to: 8 }]);
    assert.deepEqual(searchText('Aa aa AA', 'aa', true), [{ from: 3, to: 5 }]);
    assert.deepEqual(searchText('aaa', 'aa', false), [{ from: 0, to: 2 }]);
    assert.deepEqual(searchText('hello', '', false), []);
    assert.deepEqual(searchText('нет', 'да', false), []);
});
