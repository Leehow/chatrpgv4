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
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts'; export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {ModuleStore} from './kernel-ts/modules/store.ts'; export {ensureCampaignModule,moduleContext} from './kernel-ts/modules/campaign-scope.ts'; export {loadModule,loadCampaignModule} from './kernel-ts/read/campaign.ts'; export {report as mergeReport} from './kernel-ts/worldline/confluence-plan.ts'; export {continuityView} from './kernel-ts/read/continuity.ts'; export {storyAssessmentContext,storyReentry} from './kernel-ts/read/story.ts'; export {threadSection} from './kernel-ts/read/thread.ts'; export {normalizeChanges,adaptedGraph} from './kernel-ts/adaptation/graph.ts'; export {auditSourceEvidence} from './kernel-ts/mods/audit-source.ts';`, resolveDir: root, sourcefile: 'test-api.ts'},
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = []; after(async () => {for (const close of closers) await close();});
const raw = JSON.parse(await readFile(join(root, 'content/starters/the-haunting/module-graph.json'), 'utf8'));
const graph = new api.ModuleGraph('the-haunting', raw, 'test', {});

async function table(input = 'I want to understand how these events connect.') {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'continuity', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    await call('table.narrate', {call_id: 't0-c1', text: 'The investigator hears the commission.'});
    await call('table.player_input', {text: input});
    const world = () => readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8').then(JSON.parse);
    return {home, context, runtime, call, world};
}
async function prepare(t, name = 'New witness route', changes, purpose = 'new_destination') {
    const starting = graph.startScene(), clue = graph.nodes.get(graph.sceneClueIds(starting)[0]);
    const planned = changes ?? [
        {kind: 'add_scene', name: 'Harbor guesthouse', description: 'A guesthouse where the same case can be discussed.', based_on: graph.handle(starting), sources: [graph.handle(starting)], reason: 'The investigator chose to visit the harbor.'},
        {kind: 'route', from: graph.handle(starting), to: 'Harbor guesthouse', sources: [starting.name], reason: 'Ordinary travel to the harbor.'},
        {kind: 'clue_at', clue: graph.handle(clue), scene: 'Harbor guesthouse', sources: [clue.name], reason: 'The witness brings the existing evidence.'}
    ];
    const p = await t.call('adaptation.prepare', {name, purpose, request: 'Carry existing evidence to a guesthouse.', anchors: [starting.name]});
    const index = JSON.parse(await readFile(join(p.task.cwd, 'request.json'), 'utf8'));
    assert.equal(index.schema, 2);
    assert.equal(index.purpose, purpose);
    const focus = JSON.parse(await readFile(join(p.task.cwd, 'focus.json'), 'utf8'));
    assert.equal(focus.purpose, purpose);
    assert.ok(focus.source.length > 0 && focus.source.length <= 12);
    assert.ok(focus.recent_history.some(record => record.rendered_text === 'The investigator hears the commission.'));
    assert.deepEqual(index.creator_contract.required_change_fields, ['kind', 'reason', 'sources']);
    assert.ok(!Object.hasOwn(index, 'original'));
    const history = JSON.parse(await readFile(join(p.task.cwd, index.files.history), 'utf8'));
    assert.ok(history.some(record => record.rendered_text === 'The investigator hears the commission.'));
    assert.ok(history.every(record => !Object.hasOwn(record, 'capsule')));
    await writeFile(join(p.task.cwd, 'result.json'), JSON.stringify({explanation: 'Contract fixture only.', changes: planned}));
    const draft = await t.call('adaptation.draft', {name, key: p.task.key, attempt: p.task.attempt});
    const candidate = JSON.parse(await readFile(join(draft.task.cwd, 'candidate.json'), 'utf8'));
    assert.ok(!Object.hasOwn(candidate, 'effective'));
    assert.equal(candidate.deterministic.purpose_validated, true);
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

test('a delivered handout carrier becomes acquired causal evidence without rewriting discovered clues', () => {
    const handout = graph.kind('handout').find(node => (graph.out.get(node.node_id) ?? []).some(edge => {
        const clue = graph.nodes.get(edge.to_node_id);
        return clue?.node_kind === 'clue' && ['supports', 'depicts'].includes(edge.relation_kind)
            && (graph.out.get(clue.node_id) ?? []).some(next => next.relation_kind === 'supports' && graph.nodes.get(next.to_node_id)?.node_kind === 'conclusion');
    }));
    assert.ok(handout);
    const carrier = graph.out.get(handout.node_id).find(edge => ['supports', 'depicts'].includes(edge.relation_kind) && graph.nodes.get(edge.to_node_id)?.node_kind === 'clue');
    const clue = graph.nodes.get(carrier.to_node_id);
    const conclusion = graph.nodes.get(graph.out.get(clue.node_id).find(edge => edge.relation_kind === 'supports' && graph.nodes.get(edge.to_node_id)?.node_kind === 'conclusion').to_node_id);
    const handoutName = graph.handle(handout), clueName = graph.handle(clue), conclusionName = graph.handle(conclusion);
    const world = {active_scene: graph.handle(graph.startScene()), discovered_clues: [], handouts_shown: [handoutName], npc_presence: {}};
    const records = [{turn: 4, rendered_text: 'The document makes the causal link visible.', receipts: [{kind: 'handout', handout: handoutName}]}];
    const view = api.continuityView(graph, world, records, [], {anchors: [conclusionName]});
    const row = view.connections.find(value => value.name === conclusionName).evidence.find(value => value.name === clueName);
    assert.equal(row.acquired, true); assert.deepEqual(row.deliveries.map(value => value.turn), [4]);
    assert.deepEqual(world.discovered_clues, [], 'the carrier does not silently mint a clue receipt');
    const context = api.storyAssessmentContext(graph, world, records, [], [], 'main', 0, 5);
    const thread = context.threads.find(value => value.thread === conclusionName);
    assert.deepEqual(thread.supporting, [{evidence: clueName, delivery_turn: 4}]);
    const reentry = api.storyReentry(graph, world, records, [{turn: 4, worldline: 'main', loop: 0, status: 'misframed', thread: conclusionName,
        frame: 'The events are unrelated.', bridge_delivered: false, delivery_quote: null}], 'main', 0, [{name: conclusionName, importance: 'critical'}]);
    assert.equal(reentry.known[0].name, clueName);
    assert.equal(reentry.mode, 'clarify_known');
    assert.equal(reentry.bridge, undefined, 'the first repair uses acquired evidence before opening new graph work');
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

test('story assessment keeps acquired Globe evidence when full source references exceed its budget', () => {
    const clue = graph.find('globe-unpublished-story', ['clue']);
    const conclusion = graph.nodes.get((graph.out.get(clue.node_id) ?? []).find(edge =>
        edge.relation_kind === 'supports' && graph.nodes.get(edge.to_node_id)?.node_kind === 'conclusion').to_node_id);
    const world = {active_scene: 'newspaper-morgue', discovered_clues: [graph.handle(clue)], npc_presence: {}};
    const records = [{turn: 3, receipts: [{kind: 'clue', clue: graph.handle(clue)}], rendered_text: 'The unpublished report was read.'}];
    const context = api.storyAssessmentContext(graph, world, records, [], [], 'main', 0, 4);
    const thread = context.threads.find(value => value.thread === graph.handle(conclusion));
    assert.deepEqual(thread.supporting, [{evidence: graph.handle(clue), delivery_turn: 3}]);
    assert.ok(Buffer.byteLength(JSON.stringify(context), 'utf8') < 7000);
});

test('causal re-entry uses only the latest assessment from the active worldline and loop', () => {
    const scene = graph.startScene(), world = {active_scene: graph.handle(scene), discovered_clues: [], npc_presence: {}};
    const context = api.storyAssessmentContext(graph, world, [], [], [], 'main', 0, 3), thread = context.threads[0].thread;
    assert.ok(context.threads.every(value => ['critical', 'core'].includes(value.importance)));
    assert.ok(!context.threads.some(value => value.thread === 'commission-and-research-frame'));
    const assessment = {turn: 2, worldline: 'main', loop: 0, status: 'misframed', thread,
        frame: 'The events are unrelated.', bridge_delivered: false, delivery_quote: null};
    assert.ok(api.threadSection(graph, world, scene, [], [], [], [assessment], 'main', 0).reentry);
    assert.equal(api.threadSection(graph, world, scene, [], [], [], [assessment], 'main', 1).reentry, undefined);
    assert.equal(api.threadSection(graph, world, scene, [], [], [], [assessment], 'branch', 0).reentry, undefined);
    assert.equal(api.threadSection(graph, world, scene, [], [], [], [{...assessment, status: 'aligned'}], 'main', 0).reentry, undefined);
    assert.equal(api.threadSection(graph, world, scene, [], [], [], [{...assessment, status: 'unclear', thread: null, frame: null}], 'main', 0).reentry, undefined);
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

test('post-commit player understanding produces one causal re-entry and a delivered bridge suppresses repetition', async () => {
    const player = 'The scratches prove the house is ordinary vandalism, so the earlier tragedies are unrelated.';
    const t = await table(player), quiet = 'Dust hangs in the office light.';
    const core = api.storyAssessmentContext(graph, {active_scene: graph.handle(graph.startScene()), discovered_clues: [], npc_presence: {}}, [], [], [], 'main', 0, 1).threads[0].thread;
    const conclusion = graph.find(core, ['conclusion']);
    const clue = graph.nodes.get(graph.incoming.get(conclusion.node_id).find(edge => edge.relation_kind === 'supports').from_node_id);
    const sourceScene = graph.scenes().find(scene => graph.sceneClueIds(scene).includes(clue.node_id));
    await t.call('table.apply', {call_id: 't1-c1', effects: [
        {kind: 'move', to: graph.handle(sourceScene), via: 'contract fixture route', travel_minutes: 0},
        {kind: 'clue', clue: graph.handle(clue)}
    ]});
    await t.call('table.narrate', {call_id: 't1-c2', text: quiet});
    const job = await t.call('memory.job', {turn: 1});
    assert.ok(job.story_context.threads.length > 0, 'the existing memory job carries bounded unresolved story threads');
    assert.ok(job.story_context.threads.every(value => ['critical', 'core'].includes(value.importance)), 'a hook-level thread cannot displace the core causal story');
    assert.ok(job.story_context.threads.some(value => Array.isArray(value.supporting)), 'the same packet carries acquired causal evidence by thread');
    const thread = job.story_context.threads[0].thread;
    const candidatePath = join(t.home, '.coc/campaigns/c1/memory/candidates.jsonl');
    const storyPath = join(t.home, '.coc/campaigns/c1/memory/story.jsonl');
    const beforeCandidates = await readFile(candidatePath, 'utf8').catch(() => '');
    const beforeStory = await readFile(storyPath, 'utf8').catch(() => '');
    await assert.rejects(t.call('memory.submit', {job_id: job.job_id, candidates: [{kind: 'player_assertion', subject: 'player',
        statement: player, privacy: 'player_safe', state: 'distorted'}], story: {status: 'misframed', thread,
        frame: 'not an exact player excerpt', bridge_delivered: false, delivery_quote: null}}), /exact bounded excerpt/);
    assert.equal(await readFile(candidatePath, 'utf8').catch(() => ''), beforeCandidates, 'an invalid story writes no candidate rows');
    assert.equal(await readFile(storyPath, 'utf8').catch(() => ''), beforeStory, 'an invalid story writes no assessment row');

    const submitted = await t.call('memory.submit', {job_id: job.job_id, candidates: [], story: {status: 'misframed', thread,
        frame: player, bridge_delivered: false, delivery_quote: null}});
    assert.equal(submitted.story.status, 'misframed');
    const stored = (await readFile(storyPath, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(stored.length, 1); assert.equal(stored[0].worldline, 'main'); assert.equal(stored[0].frame, player);

    const secondInput = 'I keep cataloguing the scratches as ordinary damage.';
    const second = await t.call('table.player_input', {text: secondInput}), reentry = second.capsule.mods.thread.reentry;
    assert.ok(second.capsule.director.because.includes('stalled_turns = 0'), 'active play can need a causal bridge while structural stall counters remain zero');
    assert.equal(reentry.status, 'misframed'); assert.equal(reentry.frame, player); assert.equal(reentry.thread.name, thread);
    assert.equal(reentry.mode, 'clarify_known');
    assert.equal(reentry.bridge, undefined);
    assert.match(reentry.action, /clarify one acquired known evidence row/);
    assert.ok(Array.isArray(reentry.available.here) && Array.isArray(reentry.available.next));
    const telemetry = (await readFile(join(t.home, '.coc/campaigns/c1/telemetry.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(telemetry.some(value => value.lane === 'story' && value.event === 'assessment' && value.status === 'misframed'));
    assert.ok(telemetry.some(value => value.lane === 'story' && value.event === 'reentry_projected' && value.thread === thread));

    const bridge = 'The scratches repeat the same effort to keep investigators away from the cause behind the earlier tragedies.';
    await t.call('table.narrate', {call_id: 't2-c1', text: bridge});
    const nextJob = await t.call('memory.job', {turn: 2});
    assert.equal(nextJob.story_context.last_assessment.status, 'misframed');
    await t.call('memory.submit', {job_id: nextJob.job_id, candidates: [], story: {status: 'misframed', thread,
        frame: secondInput, bridge_delivered: true, delivery_quote: bridge}});
    const thirdInput = 'I heard that connection, but I still think the events are coincidence.';
    const third = await t.call('table.player_input', {text: thirdInput});
    assert.equal(third.capsule.mods.thread.reentry, undefined, 'one evidenced bridge is not repeated before later player understanding is assessed');
    await t.call('table.narrate', {call_id: 't3-c1', text: 'The acquired report remains on the table.'});
    const thirdJob = await t.call('memory.job', {turn: 3});
    await t.call('memory.submit', {job_id: thirdJob.job_id, candidates: [], story: {status: 'misframed', thread,
        frame: thirdInput, bridge_delivered: false, delivery_quote: null}});
    const fourth = await t.call('table.player_input', {text: 'I turn to unrelated cataloguing again.'});
    assert.equal(fourth.capsule.mods.thread.reentry.mode, 'introduce_evidence');
    assert.ok(fourth.capsule.mods.thread.reentry.bridge.clue, 'a renewed misframe after clarification may introduce one new bridge');
});

test('refusing a hook without acquired core evidence is detached rather than aligned to hidden truth', async () => {
    const player = 'I refuse the commission and will spend the month writing in Athens unless this follows me there.';
    const t = await table(player);
    await t.call('table.narrate', {call_id: 't1-c1', text: 'Knott keeps the job and records the forwarding address.'});
    const job = await t.call('memory.job', {turn: 1}), thread = job.story_context.threads[0].thread;
    assert.ok(job.story_context.threads.every(value => !value.supporting.length && !value.contradicting.length));
    await assert.rejects(t.call('memory.submit', {job_id: job.job_id, candidates: [], story: {status: 'aligned', thread,
        frame: 'I refuse the commission', bridge_delivered: false, delivery_quote: null}}), /requires acquired causal evidence/);
    await assert.rejects(t.call('memory.submit', {job_id: job.job_id, candidates: [], story: {status: 'detached', thread,
        frame: 'I refuse the commission', bridge_delivered: true, delivery_quote: 'Knott keeps the job'}}), /atmosphere alone is not delivery/);
    await t.call('memory.submit', {job_id: job.job_id, candidates: [], story: {status: 'detached', thread,
        frame: 'will spend the month writing in Athens unless this follows me there', bridge_delivered: false, delivery_quote: null}});
    const next = await t.call('table.player_input', {text: 'I continue with the Athens journey.'});
    assert.equal(next.capsule.mods.thread.reentry.status, 'detached');
    assert.ok(next.capsule.mods.thread.reentry.bridge.clue, 'the Keeper receives one concrete existing source carrier');
    assert.match(next.capsule.mods.thread.reentry.bridge.delivery, /chosen direction/);
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
    const ordinaryMiss = await t.call('table.lookup', {kind: 'module', query: 'ordinary brass key', expected_kind: 'object'});
    assert.equal(ordinaryMiss.status, 'not_found'); assert.ok(!ordinaryMiss.preparation); assert.match(ordinaryMiss.note, /define\/object\/item/);
    const untypedMiss = await t.call('table.lookup', {kind: 'module', query: 'another ordinary passerby'});
    assert.ok(!untypedMiss.preparation); assert.match(untypedMiss.note, /first-appearance/);
    const original = await t.call('table.lookup', {kind: 'module', query: 'Harbor guesthouse', expected_kind: 'scene', canonical_source: true});
    assert.deepEqual(original.entities, []);
    assert.equal(original.preparation.kind, 'adaptation');
    assert.equal(original.preparation.action, 'prepare');
    assert.equal(original.preparation.purpose, 'new_destination');
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

test('an honest wait-only turn does not stale retained adaptation work', async () => {
    const t = await table(), p = await prepare(t); await review(t, p);
    await t.call('table.narrate', {call_id: 't1-c1', text: 'Preparation continues; no fictional event has happened.'});
    await t.call('table.player_input', {text: 'Use the same proposal if it is ready.'});
    assert.equal((await t.call('adaptation.status', {name: p.name})).status, 'ready');
    const accepted = await t.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'adaptation', name: p.name}]});
    assert.ok(accepted.receipts.some(value => value.startsWith('adaptation:')));
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
    assert.throws(() => api.normalizeChanges(graph, [], world, [{op: 'add_scene', name: 'Wrong field', description: 'No.', based_on: scene,
        reason: 'Fixture.', sources: [scene]}], 'fixture'), e => e.details?.field === 'kind' && /not "op"/.test(e.fix));
});

test('supporting NPC knowledge and new handout renditions are available without automatic presence or discovery', async () => {
    const t = await table(), start = graph.startScene(),
        clue = graph.kind('clue').find(node => graph.out.get(node.node_id)?.some(edge => edge.relation_kind === 'supports')),
        handout = graph.kind('handout')[0];
    const npcChanges = [
        {kind: 'add_npc', name: 'Harbor clerk', description: 'A supporting witness.', agenda: 'Explain the records.', sources: [start.name], reason: 'A witness to the existing case.'},
        {kind: 'npc_knows', npc: 'Harbor clerk', clue: graph.handle(clue), sources: [clue.name], reason: 'The witness handled this evidence.'}
    ];
    const before = await t.world(), p = await prepare(t, 'Witness', npcChanges, 'persistent_npc'), ready = await review(t, p);
    assert.equal(ready.changes[0].agenda, 'Explain the records.');
    await t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'adaptation', name: p.name}]});
    const copy = await prepare(t, 'Harbor copy', [{kind: 'handout', name: 'Harbor copy', text: 'An acquired-evidence rendition.', based_on: handout.name,
        sources: [handout.name], reason: 'A separate campaign copy.'}], 'handout');
    await review(t, copy);
    await t.call('table.apply', {call_id: 't1-c2', effects: [{kind: 'adaptation', name: copy.name}]});
    assert.equal((await t.world()).npc_presence['Harbor clerk'], undefined);
    assert.deepEqual((await t.world()).discovered_clues, before.discovered_clues);
    await t.call('table.apply', {call_id: 't1-c3', effects: [{kind: 'npc', name: 'Harbor clerk', to: graph.handle(start)}]});
    const npc = await t.call('table.look', {focus: 'npc', name: 'Harbor clerk'});
    assert.ok(JSON.stringify(npc).includes(graph.handle(clue)));
    assert.ok(JSON.stringify(npc).includes('campaign_adaptation'));
    const continuity = await t.call('table.lookup', {kind: 'continuity', anchors: [graph.handle(clue)]});
    const knowledge = continuity.connections.flatMap(c => c.evidence).flatMap(e => e.people).find(person => person.name === 'Harbor clerk');
    assert.equal(knowledge.origin.kind, 'campaign_adaptation');
    assert.equal(knowledge.origin.reason, 'The witness handled this evidence.');
    const shown = await t.call('table.apply', {call_id: 't1-c4', effects: [{kind: 'handout', name: 'Harbor copy'}]});
    assert.equal(shown.attachment.available, true);
    assert.match(await readFile(shown.attachment.path, 'utf8'), /An acquired-evidence rendition/);
    await t.call('table.narrate', {call_id: 't1-c5', text: 'Harbor clerk offers the copy.'});
    assert.ok((await t.call('journal.job', {turn: 1})).recordable.includes('Harbor clerk'));
    const audit = await t.call('mods.job', {role: 'audit', input: {text: 'Harbor clerk remains here.'}});
    const originalGraph = JSON.parse(await readFile(join(audit.cwd, 'original.json'), 'utf8')).graph;
    const effectiveGraph = JSON.parse(await readFile(join(audit.cwd, 'effective.json'), 'utf8')).graph;
    assert.ok(!originalGraph.nodes.some(node => node.name === 'Harbor clerk'));
    assert.ok(effectiveGraph.nodes.some(node => node.name === 'Harbor clerk' && node.campaign_origin));
});

test('accepted source stays pinned across shared publication until a reviewed rebase; other campaigns remain unadapted', async () => {
    const content = join(root, 'content'), home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({workspace: home, content, seed: 'continuity', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const seedStore = new api.ModuleStore(context);
    await seedStore.register('the-haunting');
    for (const ref of new Set(raw.nodes.map(node => node?.properties?.asset_ref).filter(ref => typeof ref === 'string' && ref))) {
        const parts = ref.split('/');
        await mkdir(join(seedStore.moduleDir('the-haunting'), ...parts.slice(0, -1)), {recursive: true});
        await writeFile(join(seedStore.moduleDir('the-haunting'), ...parts), '');
    }
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    await call('table.narrate', {call_id: 't0-c1', text: 'The investigator hears the commission.'});
    await call('table.player_input', {text: 'I want to understand how these events connect.'});
    const world = () => readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8').then(JSON.parse);
    const t = {home, context, runtime, call, world}, p = await prepare(t); await review(t, p);
    await t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'adaptation', name: p.name}]});
    const originalSource = (await t.world()).adaptation.source;
    await t.call('table.narrate', {call_id: 't1-c2', text: 'The preparation is retained.'});
    await t.call('table.player_input', {text: 'We review the newly available records.'});
    await t.call('campaign.create', {id: 'c2', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await t.call('table.open', {campaign: 'c2'});
    assert.equal((await t.call('table.lookup', {campaign: 'c2', kind: 'module', query: 'Harbor guesthouse'})).entities.length, 0);
    const c1SourceContext = await api.ensureCampaignModule(t.context, 'c1', 'the-haunting');
    await api.ensureCampaignModule(t.context, 'c2', 'the-haunting');
    const safePier = {node_id: 'location-safe-pier', node_kind: 'location', name: 'Safe Pier', summary: 'New source material.', properties: {}};
    const publishSafePier = async store => {
        const meta = await store.module('the-haunting'), next = structuredClone(await store.readGraph('the-haunting') ?? raw);
        next.nodes = next.nodes.filter(node => node.node_id !== safePier.node_id);
        next.nodes.push(safePier);
        await store.writeModule(await store.writeGraph(meta, next));
    };
    await publishSafePier(new api.ModuleStore(t.context));
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Safe Pier'})).entities.length, 0);
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Safe Pier', canonical_source: true})).entities.length, 0);
    assert.equal((await t.call('table.lookup', {campaign: 'c2', kind: 'module', query: 'Safe Pier'})).entities.length, 0);
    assert.equal((await t.call('table.lookup', {campaign: 'c2', kind: 'module', query: 'Safe Pier', canonical_source: true})).entities.length, 0);
    await publishSafePier(new api.ModuleStore(c1SourceContext));
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Safe Pier', canonical_source: true})).entities.length, 1);
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Safe Pier'})).entities.length, 0);
    assert.equal((await t.call('table.lookup', {campaign: 'c2', kind: 'module', query: 'Safe Pier', canonical_source: true})).entities.length, 0);
    const originalSourcePath = join(t.home, '.coc/adaptation-sources', `${originalSource}.json`);
    const originalSourceBytes = await readFile(originalSourcePath, 'utf8');
    assert.ok(!originalSourceBytes.includes('Safe Pier'));
    const r = await t.call('adaptation.prepare', {name: 'Source refresh', purpose: 'rebase', request: 'Review the new source generation.', anchors: [graph.startScene().name], rebase: true});
    await writeFile(join(r.task.cwd, 'result.json'), JSON.stringify({changes: [], explanation: 'Rebase fixture.'}));
    const d = await t.call('adaptation.draft', {name: r.name, key: r.task.key, attempt: r.task.attempt});
    const count = (await t.world()).adaptation.records.flatMap(x => x.changes).length;
    await review(t, {name: r.name, key: r.task.key, attempt: r.task.attempt, task: d.task, planned: Array.from({length: count}, () => null)});
    await t.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'adaptation', name: r.name}]});
    assert.equal(await readFile(originalSourcePath, 'utf8'), originalSourceBytes);
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Safe Pier'})).entities.length, 1);
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Safe Pier', canonical_source: true})).entities.length, 1);
    assert.equal((await t.call('table.lookup', {kind: 'module', query: 'Harbor guesthouse'})).entities.length, 1);
    assert.equal((await t.call('table.lookup', {campaign: 'c2', kind: 'module', query: 'Safe Pier'})).entities.length, 0);
    assert.equal((await t.call('table.lookup', {campaign: 'c2', kind: 'module', query: 'Safe Pier', canonical_source: true})).entities.length, 0);
});

test('a retry has a new attempt owner; old results cannot finish or fail the replacement', async () => {
    const t = await table(), params = {name: 'Retry ownership', purpose: 'new_destination', request: 'Prepare a witness route.', anchors: [graph.startScene().name]};
    const first = await t.call('adaptation.prepare', params);
    const second = await t.call('adaptation.prepare', {...params, retry: true});
    assert.notEqual(first.task.attempt, second.task.attempt);
    await assert.rejects(t.call('adaptation.draft', {name: params.name, key: first.task.key, attempt: first.task.attempt}));
    await t.call('adaptation.fail', {name: params.name, key: first.task.key, attempt: first.task.attempt, error: 'Obsolete failure'});
    assert.equal((await t.call('adaptation.status', {name: params.name})).status, 'pending');
    await assert.rejects(t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'adaptation', name: params.name}, {kind: 'time', minutes: 1}]}));
});

test('unnamed adaptation status returns the latest retained semantic proposal for cold recovery', async () => {
    const t = await table(), params = {name: 'Retained Athens route', purpose: 'new_destination',
        request: 'Prepare a retained destination.', anchors: [graph.startScene().name]};
    const prepared = await t.call('adaptation.prepare', params);
    const pending = await t.call('adaptation.status');
    assert.equal(pending.name, params.name); assert.equal(pending.status, 'pending'); assert.equal(pending.retained, true);
    await t.call('adaptation.fail', {name: params.name, key: prepared.task.key, attempt: prepared.task.attempt, error: 'Interrupted by restart'});
    const failed = await t.call('adaptation.status');
    assert.equal(failed.name, params.name); assert.equal(failed.status, 'failed');
});

test('prepare requires a closed purpose and rejects graph changes outside that purpose', async () => {
    const t = await table(), scene = graph.startScene(), before = JSON.stringify(await t.world());
    await assert.rejects(t.call('adaptation.prepare', {name: 'Missing purpose', request: 'A vague change.', anchors: [scene.name]}),
        e => e.code === 'invalid_params' && /purpose/.test(e.message));
    const p = await t.call('adaptation.prepare', {name: 'Not an NPC', purpose: 'persistent_npc', request: 'Keep one recurring witness.', anchors: [scene.name]});
    await writeFile(join(p.task.cwd, 'result.json'), JSON.stringify({explanation: 'Wrong closed shape.', changes: [{kind: 'add_scene', name: 'Wrong room',
        description: 'This is structurally a scene.', based_on: graph.handle(scene), sources: [scene.name], reason: 'Contract mismatch fixture.'}]}));
    await assert.rejects(t.call('adaptation.draft', {name: p.name, key: p.task.key, attempt: p.task.attempt}),
        e => e.code === 'invalid_params' && e.details?.field === 'purpose');
    assert.equal(JSON.stringify(await t.world()), before);
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
    const second = await prepare(t, 'Side witness', [{kind: 'add_npc', name: 'Dockhand', description: 'A supporting witness.', agenda: 'Explain records.', sources: [graph.startScene().name], reason: 'An alternative supporting role.'}], 'persistent_npc');
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

/**
 * Contract §37.6: a refusal the Keeper cannot read is a refusal it repeats. Retained live evidence
 * `midgame-bridge-live-21` shows the same contradicted placement prepared twice because the surface said
 * only "Independent review did not support every change without unresolved issues".
 */
test('a contradicted placement reports the reviewer own words and tells the keeper not to repeat it', async () => {
    const starting = graph.startScene(), clue = graph.nodes.get(graph.sceneClueIds(starting)[0]);
    const rebinding = [{kind: 'clue_at', clue: graph.handle(clue), scene: graph.handle(starting),
        sources: [clue.name], reason: 'Let the existing evidence be discoverable where the player stands.'}];
    const t = await table(), p = await prepare(t, 'Report to the office', rebinding, 'source_rebinding');
    const contradiction = 'The source keeps that copy at the newspaper morgue and gives Knott no such document.';
    await assert.rejects(review(t, p, {verdict: 'contradicted', summary: contradiction,
        issues: ['clue_at contradicts the canonical discoverable-at newspaper-morgue.'],
        checked: [{index: 0, verdict: 'contradicted', reason: contradiction}]}),
        error => error.details?.reason === 'adaptation_review_failed');
    // The lane host records the failure the way the runtime does.
    await t.call('adaptation.fail', {name: p.name, key: p.key, attempt: p.attempt, error: 'Independent review did not support every change without unresolved issues'});

    const status = await t.call('adaptation.status', {name: p.name});
    assert.equal(status.status, 'failed');
    assert.equal(status.purpose, 'source_rebinding');
    assert.equal(status.refused.summary, contradiction);
    assert.deepEqual(status.refused.issues, ['clue_at contradicts the canonical discoverable-at newspaper-morgue.']);
    assert.deepEqual(status.refused.contradicted, [contradiction]);
    assert.match(status.instruction, /Do not prepare the same placement again/);
    // The generic sentence is kept; it is simply no longer all the Keeper is told.
    assert.match(status.reason, /did not support every change/);
});

/**
 * Contract §37.6: the projection must carry a real refusal and nothing else. An absent one used to reach
 * the auditor as the Python-compatible placeholder strings that `string()` returns for null.
 */
test('rebinding_refused reaches the auditor only when a real refusal was recorded', async () => {
    const t = await table();
    const campaign = {id: 'c1'};
    const world = await t.world();
    const turn = JSON.parse(await readFile(join(t.home, '.coc/campaigns/c1/turn.json'), 'utf8'));
    const module = await api.loadCampaignModule(t.context, 'the-haunting', world);
    const party = JSON.parse(await readFile(join(t.home, '.coc/campaigns/c1/party/thomas-hayes.json'), 'utf8'));
    const evidenceFor = (refused) => api.auditSourceEvidence(t.context, campaign, module, world, turn, [party], true, null, refused);

    const absent = await evidenceFor(null);
    assert.equal(Object.hasOwn(absent.files['context.json'], 'rebinding_refused'), false);
    const empty = await evidenceFor({});
    assert.equal(Object.hasOwn(empty.files['context.json'], 'rebinding_refused'), false);
    const real = await evidenceFor({name: 'report-to-the-office', summary: 'The source keeps that copy elsewhere.'});
    assert.deepEqual(real.files['context.json'].rebinding_refused,
        {name: 'report-to-the-office', summary: 'The source keeps that copy elsewhere.'});
    const nameOnly = await evidenceFor({name: 'report-to-the-office'});
    assert.deepEqual(nameOnly.files['context.json'].rebinding_refused, {name: 'report-to-the-office'});
});

/**
 * Contract §37.2: `truncated` tells the memory lane its evidence was cut. It used to be
 * `connections.length > limit` from the shared continuity view — and this caller deliberately asks for only
 * its selected threads, so on `the-haunting` (6 conclusions, 3 core threads) it was true on every turn.
 */
test('story_context truncation reports a real cut, not that the graph holds other conclusions', () => {
    const start = graph.handle(graph.startScene());
    const world = (discovered) => ({active_scene: start, discovered_clues: discovered, handouts_shown: [], npc_presence: {}});
    const context = (discovered) => api.storyAssessmentContext(graph, world(discovered), [], [], [], 'main', 0, 99);

    // The graph reaches more conclusions than the packet selects, and that alone is not a cut.
    const whole = context([]);
    assert.ok(graph.kind('conclusion').length > whole.threads.length, 'the module must hold more conclusions than selected threads');
    assert.equal(whole.truncated, false);

    // Pick a selected thread that carries more acquired clues than the compact projection keeps.
    const selected = whole.threads.map(thread => {
        const node = graph.find(thread.thread);
        const clues = (graph.incoming.get(node.node_id) ?? []).filter(edge => edge.relation_kind === 'supports')
            .map(edge => graph.nodes.get(edge.from_node_id)).filter(value => value?.node_kind === 'clue').map(value => graph.handle(value));
        return {name: thread.thread, clues};
    }).find(thread => thread.clues.length >= 3);
    assert.ok(selected, 'this test needs a selected thread with at least three supporting clues');

    assert.equal(context(selected.clues.slice(0, 2)).truncated, false);
    const cut = context(selected.clues.slice(0, 3));
    assert.equal(cut.truncated, true);
    const thread = cut.threads.find(value => value.thread === selected.name);
    assert.equal(thread.supporting.length + thread.contradicting.length, 2,
        'a truncated thread keeps the acquired rows the projection could carry; erasing them is the live-18 turn-3 failure');
});
