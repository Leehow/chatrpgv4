import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(root, '.coc', 'workspace-rerank-suite-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `
export * from './extensions/table/workspace/reranker.ts';
export * from './extensions/table/workspace/projection.ts';
`, resolveDir: root, sourcefile: 'workspace-rerank-api.ts'}, outfile: join(temporary, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const candidates = Array.from({length: 10}, (_, index) => ({locator: `scene:${String(index).padStart(2, '0')}`, kind: 'scene', text: `A verified scene reference ${index}`, authority: 'module_source', coverage: 'complete', scope: {campaign: 'c1', worldline: 'main', loop: 0}}));
const binding = {version: 1, campaign: 'c1', worldline: 'main', loop: 0, turn: 4, source_revision: 'a'.repeat(64),
  memory_coverage: {committed: 4, completed: 4, gaps: 0}};
const snapshot = {
  version: 1, status: 'valid', binding: {...binding, stateStamp: 'b'.repeat(64), generation: 1},
  authority: {checked: true, allowed: ['module_source', 'campaign_adaptation', 'table_record']},
  coverage: {static: {status: 'complete', omitted: 0}, records: {status: 'complete', omitted: 0}},
  candidates: {static: candidates.map(row => ({...row, source_revision: binding.source_revision}))},
  manifest: {static: candidates.slice(0, 2), records: [], truncated: true},
};

test('rerank orders a wide host candidate pool and caches the exact query/candidate list', async () => {
  let calls = 0;
  const ranker = async (_query, documents) => {
    calls++;
    return {provider: 'test', model: 'test-v1', results: documents.map((_, index) => ({index: documents.length - index - 1, score: index}))};
  };
  const first = await api.rankWorkspaceCandidates({query: 'where did the party go?', candidates, ranker});
  assert.equal(first.status, 'ranked');
  assert.deepEqual(first.order.slice(0, 3), ['scene:09', 'scene:08', 'scene:07']);
  const second = await api.rankWorkspaceCandidates({query: 'where did the party go?', candidates, ranker});
  assert.equal(second.status, 'cache');
  assert.equal(calls, 1, 'same list/query does not call the provider twice');
});

test('invalid rerank output falls back to deterministic order without scores in projection', async () => {
  const result = await api.rankWorkspaceCandidates({query: 'find the desk', candidates,
    ranker: async () => ({results: [{index: 999, score: 1}]})});
  assert.equal(result.status, 'fallback');
  assert.equal(result.reason, 'invalid_result');
  assert.deepEqual(result.order, candidates.map(candidate => candidate.locator));
  const selected = api.selectWorkspace({snapshot, binding, budget: 24 * 1024, rankedLocators: result.order});
  assert.equal(selected.status, 'selected');
  const content = JSON.parse(selected.message.content);
  assert.ok(Array.isArray(content.evidence), JSON.stringify(content));
  assert.equal('score' in content.evidence[0], false);
  assert.deepEqual(content.evidence.slice(0, 2).map(row => row.locator), ['scene:00', 'scene:01']);
});

test('small candidate pools skip rerank and a deadline falls back', async () => {
  const skipped = await api.rankWorkspaceCandidates({query: 'anything', candidates: candidates.slice(0, 1), ranker: async () => {
    throw new Error('must not run');
  }});
  assert.deepEqual(skipped, {status: 'skipped', reason: 'too_few_candidates'});
  const timed = await api.rankWorkspaceCandidates({query: 'anything', candidates,
    timeoutMs: 10, ranker: (_query, _docs, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})), {once: true});
    })});
  assert.equal(timed.status, 'fallback');
  assert.equal(timed.reason, 'timeout');
});

test('a non-cooperative adapter cannot hold the request past the host deadline', async () => {
  const began = Date.now();
  const result = await api.rankWorkspaceCandidates({query: 'non-cooperative request', candidates, timeoutMs: 15,
    ranker: () => new Promise(() => {})});
  assert.equal(result.status, 'fallback');
  assert.ok(Date.now() - began < 1000);
});

test('cancelled late success cannot populate the rank cache', async () => {
  const controller = new AbortController();
  let finish;
  const query = 'cancel this old generation';
  const pending = api.rankWorkspaceCandidates({query, candidates, signal: controller.signal,
    ranker: () => new Promise(resolve => {finish = resolve;})});
  controller.abort();
  assert.equal((await pending).status, 'fallback');
  finish({results: candidates.map((_, index) => ({index, score: 1}))});
  await new Promise(resolve => setImmediate(resolve));
  let calls = 0;
  const current = await api.rankWorkspaceCandidates({query, candidates,
    ranker: async () => {calls++; return {results: [{index: 0, score: 1}]};}});
  assert.equal(current.status, 'ranked');
  assert.equal(calls, 1);
});

test('the UTF-8 input budget includes the unchanged query and all documents', async () => {
  const oversized = '🧭'.repeat(13000);
  let calls = 0;
  const skipped = await api.rankWorkspaceCandidates({query: oversized, candidates,
    ranker: async () => {calls++; return {results: []};}});
  assert.deepEqual(skipped, {status: 'skipped', reason: 'query_over_budget'});
  assert.equal(calls, 0);
  const query = '🧭'.repeat(2000), long = Array.from({length: 48}, (_, index) => ({locator: `entry:${index}`, text: '🧭'.repeat(2000)}));
  const result = await api.rankWorkspaceCandidates({query, candidates: long, ranker: async (actual, documents) => {
    assert.equal(actual, query);
    assert.ok(documents.every(document => Buffer.byteLength(document, 'utf8') <= 2048));
    assert.ok(Buffer.byteLength(JSON.stringify({query: actual, documents}), 'utf8') <= 48 * 1024);
    return {results: documents.map((_, index) => ({index, score: 1}))};
  }});
  assert.equal(result.status, 'ranked');
});
