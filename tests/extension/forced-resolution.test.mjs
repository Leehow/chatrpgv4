/**
 * §163 (owner ruling 2026-10-01): a Jev decision that stays uncertain or unavailable still yields a result. Through the real
 * registration, the emitted kernel and the hybrid engine, with a fake Jev that answers below the gates or fails: the turn
 * delivers the Keeper's prose, the forced resolution is one `lane: "forced-resolution"` row and one Keeper marker, and no
 * host notice stands in for the story. Controlled decisions are not gameplay acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {openTable} from './harness.mjs';

const baseKey = key => key.replace(/__semantic_(facts|execution)$/, '');
const root = resolve(import.meta.dirname, '../..');
const PROSE = 'You press your ear to the office door. Somewhere below, a pipe knocks twice and goes still.';
function rpc(workspace, calls) {
  const run = spawnSync(process.execPath, [join(root, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(root, 'content')], {
    cwd: root, encoding: 'utf8', input: calls.map(([method, params], id) => JSON.stringify({id: String(id), method, params: {campaign: 'test-camp', ...params}})).join('\n') + '\n'});
  assert.equal(run.status, 0, run.stderr);
  for (const frame of run.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(frame => !frame.progress)) assert.equal(frame.ok, true, JSON.stringify(frame));
}
const turnRecord = (workspace, turn) => JSON.parse(readFileSync(join(workspace, '.coc/campaigns/test-camp/turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));
const clerkNotes = context => context.messages.flatMap(message => {
  const text = typeof message.content === 'string' ? message.content : (message.content ?? []).map(block => block.text ?? '').join('');
  const start = text.indexOf('{"kind":"single_loop_step"');
  return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf('}') + 1))];
});

/**
 * Jev as the turn-9 shape: the route confidently examines the ordinary-check family; check selection fits Listen to the
 * declared method but answers the roll need at `need` (an ordinary check's gate is .65, its confident negative .35). `fail` makes every check-selection
 * request throw, as the 2026-09-30 network errors did.
 */
function jev({need, fail = false}) {
  return {async decide(batch) {
    if (fail && batch.family.startsWith('check-selection')) throw new Error('network_error');
    const answers = Object.fromEntries(batch.questions.map(rawQuestion => {
      const question = {...rawQuestion, key: baseKey(rawQuestion.key)};
      if (question.type === 'noul') {
        let p = 0.01;
        if (batch.family.startsWith('check-selection-need') && !question.key.endsWith('_blocked')) {
          const check = batch.state.checks[question.key.replace(/_uncertain$/, '')];
          if (check?.action?.skill === 'Listen') p = question.key.endsWith('_uncertain') ? need : 0.99;
        }
        return [rawQuestion.key, {status: 'answered', type: 'noul', noul: p}];
      }
      let selected;
      if (batch.family === 'single-loop-route' && question.key.startsWith('need_')
        && batch.state.candidates[question.key.replace('need_', 'candidate_')]?.bound?.decision === 'core-check:ordinary-check') selected = 'now';
      if (batch.family === 'check-selection-profiles') selected = Object.entries(question.criteria).find(([, value]) => value?.skill === 'Listen')?.[0];
      if (batch.family === 'check-selection-bind') selected = Object.entries(question.criteria).find(([, label]) => ['investigate', 'regular', 'none'].includes(label))?.[0];
      selected ??= question.key === 'exit' ? 'finish' : 'unknown' in question.criteria ? 'unknown' : 'later' in question.criteria ? 'later' : Object.keys(question.criteria)[0];
      return [rawQuestion.key, {status: 'answered', type: 'choice', choice: selected, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected ? 1 : 0]))}];
    }));
    return bindDecisionAnswers(batch, answers, {inputTokens: 1, outputTokens: 1, costUsd: 0});
  }};
}

async function play(t, port) {
  const requests = [];
  const engine = createHybridEngine({env: {...process.env, PI_COC_JEV_PRESELECT: '0', COC_JEV_STEPS: 'off'}, decision: port, compile: false, npcAct: null});
  const table = await openTable({realKernel: true, env: {PI_COC_LOOP_ENGINE: 'hybrid-v1'}, runDriver: engine.runDriver,
    prepareWorkspace: workspace => rpc(workspace, [['table.open', {}], ['table.player_input', {text: 'I am ready.'}],
      ['table.narrate', {call_id: 't1-c1', text: 'You wait in the office.'}]]),
    extraExtensions: [{name: 'forced-resolution-engine', factory: engine.extension}],
    responses: [context => { requests.push(context); return fauxAssistantMessage([fauxToolCall('narrate', {text: PROSE})], {stopReason: 'toolUse'}); }]});
  t.after(() => table.dispose());
  await table.session.prompt('I listen carefully by the office door.');
  const telemetry = table.telemetry();
  return {table, telemetry, requests, notes: requests.flatMap(clerkNotes),
    forced: telemetry.filter(row => row.lane === 'forced-resolution'),
    rolls: telemetry.filter(row => row.tool === 'resolve' && row.ok && row.origin === 'policy'),
    notices: table.session.messages.filter(message => message.customType === 'coc-delivery' && message.details?.check_selection_unresolved)};
}
function delivered({table}, turn = 2) {
  assert.equal(table.session.lastDrivenRun.status, 'delivered');
  assert.equal(turnRecord(table.workspace, turn).text, PROSE, 'the Keeper\'s prose is the turn\'s delivery');
}

test('§163: a gray roll need is Jev\'s best guess -- the host rolls it, records it once, marks it for the Keeper, and the turn has prose', async t => {
  const run = await play(t, jev({need: 0.6}));
  delivered(run);
  assert.equal(run.rolls.length, 1, JSON.stringify(run.telemetry.filter(row => row.lane === 'check-selection').map(row => [row.purpose, row.status, row.needs])));
  assert.equal(run.rolls[0].basis?.selection_snapshot !== undefined, true);
  assert.deepEqual(run.forced.map(row => [row.family, row.chosen.outcome, row.chosen.check, row.why]), [['check-selection', 'roll', run.forced[0].chosen.check, 'below_confidence_gate']]);
  assert.match(run.forced[0].chosen.check, /Listen/);
  assert.ok(run.forced[0].uncertain.some(entry => /roll needed p=0\.6/.test(entry)), run.forced[0].uncertain.join('; '));
  const marked = run.notes.find(note => note.decided_under_uncertainty);
  assert.deepEqual(marked.decided_under_uncertainty.map(entry => [entry.family, entry.chosen.outcome]), [['check-selection', 'roll']]);
  assert.match(marked.decided_under_uncertainty_note, /reconcile forward/);
  assert.ok(run.notes.every(note => note.unresolved_checks === undefined && note.check_outcome_boundary === undefined));
  assert.equal(run.notices.length, 0, 'no host notice');
});

test('§163: a gray roll need leaning no is a recorded no-roll the Keeper narrates', async t => {
  const run = await play(t, jev({need: 0.4}));
  delivered(run);
  assert.equal(run.rolls.length, 0);
  assert.deepEqual(run.forced.map(row => [row.family, row.chosen.outcome, row.why]), [['check-selection', 'no_roll', 'below_confidence_gate']]);
  assert.ok(run.notes.some(note => note.decided_under_uncertainty?.some(entry => entry.chosen.outcome === 'no_roll')));
  assert.equal(run.notices.length, 0);
});

test('§163: a check selection whose provider fails is a recorded no-roll with prose, not a held notice', async t => {
  const run = await play(t, jev({need: 1, fail: true}));
  delivered(run);
  assert.equal(run.rolls.length, 0);
  assert.equal(run.forced.length, 1, JSON.stringify(run.forced));
  assert.deepEqual([run.forced[0].family, run.forced[0].chosen, run.forced[0].why], ['check-selection', {outcome: 'no_roll'}, 'jev_unanswered']);
  assert.ok(run.forced[0].uncertain.includes('network_error'), run.forced[0].uncertain.join('; '));
  assert.equal(run.notices.length, 0);
  assert.ok(!run.telemetry.some(row => row.reason === 'check_selection_unresolved_notice'));
});

test('§163 control: a confident roll need is rolled and nothing is forced', async t => {
  const run = await play(t, jev({need: 1}));
  delivered(run);
  assert.equal(run.rolls.length, 1);
  assert.deepEqual(run.forced, []);
  assert.ok(run.notes.every(note => note.decided_under_uncertainty === undefined));
});

/** The engine's projection port alone (the check-preparation-host fixture's shape): which steps force what. */
async function projector() {
  const bus = new Map(), rows = [], emitted = [];
  const pi = {events: {on: (name, fn) => bus.set(name, fn), emit: (name, value) => { emitted.push(name); bus.get(name)?.(value); }},
    on: () => {}, registerTool: () => {}, getActiveTools: () => ['look', 'lookup', 'apply', 'narrate'], setActiveTools: () => {}};
  const engine = createHybridEngine({npcAct: null, env: {}, record: row => rows.push(row),
    decision: {decide: async () => { throw new Error('the projection fixture asks no decision'); }}});
  engine.extension(pi);
  pi.events.emit('coc:kernel-bridge', {campaign: 'c', call: async method => method === 'table.capsule'
    ? {where: {scene: 'office'}, mods: {active: []}, present: [], known: {},
      _context: {version: 1, campaign: 'c', worldline: 'main', loop: 0, turn: 1, source_revision: 'a'.repeat(64)}}
    : method === 'table.status' ? {turn: 1, state: 'open', receipts: []} : {}});
  const plan = engine.runDriver.prepare({runId: 'r', inputRevision: 'input', rawInput: 'I listen at the door.', session: {}});
  const signal = new AbortController().signal;
  await plan.ports.read.read({origin: 'policy', operation: 'read', readOnly: true},
    {runId: 'r', stepId: 'read', operationId: 'read', origin: 'policy', inputRevision: 'input', scopeId: 'root', signal});
  const check = {key: 'resolve:check:core-check:ordinary-check:x', verb: 'resolve', family: 'core-check', label: 'Settle one ordinary check', checkOwner: 'jev',
    bound: {decision: 'core-check:ordinary-check'}, unbound: [{name: 'current check parameters', required: true, vocabulary: 'closed', binder: 'resolve-selection'}]};
  const project = async (step, view = {}) => (await plan.ports.projection.project({view: {policyState: {view: {
    interactionScope: {mode: 'world', reason: 'fixture', calls: 0}, candidates: [check], consumed: [], budget: {jevCalls: 24, jevMs: 0, maxJevCalls: 24, maxJevMs: 1}, ...view}}},
  stepId: 'step', step: {kind: 'infer', ...step}}) ?? []).map(message => JSON.parse(message.content));
  return {rows: () => rows.filter(row => row.lane === 'forced-resolution'), emitted, project, check};
}

for (const [purpose, reason] of [['compose', 'jev_packing_limit'], ['compose', 'jev_schema_error'], ['adjudicate', 'jev_unavailable'], ['adjudicate', 'jev_network_error'],
  ['compose', 'jev_budget']]) test(`§163: a ${purpose} step for ${reason} records the unjudged checks as one forced no-roll and marks it for the Keeper`, async () => {
  const f = await projector();
  const [note] = await f.project({purpose, reason});
  assert.deepEqual(f.rows().map(row => [row.family, row.subject, row.chosen.outcome, row.why]), [['check-selection', 'checks not judged this turn', 'no_roll', reason]]);
  assert.deepEqual(f.rows()[0].uncertain, ['which of the 1 offered check families the declaration needs']);
  assert.deepEqual(note.decided_under_uncertainty.map(entry => [entry.family, entry.chosen.outcome, entry.why]), [['check-selection', 'no_roll', reason]]);
  assert.equal(note.unresolved_checks, undefined);
  assert.equal(note.check_outcome_boundary, undefined);
  if (reason === 'jev_budget') {
    assert.match(note.decision_budget_note, /take no roll this turn/);
    assert.doesNotMatch(note.decision_budget_note, /remain unresolved|Report the limitation/);
  }
  await f.project({purpose, reason});
  assert.equal(f.rows().length, 1, 'recorded once per run');
  assert.ok(!f.emitted.includes('coc:check-selection-unresolved'), 'no notice event');
});

test('§163: a consumed check family, a reference scope or a non-Jev step forces nothing', async () => {
  const consumed = await projector();
  await consumed.project({purpose: 'compose', reason: 'jev_packing_limit'}, {consumed: [consumed.check.key]});
  assert.equal(consumed.rows().length, 0);
  const reference = await projector();
  await reference.project({purpose: 'compose', reason: 'jev_unavailable'}, {interactionScope: {mode: 'reference', reason: 'out_of_fiction_request', calls: 1}});
  assert.equal(reference.rows().length, 0);
  const ordinary = await projector();
  await ordinary.project({purpose: 'compose', reason: 'finish'});
  assert.equal(ordinary.rows().length, 0);
});

test('§163: the check_unresolved compose of a jev-owned clerk check is a recorded forced no-roll naming what it could not bind', async () => {
  const f = await projector();
  const [note] = await f.project({purpose: 'compose', reason: 'check_unresolved',
    request: {candidate: 'blow', operation: {label: 'Strike the ghoul'}, check_unresolved: {cause: 'unknown_binding', unresolved: ['target']}}});
  assert.deepEqual(f.rows().map(row => [row.family, row.subject, row.uncertain, row.chosen.outcome, row.why]),
    [['check-binding', 'Strike the ghoul', ['target'], 'no_roll', 'unknown_binding']]);
  assert.equal(note.unresolved_check, undefined, 'the old unresolved_check field is gone');
  assert.equal(note.decided_under_uncertainty[0].subject, 'Strike the ghoul');
});

test('§163: forced entries the policy recorded reach the telemetry and the Keeper once, in first-seen order', async () => {
  const f = await projector();
  const scope = {key: 'k1', family: 'interaction-scope', subject: 'I listen at the door.', uncertain: ['world action unanswered'], chosen: {outcome: 'world'}, why: 'jev_unanswered'};
  const check = {key: 'k2', family: 'check-selection', subject: 'Listen', uncertain: ['necessity of Listen: roll needed p=0.6'], chosen: {outcome: 'roll', check: 'Listen'}, why: 'below_confidence_gate'};
  const [first] = await f.project({purpose: 'adjudicate', reason: 'ask_llm'}, {forced: [scope]});
  assert.deepEqual(first.decided_under_uncertainty.map(entry => entry.family), ['interaction-scope']);
  assert.equal(first.decided_under_uncertainty[0].key, undefined, 'the host key is not model-visible');
  const [second] = await f.project({purpose: 'compose', reason: 'finish'}, {forced: [scope, check]});
  assert.deepEqual(second.decided_under_uncertainty.map(entry => entry.family), ['check-selection'], 'each entry is shown once');
  assert.deepEqual(f.rows().map(row => row.family), ['interaction-scope', 'check-selection']);
});

test('§163, the turn-9 shape on the emitted kernel: a social influence judged necessary at .75/.74 is adjudicated as Jev\'s best guess, with prose and no notice', async t => {
  const port = {async decide(batch) {
    const firstSkill = batch.questions.find(question => question.type === 'noul' && question.target.startsWith('skill: '));
    const answers = Object.fromEntries(batch.questions.map(rawQuestion => {
      const question = {...rawQuestion, key: baseKey(rawQuestion.key)};
      if (question.type === 'noul') {
        let p = 0.01;
        if (batch.family === 'check-selection-social-method') p = 0.82;
        if (batch.family.startsWith('check-selection-bind') && question.target.startsWith('skill: ')) p = question.target === firstSkill?.target ? 0.9 : 0.01;
        if (batch.family.startsWith('check-selection-need')) p = question.key.endsWith('_blocked') ? (batch.family.endsWith('-refine') ? 0.36 : 0.34) : (batch.family.endsWith('-refine') ? 0.74 : 0.75);
        return [rawQuestion.key, {status: 'answered', type: 'noul', noul: p}];
      }
      let selected;
      if (batch.family === 'single-loop-route' && question.key.startsWith('need_')
        && batch.state.candidates[question.key.replace('need_', 'candidate_')]?.bound?.decision === 'social:adjudicate-difficulty') selected = 'now';
      if (batch.family === 'check-selection-bind') selected = Object.keys(question.criteria).find(key => key !== 'unknown');
      selected ??= question.key === 'exit' ? 'finish' : 'unknown' in question.criteria ? 'unknown' : 'later' in question.criteria ? 'later' : Object.keys(question.criteria)[0];
      return [rawQuestion.key, {status: 'answered', type: 'choice', choice: selected, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected ? 1 : 0]))}];
    }));
    return bindDecisionAnswers(batch, answers, {inputTokens: 1, outputTokens: 1, costUsd: 0});
  }};
  const requests = [];
  const engine = createHybridEngine({env: {...process.env, PI_COC_JEV_PRESELECT: '0', COC_JEV_STEPS: 'off'}, decision: port, compile: false, npcAct: null});
  const table = await openTable({realKernel: true, env: {PI_COC_LOOP_ENGINE: 'hybrid-v1'}, runDriver: engine.runDriver,
    prepareWorkspace: workspace => rpc(workspace, [['table.open', {}], ['table.player_input', {text: 'I am ready.'}],
      ['table.narrate', {call_id: 't1-c1', text: 'Steven Knott waits behind his desk.'}]]),
    extraExtensions: [{name: 'forced-resolution-engine', factory: engine.extension}],
    responses: [context => { requests.push(context); return fauxAssistantMessage([fauxToolCall('narrate', {text: PROSE})], {stopReason: 'toolUse'}); }]});
  t.after(() => table.dispose());
  await table.session.prompt('我跟诺特说我是替房东来查这栋空房子的，想请教几句，请他把知道的都告诉我。');
  const telemetry = table.telemetry();
  delivered({table});
  const forced = telemetry.filter(row => row.lane === 'forced-resolution');
  const social = forced.find(row => row.family === 'check-selection');
  assert.ok(social, JSON.stringify(telemetry.filter(row => row.lane === 'check-selection').map(row => [row.purpose, row.status, row.needs])));
  assert.equal(social.chosen.outcome, 'roll');
  assert.equal(social.chosen.action.decision, 'social:adjudicate-difficulty');
  assert.deepEqual(social.uncertain.filter(entry => entry.startsWith('necessity of')).map(entry => entry.endsWith(': needed now p=0.75, prerequisite unmet p=0.34')), [true],
    social.uncertain.join('; '));
  const settled = telemetry.filter(row => row.tool === 'resolve' && row.origin === 'policy');
  assert.equal(settled.length, 1, 'the host proposed the adjudication through the canonical gateway');
  assert.equal(settled[0].ok, true, JSON.stringify(settled[0]));
  assert.ok(requests.flatMap(clerkNotes).some(note => note.decided_under_uncertainty?.some(entry => entry.chosen.outcome === 'roll')));
  assert.equal(table.session.messages.filter(message => message.customType === 'coc-delivery' && message.details?.check_selection_unresolved).length, 0);
});

// ---- §163.8 (owner ruling 2026-10-01: 「玩家的选择不替他定」): the player's own choices are never Jev's best guess ----------

/**
 * Jev at the Globe's newspaper morgue, where Arty Wilmot and Ruth Blake are both present: the route examines the social family,
 * the investigator's influence method is clear (.82), and each target's necessity is `needs` (prerequisites .3). `skill`
 * is the first issued skill's independent compatibility Noul; the other skills are ruled out.
 */
function globeJev({needs, skill}) {
  return {async decide(batch) {
    const firstSkill = batch.questions.find(question => question.type === 'noul' && question.target.startsWith('skill: '));
    const answers = Object.fromEntries(batch.questions.map(rawQuestion => {
      const question = {...rawQuestion, key: baseKey(rawQuestion.key)};
      if (question.type === 'noul') {
        let p = 0.01;
        if (batch.family === 'check-selection-social-method') p = 0.82;
        if (batch.family.startsWith('check-selection-bind') && question.target.startsWith('skill: '))
          p = question.target === firstSkill?.target ? skill ?? 1 : 0.01;
        if (batch.family.startsWith('check-selection-need')) {
          const check = batch.state.checks[question.key.replace(/_blocked$/, '')];
          p = question.key.endsWith('_blocked') ? 0.3 : needs[check?.action?.target] ?? 0.01;
          if (question.key.endsWith('_selected')) {
            const alternative = batch.state.checks[question.key.replace(/_selected$/, '')];
            const selected = Object.entries(needs).filter(([, score]) => score > .5);
            p = selected.length === 1 && selected[0][0] === alternative?.action?.target ? .99 : .01;
          }
        }
        return [rawQuestion.key, {status: 'answered', type: 'noul', noul: p}];
      }
      let selected, p = 1;
      if (batch.family === 'single-loop-route' && question.key.startsWith('need_')
        && batch.state.candidates[question.key.replace('need_', 'candidate_')]?.bound?.decision === 'social:adjudicate-difficulty') selected = 'now';
      selected ??= question.key === 'exit' ? 'finish' : 'unknown' in question.criteria ? 'unknown' : 'later' in question.criteria ? 'later' : Object.keys(question.criteria)[0];
      const keys = Object.keys(question.criteria);
      return [rawQuestion.key, {status: 'answered', type: 'choice', choice: selected, confidence: p,
        probabilities: Object.fromEntries(keys.map(key => [key, key === selected ? p : (1 - p) / (keys.length - 1)]))}];
    }));
    return bindDecisionAnswers(batch, answers, {inputTokens: 1, outputTokens: 1, costUsd: 0});
  }};
}
async function atTheGlobe(t, port, text) {
  const requests = [];
  const engine = createHybridEngine({env: {...process.env, PI_COC_JEV_PRESELECT: '0', COC_JEV_STEPS: 'off'}, decision: port, compile: false, npcAct: null});
  const table = await openTable({realKernel: true, env: {PI_COC_LOOP_ENGINE: 'hybrid-v1'}, runDriver: engine.runDriver,
    prepareWorkspace: workspace => rpc(workspace, [['table.open', {}], ['table.player_input', {text: '我去报馆'}],
      ['table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'newspaper-morgue'}]}], ['table.narrate', {call_id: 't1-c2', text: '你到了报馆。'}]]),
    extraExtensions: [{name: 'forced-resolution-engine', factory: engine.extension}],
    responses: [context => { requests.push(context); return fauxAssistantMessage([fauxToolCall('narrate', {text: PROSE})], {stopReason: 'toolUse'}); }]});
  t.after(() => table.dispose());
  await table.session.prompt(text);
  const telemetry = table.telemetry();
  return {table, telemetry, notes: requests.flatMap(clerkNotes), forced: telemetry.filter(row => row.lane === 'forced-resolution'),
    rolls: telemetry.filter(row => row.tool === 'resolve' && row.origin === 'policy' && row.ok)};
}

test('§163.8: two people the player might mean, both gray -- no target is chosen for the player; a recorded player_choice no-roll and prose', async t => {
  const run = await atTheGlobe(t, globeJev({needs: {'Arty Wilmot': 0.74, 'Ruth Blake': 0.7}}), '我想办法说服这里的人让我进剪报室。');
  delivered(run);
  assert.equal(run.rolls.length, 0, 'neither target was adjudicated on a guess');
  const row = run.forced.find(entry => entry.family === 'check-selection');
  assert.deepEqual([row.chosen.outcome, row.why.split(',').includes('player_choice')], ['no_roll', true], JSON.stringify(run.forced));
  assert.ok(row.uncertain.some(entry => /alternatives the player has not settled/.test(entry)), row.uncertain.join('; '));
  const marked = run.notes.find(note => note.decided_under_uncertainty);
  assert.match(marked.decided_under_uncertainty_note, /player_choice/);
});

test('§163.8 control: the other person confidently ruled out, the remaining target is not the player\'s open choice -- Jev\'s best guess is adjudicated', async t => {
  const run = await atTheGlobe(t, globeJev({needs: {'Arty Wilmot': 0.74, 'Ruth Blake': 0.05}}), '我想办法说服阿蒂让我进剪报室。');
  delivered(run);
  assert.equal(run.rolls.length, 1);
  const row = run.forced.find(entry => entry.family === 'check-selection');
  assert.deepEqual([row.chosen.outcome, row.why], ['roll', 'below_confidence_gate']);
  assert.equal(row.chosen.action.target, 'Arty Wilmot');
});

test('§163: social skill compatibility all strongly denied -- no mapping, no execution, recorded, prose', async t => {
  const run = await atTheGlobe(t, globeJev({needs: {'Arty Wilmot': 0.9, 'Ruth Blake': 0.05}, skill: 0.01}), '我想办法让阿蒂松口，放我进剪报室。');
  delivered(run);
  assert.equal(run.rolls.length, 0);
  const row = run.forced.find(entry => entry.family === 'check-selection');
  assert.deepEqual([row.chosen.outcome, row.why], ['no_roll', 'nothing_executable']);
  assert.ok(row.uncertain.includes('skill: no issued compatible value is available'), row.uncertain.join('; '));
  assert.ok(row.uncertain.every(entry => !entry.includes('unanswered')), row.uncertain.join('; '));
});
