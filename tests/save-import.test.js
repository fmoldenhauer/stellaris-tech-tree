'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');
const save = require('../assets/js/save-import-core');
const fixture = fs.readFileSync(__dirname + '/fixtures/minimal.gamestate', 'utf8');
const options = require('../pegasus-4.4.6/empire_options.json');

function parseFixture(text = fixture) { return save.inspect(save.parse(text, true)); }
function engine() {
    const storage = new Map();
    const context = { window: {}, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
        setTimeout: () => 1, clearTimeout() {}, document: { querySelectorAll: () => [] } };
    context.window.localStorage = context.localStorage;
    vm.createContext(context);
    ['empire-config', 'empire-eval'].forEach(name => vm.runInContext(fs.readFileSync(__dirname + '/../assets/js/' + name + '.js', 'utf8'), context));
    return context.window;
}

test('ordered repeated assignments, strings, lists, large IDs, comments, and selective parsing', () => {
    const parsed = save.parse('\uFEFFa={ v="a # { = }" v="b\\\"c" 4000000001 } #comment\r\nb=yes');
    assert.deepEqual(save.all(save.one(parsed, 'a'), 'v'), ['a # { = }', 'b"c']);
    assert.deepEqual(save.values(save.one(parsed, 'a')), ['4000000001']);
    assert.equal(save.one(parsed, 'b'), 'yes');
    const selected = save.parse(fixture, true);
    assert.equal(save.one(save.one(save.one(selected, 'country'), '7'), 'timeline_events'), undefined);
});
test('rejects malformed text without silently accepting incomplete input', () => {
    for (const text of ['a={', 'a="unterminated', 'a=', 'a=}', 'a=yes }', 'a=\0']) assert.throws(() => save.parse(text));
    assert.throws(() => save.parse('a={'.repeat(130) + '}'.repeat(130)), /nesting/);
    assert.throws(() => parseFixture('name="not a save"'), /No countries/);
});
test('selects all player empires and imports only completed technologies, including repeatable levels', () => {
    const result = parseFixture(), c = result.countries[0];
    assert.deepEqual(result.countries.map(c => c.id), ['7', '42']);
    assert.ok(result.countries.every(c => c.isPlayer));
    assert.equal(c.name, 'Test "Empire" #1');
    assert.deepEqual(c.technologies, ['tech_lasers_1', 'tech_repeatable_improved_armor_output', 'tech_mod_only']);
    assert.equal(c.config.save_context.technology_levels.tech_repeatable_improved_armor_output, 4);
    assert.deepEqual(c.config.save_context.research_queues.physics, [{ technology: 'tech_lasers_2', progress: 12.5 }]);
    assert.equal(c.config.authority, 'auth_democratic');
});
test('resolves council seat references plus ruler, excluding other owned leaders', () => {
    const c = parseFixture().countries[0];
    assert.deepEqual(c.config.council_traits.sort(), ['leader_trait_expertise_materials_2', 'leader_trait_maniacal', 'leader_trait_spark_of_genius_2']);
    assert.ok(c.config.known_fields.includes('council_traits'));
    const broken = parseFixture(fixture.replace('leader=4000000002', 'leader=999')).countries[0];
    assert.ok(!broken.config.known_fields.includes('council_traits'));
    assert.ok(broken.warnings.some(w => w.includes('council traits')));
});
test('extracts direct country facts and does not confuse timed modifiers with flags', () => {
    const c = parseFixture().countries[0].config.save_context;
    assert.deepEqual(c.modifiers, ['curator_insight']);
    assert.deepEqual(c.country_flags, ['volatile_motes_found', 'timed_flag']);
    assert.deepEqual(c.global_flags, ['l_cluster_opened']);
    assert.equal(c.owned_planets, 3);
});
test('maps DLCs and tech keys while retaining unlisted empire inputs for rule evaluation', () => {
    const c = parseFixture().countries[0];
    const result = save.project(c, options, ['tech_lasers_1'], 'Pegasus v4.4.6');
    assert.deepEqual(result.technologies, ['tech_lasers_1']);
    assert.deepEqual(result.missingTechs, ['tech_repeatable_improved_armor_output', 'tech_mod_only']);
    assert.ok(!result.config.dlcs_disabled.includes('Apocalypse'));
    assert.ok(result.config.dlcs_disabled.includes('The Machine Age'));
    assert.ok(result.config.civics.includes('civic_meritocracy'));
    assert.ok(result.unlisted.some(v => v.includes('civic_meritocracy')));
    assert.ok(save.project(c, options, [], '3.14').warnings.some(w => w.includes('differs')));
});
test('absent data stays unknown; explicit empty sections are known empty', () => {
    const e = engine(), countries = parseFixture().countries;
    assert.equal(e.EmpireEval.evaluateCondition({ fact: 'has_tradition', value: 'tr_discovery_adopt' }, countries[0].config), false);
    assert.equal(e.EmpireEval.evaluateCondition({ fact: 'has_tradition', value: 'tr_discovery_adopt' }, countries[1].config), 'unknown');
    assert.equal(e.EmpireEval.evaluateCondition({ fact: 'has_tradition', value: 'tr_discovery_adopt' }, e.EmpireConfig.get()), 'unknown');
    const noDlc = parseFixture(fixture.replace(/required_dlcs=\{[^}]+\}/, '')).countries[0];
    assert.equal(e.EmpireEval.evaluateCondition({ fact: 'host_has_dlc', value: 'Apocalypse' }, noDlc.config), 'unknown');
});
test('save facts affect actual weights; unsupported descriptions remain unknown', () => {
    const e = engine(), cfg = parseFixture().countries[0].config;
    const evaluate = text => e.EmpireEval.evaluateCondition({ unknown: text }, cfg);
    assert.equal(evaluate('Has the Curator Insight modifier'), true);
    assert.equal(evaluate('Has the volatile_motes_found country flag'), true);
    assert.equal(evaluate('Has the nonexistent country flag'), false);
    assert.equal(evaluate('Has the l_cluster_opened global flag'), true);
    assert.equal(evaluate('Number of owned planets is greater than 5'), false);
    assert.equal(evaluate('Number of cosmic storms encountered is lower than 3'), true);
    assert.equal(evaluate('Has policy AI Outlawed'), true);
    assert.equal(evaluate('Any Owned Planet\n    Has the volatile_motes_found country flag'), 'unknown');
    assert.equal(evaluate('Any Neighbor Country'), 'unknown');
    const result = e.EmpireEval.evaluateTech({ base_weight: 10, weight_rules: [{ factor: 2, if: { unknown: 'Has the Curator Insight modifier' } }] }, cfg);
    assert.equal(result.effective, 20);
    assert.equal(result.weightStatus[0], 'applies');
});
test('empire persistence and reset include save context without sharing mutable nested state', () => {
    const e = engine(), cfg = parseFixture().countries[0].config;
    e.EmpireConfig.set(cfg);
    const copy = e.EmpireConfig.get();
    copy.save_context.country_flags.push('bad');
    assert.ok(!e.EmpireConfig.get().save_context.country_flags.includes('bad'));
    e.EmpireConfig.reset();
    assert.equal(e.EmpireConfig.get().save_context, null);
    assert.equal(e.EmpireConfig.get().known_fields.length, 0);
});

// Small independent ZIP writer exercises both stored and deflated reader paths.
function crc32(buf) { let crc = 0xffffffff; for (const byte of buf) { crc ^= byte; for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function zip(files, method = 8) {
    const locals = [], central = []; let offset = 0;
    for (const [name, content] of files) {
        const raw = Buffer.from(content), payload = method === 8 ? zlib.deflateRawSync(raw) : raw, filename = Buffer.from(name);
        const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
        local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(filename.length, 26);
        const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(method, 10);
        dir.writeUInt32LE(crc32(raw), 16); dir.writeUInt32LE(payload.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(filename.length, 28); dir.writeUInt32LE(offset, 42);
        locals.push(local, filename, payload); central.push(dir, filename); offset += local.length + filename.length + payload.length;
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}
test('reads compressed/stored .sav archives and raw gamestate with equivalent results', async () => {
    const expected = parseFixture();
    for (const method of [0, 8]) assert.deepEqual(await save.readSave(zip([['gamestate', fixture], ['meta', 'name="test"']], method)), expected);
    assert.deepEqual(await save.readSave(Buffer.from(fixture)), expected);
});
test('rejects truncated, corrupt, duplicate, missing, encrypted, oversized archive entries', async () => {
    const good = zip([['gamestate', fixture]], 0);
    await assert.rejects(save.readSave(good.subarray(0, good.length - 4)), /truncated/);
    const bad = Buffer.from(good); bad[50] ^= 1;
    await assert.rejects(save.readSave(bad), /integrity/);
    await assert.rejects(save.readSave(zip([['meta', 'x=y']])), /no gamestate/);
    await assert.rejects(save.readSave(zip([['gamestate', fixture], ['gamestate', fixture]])), /Duplicate/);
    const encrypted = Buffer.from(good), centralOffset = good.readUInt32LE(good.length - 6);
    encrypted.writeUInt16LE(1, centralOffset + 8);
    await assert.rejects(save.readSave(encrypted), /Encrypted/);
    const oversized = Buffer.from(good); oversized.writeUInt32LE(300 * 1024 * 1024, centralOffset + 24);
    await assert.rejects(save.readSave(oversized), /256 MiB/);
});
