/* Local Stellaris text-save reader. No network access or game-file writes. */
(function (root) {
    'use strict';
    var MAX_BYTES = 256 * 1024 * 1024;
    var ROOT_FIELDS = new Set(['version', 'name', 'date', 'required_dlcs', 'player', 'country',
        'leaders', 'council_positions', 'galaxy', 'flags']);
    var COUNTRY_FIELDS = new Set(['name', 'type', 'ethos', 'government', 'tech_status',
        'traditions', 'ascension_perks', 'ruler', 'flags', 'owned_planets', 'modifier',
        'modifiers', 'timed_modifier', 'policy_flags', 'seen_bypass_types', 'num_cosmic_storms_encountered']);

    // Blocks retain ordered key/value pairs and unkeyed list members. Converting
    // directly to objects would lose repeated technology/level/trait fields.
    function parse(text, selective) {
        var pos = 0, look, count = 0;
        function fail(message) { throw new Error(message + ' near character ' + pos + '.'); }
        function next() {
            while (pos < text.length) {
                var c = text[pos];
                if (/\s|\uFEFF/.test(c)) { pos++; continue; }
                if (c === '#') { while (pos < text.length && text[pos] !== '\n') pos++; continue; }
                break;
            }
            if (pos >= text.length) return null;
            var start = pos, ch = text[pos++];
            if ('{}=<>!'.indexOf(ch) !== -1) return { value: ch, symbol: true };
            if (ch === '"') {
                var value = '';
                while (pos < text.length) {
                    ch = text[pos++];
                    if (ch === '"') return { value: value };
                    if (ch === '\\' && pos < text.length) {
                        var escaped = text[pos++];
                        value += escaped === '"' || escaped === '\\' ? escaped : '\\' + escaped;
                    } else value += ch;
                }
                fail('Unterminated quoted string');
            }
            while (pos < text.length && !/[\s{}=<>!#"]/.test(text[pos])) pos++;
            return { value: text.slice(start, pos) };
        }
        function peek() { if (look === undefined) look = next(); return look; }
        function take() { var token = peek(); look = undefined; return token; }
        function symbol(s) { var t = peek(); return t && t.symbol && t.value === s; }
        function block(path, keep, nested) {
            if (path.length > 128) fail('Save nesting is too deep');
            var result = keep ? { entries: [] } : null;
            while (peek() && !symbol('}')) {
                if (++count > 20000000) fail('Save contains too many values');
                var key = null, value, t = take();
                if (t.symbol && t.value === '{') {
                    value = block(path.concat('*'), keep, true);
                } else {
                    if (t.symbol) fail('Unexpected token ' + t.value);
                    value = t.value;
                    if (symbol('=')) {
                        take(); key = value;
                        var childKeep = keep && (!selective ||
                            (path.length !== 0 || ROOT_FIELDS.has(key)) &&
                            (path.length !== 2 || path[0] !== 'country' || COUNTRY_FIELDS.has(key)));
                        t = take();
                        if (!t) fail('Missing value');
                        if (t.symbol && t.value === '{') value = block(path.concat(key), childKeep, true);
                        else if (t.symbol) fail('Missing value');
                        else value = t.value;
                        if (!childKeep) continue;
                    }
                }
                if (keep) result.entries.push({ key: key, value: value });
            }
            if (nested) {
                if (!symbol('}')) fail('Unclosed block');
                take();
            } else if (peek()) fail('Unexpected closing brace');
            return result;
        }
        if (typeof text !== 'string' || text.indexOf('\0') !== -1) throw new Error('This is not a supported text gamestate.');
        return block([], true, false);
    }
    function entries(block) { return block && block.entries || []; }
    function all(block, key) { return entries(block).filter(function (e) { return e.key === key; }).map(function (e) { return e.value; }); }
    function one(block, key) { return all(block, key)[0]; }
    function has(block, key) { return all(block, key).length > 0; }
    function scalar(value) { return typeof value === 'string' ? value : null; }
    function values(value) {
        return typeof value === 'string' ? [value] : entries(value).filter(function (e) { return e.key === null; }).map(function (e) { return e.value; });
    }
    function strings(value) { return values(value).filter(function (v) { return typeof v === 'string'; }); }
    function unique(list) { return Array.from(new Set(list)); }
    function keyedStrings(block, key) { return unique(all(block, key).flatMap(strings)); }
    function names(block) { return entries(block).filter(function (e) { return e.key !== null; }).map(function (e) { return e.key; }); }
    function label(value, fallback) {
        if (typeof value === 'string') return value;
        var key = scalar(one(value, 'key'));
        // Localization templates need the game's localization database. Show a
        // stable country ID instead of guessing a rendered empire name.
        return key && key.indexOf('%') === -1 ? key : fallback;
    }

    function inspect(game, meta) {
        meta = meta || { entries: [] };
        var playerIds = values(one(game, 'player')).map(function (p) { return scalar(one(p, 'country')); }).filter(Boolean);
        if (has(one(game, 'player'), 'country')) playerIds.push(scalar(one(one(game, 'player'), 'country')));
        var countries = entries(one(game, 'country')).filter(function (e) { return one(e.value, 'tech_status') && one(e.value, 'tech_status').entries; });
        if (!countries.length) throw new Error('No countries with research data were found in this save.');
        var leaders = one(game, 'leaders');
        var positions = one(game, 'council_positions');
        positions = one(positions, 'council_positions') || positions;
        var dlcs = one(game, 'required_dlcs');
        if (dlcs === undefined) dlcs = one(meta, 'required_dlcs');
        var version = scalar(one(game, 'version')) || scalar(one(meta, 'version')) || 'Unknown version';
        var date = scalar(one(game, 'date')) || scalar(one(meta, 'date')) || '';
        return {
            version: version, date: date,
            countries: countries.map(function (entry) {
                var country = entry.value, gov = one(country, 'government'), status = one(country, 'tech_status');
                var known = [], config = {}, warnings = [];
                function list(field, present, value) {
                    config[field] = value;
                    if (present) known.push(field);
                    else warnings.push(field.replace(/_/g, ' ') + ' was not present; review it manually.');
                }
                list('ethics', has(country, 'ethos'), keyedStrings(one(country, 'ethos'), 'ethic'));
                config.authority = scalar(one(gov, 'authority'));
                config.origin = scalar(one(gov, 'origin'));
                ['authority', 'origin'].forEach(function (field) {
                    if (config[field]) known.push(field);
                    else warnings.push(field + ' was not present; review it manually.');
                });
                list('civics', has(gov, 'civics'), strings(one(gov, 'civics')));
                list('traditions', has(country, 'traditions'), strings(one(country, 'traditions')));
                list('ascension_perks', has(country, 'ascension_perks'), strings(one(country, 'ascension_perks')));
                var councilIds = strings(one(gov, 'council_positions'));
                var councilKnown = has(gov, 'council_positions') && !!positions;
                var leaderIds = [];
                councilIds.forEach(function (id) {
                    var position = one(positions, id);
                    if (!position || scalar(one(position, 'country')) !== entry.key) { councilKnown = false; return; }
                    var leaderId = scalar(one(position, 'leader'));
                    if (leaderId && leaderId !== '4294967295' && leaderId !== 'none') leaderIds.push(leaderId);
                });
                // The ruler is a council member but is stored outside the seat list.
                var ruler = scalar(one(country, 'ruler'));
                if (ruler && ruler !== '4294967295' && ruler !== 'none') leaderIds.push(ruler);
                var traits = [];
                unique(leaderIds).forEach(function (id) {
                    var leader = one(leaders, id);
                    if (!leader || scalar(one(leader, 'country')) !== entry.key) { councilKnown = false; return; }
                    traits = traits.concat(keyedStrings(leader, 'traits'));
                });
                list('council_traits', councilKnown, unique(traits));
                config.dlcs_disabled = [];
                if (dlcs !== undefined) known.push('dlcs_disabled');
                else warnings.push('DLC information was not present; review DLCs manually.');
                var technologies = [], levels = Object.create(null), lastTech;
                entries(status).forEach(function (e) {
                    if (e.key === 'technology' && typeof e.value === 'string') { lastTech = e.value; technologies.push(lastTech); }
                    else if (e.key === 'level' && lastTech) { levels[lastTech] = Number(e.value); lastTech = null; }
                });
                var queues = {};
                ['physics', 'society', 'engineering'].forEach(function (area) {
                    queues[area] = values(one(status, area + '_queue')).map(function (q) {
                        return { technology: scalar(one(q, 'technology')), progress: Number(one(q, 'progress')) || 0 };
                    }).filter(function (q) { return q.technology; });
                });
                var modifiers = all(country, 'modifier').concat(values(one(country, 'modifiers')),
                    values(one(one(country, 'timed_modifier'), 'items'))).map(function (m) {
                    return scalar(one(m, 'modifier')) || scalar(one(m, 'type')) || scalar(m);
                }).filter(Boolean);
                config.known_fields = known;
                config.save_context = {
                    version: version, date: date, country_id: entry.key,
                    country_type: scalar(one(country, 'type')),
                    country_flags: has(country, 'flags') ? names(one(country, 'flags')) : null,
                    global_flags: has(game, 'flags') ? names(one(game, 'flags')) : null,
                    owned_planets: has(country, 'owned_planets') ? strings(one(country, 'owned_planets')).length : null,
                    modifiers: has(country, 'timed_modifier') || has(country, 'modifier') || has(country, 'modifiers') ? modifiers : null,
                    policy_flags: has(country, 'policy_flags') ? strings(one(country, 'policy_flags')) : null,
                    seen_bypass_types: has(country, 'seen_bypass_types') ? strings(one(country, 'seen_bypass_types')) : null,
                    cosmic_storms: has(country, 'num_cosmic_storms_encountered') ? Number(one(country, 'num_cosmic_storms_encountered')) : null,
                    technology_levels: levels, research_queues: queues
                };
                return { id: entry.key, name: label(one(country, 'name'), 'Country ' + entry.key),
                    isPlayer: playerIds.indexOf(entry.key) !== -1, config: config,
                    technologies: unique(technologies), dlcs: dlcs === undefined ? null : strings(dlcs), warnings: warnings };
            })
        };
    }

    function project(country, options, techKeys, version) {
        var config = JSON.parse(JSON.stringify(country.config));
        var warnings = country.warnings.slice(), unlisted = [];
        var fields = { ethics: 'ethics', authority: 'authorities', civics: 'civics', origin: 'origins',
            traditions: 'traditions', council_traits: 'council_traits', ascension_perks: 'ascension_perks' };
        Object.keys(fields).forEach(function (key) {
            var available = (options[fields[key]] || []).map(function (e) { return e.key; });
            var selected = Array.isArray(config[key]) ? config[key] : config[key] ? [config[key]] : [];
            selected.forEach(function (value) { if (available.indexOf(value) === -1) unlisted.push(key + ': ' + value); });
        });
        if (country.dlcs !== null) config.dlcs_disabled = (options.dlcs || []).filter(function (d) {
            return country.dlcs.indexOf(d.key) === -1;
        }).map(function (d) { return d.key; });
        var knownTechs = new Set(techKeys);
        var matched = country.technologies.filter(function (key) { return knownTechs.has(key); });
        var missing = country.technologies.filter(function (key) { return !knownTechs.has(key); });
        config.save_context.unmapped_technologies = missing;
        if (!/\b4\.4\.6\b/.test(version)) warnings.push('Save version ' + version + ' differs from the 4.4.6 tree. Review compatibility.');
        warnings.push('Weights still contain unsupported game conditions (for example planet, neighbor, and megastructure checks). These remain marked ?; weights are estimates.');
        return { config: config, technologies: matched, missingTechs: missing, unlisted: unlisted, warnings: warnings };
    }

    function crc32(bytes) {
        var crc = -1;
        for (var i = 0; i < bytes.length; i++) {
            crc ^= bytes[i];
            for (var b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        return (crc ^ -1) >>> 0;
    }
    async function inflate(bytes, expected) {
        if (typeof DecompressionStream === 'undefined') throw new Error('Save decompression needs a current Chrome, Edge, Firefox, or Safari browser.');
        var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        var parts = [], size = 0;
        try {
            while (true) {
                var part = await reader.read();
                if (part.done) break;
                size += part.value.length;
                if (size > expected || size > MAX_BYTES) throw new Error('Decompressed save exceeds its size limit.');
                parts.push(part.value);
            }
        } catch (e) { await reader.cancel().catch(function () {}); throw e; }
        var out = new Uint8Array(size), offset = 0;
        parts.forEach(function (p) { out.set(p, offset); offset += p.length; });
        return out;
    }
    async function readSave(buffer) {
        var bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Choose a nonempty save smaller than 256 MiB.');
        var decoder = new TextDecoder('utf-8', { fatal: true });
        if (bytes.length < 4 || view.getUint32(0, true) !== 0x04034b50) {
            if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new Error('Invalid or empty save archive.');
            return inspect(parse(decoder.decode(bytes), true));
        }
        var end = -1;
        for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
        }
        if (end < 0) throw new Error('The save archive is truncated or invalid.');
        if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('Split ZIP saves are unsupported.');
        var count = view.getUint16(end + 10, true), cursor = view.getUint32(end + 16, true);
        var directoryEnd = cursor + view.getUint32(end + 12, true), files = Object.create(null), total = 0;
        if (directoryEnd > end || count === 65535) throw new Error('Invalid or unsupported ZIP64 save.');
        for (i = 0; i < count; i++) {
            if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid ZIP directory.');
            var flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
            var crc = view.getUint32(cursor + 16, true), compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
            var nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
            var local = view.getUint32(cursor + 42, true), next = cursor + 46 + nameLength + extra + comment;
            if (next > directoryEnd) throw new Error('Invalid ZIP entry.');
            var name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
            cursor = next;
            if (name !== 'gamestate' && name !== 'meta') continue;
            if (files[name] !== undefined) throw new Error('Duplicate ' + name + ' entry in archive.');
            total += size;
            if (size > MAX_BYTES || total > MAX_BYTES) throw new Error('Uncompressed save exceeds 256 MiB.');
            if (flags & 1 || (method !== 0 && method !== 8)) throw new Error('Encrypted or unsupported save compression.');
            if (local + 30 > directoryEnd || view.getUint32(local, true) !== 0x04034b50) throw new Error('Invalid ZIP file header.');
            var start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
            if (start + compressed > directoryEnd) throw new Error('Truncated ZIP member.');
            var payload = bytes.subarray(start, start + compressed);
            var decoded = method === 0 ? payload : await inflate(payload, size);
            if (decoded.length !== size || crc32(decoded) !== crc) throw new Error('Save archive failed its integrity check.');
            files[name] = decoder.decode(decoded);
        }
        if (!files.gamestate) throw new Error('The archive contains no gamestate file.');
        return inspect(parse(files.gamestate, true), files.meta ? parse(files.meta) : null);
    }
    var api = { parse: parse, inspect: inspect, project: project, readSave: readSave, one: one, all: all, values: values };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.StellarisSave = api;
})(typeof self !== 'undefined' ? self : globalThis);
