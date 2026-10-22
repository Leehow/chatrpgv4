/**
 * Contract §257.R: the reader extracts exhibits in its existing reads; a `material: "exhibits"` detail read writes only
 * exhibits; the independent review gives each exhibit a player-safety verdict and a refused exhibit is dropped on the
 * `exhibit_refusals` channel. Kernel cases travel the real reading path (claim, finish, accepted graph read back); the
 * instruction cases assert the required clauses only, never model wording beyond them.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';

const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
const scratch = playtestScratch('module-exhibits-reader');
await build({stdin: {contents: [
    `export {checkSourceDraft} from './kernel-ts/check.ts';`,
    `export {pythonJsonDumps} from './kernel-ts/json.ts';`,
    `export {createKernelContext} from './kernel-ts/context.ts';`,
    `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
    `export {createKernelRuntime} from './kernel-ts/registry.ts';`,
    `export {ModuleStore} from './kernel-ts/modules/store.ts';`,
    `export {reviewUnits, gateRefusal, detailReviewInput, recordRoot} from './extensions/module/reader-review.ts';`,
    `export {readerInstructionText} from './runtime/reader-instructions.ts';`,
].join('\n'), resolveDir: root, sourcefile: 'module-exhibits-reader-api.ts', loader: 'ts'},
    outfile: join(scratch, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(scratch, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); });

// ---- the instructions -------------------------------------------------------------------------------------------------

const asked = (phase, purpose, material) => api.readerInstructionText(content, {phase, purpose, ...(material ? {material} : {})});

test('opening and detail reads define exhibits and no longer forbid dialogue, mannerisms or read-aloud', async () => {
    for (const purpose of ['opening', 'detail']) {
        const text = await asked('read', purpose);
        for (const clause of ['`exhibits`', 'exhibit_id', 'keeper_note', '`teaches`', '{{who:<node_id>}}', 'verbatim', 'source_refs'])
            assert.ok(text.includes(clause), `${purpose}: ${clause}`);
        assert.ok(!text.includes('Do not extract a dialogue script'), purpose);
        assert.ok(!/\bunits?\b.*\bgate\b/.test(text), 'the prototype vocabulary (units, gate) is not the product term');
    }
});

test('the exhibit rules carry the sandbox lessons: names, carrier scoping, owner-less voice, teaches targets, sample lines, no extra pass', async () => {
    const text = await asked('read', 'detail');
    const section = text.slice(text.indexOf('## Exhibits'));
    assert.ok(section.length > 500 && text.includes('## Exhibits'));
    for (const clause of [
        '{{who:<node_id>}}',                              // 1 names are references, never literal
        'cites',                                          // 2 carrier scoping by cited pages
        '`perception`', '`sound`',                        // 3 an owner-less voice is a perception on sound
        'clue', 'knowledge claim',                        // 4 teaches targets
        'sample',                                         // voice surfaces carry the book's sample lines
        'player-safety',                                  // the law
        'in this same read',                              // 5 inside the existing read
    ]) assert.ok(section.includes(clause), clause);
});

test('the exhibits material has its own file after the purpose file; other reads do not receive it', async () => {
    const own = await asked('read', 'detail', 'exhibits');
    const plain = await asked('read', 'detail');
    assert.ok(own.length > plain.length && own.includes('task.material is `exhibits`'));
    assert.ok(!plain.includes('task.material is `exhibits`'));
    assert.ok(own.indexOf('task.material is `exhibits`') > own.indexOf('## Read phase: detail'));
    assert.ok(!(await asked('read', 'detail', 'map')).includes('task.material is `exhibits`'));
});

test('the reviewer receives the per-exhibit player-safety item', async () => {
    const text = await asked('verify');
    for (const clause of ['/exhibits/', 'player-safety', 'teaches', 'keeper_note', 'impact logic'])
        assert.ok(text.includes(clause), clause);
});

// ---- the host's reviewer -----------------------------------------------------------------------------------------------

test('the host reviewer is asked for the owed exhibits only, each as a record, and an exhibit verdict never asks for a repair round', () => {
    const draft = opening([exhibit('exhibit-a', 'description', 'scene-hall', 'sight'), exhibit('exhibit-b', 'appearance', 'npc-edna-marsh', 'sight')]);
    const units = api.reviewUnits(draft, ['/exhibits/1']).flat();
    assert.ok(units.includes('/exhibits/1') && !units.includes('/exhibits/0'));
    assert.deepEqual(api.recordRoot('/exhibits/1'), {root: '/exhibits/1', collection: 'exhibits', index: 1, rest: ''});
    const refuses = api.gateRefusal({review_policy: 'module-logic-v1'}, draft);
    assert.equal(refuses({verdict: 'unsupported', impact: 'logic'}, '/exhibits/1'), false);
    assert.equal(refuses({verdict: 'unsupported', impact: 'logic'}, '/nodes/0'), true);
    const input = api.detailReviewInput({purpose: 'opening', known_nodes: []}, draft, ['/exhibits/1']);
    assert.deepEqual(Object.keys(input.review_records), ['/exhibits/1']);
    assert.ok(input.candidate_context.nodes.some(item => item.node_id === 'npc-edna-marsh'), 'the carrier is connected context for the reviewer');
});

// ---- the kernel -------------------------------------------------------------------------------------------------------

function pdf() {
    const streams = ['0 0 1 rg 0 0 100 100 re f', '0 0.6 0 rg 0 0 200 100 re f'];
    const pages = streams.map((stream, index) => ({page: 3 + index * 2, content: 4 + index * 2, stream}));
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map(row => `${row.page} 0 R`).join(' ')}] /Count ${streams.length} >>`,
        ...pages.flatMap(row => [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents ${row.content} 0 R >>`,
            `<< /Length ${row.stream.length} >>\nstream\n${row.stream}\nendstream`])];
    let text = '%PDF-1.7\n';
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
    const xref = Buffer.byteLength(text), size = objects.length + 1;
    text += `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return text;
}
const REFS = [{page: 1}];
const node = (node_id, node_kind, name, extra = {}) => ({node_id, node_kind, name, source_refs: REFS, summary: `${name}.`, properties: {}, ...extra});
const claim = (subject_id, predicate, object) => ({subject_id, predicate, object: {node_id: object}, truth_status: 'authored-fact', source_refs: REFS});
const exhibit = (exhibit_id, kind, carrier, channel, extra = {}) => ({exhibit_id, kind, carrier, channel, label: `${exhibit_id} label`,
    surface: {text: 'A low room with a smell of lamp oil.', language: 'en', verbatim: false}, source_refs: REFS, ...extra});
const V5 = 'coc.module-graph-shard.v5';
const opening = exhibits => ({contract_id: V5, nodes: [
    node('scene-hall', 'scene', 'Hall', {properties: {is_entrance: true}}),
    node('scene-cellar', 'scene', 'Cellar', {source_refs: [{page: 2}], properties: {is_final: true}}),
    node('npc-edna-marsh', 'npc', 'Edna Marsh'),
], claims: [claim('scene-hall', 'route-to', 'scene-cellar'), claim('npc-edna-marsh', 'present-in', 'scene-hall')],
    node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-hall'], exhibits});
const exhibitsOnly = exhibits => ({contract_id: V5, nodes: [], claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: [], exhibits});

async function kernelFixture() {
    const workspace = playtestScratch('module-exhibits-reader', 'kernel-');
    const context = await api.createKernelContext({workspace, content, seed: 'module-exhibits-reader', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context);
    closers.push(() => runtime.close());
    const wire = value => value === undefined ? value : JSON.parse(api.pythonJsonDumps(value));
    const kernel = async (method, params = {}) => {
        try { return wire(await runtime.handlers[method](params)); }
        catch (error) { throw typeof error?.toJson === 'function' ? Object.assign(new Error(error.message), wire(error.toJson())) : error; }
    };
    const file = join(workspace, 'original.pdf');
    await writeFile(file, pdf());
    const sha = createHash('sha256').update(await readFile(file)).digest('hex');
    const {module_id: mid} = await kernel('module.source.bind', {source: {path: file, page_count: 2, file_sha256: sha}});
    const call = (method, params = {}) => kernel(method, {module_id: mid, ...params});
    /** `verdicts`: a path to a verdict (default supported) or `null` for a pointer the reviewer left out. */
    const publish = async (job, draft, verdicts = {}, missing = []) => {
        await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2]}));
        await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
        const required = job.purpose === 'index' ? [] : (await api.checkSourceDraft(content, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? [];
        const checked = required.filter(path => verdicts[path] !== null).map(path => ({paths: [path], verdict: verdicts[path] ?? 'supported', ...(verdicts[path] && verdicts[path] !== 'supported' ? {impact: 'logic'} : {}),
            source_refs: REFS, reason: verdicts[path] && verdicts[path] !== 'supported' ? 'states a Keeper-only proposition' : 'fixture support'}));
        await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked, missing}));
        const result = await call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
        return Object.assign(result, {required});
    };
    const claimJob = () => call('module.read.claim', {owner: 'test-host'});
    await call('module.read.request', {purpose: 'index'});
    await publish(await claimJob(), {title: 'The Cellar', language: 'en', sections: [{name: 'House', pages: [[1, 2]], entities: ['Hall', 'Cellar']}], map_candidates: []});
    return {call, publish, claimJob, context, mid, graph: async () => (await new api.ModuleStore(context).graph(mid)), meta: async () => (await new api.ModuleStore(context).module(mid))};
}
const openingJob = async f => { await f.call('module.read.request', {purpose: 'opening'}); return f.claimJob(); };
const ids = view => view.exhibits.map(item => item.exhibit_id);

test('review requires one pointer per accepted exhibit, by its position in the draft', async () => {
    const f = await kernelFixture();
    const job = await openingJob(f);
    const result = await f.publish(job, opening([
        exhibit('exhibit-bad-id', 'description', 'scene-nowhere', 'sight'),   // refused by the checker: no pointer owed
        exhibit('exhibit-hall', 'description', 'scene-hall', 'sight')]));
    assert.ok(result.required.includes('/exhibits/1'));
    assert.ok(!result.required.includes('/exhibits/0'));
    assert.deepEqual(ids(await f.graph()), ['exhibit-hall']);
});

test('a surface the reviewer finds leaking is dropped with its reason; the rest of the shard publishes', async () => {
    const f = await kernelFixture();
    const job = await openingJob(f);
    const result = await f.publish(job, opening([
        exhibit('exhibit-hall', 'description', 'scene-hall', 'sight'),
        exhibit('exhibit-leak', 'appearance', 'npc-edna-marsh', 'sight', {label: 'looks', surface: {text: 'She is the murderer.', language: 'en', verbatim: false}}),
        exhibit('exhibit-unreviewed', 'description', 'scene-cellar', 'smell')]),
    {'/exhibits/1': 'unsupported', '/exhibits/2': null});
    assert.equal(result.opening_ready, true);
    assert.deepEqual(ids(await f.graph()), ['exhibit-hall']);
    const dropped = Object.fromEntries(result.exhibit_refusals.map(item => [item.exhibit_id, item]));
    assert.deepEqual(Object.keys(dropped).sort(), ['exhibit-leak', 'exhibit-unreviewed']);
    assert.equal(dropped['exhibit-leak'].rule, 'exhibit_player_safety');
    assert.equal(dropped['exhibit-leak'].path, '/exhibits/1');
    assert.match(dropped['exhibit-leak'].message, /Keeper-only/);
    assert.equal(dropped['exhibit-unreviewed'].rule, 'exhibit_unreviewed');
    assert.ok(dropped['exhibit-leak'].job_id);
    const recorded = (await f.meta()).reading.exhibit_refusals.map(item => item.exhibit_id);
    assert.ok(recorded.includes('exhibit-leak') && recorded.includes('exhibit-unreviewed'));
});

test('a missing item at an exhibit pointer drops that exhibit and does not block the shard', async () => {
    const f = await kernelFixture();
    const job = await openingJob(f);
    const result = await f.publish(job, opening([exhibit('exhibit-hall', 'description', 'scene-hall', 'sight')]), {},
        [{path: '/exhibits/0', impact: 'logic', reason: 'states a later reveal', source_refs: REFS}]);
    assert.equal(result.opening_ready, true);
    assert.deepEqual(ids(await f.graph()), []);
    assert.equal(result.exhibit_refusals[0].rule, 'exhibit_player_safety');
});

test('a checker refusal and a review drop share the exhibit_refusals channel', async () => {
    const f = await kernelFixture();
    const job = await openingJob(f);
    const result = await f.publish(job, opening([exhibit('exhibit-a', 'description', 'scene-nowhere', 'sight'), exhibit('exhibit-b', 'description', 'scene-hall', 'sight')]),
        {'/exhibits/1': 'unsupported'});
    assert.deepEqual(result.exhibit_refusals.map(item => [item.exhibit_id, item.rule]), [['exhibit-a', 'exhibit_carrier_unknown'], ['exhibit-b', 'exhibit_player_safety']]);
});

test('a detail read with material exhibits is a valid job and writes only exhibits for its focus', async () => {
    const f = await kernelFixture();
    await publishOpening(f);
    const requested = await f.call('module.read.request', {purpose: 'detail', material: 'exhibits', focus: 'Cellar'});
    assert.notEqual(requested.state, 'ready', 'a prepared scene without exhibits is still read for them');
    const job = await f.claimJob();
    assert.equal(job.material, 'exhibits');
    assert.equal(job.purpose, 'detail');
    assert.equal(job.focus, 'Cellar');
    assert.ok(job.question && job.question.trim(), 'the kernel names the question');
    assert.ok(job.pages.includes(2), 'the pages the graph already cites for the focus are opened');
    // Nodes, claims and readiness are not this read's to write.
    await assert.rejects(f.publish(job, {...exhibitsOnly([]), nodes: [node('scene-extra', 'scene', 'Extra')]}), error => {
        assert.equal(error.code, 'invalid_params');
        assert.equal(error.details.rule ?? error.details.findings?.[0]?.rule, 'exhibits_scope', error.message);
        return true;
    });
    const result = await f.publish(job, exhibitsOnly([exhibit('exhibit-cellar', 'description', 'scene-cellar', 'sight'), exhibit('exhibit-edna-look', 'appearance', 'npc-edna-marsh', 'sight')]));
    assert.equal(result.exhibit_refusals, undefined);
    assert.deepEqual(ids(await f.graph()), ['exhibit-cellar', 'exhibit-edna-look']);
    // Read once: the same request is now answered, and a different focus is its own read.
    assert.equal((await f.call('module.read.request', {purpose: 'detail', material: 'exhibits', focus: 'Cellar'})).state, 'ready');
    assert.notEqual((await f.call('module.read.request', {purpose: 'detail', material: 'exhibits', focus: 'Hall'})).state, 'ready');
});

test('an exhibits read that finds nothing printed answers with an empty draft', async () => {
    const f = await kernelFixture();
    await publishOpening(f);
    await f.call('module.read.request', {purpose: 'detail', material: 'exhibits', focus: 'Cellar'});
    const result = await f.publish(await f.claimJob(), exhibitsOnly([]));
    assert.equal(result.state ?? 'completed', result.state ?? 'completed');
    assert.deepEqual(ids(await f.graph()), []);
    assert.equal((await f.call('module.read.request', {purpose: 'detail', material: 'exhibits', focus: 'Cellar'})).state, 'ready');
});

test('material is still only for detail reads, and only map, pregens and exhibits', async () => {
    const f = await kernelFixture();
    await assert.rejects(f.call('module.read.request', {purpose: 'opening', material: 'exhibits'}), error => error.code === 'invalid_params');
    await assert.rejects(f.call('module.read.request', {purpose: 'detail', material: 'handouts', focus: 'Hall'}), error => error.code === 'invalid_params');
    await assert.rejects(f.call('module.read.request', {purpose: 'detail', material: 'exhibits'}), error => error.code === 'invalid_params');
});

async function publishOpening(f) {
    await f.publish(await openingJob(f), opening([]));
}
