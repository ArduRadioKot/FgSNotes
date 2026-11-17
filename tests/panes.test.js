const test = require('node:test');
const assert = require('node:assert/strict');
const panes = require('../src/panes.js');

test('a tab can be split left, right, above and below, and an empty group disappears', () => {
    let tree = panes.leaf([1, 2, 3], 1);
    const right = panes.split(tree, 3, tree.id, 'right');
    assert.equal(panes.count(right), 2);
    assert.equal(right.dir, 'row');
    assert.deepEqual(right.b.tabs, [3]);
    const down = panes.split(right, 2, panes.leafOf(right, 1).id, 'bottom');
    assert.equal(panes.count(down), 3);
    assert.equal(panes.leafOf(down, 2).tabs.length, 1);
    const back = panes.move(down, 2, panes.leafOf(down, 3).id, 1);
    assert.equal(panes.count(back), 2);
    assert.deepEqual(panes.leafOf(back, 2).tabs, [3, 2]);
    const above = panes.split(tree, 1, tree.id, 'top');
    assert.equal(above.dir, 'col');
    assert.deepEqual(above.a.tabs, [1]);
    assert.deepEqual(above.b.tabs, [2, 3]);
});

test('the fifth group is refused, while a tab can still move into an existing one', () => {
    let tree = panes.leaf([1, 2, 3, 4, 5], 1);
    tree = panes.split(tree, 2, panes.leafOf(tree, 1).id, 'right');
    tree = panes.split(tree, 3, panes.leafOf(tree, 1).id, 'bottom');
    tree = panes.split(tree, 4, panes.leafOf(tree, 2).id, 'bottom');
    assert.equal(panes.count(tree), 4);
    const blocked = panes.split(tree, 5, panes.leafOf(tree, 1).id, 'left');
    assert.equal(blocked, null);
    const moved = panes.move(tree, 5, panes.leafOf(tree, 2).id, 0);
    assert.equal(panes.count(moved), 4);
    assert.deepEqual(panes.leafOf(moved, 5).tabs[0], 5);
});

test('dragging the only tab of a full layout into another edge does not add a group', () => {
    let tree = panes.leaf([1], 1);
    tree = panes.addTab(tree, tree.id, 2);
    tree = panes.split(tree, 2, panes.leafOf(tree, 1).id, 'right');
    tree = panes.addTab(tree, panes.leafOf(tree, 1).id, 3);
    tree = panes.split(tree, 3, panes.leafOf(tree, 1).id, 'bottom');
    tree = panes.addTab(tree, panes.leafOf(tree, 2).id, 4);
    tree = panes.split(tree, 4, panes.leafOf(tree, 2).id, 'top');
    assert.equal(panes.count(tree), 4);
    const host = panes.leafOf(tree, 1).id;
    assert.equal(panes.canSplit(tree, 4, host), true);
    const shifted = panes.split(tree, 4, host, 'left');
    assert.ok(shifted);
    assert.equal(panes.count(shifted), 4);
});

test('notes stay ahead of view tabs, and a saved layout drops tabs that are gone', () => {
    const tree = panes.leaf([1], 1);
    const withView = panes.addTab(tree, tree.id, 9, [9]);
    const withNote = panes.addTab(withView, withView.id, 2, [9]);
    assert.deepEqual(panes.leaves(withNote)[0].tabs, [1, 2, 9]);
    const saved = panes.persist(withNote, withNote.id, [9]);
    assert.deepEqual(saved.root.tabs, [1, 2]);
    const back = panes.restore(saved, [2]);
    assert.deepEqual(panes.leaves(back.tree)[0].tabs, [2]);
    assert.equal(back.activePane, panes.leaves(back.tree)[0].id);
});

test('reorder keeps the group and a combined split remembers its ratio', () => {
    const tree = panes.leaf([1, 2, 3], 1);
    const moved = panes.reorder(tree, tree.id, 3, 0);
    assert.deepEqual(moved.tabs, [3, 1, 2]);
    const split = panes.split(moved, 2, moved.id, 'right');
    const sized = panes.setRatio(split, split.id, 0.7);
    assert.equal(sized.ratio, 0.7);
    assert.equal(sized.a.tabs.includes(3), true);
    assert.deepEqual(sized.b.tabs, [2]);
});
