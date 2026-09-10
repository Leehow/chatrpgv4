import {expected as outcome} from "./oracle-fixture.mjs";
import {pythonOracleRoot} from "../python-oracle.mjs";
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const directory = join(ROOT, '.coc/playtests/runtime-consolidation/development');
await mkdir(directory, { recursive: true });
const evidence = await mkdtemp(join(directory, 'direct-'));
const exports = [
  ['json', ['parsePythonJson', 'pythonJsonDumps']], ['context', ['createKernelContext']], ['rules/tables', ['RuleTables']],
  ['development/plan', ['deterministicDevelopmentPlan', 'sanityBaseline', 'endingIdForEvent', 'endingEventId']],
];
await build({ stdin: { contents: exports.map(([path, names]) => `export {${names.join(',')}} from ${JSON.stringify(join(ROOT, 'kernel-ts', path + '.ts'))};`).join('\n'),
  resolveDir: ROOT, loader: 'ts', sourcefile: 'development-oracle.ts' }, outfile: join(evidence, 'api.mjs'), platform: 'node', format: 'esm',
  target: 'node22', bundle: true, packages: 'external', logLevel: 'silent' });
const api = await import(pathToFileURL(join(evidence, 'api.mjs')).href);
const context = await api.createKernelContext({ workspace: join(evidence, 'workspace'), content: join(ROOT, 'content') });
after(() => context.git.close());
const tables = new api.RuleTables(context);
const PYTHON = String.raw`
import json,sys
from pathlib import Path
from coc.rules.tables import RuleTables
from coc.rules.development import deterministic_development_plan,sanity_baseline,ending_id_for_event,ending_event_id
p=json.load(sys.stdin);tables=RuleTables(Path(p['content'])/'rulesets/coc7/rules-json')
output=[]
for case in p['cases']:
    try:
        if case['op']=='plan':
            value=deterministic_development_plan(tables,skills=case['skills'],luck=case['luck'],sanity=case['sanity'],
              seed_material=case['seed'],scenario_reward_expr=case.get('reward'),luck_recovery_gate=case.get('gate'))
        elif case['op']=='sanity':value=sanity_baseline(case['sheet'])
        elif case['op']=='id':value=ending_id_for_event(case['event'])
        else:value=ending_event_id(case['id'])
        output.append({'value':value})
    except Exception as error:output.append({'error':{'name':type(error).__name__,'message':str(error)}})
print(json.dumps(output,ensure_ascii=False))
`;
async function compare(name, cases) {
  const input = { content: join(ROOT, 'content'), cases };
  const captured = outcome('development-' + name, () => {
    const child = spawnSync('uv', ['run', '--frozen', 'python', '-c', PYTHON], { cwd: ROOT,
      env: { ...process.env, PYTHONPATH: join(pythonOracleRoot(), "kernel"), PYTHONDONTWRITEBYTECODE: '1' }, input: api.pythonJsonDumps(input), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout;
  });
  const expected = api.parsePythonJson(captured), actual = [];
  for (const item of cases) {
    try {
      const value = item.op === 'plan' ? await api.deterministicDevelopmentPlan(tables, { skills: item.skills, luck: item.luck, sanity: item.sanity, seedMaterial: item.seed,
        scenarioRewardExpr: item.reward ?? null, luckRecoveryGate: item.gate ?? null }) : item.op === 'sanity' ? api.sanityBaseline(item.sheet) : item.op === 'id' ? api.endingIdForEvent(item.event) : api.endingEventId(item.id);
      actual.push({ value: api.parsePythonJson(api.pythonJsonDumps(value)) });
    } catch (error) { actual.push({ error: { name: error.name, message: error.message } }); }
  }
  await writeFile(join(evidence, name + '.json'), api.pythonJsonDumps({ input, expected, actual }, { indent: 2 }));
  for (let index = 0; index < cases.length; index++) assert.deepEqual(actual[index], expected[index], `${name} case ${index}: ${api.pythonJsonDumps(cases[index])}`);
}

test('frozen development plans preserve dice order, threshold rewards, caps and digests', async () => {
  const cases = [];
  for (const seed of ['ending-a:ada:development.settle', 'ending-b:ada:development.settle', 'skill-threshold', 'reward'])
    for (const skills of [{}, { Listen: 45 }, { Persuade: 89, Listen: 45 }, { Persuade: 99, 'Library Use': 95 }, api.parsePythonJson('{"10":80,"2":20,"a":99}')])
      for (const luck of [0, 50, 98, 100]) for (const reward of [null, '1D8', '100D1']) cases.push({ op: 'plan', skills, luck, sanity: { current: 95, max: 99 }, seed, reward });
  await compare('plans', cases);
});
test('disabled Luck recovery skips its draws and malformed reward expressions fail', async () => {
  const gate = { option_id: 'luck-recovery', decided_by: 'fixture', layer: 'house_rule' };
  const cases = [];
  for (const reward of [null, '2D6', '1D3+1D4-2', 'not-dice', '4', '0D6']) for (const disabled of [false, true]) cases.push({ op: 'plan', skills: { Listen: 30, Persuade: 89 }, luck: 25,
    sanity: { current: 45, max: 55 }, seed: 'optional-recovery', reward, ...(disabled ? { gate } : {}) });
  await compare('options', cases);
});
test('SAN baselines and durable ending identities match source semantics', async () => {
  const cases = [{ current_san: 50, max_san: 90 }, { derived: { SAN: 40 }, cm_value: 10 }, { current_san: 70, max_san: 20 },
    { current_san: null, derived: { SAN: 60 }, max_san: null }, {}].map(sheet => ({ op: 'sanity', sheet }));
  for (const event of [{}, { decision_id: 't1-c2', scene_id: 'dock', kind: 'conclusion' }, { ending_id: 'explicit', decision_id: 't1-c2' }, { ending_id: '', scene_id: 'dock' }]) cases.push({ op: 'id', event });
  for (const id of ['ending-a', 'ending:1', 'bad/id', '', 'x'.repeat(129)]) cases.push({ op: 'event', id });
  await compare('identity', cases);
});
