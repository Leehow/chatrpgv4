/**
 * Contract §32: scripted verdicts exercise the host boundary, not live semantic accuracy.
 * A refused bargain must stay unexecuted until the player answers the delivered terms.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {admissionSystemPrompt} from '../../extensions/kernel/admission.ts';

const answer = value => fauxAssistantMessage(JSON.stringify(value));
const call = (tool, args) => fauxAssistantMessage([fauxToolCall(tool, args)], {stopReason: 'toolUse'});
const cash = delta => ({kind: 'cash', delta, source: 'quote', with: 'Attendant', why: 'Payment for the requested service'});
const calls = (table, method) => table.kernelRequests().filter(row => row.method === method);

for (const refusal of ['not_authorized', 'uncertain']) {
  test(`${refusal}: an unquoted debit and its dependent effects stay unexecuted until acceptance`, async t => {
    const effects = [cash(-5), {kind: 'time', minutes: 5}, {kind: 'flag', name: 'tank-filled', value: 'true'}];
    const quote = 'You hang the helmet on the handlebar and light your cigarette. The attendant rests his hand on the pump. "Five dollars to fill it. Shall I?"';
    const table = await openTable({
      responses: [
        call('apply', {effects}),
        call('apply', {effects: effects.map(effect => ({...effect, why: 'The player said fill it up and can afford it'}))}),
        call('narrate', {text: quote}),
        fauxAssistantMessage('after'),
        call('apply', {effects}),
        call('narrate', {text: 'The attendant fills the tank and takes the payment you offered.'}),
        fauxAssistantMessage('after'),
      ],
      laneResponses: {admission: [
        answer({verdict: refusal, grounds: 'No price was disclosed before the request', missing: 'whether to accept the five-dollar service'}),
        answer({verdict: 'authorized', grounds: 'The player accepted the delivered five-dollar quote'}),
      ]},
    });
    t.after(() => table.dispose());
    await table.session.prompt('Fill it up. I hang my helmet on the handlebar, light a cigarette and ask where I can stay.');
    assert.equal(calls(table, 'table.apply').length, 0, 'neither the debit nor the dependent batch reaches the kernel');
    assert.equal(calls(table, 'table.narrate').length, 1);
    const first = table.lanes.admission.requests();
    assert.equal(first.length, 1, JSON.stringify(table.session.messages.filter(row => row.role === 'toolResult')));
    assert.match(first[0], /delta=-5/);
    assert.doesNotMatch(first[0], /Keeper delivered: .*Five dollars/);
    assert.deepEqual(table.telemetry().filter(row => row.lane === 'admission').map(row => [row.admitted, row.reused]), [[false, false], [false, true]]);

    await table.session.prompt('Yes, five dollars is fine. Go ahead.');
    assert.equal(calls(table, 'table.apply').length, 1, 'new input permits a fresh review, not replay of the refusal');
    assert.deepEqual(calls(table, 'table.apply')[0].params.effects, effects);
    const requests = table.lanes.admission.requests();
    assert.equal(requests.length, 2);
    assert.ok(requests[1].includes(`Keeper delivered: ${quote}`), 'the actual quote is now public context');
    assert.ok(requests[1].includes('Yes, five dollars is fine. Go ahead.'));
  });
}

test('a chosen purchase within Spending Level settles in one turn without a price-confirmation round trip', async t => {
  const effects = [{...cash(-0.65), source: 'price', price_id: 'eq.1920s.meals.meals_out.lunch', settlement: 'spending_level'},
    {kind: 'time', minutes: 30, why: 'Lunch'}];
  const table = await openTable({
    responses: [
      call('apply', {effects}),
      call('narrate', {text: 'Lunch is brief; you finish and continue into town.'}),
      fauxAssistantMessage('after'),
    ],
    laneResponses: {admission: [
      answer({verdict: 'entailed', grounds: 'The player chose lunch; Spending Level settles it without a cash debit'}),
    ]},
  });
  t.after(() => table.dispose());
  await table.session.prompt('I eat lunch and then continue into town.');

  assert.equal(calls(table, 'table.apply').length, 1, 'the chosen ordinary purchase settles on the same player turn');
  assert.deepEqual(calls(table, 'table.apply')[0].params.effects, effects);
  assert.equal(table.lanes.admission.requests().length, 1);
  assert.match(table.lanes.admission.requests()[0], /settlement="spending_level"/);
  assert.match(table.lanes.admission.requests()[0], /The player's exact words[\s\S]*I eat lunch/);
  assert.deepEqual(table.telemetry().filter(row => row.lane === 'admission').map(row => row.admitted), [true]);
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
      fauxAssistantMessage('after'),
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
      fauxAssistantMessage('after'),
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
