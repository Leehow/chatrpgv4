import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const bundled = await build({
  stdin: {
    contents: "export {clueGate} from './kernel-ts/read/director.ts'; export {ModuleGraph} from './kernel-ts/read/module-graph.ts';",
    resolveDir: ROOT,
  },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
});
const { clueGate, ModuleGraph } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

function gate(properties = {}, clueEntries = []) {
  const clue = { node_id: 'clue-letter', node_kind: 'clue', name: 'Letter', properties };
  const graph = new ModuleGraph('gate-test', {
    nodes: [clue, ...clueEntries.map((entry, index) => ({
      node_id: `conclusion-letter-${index}`, node_kind: 'conclusion', name: `Conclusion ${index}`,
      properties: { clues: [entry] },
    }))],
  }, '', {});
  return clueGate(graph, clue);
}

test('an unknown delivery and absent conclusion cannot waive a check', () => {
  assert.equal(gate(), 'unknown: check unspecified');
});

test('delivery metadata and missing, null or empty skill values do not establish no-roll permission', () => {
  for (const delivery_kind of ['environmental', 'npc_dialogue', 'obvious']) {
    for (const entry of [{}, { skill: null }, { skill: '' }]) {
      assert.equal(gate({ delivery_kind }, [{ clue_id: 'clue-letter', ...entry }]), `${delivery_kind}: check unspecified`);
    }
  }
});

test('a check on another clue does not fill missing check metadata', () => {
  assert.equal(gate({}, [{ clue_id: 'clue-other', skill: 'Library Use', difficulty: 'hard' }]), 'unknown: check unspecified');
});

test('a declared skill-check delivery retains the requirement without claiming the source omitted its skill', () => {
  assert.equal(gate({ delivery_kind: 'skill_check' }), 'skill_check: check required (skill unspecified)');
  assert.equal(gate({ delivery_kind: 'skill_check' }, [{ clue_id: 'clue-letter', skill: null }]), 'skill_check: check required (skill unspecified)');
});

test('an authored skill and difficulty still override the unspecified projection', () => {
  assert.equal(gate({ delivery_kind: 'skill_check' }, [{ clue_id: 'clue-letter', skill: 'Library Use', difficulty: 'hard' }]), 'skill_check: Library Use (hard)');
  assert.equal(gate({}, [{ clue_id: 'clue-letter', skill: 'Listen' }]), 'unknown: Listen');
});

test('unknown check metadata preserves independent unlock conditions', () => {
  assert.equal(gate({ delivery_kind: 'environmental', unlock_when: { kind: 'flag', flag: 'door-open' } }), 'environmental: check unspecified; flag_set: door-open');
});

test('canonical clue-owned checks override legacy conclusion metadata without reviving an unset skill', () => {
  assert.equal(gate({ delivery_kind: 'skill_check', skill: 'Listen', difficulty: 'hard' }, [
    { clue_id: 'clue-letter', delivery_kind: 'environmental', skill: 'Library Use', difficulty: 'regular' },
  ]), 'skill_check: Listen (hard)');
  for (const skill of [null, ''])
    assert.equal(gate({ delivery_kind: 'skill_check', skill }, [{ clue_id: 'clue-letter', skill: 'Library Use' }]), 'skill_check: check required (skill unspecified)');
});
