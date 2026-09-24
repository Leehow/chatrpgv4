/**
 * Contract §124.11 (live gate #5): a post-turn lane's write that lands while the read's prescreen runs voids only
 * the materials whose dependencies it reaches. Real kernel on the Haunting's opening; the lane writes go through
 * their real RPCs (`voice.submit` of the npc-voice lane, a `table.apply` move). Controlled typed decisions only.
 *
 * §124.11.1 (SL-44, long gate #4 t14): the reading store's revision is not a prescreen binding key. A source answer that
 * lands mid-read writes the reader's bookkeeping (`meta.reading` of the module), which `source_revision` digests; the
 * prescreen keeps its prepared result. The bookkeeping write here is that field, written as the reader writes it.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {supportChoices} from './support-agent-helpers.mjs';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(root, '.coc', 'prescreen-binding-drift-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `
export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {prepareKeeperSupport} from './extensions/table/prescreen.ts';
`, resolveDir: root, sourcefile: 'prescreen-binding-drift-api.ts'}, outfile: join(temporary, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const closers = [];
after(async () => {for (const close of closers) await close();});

const SENTENCE = 'I ask Knott what happened in that house.';

async function openTable(t) {
  const home = await mkdtemp(join(temporary, `table-${t.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-`));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'prescreen-binding-drift',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.player_input', {text: SENTENCE});
  const capsule = await call('table.capsule'), context_ = capsule._context;
  const binding = {version: 1, campaign: 'c1', worldline: context_.worldline, loop: context_.loop, turn: context_.turn,
    source_revision: context_.source_revision};
  return {call, capsule, binding, home};
}

/**
 * A source answer lands (§22.4.3, SL-36): the reader records it in the module's own bookkeeping, `meta.reading.answers`.
 * Returns the context before and after, so the test proves the write moved `source_revision` (and only it).
 */
async function answerLands(table) {
  const before = (await table.call('table.capsule'))._context;
  const path = join(table.home, '.coc', 'modules', 'the-haunting', 'module.json');
  const meta = JSON.parse(await readFile(path, 'utf8'));
  meta.reading = {...(meta.reading ?? {}), answers: {...(meta.reading?.answers ?? {}), 'sl44-landed': {status: 'answered', focus: 'corbitt-house-ground'}}};
  await writeFile(path, JSON.stringify(meta, null, 2));
  const after = (await table.call('table.capsule'))._context;
  return {before, after};
}

/** The npc-voice lane's own write (contract §40.7): the job it opened after the last turn, submitted now. */
async function voiceLands(call) {
  const job = await call('voice.job');
  assert.ok(job.job_id, 'a person the book leaves silent is waiting for a voice');
  await call('voice.submit', {job_id: job.job_id, voice: {mask: 'Calls everyone sir.', exchanges: ['a -> b', 'c -> d', 'e -> f']}});
}

/**
 * Loop decisions scripted per round: `plan[n]` names the operation of round n+1 by a predicate over the issued
 * operation, or 'finish'; `before[n]` runs before that round's answer (the lane landing mid-run).
 */
function scripted(plan, before = {}) {
  let round = 0;
  return {async decide(batch) {
    const loop = batch.questions.some(question => question.key === 'operation');
    const answers = supportChoices(batch);
    if (loop) {
      const step = plan[round], hook = before[round]; round++;
      if (hook) await hook();
      const operation = step === 'finish' || step === undefined ? undefined : batch.state.operations.find(step);
      assert.ok(step === 'finish' || step === undefined || operation, `round ${round} offers the planned operation`);
      answers.operation = operation?.alias ?? 'finish';
      answers.coverage = operation ? 'missing' : 'sufficient';
      answers.consistency = 'clear';
      // One read per round, so each round's operation is exactly the planned one.
      for (const key of Object.keys(answers)) if (key.startsWith('include_')) answers[key] = 'skip';
    }
    return {batchId: batch.id, status: 'complete', attempts: 1, usage: {inputTokens: 10, outputTokens: 2},
      coverage: {required: [], answered: [], unknown: []}, issues: [],
      answers: Object.fromEntries(Object.entries(answers).map(([key, choice]) => [key, typeof choice === 'object'
        ? {status: 'answered', type: 'noul', noul: choice.noul} : {status: 'answered', type: 'choice', choice}]))};
  }};
}
const graphRead = operation => operation.tool === 'read' && operation.basis?.kind === 'graph_entity';
const investigatorRead = operation => operation.tool === 'read' && operation.basis?.kind === 'investigator';
const moreCatalog = operation => operation.tool === 'discover' && operation.label === 'More campaign material';

async function prepare(table, decision) {
  const events = [];
  const message = await api.prepareKeeperSupport({call: (method, params) => table.call(method, params), campaign: 'c1',
    binding: table.binding, capsule: table.capsule, signal: new AbortController().signal, decision, env: {},
    record: event => events.push(event), timeoutMs: 30000, byteBudget: 16 * 1024});
  return {message, events, content: message ? JSON.parse(message.content) : undefined,
    fallback: events.find(event => event.event === 'fallback'), prepared: events.find(event => event.event === 'prepared')};
}

test('gate #5: a voice lane lands before the final check; the graph material it does not reach is published', async t => {
  const table = await openTable(t);
  const run = await prepare(table, scripted([graphRead, 'finish'], {1: () => voiceLands(table.call)}));
  assert.equal(run.fallback, undefined, `no fallback: ${JSON.stringify(run.fallback?.reason)} ${JSON.stringify(run.fallback?.key)}`);
  assert.ok(run.message, 'the prepared packet is delivered');
  assert.ok(run.content.materials.some(material => material.kind === 'graph_entity'), 'the graph unit survives a stateStamp change');
  assert.deepEqual(run.prepared.binding_refresh, {changed: ['stateStamp'], dropped: 0});
});

test('a lane landing before a later catalog page does not refuse the page', async t => {
  const table = await openTable(t);
  const run = await prepare(table, scripted([graphRead, moreCatalog, 'finish'], {1: () => voiceLands(table.call)}));
  assert.equal(run.fallback, undefined, `no fallback: ${JSON.stringify(run.fallback?.reason)} ${JSON.stringify(run.fallback?.key)}`);
  assert.ok(run.content.materials.some(material => material.kind === 'graph_entity'));
  assert.ok(run.prepared.retrieval.steps >= 2, 'the page after the write was read');
  assert.deepEqual(run.prepared.binding_refresh.changed, ['stateStamp']);
});

test('a stateStamp change drops only the current-state material that depends on it, naming the key', async t => {
  const table = await openTable(t);
  const run = await prepare(table, scripted([graphRead, investigatorRead, 'finish'], {2: () => voiceLands(table.call)}));
  assert.equal(run.fallback, undefined, `no fallback: ${JSON.stringify(run.fallback)}`);
  assert.ok(run.content.materials.some(material => material.kind === 'graph_entity'), 'graph material kept');
  assert.ok(!run.content.materials.some(material => material.kind === 'investigator'), 'the stale investigator read left the packet');
  const gap = run.content.gaps.find(value => value.reason === 'binding_changed');
  assert.ok(gap, `the Keeper sees the drop as a gap with its read: ${JSON.stringify(run.content.gaps)}`);
  assert.equal(gap.kind, 'investigator');
  assert.ok(gap.read, 'the dropped material keeps its ordinary read continuation');
  assert.equal(Object.hasOwn(gap, 'key'), false, 'the binding key is host telemetry, not Keeper text');
  const pending = run.prepared.pending_reads.find(value => value.reason === 'binding_changed');
  assert.deepEqual(pending, {kind: 'investigator', label: gap.label, reason: 'binding_changed', key: 'stateStamp'});
  assert.equal(run.message.details.prescreen.gap_details.find(value => value.reason === 'binding_changed').key, 'stateStamp');
  assert.deepEqual(run.prepared.binding_refresh, {changed: ['stateStamp'], dropped: 1});
});

test('§124.11.1 (gate #4 t14): a source answer landing before the finish decision moves source_revision, and the prescreen still prepares', async t => {
  const table = await openTable(t);
  let landed;
  const run = await prepare(table, scripted([graphRead, 'finish'], {1: async () => { landed = await answerLands(table); }}));
  assert.notEqual(landed.after.source_revision, landed.before.source_revision, 'the landing moved source_revision (the key gate #4 fell back on)');
  assert.equal(landed.after.task_source_revision, landed.before.task_source_revision, 'the book itself did not change');
  assert.equal(landed.after.source_revision === table.binding.source_revision, false, 'the prescreen was bound before the landing');
  assert.equal(run.fallback, undefined, `no fallback: ${JSON.stringify(run.fallback?.reason)} ${JSON.stringify(run.fallback?.key)}`);
  assert.ok(run.message && run.prepared, 'prepared, and the packet is delivered');
  assert.ok(run.content.materials.some(material => material.kind === 'graph_entity'), 'the graph material it packed is published');
  assert.ok(!run.content.gaps.some(gap => gap.reason === 'binding_changed'), 'nothing dropped for it');
});

test('§124.11.1: a source answer landing before a later catalog page does not refuse the page', async t => {
  const table = await openTable(t);
  const run = await prepare(table, scripted([graphRead, moreCatalog, 'finish'], {1: () => answerLands(table)}));
  assert.equal(run.fallback, undefined, `no fallback: ${JSON.stringify(run.fallback?.reason)} ${JSON.stringify(run.fallback?.key)}`);
  assert.ok(run.prepared.retrieval.steps >= 2, 'the page after the landing was read');
  assert.ok(run.content.materials.some(material => material.kind === 'graph_entity'));
});

test('§124.11.1: a source answer landing between the run binding and the prescreen first read -- the catalog and the index are still taken', async t => {
  const table = await openTable(t);
  const landed = await answerLands(table);
  assert.notEqual(landed.after.source_revision, table.binding.source_revision, 'the run is bound to the revision before the landing');
  const run = await prepare(table, scripted([graphRead, 'finish']));
  assert.equal(run.fallback, undefined, `no fallback: ${JSON.stringify(run.fallback?.reason)} ${JSON.stringify(run.fallback?.key)}`);
  assert.ok(run.content.materials.some(material => material.kind === 'graph_entity'));
  assert.notEqual(run.prepared.locate?.status, 'index_unavailable', `the locate read the index: ${JSON.stringify(run.prepared.locate)}`);
});

test('a scene change mid-run voids the result and the fallback names the key', async t => {
  const table = await openTable(t);
  const move = async () => {
    const result = await table.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'newspaper-morgue', why: 'test'}]});
    assert.ok(!result.refused?.length, JSON.stringify(result.refused));
  };
  const run = await prepare(table, scripted([graphRead, 'finish'], {1: move}));
  assert.equal(run.message, undefined, 'nothing prepared against the old scene is published');
  assert.equal(run.fallback?.reason, 'binding_changed');
  assert.equal(run.fallback?.key, 'scene');
});

test('the owner names the stale keys a change reaches (§124.11)', async t => {
  const table = await openTable(t);
  const catalog = await table.call('table.workspace.read', {query: SENTENCE, preselect: {version: 2, mode: 'catalog', limit: 48}});
  const graph = catalog.materials.candidates.find(row => row.kind === 'graph_entity').key,
    investigator = catalog.materials.candidates.find(row => row.kind === 'investigator').key;
  await voiceLands(table.call);
  const stale = await table.call('table.workspace.read', {query: SENTENCE, binding: catalog.binding,
    preselect: {version: 2, mode: 'check', keys: [graph, investigator]}});
  assert.equal(stale.materials.check.status, 'stale');
  assert.deepEqual(stale.materials.check.changed, ['stateStamp']);
  assert.deepEqual(stale.materials.check.stale_keys, [investigator]);
  const all = await table.call('table.workspace.read', {query: SENTENCE, binding: catalog.binding, preselect: {version: 2, mode: 'check'}});
  assert.deepEqual(all.materials.check.stale_keys, [], 'a keyless check compares everything and names no material');
});

test('the run\'s read row names the key and counts the calls a discarded prescreen spent (§135.6)', async t => {
  const {createHybridEngine} = await import('../../runtime/jev/hybrid-engine.ts');
  const table = await openTable(t), rows = [], handlers = new Map();
  const move = async () => { await table.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'newspaper-morgue', why: 'test'}]}); };
  const engine = createHybridEngine({env: {PI_COC_JEV_PRESELECT: '1', EXT_JEV_APIKEY: 'mechanical-test-key'},
    decision: scripted([graphRead, 'finish'], {1: move}), record: row => rows.push(row)});
  const bus = {on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value)};
  engine.extension({events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {}});
  bus.emit('coc:kernel-bridge', {campaign: 'c1', call: (method, params) => table.call(method, params)});
  const plan = await engine.runDriver.prepare({runId: 'run-1', inputRevision: 'rev', rawInput: SENTENCE, session: {}});
  const read = await plan.ports.read.read({origin: 'policy', operation: 'read', readOnly: true},
    {runId: 'run-1', stepId: 's1', operationId: 's1/op1', origin: 'policy', inputRevision: 'rev', scopeId: 'root', signal: new AbortController().signal});
  const row = rows.find(entry => entry.lane === 'run' && entry.event === 'read'),
    fallback = rows.find(entry => entry.lane === 'prescreen' && entry.event === 'fallback');
  assert.ok(fallback, 'the prescreen fell back');
  assert.equal(row.prescreen.status, 'fallback');
  assert.equal(row.prescreen.fallback, 'binding_changed');
  assert.equal(row.prescreen.key, 'scene');
  assert.ok(fallback.jev_calls > 0);
  assert.equal(row.prescreen.jev_calls, fallback.jev_calls, 'the read row counts what the discarded prescreen spent');
  assert.equal(read.artifact.read.calls, fallback.jev_calls, 'and so does the read artifact (reported only: the decision budget does not charge a read, §135.6 SL-22)');
});
