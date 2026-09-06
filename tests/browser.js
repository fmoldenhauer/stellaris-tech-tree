/* Browser integration test. Only synthetic data is read or stored. */
'use strict';
document.getElementById('run').onclick = async function () {
    var button = this, output = document.getElementById('results'), frame = document.getElementById('app');
    button.disabled = true; output.textContent = '';
    var before = new Map(Object.keys(localStorage).map(function (key) { return [key, localStorage.getItem(key)]; }));
    var listName = 'Synthetic smoke test ' + Date.now();
    function log(text) { output.textContent += text + '\n'; }
    function assert(value, message) { if (!value) throw new Error(message); log('PASS: ' + message); }
    async function until(fn) {
        var start = Date.now();
        while (Date.now() - start < 30000) { if (fn()) return; await new Promise(function (resolve) { setTimeout(resolve, 50); }); }
        throw new Error('Timed out waiting for the browser');
    }
    function state() { return frame.contentWindow; }
    function importedCount() { return state().ResearchState.get().length; }
    try {
        localStorage.removeItem('empireConfig');
        localStorage.removeItem('researchSnapshot:' + new URL('../pegasus-4.4.6/', location.href).pathname);
        frame.src = '../?pegasus-4.4.6';
        await until(function () { return state().techTreesLoaded && state().document.getElementById('save-import-file'); });
        var w = state(), d = w.document, original = w.ResearchState.get();
        d.querySelector('.float-Empire a').click();
        var text = await (await fetch('fixtures/minimal.gamestate')).text();
        // Deliberately reverse prerequisite order and include a technology whose
        // prerequisites are absent. Save imports must not simulate manual clicks.
        var chain = ['tech_ship_armor_5', 'tech_ship_armor_4', 'tech_ship_armor_3', 'tech_ship_armor_2', 'tech_ship_armor_1', 'tech_lasers_5'];
        text = text.replace('tech_status={', 'tech_status={ ' + chain.map(function (key) { return 'technology="' + key + '" level=1'; }).join(' '));
        var expectedCount = chain.length + 2;
        var transfer = new w.DataTransfer();
        transfer.items.add(new w.File([text], 'synthetic.gamestate', { type: 'text/plain' }));
        d.getElementById('save-import-file').files = transfer.files;
        d.getElementById('save-import-file').dispatchEvent(new w.Event('change', { bubbles: true }));
        await until(function () { return d.getElementById('save-import-country'); });
        assert(!w.EmpireConfig.isActive(), 'Reading a file does not change empire inputs');
        var select = d.getElementById('save-import-country');
        assert(select.value === '', 'Multiplayer save requires explicit empire selection');
        select.value = '7'; select.dispatchEvent(new w.Event('change', { bubbles: true }));
        assert(!d.getElementById('save-import-apply').disabled, 'Import is enabled after selecting a country');
        d.getElementById('save-import-apply').click();
        await until(function () { return w.EmpireConfig.isActive() && importedCount() === expectedCount; });
        assert(chain.every(function (key) { return w.ResearchState.get().includes(key); }), 'All tiers import regardless of prerequisite order or missing prerequisites');
        assert(w.EmpireConfig.get().authority === 'auth_democratic', 'Empire configuration was populated');
        assert(w.ResearchState.get().includes('tech_lasers_1'), 'Completed technology is checked');
        assert(!w.ResearchState.get().includes('tech_lasers_2'), 'In-progress research is not marked complete');
        assert(w.EmpireConfig.get().save_context.unmapped_technologies.includes('tech_mod_only'), 'Unmapped researched tech is retained for rule evaluation');
        await until(function () { return d.querySelector('#tech_curator_lab .wm-applies'); });
        assert(!!d.querySelector('#tech_curator_lab .wm-applies'), 'Imported Curator Insight affects a rendered weight rule');
        Array.from(d.querySelectorAll('.save-import button')).find(function (b) { return b.textContent === 'Undo import'; }).click();
        assert(!w.EmpireConfig.isActive(), 'Undo restores the inactive manual configuration');
        assert(JSON.stringify(w.ResearchState.get().sort()) === JSON.stringify(original.sort()), 'Undo restores the exact previous research snapshot');
        d.getElementById('save-import-apply').click();
        await until(function () { return !!w.offlineDB; });
        d.getElementById('research_selection').value = listName;
        d.getElementById('research_save').click();
        await until(function () { return Array.from(d.querySelectorAll('#research_list option')).some(function (o) { return o.value === listName; }); });
        w.ResearchState.replace([]); w.EmpireConfig.reset();
        d.getElementById('research_load').click();
        await until(function () { return importedCount() === expectedCount && w.EmpireConfig.get().save_context; });
        assert(w.EmpireConfig.get().save_context.country_id === '7', 'Named research list restores both technologies and save context');
        frame.contentWindow.location.reload();
        await new Promise(function (resolve) { frame.onload = resolve; });
        await until(function () { return state().techTreesLoaded && state().document.getElementById('save-import-file'); });
        assert(importedCount() === expectedCount, 'Research at every tier survives reload');
        assert(state().EmpireConfig.get().save_context.country_id === '7', 'Empire inputs survive reload');
        log('ALL BROWSER CHECKS PASSED');
    } catch (error) { log('FAIL: ' + error.stack); }
    finally {
        var db = state().offlineDB;
        if (db) db.transaction('TreeStore', 'readwrite').objectStore('TreeStore').delete(listName);
        Object.keys(localStorage).forEach(function (key) { if (!before.has(key)) localStorage.removeItem(key); });
        before.forEach(function (value, key) { localStorage.setItem(key, value); });
        button.disabled = false;
    }
};
