import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256} from './core.mjs';

const runner = fileURLToPath(new URL('./run.mjs', import.meta.url));
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-preflight-mechanical-test-'));
  t.after(() => fs.rm(home, {recursive: true, force: true}));
  const corpus = JSON.stringify({sha256: 'fixture-source', pages: [{page: 1, text: 'A purely mechanical fixture with sufficient native-text length.'}]});
  const cases = {source_sha256: 'fixture-source', corpus_sha256: sha256(corpus), cases: [{id: 'fixture', query: 'A fixture question', context: 'Not gameplay or a semantic result.', origin: 'mechanical-test-only', requirements: [], expectedStatus: 'unsupported'}]};
  await fs.writeFile(path.join(home, 'corpus.json'), corpus);
  await fs.writeFile(path.join(home, 'cases.json'), JSON.stringify(cases));
  const env = {...process.env};
  delete env.TYPESAFE_API_KEY;
  delete env.EXT_JEV_APIKEY;
  return {home, run: extra => spawnSync(process.execPath, [runner, '--corpus', path.join(home, 'corpus.json'), '--cases', path.join(home, 'cases.json'), '--out', path.join(home, 'results'), ...extra], {encoding: 'utf8', env})};
}

test('describe is offline and creates no run directory', async t => {
  const {home, run} = await fixture(t);
  const result = run(['--describe']);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.provider_calls, 0);
  assert.equal(value.total_requests, 3);
  assert.equal(value.expectations_sent, false);
  await assert.rejects(fs.stat(path.join(home, 'results')), {code: 'ENOENT'});
});

test('missing credential refuses before creating a live evidence directory', async t => {
  const {home, run} = await fixture(t);
  const result = run([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Live measurement requires shared Jev credentials/);
  await assert.rejects(fs.stat(path.join(home, 'results')), {code: 'ENOENT'});
});

test('invalid concurrency and source mismatch are rejected offline', async t => {
  const {home, run} = await fixture(t);
  assert.notEqual(run(['--describe', '--concurrency', '4,4']).status, 0);
  await fs.appendFile(path.join(home, 'corpus.json'), '\n');
  const mismatch = run(['--describe']);
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /does not match the frozen evaluation source/);
});
