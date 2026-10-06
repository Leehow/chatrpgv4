/**
 * §186.4 through the emitted kernel's publication gate: a coverage verdict carried across a records-only targeted repair
 * is accepted by `module.read.finish` the way a reused fact unit's review is -- its rows are in `review.json`, its
 * reviewer's pages are in `observations.review_pages` -- and the repaired reading publishes.
 *
 * The book is the shared synthetic harbor (index and opening published on the real kernel). A detail read of the Tower
 * drafts the Tower and its warden; round 1's fact reviewer refuses the warden's summary, so the gate refuses the
 * reading; round 2 is the §151.2 targeted repair of that one record. Only the reader and reviewer children are fakes.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appendFile, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {ROOT, harbor} from './harbor-book.mjs';

const tower = {node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], properties: {keeper_notes: 'What the book says of Tower.'}};
const warden = summary => ({node_id: 'npc-warden', node_kind: 'npc', name: 'Warden', summary, source_refs: [{page: 2}], properties: {}});
const draft = summary => ({nodes: [tower, warden(summary)],
  claims: [{subject_id: 'npc-warden', predicate: 'present-in', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: [{page: 2}]}],
  node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-tower']});

test('§186.4 the publication gate accepts a carried coverage verdict and the repaired reading publishes', async t => {
  const f = await harbor(t, 'coverage-carry');
  await f.call('module.read.request', {purpose: 'detail', focus: 'Tower', question: '', foreground: true});
  const job = await f.claim();
  assert.equal(job.purpose, 'detail');
  const cache = join(dirname(job.source.path), 'cache', 'pages');
  const reads = [], units = [], rows = [];
  let calls = 0;
  /** What a reader child that viewed `pages` leaves: the page log, the tool event and the successful delivery. */
  const deliver = async (request, pages) => {
    const call = `call-${++calls}`;
    for (const page of pages)
      await appendFile(join(cache, 'requests.jsonl'), JSON.stringify({file_sha256: job.source.file_sha256, path: join(cache, `page-${page}.png`), page, box: [0, 0, 1, 1]}) + '\n');
    request.onEvent?.({type: 'tool_execution_end', toolCallId: call, isError: false,
      result: {content: [{type: 'image'}], details: {kind: 'source_pages', observations: pages.map(page => ({path: join(cache, `page-${page}.png`), page}))}}});
    await writeFile(request.eventLog + '.images.jsonl', JSON.stringify({delivery: 'succeeded', included: [call]}) + '\n');
  };
  const runtime = {
    contentRoot: join(ROOT, 'content'),
    async check() { return {ok: true, required_view_pages: [2]}; },
    async sourceInfo() { throw new Error('not a guidance job'); },
    async runTask({request}) {
      if (!request.cwd.includes(`/work/${job.job_id}/`)) return {ok: false, code: 1, timedOut: false, ms: 1, stderr: 'not this fixture', command: []};
      const task = JSON.parse(await readFile(join(request.cwd, 'task.json'), 'utf8'));
      if (request.prompt.phase === 'read') {
        reads.push(task);
        // Round 1 misreads the warden; the targeted repair corrects only him.
        await writeFile(join(request.cwd, 'draft.json'), JSON.stringify(draft(reads.length === 1 ? 'The warden owns the harbor.' : 'The warden keeps the lamp.')) + '\n');
        await deliver(request, [2]);
        return {ok: true, code: 0, timedOut: false, ms: 4, stderr: '', command: []};
      }
      units.push(task.required_review);
      const pages = task.review_scope_pages?.length ? task.review_scope_pages : [2];
      await deliver(request, pages);
      await writeFile(join(request.cwd, 'review.json'), JSON.stringify({checked: task.required_review.map(path => ({paths: [path],
        verdict: reads.length === 1 && path === '/nodes/1' ? 'unsupported' : 'supported', source_refs: pages.map(page => ({page})),
        reason: reads.length === 1 && path === '/nodes/1' ? 'Page 2 says the warden keeps the lamp; it names no owner.' : `Page 2 states ${path}.`})), missing: []}) + '\n');
      return {ok: true, code: 0, timedOut: false, ms: 3, stderr: '', command: []};
    },
  };
  const service = new ReadingService({home: f.home, runtime, call: (method, params) => f.client.call(method, params),
    model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}), progress() {}, record(row) { rows.push(row); }});
  t.after(() => service.close());
  const before = (await f.module()).generation;
  await service.runJob(job, new AbortController().signal);
  assert.equal(reads.length, 2, 'the author and one targeted repair');
  assert.equal(reads[1].repair?.kind, 'targeted');
  assert.equal(rows.find(row => row.event === 'repair')?.repair, 'targeted');
  assert.equal(units.filter(paths => paths.includes('/coverage')).length, 1, 'the coverage reviewer ran in round 1 only');
  const carried = rows.find(row => row.phase === 'verify' && row.round === 2 && row.carried_from);
  assert.ok(carried, 'round 2 carried the coverage verdict');
  assert.equal(carried.carried_from.round, 1);
  // The real gate published the repaired reading with the carried row in its review.
  assert.equal((await f.module()).generation, before + 1, 'module.read.finish published');
  const done = (await f.queue()).find(entry => entry.job_id === job.job_id);
  assert.equal(done.state, 'completed');
  const review = JSON.parse(await readFile(join(job.work_dir, 'review.json'), 'utf8'));
  const coverage = review.checked.filter(row => row.paths.includes('/coverage'));
  assert.deepEqual(coverage.map(row => row.carried_from), [carried.carried_from]);
  const graph = JSON.parse(await readFile(join(f.dir, (await f.module()).graph_file), 'utf8'));
  assert.equal(graph.nodes.find(node => node.node_id === 'npc-warden')?.summary, 'The warden keeps the lamp.');
});
