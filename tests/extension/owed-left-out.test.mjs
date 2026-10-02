/**
 * Contract §168.4: an `owed` annotation that does not hold is left out, and the write goes on as an ordinary write.
 *
 * Installed App 153469067, Blood Road, campaign game-717a9e4b, turn 3 (2026-10-02): the Keeper finally wrote the Esso
 * station and the three men under its awning in full, inside `apply.narrate`, beside `apply npc` whose `owed` was the
 * capsule's §51.4 unrecorded line ("turn 2 gave 拉塞尔·威廉姆斯 lines here and the books have them at book-4-prologue;
 * ..."). `owed_unknown` refused the batch and the narration was never delivered.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {leaveOutRefused, leaveOutUnknownOwed, owedLeftOutNote} from '../../extensions/kernel/owed-left-out.ts';

const UNRECORDED = 'turn 2 gave 拉塞尔·威廉姆斯 lines here and the books have them at book-4-prologue; apply npc book-4-lars-williams to: here makes the two agree';

test('before admission: a name the capsule never offered is left out; an offered one, and every effect without owed, stay', () => {
  const effects = [{kind: 'npc', name: 'Knott', to: 'here', owed: UNRECORDED}, {kind: 'time', minutes: 5, owed: 't1-owed-2'}, {kind: 'cash', delta: '-5'}, {kind: 'move', to: 'x', owed: ''}];
  const left = leaveOutUnknownOwed(effects, [{name: 't1-owed-2'}]);
  assert.deepEqual(left.map(entry => [entry.index, entry.reason]), [[0, 'owed_unknown'], [3, 'owed_unknown']]);
  assert.equal(Object.hasOwn(effects[0], 'owed'), false);
  assert.equal(effects[1].owed, 't1-owed-2', 'a valid row is still landed as told, never twice');
  assert.deepEqual(effects[2], {kind: 'cash', delta: '-5'});
  // No capsule read yet: the host has no view, so the kernel decides.
  const untouched = [{kind: 'npc', name: 'Knott', to: 'here', owed: UNRECORDED}];
  assert.deepEqual(leaveOutUnknownOwed(untouched, undefined), []);
  assert.equal(untouched[0].owed, UNRECORDED);
});

test('after a kernel refusal: only the refused effect loses its field; other refusals stand', () => {
  const effects = () => [{kind: 'move', to: 'newspaper-morgue', owed: 't1-owed-1'}, {kind: 'time', minutes: 5, owed: 't1-owed-2'}];
  for (const reason of ['owed_unknown', 'owed_mismatch', 'owed_not_told', 'owed_unresolved']) {
    const batch = effects();
    assert.deepEqual(leaveOutRefused({field: 'owed', reason, owed: 't1-owed-1'}, batch).map(entry => entry.index), [0], reason);
    assert.equal(batch[1].owed, 't1-owed-2');
  }
  const batch = effects();
  assert.deepEqual(leaveOutRefused({field: 'owed', reason: 'owed_kind', kind: 'time'}, batch).map(entry => entry.index), [1]);
  assert.deepEqual(leaveOutRefused({field: 'effects', reason: 'owed_unknown', owed: 't1-owed-1'}, effects()), [], 'not an owed refusal');
  assert.deepEqual(leaveOutRefused({field: 'owed', reason: 'outage', owed: 't1-owed-1'}, effects()), []);
  assert.deepEqual(leaveOutRefused({field: 'owed', reason: 'owed_unknown', owed: 't9-owed-9'}, effects()), [], 'names no effect of this batch');
  assert.match(owedLeftOutNote([{owed: UNRECORDED, reason: 'owed_unknown', kind: 'npc', index: 0}]), /left out and the effect landed as an ordinary write/);
});

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAMPAIGN = 'test-camp';
function kernelSteps(workspace, requests) {
  const input = requests.map((request, index) => JSON.stringify({id: String(index), method: request[0], params: {campaign: CAMPAIGN, ...request[1]}})).join('\n');
  const run = spawnSync(process.execPath, [join(REPO, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(REPO, 'content')],
    {cwd: REPO, input: `${input}\n`, encoding: 'utf8'});
  const frames = run.stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)).filter(frame => !frame.progress);
  for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
  return frames.map(frame => frame.result);
}
const HOUSE = 'You drive across town and pull up at the Corbitt house.';
const ROW = {name: 't1-owed-1', turn: 1, kind: 'move', effect: {kind: 'move', to: 'corbitt-house-ground', via: 'Drove across town to the house.', travel_minutes: 30},
  quote: HOUSE, what: 'arrival at The Corbitt House (corbitt-house-ground), via: Drove across town to the house.', job: '0'.repeat(64), at: '2026-09-29T00:00:00Z'};
const toldNoMove = workspace => {
  kernelSteps(workspace, [['table.open', {}], ['table.player_input', {text: '我开车去科比特宅。'}], ['table.narrate', {call_id: 't1-c1', text: HOUSE}]]);
  writeFileSync(join(workspace, '.coc/campaigns', CAMPAIGN, 'owed.json'), JSON.stringify({open: [ROW], closed: []}));
};
const verdict = value => fauxAssistantMessage(JSON.stringify(value));
const turnRecord = (session, turn) => JSON.parse(readFileSync(join(session.workspace, '.coc/campaigns', CAMPAIGN, 'turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));
const PROSE = '你在门前站了五分钟，盯着小径上那串新鲜的泥脚印，门廊的油漆剥落成一片片灰白。';

test('on the real tool path: the turn-3 shape -- an unrecorded line sent as owed is left out, the write lands and its narration is delivered', async t => {
  const session = await openTable({realKernel: true, prepareWorkspace: toldNoMove, responses: [
    fauxAssistantMessage([fauxToolCall('apply', {effects: [{kind: 'time', minutes: 5, why: 'The investigator waits at the door.', owed: UNRECORDED}], narrate: PROSE})], {stopReason: 'toolUse'})],
    laneResponses: {admission: [verdict({verdict: 'authorized', grounds: 'The player waits at the door.'})]}});
  t.after(() => session.dispose());
  await session.session.prompt('我在门口等一会儿，看看小径上的脚印。');
  const left = session.telemetry().filter(row => row.lane === 'owed' && row.event === 'owed_left_out');
  assert.deepEqual(left.map(row => [row.stage, row.reason, row.owed]), [['before_admission', 'owed_unknown', UNRECORDED]]);
  const admission = session.telemetry().find(row => row.lane === 'admission' && row.verb === 'apply');
  assert.notEqual(admission.path, 'told', 'reviewed as the ordinary write it is');
  const record = turnRecord(session, 2);
  assert.ok(record.receipts.some(receipt => receipt.kind === 'time'), 'the write landed');
  assert.ok(String(record.rendered_text).includes('门廊的油漆剥落成一片片灰白'), 'the narration reached the player');
  const result = session.session.messages.find(message => message.role === 'toolResult' && message.toolName === 'apply');
  assert.match(JSON.stringify(result.content), /left out and the effect landed as an ordinary write/);
});

test('on the real tool path: an open row the effect does not land is left out after the kernel refuses it, and the write is reviewed as ordinary', async t => {
  const session = await openTable({realKernel: true, prepareWorkspace: toldNoMove, responses: [
    fauxAssistantMessage([fauxToolCall('apply', {effects: [{kind: 'time', minutes: 5, why: 'The investigator waits.', owed: ROW.name}], narrate: PROSE})], {stopReason: 'toolUse'})],
    laneResponses: {admission: [verdict({verdict: 'authorized', grounds: 'The player waits at the door.'})]}});
  t.after(() => session.dispose());
  await session.session.prompt('我在门口等一会儿。');
  const left = session.telemetry().filter(row => row.lane === 'owed' && row.event === 'owed_left_out');
  assert.deepEqual(left.map(row => [row.stage, row.reason]), [['kernel_refused', 'owed_mismatch']]);
  const record = turnRecord(session, 2);
  assert.ok(record.receipts.some(receipt => receipt.kind === 'time' && !receipt.owed));
  assert.ok(String(record.rendered_text).includes('门廊的油漆剥落成一片片灰白'));
  const owed = JSON.parse(readFileSync(join(session.workspace, '.coc/campaigns', CAMPAIGN, 'owed.json'), 'utf8'));
  assert.ok(owed.open.some(row => row.name === ROW.name), 'the row this write did not land stays open');
});
