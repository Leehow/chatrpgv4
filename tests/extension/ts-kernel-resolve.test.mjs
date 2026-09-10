import {expected} from "./oracle-fixture.mjs";
import {pythonOracleRoot} from "../python-oracle.mjs";
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const parent = join(ROOT, '.coc/playtests/runtime-consolidation/checks');
await mkdir(parent, { recursive: true });
const evidence = await mkdtemp(join(parent, 'direct-'));
const modules = [
  ['json', ['parsePythonJson', 'pythonJsonDumps']], ['random', ['PythonRandom']], ['context', ['createKernelContext']],
  ['rules/tables', ['RuleTables']], ['resolve/arithmetic', ['CheckArithmetic', 'resourceDelta', 'rollExpression']],
  ['resolve/social', ['socialDifficulty', 'psychologyPolicy', 'psychologyCheckContract']],
  ['resolve/context', ['skillTickEligible']], ['resolve/pipeline', ['validateExtras']],
];
await build({ stdin: { contents: modules.map(([name, names]) => `export {${names.join(',')}} from ${JSON.stringify(join(ROOT, 'kernel-ts', name + '.ts'))};`).join('\n'),
  resolveDir: ROOT, loader: 'ts', sourcefile: 'resolve-oracle.ts' }, outfile: join(evidence, 'api.mjs'), bundle: true, platform: 'node',
  format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent' });
const api = await import(pathToFileURL(join(evidence, 'api.mjs')).href);
const context = await api.createKernelContext({ workspace: join(evidence, 'workspace'), content: join(ROOT, 'content') });
after(() => context.git.close());
const arithmetic = await api.CheckArithmetic.create(new api.RuleTables(context));
const plain = value => api.parsePythonJson(api.pythonJsonDumps(value));
const capture = async fn => {
  try { return { value: plain(await fn()) }; }
  catch (error) { return { error: typeof error.toJson === 'function' ? plain(error.toJson()) : { name: error.name, message: error.message } }; }
};
const PYTHON = String.raw`
import json,random,sys
from pathlib import Path
from coc.rules.tables import RuleTables
from coc.rules.resolver import Resolver
from coc.rules import percentile
from coc.rules.development import skill_tick_eligible
from coc.errors import RpcError
p=json.load(sys.stdin);tables=RuleTables(Path(p['content'])/'rulesets/coc7/rules-json');resolver=Resolver(tables)
def capture(fn):
    try:return {'value':fn()}
    except RpcError as error:return {'error':error.to_json()}
    except Exception as error:return {'error':{'name':type(error).__name__,'message':str(error)}}
out=[]
for case in p['cases']:
    rng=random.Random(case.get('seed','checks'))
    op=case['op'];args=case.get('args',[])
    def run():
        if op=='check':return resolver.check(*args,rng=rng)
        if op=='resolve':return percentile.resolve_percentile_roll(tables,*args)
        if op=='dice':return percentile.roll_expression(*args,rng=rng)
        if op=='opposed':return resolver.opposed(*args,rng=rng)
        if op=='resource':return resolver.resource_delta(*args,**case.get('options',{}),rng=rng)
        if op=='luck':return resolver.luck_spend(*args,**case.get('options',{}))
        if op=='combined':return resolver.combined_roll(*args,**case['options'])
        if op=='push':return resolver.push_policy(*args)
        if op=='social':return resolver.social_difficulty(*args)
        if op=='psychology':return resolver.psychology_check_contract(*args)
        if op=='policy':return resolver.psychology_policy(*args,'concrete_observation')
        if op=='tick':return skill_tick_eligible(tables,*args)
    out.append({'result':capture(run),'next_draw':rng.randint(1,100)})
print(json.dumps(out,ensure_ascii=False))
`;
async function compare(name, cases) {
  const input = { content: join(ROOT, 'content'), cases };
  const reference = api.parsePythonJson(expected('resolve-' + name, () => {
    const run = spawnSync('uv', ['run', '--frozen', 'python', '-c', PYTHON], { cwd: ROOT, env: { ...globalThis.process.env, PYTHONPATH: join(pythonOracleRoot(), "kernel"), PYTHONDONTWRITEBYTECODE: '1' }, input: api.pythonJsonDumps(input), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  }, PYTHON));
  const candidate = [];
  for (const item of cases) {
    const rng = new api.PythonRandom(item.seed ?? 'checks'), args = item.args ?? [];
    const result = await capture(async () => {
      switch (item.op) {
        case 'check': return arithmetic.check(...args, rng);
        case 'resolve': return arithmetic.resolve(...args);
        case 'dice': return api.rollExpression(...args, rng);
        case 'opposed': return arithmetic.opposed(...args, rng);
        case 'resource': return api.resourceDelta(...args, { ...item.options, rng });
        case 'luck': return arithmetic.spendLuck(...args, item.options?.roll_kind);
        case 'combined': return arithmetic.combined(args[0], item.options.roll, item.options.required_level, item.options.comparison_mode);
        case 'push': return arithmetic.pushPolicy(...args);
        case 'social': return api.socialDifficulty(...args);
        case 'psychology': return api.psychologyCheckContract(...args);
        case 'policy': return api.psychologyPolicy(...args);
        case 'tick': return api.skillTickEligible(arithmetic, ...args);
      }
    });
    candidate.push({ result, next_draw: rng.randint(1, 100) });
  }
  await writeFile(join(evidence, name + '.json'), api.pythonJsonDumps({ input, reference, candidate }, { indent: 2 }));
  for (let index = 0; index < cases.length; index++) assert.deepEqual(candidate[index], reference[index], `${name}[${index}]: ${api.pythonJsonDumps(cases[index])}`);
}

test('percentile boundaries and modifier dice preserve results and RNG consumption', async () => {
  const cases = [];
  for (const seed of ['0', 'modifier', 'checks', 'different']) for (const target of [0, 1, 49, 50, 99, 150]) for (const difficulty of ['regular', 'hard', 'extreme']) for (const [bonus, penalty] of [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [1, 1], [2, 1], [1, 2], [2, 2]]) cases.push({ op: 'check', seed, args: [target, difficulty, bonus, penalty] });
  for (const target of [1, 49, 50, 99, 100]) for (const roll of [1, 2, 5, 20, 49, 50, 95, 96, 99, 100]) for (const difficulty of ['regular', 'hard', 'extreme']) cases.push({ op: 'resolve', args: [roll, target, difficulty] });
  await compare('percentile', cases);
});
test('opposed, combined, dice and generic resources match the Python primitives', async () => {
  const cases = [];
  for (const seed of ['checks', 'other', 'tied', 'failed']) for (const values of [[50, 50], [20, 90], [90, 20], [1, 1]]) cases.push({ op: 'opposed', seed, args: values });
  for (const expr of ['1D6', '2d10 + 3', '1D3+1D4-2', '-1D4+2D6', '1D1', '1D6+-2', '1D6+1_000', '0D6', '1D0', '4', 'bad']) cases.push({ op: 'dice', args: [expr] });
  for (const resource of ['hp', 'mp', 'luck', 'san']) for (const amount of [0, -5, 99, '1D6', '1D6-20']) for (const direction of ['loss', 'gain']) cases.push({ op: 'resource', args: [resource, 10, amount], options: { direction, maximum: 15 } });
  cases.push({ op: 'resource', args: ['mp', 9007199254740993n, 2], options: { direction: 'loss' } },
    { op: 'resource', args: ['luck', 9007199254740993n, 5n], options: { direction: 'gain', maximum: 9007199254740996n } });
  for (const mode of ['any', 'all']) for (const roll of [1, 30, 60, 99]) cases.push({ op: 'combined', args: [[{ label: 'DEX', value: 70 }, { label: 'Climb', value: 40 }]], options: { roll, required_level: 'regular', comparison_mode: mode } });
  await compare('families', cases);
});
test('Luck constraints, push exclusions and tick eligibility use canonical checks', async () => {
  const original = { ...arithmetic.resolve(74, 50, 'regular'), roll: 74, skill: 'Spot Hidden', pushed: false };
  const cases = [0, 1, 24, 25, 49, 73, 100].map(points => ({ op: 'luck', args: [original, points, 50] }));
  for (const [key, value] of [['pushed', true], ['passed', true], ['target', 60]]) cases.push({ op: 'luck', args: [{ ...original, [key]: value }, 24, 50] });
  for (const skill of ['Listen', 'Fighting (Brawl)', 'Firearms (Handgun)', 'Dodge', 'STR', 'missing']) for (const outcome of ['failure', 'fumble', 'regular']) cases.push({ op: 'push', args: [outcome, false, skill] });
  const success = { ...arithmetic.resolve(30, 60, 'regular'), roll: 30, skill: 'Listen', kind: 'skill_check' };
  for (const extra of [{}, { luck_spent: 2 }, { opposed_won: false }, { kind: 'characteristic_check' }, { kind: 'combined_skill_check' }, { bonus: 1, tens_values: [8, 3], units: 0, unmodified_roll: 80 }, { executor_kind: 'device' }, { improvement_tick_eligible: false }]) cases.push({ op: 'tick', args: ['Listen', { ...success, ...extra }] });
  await compare('continuations', cases);
});
test('social and concealed Psychology policies preserve source conditions', async () => {
  const cases = [];
  for (const defense of [null, 40, 60, 95]) for (const direction of ['neutral', 'support', 'oppose']) for (const intensity of [0, 1, 2]) for (const leverage of [false, true]) cases.push({ op: 'social', args: [{ approach: 'persuade', motive_direction: direction, motive_intensity: intensity, leverage_one_level: leverage, goal: 'open the records' }, defense] });
  for (const opposing of [null, 0, 49, 50, 89, 90]) for (const observer of [null, 0, 60]) cases.push({ op: 'psychology', args: [{ target_opposing_social: opposing, observer_skill: observer, question: 'What is concealed?', observable_facts: ['fact:a'] }] });
  for (const outcome of ['failure', 'fumble', 'regular', 'hard', 'extreme', 'critical']) cases.push({ op: 'policy', args: [{ outcome }] });
  for (const ceiling of ['uncertain', 'immediate_intent', 'motive_link', 'deep_conflict', 'unknown']) cases.push({ op: 'policy', args: [{ inference_ceiling: ceiling, external_behavior: 'He looks at the door.' }] });
  await compare('social', cases);
});
