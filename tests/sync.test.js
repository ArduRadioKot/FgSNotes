const { test } = require('node:test');
const assert = require('node:assert/strict');
const { merge, compareVersions, hashNote } = require('../src/sync');

const note = (uid, content, ver = {}, extra = {}) => ({ uid, title: uid + '.md', content, updatedAt: 1, ver, ...extra });
const byUid = list => Object.fromEntries(list.map(item => [item.uid, item]));

test('version vectors compare', () => {
    assert.equal(compareVersions({ a: 2 }, { a: 1 }), 'a');
    assert.equal(compareVersions({ a: 1 }, { a: 1, b: 1 }), 'b');
    assert.equal(compareVersions({ a: 2 }, { b: 1 }), 'both');
    assert.equal(compareVersions({}, undefined), 'same');
});

test('notes known on one side only are taken over', () => {
    const merged = byUid(merge([note('a', 'one')], [note('b', 'two')]));
    assert.equal(merged.a.content, 'one');
    assert.equal(merged.b.content, 'two');
});

test('an edit wins over the version it grew from, in both directions', () => {
    const base = note('a', 'draft', { pc: 1 });
    const edited = note('a', 'draft, then more', { pc: 1, phone: 1 }, { updatedAt: 5 });
    assert.equal(byUid(merge([base], [edited])).a.content, 'draft, then more');
    assert.equal(byUid(merge([edited], [base])).a.content, 'draft, then more');
});

test('going back to an earlier text on the phone reaches the computer', () => {
    const computer = note('a', 'long text', { pc: 1, phone: 2 });
    const phone = note('a', 'short', { pc: 1, phone: 3 });
    assert.equal(byUid(merge([computer], [phone])).a.content, 'short');
});

test('an older clock does not undo a real edit', () => {
    const base = note('a', 'v1', { pc: 1 }, { updatedAt: 100 });
    const edited = note('a', 'v2', { pc: 1, phone: 1 }, { updatedAt: 50 });
    assert.equal(byUid(merge([base], [edited])).a.content, 'v2');
});

test('typing while an answer is on its way is kept', () => {
    const sent = note('a', 'sent', { phone: 3 });
    const answer = merge([], [sent]);
    const typing = note('a', 'sent and typed', { phone: 5 }, { updatedAt: 9 });
    const merged = merge([typing], answer);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].content, 'sent and typed');
});

test('edits on both sides keep both texts, and both devices agree', () => {
    const mine = note('a', 'mine', { base: 1, pc: 1 }, { updatedAt: 10 });
    const theirs = note('a', 'theirs', { base: 1, phone: 1 }, { updatedAt: 20 });
    const here = merge([mine], [theirs], 'conflict');
    const there = merge([theirs], [mine], 'conflict');
    assert.deepEqual(here.map(item => item.content).sort(), ['mine', 'theirs']);
    assert.equal(byUid(here).a.content, 'theirs');
    assert.match(here.find(item => item.uid !== 'a').title, /\(conflict\)$/);
    assert.deepEqual(here.map(item => item.uid).sort(), there.map(item => item.uid).sort());
    const again = merge(here, there);
    assert.equal(again.length, 2);
    assert.deepEqual(again.map(hashNote).sort(), here.map(hashNote).sort());
});

test('a note closed on one device closes on the other unless it was edited there', () => {
    const base = note('a', 'text', { pc: 1 });
    const closed = { uid: 'a', deleted: true, updatedAt: Date.now(), ver: { pc: 2 } };
    assert.equal(byUid(merge([base], [closed])).a.deleted, true);
    const edited = note('a', 'text, edited', { pc: 1, phone: 1 }, { updatedAt: 6 });
    const kept = byUid(merge([edited], [closed])).a;
    assert.equal(kept.deleted, undefined);
    assert.equal(kept.content, 'text, edited');
});

test('old tombstones are dropped', () => {
    assert.equal(merge([{ uid: 'gone', deleted: true, updatedAt: Date.now() - 40 * 86400000, ver: {} }], []).length, 0);
});
