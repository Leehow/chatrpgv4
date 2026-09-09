import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..'), parent = join(ROOT, '.coc/playtests/runtime-consolidation/healing');
await mkdir(parent, { recursive: true });
const evidence = await mkdtemp(join(parent, 'direct-'));
const modules = [
  ['json', ['parsePythonJson', 'pythonJsonDumps', 'canonicalJson']], ['random', ['PythonRandom']], ['context', ['createKernelContext']],
  ['rules/tables', ['RuleTables']], ['resolve/arithmetic', ['CheckArithmetic']],
  ['healing/session', ['HealingSession', 'establishDamageWound', 'rebaseHealingClock', 'healingTimeTrigger']],
  ['healing/mp', ['MPool', 'rebaseMpClock', 'mpTimeTrigger']], ['healing/day', ['closeSanityDays']], ['healing/resources', ['applyWoundConditions']],
];
await build({ stdin: { contents: modules.map(([name, names]) => `export {${names.join(',')}} from ${JSON.stringify(join(ROOT, 'kernel-ts', name + '.ts'))};`).join('\n'),
  resolveDir: ROOT, loader: 'ts', sourcefile: 'healing-oracle.ts' }, outfile: join(evidence, 'api.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent' });
const api = await import(pathToFileURL(join(evidence, 'api.mjs')).href), clone = value => api.parsePythonJson(api.pythonJsonDumps(value));
const context = await api.createKernelContext({ workspace: join(evidence, 'workspace'), content: join(ROOT, 'content') });
after(() => context.git.close());
const tables = new api.RuleTables(context), arithmetic = await api.CheckArithmetic.create(tables);
const capture = async fn => { try { return { value: clone(await fn()) }; } catch (error) { return { error: { name: error.name, message: error.message } }; } };
const PYTHON = String.raw`
import json,random,sys
from pathlib import Path
from coc.fileio import write_json_atomic,read_json
from coc.rules.tables import RuleTables
from coc.rules import healing,mp,combat,percentile
from coc.rules.sanity import SanitySession
p=json.load(sys.stdin);tables=RuleTables(Path(p['content'])/'rulesets/coc7/rules-json')
def run(case,index):
    rng=random.Random(case.get('seed','healing-oracle'))
    op=case['op'];out=[]
    if op=='session':
        session=healing.HealingSession(tables,'patient',case.get('max',11),case.get('con',50),rng,
            current_hp=case.get('hp',4),conditions=case.get('conditions',[]),healing_usage=case.get('usage'),
            wound_ledger=case.get('wounds'),recovery_ledger=case.get('recovery'))
        for step in case['steps']:
            out.append(getattr(session,step['method'])(*step.get('args',[]),**step.get('options',{})))
        return {'results':out,'state':session.snapshot(),'next':rng.randint(1,100)}
    if op=='pool':
        pool=mp.MPool('patient',case.get('pow',50),rng,mp_economy=case.get('economy'),current_hp=case.get('hp'),regen_remainder_minutes=case.get('remainder',0))
        pool.current_mp=case.get('mp',0)
        for step in case['steps']:out.append(getattr(pool,step['method'])(*step.get('args',[]),**step.get('options',{})))
        return {'results':out,'state':pool.snapshot(),'next':rng.randint(1,100)}
    if op=='wound':
        state=case.get('state',{})
        for wound in case['wounds']:out.append(healing.establish_damage_wound(state,**wound))
        return {'results':out,'state':state,'next':rng.randint(1,100)}
    if op=='rebase':return {'healing':healing.rebase_clock(case['state'],case['delta']),'mp':mp.rebase_clock(case['state'],case['delta'])}
    if op=='triage':
        state=case['state']
        def roll_con():
            check=percentile.percentile_check(tables,case.get('con',50),rng=rng)
            return check['level'],check
        combat.apply_wound_conditions(state,case['damage'],roll_con)
        return {'state':state,'next':rng.randint(1,100)}
    folder=Path(p['evidence'])/('python-'+str(index))
    if op=='time':
        write_json_atomic(folder/'save/healing-state/patient.json',case['state'])
        out=healing.handle_time_trigger(tables,folder,'patient',case.get('max',11),case.get('con',50),case['minutes'],rng=rng,had_major_wound=case.get('major',False))
        return {'result':out,'state':read_json(folder/'save/healing-state/patient.json'),'next':rng.randint(1,100)}
    if op=='day':
        write_json_atomic(folder/'save/sanity-state/patient.json',case['state'])
        session=SanitySession.load(folder,'patient',cm_value=case.get('cm',0),rng=rng,tables=tables,clock_minutes=case['clock'])
        for _ in range(case['days']):session.end_day()
        return {'state':session.snapshot(),'next':rng.randint(1,100)}
out=[]
for i,case in enumerate(p['cases']):
    try:out.append({'value':run(case,i)})
    except Exception as error:out.append({'error':{'name':type(error).__name__,'message':str(error)}})
json.dump(out,sys.stdout,ensure_ascii=False)
`;

const methods = { first_aid: 'firstAid', medicine: 'medicine', dying_con_roll: 'dyingConRoll', stabilized_con_roll: 'stabilizedConRoll', weekly_recovery: 'weeklyRecovery', major_wound_recovery_roll: 'majorWoundRecoveryRoll', reset_daily_treatments: 'resetDailyTreatments', reopen_subsequent_first_aid_attempt: 'reopenSubsequentFirstAidAttempt', set_usage_scope: 'setUsageScope' };
const camel = options => Object.fromEntries(Object.entries(options).map(([key, value]) => [key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()), value]));
async function execute(input) {
  const c = clone(input), rng = new api.PythonRandom(c.seed ?? 'healing-oracle'), results = [];
  if (c.op === 'session') {
    const session = new api.HealingSession(arithmetic, 'patient', c.max ?? 11, c.con ?? 50, rng, { currentHp: c.hp ?? 4, conditions: c.conditions, healingUsage: c.usage, woundLedger: c.wounds, recoveryLedger: c.recovery });
    for (const step of c.steps) {
      const args = step.args ?? [], options = camel(step.options ?? {});
      let value;
      if (step.method === 'first_aid') value = session.firstAid(args[0], args[1] ?? null, options);
      else if (step.method === 'medicine') value = session.medicine(args[0], args[1] ?? null, options.sameDay ?? true);
      else if (step.method === 'major_wound_recovery_roll') value = session.majorWoundRecoveryRoll(options);
      else value = session[methods[step.method]](...args);
      results.push(value ?? null);
    }
    return { results, state: session.snapshot(), next: rng.randint(1, 100) };
  }
  if (c.op === 'pool') {
    const pool = new api.MPool('patient', c.pow ?? 50, { economy: c.economy, currentHp: c.hp, remainderMinutes: c.remainder ?? 0 });
    pool.currentMp = c.mp ?? 0;
    for (const step of c.steps) {
      const name = { regen_mp: 'regenMp', spend_mp: 'spendMp', can_spend: 'canSpend' }[step.method];
      results.push(pool[name](...step.args, ...(step.options?.source ? [step.options.source] : [])));
    }
    return { results, state: pool.snapshot(), next: rng.randint(1, 100) };
  }
  if (c.op === 'wound') {
    const state = c.state ?? {};
    for (const wound of c.wounds) results.push(api.establishDamageWound(state, camel(wound)));
    return { results, state, next: rng.randint(1, 100) };
  }
  if (c.op === 'rebase') return { healing: api.rebaseHealingClock(c.state, c.delta), mp: api.rebaseMpClock(c.state, c.delta) };
  if (c.op === 'triage') {
    api.applyWoundConditions(c.state, c.damage, () => { const check = arithmetic.check(c.con ?? 50, 'regular', 0, 0, rng); return [check.level, check]; });
    return { state: c.state, next: rng.randint(1, 100) };
  }
  if (c.op === 'time') {
    let state = c.state;
    const port = { readSave: async () => clone(state), writeSave: async (_, value) => { state = clone(value); } };
    const result = await api.healingTimeTrigger(arithmetic, port, 'patient', c.max ?? 11, c.con ?? 50, c.minutes, rng, c.major ?? false);
    return { result, state, next: rng.randint(1, 100) };
  }
  if (c.op === 'day') return { state: api.closeSanityDays(c.state, 'patient', c.cm ?? 0, c.clock, c.days), next: rng.randint(1, 100) };
  throw new Error('Unknown oracle case');
}
async function compare(name, cases, t) {
  const reference = spawnSync('uv', ['run', '--frozen', 'python', '-c', PYTHON], { cwd: ROOT, input: api.pythonJsonDumps({ cases, evidence, content: join(ROOT, 'content') }), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PYTHONPATH: join(ROOT, 'kernel'), PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(reference.status, 0, reference.stderr);
  const expected = api.parsePythonJson(reference.stdout), actual = [];
  for (const c of cases) actual.push(await capture(() => execute(c)));
  await writeFile(join(evidence, name + '-input.json'), api.pythonJsonDumps(cases));
  await writeFile(join(evidence, name + '-python.json'), reference.stdout);
  await writeFile(join(evidence, name + '-typescript.json'), api.pythonJsonDumps(actual));
  for (let i = 0; i < cases.length; i++) await t.test(cases[i].name ?? `${name}-${i}`, () => assert.equal(api.canonicalJson(actual[i]), api.canonicalJson(expected[i]), `Evidence: ${evidence}`));
}

test('healing and dying treatment use the same draws, usage scopes and event evidence', async t => {
  const cases = [];
  for (const conditions of [[], ['major_wound'], ['major_wound', 'dying', 'unconscious'], ['major_wound', 'dying', 'unconscious', 'stabilized']]) {
    for (const skill of [1, 50, 100]) for (const seed of ['patient-a', 'patient-b']) {
      cases.push({ op: 'session', conditions, seed, hp: conditions.includes('stabilized') ? 1 : conditions.includes('dying') ? 0 : 4,
        steps: [{ method: 'first_aid', args: [skill] }, { method: 'first_aid', args: [skill] }, { method: 'first_aid', args: [skill], options: { pushed: true } },
          { method: 'medicine', args: [skill] }, { method: 'medicine', args: [skill], options: { same_day: false } }] });
    }
  }
  for (const outcome of ['regular', 'hard', 'extreme', 'critical', 'failure', 'fumble']) cases.push({ op: 'session', conditions: ['major_wound'],
    wounds: [{ wound_id: 'wound-old', occurred_elapsed_minutes: -60, status: 'active' }],
    steps: [{ method: 'major_wound_recovery_roll', options: { roll_result: { outcome, roll: 50 }, attempt_elapsed_minutes: 10080, complete_rest: true, medical_care_success: true, poor_environment: true } }] });
  cases.push({ op: 'session', usage: { first_aid_used: true, first_aid_push_used: true, medicine_used: true }, conditions: ['major_wound', 'dying'], hp: 0,
    steps: [{ method: 'dying_con_roll', args: [{ outcome: 'regular', roll: 20 }] }, { method: 'first_aid', args: [100], options: { pushed: true } },
      { method: 'stabilized_con_roll', args: [{ outcome: 'failure', roll: 90 }] }, { method: 'set_usage_scope', args: ['wound-new', 'day-1'] }, { method: 'first_aid', args: [100] }] });
  for (const assistant of [0, true, 50, 100]) cases.push({ op: 'session', steps: [{ method: 'first_aid', args: [50], options: { assistant_skill_value: assistant, assistant_rescuer_id: 'assistant' } }] });
  await compare('treatments', cases, t);
});

test('rest duration preserves full-day and weekly boundaries without extra rolls', async t => {
  const cases = [];
  for (const minutes of [0, 1, 359, 360, 480, 1439, 1440, 10079, 10080, 20160, 43200]) for (const major of [false, true]) {
    cases.push({ op: 'time', minutes, max: 40, con: 60, state: { investigator_id: 'patient', current_hp: 2,
      conditions: major ? ['major_wound', 'prone', 'unconscious'] : ['prone'], healing_usage: { first_aid_used: true },
      wound_ledger: [{ wound_id: 'wound-one', status: 'active', occurred_elapsed_minutes: 480 }], preserved: { source: 'accepted' } } });
  }
  for (const damage of [0, 1, 5, 6, 11, 12]) for (const conditions of [[], ['major_wound']]) cases.push({ op: 'triage', damage, state: { hp_max: 11, hp_current: Math.max(0, 11 - damage), conditions } });
  const wound = { decision_id: 't1-c1', occurred_elapsed_minutes: 480, source_damage_roll_id: 'roll:damage-t1-c1' };
  cases.push({ op: 'wound', wounds: [wound, wound] }, { op: 'wound', wounds: [wound, { ...wound, occurred_elapsed_minutes: 481 }] });
  cases.push({ op: 'rebase', delta: -540, state: { wound_ledger: [{ occurred_elapsed_minutes: 480 }, { occurred_elapsed_minutes: true }], major_wound_recovery_ledger: [{ attempt_elapsed_minutes: 10080 }], regen_remainder_minutes: 59, untouched: 'accepted' } });
  await compare('rest-and-wounds', cases, t);
});

test('MP remainder and overspill retain Python whole-hour and rounding behavior', async t => {
  const cases = [];
  for (const pow of [50, 100, 101, 150]) for (const remainder of [0, 30, 59]) cases.push({ op: 'pool', pow, remainder, hp: 10,
    steps: [...Array.from({ length: 12 }, () => ({ method: 'regen_mp', args: [api.parsePythonJson('0.08333333333333333')] })), { method: 'spend_mp', args: [30] }, { method: 'can_spend', args: [1] }] });
  for (const hours of ['0.0', '-1.0', '0.008333333333333333', '0.025', '0.975', '1.0', '1.5', '24.0']) cases.push({ op: 'pool', remainder: 59, mp: 9,
    steps: [{ method: 'regen_mp', args: [api.parsePythonJson(hours)] }, { method: 'regen_mp', args: [api.parsePythonJson('1.0')] }] });
  cases.push({ op: 'pool', economy: { regen_per_hour: 3, max_cannot_exceed_pow_divided_5: false, after_zero_costs_hp_one_for_one: false }, hp: 3,
    steps: [{ method: 'spend_mp', args: [5] }, { method: 'regen_mp', args: [api.parsePythonJson('10.0')] }] });
  await compare('mp', cases, t);
});

test('midnight closes saved SAN days and schedules the existing monthly treatment deadline', async t => {
  const cases = [];
  for (const lost of [0, 10, 11, 20]) for (const days of [1, 3]) cases.push({ op: 'day', days, clock: 4320,
    state: { investigator_id: 'patient', san_max: 99, san_current: 44, day_start_san: 55, daily_san_lost: lost,
      phobia: 'An accepted source fear.', phobia_tags: ['closed-tag'], conditions: ['preserved'], events: [{ event_id: 'se1', type: 'prior', payload: {} }] } });
  cases.push({ op: 'day', days: 1, clock: 1440, state: { investigator_id: 'other' } },
    { op: 'day', days: 1, clock: 1440, state: { investigator_id: 'patient', bout_active: true, bout_rounds_remaining: 0 } });
  await compare('sanity-day', cases, t);
});
