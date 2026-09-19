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
  candidates: {static: candidates},
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
  const skipped = await api.rankWorkspaceCandidates({query: 'anything', candidates: candidates.slice(0, 8), ranker: async () => {
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
