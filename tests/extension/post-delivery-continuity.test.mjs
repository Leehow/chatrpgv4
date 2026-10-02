/**
 * Section 166 supersedes the automatic pre/post review policy of section 130.
 * Historical live evidence remains in the contract and campaign records. Current deliveries do not pin,
 * start, await or apply a prose review, including a deferred/rejecting bridge supplied by another extension.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import modsExtension from '../../extensions/mods/index.ts';
import {openTable, customMessages} from './harness.mjs';

for (const mode of ['pre', 'post']) test('section 166: legacy '+mode+' settings start no audit child or audit job', async t => {
    const prior = process.env.PI_COC_CONTINUITY_GATE;
    process.env.PI_COC_CONTINUITY_GATE = mode;
    t.after(() => {if (prior === undefined) delete process.env.PI_COC_CONTINUITY_GATE; else process.env.PI_COC_CONTINUITY_GATE = prior;});
    let bridge, children = 0;
    const calls = [], pi = {events: new EventEmitter(), on() {}};
    pi.events.on('coc:mods-bridge', value => bridge = value);
    modsExtension(pi);
    pi.events.emit('coc:kernel-bridge', {call: async method => {calls.push(method); return {};},
        runtime: {runTask: async () => {children++; throw Error('no automatic review');}}});
    assert.equal(await bridge.prepare('narrate', {campaign: 'c1', text: 'The lamp swings.'}), undefined);
    assert.equal(await bridge.prepare('ask', {campaign: 'c1', text: 'What do you do?'}), undefined);
    assert.equal(children, 0);
    assert.ok(calls.every(method => method === 'mods.queued'), 'only existing definition bookkeeping remains');
    assert.deepEqual(await bridge.reviewStatus('c1'), {paused: false});
});

for (const implicit of [false, true]) for (const rejects of [false, true])
 test('section 166: '+(implicit ? 'implicit' : 'explicit')+' delivery ignores a '+(rejects ? 'rejecting' : 'deferred')+' review bridge', async t => {
    const prose = 'The lamp swings over the empty desk.';
    let keeperCalls = 0, prepares = 0, reviews = 0;
    const response = implicit ? fauxAssistantMessage(prose)
        : fauxAssistantMessage([fauxToolCall('narrate', {text: prose})], {stopReason: 'toolUse'});
    const table = await openTable({responses: [() => {keeperCalls++; return response;}]});
    t.after(() => table.dispose());
    table.emit('coc:mods-bridge', {async after() {}, async prepare(method) {
        if (method !== 'narrate') return;
        prepares++;
        if (rejects) throw Error('This prose would have been refused.');
        return {mode: 'post', deferred: {mode: 'post', job: 'a'.repeat(64), jobMs: 0,
            async run() {reviews++; return {mode: 'post', verdict: 'revise'};}}};
    }});
    await table.session.prompt('I watch the lamp.');
    assert.equal(keeperCalls, 1);
    assert.equal(prepares, 0);
    assert.equal(reviews, 0);
    const narrated = table.kernelRequests().filter(request => request.method === 'table.narrate');
    assert.equal(narrated.length, 1);
    assert.equal(narrated[0].params.implicit === true, implicit);
    assert.equal(narrated[0].params.text, prose);
    assert.equal(table.kernelRequests().filter(request => request.method === 'table.warn' && request.params.lane === 'continuity-review').length, 0);
    assert.equal(customMessages(table.session, 'coc-delivery').filter(message => message.details?.turn_unfinished).length, 0);
});
