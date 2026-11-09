// ==FgsPlugin==
// @name        Синхронизация
// @version     1.0
// @description Заметки сами обновляются на ваших устройствах в одной сети. Добавляет кнопку «Синхронизировать» на левую панель.
// @author      FgSNotes
// ==/FgsPlugin==
const tr = (key, vars) => (typeof t === 'function' ? t(key, vars) : key);
const sync = window.FgsSync;

fgs.addStyle(`
@keyframes fgs-sync-spin { to { transform: rotate(360deg); } }
[data-sync-busy] .plugin-tool[data-plugin="sync.js"] svg { animation: fgs-sync-spin .9s linear infinite; }
@media (prefers-reduced-motion: reduce) { [data-sync-busy] .plugin-tool[data-plugin="sync.js"] svg { animation: none; opacity: .5; } }
`);

sync.setPluginEnabled(true);
fgs.onUnload(() => sync.setPluginEnabled(false));

fgs.addButton({
    title: tr('Синхронизировать'),
    icon: 'refresh',
    run: async () => {
        // Nothing to sync with yet: the settings are where that is fixed.
        if (!sync.ready()) { sync.openSettings(); return; }
        const result = await sync.syncNow();
        if (result.failure) fgs.notify(result.failure);
        else if (!result.targets) fgs.notify(tr('Других устройств в сети пока нет'));
        else fgs.notify(tr('Заметки синхронизированы'));
    }
});
