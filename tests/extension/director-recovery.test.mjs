/**
 * D4 keeps Director obstacle signals and adoption telemetry advisory. Legacy recovery debt in a
 * retained capsule cannot refuse narration, steer another model round, or require a world effect.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';
import {openTable, waitForIdle} from './harness.mjs';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';

const bundled = await build({
  stdin: {contents: `export {blockedAttempts, obstacleKey, score, signals} from './kernel-ts/read/director.ts';
	export {RECOVERY_TAKES} from './kernel-ts/read/offer.ts';
	export {directorAdoption} from './kernel-ts/write/text.ts';
	export {DirectorGraph} from './kernel-ts/read/content.ts';
	export {parsePythonJson} from './kernel-ts/json.ts';`, resolveDir: process.cwd()},
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const {blockedAttempts, obstacleKey, score, RECOVERY_TAKES, directorAdoption, DirectorGraph, parsePythonJson} =
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
  // The advisory obstacle signal is scoped to the current scene; it never follows the party as debt.
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

// ---- adoption remains advisory telemetry ---------------------------------

test('recovery receipt kinds remain a telemetry vocabulary, not a delivery debt', () => {
  assert.deepEqual(RECOVERY_TAKES, ['clue', 'move', 'npc', 'session', 'handout', 'map', 'item']);
});

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

// ---- legacy debt is inert ------------------------------------------------

const LEGACY_OWED = JSON.stringify({beat: 'RECOVER', recovery: {owed: true, blocked: 2, takes: ['clue', 'move'],
  steps: [{rung: 'person', operation: 'apply clue', line: 'Mr. Dooley can hand dooley-macario-madness now'}],
  note: 'One of these lands this turn, or the turn first narrate is refused once.'}});

for (const example of [
  {name: 'quiet observation', input: 'I stay here and listen.', text: 'The room settles into a long, ordinary silence.'},
  {name: 'informed refusal', input: 'I refuse the offer and remain where I am.', text: 'Dooley accepts the refusal and turns back to his papers.'},
]) test(`legacy recovery debt does not block first-attempt ${example.name}`, async (t) => {
  const table = await openTable({
    env: {FAKE_KERNEL_DIRECTOR: LEGACY_OWED},
    responses: [fauxAssistantMessage([fauxToolCall('narrate', {text: example.text})], {stopReason: 'toolUse'})],
  });
  t.after(() => table.dispose());

  await table.session.prompt(example.input);
  await waitForIdle(table.session);

  const requests = table.kernelRequests();
  assert.deepEqual(requests.filter((entry) => entry.method === 'table.narrate').map((entry) => entry.params.text), [example.text]);
  assert.equal(requests.some((entry) => ['table.resolve', 'table.apply'].includes(entry.method)), false,
    'legacy debt cannot manufacture a roll, movement, item, clue, or other effect');
  assert.equal(table.faux.state.callCount, 1, 'the first legal narration is delivered without a recovery steer');
  assert.deepEqual(table.telemetry().filter((row) => row.lane === 'recovery'), []);
  assert.equal(table.committed().length, 1);
});
