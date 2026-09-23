/**
 * Contract §136.10–§136.19 (RD-02): every mechanical shape has a reader, and the capsule's `mech` line is rendered
 * from typed values by code.
 *
 * One derived content root: the shipped haunting graph plus one node of every container shape, a creature with a
 * stat block, a tome that names a spell, a reward linked from the conclusion scene and from an ending, and a clock
 * the book advances on entering the basement. The shipped starters carry none of it yet. Every read travels a real
 * entry (`campaign.create`, `table.capsule`, `table.look`, `table.lookup`), except `mechanicsOf` itself and the
 * weapon catalog, which are asserted on the loaded graph and the real rule tables. Each rule's `summary` is written
 * to disagree with its shapes, so a renderer that read the prose instead of the types fails on the exact line.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
const scratch = await mkdtemp(join(tmpdir(), 'mechanics-readers-'));
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'mechanics-readers-'));
after(async () => { await rm(scratch, {recursive: true, force: true}); await rm(bundleDir, {recursive: true, force: true}); });
await build({stdin: {contents:
    `export {createKernelContext} from './kernel-ts/context.ts';` +
    `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';` +
    `export {createKernelRuntime} from './kernel-ts/registry.ts';` +
    `export {ModuleGraph} from './kernel-ts/read/module-graph.ts';` +
    `export {RuleTables} from './kernel-ts/rules/tables.ts';` +
    `export {moduleWeapons} from './kernel-ts/combat/profiles.ts';` +
    `export {moduleSpellRecords} from './kernel-ts/rules/catalog.ts';`,
    resolveDir: root, sourcefile: 'mechanics-readers-api.ts'},
    outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);

const SHIPPED = JSON.parse(await readFile(join(content, 'starters/the-haunting/module-graph.json'), 'utf8'));
const SOURCE = {source_id: 'pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting', pdf_index: 452};
const SPAN = 'span-page-447-anchor-1';
const START = 'scene-commission-briefing', CONCLUSION = 'scene-corbitt-confrontation';
/** A summary that disagrees with every shape: a renderer that read it would print these words. */
const PROSE = 'PROSE: the book says 9D9 damage, SAN 9/9D9 and a week of work.';

function stated(graph, kind, id, mechanics, extra = {}) {
    const node = {node_id: `${kind}-${id}`, node_kind: kind, name: extra.name ?? id, visibility: 'keeper-only', aliases: [], summary: PROSE,
        evidence_span_ids: [SPAN], properties: {mechanics}, source_refs: [SOURCE]};
    graph.nodes.push(node);
    return node;
}
let relation = 0;
const link = (graph, from, kind, to) => graph.relations.push({relation_id: `relation-rd02-${relation++}`, relation_kind: kind, from_node_id: from, to_node_id: to, properties: {}});
const check = (path, difficulty, extra = {}) => ({scope: 'actor', values: [{path, label: path.split('.')[1]}], selection: 'maximum', difficulty, ...extra});

/** The derived haunting: one node of every container shape, and the registered seats the readers read. */
function derived() {
    const graph = structuredClone(SHIPPED);
    stated(graph, 'rule', 'cellar-stairs', {
        hazard: {trigger: {kind: 'attempt', guards: {exits: ['scene-basement-rites']}}, steps: [
            check('characteristics.Luck', 'regular', {results: {failure: {effects: [{kind: 'next_step', step: 1}]}}}),
            check('skills.Jump', 'hard', {results: {failure: {effects: [{kind: 'damage', dice: '1D6'}, {kind: 'book', line: 'They land in the dark.'}]}},
                push: {allowed: true, effects: [{kind: 'damage', dice: '1D4+2'}]}}),
        ]},
        damage: {dice: '1D6', book: 'A fall onto the flagstones.'},
    });
    stated(graph, 'rule', 'archive-search', {
        check: {scope: 'actor', values: [{path: 'skills.Library Use', label: 'Library Use'}, {path: 'skills.Credit Rating', label: 'Credit Rating', minimum: 30}],
            selection: 'approach', difficulty_unstated: true, results: {regular: {effects: [{kind: 'flag', flag_id: 'records-found', value: true}]}}},
        sanity_loss: {success: '0', failure: '1D4'},
        time_cost: {amount: 240, unit: 'minute'},
        resource_cost: {resource: 'mp', chosen: true, per: 'cast'},
    });
    stated(graph, 'object', 'meat-cleaver', {weapon: {skill: 'Fighting (Brawl)', damage: '1D6', uses_per_round: 1, impale: true, adds_damage_bonus: true}});
    stated(graph, 'spell', 'veil-of-thorns', {spell: {cost_mp: 3, cost_sanity: '1D4', casting_time: {amount: 1, unit: 'round'},
        duration: {amount_unstated: true, book: 'Until dawn.'}, effects: [{kind: 'hp', amount: '1D6', direction: 'loss'}]}}, {name: 'Veil of Thorns'});
    stated(graph, 'tome', 'thorn-grimoire', {tome: {language: 'skills.Language (Other) (Latin)', initial_reading: {amount: 3, unit: 'hour', minimum: true},
        cthulhu_mythos_initial: 2, sanity_cost: {success: '1', failure: '1D6'}, spells: ['spell-veil-of-thorns']}});
    stated(graph, 'rule', 'victory-reward', {reward: {sanity: '1D6', cash: 30, currency: 'dollars', when: {kind: 'flag_set', flag_id: 'corbitt-destroyed'}}});
    stated(graph, 'creature', 'cellar-hound', {profile: {characteristics: {STR: 60, CON: 50, SIZ: 50, DEX: 70, POW: 40},
        derived: {HP: 10, MOV: 10}, skills: {'Fighting (Brawl)': 45, Dodge: 35}, weapons: [{weapon_id: 'bite', skill: 'Fighting (Brawl)', damage: '1D6', uses_per_round: 1, impale: false}],
        sanity_loss: {success: '0', failure: '1D6'}}}, {name: 'Cellar hound'});
    graph.nodes.push({node_id: 'ending-house-cleansed', node_kind: 'ending', name: 'House cleansed', visibility: 'keeper-only', aliases: [], summary: 'The house is quiet.',
        evidence_span_ids: [SPAN], properties: {}, source_refs: [SOURCE]});
    for (const id of ['rule-cellar-stairs', 'rule-archive-search', 'object-meat-cleaver', 'spell-veil-of-thorns', 'tome-thorn-grimoire'])
        link(graph, START, 'uses-rule', id);
    link(graph, CONCLUSION, 'uses-rule', 'rule-victory-reward');
    link(graph, 'ending-house-cleansed', 'uses-rule', 'rule-victory-reward');
    link(graph, 'creature-cellar-hound', 'present-in', START);
    // The threat concerns the opening scene, so its pressure row is in the opening capsule.
    link(graph, 'threat-corbitt-haunting', 'located-in', START);
    const threat = graph.nodes.find(node => node.node_id === 'threat-corbitt-haunting');
    threat.properties.runtime_projection.record.clocks[0].advances_on = [{kind: 'enter', scene: 'scene-basement-rites'}];
    threat.evidence_span_ids = threat.evidence_span_ids?.length ? threat.evidence_span_ids : [SPAN];
    threat.source_refs = threat.source_refs?.length ? threat.source_refs : [SOURCE];
    return graph;
}

async function contentWith(graph) {
    const dir = await mkdtemp(join(scratch, 'content-'));
    for (const name of await readdir(content))
        if (name !== 'starters') await symlink(join(content, name), join(dir, name));
    const starter = join(dir, 'starters', 'the-haunting'), shipped = join(content, 'starters', 'the-haunting');
    await mkdir(starter, {recursive: true});
    for (const name of await readdir(shipped))
        if (name !== 'module-graph.json') await symlink(join(shipped, name), join(starter, name));
    await writeFile(join(starter, 'module-graph.json'), JSON.stringify(graph, null, 2));
    return dir;
}
async function table(graph) {
    const home = await mkdtemp(join(scratch, 'home-'));
    const context = await api.createKernelContext({workspace: home, content: await contentWith(graph), seed: 'mechanics-readers',
        locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context), call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await runtime.handlers['campaign.create']({id: 'c1', module: 'the-haunting', pregen: 'eleanor-reed', play_language: 'en'});
    await call('table.narrate', {call_id: 't0-c1', text: 'The opening.'});
    await call('table.player_input', {text: 'I look around.'});
    return {context, runtime, call};
}

const GRAPH = derived();
const opened = await table(GRAPH);
after(() => opened.runtime.close());

const EXPECTED = {
    'cellar-stairs': 'hazard (Keeper triggers; stated on reaching basement-rites): [0] Luck regular, on failure step 1; [1] Jump hard, on failure damage 1D6 and as written, push allowed: damage 1D4+2 | damage 1D6',
    'archive-search': 'check: Library Use / Credit Rating (min 30) (by approach) difficulty unstated, on regular flag records-found true | SAN loss 0/1D4 | time 240 minutes | cost MP chosen by the spender per cast',
    'meat-cleaver': 'weapon meat-cleaver: Fighting (Brawl), 1D6, 1/round, impales, +DB',
    'Veil of Thorns': 'spell: MP 3, SAN 1D4, casting 1 round, lasts unstated, hp loss 1D6',
    'thorn-grimoire': 'tome: in Language (Other) (Latin), initial reading at least 3 hours, Cthulhu Mythos +2 initial, SAN loss 1/1D6, spells veil-of-thorns',
};

test('mechanicsOf returns the typed shapes of a node, and nothing else under mechanics', () => {
    const graph = new api.ModuleGraph('the-haunting', GRAPH, 'digest', {});
    const node = id => graph.nodes.get(id);
    assert.deepEqual(graph.mechanicsOf(node('rule-archive-search')), GRAPH.nodes.find(n => n.node_id === 'rule-archive-search').properties.mechanics);
    assert.deepEqual(Object.keys(graph.mechanicsOf(node('rule-cellar-stairs'))), ['hazard', 'damage']);
    assert.equal(graph.mechanicsOf(node('creature-cellar-hound')).profile.derived.HP, 10);
    // The starters' legacy provenance keys beside `profile` are not shapes.
    assert.deepEqual(Object.keys(graph.mechanicsOf(node('npc-walter-corbitt'))), ['profile']);
    // A shape on a kind outside its row is not read (the validator refuses it on a starter; a PDF build is read no further).
    const wrong = structuredClone(GRAPH), clue = wrong.nodes.find(n => n.node_kind === 'clue');
    clue.properties = {...clue.properties, mechanics: {damage: {dice: '1D6'}}};
    assert.deepEqual(new api.ModuleGraph('m', wrong, 'd', {}).mechanicsOf(clue), {});
    // The spell flat-key bridge: a spell without mechanics.spell answers its flat cost keys, exactly as authored.
    const flat = structuredClone(GRAPH), ward = flat.nodes.find(n => n.node_id === 'spell-flesh-ward');
    ward.properties = {...ward.properties, cost_mp: 'variable', cost_sanity: 1};
    assert.deepEqual(new api.ModuleGraph('m', flat, 'd', {}).mechanicsOf(ward), {spell: {cost_mp: 'variable', cost_sanity: 1}});
    assert.deepEqual(graph.mechanicsOf(node('spell-flesh-ward')), {});
});

test('the capsule\'s where.rules rows carry the mech line rendered from typed values, cut to 160 with mech_truncated', async () => {
    const capsule = await opened.call('table.capsule');
    // The capsule's `where` budget may drop trailing rows (§13.1); every row it keeps carries its exact line.
    assert.deepEqual(capsule.where.rules.map(entry => entry.name), Object.keys(EXPECTED).slice(0, capsule.where.rules.length));
    assert.ok(capsule.where.rules.length >= 2, 'the long hazard row and the next row are in the capsule');
    for (const entry of capsule.where.rules) {
        const line = EXPECTED[entry.name];
        assert.equal(entry.mech, line.length > 160 ? Array.from(line).slice(0, 160).join('') : line, entry.name);
        assert.equal(entry.mech_truncated === true, line.length > 160, entry.name);
        assert.ok(!entry.mech.includes('PROSE') && !entry.mech.includes('9D9'), 'nothing of the summary is in the mech line');
    }
    assert.ok(EXPECTED['cellar-stairs'].length > 160 && capsule.where.truncated === true);
    // look focus=scene carries the whole line.
    const look = await opened.call('table.look', {focus: 'scene'});
    const full = Object.fromEntries(look.where.rules.map(entry => [entry.name, entry]));
    assert.deepEqual(Object.keys(full), Object.keys(EXPECTED));
    for (const [name, line] of Object.entries(EXPECTED)) {
        assert.equal(full[name].mech, line, name);
        assert.ok(!('mech_truncated' in full[name]));
    }
});

test('a rules row whose node states no shape has no mech key', async () => {
    const graph = derived();
    stated(graph, 'rule', 'bare-note', {});
    delete graph.nodes.at(-1).properties.mechanics;
    link(graph, START, 'uses-rule', 'rule-bare-note');
    const {runtime, call} = await table(graph);
    try {
        const entry = (await call('table.look', {focus: 'scene'})).where.rules.find(row => row.name === 'bare-note');
        assert.deepEqual(entry, {name: 'bare-note', line: PROSE});
    } finally { await runtime.close(); }
});

test('a creature with a stat block is an actor: present at its scene, and the book\'s numbers are its profile', async () => {
    const capsule = await opened.call('table.capsule');
    assert.ok(capsule.present.some(person => person.name === 'Cellar hound'), JSON.stringify(capsule.present.map(p => p.name)));
    // The shipped creature without a stat block stays scenery (behaviour moves only with data).
    const graph = new api.ModuleGraph('the-haunting', GRAPH, 'digest', {});
    assert.equal(graph.actor('cellar-hound')?.node_id, 'creature-cellar-hound');
    assert.equal(graph.actor('rat-pack')?.node_id, 'npc-rat-pack', 'a person of the same handle comes first');
    assert.equal(graph.isActor(graph.nodes.get('creature-rat-pack')), false);
});

test('the module lookup\'s endings carry the reward shapes of the rules a conclusion scene or an ending links', async () => {
    const endings = (await opened.call('table.lookup', {kind: 'secret', scope: 'module'})).endings;
    const reward = {rule: 'victory-reward', sanity: '1D6', cash: 30, currency: 'dollars', when: {kind: 'flag_set', flag_id: 'corbitt-destroyed'}};
    const conclusion = endings.find(row => row.scene === 'corbitt-confrontation');
    // Since RD-04 the shipped haunting states its own reward there (§136.28), read first, in relation order.
    const shippedReward = {rule: 'victory-rewards', sanity: '1D6'};
    assert.deepEqual(conclusion.rewards, [shippedReward, reward]);
    assert.equal(conclusion.sanity_reward, null, 'RD-04 moved the contract\'s own reward into rule-victory-rewards');
    assert.deepEqual(endings.find(row => row.ending), {ending: 'house-cleansed', rewards: [reward]});
    const shipped = new api.ModuleGraph('the-haunting', SHIPPED, 'digest', {});
    assert.deepEqual(shipped.statedRewards(shipped.nodes.get(CONCLUSION)), [shippedReward]);
});

test('the threat pressure row says where the book advances its clock', async () => {
    const row = (await opened.call('table.capsule')).pressures.find(entry => entry.kind === 'threat' && entry.name === 'corbitt-haunting');
    assert.ok(row, 'the threat concerns the opening scene');
    assert.equal(row.advances, 'corbitt-awareness: the book advances it on entering basement-rites');
});

test('the graph\'s weapon shapes join the module weapon catalog after the ruleset table, projected for the engine', async () => {
    const graph = new api.ModuleGraph('the-haunting', GRAPH, 'digest', {});
    const weapons = await api.moduleWeapons(new api.RuleTables(opened.context), graph);
    const ids = weapons.map(weapon => weapon.weapon_id);
    const table = JSON.parse(await readFile(join(content, 'rulesets/coc7/rules-json/the-haunting.json'), 'utf8')).weapons.map(weapon => weapon.weapon_id);
    assert.deepEqual(ids, [...table, 'meat-cleaver'], 'the ruleset table first, then the graph');
    assert.deepEqual(weapons.find(weapon => weapon.weapon_id === 'meat-cleaver'),
        {skill: 'Fighting (Brawl)', damage: '1D6', uses_per_round: '1', impales: true, adds_damage_bonus: true, weapon_id: 'meat-cleaver'});
});

test('a spell with mechanics.spell is priced; a chosen cost is not', () => {
    const graph = new api.ModuleGraph('the-haunting', GRAPH, 'digest', {});
    const veil = api.moduleSpellRecords(graph).find(record => record.name === 'Veil of Thorns').module_authored.costs;
    assert.deepEqual(veil, {authored: true, fields: {cost_mp: 3, cost_sanity: '1D4'}, missing: []});
    const chosen = structuredClone(GRAPH), spell = chosen.nodes.find(n => n.node_id === 'spell-veil-of-thorns').properties.mechanics.spell;
    delete spell.cost_mp; spell.cost_mp_chosen = true;
    const costs = api.moduleSpellRecords(new api.ModuleGraph('m', chosen, 'd', {})).find(record => record.name === 'Veil of Thorns').module_authored.costs;
    assert.deepEqual(costs, {authored: false, fields: {cost_sanity: '1D4'}, missing: ['cost_mp'], chosen: ['cost_mp']});
});

test('no kernel file but the one reader reads a record\'s mechanics', async () => {
    const offenders = [];
    async function walk(dir) {
        for (const entry of await readdir(dir, {withFileTypes: true})) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) await walk(path);
            else if (entry.name.endsWith('.ts') && !path.endsWith('read/module-graph.ts') && !path.includes('/modules/')) {
                const text = await readFile(path, 'utf8');
                if (/recordOf\([^()]*\)\s*\.\s*mechanics\b|recordOf\([^()]*\)\s*\)\s*\.\s*mechanics\b/.test(text)) offenders.push(path.slice(root.length + 1));
            }
        }
    }
    await walk(join(root, 'kernel-ts'));
    assert.deepEqual(offenders, [], 'mechanics is read through ModuleGraph.mechanicsOf (contract §136.10)');
});
