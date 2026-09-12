import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, symlink, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';
import {KernelClient} from '../../extensions/kernel/client.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), CONTENT = join(ROOT, 'content');
const evidence = join(ROOT, '.coc/playtests/cash-decimal-contracts');
await mkdir(evidence, {recursive: true});
const suite = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(suite, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
const environment = () => ({...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0', GIT_AUTHOR_DATE: '2000-01-02T03:04:05Z', GIT_COMMITTER_DATE: '2000-01-02T03:04:05Z',
  COC_TEST_CLOCK: '2000-01-02T03:04:05Z', NODE_OPTIONS: `--require ${JSON.stringify(join(ROOT, 'tests/kernel/rpc_clock.cjs'))}`, TZ: 'UTC'});

async function rawCall(rpc, home, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [rpc, '--workspace', home, '--content', CONTENT], {cwd: ROOT, env: environment(), stdio: ['pipe', 'pipe', 'pipe']});
    let output = '', errors = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      const line = output.indexOf('\n');
      if (line < 0) return;
    });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      const line = output.indexOf('\n');
      if (line < 0) { reject(new Error(`raw kernel exited ${code}: ${errors}`)); return; }
      try { resolve(JSON.parse(output.slice(0, line))); } catch (error) { reject(error); }
    });
    child.stdin.end(`${request}\n`);
  });
}

test('cash accepts exact decimal deltas, persists/replays them, and refuses invalid or overdraft batches atomically', async t => {
  const temporary = await mkdtemp(join(suite, 'case-')), rpc = join(temporary, 'rpc.mjs'), apiPath = join(temporary, 'cash.mjs');
  await symlink(join(ROOT, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  await build({entryPoints: [join(ROOT, 'kernel-ts/rpc.ts')], outfile: rpc, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
  await build({stdin: {contents: `export * from ${JSON.stringify(join(ROOT, 'kernel-ts/apply/cash.ts'))};`, resolveDir: ROOT, sourcefile: 'cash-decimal-api.ts'}, outfile: apiPath, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
  const cash = await import(pathToFileURL(apiPath).href);
  assert.equal(cash.cashStorage(cash.addCash(cash.cashDecimal(9007199254740993n), cash.cashDecimal(7n))), 9007199254741000n, 'legacy bigint-only cash remains bigint');

  const home = await mkdtemp(join(temporary, 'workspace-'));
  const client = new KernelClient({command: [process.execPath, rpc, '--workspace', home, '--content', CONTENT], cwd: ROOT, env: environment(), inheritEnv: false, timeoutMs: 20_000});
  t.after(() => client.close());
  await client.call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await client.call('table.open', {campaign: 'c1'});
  await client.call('table.narrate', {campaign: 'c1', call_id: 't0-c1', text: 'The investigation begins.'});
  await client.call('table.player_input', {campaign: 'c1', text: 'I pay, then receive change.'});
  const cashReceipts = async () => (await client.call('table.status', {campaign: 'c1'})).receipts.filter(row => row.kind === 'cash');

  const paid = await client.call('table.apply', {campaign: 'c1', call_id: 't1-c1', effects: [{kind: 'cash', delta: -2.50}]});
  assert.deepEqual(paid.receipts, ['cash:t1-c1']);
  assert.deepEqual((await cashReceipts()).map(row => [row.before, row.delta, row.after]), [[50, -2.5, 47.5]]);
  const persistedAfterDebit = await readFile(join(home, '.coc/campaigns/c1/party/thomas-hayes.json'), 'utf8');
  const replay = await client.call('table.apply', {campaign: 'c1', call_id: 't1-c1', effects: [{kind: 'cash', delta: -2.50}]});
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.receipts, ['cash:t1-c1']);
  assert.equal(await readFile(join(home, '.coc/campaigns/c1/party/thomas-hayes.json'), 'utf8'), persistedAfterDebit, 'a replay does not write a second debit');

  const refunded = await client.call('table.apply', {campaign: 'c1', call_id: 't1-c2', effects: [{kind: 'cash', delta: 0.50}]});
  assert.deepEqual(refunded.receipts, ['cash:t1-c2']);
  const refundReceipt = (await cashReceipts()).at(-1);
  assert.deepEqual(Object.fromEntries(['before', 'delta', 'after', 'currency'].map(key => [key, refundReceipt[key]])), {before: 47.5, delta: 0.5, after: 48, currency: 'USD'});
  const tenths = await client.call('table.apply', {campaign: 'c1', call_id: 't1-c3', effects: [{kind: 'cash', delta: 0.1}, {kind: 'cash', delta: 0.2}]});
  assert.deepEqual(tenths.receipts, ['cash:t1-c3', 'cash:t1-c3-2']);
  assert.deepEqual((await cashReceipts()).slice(-2).map(row => [row.before, row.delta, row.after]), [[48, 0.1, 48.1], [48.1, 0.2, 48.3]]);
  const persisted = await readFile(join(home, '.coc/campaigns/c1/party/thomas-hayes.json'), 'utf8');
  assert.match(persisted, /"amount": 48\.3/);
  assert.doesNotMatch(persisted, /48\.30000000000000/);

  const beforeRejected = persisted;
  await assert.rejects(client.call('table.apply', {campaign: 'c1', call_id: 't1-c4', effects: [{kind: 'cash', delta: 1}, {kind: 'cash', delta: -1000}]}), error => error.code === 'invalid_params');
  assert.equal(await readFile(join(home, '.coc/campaigns/c1/party/thomas-hayes.json'), 'utf8'), beforeRejected, 'an overdraft rejects the whole staged batch');
  await assert.rejects(client.call('table.apply', {campaign: 'c1', call_id: 't1-c5', effects: [{kind: 'cash', delta: 0}]}), error => error.code === 'invalid_params');

  await client.close();
  const unrepresentable = await rawCall(rpc, home, '{"id":"unrepresentable","method":"table.apply","params":{"campaign":"c1","call_id":"t1-c6","effects":[{"kind":"cash","delta":9007199254740993}]}}');
  assert.equal(unrepresentable.ok, false); assert.equal(unrepresentable.error.code, 'invalid_params');
  assert.equal(await readFile(join(home, '.coc/campaigns/c1/party/thomas-hayes.json'), 'utf8'), beforeRejected, 'an unrepresentable fractional result makes no write');
  for (const [id, literal] of [['nan', 'NaN'], ['infinity', 'Infinity'], ['negative-infinity', '-Infinity']]) {
    const result = await rawCall(rpc, home, `{"id":${JSON.stringify(id)},"method":"table.apply","params":{"campaign":"c1","call_id":"t1-c-${id}","effects":[{"kind":"cash","delta":${literal}]}}}`);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'invalid_params');
  }
  assert.equal(await readFile(join(home, '.coc/campaigns/c1/party/thomas-hayes.json'), 'utf8'), beforeRejected, 'nonfinite values make no write');
});
