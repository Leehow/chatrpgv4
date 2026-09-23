/**
 * RD-04 (contract §136.28): the haunting states its mechanics as shapes, on the nodes that state them, and nothing
 * the migration moved stays typed and unread.
 *
 * The shipped graph is read as bytes and walked; the registration cases write it -- with exactly the change the case
 * names -- into a content root and call `module.register`, which is what `campaign.create` does, so a case that passes
 * proves the kernel itself refused or accepted the bytes. Refusals are asserted by their stable `rule`.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
const scratch = await mkdtemp(join(tmpdir(), 'haunting-shapes-'));
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'haunting-shapes-'));
after(async () => { await rm(scratch, {recursive: true, force: true}); await rm(bundleDir, {recursive: true, force: true}); });
await build({stdin: {contents:
    `export {createKernelContext} from './kernel-ts/context.ts';` +
    `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';` +
    `export {createKernelRuntime} from './kernel-ts/registry.ts';` +
    `export {ModuleGraph} from './kernel-ts/read/module-graph.ts';`,
    resolveDir: root, sourcefile: 'haunting-shapes-api.ts'},
    outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);

const SHIPPED = JSON.parse(await readFile(join(content, 'starters/the-haunting/module-graph.json'), 'utf8'));
const SOURCE = 'pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting';
const node = (graph, id) => graph.nodes.find(entry => entry.node_id === id);
const record = (graph, id) => node(graph, id).properties.runtime_projection?.record ?? node(graph, id).properties;

// ----- nothing D9 moved stays typed and unread -----

/** Every key the migration removed, wherever it might sit. */
const REMOVED = new Set(['on_enter', 'san_triggers', 'danger_attacks', 'clock_ticks', 'attack_profiles', 'optional_rules',
    'authored_operation', 'push_runtime_status', 'time_profile', 'san_loss_to_see', 'attacks', 'attacks_per_round', 'sanity_reward']);
/** The container's legacy provenance keys (§136.1): none may sit under a `mechanics` any more. */
const CONTAINER_LEGACY = ['status', 'subject_kind', 'source_refs', 'provenance', 'fields_observed', 'fields_extracted', 'fields_not_authored'];
/** The only affordance or clue keys of the kind D9 deletes that stay typed: SO-05's police and Hall of Records rows. */
const SO05 = [
    'scene-hall-of-records/affordances/ask-clerk-redirect/sets_flags',
    'scene-higher-courts-central-police/affordances/petition-for-raid-file/skill_minimums',
    'scene-higher-courts-central-police/affordances/petition-for-raid-file/skills',
    'scene-higher-courts-central-police/affordances/use-law-contact-for-raid-file/skills',
    'conclusion-corbitt-is-undead-sorcerer/clues/clue-police-raid-chapel/affordance',
];

function walk(value, path, visit) {
    if (Array.isArray(value)) value.forEach((item, index) => walk(item, [...path, index], visit));
    else if (value && typeof value === 'object')
        for (const [key, item] of Object.entries(value)) { visit(key, item, [...path, key]); walk(item, [...path, key], visit); }
}

test('no key the migration removed remains anywhere in the haunting graph', () => {
    const found = [];
    walk(SHIPPED, [], (key, _value, path) => {
        if (REMOVED.has(key)) found.push(path.join('.'));
        if (key === 'note' && path.includes('weapons')) found.push(path.join('.'));
        if (path.at(-2) === 'mechanics' && CONTAINER_LEGACY.includes(key)) found.push(path.join('.'));
    });
    assert.deepEqual(found, []);
});

test('affordance skills, skill_minimums, sets_flags and clue affordances are left only at the SO-05 rows', () => {
    const left = [];
    for (const entry of SHIPPED.nodes) {
        const rec = entry.properties?.runtime_projection?.record ?? {};
        for (const affordance of rec.affordances ?? [])
            for (const key of ['skills', 'skill_minimums', 'sets_flags'])
                if (Object.hasOwn(affordance, key)) left.push(`${entry.node_id}/affordances/${affordance.id}/${key}`);
        for (const clue of rec.clues ?? [])
            if (Object.hasOwn(clue, 'affordance')) left.push(`${entry.node_id}/clues/${clue.clue_id}/affordance`);
    }
    assert.deepEqual(left.sort(), [...SO05].sort());
});

test('the side table carries no playtest artefact', async () => {
    for (const file of ['the-haunting.json', 'rule-index.json']) {
        const text = await readFile(join(content, 'rulesets/coc7/rules-json', file), 'utf8');
        for (const key of ['playtest_roll', 'playtest_die_rolls', 'playtest_summary_result', 'playtest_total'])
            assert.equal(text.includes(`"${key}"`), false, `${file} still carries ${key}`);
    }
});

// ----- each shape on the node that states it, cited as its neighbours are -----

const ref = (pdf_index, grep_anchor) => ({source_id: SOURCE, pdf_index, ...(grep_anchor ? {grep_anchor} : {})});
const PLACED = {
    'rule-bed-attack': {shapes: ['hazard', 'sanity_loss'], from: ['scene-upper-floor-bedroom'],
        refs: [ref(454, 'Bed Attack')], spans: ['span-page-454-anchor-1']},
    'rule-chapel-floor-collapse': {shapes: ['hazard'], from: ['scene-chapel-of-contemplation-ruins'],
        refs: [ref(451, 'Call for Luck rolls')], spans: ['span-page-451-anchor-4']},
    'rule-library-research': {shapes: ['time_cost'], from: ['scene-central-library', 'scene-hall-of-records'],
        refs: [ref(448, 'The Central Library'), ref(449, 'Hall of Records')], spans: ['span-page-448-anchor-6', 'span-page-449-anchor-2']},
    'rule-victory-rewards': {shapes: ['reward'], from: ['scene-corbitt-confrontation'],
        refs: [ref(456, "Corbitt's Hiding Place")], spans: ['span-page-456-anchor-1']},
    'tome-liber-ivonis': {shapes: ['tome'], from: [],
        refs: [ref(451), ref(451, 'minimum of three hours')], spans: ['span-page-451-anchor-2']},
    'npc-walter-corbitt': {shapes: ['profile'], from: [],
        refs: [ref(446, 'Walter Corbitt'), ref(459, 'Walter Corbitt, Undead Fiend'), ref(456, 'Using a Fighting Maneuver to Grab the Knife')],
        spans: ['span-page-446-anchor-7']},
    // No span of the starter is on page 457; the node cites the span its neighbours cite for the basement (§136.28).
    'npc-rat-pack': {shapes: ['profile'], from: [], refs: [ref(457, 'RAT PACK')], spans: ['span-page-455-anchor-2']},
};

test('each shape sits on the node that states it, linked from its scene and cited to the pages its neighbours cite', () => {
    const graph = new api.ModuleGraph('the-haunting', structuredClone(SHIPPED), 'digest', {});
    const stated = [...graph.nodes.values()].filter(entry => Object.keys(graph.mechanicsOf(entry)).length).map(entry => entry.node_id).sort();
    assert.deepEqual(stated, Object.keys(PLACED).sort());
    for (const [id, placed] of Object.entries(PLACED)) {
        const entry = graph.nodes.get(id);
        assert.deepEqual(Object.keys(graph.mechanicsOf(entry)), placed.shapes, id);
        assert.deepEqual(entry.source_refs, placed.refs, id);
        assert.deepEqual(entry.evidence_span_ids, placed.spans, id);
        const linked = SHIPPED.relations.filter(r => r.relation_kind === 'uses-rule' && r.to_node_id === id).map(r => r.from_node_id);
        assert.deepEqual(linked.sort(), [...placed.from].sort(), id);
    }
    // The clock the book advances on entering the basement, on the threat (the registered seat).
    assert.deepEqual(record(SHIPPED, 'threat-corbitt-haunting').clocks[0].advances_on, [{kind: 'enter', scene: 'scene-basement-rites'}]);
    // Corbitt's loss to see him, and one id for the floating knife across the profile and the combat operation.
    const profile = graph.mechanicsOf(graph.nodes.get('npc-walter-corbitt')).profile;
    assert.deepEqual(profile.sanity_loss, {success: '1', failure: '1D8'});
    assert.deepEqual(profile.weapons.map(weapon => weapon.weapon_id), ['claws', 'floating-knife']);
    const operations = record(SHIPPED, 'scene-corbitt-confrontation').affordances.map(a => a.rules_operation).filter(Boolean);
    assert.ok(operations.every(operation => operation.opponent_weapon_id === 'floating-knife'));
});

// ----- the allowance is gone for the haunting: a removed key written back is refused -----

async function register(mutate) {
    const dir = await mkdtemp(join(scratch, 'content-'));
    for (const name of await readdir(content))
        if (name !== 'starters') await symlink(join(content, name), join(dir, name));
    const starter = join(dir, 'starters', 'the-haunting'), shipped = join(content, 'starters', 'the-haunting');
    await mkdir(starter, {recursive: true});
    for (const name of await readdir(shipped))
        if (name !== 'module-graph.json') await symlink(join(shipped, name), join(starter, name));
    const graph = structuredClone(SHIPPED);
    mutate(graph);
    await writeFile(join(starter, 'module-graph.json'), JSON.stringify(graph, null, 2));
    const home = await mkdtemp(join(scratch, 'home-'));
    const context = await api.createKernelContext({workspace: home, content: dir, seed: 'haunting-shapes',
        locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context);
    try {
        await runtime.handlers['module.register']({module_id: 'the-haunting'});
        return null;
    } catch (error) {
        assert.equal(error.details?.reason, 'mechanics_invalid', error.message);
        return error.details.refusals;
    } finally { await runtime.close(); }
}
async function refusedUnder(rule, mutate) {
    const refusals = await register(mutate);
    assert.ok(refusals?.some(refusal => refusal.rule === rule), `expected ${rule}, got ${JSON.stringify(refusals)}`);
}
const corbitt = graph => record(graph, 'npc-walter-corbitt').mechanics;

test('the shipped haunting registers', async () => {
    assert.equal(await register(() => {}), null);
});
test('a legacy provenance key written back into the container is refused', () => refusedUnder('mechanics_unknown_shape', graph => {
    corbitt(graph).provenance = {authority: 'source_authored'};
}));
test('a legacy stat block key written back is refused', () => refusedUnder('shape_unknown_key', graph => {
    corbitt(graph).profile.san_loss_to_see = '1/1D8 Sanity points to see him move';
}));
test('a weapon note written back is refused', () => refusedUnder('shape_unknown_key', graph => {
    corbitt(graph).profile.weapons[0].note = 'Page 459: Fighting 50%.';
}));
test('a migrated rule without its page ref is refused', () => refusedUnder('mechanics_unsourced', graph => {
    node(graph, 'rule-bed-attack').source_refs = [];
}));
test('the tome without its span is refused', () => refusedUnder('mechanics_unsourced', graph => {
    node(graph, 'tome-liber-ivonis').evidence_span_ids = [];
}));
test('a hazard authored on the scene instead of its rule node is refused', () => refusedUnder('mechanics_wrong_kind', graph => {
    record(graph, 'scene-chapel-of-contemplation-ruins').mechanics = {hazard: node(graph, 'rule-chapel-floor-collapse').properties.mechanics.hazard};
}));
test('the tome\'s language as the card writes it is not a ruleset name', () => refusedUnder('shape_unknown_skill', graph => {
    node(graph, 'tome-liber-ivonis').properties.mechanics.tome.language = 'skills.Language (Latin)';
}));
