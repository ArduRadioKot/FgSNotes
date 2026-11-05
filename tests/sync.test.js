const { test } = require('node:test');
const assert = require('node:assert/strict');
const { merge, stamp, hashNote } = require('../src/sync');

const note = (uid, content, extra = {}) => ({ uid, title: uid + '.md', content, updatedAt: 1, hist: [], ...extra });
const byUid = list => Object.fromEntries(list.map(item => [item.uid, item]));

test('notes known on one side only are taken over', () => {
    const merged = byUid(merge([note('a', 'one')], [note('b', 'two')]));
    assert.equal(merged.a.content, 'one');
    assert.equal(merged.b.content, 'two');
});

test('a newer version wins over the version it grew from', () => {
    const [base] = stamp([note('a', 'draft')]);
    const edited = { ...base, content: 'draft, then more', updatedAt: 5 };
    assert.equal(byUid(merge([base], [edited])).a.content, 'draft, then more');
    assert.equal(byUid(merge([edited], [base])).a.content, 'draft, then more');
});

test('an older clock does not undo a real edit', () => {
    const [base] = stamp([note('a', 'v1', { updatedAt: 100 })]);
    const edited = { ...base, content: 'v2', updatedAt: 50 };   // the editing device's clock is behind
    assert.equal(byUid(merge([base], [edited])).a.content, 'v2');
});

test('typing after a sync went out is not a conflict when the answer comes back', () => {
    const [sent] = stamp([note('a', 'sent')]);
    const answer = merge([], [sent]);                         // the other side adopts what we sent
    const typing = { ...sent, content: 'sent and typed', updatedAt: 9 };
    const merged = merge([typing], answer);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].content, 'sent and typed');
});

test('edits on both sides keep both texts, and both devices agree', () => {
    const [base] = stamp([note('a', 'base')]);
    const mine = { ...base, content: 'mine', updatedAt: 10 };
    const theirs = { ...base, content: 'theirs', updatedAt: 20 };
    const here = merge([mine], [theirs], 'conflict');
    const there = merge([theirs], [mine], 'conflict');
    assert.equal(here.length, 2);
    assert.deepEqual(here.map(item => item.content).sort(), ['mine', 'theirs']);
    assert.equal(byUid(here).a.content, 'theirs');            // the newer edit keeps the note
    const copy = here.find(item => item.uid !== 'a');
    assert.match(copy.title, /\(conflict\)$/);
    assert.deepEqual(here.map(item => item.uid).sort(), there.map(item => item.uid).sort());
    // Meeting again later changes nothing.
    assert.deepEqual(merge(here, there).map(item => hashNote(item)).sort(), here.map(item => hashNote(item)).sort());
});

test('a note closed on one device closes on the other unless it was edited there', () => {
    const [base] = stamp([note('a', 'text')]);
    const closed = { uid: 'a', deleted: true, updatedAt: Date.now(), hist: base.hist };
    assert.equal(byUid(merge([base], [closed])).a.deleted, true);
    const edited = { ...base, content: 'text, edited', updatedAt: 6 };
    const kept = byUid(merge([edited], [closed])).a;
    assert.equal(kept.deleted, undefined);
    assert.equal(kept.content, 'text, edited');
});

test('old tombstones are dropped', () => {
    const old = { uid: 'gone', deleted: true, updatedAt: Date.now() - 40 * 86400000, hist: [] };
    assert.equal(merge([old], []).length, 0);
});
