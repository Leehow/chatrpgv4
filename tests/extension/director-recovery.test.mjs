/**
 * The Director's recovery (contract §40): the one part of the Director section that is not advice.
 *
 * The defect these cover, from campaign game-83177d61 (a real table, reported by the player):
 *   - the beat was RECOVER on 17 turns and CUT on 8, and `adopted` was false on 43 of 52 signals,
 *     because nothing in the system required anything of the Keeper when the Director asked;
 *   - `stalled_turns` reset on any clue, move or session receipt, so the same nailed cupboard —
 *     STR against 40 in the same room, failed on turns 34, 41, 60 and 62, never passed — read as
 *     `stalled_turns = 4, ?, 0, 2` and the Director never saw the obstacle at all;
 *   - `directorAdoption` called RECOVER adopted only on a `healing` or `development` family, which
 *     no rung of the keeper-pacing ladder produces, so a turn that recovered read as declined.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';
import {openTable, waitForIdle, customMessages} from './harness.mjs';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';

const bundled = await build({
  stdin: {contents: `export {blockedAttempts, obstacleKey, score, signals} from './kernel-ts/read/director.ts';
export {directorRecovery, RECOVERY_TAKES, RECOVERY_BEATS} from './kernel-ts/read/offer.ts';
export {directorAdoption} from './kernel-ts/write/text.ts';
export {DirectorGraph} from './kernel-ts/read/content.ts';
export {parsePythonJson} from './kernel-ts/json.ts';`, resolveDir: process.cwd()},
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const {blockedAttempts, obstacleKey, score, directorRecovery, RECOVERY_TAKES, directorAdoption, DirectorGraph, parsePythonJson} =
  await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

// The kernel reads its content with `parsePythonJson` so that int/float identity survives (the digest is
// over the canonical form); plain JSON.parse turns 2 into 2.0 and the manifest check fails on the real graph.
const content = (name) => parsePythonJson(readFileSync(join(process.cwd(), 'content/director', name), 'utf8'));
const graph = new DirectorGraph(content('director-graph.json'), content('director-graph-manifest.json'));

/** One played turn: the place it happened in and the receipts it landed. */
const played = (scene, ...receipts) => ({world: {scene: {name: scene}}, player_text: 'x', receipts});
const check = (skill, threshold, passed) => ({kind: 'roll', skill, threshold, target: threshold, passed, form: 'check'});
const HOUSE = 'corbitt-house-ground';

// ---- the obstacle signal -------------------------------------------------

test('the same obstacle failed twice counts, even with a clue and a move in between', () => {
  // Turns 62, 61, 60 of the live campaign: pry, look (and find something), pry again.
  const history = [
    played(HOUSE, check('STR', 40, false)),
    played(HOUSE, check('Spot Hidden', 71, true), {kind: 'clue', clue: 'nail-age'}),
    played(HOUSE, check('STR', 40, false)),
    played('chapel-cellar', {kind: 'move', to: HOUSE}),
  ];
  assert.equal(blockedAttempts(history, HOUSE), 2);
  // stalled_turns would have been 0 here: the move and the clue both reset it.
});

test('four failures across twenty-eight turns are still one obstacle', () => {
  const far = [played(HOUSE, check('STR', 40, false))];
  for (let i = 0; i < 26; i += 1) far.push(played(HOUSE, {kind: 'time', minutes: 5}));
  far.push(played(HOUSE, check('STR', 40, false)));
  assert.equal(blockedAttempts(far, HOUSE), 2);
});

test('passing the check clears its count, and only its own', () => {
  const history = [
    played(HOUSE, check('STR', 40, false)),
    played(HOUSE, check('STR', 40, true)),
    played(HOUSE, check('STR', 40, false)),
    played(HOUSE, check('STR', 40, false)),
  ];
  assert.equal(blockedAttempts(history, HOUSE), 1);
});

test('a pass and a fail inside one turn read in order: the push cleared it', () => {
  assert.equal(blockedAttempts([played(HOUSE, check('STR', 40, false), check('STR', 40, true))], HOUSE), 0);
});

test('another skill and another target are other obstacles', () => {
  const history = [
    played(HOUSE, check('STR', 40, false)),
    played(HOUSE, check('STR', 80, false)),
    played(HOUSE, check('Climb', 40, false)),
  ];
  assert.equal(blockedAttempts(history, HOUSE), 1);
});

test('an obstacle in a room the party has left says nothing about the room they are in', () => {
  // The recovery is owed where the player is standing: a cellar they climbed out of is not this scene.
  const elsewhere = [played('chapel-cellar', check('STR', 40, false)), played('chapel-cellar', check('STR', 40, false))];
  assert.equal(blockedAttempts(elsewhere, HOUSE), 0);
  assert.equal(blockedAttempts(elsewhere, 'chapel-cellar'), 2);
});

test('a die the Keeper asked for is not an obstacle', () => {
  const dice = played(HOUSE, {kind: 'roll', form: 'dice', skill: 'damage', passed: false});
  assert.equal(obstacleKey(dice, dice.receipts[0]), null);
  assert.equal(blockedAttempts([dice, dice], HOUSE), 0);
});

// ---- the Director scores on it ------------------------------------------

const signalRow = (over = {}) => ({
  structure_type: 'branching_investigation', intent: 'investigate', undiscovered_here: 0, agenda_npc_present: 0,
  dramatic_question: false, exit_condition_met: false, main_line_complete: false, stalled_turns: 0,
  blocked_attempts: 0, empty_turns: 0, repeat_input: false, previous_close: 'explicit', turns_in_scene: 2,
  hp_state: 'healthy', sanity_state: 'stable', session: 'none', last_roll: 'failed', pushed_fail_pending: false,
  pending_choice: false, clock_near_full: false, loop_count: 0, echoes_here: 0, loop_available: false, ...over});
const scored = (over) => score(graph, signalRow(over), {}, {canMove: false, overlap: 0, pressureAvailable: false});

test('two failures at one obstacle put RECOVER on the board with no stalled turns at all', () => {
  const one = scored({blocked_attempts: 1});
  assert.notEqual(one.beat, 'RECOVER', 'the first failure is play: the risk was real and it cost');
  const two = scored({blocked_attempts: 2});
  assert.equal(two.beat, 'RECOVER');
  assert.match(two.reason, /blocked-attempts/);
  assert.ok(two.because.includes('blocked_attempts = 2'), 'the Director says what it read');
  assert.ok(two.hit_rules.includes('scoring-rule:recover:blocked-attempts'));
});

// ---- the recovery carries operations, not advice -------------------------

const sources = (over = {}) => ({
  present: [], where: {exits: []}, affordances: [], pressures: [], obligations: [], offer: [], previous: null, ...over});

test('no recovery is owed on an ordinary beat with nothing blocking', () => {
  assert.equal(directorRecovery('REVEAL', 0, sources()), null);
  assert.equal(directorRecovery('PRESSURE', 0, sources()), null);
});

test('a recovery beat and a blocked obstacle each owe one', () => {
  assert.ok(directorRecovery('RECOVER', 0, sources()));
  assert.ok(directorRecovery('CUT', 0, sources()));
  // Live turns 60 and 62 scored CUT and REVEAL while the party was on its third and fourth failure at one
  // cupboard: the beat can be outranked, so the obstacle owes a recovery on its own account.
  assert.ok(directorRecovery('REVEAL', 2, sources()));
});

test('the count below the authored threshold reaches this as 0, and owes nothing', () => {
  // assemble.ts passes `blocked` only once it has reached `threshold:recover-blocked-attempts` (2); one
  // failed check in a room is play, not a stall, and must not put a gate in front of an ordinary turn.
  assert.equal(directorRecovery('REVEAL', 0, sources()), null);
  assert.equal(directorRecovery('PAYOFF', 0, sources()), null);
});

test('the unanswered push continuation comes back as the operation that answers it', () => {
  const owed = directorRecovery('RECOVER', 2, sources({
    obligations: [{kind: 'continuation', name: 'push-luck:pushed-roll', cue: 'needs action.push/stakes/method'},
                  {kind: 'quest', name: 'End the Corbitt Threat'}]}));
  const push = owed.steps.find((step) => step.decision === 'push-luck:pushed-roll');
  assert.ok(push, 'the rules own retry is a step, and it was sitting unanswered on every turn of the live table');
  assert.equal(push.operation, 'resolve');
  assert.equal(push.rung, 'consequence');
  assert.ok(owed.steps.every((step) => typeof step.operation === 'string' && step.operation.length > 0),
    'every step names the verb that discharges it: a signal with no next operation is a line about itself');
});

test('a person who can hand a clue, this room, and the way out are the other two rungs', () => {
  const owed = directorRecovery('RECOVER', 0, sources({
    offer: [{kind: 'person', who: 'Mr. Dooley', can_hand: ['dooley-macario-madness'], line: 'wants: to sell papers'},
            {kind: 'route', where: 'chapel-ruins', line: 'the way to chapel-ruins is open'}],
    affordances: [{id: 'nailed-cupboard', clues: [{clue: 'cellar-stair'}]}]}));
  const kinds = owed.steps.map((step) => [step.rung, step.operation].join(' '));
  assert.ok(kinds.includes('person apply clue'));
  assert.ok(kinds.includes('information apply clue'));
  assert.ok(kinds.includes('information apply move'));
  assert.deepEqual(owed.takes, RECOVERY_TAKES);
  assert.match(owed.note, /narrate is refused once/);
  assert.match(owed.note, /irreversible choice for the player/, 'the ladder never chooses for the player');
});

// ---- adoption measures the ladder, not first aid -------------------------

const adoption = (receipts, calls = {}) =>
  directorAdoption({kind: () => [], incoming: new Map(), nodes: new Map()},
    {capsule: {director: {beat: 'RECOVER'}}, receipts, calls}, {present: []}, 'narrate');

test('a clue, a person or a place reached the player: RECOVER was adopted', () => {
  for (const receipt of [{kind: 'clue', id: 'clue:a'}, {kind: 'npc', id: 'npc:a'}, {kind: 'move', id: 'move:a'}])
    assert.equal(adoption([receipt]).adopted, true, `${receipt.kind} is a rung of the ladder`);
  // Live turn 49: a move, an npc receipt and a clue — and the old test reported adopted: false.
  const live = adoption([{kind: 'move', id: 'move:t49'}, {kind: 'npc', id: 'npc:t49'}, {kind: 'clue', id: 'clue:t49'}]);
  assert.equal(live.adopted, true);
  assert.deepEqual(live.evidence, ['move:t49', 'npc:t49', 'clue:t49']);
});

test('the rulebook push is adoption; the same ordinary check again is not', () => {
  assert.equal(adoption([{kind: 'roll', id: 'roll:a'}], {c1: {result: {outcome: {pushed: true}}}}).adopted, true);
  assert.equal(adoption([{kind: 'roll', id: 'roll:a'}], {c1: {result: {outcome: {pushed: false, passed: false}}}}).adopted, false);
  assert.equal(adoption([{kind: 'definition', id: 'definition:a'}, {kind: 'time', id: 'time:a'}]).adopted, false);
});

// ---- the host makes it a step -------------------------------------------

const OWED = JSON.stringify({beat: 'RECOVER', recovery: {owed: true, blocked: 2, takes: ['clue', 'move'],
  steps: [{rung: 'person', operation: 'apply clue', line: 'Mr. Dooley can hand dooley-macario-madness now'}],
  note: 'One of these lands this turn, or the turn first narrate is refused once.'}});

test('导演要求恢复而这一回合什么都没动：第一次 narrate 被拒一次，第二段照常交付', async (t) => {
  const thin = '柜子纹丝不动。楼上又沉了一下。';
  const full = '杜利从门口探头进来，把短撬棍递过来：「你撬，我撑。」';
  const table = await openTable({
    env: {FAKE_KERNEL_DIRECTOR: OWED, FAKE_KERNEL_CHECK_FAILS: '1'},
    responses: [
      fauxAssistantMessage([fauxToolCall('resolve', {action: {intent: 'investigate', goal: '撬柜子', method: '蛮力', skill: 'STR'}})], {stopReason: 'toolUse'}),
      fauxAssistantMessage([fauxToolCall('narrate', {text: thin})], {stopReason: 'toolUse'}),
      fauxAssistantMessage([fauxToolCall('narrate', {text: full})], {stopReason: 'toolUse'}),
    ],
  });
  t.after(() => table.dispose());

  await table.session.prompt('再撬一次');
  await waitForIdle(table.session);

  const narrates = table.kernelRequests().filter((entry) => entry.method === 'table.narrate');
  assert.deepEqual(narrates.map((entry) => entry.params.text), [full], 'the first draft never reached the kernel');
  const rows = table.telemetry().filter((row) => row.lane === 'recovery');
  assert.equal(rows.length, 1, 'the refusal is spent once, so the table can never hang on it');
  assert.equal(rows[0].blocked, 2);
});

test('这一回合把线索送到了玩家手里：不拦', async (t) => {
  const text = '杜利把那句话说完了。';
  const table = await openTable({
    env: {FAKE_KERNEL_DIRECTOR: OWED},
    responses: [
      fauxAssistantMessage([fauxToolCall('apply', {effects: [{kind: 'clue', clue: 'dooley-macario-madness'}]})], {stopReason: 'toolUse'}),
      fauxAssistantMessage([fauxToolCall('narrate', {text})], {stopReason: 'toolUse'}),
    ],
  });
  t.after(() => table.dispose());

  await table.session.prompt('问杜利');
  await waitForIdle(table.session);

  assert.deepEqual(table.kernelRequests().filter((e) => e.method === 'table.narrate').map((e) => e.params.text), [text]);
  assert.deepEqual(table.telemetry().filter((row) => row.lane === 'recovery'), []);
});

test('胶囊没说欠恢复：不拦', async (t) => {
  const text = '你在门框上摸到一道抓痕。';
  const table = await openTable({
    env: {FAKE_KERNEL_CHECK_FAILS: '1'},
    responses: [
      fauxAssistantMessage([fauxToolCall('resolve', {action: {intent: 'investigate', goal: '看门框', method: '侦查', skill: 'Spot Hidden'}})], {stopReason: 'toolUse'}),
      fauxAssistantMessage([fauxToolCall('narrate', {text})], {stopReason: 'toolUse'}),
    ],
  });
  t.after(() => table.dispose());

  await table.session.prompt('我看门框');
  await waitForIdle(table.session);

  assert.deepEqual(table.kernelRequests().filter((e) => e.method === 'table.narrate').map((e) => e.params.text), [text]);
  assert.deepEqual(table.telemetry().filter((row) => row.lane === 'recovery'), []);
});
