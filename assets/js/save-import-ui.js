(function () {
    'use strict';
    window.SaveImportUI = { mount: function (container, options) {
        if (!/\/pegasus-4\.4\.6\/$/.test(location.pathname)) return;
        var section = $('<section>').addClass('save-import').attr('aria-labelledby', 'save-import-title');
        section.append($('<h2>').attr('id', 'save-import-title').text('Import a Stellaris save'));
        section.append($('<p>').text('Choose a .sav or extracted gamestate. Your save is read entirely in this browser and is never uploaded.'));
        var file = $('<input>').attr({ type: 'file', id: 'save-import-file', accept: '.sav,.txt,.gamestate' });
        section.append($('<label>').attr('for', 'save-import-file').text('Save file '), file);
        var cancel = $('<button>').attr('type', 'button').text('Cancel reading').hide();
        var status = $('<p>').attr({ role: 'status', 'aria-live': 'polite', id: 'save-import-status' });
        var preview = $('<div>').attr('id', 'save-import-preview');
        var undo = $('<button>').attr('type', 'button').text('Undo import').hide();
        section.append(cancel, status, preview, undo);
        container.append(section);
        var worker, generation = 0, previous;
        function stop() { generation++; if (worker) worker.terminate(); worker = null; cancel.hide(); }
        cancel.on('click', function () { stop(); status.text('Reading cancelled. Your current configuration is unchanged.'); });
        function ready() { return window.techTreesLoaded && window.EmpireConfig && window.ResearchState; }
        function details(title, items) {
            var box = $('<details>').append($('<summary>').text(title));
            var list = $('<ul>');
            items.forEach(function (item) { list.append($('<li>').text(item)); });
            return box.append(list);
        }
        function showResult(result, filename) {
            preview.empty();
            var select = $('<select>').attr('id', 'save-import-country');
            select.append($('<option>').val('').text('Choose an empire…'));
            result.countries.forEach(function (country) {
                select.append($('<option>').val(country.id).text(country.name + ' [ID ' + country.id + ']' + (country.isPlayer ? ' — Player' : '')));
            });
            var players = result.countries.filter(function (c) { return c.isPlayer; });
            if (players.length === 1) select.val(players[0].id);
            var report = $('<div>'), apply = $('<button>').attr({ type: 'button', id: 'save-import-apply' }).text('Import selected empire');
            preview.append($('<p>').text(result.version + ' · ' + result.date),
                $('<label>').attr('for', 'save-import-country').text('Empire '), select, report, apply);
            function render() {
                report.empty();
                var country = result.countries.find(function (c) { return c.id === select.val(); });
                apply.prop('disabled', !country || !ready());
                if (!ready()) { report.append($('<p>').text('Technology trees are still loading. Import will become available when they are ready.')); return; }
                if (!country) return;
                var projected = StellarisSave.project(country, options, Object.keys(window.techRules), result.version);
                report.append($('<p>').addClass('save-import-count').text(projected.technologies.length + ' researched technologies match this tree. ' +
                    projected.missingTechs.length + ' are not in this version’s data.'));
                var labels = { ethics: 'Ethics', authority: 'Authority', civics: 'Civics', origin: 'Origin',
                    traditions: 'Traditions', council_traits: 'Council traits', ascension_perks: 'Ascension perks' };
                var summary = $('<dl>');
                Object.keys(labels).forEach(function (key) {
                    var val = projected.config[key];
                    summary.append($('<dt>').text(labels[key]), $('<dd>').text(Array.isArray(val) ? val.length + ' found' : val || 'Unknown'));
                });
                summary.append($('<dt>').text('DLCs'), $('<dd>').text(country.dlcs === null ? 'Unknown' : country.dlcs.length + ' recorded in save'));
                report.append(summary);
                var ctx = projected.config.save_context;
                var queue = Object.keys(ctx.research_queues).flatMap(function (area) {
                    return ctx.research_queues[area].map(function (q) { return area + ': ' + q.technology + ' (' + q.progress + ' progress)'; });
                });
                if (queue.length) report.append(details('Research in progress (not marked completed)', queue));
                var levels = Object.keys(ctx.technology_levels).filter(function (key) { return ctx.technology_levels[key] > 1; });
                if (levels.length) report.append(details('Repeatable technology levels', levels.map(function (key) { return key + ': ' + ctx.technology_levels[key]; })));
                if (ctx.modifiers) report.append(details('Active country modifiers (' + ctx.modifiers.length + ')', ctx.modifiers));
                if (ctx.country_flags) report.append(details('Country flags (' + ctx.country_flags.length + ')', ctx.country_flags));
                if (projected.missingTechs.length) report.append(details('Technologies absent from this tree', projected.missingTechs));
                if (projected.unlisted.length) report.append(details('Saved values absent from the manual form (retained)', projected.unlisted));
                report.append(details('Compatibility and remaining unknowns', projected.warnings));
                report.append($('<p>').text('Some game conditions remain unsupported and marked ?. Research weights are estimates.'));
                report.append($('<p>').text('Import replaces the current empire configuration and research check marks. You can undo it or adjust inputs afterward.'));
            }
            select.on('change', render);
            $(document).off('tech-trees-ready.save-import').on('tech-trees-ready.save-import', render);
            apply.on('click', function () {
                if (!ready()) return;
                var country = result.countries.find(function (c) { return c.id === select.val(); });
                if (!country) return;
                var projected = StellarisSave.project(country, options, Object.keys(window.techRules), result.version);
                previous = { config: EmpireConfig.get(), active: EmpireConfig.isActive(), technologies: ResearchState.get(), name: $('#research_selection').val() };
                EmpireConfig.set(projected.config);
                ResearchState.replace(projected.technologies);
                $('#research_selection').val(filename.replace(/\.[^.]+$/, '') + ' — ' + country.name);
                status.text('Imported ' + projected.technologies.length + ' researched technologies and empire inputs. Changes are saved in this browser; use Research List → Save to keep a named copy.');
                undo.show();
            });
            render();
        }
        undo.on('click', function () {
            if (!previous) return;
            if (previous.active) EmpireConfig.set(previous.config);
            else EmpireConfig.clear();
            ResearchState.replace(previous.technologies);
            $('#research_selection').val(previous.name);
            previous = null; undo.hide(); status.text('Import undone.');
        });
        file.on('change', async function () {
            stop(); preview.empty();
            var selected = file[0].files[0], current = generation;
            if (!selected) return;
            if (selected.size > 256 * 1024 * 1024) { status.text('Choose a save smaller than 256 MiB.'); file.val(''); return; }
            status.text('Reading save…'); cancel.show();
            try {
                var buffer = await selected.arrayBuffer();
                if (current !== generation) return;
                worker = new Worker('../assets/js/save-import-worker.js');
                worker.onmessage = function (event) {
                    if (current !== generation) return;
                    stop();
                    if (event.data.error) status.text('Import failed: ' + event.data.error);
                    else { status.text('Save read. Review the selected empire below.'); showResult(event.data.result, selected.name); }
                };
                worker.onerror = function () {
                    if (current !== generation) return;
                    stop(); status.text('Unable to read save. Serve the site over HTTP(S) in a current browser and try again.');
                };
                worker.postMessage(buffer, [buffer]);
            } catch (error) { stop(); status.text('Import failed: ' + error.message); }
            finally { file.val(''); }
        });
    } };
})();
