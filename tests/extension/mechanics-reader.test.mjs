/**
 * Contract §136.20: the visual reader writes mechanical shapes, and the draft check refuses a malformed one.
 *
 * Every case travels a real entry: `checkDraft` (what publication runs, with the host's viewed pages) fed
 * the contract `loadModuleContract` loads from the shipped content root, `checkReview` (publication's
 * review gate), or `checkSourceDraft` (the offline `coc-read-check` the reader runs) over files on disk.
 * Nothing normalises a draft before the check: each case is the JSON a reader would write, and the valid
 * draft is built from the worked examples of the reader's own instructions, asserted to be there verbatim.
 *
 * Refusals are asserted by their stable `rule` and their JSON pointer, never their wording.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {reviewUnits} from '../../extensions/module/reader-review.ts';

const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'mechanics-reader-'));
after(() => rm(bundleDir, {recursive: true, force: true}));
await build({stdin: {contents:
    `export {checkDraft, checkReview} from './kernel-ts/modules/visual.ts';` +
    `export {loadModuleContract} from './kernel-ts/modules/contract.ts';` +
    `export {checkSourceDraft} from './kernel-ts/check.ts';` +
    `export {snapshots} from './kernel-ts/snapshots.ts';` +
    `export {parsePythonJson, pythonJsonDumps} from './kernel-ts/json.ts';`,
    resolveDir: root, sourcefile: 'mechanics-reader-api.ts', loader: 'ts'},
    outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);
const contract = await api.loadModuleContract({content, snapshots: api.snapshots});
const prompt = await readFile(join(content, 'setup', 'visual-reader.md'), 'utf8');
/** A draft exactly as the reader's file would parse. */
const parsed = draft => api.parsePythonJson(JSON.stringify(draft));

const page3 = [{page: 3}], page4 = [{page: 4}];
const packet = {module_id: 'book-3', purpose: 'detail', focus: 'Old chapel', question: 'What does the chapel floor do, and who haunts it?', source: {page_count: 10},
    known_nodes: [
        {node_id: 'module-book-3', node_kind: 'module', name: 'Book', ready: false},
        {node_id: 'scene-old-chapel', node_kind: 'scene', name: 'Old chapel', summary: 'A ruined chapel.', properties: {}, visibility: 'keeper-only', source_refs: page3, ready: true}],
    known_claims: []};
const SEEN = new Set([3, 4]);

/** The worked examples of the reader's instructions, as the text carries them. */
const EXAMPLES = {
    check: '"check":{"scope":"actor","values":[{"path":"skills.Climb","label":"Climb"}],"selection":"maximum","difficulty":"hard","results":{"failure":{"effects":[{"kind":"damage","dice":"1D6"}]}}}',
    hazard: '"hazard":{"trigger":{"kind":"keeper"},"steps":[{"scope":"actor","values":[{"path":"characteristics.Luck","label":"Luck"}],"selection":"maximum","difficulty_unstated":true,"results":{"failure":{"effects":[{"kind":"next_step","step":1}]}}},{"scope":"actor","values":[{"path":"skills.Jump","label":"Jump"}],"selection":"maximum","difficulty_unstated":true,"results":{"failure":{"effects":[{"kind":"damage","dice":"1D6"}]}}}]}',
    damage: '{"dice":"1D4+2"}',
    sanity: '{"success":"1","failure":"1D6"}',
    time: '{"amount":3,"unit":"hour"}',
    span: '{"amount_unstated":true,"book":"<the span>"}',
    weapon: '{"name":"Claw","skill":"Fighting (Brawl)","damage":"1D6","adds_damage_bonus":true,"uses_per_round_unstated":true,"impale_unstated":true}',
    combat: '`"defense":"dodge"|"fight_back"|"none"` for how it defends, `"action":"attack"` only when the page says it always attacks, and `"disposition":"fights_to_the_end"|"fights_then_flees"|"avoids_fighting"|"surrenders"`',
    spell: '{"cost_mp":"1D6","cost_sanity":1,"casting_time":{"amount":1,"unit":"round"}}',
    tome: '{"language":"skills.Language (Other) (<that language>)","initial_reading":{"amount":2,"unit":"week"},"cthulhu_mythos_initial":2,"cthulhu_mythos_full":5}',
};
const example = key => JSON.parse(`{${EXAMPLES[key].startsWith('"') ? EXAMPLES[key] : `"x":${EXAMPLES[key]}`}}`);
const shape = key => Object.values(example(key))[0];

const CLIMB = 0, FLOOR = 1, GLASS = 2, GHOUL = 3, KNIFE = 4, SPELL = 5, TOME = 6, VICTORY = 7;
/** A detail draft stating one of every shape the reader is taught, none of it listed in critical. */
function stated() {
    return {nodes: [
        {node_id: 'rule-rope-climb', node_kind: 'rule', name: 'Rope climb', summary: 'Climbing the rope.', source_refs: page4, properties: {mechanics: example('check')}},
        {node_id: 'rule-rotten-floor', node_kind: 'rule', name: 'Rotten floor', summary: 'The floor gives way.', source_refs: page4,
            properties: {mechanics: {...example('hazard'), time_cost: shape('span')}}},
        {node_id: 'rule-broken-glass', node_kind: 'rule', name: 'Broken glass', summary: 'The window shatters.', source_refs: page4,
            properties: {mechanics: {damage: shape('damage'), sanity_loss: shape('sanity'), resource_cost: {resource: 'mp', chosen: true, per: 'cast'}}}},
        {node_id: 'creature-ghoul', node_kind: 'creature', name: 'Ghoul', summary: 'A ghoul.', source_refs: page4,
            properties: {mechanics: {profile: {characteristics: {STR: 80, CON: 65}, derived: {HP: 13, DB: '+1D4'}, skills: {'Fighting (Brawl)': 45},
                weapons: [shape('weapon')], armor_unstated: true, sanity_loss: {success: '0', failure: '1D6'}}}, combat: {defense: 'fight_back', action: 'attack', disposition: 'fights_to_the_end'}}},
        {node_id: 'object-old-knife', node_kind: 'object', name: 'Old knife', summary: 'A knife.', source_refs: page4,
            properties: {mechanics: {weapon: {name: 'Knife', skill: 'Fighting (Brawl)', damage: '1D4', uses_per_round: 1, impale: true, adds_damage_bonus: true}}}},
        {node_id: 'spell-ward', node_kind: 'spell', name: 'Ward', summary: 'A ward.', source_refs: page4, properties: {mechanics: {spell: shape('spell')}}},
        {node_id: 'tome-old-book', node_kind: 'tome', name: 'Old book', summary: 'A book.', source_refs: page4,
            properties: {mechanics: {tome: {...shape('tome'), spells: ['spell-ward']}}}},
        {node_id: 'rule-victory', node_kind: 'rule', name: 'Victory', summary: 'What surviving grants.', source_refs: page4, properties: {mechanics: {reward: {sanity: '1D6', cash: 30}}}},
    ], claims: [
        {subject_id: 'scene-old-chapel', predicate: 'uses-rule', object: {node_id: 'rule-rotten-floor'}, truth_status: 'authored-fact', source_refs: page4},
        {subject_id: 'creature-ghoul', predicate: 'present-in', object: {node_id: 'scene-old-chapel'}, truth_status: 'authored-fact', source_refs: page4},
    ], node_refs: ['scene-old-chapel'], coverage: {}, critical: [], dependencies: [],
        ready_nodes: ['rule-rope-climb', 'rule-rotten-floor', 'rule-broken-glass', 'creature-ghoul', 'object-old-knife', 'spell-ward', 'tome-old-book', 'rule-victory']};
}
const mechanicsOf = (draft, i) => draft.nodes[i].properties.mechanics;
const at = (i, rest) => `/nodes/${i}/properties/${rest}`;

/** Every leaf under a node's `mechanics` and `combat`, walked here independently of the code under test. */
function leaves(value, path) {
    if (value && typeof value === 'object') {
        const keys = Array.isArray(value) ? value.map((_, i) => String(i)) : Object.keys(value);
        return keys.length ? keys.flatMap(key => leaves(value[key], `${path}/${key}`)) : [path];
    }
    return [path];
}

/** The draft check's refusal as {rule, path, rules, error}, or null when it passed. */
function refusal(draft, packetValue = packet, seen = SEEN) {
    try {
        api.checkDraft(parsed(draft), structuredClone(packetValue), contract, seen);
        return null;
    } catch (error) {
        assert.equal(error.code, 'invalid_params', error.message);
        assert.equal(error.details?.reason, 'reading_failed', error.message);
        return {rule: error.details.rule, path: error.details.path, rules: (error.details.refusals ?? []).map(r => `${r.rule} ${r.path}`), error};
    }
}

test("the reader's instructions carry every worked example this file checks, verbatim", () => {
    for (const [key, text] of Object.entries(EXAMPLES)) assert.ok(prompt.includes(text), `the instructions lost the ${key} example`);
    for (const word of ['_unstated', '1D4+2 hit points', 'adds_damage_bonus', 'properties.combat']) assert.ok(prompt.includes(word), word);
});

test('a draft stating every shape passes, and every shape leaf is required for review though critical lists none', () => {
    const draft = stated(), filled = api.checkDraft(parsed(draft), structuredClone(packet), contract, SEEN);
    const expected = draft.nodes.flatMap((node, i) => [
        ...leaves(node.properties.mechanics, at(i, 'mechanics')),
        ...(node.properties.combat ? leaves(node.properties.combat, at(i, 'combat')) : [])]);
    assert.ok(expected.length > 60, `${expected.length} leaves`);
    for (const path of expected) assert.ok(filled.required_review.includes(path), `${path} is not required for review`);
    assert.deepEqual(draft.critical, []);
    // The numericPaths gap: strings, flags and enums, none of them a number, are all required.
    for (const path of [at(GLASS, 'mechanics/damage/dice'), at(FLOOR, 'mechanics/hazard/steps/1/results/failure/effects/0/dice'),
        at(FLOOR, 'mechanics/hazard/steps/0/difficulty_unstated'), at(FLOOR, 'mechanics/time_cost/book'), at(GHOUL, 'mechanics/profile/derived/DB'),
        at(GHOUL, 'mechanics/profile/weapons/0/skill'), at(GHOUL, 'combat/defense'), at(GHOUL, 'combat/action'), at(GHOUL, 'combat/disposition'), at(TOME, 'mechanics/tome/spells/0'), at(CLIMB, 'mechanics/check/difficulty')])
        assert.ok(filled.required_review.includes(path), path);
});

test('the reviewer units assign exactly the shape leaves the publication gate demands', () => {
    const draft = stated(), filled = api.checkDraft(parsed(draft), structuredClone(packet), contract, SEEN);
    const assigned = reviewUnits(draft).flat();
    for (const path of filled.required_review) assert.ok(assigned.includes(path), `no reviewer unit is assigned ${path}`);
});

test('a review that supports everything but one dice string does not publish', () => {
    const draft = stated(), filled = api.checkDraft(parsed(draft), structuredClone(packet), contract, SEEN);
    const all = {checked: [{paths: filled.required_review, verdict: 'supported', source_refs: page4, reason: 'compared'}], missing: []};
    api.checkReview(parsed(draft), filled, all, 10, SEEN);
    const dice = at(GLASS, 'mechanics/damage/dice');
    const short = {checked: [{paths: filled.required_review.filter(path => path !== dice), verdict: 'supported', source_refs: page4, reason: 'compared'}], missing: []};
    assert.throws(() => api.checkReview(parsed(draft), filled, short, 10, SEEN), /visual review omitted required fields/);
});

test('"1D4+2 hit points" in a dice slot is refused at its path', () => {
    const draft = stated();
    mechanicsOf(draft, GLASS).damage.dice = '1D4+2 hit points';
    const refused = refusal(draft);
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'shape_dice');
    assert.equal(refused.path, at(GLASS, 'mechanics/damage/dice'));
    assert.match(refused.error.fix, /bare expression/);
});

test('a shape citing a page this reader did not view is refused at the reference', () => {
    const draft = stated();
    draft.nodes[FLOOR].source_refs = [{page: 4}, {page: 7}];
    const refused = refusal(draft);
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'mechanics_unsourced');
    assert.equal(refused.path, `/nodes/${FLOOR}/source_refs/1`);
    delete draft.nodes[FLOOR].source_refs;
    const unsourced = refusal(draft);
    assert.equal(unsourced.rule, 'mechanics_unsourced');
    assert.equal(unsourced.path, `/nodes/${FLOOR}/source_refs`);
});

test("an unknown skill is refused with the ruleset's own names", () => {
    const draft = stated();
    mechanicsOf(draft, FLOOR).hazard.steps[1].values[0] = {path: 'skills.Leap', label: 'Leap'};
    const refused = refusal(draft);
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'shape_unknown_skill');
    assert.equal(refused.path, at(FLOOR, 'mechanics/hazard/steps/1/values/0/path'));
    assert.ok(refused.error.details.ruleset.skills.includes('Jump'));
    assert.ok(refused.error.details.ruleset.specialization_groups.includes('Fighting'));
    assert.match(refused.error.fix, /details\.ruleset/);
    // The same in a stat block's skills.
    const other = stated();
    mechanicsOf(other, GHOUL).profile.skills = {'Claw Attack': 45};
    const skills = refusal(other);
    assert.equal(skills.rule, 'shape_unknown_skill');
    assert.equal(skills.path, at(GHOUL, 'mechanics/profile/skills/Claw Attack'));
});

test('a value beside its _unstated flag is refused at its path', () => {
    const draft = stated();
    mechanicsOf(draft, GLASS).damage.dice_unstated = true;
    const refused = refusal(draft);
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'shape_unstated');
    assert.equal(refused.path, at(GLASS, 'mechanics/damage/dice'));
});

test('a shape on the wrong node kind is refused at its path', () => {
    const draft = stated();
    mechanicsOf(draft, CLIMB).weapon = shape('weapon');
    const refused = refusal(draft);
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'mechanics_wrong_kind');
    assert.equal(refused.path, at(CLIMB, 'mechanics/weapon'));
    assert.match(refused.error.fix, /136\.1 admits/);
});

test("a combat word outside an actor's closed words is refused at its path", () => {
    // SL-08 (§11.5.3): a book may author only that a creature always attacks.
    const draft = stated();
    draft.nodes[GHOUL].properties.combat.action = 'flee';
    const refused = refusal(draft);
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'shape_prose');
    assert.equal(refused.path, at(GHOUL, 'combat/action'));
});

test('a reader draft gets no legacy allowance', () => {
    const draft = stated();
    mechanicsOf(draft, GHOUL).profile.attacks = 'Claw 45%, 1D6 + DB';
    const refused = refusal(draft);
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'shape_unknown_key');
    assert.equal(refused.path, at(GHOUL, 'mechanics/profile/attacks'));
});

test('a flat STR: 90 on an NPC or a creature is refused at its path', () => {
    for (const kind of ['npc', 'creature']) {
        const draft = stated();
        draft.nodes.push({node_id: `${kind}-caretaker`, node_kind: kind, name: 'Caretaker', summary: 'The caretaker.', source_refs: page4, properties: {STR: 90, CON: 60}});
        const refused = refusal(draft);
        assert.ok(refused, `the ${kind} draft passed`);
        assert.equal(refused.rule, 'profile_outside_seat');
        assert.equal(refused.path, `/nodes/${draft.nodes.length - 1}/properties/STR`);
        // Beside a profile too: the loose copy is what never reaches the engine.
        draft.nodes.at(-1).properties.mechanics = {profile: {characteristics: {STR: 90}}};
        assert.equal(refusal(draft)?.rule, 'profile_outside_seat');
    }
    // A standalone stats dictionary on a creature, as on an NPC before.
    const dict = stated();
    dict.nodes[GHOUL].properties = {stats: {STR: 80}};
    assert.throws(() => api.checkDraft(parsed(dict), structuredClone(packet), contract, SEEN),
        error => error.code === 'invalid_params' && error.details.path === `/nodes/${GHOUL}/properties` && /standalone stats dictionary/.test(error.message));
});

test("a published node's own refusal does not refuse a draft that adds to it", () => {
    const known = {...packet, known_nodes: [...packet.known_nodes,
        {node_id: 'npc-sexton', node_kind: 'npc', name: 'Sexton', summary: 'The sexton.', visibility: 'keeper-only', source_refs: page3, ready: true,
            properties: {mechanics: {profile: {characteristics: {STR: 70}, attacks: 'Shovel 40%, 1D8'}}}}]};
    const draft = stated();
    draft.nodes.push({node_id: 'npc-sexton', node_kind: 'npc', name: 'Sexton', source_refs: page4, properties: {mechanics: {profile: {sanity_loss: {success: '0', failure: '1D3'}}}}});
    assert.equal(refusal(draft, known), null);
    // What the delta itself adds is still held to the catalog.
    draft.nodes.at(-1).properties.mechanics.profile.sanity_loss.failure = '1D3 Sanity';
    const refused = refusal(draft, known);
    assert.equal(refused.rule, 'shape_dice');
    assert.equal(refused.path, `/nodes/${draft.nodes.length - 1}/properties/mechanics/profile/sanity_loss/failure`);
});

test('a delta adding one slot to a known shape is checked as the shape it makes', () => {
    // Publication merges a delta into the known node key by key; the check sees the tome it will publish.
    const known = {...packet, known_nodes: [...packet.known_nodes,
        {node_id: 'tome-old-book', node_kind: 'tome', name: 'Old book', summary: 'A book.', visibility: 'keeper-only', source_refs: page3, ready: true,
            properties: {mechanics: {tome: {initial_reading: {amount: 2, unit: 'week'}, cthulhu_mythos_initial: 2}}}},
        {node_id: 'spell-ward', node_kind: 'spell', name: 'Ward', summary: 'A ward.', visibility: 'keeper-only', source_refs: page3, ready: true, properties: {}}]};
    const delta = {nodes: [{node_id: 'tome-old-book', node_kind: 'tome', name: 'Old book', source_refs: page4, properties: {mechanics: {tome: {spells: ['spell-ward']}}}}],
        claims: [], node_refs: [], coverage: {}, critical: [], dependencies: [], ready_nodes: ['tome-old-book']};
    assert.equal(refusal(delta, known), null);
    const filled = api.checkDraft(parsed(delta), structuredClone(known), contract, SEEN);
    assert.ok(filled.required_review.includes('/nodes/0/properties/mechanics/tome/spells/0'));
    // A delta marking unstated a slot the published shape states makes a shape with both: refused.
    delta.nodes[0].properties.mechanics.tome.cthulhu_mythos_initial_unstated = true;
    const refused = refusal(delta, known);
    assert.equal(refused.rule, 'shape_unstated');
    assert.equal(refused.path, '/nodes/0/properties/mechanics/tome/cthulhu_mythos_initial');
});

test('the offline check the reader runs refuses the same draft at the same path', async () => {
    const dir = await mkdtemp(join(bundleDir, 'offline-'));
    const draft = stated();
    mechanicsOf(draft, GLASS).damage.dice = '1D4+2 hit points';
    await writeFile(join(dir, 'task.json'), JSON.stringify(packet));
    await writeFile(join(dir, 'draft.json'), JSON.stringify(draft));
    const result = await api.checkSourceDraft(content, join(dir, 'task.json'), join(dir, 'draft.json'));
    assert.equal(result.ok, false);
    assert.equal(result.error.details.rule, 'shape_dice');
    assert.equal(result.error.details.path, at(GLASS, 'mechanics/damage/dice'));
    await writeFile(join(dir, 'draft.json'), JSON.stringify(stated()));
    const passed = await api.checkSourceDraft(content, join(dir, 'task.json'), join(dir, 'draft.json'));
    assert.equal(passed.ok, true);
    assert.ok(passed.required_review.includes(at(GLASS, 'mechanics/damage/dice')));
});

test('a draft that states no shape returns what the parent commit returned, byte for byte', async () => {
    const golden = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'mechanics-reader-parent.json'), 'utf8'));
    assert.equal(golden.recorded_on, '172b80065');
    assert.ok(golden.cases.length >= 8);
    for (const item of golden.cases) {
        let result;
        if (item.op === 'offline') {
            const dir = await mkdtemp(join(bundleDir, 'golden-'));
            await writeFile(join(dir, 'task.json'), JSON.stringify(item.packet));
            await writeFile(join(dir, 'draft.json'), JSON.stringify(item.draft));
            result = api.pythonJsonDumps(await api.checkSourceDraft(content, join(dir, 'task.json'), join(dir, 'draft.json')));
        } else {
            try { result = api.pythonJsonDumps({value: api.checkDraft(parsed(item.draft), structuredClone(item.packet), contract, item.seen ? new Set(item.seen) : undefined)}); }
            catch (error) { if (!error.toJson) throw error; result = api.pythonJsonDumps({error: error.toJson()}); }
        }
        assert.equal(result, item.result, item.name);
    }
});
