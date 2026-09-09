import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const directory = await mkdtemp(join(tmpdir(), 'pi-coc native locks '));
after(() => rm(directory, {recursive: true, force: true}));
await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
await build({entryPoints: [join(root, 'kernel-ts/native-locks.ts')], outfile: join(directory, 'locks.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const {nativeAdvisoryLocks} = await import(pathToFileURL(join(directory, 'locks.mjs')).href);

async function pythonLock(t, path, mode) {
  const child = spawn('uv', ['run', '--frozen', 'python', '-u', '-c', `
import fcntl, sys
with open(sys.argv[1], 'a+') as handle:
    try:
        fcntl.flock(handle, (fcntl.LOCK_SH if sys.argv[2] == 'shared' else fcntl.LOCK_EX) | fcntl.LOCK_NB)
    except BlockingIOError:
        print('busy', flush=True)
    else:
        print('acquired', flush=True)
        sys.stdin.read()
`, path, mode], {cwd: root, env: {...process.env, UV_NO_SYNC: '1', UV_OFFLINE: '1'}, stdio: ['pipe', 'pipe', 'pipe']});
  const closed = once(child, 'close');
  async function stop() { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; }
  t.after(stop);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({input: child.stdout});
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const [state] = await once(lines, 'line', {signal: controller.signal});
    assert.ok(['busy', 'acquired'].includes(state), stderr);
    return {state, stop};
  } finally { clearTimeout(timeout); lines.close(); }
}

test('Python exclusive locks block TypeScript and process exit releases the same descriptor lock', async t => {
  const path = join(directory, 'python exclusive.lock');
  const python = await pythonLock(t, path, 'exclusive');
  assert.equal(python.state, 'acquired');
  const locks = nativeAdvisoryLocks();
  assert.equal(await locks.acquire(path, 'shared', {nonblocking: true}), null);
  assert.equal(await locks.acquire(path, 'exclusive', {nonblocking: true}), null);
  await python.stop();
  const lease = await locks.acquire(path, 'exclusive', {nonblocking: true});
  assert.ok(lease);
  await lease.release();
  await lease.release();
});

test('TypeScript shared locks coexist with Python shared locks and exclude either writer', async t => {
  const path = join(directory, 'shared.lock');
  const locks = nativeAdvisoryLocks();
  const lease = await locks.acquire(path, 'shared');
  t.after(() => lease.release());
  const shared = await pythonLock(t, path, 'shared');
  assert.equal(shared.state, 'acquired');
  assert.equal((await pythonLock(t, path, 'exclusive')).state, 'busy');
  await lease.release();
  assert.equal(await locks.acquire(path, 'exclusive', {nonblocking: true}), null);
  await shared.stop();
  const writer = await locks.acquire(path, 'exclusive');
  t.after(() => writer.release());
  assert.equal((await pythonLock(t, path, 'shared')).state, 'busy');
  await writer.release();
});

test('blocking lock waiters leave filesystem workers available for the current owner', {timeout: 10000}, async () => {
  const path = join(directory, 'contended.lock');
  const locks = nativeAdvisoryLocks();
  const initial = await locks.acquire(path, 'exclusive');
  let active = 0;
  const pending = Array.from({length: 8}, async (_, index) => {
    const lease = await locks.acquire(path, 'exclusive');
    try {
      assert.equal(active++, 0);
      await writeFile(join(directory, `owner-${index}`), String(index));
      assert.equal(--active, 0);
    } finally { await lease.release(); }
  });
  await delay(30);
  await writeFile(join(directory, 'initial-owner'), 'release');
  await initial.release();
  await Promise.all(pending);
});
