/**
 * Contract §134: a stated obligation's shape, and the one validator that refuses a malformed one.
 *
 * Every case travels a real entry. A starter case writes the shipped haunting graph -- with exactly one
 * change -- into a content root and calls `module.register`, which is what `campaign.create` does; a Mod
 * case installs a package derived from `natural-npc` through `mods.install`. Nothing here calls the
 * validator directly or normalises its input first, so a case that passes proves the kernel itself
 * refused (or accepted) the bytes an author would ship.
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
const scratch = await mkdtemp(join(tmpdir(), 'obligation-shape-'));
// The bundle sits inside the repository so its bare imports resolve against the repository's packages.
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'obligation-shape-'));
after(async () => { await rm(scratch, {recursive: true, force: true}); await rm(bundleDir, {recursive: true, force: true}); });
await build({stdin: {contents:
    `export {createKernelContext} from './kernel-ts/context.ts';` +
    `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';` +
    `export {createKernelRuntime} from './kernel-ts/registry.ts';`,
    resolveDir: root, sourcefile: 'obligation-api.ts'},
    outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);

const SHIPPED = JSON.parse(await readFile(join(content, 'starters/the-haunting/module-graph.json'), 'utf8'));
const ACCESS = 'requirement-globe-clippings-access', ARCHIVIST = 'requirement-globe-archivist';

async function kernelOver(contentRoot) {
    const home = await mkdtemp(join(scratch, 'home-'));
    const context = await api.createKernelContext({workspace: home, content: contentRoot, seed: 'obligation',
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
const obligation = (graph, id = ACCESS) => node(graph, id).properties.obligation;
const check = graph => obligation(graph).demand.find(step => step.kind === 'check');

/** Registers the mutated starter and returns the rules it was refused under, or null when it registered. */
async function register(mutate) {
    const {runtime, call} = await kernelOver(await contentWith(mutate));
    try {
        await call('module.register', {module_id: 'the-haunting'});
        return null;
    } catch (error) {
        assert.equal(error.code, 'invalid_params', error.message);
        assert.equal(error.details?.reason, 'obligation_invalid', error.message);
        return error.details.refusals.map(refusal => refusal.rule);
    } finally { await runtime.close(); }
}
async function refusedUnder(rule, mutate) {
    const rules = await register(mutate);
    assert.ok(rules, `expected a ${rule} refusal, but the starter registered`);
    assert.ok(rules.includes(rule), `expected ${rule}, got ${rules.join(', ')}`);
}

// ----- the shipped starter and the accepted shapes -----

test('the shipped haunting registers with its two stated obligations, and so does its unchanged copy', async () => {
    const shipped = await kernelOver(content);
    try {
        const result = await shipped.call('module.register', {module_id: 'the-haunting'});
        assert.equal(result.status, 'installed');
    } finally { await shipped.runtime.close(); }
    assert.equal(await register(() => {}), null);
    const access = obligation(SHIPPED), archivist = obligation(SHIPPED, ARCHIVIST);
    assert.equal(access.reaction, 'preordained');
    assert.deepEqual(access.trigger.guards.clues, ['clue-globe-unpublished-story', 'clue-macario-tragedy']);
    assert.deepEqual(archivist.trigger, {kind: 'after', obligation: ACCESS});
});

test('the migration leaves no second copy of the gate in the morgue record', () => {
    const scene = node(SHIPPED, 'scene-newspaper-morgue').properties.runtime_projection.record;
    assert.equal(Object.hasOwn(scene, 'npc_presence_requirements'), false);
    for (const affordance of scene.affordances) {
        assert.equal(Object.hasOwn(affordance, 'roll_gate'), false, affordance.id);
        assert.equal(Object.hasOwn(affordance, 'requires_completed_route_ids'), false, affordance.id);
    }
    assert.deepEqual(scene.affordances.map(affordance => affordance.id), ['persuade-arty', 'search-clippings', 'befriend-ruth']);
});

test('a minimal obligation -- one guarded person, one meeting, one flag -- is accepted', async () => {
    assert.equal(await register(graph => {
        graph.nodes.push({node_id: 'requirement-minimal', node_kind: 'requirement', name: 'Minimal', visibility: 'keeper-only',
            aliases: [], summary: 'Minimal.', evidence_span_ids: ['span-page-447-anchor-1'],
            properties: {obligation: {scene: 'scene-newspaper-morgue', trigger: {kind: 'attempt', guards: {people: ['npc-arty-wilmot']}},
                demand: [{kind: 'meet', npc: 'npc-arty-wilmot'}], settles: {kind: 'flag_set', flag_id: 'minimal-met'}}},
            source_refs: [{source_id: 'pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting', pdf_index: 447}]});
        graph.claims.push({claim_id: 'claim-has-requirement-minimal', subject_id: 'scene-newspaper-morgue', predicate: 'has-requirement',
            object: {node_id: 'requirement-minimal'}, truth_status: 'authored-fact', visibility: 'keeper-only', evidence_span_ids: ['span-page-447-anchor-1'],
            asserted_by_ids: [], known_by_ids: [], validity: null, confidence: 1.0, reason: 'fixture'});
    }), null);
});

test('a check whose difficulty the page does not state is recorded as unstated and accepted', async () => {
    assert.equal(await register(graph => { const step = check(graph); delete step.difficulty; step.difficulty_unstated = true; }), null);
});

test('a check whose skills the page does not state is recorded as unstated and accepted', async () => {
    assert.equal(await register(graph => { const step = check(graph); delete step.values; delete step.selection; step.approaches_unstated = true; }), null);
});

test('a skill resolves by normalised name against the ruleset, and a characteristic with a stated minimum is accepted', async () => {
    assert.equal(await register(graph => {
        check(graph).values = [{path: 'skills.fast_talk', label: 'Fast Talk'}, {path: 'skills.Credit Rating', label: 'Credit Rating', minimum: 75},
            {path: 'characteristics.APP', label: 'Appearance'}];
    }), null);
});

// ----- the refusals of §134.3, one rule each -----

test('obligation_unsourced: an obligation without source_refs', () => refusedUnder('obligation_unsourced', graph => { delete node(graph, ACCESS).source_refs; }));
test('obligation_unsourced: a starter obligation without evidence spans', () => refusedUnder('obligation_unsourced', graph => { node(graph, ACCESS).evidence_span_ids = []; }));
test('obligation_unknown_key: book prose parked in an untyped key', () => refusedUnder('obligation_unknown_key', graph => {
    obligation(graph).skills = 'Charm (friendliness), Intimidate (aggression), Persuade (rational arguments), Fast Talk (con)';
}));
test('obligation_unresolved: a gatekeeper who is not a person of the module', () => refusedUnder('obligation_unresolved', graph => { obligation(graph).who = 'npc-nobody'; }));
test('obligation_unresolved: a guard that is not a clue', () => refusedUnder('obligation_unresolved', graph => { obligation(graph).trigger.guards.clues = ['npc-arty-wilmot']; }));
test('obligation_unresolved: after names no obligation', () => refusedUnder('obligation_unresolved', graph => { obligation(graph, ARCHIVIST).trigger.obligation = 'requirement-nothing'; }));
test('obligation_unlinked: no has-requirement claim from its scene', () => refusedUnder('obligation_unlinked', graph => {
    graph.claims = graph.claims.filter(claim => claim.claim_id !== 'claim-has-requirement-globe-clippings-access');
}));
test('obligation_not_seated: the gatekeeper is not in the scene', () => refusedUnder('obligation_not_seated', graph => { obligation(graph).who = 'npc-dooley'; }));
test('obligation_not_seated: a meeting with a person the book does not put there', () => refusedUnder('obligation_not_seated', graph => { obligation(graph, ARCHIVIST).demand[0].npc = 'npc-dooley'; }));
test('obligation_empty_demand: an obligation that demands nothing', () => refusedUnder('obligation_empty_demand', graph => { obligation(graph, ARCHIVIST).demand = []; }));
test('obligation_empty_demand: a step kind outside meet, check and cost', () => refusedUnder('obligation_empty_demand', graph => { obligation(graph, ARCHIVIST).demand = [{kind: 'bribe'}]; }));
test('obligation_empty_guards: an attempt that guards nothing', () => refusedUnder('obligation_empty_guards', graph => { obligation(graph).trigger.guards = {clues: []}; }));
test('obligation_after_cycle: two obligations each after the other', () => refusedUnder('obligation_after_cycle', graph => {
    obligation(graph).trigger = {kind: 'after', obligation: ARCHIVIST};
}));
test('obligation_reaction: a reaction other than preordained', () => refusedUnder('obligation_reaction', graph => { obligation(graph).reaction = 'hostile'; }));
test('obligation_settles: a flag id that is not the stored semantic form', () => refusedUnder('obligation_settles', graph => {
    obligation(graph).settles.flag_id = 'newspaper-morgue.clippings-access';
}));
test('obligation_flag_reused: two obligations settling one flag', () => refusedUnder('obligation_flag_reused', graph => {
    obligation(graph, ARCHIVIST).settles.flag_id = obligation(graph).settles.flag_id;
}));
test('obligation_repeats_clue_gate: a single-skill check equal to a guarded clue\'s own gate', () => refusedUnder('obligation_repeats_clue_gate', graph => {
    Object.assign(node(graph, 'clue-globe-unpublished-story').properties, {skill: 'Persuade', difficulty: 'regular'});
    check(graph).values = [{path: 'skills.Persuade', label: 'Persuade'}];
}));
test('check_trigger: an obligation trigger outside attempt and after', () => refusedUnder('check_trigger', graph => { obligation(graph).trigger.kind = 'arrival'; }));
test('check_selection: a selection outside maximum and approach', () => refusedUnder('check_selection', graph => { check(graph).selection = 'best'; }));
test('check_difficulty: a prose difficulty', () => refusedUnder('check_difficulty', graph => { check(graph).difficulty = 'Regular; Arty is not professionally skilled'; }));
test('check_difficulty: no difficulty and no difficulty_unstated', () => refusedUnder('check_difficulty', graph => { delete check(graph).difficulty; }));
test('check_values: the book\'s skill prose in the values slot', () => refusedUnder('check_values', graph => {
    check(graph).values = 'Charm (friendliness), Intimidate (aggression), Persuade (rational arguments), Fast Talk (con)';
}));
test('check_values: a path outside characteristics and skills', () => refusedUnder('check_values', graph => { check(graph).values[0].path = 'mood.Persuade'; }));
test('check_unknown_skill: a skill the ruleset does not have', () => refusedUnder('check_unknown_skill', graph => { check(graph).values[0].path = 'skills.Sweet Talk'; }));
test('check_results: five result levels', () => refusedUnder('check_results', graph => { delete check(graph).results.fumble; }));
test('check_results: a level that does not say whether it settles', () => refusedUnder('check_results', graph => { check(graph).results.regular = {reaction: 'open'}; }));
test('check_scope: an actor-target check with no target', () => refusedUnder('check_scope', graph => { delete check(graph).target; }));

// ----- the Mod manifest check shares the check declaration form -----

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

test('natural-npc loads as shipped, and a package declaring its exact check installs', async () => {
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
        assert.match(lock.digest, /^[0-9a-f]{64}$/);
    } finally { await runtime.close(); }
    const installed = await installVariant(() => {});
    assert.equal(installed.id, 'impression-fixture');
});
test('check_trigger (Mod): a trigger outside contact', async () => {
    assert.deepEqual(await installVariant(declared => { declared.trigger = 'arrival'; }), {refused: ['check_trigger'], code: 'invalid_params'});
});
test('check_trigger (Mod): no trigger at all', async () => {
    assert.deepEqual(await installVariant(declared => { delete declared.trigger; }), {refused: ['check_trigger'], code: 'invalid_params'});
});
test('check_selection (Mod): approach is refused while the Mod resolver takes the maximum', async () => {
    assert.deepEqual(await installVariant(declared => { declared.selection = 'approach'; }), {refused: ['check_selection'], code: 'invalid_params'});
});
test('check_values (Mod): a minimum the Mod resolver would silently ignore', async () => {
    assert.deepEqual(await installVariant(declared => { declared.values[1].minimum = 75; }), {refused: ['check_values'], code: 'invalid_params'});
});
test('check_results (Mod): a Mod keeps its own result mappings but must define all six', async () => {
    assert.deepEqual(await installVariant(declared => { delete declared.results.fumble; }), {refused: ['check_results'], code: 'invalid_params'});
});
