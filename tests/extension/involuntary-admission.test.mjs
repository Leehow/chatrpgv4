/**
 * Contract §32: prompt assertions and scripted verdicts are mechanical regression checks,
 * not evidence of live semantic accuracy. The reviewer still decides agency and consent.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {
  ADMITTING_VERDICTS, REFUSING_VERDICTS, admissionRequest, admissionSystemPrompt, shapeVerdict,
} from '../../extensions/kernel/admission.ts';

const call = (tool, args) => fauxAssistantMessage([fauxToolCall(tool, args)], {stopReason: 'toolUse'});
const displacement = {kind: 'move', to: 'lower-chamber', why: 'An environmental force displaces the investigator'};

test('agency classification precedes consent and voluntary move restrictions', () => {
  const prompt = admissionSystemPrompt();
  const classify = prompt.indexOf('First classify each component');
  const consent = prompt.indexOf('Only for voluntary investigator actions');
  assert.ok(classify >= 0 && classify < consent);
  assert.match(prompt.slice(classify, consent), /NPC initiative, environmental force, rules acting on the investigator/);
  assert.match(prompt.slice(classify, consent), /involuntary destination, elapsed time, hidden danger or outcome does not require the player to know, name or choose it beforehand/);
  assert.match(prompt, /For a voluntary move, the following destination-choice and commitment restrictions apply/);
  assert.match(prompt, /In a mixed batch, every voluntary component still needs authorization/);
  assert.match(prompt, /cannot disguise a new voluntary route, method, purchase or cost/);
  assert.match(prompt, /An NPC demanding payment is not the investigator choosing to pay/);
});

test('no new verdict or prose-based bypass: involuntary proposals still go to review', () => {
  assert.deepEqual([...ADMITTING_VERDICTS], ['authorized', 'entailed', 'not_player_action']);
  assert.deepEqual([...REFUSING_VERDICTS], ['not_authorized', 'uncertain']);
  assert.equal(shapeVerdict({verdict: 'forced', grounds: 'Keeper says so'}), undefined);
  const scope = {party: ['Alice']};
  const original = admissionRequest('apply', {effects: [displacement]}, scope);
  const reworded = admissionRequest('apply', {effects: [{...displacement, why: 'Forced consequence'}]}, scope);
  assert.ok(original);
  assert.match(original.lines[0], /why="An environmental force displaces the investigator"/);
  assert.equal(reworded.key, original.key, 'rewording cannot evade verdict reuse');
});

for (const verdict of ['not_player_action', 'not_authorized', 'uncertain', 'forced']) {
  test(`scripted ${verdict}: the same review path governs the whole batch`, async t => {
    // Mixed effects are intentionally not classified by this fixture: the scripted reviewer
    // rejects the new payment. The positive case contains only displacement and elapsed time.
    const effects = [displacement, {kind: 'time', minutes: 2}];
    if (verdict === 'not_authorized') effects.push({kind: 'cash', delta: -5, source: 'quote', with: 'Guide', why: 'Forced consequence: the guide demands payment'});
    const table = await openTable({
      responses: [
        call('apply', {effects}),
        ...(verdict === 'not_authorized' ? [call('apply', {effects: effects.map(effect => ({...effect, why: 'A consequence already in motion'}))})] : []),
        call('narrate', {text: 'You have a moment to take stock.'}),
        fauxAssistantMessage('after'),
      ],
      laneResponses: {admission: [fauxAssistantMessage(JSON.stringify({
        verdict, grounds: 'Scripted boundary check, not a semantic judgment',
        ...(['not_authorized', 'uncertain'].includes(verdict) ? {missing: 'whether to accept the commitment'} : {}),
      }))]},
    });
    t.after(() => table.dispose());
    await table.session.prompt('I try to keep my balance.');
    const applied = table.kernelRequests().filter(row => row.method === 'table.apply');
    assert.equal(applied.length, verdict === 'not_player_action' ? 1 : 0);
    if (applied.length) assert.deepEqual(applied[0].params.effects, effects);
    const requests = table.lanes.admission.requests();
    assert.equal(requests.length, 1, 'even a claimed consequence is reviewed, and refusals cannot be reworded away');
    assert.match(requests[0], /to="lower-chamber"/);
    assert.match(requests[0], /minutes=2/);
    const telemetry = table.telemetry().filter(row => row.lane === 'admission');
    if (verdict !== 'forced') assert.equal(telemetry[0].admitted, verdict === 'not_player_action');
    else assert.ok(telemetry.every(row => row.admitted !== true), 'unavailable review records no admission');
    if (verdict === 'not_authorized') {
      assert.match(requests[0], /delta=-5/);
      assert.equal(telemetry[1].reused, true);
      assert.equal(telemetry[1].admitted, false);
    }
    if (verdict === 'forced') {
      assert.ok(table.session.messages.some(row => row.role === 'toolResult' && JSON.stringify(row).includes('admission_unavailable')),
        'an unrecognized verdict leaves review unavailable, never admitted');
    }
  });
}
