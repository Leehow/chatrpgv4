import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = mkdtempSync(join(tmpdir(), 'pi-coc-test-selection-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let sequence = 0;
function run(changed, args = ['--json'], env = {}) {
  const list = join(scratch, `changed-${sequence++}`);
  writeFileSync(list, changed.join('\n'));
  return spawnSync(process.execPath, ['scripts/select-tests.mjs', '--changed', list, ...args],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
}
function select(changed) {
  const result = run(changed);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const suites = ['tests/kernel', 'tests/play'];

test('independent Python tests select only their files and keep both extension smoke tests', () => {
  const paths = ['tests/kernel/test_resolve.py', 'tests/kernel/test_capsule_nine.py'];
  const result = select(paths);
  assert.equal(result.full, false);
  assert.equal(result.py, true);
  assert.deepEqual(result.py_files, [...paths].sort());
  for (const smoke of ['tests/extension/ts-kernel-foundation.test.mjs', 'tests/extension/control-flow-inventory.test.mjs'])
    assert.ok(result.ext.includes(smoke));
});

test('shared fixtures, helpers, deleted tests, runtime code and unknown impact keep both Python suites', () => {
  for (const path of ['tests/kernel/conftest.py', 'tests/kernel/kernel_pool.py', 'tests/kernel/test_rules_families.py',
    'tests/kernel/test_missing_selector_probe.py', 'kernel-ts/json.ts', 'pyproject.toml', `unplaced-${process.pid}.dat`]) {
    assert.deepEqual(select([path]).py_files, suites, path);
  }
});

test('documentation and an empty change do not start pytest', () => {
  for (const changed of [[], ['docs/kernel-rpc.md']]) {
    const result = select(changed);
    assert.equal(result.py, false);
    assert.deepEqual(result.py_files, []);
  }
});

test('the local runner passes selected files, preserves exit status and skips an empty selection', () => {
  const log = join(scratch, 'uv-args');
  writeFileSync(join(scratch, 'uv'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$SELECTOR_ARG_LOG"\nexit 7\n', { mode: 0o755 });
  const env = { PATH: scratch + ':' + process.env.PATH, SELECTOR_ARG_LOG: log };
  const result = run(['tests/kernel/test_resolve.py'], ['--run-py'], env);
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'),
    ['run', '--frozen', 'python', '-m', 'pytest', 'tests/kernel/test_resolve.py', '-n', '2', '-q', '-p', 'no:cacheprovider']);
  rmSync(log);
  assert.equal(run([], ['--run-py'], env).status, 0);
  assert.throws(() => readFileSync(log), { code: 'ENOENT' });
});
