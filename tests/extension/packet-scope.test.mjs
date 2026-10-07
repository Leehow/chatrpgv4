/**
 * RD-04, contract §187.5: the author's task is cut to the job.
 *
 * A synthetic 111-page book on the emitted kernel: an index whose sections give the chapters Harbor (1-2), Prologue (3-39),
 * Roadhouse (40-69), Ending (70-89) and Far (90-111); an opening (Dock, Tower, Lena on pages 1-2); and two reviewed detail
 * publications that put nodes on pages 3, 40, 41, 70 and 95. A background source unit of pages 40-41 is then claimed
 * through `module.read.claim` and run by the real `ReadingService` with a fake reader child: its packet carries the
 * nodes of 40/41, the window (40-89) and their one-hop neighbours, not page 3's; `field_spans` is in neither packet.json
 * nor task.json; and both `coc-read-check` (on the host's task.json) and `module.read.finish` still judge a field by the
 * span the graph recorded for it (§22.3.1). Only the reader child is a fake.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {appendFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {readerInstructionText} from '../../runtime/reader-instructions.ts';
import {createRuntime} from '../../runtime/host.ts';
import {ROOT, PAGES, sha, write} from './harbor-book.mjs';

const content = join(ROOT, 'content');
const {checkSourceDraft} = await import(pathToFileURL(join(ROOT, 'build/kernel/check.mjs')).href);
await mkdir(join(ROOT, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(ROOT, '.coc', 'packet-scope-'));
after(() => rm(bundleDir, {recursive: true, force: true}));
await build({stdin: {contents: `export {scopeGraph, jobPages} from './kernel-ts/modules/packet-scope.ts';` +
    `export {scopedVocabulary, vocabulary, loadModuleContract} from './kernel-ts/modules/contract.ts';` +
    `export {snapshots} from './kernel-ts/snapshots.ts';`, resolveDir: ROOT, sourcefile: 'packet-scope-api.ts', loader: 'ts'},
  outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);

const refs = (...pages) => pages.map(page => ({page}));
const observe = (job, pages) => write(join(job.work_dir, 'observations.json'),
  {file_sha256: job.source.file_sha256, read_pages: pages, full_pages: pages, review_pages: pages});
const supported = (paths, pages) => ({checked: paths.map(path => ({path, verdict: 'supported', source_refs: refs(...pages), reason: 'fixture support'})), missing: []});
/**
 * A pre-policy packet, as the same-span suite simulates it: under module-logic review a ready node's published value is
 * preserved and its span grows, so the §22.3.1 span judgement is exercised on the legacy packet.
 */
async function legacy(job) {
  const path = join(job.work_dir, 'packet.json'), packet = JSON.parse(await readFile(path, 'utf8'));
  delete packet.review_policy;
  await write(path, packet);
}
const shard = (nodes, claims, ready) => ({nodes, claims, node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ready});
const claim = (subject_id, predicate, object, page) => ({subject_id, predicate, object: {node_id: object}, truth_status: 'authored-fact', source_refs: refs(page)});

async function book(t) {
  const home = await mkdtemp(join(ROOT, '.coc', 'packet-scope-home-'));
  const owner = createRuntime({owner: 'preparation', home}, {resourceRoot: ROOT, nodeExecutable: process.execPath});
  t.after(async () => { await owner.close(); await rm(home, {recursive: true, force: true}); });
  const client = owner.openKernel();
  const bytes = Buffer.from('%PDF-1.7\nsource identity for the packet-scope fixture only\n'), pdf = join(home, 'fixture.pdf');
  await writeFile(pdf, bytes);
  const {module_id} = await client.call('module.source.bind', {source: {path: pdf, page_count: PAGES, file_sha256: sha(bytes)}});
  const call = (method, params = {}) => client.call(method, {module_id, ...params});
  const claimJob = () => call('module.read.claim', {owner: 'host-test'});
  const finish = (job, extra = {}) => call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed',
    draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json'), ...extra});
  const publish = async (params, draft, paths, pages) => {
    await call('module.read.request', {foreground: true, ...params});
    const job = await claimJob();
    await legacy(job);
    await observe(job, pages);
    await write(join(job.work_dir, 'draft.json'), draft);
    await write(join(job.work_dir, 'review.json'), supported(paths, pages));
    await finish(job);
    return job;
  };
  await call('module.read.request', {purpose: 'index'});
  const index = await claimJob();
  await observe(index, [1, 2, 3, 40, 41, 70, 90]);
  await write(join(index.work_dir, 'draft.json'), {title: 'The Harbor', language: 'en', sections: [
    ['Harbor', 1, 2], ['Prologue', 3, 3], ['Roadhouse', 40, 41], ['Ending', 70, 70], ['Far', 90, 90]].map(([name, first, last]) =>
    ({name, pages: [[first, last]], topics: [name], entities: [name], references: []}))});
  await finish(index, {review_path: undefined});
  await publish({purpose: 'opening'}, shard([
    {node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: refs(1), properties: {is_entrance: true}},
    {node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: refs(2), summary: 'An old tower.', properties: {is_final: true}},
    {node_id: 'npc-lena', node_kind: 'npc', name: 'Lena', source_refs: refs(1), properties: {}}],
  [claim('scene-dock', 'route-to', 'scene-tower', 1), claim('npc-lena', 'present-in', 'scene-dock', 1)], ['scene-dock', 'npc-lena']),
  ['/nodes/0', '/nodes/1', '/nodes/2', '/claims/0', '/claims/1', '/coverage'], [1, 2]);
  // Pages 3, 40, 41, 70 and 95: the roadhouse's summary is read from page 40.
  await publish({purpose: 'detail', focus: 'Roadhouse', question: ''}, shard([
    {node_id: 'scene-prologue', node_kind: 'scene', name: 'Prologue road', source_refs: refs(3), properties: {}},
    {node_id: 'scene-roadhouse', node_kind: 'scene', name: 'Roadhouse', summary: 'A roadside diner.', source_refs: refs(40), properties: {}},
    {node_id: 'npc-cook', node_kind: 'npc', name: 'Cook', source_refs: refs(41), properties: {}},
    {node_id: 'scene-ending', node_kind: 'scene', name: 'Burnt field', source_refs: refs(70), properties: {}},
    {node_id: 'scene-far', node_kind: 'scene', name: 'Far ranch', source_refs: refs(95), properties: {}}],
  [claim('npc-cook', 'present-in', 'scene-roadhouse', 41), claim('scene-roadhouse', 'route-to', 'scene-far', 41),
    claim('scene-prologue', 'route-to', 'scene-dock', 3)], ['scene-roadhouse']),
  ['/nodes/0', '/nodes/1', '/nodes/2', '/nodes/3', '/nodes/4', '/claims/0', '/claims/1', '/claims/2', '/coverage'], [3, 40, 41, 70, 95]);
  // The roadhouse now cites pages 40 and 41; its summary is still the passage on page 40.
  await publish({purpose: 'detail', focus: 'Roadhouse', question: 'What is on the menu?'}, shard([
    {node_id: 'scene-roadhouse', node_kind: 'scene', name: 'Roadhouse', source_refs: refs(41), properties: {keeper_notes: 'Chili and coffee.'}}], [], ['scene-roadhouse']),
  ['/nodes/0', '/coverage'], [41]);
  return {home, module_id, call, claimJob, finish};
}

/** A summary that differs from the published one, citing `page`. */
const retranscribed = page => shard([{node_id: 'scene-roadhouse', node_kind: 'scene', name: 'Roadhouse', summary: 'A truck stop.', source_refs: refs(page), properties: {}}], [], []);
const UNIT = {section: 'Roadhouse', first: 40, last: 41}, UNIT_QUESTION = 'Prepare the indexed source unit in physical pages 40-41.';

test('§187.5 a source unit of pages 40-41 is handed its pages, window and neighbours, never page 3 nor field_spans', async t => {
  const f = await book(t);
  await f.call('module.read.request', {purpose: 'detail', focus: UNIT.section, question: UNIT_QUESTION, source_unit: UNIT});
  const job = await f.claimJob();
  assert.deepEqual(job.source_unit, UNIT);
  const ids = job.known_nodes.map(node => node.node_id).sort();
  // 40/41's nodes and the window's (Roadhouse and Ending, pages 40-89), the far ranch one route away, the module node.
  assert.deepEqual(ids, [`module-${f.module_id}`, 'npc-cook', 'scene-ending', 'scene-far', 'scene-roadhouse']);
  assert.ok(!ids.includes('scene-prologue'), 'page 3 is outside the job and its window');
  assert.deepEqual(job.known_claims.map(row => `${row.subject_id}>${row.object.node_id}`).sort(), ['npc-cook>scene-roadhouse', 'scene-roadhouse>scene-far']);
  assert.equal(Object.hasOwn(job, 'field_spans'), false);
  assert.deepEqual(job.scope.pages, [40, 41]);
  assert.deepEqual([job.scope.window.first, job.scope.window.last], [40, 89]);
  assert.equal(job.scope.known_nodes, 5);
  assert.equal(job.scope.known_claims, 2);
  assert.ok(job.scope.packet_bytes > 0);
  for (const key of ['visibility', 'truth_status', 'relation_kinds', 'node_kinds', 'actor_dossier']) assert.ok(job.vocabulary[key], key);
  const onDisk = JSON.parse(await readFile(join(job.work_dir, 'packet.json'), 'utf8'));
  assert.equal(Object.hasOwn(onDisk, 'field_spans'), false);
  const view = JSON.parse(await readFile(join(job.work_dir, 'graph-view.json'), 'utf8'));
  assert.ok(view.known_nodes.some(node => node.node_id === 'scene-prologue'), 'the checker\'s view is the whole graph');
  assert.deepEqual(view.field_spans['/nodes/scene-roadhouse/summary'], [{page: 40}]);

  // The real reading service writes task.json and runs the (fake) author; the author runs the real checker on it.
  const cache = join(dirname(job.source.path), 'cache', 'pages'), rows = [], prompts = [], checks = {};
  let task;
  const runtime = {contentRoot: content, async check() { return {ok: true, required_view_pages: [40, 41]}; },
    async sourceInfo() { throw new Error('not a guidance job'); },
    async runTask({request}) {
      prompts.push(request.prompt);
      task = JSON.parse(await readFile(join(request.cwd, 'task.json'), 'utf8'));
      // A pre-policy task, as the same-span suite simulates: under module-logic review a published value is preserved, not judged by span.
      await write(join(request.cwd, 'task.json'), {...task, review_policy: undefined});
      for (const [name, page] of [['another', 41], ['same', 40]]) {
        await write(join(request.cwd, 'draft.json'), retranscribed(page));
        checks[name] = await checkSourceDraft(content, join(request.cwd, 'task.json'), join(request.cwd, 'draft.json'));
      }
      return {ok: false, code: 1, timedOut: false, ms: 1, stderr: 'fixture author stops after checking', command: []};
    }};
  await mkdir(cache, {recursive: true});
  const service = new ReadingService({home: f.home, runtime, call: (method, params) => f.call(method, params),
    model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}), progress() {}, record(row) { rows.push(row); }});
  t.after(() => service.close());
  await service.runJob(job, new AbortController().signal).catch(() => undefined);
  assert.ok(task, 'the author ran');
  assert.equal(Object.hasOwn(task, 'field_spans'), false, 'task.json carries no field_spans');
  assert.deepEqual(task.known_nodes.map(node => node.node_id).sort(), ids);
  // coc-read-check judges by the span the graph recorded (page 40), not the node's references (40 and 41).
  assert.equal(checks.another.ok, false);
  assert.equal(checks.another.error.code, 'needs_choice');
  assert.deepEqual([checks.another.error.details.existing_pages, checks.another.error.details.proposed_pages], [[40], [41]]);
  assert.equal(checks.same.ok, true, JSON.stringify(checks.same));
  assert.ok(checks.same.required_review.includes('/nodes/0/summary'), 'a same-span re-transcription owes its review');
  // §187.5.3: the detail author's instructions carry common, read and detail, not the index phase.
  assert.equal(prompts[0].purpose, 'detail');
  const instructions = await readerInstructionText(content, prompts[0]);
  assert.match(instructions, /## Read phase: detail/);
  for (const absent of ['## Index phase', '## Verify phase', '## Read phase: opening', '## Read phase: skeleton']) assert.ok(!instructions.includes(absent), absent);
  const accounting = rows.find(row => row.event === 'job_accounting');
  assert.ok(accounting, 'the job wrote its accounting row');
  assert.equal(accounting.inlined, true);
  assert.equal(accounting.known_nodes, 5);
  assert.equal(accounting.instruction_bytes, Buffer.byteLength(instructions));
  assert.ok(accounting.packet_bytes > 0 && accounting.packet_bytes < job.scope.packet_bytes + 4096);
});

test('§187.5.1 module.read.finish judges a cut packet by the graph view: another passage refused, the same passage owes review', async t => {
  const f = await book(t);
  await f.call('module.read.request', {purpose: 'detail', focus: UNIT.section, question: UNIT_QUESTION, source_unit: UNIT});
  const job = await f.claimJob();
  assert.equal(Object.hasOwn(JSON.parse(await readFile(join(job.work_dir, 'packet.json'), 'utf8')), 'field_spans'), false);
  await legacy(job);
  await observe(job, [40, 41]);
  await write(join(job.work_dir, 'draft.json'), retranscribed(41));
  await write(join(job.work_dir, 'review.json'), supported(['/nodes/0', '/coverage'], [40, 41]));
  await assert.rejects(f.finish(job), error => error.code === 'needs_choice' && /page\(s\) 40.*page\(s\) 41/.test(error.message));
  await write(join(job.work_dir, 'draft.json'), retranscribed(40));
  await write(join(job.work_dir, 'review.json'), supported(['/coverage'], [40, 41]));
  await assert.rejects(f.finish(job), error => /omitted required fields.*\/nodes\/0\/summary/.test(error.message));
});

test('§187.5.1-§187.5.2 the cut and the scoped vocabulary, unit by unit', async () => {
  const node = (node_id, ...pages) => ({node_id, node_kind: 'scene', source_refs: refs(...pages)});
  const known = [{node_id: 'module-x', node_kind: 'module'}, node('a', 3), node('b', 40), node('c', 41), node('d', 70), node('e', 95), node('f', 96)];
  const relations = [{from_node_id: 'c', to_node_id: 'e'}, {from_node_id: 'e', to_node_id: 'f'}, {from_node_id: 'a', to_node_id: 'module-x'}];
  const claims = [{subject_id: 'c', object: {node_id: 'e'}}, {subject_id: 'e', object: {node_id: 'f'}}, {subject_id: 'a', object: {node_id: 'b'}}];
  const cut = api.scopeGraph(known, claims, relations, [40, 41], {mode: 'pages', first: 40, last: 65}, ['module-x']);
  assert.deepEqual(cut.nodes.map(row => row.node_id), ['module-x', 'b', 'c', 'e'], 'one hop, not two; the module node does not pull its neighbours');
  assert.deepEqual(cut.claims, [claims[0]]);
  assert.deepEqual(api.jobPages({pages: [], visual_scan: {first: 5, last: 7}}), [5, 6, 7]);
  assert.deepEqual(api.jobPages({pages: []}, {source_refs: refs(12), accepted_pages: [50, 52]}), [12, 50, 52]);
  const contract = await api.loadModuleContract({content, snapshots: api.snapshots}), whole = api.vocabulary(contract, null);
  assert.equal(api.scopedVocabulary(whole, {purpose: 'detail', source_unit: UNIT}), whole);
  const visual = api.scopedVocabulary(whole, {purpose: 'detail', visual_asset: {page: 3}});
  assert.equal(visual.actor_dossier, undefined);
  for (const key of ['visibility', 'truth_status', 'relation_kinds', 'node_kinds', 'classification_fields']) assert.deepEqual(visual[key], whole[key], key);
});
