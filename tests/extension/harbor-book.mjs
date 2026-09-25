/**
 * Shared fixture of the reading-resume tests (SL-54, SL-55): a bound synthetic book (111 pages) with a finished index and a
 * published opening on the emitted kernel, real reviewed publications that advance its generation, a checked answer, and a
 * fake reader that writes an answer and supports it. Not a test file.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFile, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRuntime} from '../../runtime/host.ts';
export const ROOT = resolve(import.meta.dirname, '../..');
export const PAGES = 111; // 血色公路's page count
export const sha = value => createHash('sha256').update(value).digest('hex');
export const write = (path, value) => writeFile(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));

/** A bound synthetic book with a finished index and a published opening: Dock (entrance), Tower, Lena at the Dock. */
export async function harbor(t, name) {
  const home = await mkdtemp(join(tmpdir(), `displaced-read-${name}-`));
  const owner = createRuntime({owner: 'preparation', home}, {resourceRoot: ROOT, nodeExecutable: process.execPath});
  t.after(async () => { await owner.close(); await rm(home, {recursive: true, force: true}); });
  const client = owner.openKernel();
  const bytes = Buffer.from(`%PDF-1.7\nsource identity for the displaced-read fixture only (${name})\n`), pdf = join(home, 'fixture.pdf');
  await writeFile(pdf, bytes);
  const {module_id} = await client.call('module.source.bind', {source: {path: pdf, page_count: PAGES, file_sha256: sha(bytes)}});
  const call = (method, params = {}) => client.call(method, {module_id, ...params});
  const f = {home, client, module_id, call,
    dir: join(home, '.coc/modules', module_id),
    queue: async () => JSON.parse(await readFile(join(home, '.coc/modules', module_id, 'deepen-queue.json'), 'utf8')),
    module: async () => JSON.parse(await readFile(join(home, '.coc/modules', module_id, 'module.json'), 'utf8')),
    claim: () => call('module.read.claim', {owner: 'host-test'})};
  await call('module.read.request', {purpose: 'index'});
  const index = await f.claim();
  assert.equal(index.purpose, 'index');
  await observed(index);
  await write(join(index.work_dir, 'draft.json'), {title: 'The Harbor', language: 'en', sections: [
    {name: 'The harbor and the tower', pages: [[1, 2]], topics: ['opening'], entities: ['Dock', 'Tower', 'Lena'], references: []}]});
  await finish(f, index);
  await call('module.read.request', {purpose: 'opening'});
  const opening = await f.claim();
  assert.equal(opening.purpose, 'opening');
  await observed(opening);
  const refs = [{page: 1}];
  await write(join(opening.work_dir, 'draft.json'), {nodes: [
    {node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: refs, properties: {is_entrance: true}},
    {node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], summary: 'An old tower beyond the harbor.', properties: {is_final: true}},
    {node_id: 'npc-lena', node_kind: 'npc', name: 'Lena', source_refs: refs, properties: {mechanics: {profile: {characteristics: {STR: 50}}}}}],
  claims: [['scene-dock', 'route-to', 'scene-tower'], ['npc-lena', 'present-in', 'scene-dock']].map(([subject_id, predicate, object]) =>
    ({subject_id, predicate, object: {node_id: object}, truth_status: 'authored-fact', source_refs: refs})),
  node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock', 'npc-lena']});
  await write(join(opening.work_dir, 'review.json'), {checked: ['/nodes/0', '/nodes/2', '/nodes/2/properties/mechanics/profile/characteristics/STR', '/claims/0', '/claims/1', '/coverage']
    .map(path => ({path, verdict: 'supported', source_refs: refs, reason: 'fixture support'})), missing: []});
  await finish(f, opening);
  return f;
}
export async function observed(job, extra = {}) {
  await write(join(job.work_dir, 'observations.json'), {file_sha256: job.source.file_sha256, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2], ...extra});
}
export const finish = (f, job) => f.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed',
  draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
export const fail = (f, job) => f.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'failed', detail: 'End the fixture job without publishing'});
/** A reviewed detail of `name`'s scene, published through the real gate: the module's generation advances by one. */
export async function detailDraft(job, nodeId, name, page) {
  await observed(job);
  await write(join(job.work_dir, 'draft.json'), {nodes: [{node_id: nodeId, node_kind: 'scene', name, source_refs: [{page}], properties: {keeper_notes: `What the book says of ${name}.`}}],
    claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: [nodeId]});
  await write(join(job.work_dir, 'review.json'), {checked: [{paths: ['/nodes/0', '/coverage'], verdict: 'supported', source_refs: [{page}], reason: 'Source support.'}], missing: []});
}
export async function publishDetail(f, focus, nodeId, page, question = '') {
  await f.call('module.read.request', {purpose: 'detail', focus, question, foreground: true});
  const job = await f.claim();
  assert.equal(job.focus, focus, 'the blocking detail read takes the slot');
  await detailDraft(job, nodeId, focus, page);
  const before = (await f.module()).generation;
  await finish(f, job);
  assert.equal((await f.module()).generation, before + 1, 'a real reviewed publication advanced the generation');
  return job;
}
export const ANSWER = {status: 'answered', answer: 'The harbour master keeps the register of ships at the Dock.', source_refs: [{page: 1}], limitations: ''};
export async function answerDraft(job) {
  const bytes = Buffer.from(JSON.stringify(ANSWER));
  await write(join(job.work_dir, 'draft.json'), bytes);
  await write(join(job.work_dir, 'review.json'), {checked: [{paths: ['/status', '/answer', '/source_refs', '/limitations'], verdict: 'supported',
    source_refs: [{page: 1}], reason: 'Page 1 prints the register.'}], missing: [], draft_sha256: sha(bytes)});
  await write(join(job.work_dir, 'observations.json'), {file_sha256: job.source.file_sha256, read_pages: [1], full_pages: [], review_pages: [1]});
}

/** A fake reader for one answer job: the author writes the draft, the reviewer supports it. Records every phase. */
export function answerRuntime({cache, fileSha, draft, hold}) {
  const tasks = [];
  return {tasks, runtime: {contentRoot: join(ROOT, 'content'), async check() { return {ok: true, required_view_pages: [1]}; },
    async runTask({request}, signal) {
      if (hold && await hold(request, signal)) return {ok: false, code: null, timedOut: false, ms: 1, stderr: '', command: [], error: 'stopped'};
      tasks.push(request);
      const call = `view-${tasks.length}`, page = 1, path = join(cache, 'page-1.png');
      if (request.prompt.phase === 'read') {
        await writeFile(join(request.cwd, 'draft.json'), JSON.stringify(draft) + '\n');
        await appendFile(join(cache, 'requests.jsonl'), JSON.stringify({file_sha256: fileSha, path, page, box: [0, 0, 1, 1]}) + '\n');
      } else {
        const task = JSON.parse(await readFile(join(request.cwd, 'task.json'), 'utf8'));
        await writeFile(join(request.cwd, 'review.json'), JSON.stringify({checked: [{paths: task.required_review, verdict: 'supported', source_refs: [{page}],
          reason: 'The original page supports the answer.'}], missing: []}) + '\n');
      }
      request.onEvent({type: 'tool_execution_end', toolCallId: call, isError: false, result: {content: [{type: 'image'}], details: {kind: 'source_pages', observations: [{path, page}]}}});
      await writeFile(request.eventLog + '.images.jsonl', JSON.stringify({included: [call]}) + '\n');
      return {ok: true, code: 0, timedOut: false, ms: 2, stderr: '', command: []};
    }}};
}

export const until = async (predicate, ms = 30_000) => {
  const deadline = Date.now() + ms;
  while (!(await predicate())) { if (Date.now() > deadline) assert.fail('timed out waiting'); await new Promise(done => setTimeout(done, 25)); }
};
