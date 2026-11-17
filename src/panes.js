// Split layout for the note tabs: a tree of horizontal and vertical groups, at most four groups on screen.
(function () {
    const MAX = 4;
    let seq = 1;
    const nextId = prefix => prefix + (seq++);
    const remember = id => {
        const n = Number(String(id || '').replace(/\D/g, ''));
        if (n >= seq) seq = n + 1;
    };
    const clampRatio = value => Math.max(0.15, Math.min(0.85, Number(value) || 0.5));

    function leaf(tabs, active) {
        const list = (tabs || []).slice();
        return { type: 'leaf', id: nextId('p'), tabs: list, active: list.includes(active) ? active : list[0] };
    }
    function leaves(node, out) {
        const list = out || [];
        if (!node) return list;
        if (node.type === 'leaf') list.push(node);
        else { leaves(node.a, list); leaves(node.b, list); }
        return list;
    }
    function count(node) { return leaves(node).length; }
    function findLeaf(node, id) {
        if (!node) return null;
        if (node.type === 'leaf') return node.id === id ? node : null;
        return findLeaf(node.a, id) || findLeaf(node.b, id);
    }
    function leafOf(node, tabId) {
        return leaves(node).find(group => group.tabs.includes(tabId)) || null;
    }
    function replace(node, id, next) {
        if (!node) return node;
        if (node.type === 'leaf') return node.id === id ? next : node;
        const a = replace(node.a, id, next);
        const b = replace(node.b, id, next);
        return a === node.a && b === node.b ? node : { ...node, a, b };
    }
    function prune(node) {
        if (!node) return null;
        if (node.type === 'leaf') return node.tabs.length ? node : null;
        const a = prune(node.a);
        const b = prune(node.b);
        if (!a) return b;
        if (!b) return a;
        return a === node.a && b === node.b ? node : { ...node, a, b };
    }
    function strip(node, tabId) {
        if (!node) return null;
        const walk = current => {
            if (current.type === 'leaf') {
                if (!current.tabs.includes(tabId)) return current;
                const tabs = current.tabs.filter(id => id !== tabId);
                const active = current.active === tabId ? (tabs[Math.max(0, current.tabs.indexOf(tabId) - 1)] || tabs[0]) : current.active;
                return { ...current, tabs, active };
            }
            return { ...current, a: walk(current.a), b: walk(current.b) };
        };
        return prune(walk(node));
    }
    function place(tabs, tabId, index, viewIds) {
        const views = viewIds || [];
        const next = tabs.filter(id => id !== tabId);
        let at = Math.max(0, Math.min(index, next.length));
        const firstView = next.findIndex(id => views.includes(id));
        if (firstView >= 0) at = views.includes(tabId) ? Math.max(at, firstView) : Math.min(at, firstView);
        next.splice(at, 0, tabId);
        return next;
    }
    function addTab(tree, paneId, tabId, viewIds, select) {
        const cleared = strip(tree, tabId) || leaf([], null);
        const group = findLeaf(cleared, paneId) || leaves(cleared)[0];
        const tabs = place(group.tabs, tabId, group.tabs.length, viewIds);
        const active = select === false && tabs.includes(group.active) ? group.active : tabId;
        return replace(cleared, group.id, { ...group, tabs, active });
    }
    function removeTab(tree, tabId) {
        const source = leafOf(tree, tabId);
        const next = strip(tree, tabId) || leaf([], null);
        const paneId = source && findLeaf(next, source.id) ? source.id : (leaves(next)[0] && leaves(next)[0].id);
        return { tree: next, paneId };
    }
    function reorder(tree, paneId, tabId, index, viewIds) {
        const group = findLeaf(tree, paneId);
        if (!group || !group.tabs.includes(tabId)) return tree;
        const from = group.tabs.indexOf(tabId);
        const dest = from < index ? index - 1 : index;
        if (dest === from) return activate(tree, paneId, tabId);
        const tabs = place(group.tabs, tabId, dest, viewIds);
        return replace(tree, paneId, { ...group, tabs, active: tabId });
    }
    function move(tree, tabId, paneId, index, viewIds) {
        const group = findLeaf(tree, paneId);
        if (!group) return tree;
        if (group.tabs.includes(tabId)) return reorder(tree, paneId, tabId, index, viewIds);
        const cleared = strip(tree, tabId);
        const target = findLeaf(cleared, paneId);
        if (!target) return tree;
        const tabs = place(target.tabs, tabId, index, viewIds);
        return replace(cleared, paneId, { ...target, tabs, active: tabId });
    }
    function canSplit(tree, tabId, paneId) {
        const source = leafOf(tree, tabId);
        const target = findLeaf(tree, paneId);
        if (!source || !target) return false;
        if (source.id === target.id && source.tabs.length < 2) return false;
        return source.tabs.length < 2 || count(tree) < MAX;
    }
    function split(tree, tabId, paneId, edge, viewIds) {
        if (!['left', 'right', 'top', 'bottom'].includes(edge) || !canSplit(tree, tabId, paneId)) return null;
        const cleared = strip(tree, tabId);
        const target = findLeaf(cleared, paneId);
        if (!target) return null;
        const fresh = leaf([tabId], tabId);
        const kept = { ...target, tabs: target.tabs.slice() };
        const dir = edge === 'left' || edge === 'right' ? 'row' : 'col';
        const first = edge === 'left' || edge === 'top';
        const node = { type: 'split', id: nextId('s'), dir, ratio: 0.5, a: first ? fresh : kept, b: first ? kept : fresh };
        return replace(cleared, paneId, node);
    }
    function activate(tree, paneId, tabId) {
        const group = findLeaf(tree, paneId);
        if (!group || !group.tabs.includes(tabId) || group.active === tabId) return tree;
        return replace(tree, paneId, { ...group, active: tabId });
    }
    function setRatio(tree, id, ratio) {
        if (!tree || tree.type === 'leaf') return tree;
        if (tree.id === id) return { ...tree, ratio: clampRatio(ratio) };
        const a = setRatio(tree.a, id, ratio);
        const b = setRatio(tree.b, id, ratio);
        return a === tree.a && b === tree.b ? tree : { ...tree, a, b };
    }
    function reconcile(tree, ids, preferredId, viewIds, paneId) {
        const wanted = new Set(ids);
        const seen = new Set();
        function keep(node) {
            if (!node) return null;
            if (node.type === 'leaf') {
                remember(node.id);
                const tabs = node.tabs.filter(id => wanted.has(id) && !seen.has(id) && seen.add(id));
                const active = tabs.includes(node.active) ? node.active : tabs[0];
                return tabs.length ? { ...node, tabs, active } : null;
            }
            remember(node.id);
            return prune({ ...node, a: keep(node.a), b: keep(node.b), ratio: clampRatio(node.ratio), dir: node.dir === 'col' ? 'col' : 'row' });
        }
        let next = keep(tree) || leaf([], null);
        const home = findLeaf(next, paneId) || (preferredId && leafOf(next, preferredId)) || leaves(next)[0];
        ids.filter(id => !seen.has(id)).forEach(id => { next = addTab(next, home.id, id, viewIds, false); });
        const activePane = (preferredId && leafOf(next, preferredId) && leafOf(next, preferredId).id) || home.id;
        if (preferredId && leafOf(next, preferredId)) next = activate(next, activePane, preferredId);
        return { tree: next, activePane };
    }
    function persist(tree, activePane, viewIds) {
        const views = viewIds || [];
        function walk(node) {
            if (!node) return null;
            if (node.type === 'leaf') {
                const tabs = node.tabs.filter(id => !views.includes(id));
                if (!tabs.length) return null;
                return { type: 'leaf', id: node.id, tabs, active: tabs.includes(node.active) ? node.active : tabs[0] };
            }
            const a = walk(node.a), b = walk(node.b);
            if (!a) return b;
            if (!b) return a;
            return { type: 'split', id: node.id, dir: node.dir, ratio: node.ratio, a, b };
        }
        const root = walk(tree);
        return root ? { activePane, root } : null;
    }
    function restore(data, ids, viewIds) {
        function walk(node) {
            if (!node || typeof node !== 'object') return null;
            if (node.type === 'leaf' && Array.isArray(node.tabs)) {
                remember(node.id);
                return { type: 'leaf', id: String(node.id), tabs: node.tabs.filter(id => typeof id === 'number'), active: node.active };
            }
            if (node.type === 'split') {
                remember(node.id);
                const a = walk(node.a), b = walk(node.b);
                if (!a) return b;
                if (!b) return a;
                return { type: 'split', id: String(node.id), dir: node.dir === 'col' ? 'col' : 'row', ratio: clampRatio(node.ratio), a, b };
            }
            return null;
        }
        const root = data && walk(data.root);
        const fixed = reconcile(root, ids, null, viewIds);
        const saved = data && findLeaf(fixed.tree, data.activePane) ? data.activePane : fixed.activePane;
        return { tree: fixed.tree, activePane: saved };
    }

    function edgeAt(rect, x, y) {
        const rx = rect.width ? (x - rect.left) / rect.width : 0.5;
        const ry = rect.height ? (y - rect.top) / rect.height : 0.5;
        const band = 0.26;
        const left = rx < band, right = rx > 1 - band, top = ry < band, bottom = ry > 1 - band;
        if (!(left || right || top || bottom)) return 'center';
        const dx = Math.min(rx, 1 - rx), dy = Math.min(ry, 1 - ry);
        if (dx < dy) return rx < 0.5 ? 'left' : 'right';
        return ry < 0.5 ? 'top' : 'bottom';
    }

    function paint(host, tree, ctx) {
        const find = document.querySelector('.find-bar');
        [ctx.documentBar, ctx.editor, ctx.tools, find].forEach(node => { if (node) node.remove(); });
        host.classList.toggle('is-split', count(tree) > 1);
        host.replaceChildren(draw(tree, ctx));
        const active = host.querySelector('.pane-leaf.is-active .pane-body');
        const group = findLeaf(tree, ctx.activePane);
        const doc = group && ctx.doc(group.active);
        if (find && active) active.append(find);
        if (active && doc && ctx.isView(doc)) {
            active.classList.add('plugin-view');
            active.parentElement.classList.add('is-view');
            doc.element.hidden = false;
            active.append(doc.element);
        } else if (active) active.append(ctx.editor, ctx.tools);
        ctx.filled();
    }
    function draw(node, ctx) {
        if (node.type === 'split') {
            const splitEl = el('div', 'pane-split ' + node.dir);
            splitEl.dataset.split = node.id;
            const a = el('div', 'pane-slot');
            const b = el('div', 'pane-slot');
            a.style.flexGrow = String(node.ratio);
            b.style.flexGrow = String(1 - node.ratio);
            a.append(draw(node.a, ctx));
            b.append(draw(node.b, ctx));
            splitEl.append(a, sash(node, ctx), b);
            return splitEl;
        }
        const group = el('div', 'pane-leaf' + (node.id === ctx.activePane ? ' is-active' : ''));
        group.dataset.pane = node.id;
        const body = el('div', 'pane-body');
        if (node.id === ctx.activePane) group.append(ctx.documentBar, body);
        else group.append(barFor(node, ctx), body);
        ctx.fillTabs(node.id === ctx.activePane ? ctx.tabBar : group.querySelector('.tab-bar'), node);
        if (node.id !== ctx.activePane) {
            const doc = ctx.doc(node.active);
            if (doc && ctx.isView(doc)) {
                group.classList.add('is-view');
                body.classList.add('plugin-view');
                doc.element.hidden = false;
                body.append(doc.element);
            } else if (doc) body.append(ctx.snapshot(doc));
        }
        body.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target.closest('a, button, input, textarea, select, .nb-cell')) return;
            ctx.onFocus(node.active);
        });
        return group;
    }
    function barFor(node, ctx) {
        const bar = el('div', 'document-bar');
        const tabs = el('div', 'tab-bar');
        tabs.setAttribute('aria-label', ctx.tabsLabel);
        bar.append(tabs);
        return bar;
    }
    function sash(node, ctx) {
        const handle = el('div', 'pane-sash');
        handle.dataset.split = node.id;
        handle.tabIndex = 0;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', node.dir === 'row' ? 'vertical' : 'horizontal');
        handle.setAttribute('aria-label', ctx.sashLabel);
        handle.setAttribute('aria-valuemin', '15');
        handle.setAttribute('aria-valuemax', '85');
        handle.setAttribute('aria-valuenow', String(Math.round(node.ratio * 100)));
        let dragging = false;
        const apply = (ratio, persist) => {
            const parent = handle.parentElement;
            if (!parent) return;
            const slots = parent.querySelectorAll(':scope > .pane-slot');
            slots[0].style.flexGrow = String(ratio);
            slots[1].style.flexGrow = String(1 - ratio);
            handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
            ctx.onResize(node.id, ratio, persist);
        };
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            dragging = true;
            try { handle.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
            handle.classList.add('is-dragging');
            event.preventDefault();
        });
        handle.addEventListener('pointermove', event => {
            if (!dragging) return;
            const rect = handle.parentElement.getBoundingClientRect();
            const ratio = node.dir === 'row' ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
            apply(clampRatio(ratio), false);
        });
        const stop = event => {
            if (!dragging) return;
            dragging = false;
            try { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); } catch { /* already released */ }
            handle.classList.remove('is-dragging');
            ctx.onResize(node.id, clampRatio(Number(handle.getAttribute('aria-valuenow')) / 100), true);
        };
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
        handle.addEventListener('dblclick', () => apply(0.5, true));
        handle.addEventListener('keydown', event => {
            const horizontal = node.dir === 'row';
            const grow = horizontal ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
            const shrink = horizontal ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
            if (!grow && !shrink && event.key !== 'Home') return;
            event.preventDefault();
            const current = Number(handle.getAttribute('aria-valuenow')) / 100;
            apply(event.key === 'Home' ? 0.5 : clampRatio(current + (grow ? 0.05 : -0.05)), true);
        });
        return handle;
    }
    function el(tag, className) {
        const node = document.createElement(tag);
        node.className = className;
        return node;
    }

    function bindDrag(scope, api) {
        scope.addEventListener('pointerdown', event => {
            const tab = event.target.closest('.tab-item');
            if (!tab || event.button !== 0 || event.target.closest('.close-tab') || !scope.contains(tab)) return;
            const docId = Number(tab.dataset.doc);
            const startX = event.clientX, startY = event.clientY;
            let dragging = false, ghost = null;
            const onMove = move => {
                if (!dragging) {
                    if (Math.hypot(move.clientX - startX, move.clientY - startY) < 6) return;
                    dragging = true;
                    tab.classList.add('is-dragging');
                    document.body.classList.add('is-pane-drag');
                    ghost = document.createElement('div');
                    ghost.className = 'tab-ghost';
                    ghost.textContent = api.title(docId);
                    document.body.append(ghost);
                    try { tab.setPointerCapture(move.pointerId); } catch { /* already released */ }
                }
                ghost.style.left = (move.clientX + 12) + 'px';
                ghost.style.top = (move.clientY + 14) + 'px';
                showTarget(move.clientX, move.clientY, docId, api);
            };
            const finish = up => {
                tab.removeEventListener('pointermove', onMove);
                tab.removeEventListener('pointerup', finish);
                tab.removeEventListener('pointercancel', finish);
                clearMarks();
                tab.classList.remove('is-dragging');
                document.body.classList.remove('is-pane-drag');
                if (ghost) ghost.remove();
                if (!dragging) return;
                api.suppressClick();
                const hit = targetAt(up.clientX, up.clientY, docId, api);
                if (hit) api.drop(docId, hit);
            };
            tab.addEventListener('pointermove', onMove);
            tab.addEventListener('pointerup', finish);
            tab.addEventListener('pointercancel', finish);
        });
    }
    function clearMarks() {
        document.querySelectorAll('.is-drop-before, .is-drop-after, .dock-layer').forEach(node => {
            node.classList.remove('is-drop-before', 'is-drop-after');
            if (node.classList.contains('dock-layer')) node.remove();
        });
    }
    function targetAt(x, y, docId, api) {
        const leafEl = [...document.querySelectorAll('.pane-leaf')].find(node => {
            const rect = node.getBoundingClientRect();
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        });
        if (!leafEl) return null;
        const paneId = leafEl.dataset.pane;
        const bar = leafEl.querySelector('.tab-bar');
        const barRect = bar.getBoundingClientRect();
        if (y >= barRect.top && y <= barRect.bottom && x >= barRect.left && x <= barRect.right) {
            const tabs = [...bar.querySelectorAll('.tab-item')];
            let index = tabs.length;
            tabs.forEach((item, i) => { if (index === tabs.length && x < item.getBoundingClientRect().left + item.getBoundingClientRect().width / 2) index = i; });
            const near = x > barRect.right - 28 ? 1 : x < barRect.left + 28 ? -1 : 0;
            if (near) bar.scrollLeft += near * 14;
            return { paneId, edge: 'center', index };
        }
        const edge = edgeAt(leafEl.getBoundingClientRect(), x, y);
        return { paneId, edge: edge !== 'center' && api.canSplit(docId, paneId) ? edge : 'center', index: api.tabs(paneId).length };
    }
    function showTarget(x, y, docId, api) {
        clearMarks();
        const hit = targetAt(x, y, docId, api);
        if (!hit) return;
        const leafEl = document.querySelector('.pane-leaf[data-pane="' + hit.paneId + '"]');
        if (hit.edge === 'center') {
            const tabs = [...leafEl.querySelectorAll('.tab-item')];
            if (!tabs.length) return;
            const gap = Math.max(0, Math.min(hit.index, tabs.length));
            if (gap >= tabs.length) tabs[tabs.length - 1].classList.add('is-drop-after');
            else tabs[gap].classList.add('is-drop-before');
            return;
        }
        const layer = document.createElement('div');
        layer.className = 'dock-layer';
        layer.dataset.edge = hit.edge;
        const preview = document.createElement('div');
        preview.className = 'dock-preview';
        const box = { left: 'inset: 8px auto auto 8px; width: calc(50% - 12px); height: calc(100% - 16px);', right: 'inset: 8px 8px auto auto; width: calc(50% - 12px); height: calc(100% - 16px);', top: 'inset: 8px 8px auto 8px; height: calc(50% - 12px);', bottom: 'inset: auto 8px 8px 8px; height: calc(50% - 12px);' };
        preview.style.cssText = box[hit.edge] || '';
        layer.append(preview);
        leafEl.append(layer);
    }

    const api = { MAX, leaf, leaves, count, findLeaf, leafOf, addTab, removeTab, reorder, move, canSplit, split, activate, setRatio, reconcile, persist, restore, edgeAt, paint, bindDrag };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else window.FgsPanes = api;
})();
