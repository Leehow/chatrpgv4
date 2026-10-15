import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {kernelCommand, composeRuntimeContext} from '../../runtime/host.ts';

const root = resolve(import.meta.dirname, '../..');

test('retired Python selection fails before a source runtime can start', () => {
  for (const selection of [{backend:'python'}, {env:{...process.env, PI_COC_RUNTIME:'python'}}]) {
    assert.throws(() => kernelCommand(root, {resourceRoot:root, ...selection}), /Python runtime is retired/);
    assert.throws(() => composeRuntimeContext({owner:'check', home:root}, {resourceRoot:root, ...selection}), /Python runtime is retired/);
  }
  const command = kernelCommand(root, {resourceRoot:root, env:{}, nodeExecutable:process.execPath});
  assert.deepEqual(command.slice(0, 2), [process.execPath, join(root, 'build/kernel/rpc.mjs')]);
});

test('production sources contain no editable Python implementation', () => {
  assert.equal(existsSync(join(root, 'kernel/coc/rpc.py')), false);
  const controllers = new Set();
  const manifest = JSON.parse(readFileSync(join(root, 'pipicoc/runtime-dependencies.json'), 'utf8'));
  for (const controller of controllers) {
    const path = relative(root, controller).split('\\').join('/');
    for (const key of ['requiredEntries', 'resourceFiles', 'hostAssets']) assert.ok(!manifest[key].includes(path), `${path} must not ship`);
    for (const directory of manifest.resourceDirectories) assert.ok(path !== directory && !path.startsWith(directory + '/'), `${path} must not ship in ${directory}`);
  }
  function walk(dir) {
    for (const item of readdirSync(dir, {withFileTypes:true})) {
      const path = join(dir,item.name);
      if (item.isDirectory()) walk(path);
      else assert.ok(!item.name.endsWith('.py') || controllers.has(path), `Production Python file: ${path}`);
    }
  }
  for (const name of ['kernel-ts','runtime','extensions','pipicoc','content','scripts','bin']) walk(join(root,name));
});

test('developer comparison uses immutable captured outcomes without an executable oracle', async () => {
  const {expected} = await import('./oracle-fixture.mjs');
  const path = join(root,'tests/extension/fixtures/oracle/setup-1.json');
  const before = readFileSync(path,'utf8'), previous = process.env.PI_COC_REFREEZE_ORACLE;
  process.env.PI_COC_REFREEZE_ORACLE = '1';
  try {
    assert.equal(expected('setup-1'), before);
    assert.throws(() => expected('setup-1','changed source'), /different reference program/);
    assert.throws(() => expected('nonexistent-python-free-capture'), /Missing immutable captured outcome/);
    assert.equal(readFileSync(path,'utf8'),before);
  } finally {
    if(previous===undefined)delete process.env.PI_COC_REFREEZE_ORACLE;
    else process.env.PI_COC_REFREEZE_ORACLE=previous;
  }
  for (const path of ['tests/python-oracle.mjs','tests/python-oracle.json']) assert.equal(existsSync(join(root,path)),false,path);
});

test('Python has no environment, controller or active execution route', () => {
  for (const path of ['scripts/run-pytest.py','tests/coc_pytest_storage.py','pyproject.toml','uv.lock','.python-version'])
    assert.equal(existsSync(join(root,path)),false,path);
  for (const path of ['scripts/test-integration.mjs','scripts/select-tests.mjs','scripts/benchmark-test-tiers.mjs','scripts/benchmark-resource-settlement.mjs']) {
    const source=readFileSync(join(root,path),'utf8');
    assert.doesNotMatch(source, /run-pytest|['"]pytest['"]|--run-py/);
  }
});
