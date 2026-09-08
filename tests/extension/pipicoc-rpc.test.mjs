import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keeperArguments } from '../../pipicoc/rpc.mjs';

test('UI transport survives while coding persona and tools cannot replace the Keeper', () => {
  const result = keeperArguments(['--mode','rpc','--session','/tmp/ui.jsonl',
    '--system-prompt','coding','--append-system-prompt=host','--tools','bash,read',
    '-e','/host/coding.ts','--model','provider/model'], '/repo');
  assert.deepEqual(result.slice(0,6), ['--mode','rpc','--session','/tmp/ui.jsonl','--model','provider/model']);
  assert.ok(!result.includes('coding'));
  assert.ok(!result.includes('/host/coding.ts'));
  for (const name of ['kernel','mods','onboarding','module','memory','table'])
    assert.equal(result.filter(v => v === `/repo/extensions/${name}/index.ts`).length, 1);
  assert.equal(result.filter(v => v === '/repo/pipicoc/agent.ts').length, 1);
});
test('setup uses canonical setup mode and rejects unknown modes or broken arguments', () => {
  assert.equal(keeperArguments(['--mode','rpc'], '/repo', 'setup')[0], 'setup');
  assert.throws(() => keeperArguments([], '/repo', 'other'));
  assert.throws(() => keeperArguments(['-e'], '/repo'));
});
