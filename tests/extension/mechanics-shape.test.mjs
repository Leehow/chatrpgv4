/**
 * Contract §136: the closed catalog of mechanical shapes, and the one validator that refuses a malformed one.
 *
 * Every case travels a real entry. A starter case writes the shipped haunting graph -- with exactly the
 * change the case names -- into a content root and calls `module.register`, which is what `campaign.create`
 * does; a Mod case installs a package derived from `natural-npc` through `mods.install`. Nothing here
 * normalises its input first, so a case that passes proves the kernel itself refused (or accepted) the bytes
 * an author would ship. The one direct call is the reader-draft branch (`starter: false`), which has no real
 * entry until RD-05 wires the draft check.
 *
 * Refusals are asserted by their stable `rule`, never their wording.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
const scratch = await mkdtemp(join(tmpdir(), 'mechanics-shape-'));
// The bundle sits inside the repository so its bare imports resolve against the repository's packages.
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'mechanics-shape-'));
after(async () => { await rm(scratch, {recursive: true, force: true}); await rm(bundleDir, {recursive: true, force: true}); });
await build({stdin: {contents:
    `export {createKernelContext} from './kernel-ts/context.ts';` +
    `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';` +
    `export {createKernelRuntime} from './kernel-ts/registry.ts';` +
    `export {rollExpression} from './kernel-ts/resolve/arithmetic.ts';` +
    `export {CombatSession} from './kernel-ts/combat/engine.ts';` +
    `export {PythonRandom} from './kernel-ts/random.ts';` +
    `export {ModuleGraph} from './kernel-ts/read/module-graph.ts';` +
    `export {mechanicsRefusals} from './kernel-ts/modules/mechanics-shape.ts';`,
    resolveDir: root, sourcefile: 'mechanics-api.ts'},
    outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);

const SHIPPED = JSON.parse(await readFile(join(content, 'starters/the-haunting/module-graph.json'), 'utf8'));
const SOURCE = {source_id: 'pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting', pdf_index: 452};
const SPAN = 'span-page-447-anchor-1';

async function kernelOver(contentRoot) {
    const home = await mkdtemp(join(scratch, 'home-'));
    const context = await api.createKernelContext({workspace: home, content: contentRoot, seed: 'mechanics',
        locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context);
    return {home, runtime, call: (method, params = {}) => runtime.handlers[method](params)};
}

/** A content root that is the shipped one except for the haunting's graph, which `mutate` edits. */
async function contentWith(mutate) {
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
    return dir;
}

const node = (graph, id) => graph.nodes.find(entry => entry.node_id === id);
const record = (graph, id) => node(graph, id).properties.runtime_projection.record;
const corbitt = graph => record(graph, 'npc-walter-corbitt').mechanics.profile;
/** A node stating `mechanics`, cited as a starter node must be. */
function stated(graph, kind, id, mechanics, extra = {}) {
    const entry = {node_id: `${kind}-${id}`, node_kind: kind, name: id, visibility: 'keeper-only', aliases: [], summary: `${id}.`,
        evidence_span_ids: [SPAN], properties: {mechanics}, source_refs: [SOURCE], ...extra};
    graph.nodes.push(entry);
    return entry;
}

/** Registers the mutated starter; null when it registered, else its refusals `{node, path, rule}`. */
async function register(mutate) {
    const {runtime, call} = await kernelOver(await contentWith(mutate));
    try {
        await call('module.register', {module_id: 'the-haunting'});
        return null;
    } catch (error) {
        assert.equal(error.code, 'invalid_params', error.message);
        assert.equal(error.details?.reason, 'mechanics_invalid', error.message);
        return error.details.refusals;
    } finally { await runtime.close(); }
}
async function accepted(mutate) {
    const refusals = await register(mutate);
    assert.equal(refusals, null, `expected acceptance, got ${JSON.stringify(refusals)}`);
}
async function refusedUnder(rule, mutate) {
    const refusals = await register(mutate);
    assert.ok(refusals, `expected a ${rule} refusal, but the starter registered`);
    assert.ok(refusals.some(refusal => refusal.rule === rule), `expected ${rule}, got ${JSON.stringify(refusals)}`);
    return refusals;
}

// A stated check of owner `rule`: Library Use against the house's records, as a rule node would carry it.
const CHECK = () => ({scope: 'actor', values: [{path: 'skills.Library Use', label: 'Library Use'}], selection: 'maximum', difficulty: 'regular'});

// ----- the shipped starters and the accepted shapes -----

test('every shipped starter registers unchanged, and the haunting copy with its legacy allowance does too', async () => {
    const {runtime, call} = await kernelOver(content);
    try {
        for (const id of ['the-haunting', 'mystery-house', 'voice-bench', 'the-haunting-rulebook'])
            assert.equal((await call('module.register', {module_id: id})).status, 'installed', id);
    } finally { await runtime.close(); }
    await accepted(() => {});
    // The allowance is what the curated starters carry today, and nothing more.
    const container = record(SHIPPED, 'npc-walter-corbitt').mechanics;
    assert.deepEqual(Object.keys(container).filter(key => key !== 'profile').sort(),
        ['fields_extracted', 'fields_not_authored', 'fields_observed', 'provenance', 'source_refs', 'status', 'subject_kind']);
    assert.ok(['attacks', 'attacks_per_round', 'san_loss_to_see'].every(key => Object.hasOwn(container.profile, key)));
    assert.ok(container.profile.weapons.every(weapon => Object.hasOwn(weapon, 'note') && Object.hasOwn(weapon, 'weapon_id')));
});

test('the minimal node of every one of the fifteen shapes is accepted', async () => {
    await accepted(graph => {
        stated(graph, 'rule', 'library-check', {check: CHECK()});                                               // 1 check
        stated(graph, 'rule', 'fall', {damage: {dice: '1D6'}});                                                   // 2 damage
        stated(graph, 'object', 'knife-sight', {sanity_loss: {success: '0', failure: '1D4'}});                   // 3 sanity_loss
        stated(graph, 'rule', 'research-time', {time_cost: {amount: 240, unit: 'minute'}});                      // 4 time_cost
        stated(graph, 'artifact', 'knife-cost', {resource_cost: {resource: 'mp', amount: 1, per: 'round'}});    // 5 resource_cost
        stated(graph, 'hazard', 'stairs', {hazard: {trigger: {kind: 'keeper'}, when: {kind: 'always'}}});        // 6 gate, 7 hazard
        // 8 obligation: the shipped haunting's two requirement nodes register above and here.
        stated(graph, 'creature', 'rats', {profile: {}});                                                         // 9 stat_block
        stated(graph, 'object', 'cleaver', {weapon: {extends: 'knife_medium'}});                                  // 10 weapon
        record(graph, 'npc-walter-corbitt').combat = {defense: 'fight_back'};                                    // 11 tactic
        stated(graph, 'spell', 'ward', {spell: {cost_mp: 1, cost_sanity: '1D4', casting_time: {amount: 5, unit: 'round'}}}); // 12 spell
        stated(graph, 'tome', 'diary', {tome: {initial_reading: {amount: 3, unit: 'hour', minimum: true}}});    // 13 tome
        stated(graph, 'rule', 'reward', {reward: {sanity: '1D6'}});                                               // 14 reward
        record(graph, 'threat-corbitt-haunting').clocks[0].advances_on = [{kind: 'enter', scene: 'scene-basement-rites'}]; // 15 clock
    });
});

test('an _unstated variant of every needed slot, and the admitted twins of optional ones, are accepted', async () => {
    await accepted(graph => {
        stated(graph, 'rule', 'u-difficulty', {check: (({difficulty, ...rest}) => ({...rest, difficulty_unstated: true}))(CHECK())});
        stated(graph, 'rule', 'u-approaches', {check: {scope: 'actor', approaches_unstated: true, difficulty: 'hard'}});
        stated(graph, 'rule', 'u-damage', {damage: {dice_unstated: true, book: 'He is hurt badly.'}});
        stated(graph, 'rule', 'u-sanity', {sanity_loss: {success_unstated: true, failure_unstated: true}});
        stated(graph, 'rule', 'u-time', {time_cost: {amount_unstated: true, book: 'each half-day'}});
        stated(graph, 'rule', 'u-cost', {resource_cost: {resource: 'mp', amount_unstated: true}});
        stated(graph, 'rule', 'u-chosen', {resource_cost: {resource: 'mp', chosen: true}});
        stated(graph, 'object', 'u-weapon', {weapon: {name: 'Hook', skill_unstated: true, damage_unstated: true, uses_per_round_unstated: true, impale_unstated: true}});
        stated(graph, 'spell', 'u-spell', {spell: {cost_mp_unstated: true, cost_sanity_unstated: true, cost_pow_unstated: true, casting_time: {amount_unstated: true}}});
        stated(graph, 'spell', 'u-chosen', {spell: {cost_mp_chosen: true, cost_sanity: 0, casting_time: {amount: 5, unit: 'round'}}});
        stated(graph, 'tome', 'u-tome', {tome: {initial_reading: {amount_unstated: true}, read_check_unstated: true, cthulhu_mythos_initial_unstated: true}});
        stated(graph, 'rule', 'u-reward', {reward: {sanity_unstated: true, cash: 30, currency: 'USD'}});
        corbitt(graph).armor_unstated = true;
    });
});

test('rich shapes: a two-step hazard with next_step, effects of every kind, opposed checks, full weapons, a tome and a spell', async () => {
    await accepted(graph => {
        stated(graph, 'hazard', 'chapel-floor', {hazard: {
            trigger: {kind: 'attempt', guards: {exits: ['scene-basement-rites'], people: ['npc-walter-corbitt']}},
            when: {kind: 'flag_set', flag_id: 'chapel-searched', value: true},
            steps: [
                {scope: 'actor', values: [{path: 'characteristics.Luck', label: 'Luck'}], selection: 'maximum', difficulty: 'regular',
                    results: {failure: {effects: [{kind: 'next_step', step: 1}]}}},
                {scope: 'actor', values: [{path: 'skills.Jump', label: 'Jump'}], selection: 'maximum', difficulty: 'regular',
                    results: {failure: {effects: [{kind: 'damage', dice: '1D6'}], book: 'They fall into the pit.'}, fumble: {}},
                    push: {allowed: true, effects: [{kind: 'book', line: 'The floor gives way entirely.'}]}},
            ],
            effects: [{kind: 'time', amount: 1, unit: 'round'}, {kind: 'cost', resource: 'luck', amount: '1D10'},
                {kind: 'flag', flag_id: 'chapel-floor-broken', value: true}, {kind: 'clock', clock_id: 'corbitt-awareness', ticks: 1},
                {kind: 'sanity_loss', success: '0', failure: '1D3'}, {kind: 'book', line: 'Dust everywhere.'}],
            book: 'The chapel floor is rotten.'}});
        stated(graph, 'rule', 'knife-fight', {check: {scope: 'opposed', target: 'npc-walter-corbitt', values: [{path: 'skills.Dodge', label: 'Dodge'}],
            selection: 'maximum', opposing: {values: [{path: 'characteristics.POW', label: 'POW'}], selection: 'maximum'}, difficulty: 'regular',
            results: {failure: {effects: [{kind: 'damage', dice: '1D4+2'}]}}}});
        stated(graph, 'rule', 'social', {check: {scope: 'actor-target', target: 'npc-walter-corbitt', selection: 'approach', difficulty: 'hard',
            values: [{path: 'skills.Persuade', label: 'Persuade'}, {path: 'skills.Credit Rating', label: 'Credit Rating', minimum: 75}]}});
        stated(graph, 'object', 'revolver', {weapon: {weapon_id: 'old-revolver', name: 'Old revolver', skill: 'Firearms (Handgun)', damage: '1D10',
            uses_per_round: 1, impale: true, adds_damage_bonus: false, base_range_yards: 15, magazine: 6, malfunction: 100},
            sanity_loss: {success: '1', failure: '1D6+1'}});
        stated(graph, 'tome', 'ivonis', {tome: {language: 'skills.Language (Other: Latin)', read_without_roll_at: 50,
            read_check: {scope: 'actor', values: [{path: 'skills.Language (Other) (Latin)', label: 'Latin'}], selection: 'maximum', difficulty: 'regular'},
            initial_reading: {amount: 3, unit: 'hour', minimum: true}, full_study: {amount: 2, unit: 'week'}, cthulhu_mythos_initial: 2,
            cthulhu_mythos_full: 5, mythos_rating: 12, sanity_cost: {success: '1', failure: '1D4'}, max_sanity_reduction: 2, spells: ['spell-flesh-ward']}});
        stated(graph, 'spell', 'dominate', {spell: {cost_mp: '1D6', cost_sanity: 1, cost_pow: 0, casting_time: {amount: 1, unit: 'round'},
            duration: {amount_unstated: true}, effects: [{kind: 'san', amount: '1D4', direction: 'loss'}]}});
        stated(graph, 'rule', 'victory', {reward: {sanity: '1D6', cash: 30, currency: 'USD', when: {kind: 'clue_discovered', clue_id: 'clue-house-built-1835'}}});
        Object.assign(corbitt(graph), {armor: 2, sanity_loss: {success: '1', failure: '1D8'}});
        // Skill names resolve against skill keys, specialization-group keys and a group's members (ruling C).
        Object.assign(corbitt(graph).skills, {'Science (Botany)': 10, 'Survival (Desert)': 12, 'Pilot (Boat)': 5, Firearms: 20});
        record(graph, 'npc-walter-corbitt').combat = {defense: 'none'};
    });
});

// ----- the refusals of §136.8, one rule each -----

test('mechanics_unknown_shape: a book key invented under mechanics', () => refusedUnder('mechanics_unknown_shape', graph => {
    stated(graph, 'rule', 'basement-search', {pushed_fail_damage: '1D4+2 hit points'});
}));
test('mechanics_unknown_shape: mechanics.tactic is not a seat; combat.defense is (ruling D)', () => refusedUnder('mechanics_unknown_shape', graph => {
    record(graph, 'npc-walter-corbitt').mechanics.tactic = {defense: 'dodge'};
}));
test('mechanics_unknown_shape: the container allowance is the starters\', and a reader draft gets none', async () => {
    // No real entry runs the draft check until RD-05, so this is the one direct call: the same graph as a
    // starter registers, and as a draft (starter: false) is refused for every allowance key it carries.
    const graph = new api.ModuleGraph('the-haunting', structuredClone(SHIPPED), 'digest', {});
    const rules = {skills: ['Dodge', 'Intimidate', 'Listen', 'Sleight of Hand', 'Stealth', 'Cthulhu Mythos'], groups: {Fighting: {specializations: {Brawl: 25}}},
        characteristics: ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'], weapons: ['claws', 'knife_medium'], damageBonuses: ['-1', '+1D4']};
    assert.deepEqual(api.mechanicsRefusals(graph, rules, {starter: true}), []);
    const draft = api.mechanicsRefusals(graph, rules, {starter: false});
    assert.ok(draft.some(refusal => refusal.rule === 'mechanics_unknown_shape' && refusal.path.endsWith('mechanics.provenance')));
    assert.ok(draft.some(refusal => refusal.rule === 'shape_unknown_key' && refusal.path.endsWith('profile.attacks')));
    assert.ok(draft.some(refusal => refusal.rule === 'shape_unknown_key' && refusal.path.endsWith('weapons[0].note')));
    assert.ok(draft.some(refusal => refusal.rule === 'mechanics_unsourced' && refusal.node === 'npc-rat-pack'));
});
test('mechanics_wrong_kind: a damage shape on a person', () => refusedUnder('mechanics_wrong_kind', graph => {
    record(graph, 'npc-walter-corbitt').mechanics.damage = {dice: '1D6'};
}));
test('mechanics_wrong_kind: a standing defence on a clue', () => refusedUnder('mechanics_wrong_kind', graph => {
    node(graph, 'clue-house-built-1835').properties.combat = {defense: 'dodge'};
}));
test('mechanics_unsourced: a stated rule without source_refs', () => refusedUnder('mechanics_unsourced', graph => {
    stated(graph, 'rule', 'fall', {damage: {dice: '1D6'}}, {source_refs: []});
}));
test('mechanics_unsourced: a starter rule without evidence spans', () => refusedUnder('mechanics_unsourced', graph => {
    stated(graph, 'rule', 'fall', {damage: {dice: '1D6'}}, {evidence_span_ids: []});
}));
test('mechanics_unsourced: a starter stat block that states more than its registered profile', () => refusedUnder('mechanics_unsourced', graph => {
    record(graph, 'npc-rat-pack').combat = {defense: 'dodge'};
}));
test('shape_unknown_key: a severity preset the damage shape does not have', () => refusedUnder('shape_unknown_key', graph => {
    stated(graph, 'rule', 'fall', {damage: {dice: '1D6', severity: 'severe'}});
}));
test('shape_unknown_key: a stat block key outside the closure and the allowance', () => refusedUnder('shape_unknown_key', graph => {
    corbitt(graph).healing = 'does not heal';
}));
test('shape_prose: the book\'s armour sentence in the armour slot', () => refusedUnder('shape_prose', graph => {
    corbitt(graph).armor = 'roll 2D6 armor, reduce by one per point of damage';
}));
test('shape_prose: a defence word outside the closed enum', () => refusedUnder('shape_prose', graph => {
    record(graph, 'npc-walter-corbitt').combat = {defense: 'parry'};
}));
test('shape_prose: a span in the unit slot', () => refusedUnder('shape_prose', graph => {
    stated(graph, 'rule', 'research', {time_cost: {amount: 1, unit: 'half-day'}});
}));
test('shape_dice: a unit inside the dice string', () => refusedUnder('shape_dice', graph => {
    stated(graph, 'rule', 'basement-search', {damage: {dice: '1D4+2 hit points'}});
}));
test('shape_dice: a Sanity half the sanity engine cannot roll', () => refusedUnder('shape_dice', graph => {
    stated(graph, 'rule', 'bed', {sanity_loss: {success: '1', failure: '1/1D4'}});
}));
test('shape_unstated: a value and its _unstated twin both present', () => refusedUnder('shape_unstated', graph => {
    stated(graph, 'rule', 'fall', {damage: {dice: '1D6', dice_unstated: true}});
}));
test('shape_unstated: neither the value nor its twin for a needed slot', () => refusedUnder('shape_unstated', graph => {
    stated(graph, 'rule', 'fall', {damage: {book: 'They fall.'}});
}));
test('shape_unstated: a stated time amount without its unit', () => refusedUnder('shape_unstated', graph => {
    stated(graph, 'rule', 'research', {time_cost: {amount: 4}});
}));
test('shape_unresolved: a weapon extending a weapon the ruleset does not have', () => refusedUnder('shape_unresolved', graph => {
    stated(graph, 'object', 'cleaver', {weapon: {extends: 'cleaver-of-doom'}});
}));
test('shape_unresolved: a damage bonus outside the ruleset table', () => refusedUnder('shape_unresolved', graph => {
    corbitt(graph).derived.DB = '+1D4 (claws)';
}));
test('shape_unresolved: a check target that is not a person of the module', () => refusedUnder('shape_unresolved', graph => {
    stated(graph, 'rule', 'social', {check: {...CHECK(), scope: 'actor-target', target: 'npc-nobody'}});
}));
test('shape_unresolved: an effect clock the module has no threat for', () => refusedUnder('shape_unresolved', graph => {
    stated(graph, 'rule', 'noise', {hazard: {trigger: {kind: 'keeper'}, effects: [{kind: 'clock', clock_id: 'no-such-clock', ticks: 1}]}});
}));
test('shape_unknown_skill: a stat block skill the ruleset does not have', () => refusedUnder('shape_unknown_skill', graph => {
    corbitt(graph).skills['Sweet Talk'] = 40;
}));
test('shape_unknown_skill: a member an enumerating group never declared', () => refusedUnder('shape_unknown_skill', graph => {
    corbitt(graph).skills['Science (Astrology)'] = 40;
}));
test('shape_unknown_skill: a stated check\'s skill the ruleset does not have', () => refusedUnder('shape_unknown_skill', graph => {
    stated(graph, 'rule', 'library-check', {check: {...CHECK(), values: [{path: 'skills.Archive Diving', label: 'Archives'}]}});
}));
test('shape_effect: a consequence kind no verb writes', () => refusedUnder('shape_effect', graph => {
    stated(graph, 'rule', 'eviction', {check: {...CHECK(), results: {failure: {effects: [{kind: 'eject'}]}}}});
}));
test('shape_effect: next_step outside a hazard', () => refusedUnder('shape_effect', graph => {
    stated(graph, 'rule', 'library-check', {check: {...CHECK(), results: {failure: {effects: [{kind: 'next_step', step: 1}]}}}});
}));
test('shape_effect: next_step pointing back to its own step', () => refusedUnder('shape_effect', graph => {
    stated(graph, 'hazard', 'loop', {hazard: {trigger: {kind: 'keeper'}, steps: [
        {...CHECK(), results: {failure: {effects: [{kind: 'next_step', step: 1}]}}},
        {...CHECK(), results: {failure: {effects: [{kind: 'next_step', step: 0}]}}}]}});
}));
test('shape_duplicate: a hazard guarding a clue repeats that clue\'s own gate', () => refusedUnder('shape_duplicate', graph => {
    stated(graph, 'hazard', 'records', {hazard: {trigger: {kind: 'attempt', guards: {clues: ['clue-house-built-1835']}}, steps: [CHECK()]}});
}));
test('shape_duplicate: a rule node an obligation calls for states the same check a second time', () => refusedUnder('shape_duplicate', graph => {
    const step = node(graph, 'requirement-globe-clippings-access').properties.obligation.demand.find(entry => entry.kind === 'check');
    stated(graph, 'rule', 'globe-access', {check: {scope: 'actor-target', target: step.target, values: step.values.map(({path, label}) => ({path, label})),
        selection: step.selection, difficulty: step.difficulty}});
    graph.claims.push({claim_id: 'claim-calls-for-check-globe-access', subject_id: 'requirement-globe-clippings-access', predicate: 'calls-for-check',
        object: {node_id: 'rule-globe-access'}, truth_status: 'authored-fact', visibility: 'keeper-only', evidence_span_ids: [SPAN],
        asserted_by_ids: [], known_by_ids: [], validity: null, confidence: 1.0, reason: 'fixture'});
}));
test('check_scope: a scope outside the rule owner\'s set', () => refusedUnder('check_scope', graph => {
    stated(graph, 'rule', 'library-check', {check: {...CHECK(), scope: 'group'}});
}));
test('check_scope: an opposed check without its opposing side', () => refusedUnder('check_scope', graph => {
    stated(graph, 'rule', 'knife', {check: {...CHECK(), scope: 'opposed'}});
}));
test('check_selection: a selection outside maximum and approach', () => refusedUnder('check_selection', graph => {
    stated(graph, 'rule', 'library-check', {check: {...CHECK(), selection: 'combined_all'}});
}));
test('check_values: the book\'s skill prose in the values slot', () => refusedUnder('check_values', graph => {
    stated(graph, 'rule', 'stairs', {check: {...CHECK(), values: 'Combined DEX or Climb'}});
}));
test('check_difficulty: a prose difficulty', () => refusedUnder('check_difficulty', graph => {
    stated(graph, 'rule', 'library-check', {check: {...CHECK(), difficulty: 'Regular; Obscure Clue'}});
}));
test('check_results: a result level that is not one of the six', () => refusedUnder('check_results', graph => {
    stated(graph, 'rule', 'library-check', {check: {...CHECK(), results: {success: {book: 'They find it.'}}}});
}));

// ----- one dice grammar (§136.3) -----

const ACCEPTED_DICE = ['1D6', '1D4+2', '1D3+1D4', '2D6+2', '1D6-1', '1D100', '10D6', '1D10+1D4+2', '3D6-2', '100D10000'];
const REFUSED_DICE = ['1D4+2 hit points', '1D6+DB', '½DB', '1D3+½DB', '2D6 armor', '1d6', '1D6+1d4', '2', '0', '1D6-1D4', '1D6 + 2', '', '101D6'];

test('every dice string the validator accepts is rolled by rollExpression and by CombatSession.rollDamageExpression', async () => {
    await accepted(graph => ACCEPTED_DICE.forEach((dice, index) => stated(graph, 'rule', `dice-${index}`, {damage: {dice}})));
    const rng = new api.PythonRandom(7), roll = api.CombatSession.prototype.rollDamageExpression;
    for (const dice of ACCEPTED_DICE) {
        const rolled = api.rollExpression(dice, rng);
        assert.equal(typeof rolled.total, 'number', dice);
        const [total, faces] = roll.call({rng}, dice);
        assert.ok(Number.isInteger(total) && faces.length > 0, dice);
    }
});
test('shape_dice: damage bonus, units, words, lower case, bare constants and subtracted dice are refused', async () => {
    const refusals = await register(graph => REFUSED_DICE.forEach((dice, index) => stated(graph, 'rule', `dice-${index}`, {damage: {dice}})));
    for (const [index, dice] of REFUSED_DICE.entries())
        assert.ok(refusals.some(refusal => refusal.node === `rule-dice-${index}` && refusal.rule === 'shape_dice'), `${JSON.stringify(dice)} was not refused with shape_dice`);
});
test('a Sanity half is "0" or a string both grammars accept; a pair, a minus or a number is refused', async () => {
    await accepted(graph => ['0', '1', '1D4', '1D6+1', '2D10'].forEach((half, index) => stated(graph, 'rule', `san-${index}`, {sanity_loss: {success: '0', failure: half}})));
    const refused = ['1D4-1', '0/1D4', '1d4', 1, 'SAN 1/1D4 to witness'];
    const refusals = await register(graph => refused.forEach((half, index) => stated(graph, 'rule', `san-${index}`, {sanity_loss: {success: '0', failure: half}})));
    for (const [index, half] of refused.entries())
        assert.ok(refusals.some(refusal => refusal.node === `rule-san-${index}` && refusal.rule === 'shape_dice'), `${JSON.stringify(half)} was not refused`);
});

// ----- the Mod manifest check keeps the shared form, with the Mod owner's sets -----

async function installVariant(change) {
    const dir = await mkdtemp(join(scratch, 'package-'));
    await cp(join(root, 'mods', 'natural-npc'), dir, {recursive: true});
    const manifest = JSON.parse(await readFile(join(dir, 'mod.json'), 'utf8'));
    Object.assign(manifest, {id: 'impression-fixture', version: '0.0.1', default_enabled: false});
    for (const declared of manifest.contributes.checks) declared.name = 'impression-fixture:first-impression';
    manifest.contributes.audit_on_decisions = ['impression-fixture:first-impression'];
    change(manifest.contributes.checks[0]);
    await writeFile(join(dir, 'mod.json'), JSON.stringify(manifest));
    const {runtime, call} = await kernelOver(content);
    try { return await call('mods.install', {path: dir}); }
    catch (error) { return {refused: error.details?.refusals?.map(refusal => refusal.rule) ?? [], code: error.code}; }
    finally { await runtime.close(); }
}

test('natural-npc 1.4.2 loads at its version and digest, and a package declaring its exact check installs', async () => {
    const {runtime, call, home} = await kernelOver(content);
    try {
        const shipped = JSON.parse(await readFile(join(root, 'mods/natural-npc/mod.json'), 'utf8'));
        const listed = (await call('mods.list')).mods.find(mod => mod.id === 'natural-npc');
        assert.equal(listed.version, shipped.version);
        assert.equal(listed.compatible, true);
        await call('campaign.create', {id: 'c1', module: 'the-haunting', play_language: 'en'});
        const lock = JSON.parse(await readFile(join(home, '.coc/campaigns/c1/campaign.json'), 'utf8')).mods_pending?.['natural-npc']
            ?? JSON.parse(await readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8')).mods.active['natural-npc'];
        assert.equal(lock.version, shipped.version);
        // Mod bytes are frozen per version: 1.4.2's digest, recorded on the parent commit 7709b5ded.
        if (shipped.version === '1.4.2') assert.equal(lock.digest, '623c126fb89a72c03275dad4bcc900c9db7376596b0b6d7a9bb258e3ce2e25b2');
    } finally { await runtime.close(); }
    const installed = await installVariant(() => {});
    assert.equal(installed.id, 'impression-fixture');
});
test('check_scope (Mod): the rule owner\'s opposed scope is not a Mod\'s', async () => {
    assert.deepEqual(await installVariant(declared => { declared.scope = 'opposed'; }), {refused: ['check_scope'], code: 'invalid_params'});
});
test('check_results (Mod): a Mod still defines all six levels, where a rule may state a subset', async () => {
    assert.deepEqual(await installVariant(declared => { delete declared.results.fumble; }), {refused: ['check_results'], code: 'invalid_params'});
});
