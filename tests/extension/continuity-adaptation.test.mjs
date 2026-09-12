import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const evidence = join(root, '.coc/playtests/continuity-contracts');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts'; export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {ModuleStore} from './kernel-ts/modules/store.ts'; export {loadModule,loadCampaignModule} from './kernel-ts/read/campaign.ts'; export {report as mergeReport} from './kernel-ts/worldline/confluence-plan.ts'; export {continuityView} from './kernel-ts/read/continuity.ts'; export {normalizeChanges,adaptedGraph} from './kernel-ts/adaptation/graph.ts';`, resolveDir: root, sourcefile: 'test-api.ts'},
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = []; after(async () => {for (const close of closers) await close();});
const raw = JSON.parse(await readFile(join(root, 'content/starters/the-haunting/module-graph.json'), 'utf8'));
const graph = new api.ModuleGraph('the-haunting', raw, 'test', {});

async function table() {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'continuity', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    await call('table.narrate', {call_id: 't0-c1', text: 'The investigator hears the commission.'});
    await call('table.player_input', {text: 'I want to understand how these events connect.'});
    const world = () => readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8').then(JSON.parse);
    return {home, context, runtime, call, world};
}
async function prepare(t, name = 'New witness route', changes) {
    const starting = graph.startScene(), clue = graph.nodes.get(graph.sceneClueIds(starting)[0]);
    const planned = changes ?? [
        {kind: 'add_scene', name: 'Harbor guesthouse', description: 'A guesthouse where the same case can be discussed.', based_on: graph.handle(starting), sources: [starting.name], reason: 'The investigator chose to visit the harbor.'},
        {kind: 'route', from: graph.handle(starting), to: 'Harbor guesthouse', sources: [starting.name], reason: 'Ordinary travel to the harbor.'},
        {kind: 'clue_at', clue: graph.handle(clue), scene: 'Harbor guesthouse', sources: [clue.name], reason: 'The witness brings the existing evidence.'}
    ];
    const p = await t.call('adaptation.prepare', {name, request: 'Carry existing evidence to a guesthouse.', anchors: [starting.name]});
    const index = JSON.parse(await readFile(join(p.task.cwd, 'request.json'), 'utf8'));
    assert.equal(index.schema, 2);
    assert.deepEqual(index.creator_contract.required_change_fields, ['kind', 'reason', 'sources']);
    assert.ok(!Object.hasOwn(index, 'original'));
    const history = JSON.parse(await readFile(join(p.task.cwd, index.files.history), 'utf8'));
    assert.ok(history.some(record => record.rendered_text === 'The investigator hears the commission.'));
    assert.ok(history.every(record => !Object.hasOwn(record, 'capsule')));
    await writeFile(join(p.task.cwd, 'result.json'), JSON.stringify({explanation: 'Contract fixture only.', changes: planned}));
    const draft = await t.call('adaptation.draft', {name, key: p.task.key, attempt: p.task.attempt});
    return {name, key: p.task.key, attempt: p.task.attempt, task: draft.task, planned};
}
async function review(t, p, override = {}) {
    await writeFile(join(p.task.cwd, 'result.json'), JSON.stringify({verdict: 'supported', summary: 'Contract fixture verdict, not model acceptance.', issues: [],
        checked: p.planned.map((_, index) => ({index, verdict: 'supported', reason: 'Known contract fixture.'})), ...override}));
    return t.call('adaptation.review', {name: p.name, key: p.key, attempt: p.attempt});
}

test('all acquired support relationships remain available; neither disclosure nor comprehension is inferred', () => {
    const conclusion = graph.kind('conclusion').find(c => graph.incoming.get(c.node_id)?.some(r => r.relation_kind === 'supports'));
    const supports = graph.incoming.get(conclusion.node_id).filter(r => r.relation_kind === 'supports').map(r => graph.handle(graph.nodes.get(r.from_node_id)));
    const world = {active_scene: graph.handle(graph.startScene()), discovered_clues: supports, npc_presence: {}, stalled_turns: 0};
    const before = JSON.stringify(world);
    const out = api.continuityView(graph, world, [{turn: 18, rendered_text: 'Already delivered facts.', receipts: [{kind: 'clue', clue: supports[0]}]}], [], {anchors: [graph.handle(conclusion)]});
    const connection = out.connections.find(c => c.name === graph.handle(conclusion));
    assert.ok(connection); assert.ok(connection.evidence.every(e => e.acquired));
    assert.equal(connection.disclosure, 'keeper_only_synthesis');
    assert.ok(connection.evidence.some(e => e.deliveries.some(d => d.turn === 18)));
    assert.equal(JSON.stringify(world), before);
});

test('a small capsule keeps the most recently acquired relationship ahead of an older alphabetical match', () => {
    const nodes = [['scene', 'room', 'Room'], ['clue', 'old', 'Old clue'], ['clue', 'new', 'New clue'],
        ['conclusion', 'a-old', 'Earlier relationship'], ['conclusion', 'z-new', 'Current relationship']]
        .map(([node_kind, slug, name]) => ({node_id: `${node_kind}-${slug}`, node_kind, name, summary: name, properties: {}}));
    const source = new api.ModuleGraph('fixture', {nodes, relations: [
        {relation_kind: 'discoverable-at', from_node_id: 'clue-new', to_node_id: 'scene-room'},
        {relation_kind: 'supports', from_node_id: 'clue-old', to_node_id: 'conclusion-a-old'},
        {relation_kind: 'supports', from_node_id: 'clue-new', to_node_id: 'conclusion-z-new'}], claims: []}, 'fixture', {});
    const result = api.continuityView(source, {active_scene: 'room', discovered_clues: ['old', 'new'], npc_presence: {}}, [], [], {limit: 1, compact: true, budget: 1400});
    assert.equal(result.connections[0].name, 'z-new');
    assert.equal(result.connections[0].evidence[0].acquired, true);
    assert.equal(result.truncated, true);
});

test('continuity truncates memory hypotheses as well as connections to keep its byte budget', () => {
    const world = {active_scene: graph.handle(graph.startScene()), discovered_clues: [], npc_presence: {}};
    const hypotheses = Array.from({length: 6}, () => ({kind: 'player_preference', subject: 'player', statement: '\u{1f9ed}'.repeat(400),
        state: 'active', confidence: 1, turn: 1}));
    const result = api.continuityView(graph, world, [], hypotheses, {budget: 1800});
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 1800);
    assert.equal(result.truncated, true);
});

test('kind-qualified names disambiguate source roles and binding errors identify their field', () => {
    const world = {active_scene: graph.handle(graph.startScene()), discovered_clues: [], npc_presence: {}};
    assert.ok(api.continuityView(graph, world, [], [], {anchors: ['scene: commission-briefing']}).anchors.length);
    const changes = [{kind: 'add_scene', name: 'Source-bound inn', description: 'An ordinary campaign lodging.',
        based_on: 'scene: commission-briefing', sources: ['npc: steven-knott'], reason: 'A chosen departure from the current meeting.'}];
    assert.equal(api.normalizeChanges(graph, [], world, changes, 'fixture')[0].based_on, graph.startScene().node_id);
    changes[0].sources = ['Source-bound inn'];
    assert.throws(() => api.normalizeChanges(graph, [], world, changes, 'fixture'), e => e.details?.field === 'sources' && e.message.includes('Change 0'));
});

test('base continuity lookup works through the kernel; preparation and review change no world; accepted view survives cold loading', async () => {
    const t = await table(), before = JSON.stringify(await t.world());
    assert.ok(Array.isArray((await t.call('table.lookup', {kind: 'continuity'})).connections));
    const p = await prepare(t);
    assert.equal(JSON.stringify(await t.world()), before);
    assert.equal((await review(t, p)).status, 'ready');
    assert.equal(JSON.stringify(await t.world()), before);
    const params = {call_id: 't1-c1', effects: [{kind: 'adaptation', name: p.name}]};
    const accepted = await t.call('table.apply', params);
    assert.equal(accepted.world.active_scene, JSON.parse(before).active_scene);
    assert.equal((await t.call('adaptation.status', {name: p.name})).status, 'accepted');
    assert.equal((await t.call('table.apply', params)).replayed, true);
    await t.call('table.apply', {call_id: 't1-c2', effects: [{kind: 'move', to: 'Harbor guesthouse'}]});
    const clue = graph.handle(graph.nodes.get(graph.sceneClueIds(graph.startScene())[0]));
    await t.call('table.apply', {call_id: 't1-c3', effects: [{kind: 'clue', clue}]});
    assert.ok((await t.world()).discovered_clues.includes(clue));
    const cold = api.createKernelRuntime(t.context); closers.push(() => cold.close());
    const view = await cold.handlers['table.look']({campaign: 'c1', focus: 'scene'});
    assert.ok(JSON.stringify(view).includes('Harbor guesthouse'));
    assert.ok(JSON.stringify(view).includes('campaign_adaptation'));
    const original = await t.call('table.lookup', {kind: 'module', query: 'Harbor guesthouse', canonical_source: true});
    assert.deepEqual(original.entities, []);
    assert.equal(original.preparation.kind, 'adaptation');
    assert.equal(original.preparation.action, 'prepare');
    await t.call('table.narrate', {call_id: 't1-c4', text: 'The investigator studies the existing evidence at the Harbor guesthouse.'});
    assert.equal((await t.call('journal.job', {turn: 1})).scene.name, 'Harbor guesthouse');
});

test('within-turn state changes invalidate a reviewed draft and failed acceptance writes nothing', async () => {
    const t = await table(), p = await prepare(t); await review(t, p);
    await t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'time', minutes: 1, why: 'An already chosen action took time.'}]});
    const before = JSON.stringify(await t.world());
    await assert.rejects(t.call('table.apply', {call_id: 't1-c2', effects: [{kind: 'adaptation', name: p.name}]}), e => e.details?.reason === 'adaptation_stale');
    assert.equal(JSON.stringify(await t.world()), before);
});

test('uncertain, incomplete and tampered reviews never authorize an adaptation; cancellation is durable', async () => {
    const t = await table(), p = await prepare(t), before = JSON.stringify(await t.world());
    await assert.rejects(review(t, p, {checked: []}));
    await assert.rejects(t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'adaptation', name: p.name}]}));
    await review(t, p);
    await writeFile(join(p.task.cwd, 'result.json'), JSON.stringify({verdict: 'supported', summary: 'Changed after review'}));
    await assert.rejects(t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'adaptation', name: p.name}]}));
    await t.call('adaptation.cancel', {name: p.name});
    assert.equal((await t.call('adaptation.status', {name: p.name})).status, 'cancelled');
    assert.equal(JSON.stringify(await t.world()), before);
});

test('closed operations refuse numeric rewrites, already encountered scenes, duplicate identities and unsafe artifact names', () => {
    const scene = graph.handle(graph.startScene()), world = {active_scene: scene, visited_scenes: [scene]};
    const common = {sources: [scene], reason: 'Test'};
    for (const change of [
        {...common, kind: 'add_npc', name: 'New person', description: 'A witness', agenda: 'Help', skills: {Listen: 99}},
        {...common, kind: 'scene', scene, description: 'A rewritten opening'},
        {...common, kind: 'add_scene', name: '../../outside', description: 'Unsafe', based_on: scene},
        {...common, kind: 'add_npc', name: '__proto__', description: 'Unsafe state key', agenda: 'None'},
        {...common, kind: 'add_scene', name: graph.startScene().name, description: 'Duplicate', based_on: scene}
    ]) assert.throws(() => api.normalizeChanges(graph, [], world, [change], 'fixture'));
});

test('supporting NPC knowledge and new handout renditions are available without automatic presence or discovery', async () => {
    const t = await table(), start = graph.startScene(),
        clue = graph.kind('clue').find(node => graph.out.get(node.node_id)?.some(edge => edge.relation_kind === 'supports')),
        handout = graph.kind('handout')[0];
    const changes = [
        {kind: 'add_npc', name: 'Harbor clerk', description: 'A supporting witness.', agenda: 'Explain the records.', sources: [start.name], reason: 'A witness to the existing case.'},
        {kind: 'npc_knows', npc: 'Harbor clerk', clue: graph.handle(clue), sources: [clue.name], reason: 'The witness handled this evidence.'},
        {kind: 'handout', name: 'Harbor copy', text: 'An acquired-evidence rendition.', based_on: handout.name, sources: [handout.name], reason: 'A separate campaign copy.'}
    ];
    const before = await t.world(), p = await prepare(t, 'Witness and copy', changes), ready = await review(t, p);
    assert.equal(ready.changes[0].agenda, 'Explain the records.');
    await t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'adaptation', name: p.name}]});
    assert.equal((await t.world()).npc_presence['Harbor clerk'], undefined);
    assert.deepEqual((await t.world()).discovered_clues, before.discovered_clues);
    await t.call('table.apply', {call_id: 't1-c2', effects: [{kind: 'npc', name: 'Harbor clerk', to: graph.handle(start)}]});
    const npc = await t.call('table.look', {focus: 'npc', name: 'Harbor clerk'});
    assert.ok(JSON.stringify(npc).includes(graph.handle(clue)));
    assert.ok(JSON.stringify(npc).includes('campaign_adaptation'));
    const continuity = await t.call('table.lookup', {kind: 'continuity', anchors: [graph.handle(clue)]});
    const knowledge = continuity.connections.flatMap(c => c.evidence).flatMap(e => e.people).find(person => person.name === 'Harbor clerk');
    assert.equal(knowledge.origin.kind, 'campaign_adaptation');
    assert.equal(knowledge.origin.reason, 'The witness handled this evidence.');
    const shown = await t.call('table.apply', {call_id: 't1-c3', effects: [{kind: 'handout', name: 'Harbor copy'}]});
    assert.equal(shown.attachment.available, true);
    assert.match(await readFile(shown.attachment.path, 'utf8'), /An acquired-evidence rendition/);
    await t.call('table.narrate', {call_id: 't1-c4', text: 'Harbor clerk offers the copy.'});
    assert.ok((await t.call('journal.job', {turn: 1})).recordable.includes('Harbor clerk'));
    const audit = await t.call('mods.job', {role: 'audit', input: {text: 'Harbor clerk remains here.'}});
    const originalGraph = JSON.parse(await readFile(join(audit.cwd, 'original.json'), 'utf8')).graph;
    const effectiveGraph = JSON.parse(await readFile(join(audit.cwd, 'effective.json'), 'utf8')).graph;
    assert.ok(!originalGraph.nodes.some(node => node.name === 'Harbor clerk'));
    assert.ok(effectiveGraph.nodes.some(node => node.name === 'Harbor clerk' && node.campaign_origin));
});

test('accepted source stays pinned across shared publication until a reviewed rebase; other campaigns remain unadapted', async () => {
    const t = await table(), p = await prepare(t); await review(t, p);
    await t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'adaptation', name: p.name}]});
    const originalSource = (await t.world()).adaptation.source;
    await t.call('table.narrate', {call_id: 't1-c2', text: 'The preparation is retained.'});
    await t.call('table.player_input', {text: 'We review the newly available records.'});
    await t.call('campaign.create', {id: 'c2', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await t.call('table.open', {campaign: 'c2'});
    assert.equal((await t.call('table.lookup', {campaign: 'c2', kind: 'module', query: 'Harbor guesthouse'})).entities.length, 0);
    const store = new api.ModuleStore(t.context), meta = await store.module('the-haunting');
    const next = structuredClone(raw); next.nodes.push({node_id: 'location-safe-pier', node_kind: 'location', name: 'Safe Pier', summary: 'New source material.', properties: {}});
    await store.writeModule(await store.writeGraph(meta, next));
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Safe Pier'})).entities.length, 0);
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Safe Pier', canonical_source: true})).entities.length, 1);
    const r = await t.call('adaptation.prepare', {name: 'Source refresh', request: 'Review the new source generation.', anchors: [graph.startScene().name], rebase: true});
    await writeFile(join(r.task.cwd, 'result.json'), JSON.stringify({changes: [], explanation: 'Rebase fixture.'}));
    const d = await t.call('adaptation.draft', {name: r.name, key: r.task.key, attempt: r.task.attempt});
    const count = (await t.world()).adaptation.records.flatMap(x => x.changes).length;
    await review(t, {name: r.name, key: r.task.key, attempt: r.task.attempt, task: d.task, planned: Array.from({length: count}, () => null)});
    await t.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'adaptation', name: r.name}]});
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Safe Pier'})).entities.length, 1);
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Harbor guesthouse'})).entities.length, 1);
    assert.ok(await readFile(join(t.home, '.coc/adaptation-sources', `${originalSource}.json`)));
});

test('a retry has a new attempt owner; old results cannot finish or fail the replacement', async () => {
    const t = await table(), params = {name: 'Retry ownership', request: 'Prepare a witness route.', anchors: [graph.startScene().name]};
    const first = await t.call('adaptation.prepare', params);
    const second = await t.call('adaptation.prepare', {...params, retry: true});
    assert.notEqual(first.task.attempt, second.task.attempt);
    await assert.rejects(t.call('adaptation.draft', {name: params.name, key: first.task.key, attempt: first.task.attempt}));
    await t.call('adaptation.fail', {name: params.name, key: first.task.key, attempt: first.task.attempt, error: 'Obsolete failure'});
    assert.equal((await t.call('adaptation.status', {name: params.name})).status, 'pending');
    await assert.rejects(t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'adaptation', name: params.name}, {kind: 'time', minutes: 1}]}));
});

test('an unknown destination points to preparation, and a label-only rename cannot claim an arrival', async () => {
    const t = await table();
    await assert.rejects(t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'Atlantic Inn'}]}), e => e.details?.reason === 'destination_missing' && e.fix.includes('adaptation'));
    const before = await t.world();
    const renamed = await t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: before.active_scene, label: 'Display label'}]});
    assert.equal((await t.world()).active_scene, before.active_scene);
    assert.match(renamed.location_note, /No arrival at a different place/);
});

test('host-only proposal methods reject unbound campaign paths before reading task files', async () => {
    const t = await table();
    for (const method of ['adaptation.prepare', 'adaptation.status', 'adaptation.cancel', 'adaptation.fail'])
        await assert.rejects(t.call(method, {campaign: '../outside', name: 'Anything'}), e => e.code === 'invalid_params');
});

test('a deliberate draft decline preserves its explanation and changes no world', async () => {
    const t = await table(), before = JSON.stringify(await t.world());
    await assert.rejects(prepare(t, 'Unsupported request', []), e => e.details?.reason === 'adaptation_declined' && e.message.includes('Contract fixture only'));
    assert.equal(JSON.stringify(await t.world()), before);
});

test('divergent worldline adaptations refuse before a merged world is produced; identical revisions can merge', () => {
    const state = {world: {active_scene: graph.handle(graph.startScene()), adaptation: {revision: 'one', records: [{name: 'Harbor'}]}}, party: {}, candidates: [], spent: new Set(), engines: {}};
    const first = {...state, line: 'main'}, second = {...state, line: 'side', world: structuredClone(state.world)};
    assert.ok(api.mergeReport(graph, [first, second], null).world.adaptation);
    second.world.adaptation.revision = 'two';
    const before = JSON.stringify([first.world, second.world]);
    assert.throws(() => api.mergeReport(graph, [first, second], null), e => e.details?.reason === 'adaptation_merge_conflict');
    assert.equal(JSON.stringify([first.world, second.world]), before);
});

test('real worldline fork and switch load their own adaptations, and a divergent merge refuses without writes', async () => {
    const t = await table(), p = await prepare(t); await review(t, p);
    await t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'adaptation', name: p.name}]});
    await t.call('table.narrate', {call_id: 't1-c2', text: 'Contract turn one closes.'});
    const turn = async text => {await t.call('table.player_input', {text}); return JSON.parse(await readFile(join(t.home, '.coc/campaigns/c1/turn.json'), 'utf8')).turn;};
    let n = await turn('Explore an alternative.');
    await t.call('table.apply', {call_id: `t${n}-c1`, effects: [{kind: 'fork', name: 'side', mode: 'if'}]});
    await t.call('table.narrate', {call_id: `t${n}-c2`, text: 'Contract fork closes.'});
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Harbor guesthouse'})).entities.length, 1);
    n = await turn('Prepare another possible witness.');
    const second = await prepare(t, 'Side witness', [{kind: 'add_npc', name: 'Dockhand', description: 'A supporting witness.', agenda: 'Explain records.', sources: [graph.startScene().name], reason: 'An alternative supporting role.'}]);
    await review(t, second);
    await t.call('table.apply', {call_id: `t${n}-c1`, effects: [{kind: 'adaptation', name: second.name}]});
    await t.call('table.narrate', {call_id: `t${n}-c2`, text: 'Contract side turn closes.'});
    n = await turn('Return to the main line.');
    await t.call('table.apply', {call_id: `t${n}-c1`, effects: [{kind: 'switch', line: 'main'}]});
    await t.call('table.narrate', {call_id: `t${n}-c2`, text: 'Contract switch closes.'});
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Dockhand'})).entities.length, 0);
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Harbor guesthouse'})).entities.length, 1);
    n = await turn('Compare both lines.'); const before = JSON.stringify(await t.world());
    await assert.rejects(t.call('table.apply', {call_id: `t${n}-c1`, effects: [{kind: 'merge', name: 'joined', lines: ['main', 'side']}]}), e => e.details?.reason === 'adaptation_merge_conflict');
    assert.equal(JSON.stringify(await t.world()), before);
});
