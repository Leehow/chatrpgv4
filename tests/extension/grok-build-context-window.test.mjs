// The Grok Build catalog lists a 256K context window that the endpoint does not
// enforce (probed 2026-09-29: 267K accepted, >500K refused on every model), so
// the provider must report the served 500K or Pi compacts at half the window.
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

import {
  GROK_BUILD_SERVED_CONTEXT_WINDOW,
  loadGrokBuildCatalog,
  parseGrokBuildCatalog,
} from '../../extensions/grok-build-oauth/agent/catalog.js';

const row = (model, contextWindow) => ({
  model, name: model, api_backend: 'responses', context_window: contextWindow,
  supports_reasoning_effort: true, reasoning_efforts: [{id: 'low', value: 'low'}], supports_backend_search: true,
});

test('catalog rows report the served window, never the smaller listed budget', () => {
  const models = parseGrokBuildCatalog({data: [row('grok-4.7', 256000), row('grok-future', 2_000_000)]});
  assert.equal(GROK_BUILD_SERVED_CONTEXT_WINDOW, 500000);
  assert.deepEqual(models.map((m) => [m.id, m.contextWindow]), [['grok-4.7', 500000], ['grok-future', 2_000_000]]);
});

test('the online catalog path (fetch, cache, re-read) carries the served window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grok-build-ctx-'));
  const offline = process.env.PI_OFFLINE;
  // This case exercises only its injected in-memory fetch, even when the suite is launched offline.
  delete process.env.PI_OFFLINE;
  try {
    const authPath = join(dir, 'auth.json');
    const access = `h.${Buffer.from(JSON.stringify({iss: 'https://auth.x.ai', sub: 'u', client_id: 'c'})).toString('base64url')}.s`;
    await writeFile(authPath, JSON.stringify({'grok-build': {type: 'oauth', access, refresh: 'r', expires: Date.now() + 3_600_000}}));
    const fetchImpl = async () => new Response(JSON.stringify({data: [row('grok-4.5', 256000), row('grok-4.6', 256000)]}), {status: 200});
    const online = await loadGrokBuildCatalog({authPath, cacheDir: dir, fetchImpl, force: true});
    assert.deepEqual(online.map((m) => [m.id, m.contextWindow]), [['grok-4.5', 500000], ['grok-4.6', 500000]]);
    const cached = await loadGrokBuildCatalog({authPath, cacheDir: dir, fetchImpl: async () => { throw new Error('cache must answer'); }});
    assert.deepEqual(cached.map((m) => m.contextWindow), [500000, 500000]);
  } finally {
    if (offline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = offline;
    await rm(dir, {recursive: true, force: true});
  }
});
