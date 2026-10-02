/**
 * Contract §32: scripted verdicts exercise the host boundary, not live semantic accuracy.
 * A refused bargain must stay unexecuted until the player answers the delivered terms.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {admissionProposes, openTable} from './harness.mjs';
import {admissionSystemPrompt} from '../../extensions/kernel/admission.ts';

const answer = value => fauxAssistantMessage(JSON.stringify(value));
const call = (tool, args) => fauxAssistantMessage([fauxToolCall(tool, args)], {stopReason: 'toolUse'});
const cash = delta => ({kind: 'cash', delta, source: 'quote', with: 'Attendant', why: 'Payment for the requested service'});
const calls = (table, method) => table.kernelRequests().filter(row => row.method === method);
/**
 * §32.12.3.1: each line of a batch is its own lane call. Before the player accepts, the scripted lane refuses the debit
 * and admits the minutes the service itself takes, so the test shows the debit's refusal holding back a line that would
 * land on its own; once the player has accepted, every line is admitted.
 */
const lane = refusal => async context => {
  const text = (context?.messages ?? []).flatMap(message => (message.role === 'user' ? message.content : [])).map(block => block.text ?? '').join('');
  if (text.includes('Yes, five dollars is fine')) return answer({verdict: 'authorized', grounds: 'The player accepted the delivered five-dollar quote'});
  if (/apply cash/.test(admissionProposes(text))) return answer({verdict: refusal, grounds: 'No price was disclosed before the request', missing: 'whether to accept the five-dollar service'});
  return answer({verdict: 'entailed', grounds: 'Filling the tank takes the minutes the player asked for'});
};

for (const refusal of ['not_authorized', 'uncertain']) {
  test(`${refusal}: an unquoted debit and its dependent effects stay unexecuted until acceptance`, async t => {
    const effects = [cash(-5), {kind: 'time', minutes: 5}, {kind: 'flag', name: 'tank-filled', value: 'true'}];
    const quote = 'You hang the helmet on the handlebar and light your cigarette. The attendant rests his hand on the pump. "Five dollars to fill it. Shall I?"';
    const table = await openTable({
      responses: [
        call('apply', {effects}),
        call('apply', {effects: effects.map(effect => ({...effect, why: 'The player said fill it up and can afford it'}))}),
        call('narrate', {text: quote}),
        call('apply', {effects}),
        call('narrate', {text: 'The attendant fills the tank and takes the payment you offered.'}),
      ],
      laneResponses: {admission: Array.from({length: 6}, () => lane(refusal))},
    });
    t.after(() => table.dispose());
    await table.session.prompt('Fill it up. I hang my helmet on the handlebar, light a cigarette and ask where I can stay.');
    assert.equal(calls(table, 'table.apply').length, 0, 'neither the debit nor the dependent batch reaches the kernel');
    assert.equal(calls(table, 'table.narrate').length, 1);
    const first = table.lanes.admission.requests();
    assert.ok(first.length >= 1 && first.length <= 2, JSON.stringify(table.session.messages.filter(row => row.role === 'toolResult')));
    const debit = first.find(request => /delta=-5/.test(admissionProposes(request)));
    assert.ok(debit, 'the debit was put to the lane on its own call');
    assert.doesNotMatch(debit, /Keeper delivered: .*Five dollars/);
    // The first batch: the debit's refusal refuses it whole, whatever the minutes would say on their own (§32.10). The
    // reworded resend is refused at once on the debit line's kept verdict: nothing is reviewed again (§32.4 keyed by line).
    const rows = table.telemetry().filter(row => row.lane === 'admission');
    assert.ok(rows.every(row => row.batch_admitted === false), JSON.stringify(rows));
    assert.deepEqual(rows.filter(row => !row.reused && row.admitted === false).map(row => row.proposed[0].split(':')[0]), ['apply cash']);
    assert.deepEqual(rows.filter(row => row.reused).map(row => [row.admitted, row.proposed[0].split(':')[0]]), [[false, 'apply cash']]);
    assert.equal(table.lanes.admission.requests().length, first.length, 'the reworded resend made no lane call');

    await table.session.prompt('Yes, five dollars is fine. Go ahead.');
    assert.equal(calls(table, 'table.apply').length, 1, 'new input permits a fresh review, not replay of the refusal');
    assert.deepEqual(calls(table, 'table.apply')[0].params.effects, effects);
    const requests = table.lanes.admission.requests().slice(first.length);
    assert.equal(requests.length, 2, 'one call per line');
    for (const request of requests) {
      assert.ok(request.includes(`Keeper delivered: ${quote}`), 'the actual quote is now public context');
      assert.ok(request.includes('Yes, five dollars is fine. Go ahead.'));
    }
  });
}

test('a chosen purchase within Spending Level settles in one turn without a price-confirmation round trip', async t => {
  const effects = [{...cash(-0.65), source: 'price', price_id: 'eq.1920s.meals.meals_out.lunch', settlement: 'spending_level'},
    {kind: 'time', minutes: 30, why: 'Lunch'}];
  const table = await openTable({
    responses: [
      call('apply', {effects}),
      call('narrate', {text: 'Lunch is brief; you finish and continue into town.'}),
    ],
    laneResponses: {admission: [
      answer({verdict: 'entailed', grounds: 'The player chose lunch; Spending Level settles it without a cash debit'}),
      answer({verdict: 'entailed', grounds: 'The player chose lunch; Spending Level settles it without a cash debit'}),
    ]},
  });
  t.after(() => table.dispose());
  await table.session.prompt('I eat lunch and then continue into town.');

  assert.equal(calls(table, 'table.apply').length, 1, 'the chosen ordinary purchase settles on the same player turn');
  assert.deepEqual(calls(table, 'table.apply')[0].params.effects, effects);
  const requests = table.lanes.admission.requests();
  assert.equal(requests.length, 2, 'one lane call per line (§32.12.3.1)');
  assert.ok(requests.some(request => /settlement="spending_level"/.test(admissionProposes(request))));
  for (const request of requests) assert.match(request, /The player's exact words[\s\S]*I eat lunch/);
  assert.deepEqual(table.telemetry().filter(row => row.lane === 'admission').map(row => row.admitted), [true, true]);
});

test('Spending Level removes price confirmation, not the need to choose the purchase itself', async t => {
  const prompt = admissionSystemPrompt();
  assert.match(prompt, /does not need an earlier price disclosure or a second confirmation/);
  assert.match(prompt, /Still judge whether the player chose the service, item or activity itself/);
  const effects = [{...cash(-0.65), source: 'price', price_id: 'eq.1920s.meals.meals_out.lunch', settlement: 'spending_level'}];
  const table = await openTable({
    responses: [
      call('apply', {effects}),
      call('narrate', {text: 'The menu remains open in front of you; nothing has been ordered.'}),
    ],
    laneResponses: {admission: [
      answer({verdict: 'not_authorized', grounds: 'The player only looked at the menu', missing: 'whether to order lunch'}),
    ]},
  });
  t.after(() => table.dispose());
  await table.session.prompt('I look over the menu.');
  assert.equal(calls(table, 'table.apply').length, 0, 'quick settlement cannot invent an unchosen purchase');
  assert.equal(calls(table, 'table.narrate').length, 1);
});

test('an accepted quote is not permission for a different debit in the same turn', async t => {
  const table = await openTable({
    responses: [
      call('apply', {effects: [cash(-5)]}),
      call('apply', {effects: [cash(-7)]}),
      call('narrate', {text: 'The attendant takes the agreed payment. He asks before adding anything else.'}),
    ],
    laneResponses: {admission: [
      answer({verdict: 'authorized', grounds: 'The player explicitly offered five dollars'}),
      answer({verdict: 'not_authorized', grounds: 'Seven dollars is not the accepted five-dollar price', missing: 'whether to accept the changed price'}),
    ]},
  });
  t.after(() => table.dispose());
  await table.session.prompt('I pay the agreed five dollars. Nothing extra.');
  assert.equal(table.lanes.admission.requests().length, 2, JSON.stringify(table.session.messages.filter(row => row.role === 'toolResult')));
  assert.deepEqual(calls(table, 'table.apply').map(row => row.params.effects[0].delta), [-5]);
});
