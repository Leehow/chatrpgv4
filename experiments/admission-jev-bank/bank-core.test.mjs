// Offline bank reconstruction on a synthetic campaign; no retained evidence is read here.
import {strict as assert} from 'node:assert';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {admissionRequest, keyDigest} from '../../extensions/kernel/admission.ts';
import {pairTurn, sessionTurns, turnCases} from './bank-core.mjs';
import {sample, summarize} from './replay.mjs';

function campaign(t) {
  const dir = mkdtempSync(join(tmpdir(), 'admission-bank-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  mkdirSync(join(dir, 'turns'));
  writeFileSync(join(dir, 'campaign.json'), JSON.stringify({play_language: 'en'}));
  writeFileSync(join(dir, 'turns', '0001.json'), JSON.stringify({turn: 1, player_text: 'hello', rendered_text: 'Knott points at the Globe.'}));
  writeFileSync(join(dir, 'turns', '0002.json'), JSON.stringify({turn: 2, player_text: 'I go to the Globe',
    capsule: {where: {scene: 'office', display_name: 'Office'}, present: [{name: 'Knott'}], known: {investigator: {name: 'Thomas', occupation: 'journalist'}}}}));
  return dir;
}
const resolveArgs = {action: {intent: 'investigate', goal: 'search', method: 'look', skill: 'Spot Hidden'}};
const applyArgs = {effects: [{kind: 'time', minutes: 10}]};

test('rows pair by the product key digest first, then by order when the unmatched counts agree', () => {
  const scope = {party: ['Thomas']};
  const digest = keyDigest(admissionRequest('resolve', resolveArgs, scope).key);
  const rows = [{verb: 'apply', key: 'stale-format', verdict: 'entailed'}, {verb: 'resolve', key: digest, verdict: 'authorized'}];
  const {pairs} = pairTurn([{name: 'apply', args: applyArgs}, {name: 'resolve', args: resolveArgs}], rows, scope);
  assert.equal(pairs.get(1).pairing, 'digest');
  assert.equal(pairs.get(0).pairing, 'order');
  // Two apply calls against one unmatched row: order pairing would be a guess, so none is made.
  const unmatched = pairTurn([{name: 'apply', args: applyArgs}, {name: 'apply', args: {effects: [{kind: 'clue', clue: 'x'}]}}],
    [{verb: 'apply', key: 'other', verdict: 'authorized'}], scope);
  assert.equal(unmatched.pairs.size, 0);
});

test('a case carries the lane view rebuilt from committed turns, with what the turn already settled and refused', t => {
  const dir = campaign(t);
  const tools = [
    {name: 'apply', args: {effects: [{kind: 'clue', clue: 'x'}]}, ok: false},
    {name: 'resolve', args: resolveArgs, ok: true, result: JSON.stringify({outcome: {kind: 'check'}})},
    {name: 'apply', args: applyArgs, ok: true},
  ];
  const rows = [{verb: 'apply', key: 'a', verdict: 'not_authorized', missing: 'the clue'}, {verb: 'resolve', key: 'b', verdict: 'authorized'},
    {verb: 'apply', key: 'c', verdict: 'entailed'}];
  const cases = turnCases({source: {kind: 'driver', run: 'r'}, campaign: 'c', dir, turn: 2, tools, rows});
  assert.equal(cases.length, 3);
  const last = cases[2];
  assert.equal(last.input.playerText, 'I go to the Globe');
  assert.deepEqual(last.input.investigators, [{name: 'Thomas', occupation: 'journalist'}]);
  assert.equal(last.input.scene, 'Office');
  assert.deepEqual(last.input.delivered, [{turn: 1, player: 'hello', keeper: 'Knott points at the Globe.'}]);
  assert.deepEqual(last.input.landed, ['resolve settled (check)']);
  assert.deepEqual(last.input.refused, ['apply clue: clue="x" -> not_authorized: the clue']);
  assert.ok(last.notes.includes('setup_prologue_omitted'));
});

test('a session pairs each tool call with the admission row written between it and its result', t => {
  const dir = mkdtempSync(join(tmpdir(), 'admission-session-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const file = join(dir, 's.jsonl');
  const lines = [
    {type: 'message', message: {role: 'assistant', content: [{type: 'toolCall', id: 'c1', name: 'apply', arguments: applyArgs}]}},
    {type: 'custom', customType: 'coc-telemetry', data: {turn: 4, lane: 'admission', verb: 'apply', ok: true, verdict: 'entailed', reused: false, key: 'k', run_id: 'r1'}},
    {type: 'message', message: {role: 'toolResult', toolCallId: 'c1', toolName: 'apply', isError: false, content: [{type: 'text', text: '{"receipts":["time:t4"]}'}]}},
  ];
  writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n'));
  const [turn] = sessionTurns(file);
  assert.equal(turn.turn, 4);
  assert.equal(turn.tools[0].row.verdict, 'entailed');
  assert.equal(turn.tools[0].ok, true);
});

test('agreement is computed per threshold from stored answers, and false admits are counted apart', () => {
  const rows = [
    {lane: 'authorized', route: 'typed', jev: 'authorized', confidence: 0.95},
    {lane: 'not_authorized', route: 'typed', jev: 'authorized', confidence: 0.92},
    {lane: 'not_authorized', route: 'typed', jev: 'not_authorized', confidence: 0.6},
    {lane: 'entailed', route: 'lane_only', reason: 'numeric_commitment'},
  ];
  const summary = summarize(rows);
  const at = threshold => summary.by_threshold.find(row => row.threshold === threshold);
  assert.equal(at(0).decided, 3);
  assert.equal(at(0).false_admits, 1);
  assert.equal(at(0.9).decided, 2);
  assert.equal(at(0.9).exact_agreement, 0.5);
  assert.equal(at(0.95).false_admits, 0);
  assert.deepEqual(summary.routes, {typed: 3, 'lane_only:numeric_commitment': 1});
  assert.equal(sample([{lane: {verdict: 'a'}}, {lane: {verdict: 'a'}}, {lane: {verdict: 'b'}}], 1, 7).length, 2);
});
