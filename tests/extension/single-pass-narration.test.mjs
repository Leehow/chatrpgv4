/** Section 166: the real Pi delivery paths publish the first draft without another prose model call. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, customMessages, waitFor} from './harness.mjs';
import modsExtension from '../../extensions/mods/index.ts';
import speechEdit from '../../extensions/speech-edit/index.ts';
import {KernelClient} from '../../extensions/kernel/client.ts';

const root = resolve(import.meta.dirname, '../..');
const finalText = table => table.session.messages.filter(message => message.role === 'assistant').at(-1)?.content
  .filter(block => block.type === 'text').map(block => block.text).join('')
  || customMessages(table.session, 'coc-delivery').filter(message => !message.details?.turn_unfinished).at(-1)?.content;
const draft = 'The editor pauses. "How will you convince me?"';

for (const [path, response] of [
  ['implicit', fauxAssistantMessage(draft)],
  ['explicit', fauxAssistantMessage([fauxToolCall('narrate', {text: draft})], {stopReason: 'toolUse'})],
  ['embedded', fauxAssistantMessage([fauxToolCall('apply', {effects: [{kind: 'time', minutes: 1}], narrate: 'A pause.'})], {stopReason: 'toolUse'})],
  ['ask', fauxAssistantMessage([fauxToolCall('ask', {kind: 'mechanics', options: ['accept', 'push'], text: draft})], {stopReason: 'toolUse'})],
]) test(`section 166: ${path} delivers once despite a rejecting choice reviewer`, async t => {
  let reviews = 0, keeperCalls = 0, verifierCalls = 0;
  const table = await openTable({responses: [() => {keeperCalls++; return response;}], keeperProviderCallbacks: true, laneResponses: {verifier: [() => {verifierCalls++; return fauxAssistantMessage("[]");}]}, env: {PI_COC_CONTINUITY_GATE: 'pre', PI_COC_SPEECH_STEER: '1'},
    extraExtensions: [{name: 'mods-spy', factory(pi) {pi.events.emit('coc:mods-bridge', {async after() {}, async prepare(method) {if (method === 'narrate' || method === 'ask') throw Error('no delivery reviewer');}});}}, {name: 'speech-edit', factory: speechEdit},
      {name: 'withheld-choice', factory(pi) {pi.on('before_agent_start', () => {
        pi.events.emit('coc:forced-player-choice-cue', {campaign: 'test-camp', turn: 1, run: 'withheld-choice',
          choices: [{family: 'check-binding', subject: 'The editor social approach', uncertain: ['skill is the player choice']}],
          async review() {reviews++; return {status: 'reject', cueScores: [0.9], outcomeScores: [0.31]};}});
      });}}]});
  t.after(() => table.dispose());
  await table.session.prompt('I ask to look at the clippings.');
  await waitFor(() => finalText(table), {label: 'the first draft on the player delivery surface'});
  assert.equal(keeperCalls, 1, 'no second Keeper draft');
  assert.equal(reviews, 0, 'the finished draft is not sent to the choice reviewer');
  assert.equal(verifierCalls, 0, 'no background prose verifier');
  assert.equal(table.kernelRequests().filter(request => request.method === 'mods.job' && request.params.role === 'audit').length, 0);
  assert.equal(table.kernelRequests().filter(request => request.method === 'speech.job').length, 0);
  assert.equal(customMessages(table.session, 'coc-delivery').filter(message => message.details?.turn_unfinished).length, 0);
  assert.equal(finalText(table), path === 'embedded' ? 'A pause.' : draft);
  if (path === 'embedded') assert.equal(table.kernelRequests().filter(request => request.method === 'table.apply').length, 1, 'accepted effects run once');
});

for (const prose of ['A pause.', '{{say:Gatekeeper}}"No."{{/say}}', 'The editor watches you without speaking.'])
  test(`section 166: a no-tool first draft is kept (${prose})`, async t => {
    let keeperCalls = 0;
    const table = await openTable({responses: [() => {keeperCalls++; return fauxAssistantMessage(prose);}], keeperProviderCallbacks: true, env: {PI_COC_SPEECH_STEER: '1'}});
    t.after(() => table.dispose());
    await table.session.prompt('I wait for the editor.');
    assert.equal(keeperCalls, 1);
    assert.equal(table.kernelRequests().filter(request => request.method === 'table.narrate').length, 1);
    assert.equal(table.telemetry().filter(row => ['floor', 'speech'].includes(row.lane) && row.steered).length, 0);
    assert.ok(finalText(table), 'the player received prose');
  });

test('section 166: a legacy pre/post audit setting cannot start a foreground or background audit', async () => {
  const old = process.env.PI_COC_CONTINUITY_GATE;
  try {
    for (const mode of ['pre', 'post']) {
      process.env.PI_COC_CONTINUITY_GATE = mode;
      let bridge;
      const calls = [];
      const pi = {events: new EventEmitter(), on() {}};
      pi.events.on('coc:mods-bridge', value => bridge = value);
      modsExtension(pi);
      pi.events.emit('coc:kernel-bridge', {call: async method => {calls.push(method); return {};}});
      assert.equal(await bridge.prepare('narrate', {campaign: 'c1', text: draft}), undefined);
      assert.equal(await bridge.prepare('ask', {campaign: 'c1', text: draft}), undefined);
      assert.deepEqual(await bridge.reviewStatus('c1'), {paused: false});
      assert.ok(calls.every(method => method === 'mods.queued'), 'only existing definition bookkeeping is read');
    }
  } finally {
    if (old === undefined) delete process.env.PI_COC_CONTINUITY_GATE; else process.env.PI_COC_CONTINUITY_GATE = old;
  }
});

test('section 166: repeated lines and markup deliver on the real kernel; state replay and closed-turn gates still hold', async t => {
  const home = await mkdtemp(join(tmpdir(), 'coc-single-pass-'));
  const kernel = new KernelClient({command: [process.execPath, join(root, 'build/kernel/rpc.mjs'), '--workspace', home,
    '--content', join(root, 'content')], cwd: root, timeoutMs: 60_000});
  t.after(async () => {await kernel.close(); await rm(home, {recursive: true, force: true});});
  const call = (method, params = {}) => kernel.call(method, {campaign: 'one-pass', ...params});
  await kernel.call('campaign.create', {id: 'one-pass', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The case begins.'});
  const prose = '{{say:Arty Wilmot}}"No visitors downstairs."{{/say}}\n- The editor watches the door.';
  for (let turn = 1; turn <= 2; turn++) {
    await call('table.player_input', {text: 'I wait.'});
    const effect = {call_id: `t${turn}-c1`, effects: [{kind: 'time', minutes: 1}]};
    const first = await call('table.apply', effect), replay = await call('table.apply', effect);
    const {replayed, ...cached} = replay;
    assert.equal(replayed, true);
    assert.equal(first.receipts.length, 1);
    assert.deepEqual(cached, first, 'an identical operation reuses its result and receipts');
    const delivery = await call('table.narrate', {call_id: `t${turn}-c2`, text: prose});
    assert.equal((await call('table.status')).state, 'awaiting_player');
    assert.match(delivery.rendered_text, /No visitors downstairs/);
    assert.match(delivery.rendered_text, /The editor watches the door/);
    await assert.rejects(call('table.apply', {call_id: `t${turn}-c3`, effects: [{kind: 'time', minutes: 1}]}));
  }
});
