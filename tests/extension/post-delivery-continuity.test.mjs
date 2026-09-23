/**
 * Contract §130, host side. The continuity review reads the delivery after the player does.
 *
 * Retained live baseline (2026-09-22 GUI table, `game-21ac44b7-5f91-41a5-8ea7-9faf5b801a29`, reviewer
 * `xai/grok-4.6`): the review child held `narrate` for 12.8 s, 17.8 s and 13.9 s (rows of 14.3 s,
 * 20.1 s and 15.3 s) on turns 0-2 -- all three `pass` -- and the opening's player saw no prose for
 * 14.7 s. The user's ruling: do not block the player from reading the main content; tolerate some
 * problems and let the model round out its own logic afterwards.
 *
 * What is proved here, on the real tool path (explicit `narrate`, and the implicit close the host
 * makes for prose): the delivery is committed and the turn closed while the review is still pending;
 * a `revise` reaches the record through `table.warn` and never reopens the turn or steers a rewrite;
 * an unanswered review is accounted exactly as §91 accounts it, only later; and the `pre` mode is the
 * gate it always was.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {AUDIT_LIMITS} from '../../kernel-ts/mods/audit-result.ts';
import modsExtension, {continuityGateMode} from '../../extensions/mods/index.ts';
import {openTable, waitForIdle} from './harness.mjs';

const root = resolve(import.meta.dirname, '../..');
const base = join(root, '.coc/playtests/post-delivery-continuity');
await mkdir(base, {recursive: true});
const directory = await mkdtemp(join(base, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));

const JOB = 'a'.repeat(64);
const pass = () => ({missing: [], findings: [], continuity_review: {verdict: 'pass', summary: 'Compatible.', conflicts: []}});
const revise = () => ({missing: [], findings: [{reason: 'The lamp was already out.', fix: 'Rewrite the whole candidate.'}],
    continuity_review: {verdict: 'revise', summary: 'The lamp was out.', conflicts: []}});

/** Set the mode for one test and put the prior value back afterwards. */
function mode(t, value) {
    const prior = process.env.PI_COC_CONTINUITY_GATE;
    if (value === undefined) delete process.env.PI_COC_CONTINUITY_GATE; else process.env.PI_COC_CONTINUITY_GATE = value;
    t.after(() => { if (prior === undefined) delete process.env.PI_COC_CONTINUITY_GATE; else process.env.PI_COC_CONTINUITY_GATE = prior; });
}

/** The real Mods bridge over a scripted kernel and a scripted reviewer child. */
function bridgeOn(cwd, {runTask, accept = pass, job = async () => ({enabled: true, continuity_review: true, cwd, job: JOB,
    review_scope: join(cwd, 'scope'), limits: AUDIT_LIMITS, focus: {}, system_prompt: join(cwd, 'prompt.md')})}) {
    const rows = [], calls = [];
    let bridge;
    const pi = {events: new EventEmitter(), on() {}};
    pi.events.on('coc:mods-bridge', value => bridge = value);
    modsExtension(pi);
    pi.events.emit('coc:kernel-bridge', {record: row => rows.push(row), runtime: {runTask},
        call: async (method, params) => {
            calls.push({method, params});
            if (method === 'mods.job') return job(params);
            if (method === 'mods.accept') return accept(params);
            return {};
        }});
    return {get bridge() { return bridge; }, rows, calls};
}
const submits = async task => {
    const control = JSON.parse(await readFile(join(task.request.cwd, task.request.audit.control), 'utf8'));
    await writeFile(join(task.request.cwd, control.status_file), JSON.stringify({requests: 1, artifact_repairs: 0, submitted: true, unavailable: ''}));
    task.request.onEvent({type: 'tool_execution_end', toolName: 'submit_audit', result: {details: {kind: 'audit_submission'}}});
    return {ok: true, ms: 1, code: 0, timedOut: false, command: ['pi', '--model', 'lane/fixture-1']};
};

test('the mode is post unless pre is asked for', t => {
    mode(t, undefined); assert.equal(continuityGateMode(), 'post');
    mode(t, ' PRE '); assert.equal(continuityGateMode(), 'pre');
    mode(t, 'gate'); assert.equal(continuityGateMode(), 'post');
});

test('post: preparing a delivery pins the evidence and runs no reviewer', async t => {
    mode(t, 'post');
    const cwd = await mkdtemp(join(directory, 'pin-'));
    let children = 0;
    const host = bridgeOn(cwd, {runTask: async task => { children++; return submits(task); }});
    const prepared = await host.bridge.prepare('narrate', {campaign: 'c1', text: 'The lamp swings.'});
    assert.equal(prepared?.mode, 'post');
    assert.equal(prepared.deferred?.job, JOB);
    assert.equal(children, 0, 'no model work sits in front of the commit');
    assert.deepEqual(host.calls.map(call => call.method), ['mods.queued', 'mods.job'], 'only the deterministic pin');

    const outcome = await prepared.deferred.run({turn: 3, closedAt: Date.now()});
    assert.deepEqual(outcome, {mode: 'post', job: JOB, verdict: 'pass'});
    assert.equal(children, 1);
    const accept = host.calls.find(call => call.method === 'mods.accept');
    assert.equal(accept.params.after_delivery, true, 'the kernel pins the review to the delivered record');
    const row = host.rows.find(row => row.lane === 'continuity-review' && row.ok === true);
    assert.deepEqual([row.mode, row.turn, row.delivered, row.verdict], ['post', 3, true, 'pass']);
    assert.equal(typeof row.job_ms, 'number'); assert.equal(typeof row.after_close_ms, 'number');
});

test('post: a revise is a verdict to record, never a refusal and never a latched block', async t => {
    mode(t, 'post');
    const cwd = await mkdtemp(join(directory, 'revise-'));
    const host = bridgeOn(cwd, {runTask: submits, accept: revise});
    for (const text of ['A draft.', 'A second delivery in the same scope.']) {
        const prepared = await host.bridge.prepare('ask', {campaign: 'c1', text});
        const outcome = await prepared.deferred.run({turn: 1, closedAt: Date.now()});
        assert.equal(outcome.verdict, 'revise');
        assert.equal(outcome.unreviewed, undefined);
    }
    const retained = JSON.parse(await readFile(join(cwd, 'scope', 'review-budget.json'), 'utf8'));
    assert.equal(retained.blocked, null, 'there is no Keeper rewrite chain after delivery for max_rewrites to bound');
    assert.equal(retained.rewrites, 0);
});

test('post: a reviewer that never answers leaves the delivery unreviewed, and throws nothing', async t => {
    mode(t, 'post');
    const cwd = await mkdtemp(join(directory, 'dead-'));
    const host = bridgeOn(cwd, {runTask: async () => ({ok: false, ms: 5, code: 143, timedOut: true, command: ['pi', '--model', 'lane/slow-1']})});
    const prepared = await host.bridge.prepare('narrate', {campaign: 'c1', text: 'A draft.'});
    const outcome = await prepared.deferred.run({turn: 2, closedAt: Date.now()});
    assert.deepEqual(outcome.unreviewed, {cause: 'The private reviewer ended without a checked submission', service: true});
    assert.equal(host.calls.filter(call => call.method === 'mods.accept').length, 0);
});

test('post: a pin that cannot be made does not hold the delivery either', async t => {
    mode(t, 'post');
    const cwd = await mkdtemp(join(directory, 'nojob-'));
    const host = bridgeOn(cwd, {runTask: submits, job: async () => { throw new Error('kernel mods.job did not answer within 30000 ms'); }});
    const prepared = await host.bridge.prepare('narrate', {campaign: 'c1', text: 'A draft.'});
    assert.equal(prepared.mode, 'post');
    assert.match(prepared.unreviewed.cause, /did not answer/);
});

test('pre: the gate is unchanged, and a pass it approved names its job for the record', async t => {
    mode(t, 'pre');
    const cwd = await mkdtemp(join(directory, 'pre-'));
    const passing = bridgeOn(cwd, {runTask: submits});
    assert.deepEqual(await passing.bridge.prepare('narrate', {campaign: 'c1', text: 'A draft.'}),
        {mode: 'pre', reviewed: {mode: 'pre', job: JOB, verdict: 'pass'}});
    const refusing = bridgeOn(await mkdtemp(join(directory, 'pre-revise-')), {runTask: submits, accept: revise});
    await assert.rejects(refusing.bridge.prepare('narrate', {campaign: 'c1', text: 'A draft.'}),
        error => error.details?.reason === 'mod_narrative_repair');
    assert.ok(passing.rows.every(row => row.lane !== 'continuity-review' || row.mode === 'pre'));
});

/** A controllable deferred review: `run` is called by the host, and resolves only when the test says so. */
function controlledReview() {
    let release, runs = 0, started;
    const gate = new Promise(resolve => { release = resolve; });
    const began = new Promise(resolve => { started = resolve; });
    return {
        get runs() { return runs; }, began, release: outcome => release(outcome),
        deferred: {mode: 'post', job: JOB, jobMs: 7, async run(options) { runs++; started(options); return gate; }},
    };
}
async function until(check, what, timeoutMs = 15_000) {
    const end = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

// A bounded wait: a host that awaited the review before committing would otherwise hang here forever.
for (const implicit of [false, true]) test(`post, ${implicit ? 'implicit' : 'explicit'} narrate: the turn is published before the review answers, and a revise reopens nothing`, {timeout: 90_000}, async t => {
    const responses = implicit
        ? [fauxAssistantMessage([fauxToolCall('look', {focus: 'scene'})], {stopReason: 'toolUse'}), fauxAssistantMessage('The lamp swings over the empty desk.')]
        : [fauxAssistantMessage([fauxToolCall('narrate', {text: 'The lamp swings over the empty desk.'})], {stopReason: 'toolUse'})];
    const session = await openTable({retainAt: directory, responses: [...responses, fauxAssistantMessage('Should never be consumed.')]});
    t.after(() => session.dispose());
    const review = controlledReview();
    let prepares = 0;
    session.emit('coc:mods-bridge', {async after() {}, async prepare(method) {
        if (method !== 'narrate') return;
        prepares++;
        return {mode: 'post', deferred: review.deferred};
    }});

    await session.session.prompt('I watch the lamp.');
    await waitForIdle(session.session);
    const options = await review.began;

    // Published while the review is still pending: the kernel committed it and the turn closed.
    const narrated = session.kernelRequests().filter(request => request.method === 'table.narrate');
    assert.equal(narrated.length, 1);
    assert.equal(narrated[0].params.implicit === true, implicit);
    assert.ok(session.telemetry().some(row => row.event === 'turn-closed'));
    assert.equal(session.kernelRequests().filter(request => request.method === 'table.warn' && request.params.lane === 'continuity-review').length, 0,
        'the review has not answered yet');
    assert.equal(typeof options.turn, 'number', 'the review is told which delivered turn it reads');

    review.release({mode: 'post', job: JOB, verdict: 'revise'});
    await until(() => session.kernelRequests().some(request => request.method === 'table.warn' && request.params.lane === 'continuity-review'), 'the verdict record');
    const warned = session.kernelRequests().find(request => request.method === 'table.warn' && request.params.lane === 'continuity-review');
    assert.deepEqual([warned.params.mode, warned.params.job, warned.params.turn], ['post', JOB, options.turn]);
    // Nothing was reopened, rewritten or steered: one review, one delivery, and the Keeper was not called again.
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(prepares, 1);
    assert.equal(review.runs, 1);
    assert.equal(session.kernelRequests().filter(request => request.method === 'table.narrate').length, 1);
    assert.equal(session.session.state.isStreaming, false);
    const recorded = session.telemetry().find(row => row.lane === 'continuity-review' && row.event === 'recorded');
    assert.deepEqual([recorded?.ok, recorded?.mode], [true, 'post']);
});

test('post: a review that could not answer is recorded as an unreviewed delivery, on the turn it read', async t => {
    const session = await openTable({retainAt: directory, responses: [
        fauxAssistantMessage([fauxToolCall('narrate', {text: 'Nobody read this one.'})], {stopReason: 'toolUse'}),
        fauxAssistantMessage('Should never be consumed.')]});
    t.after(() => session.dispose());
    const review = controlledReview();
    session.emit('coc:mods-bridge', {async after() {}, async prepare(method) { if (method === 'narrate') return {mode: 'post', deferred: review.deferred}; }});
    await session.session.prompt('I read the letter.');
    await waitForIdle(session.session);
    const {turn} = await review.began;
    review.release({mode: 'post', job: JOB, unreviewed: {cause: 'The private reviewer ended without a checked submission', service: true}});
    await until(() => session.kernelRequests().some(request => request.method === 'table.warn' && request.params.lane === 'continuity-review'), 'the unreviewed record');
    const warned = session.kernelRequests().find(request => request.method === 'table.warn' && request.params.lane === 'continuity-review');
    assert.deepEqual(warned.params.unreviewed, {cause: 'The private reviewer ended without a checked submission', service: true});
    const noted = session.telemetry().find(row => row.reason === 'delivered_unreviewed');
    assert.deepEqual([noted.mode, noted.turn, noted.streak], ['post', turn, 1]);
});

test('pre: the gate’s own pass is written onto the record once the delivery commits', async t => {
    const session = await openTable({retainAt: directory, responses: [
        fauxAssistantMessage([fauxToolCall('narrate', {text: 'Approved words.'})], {stopReason: 'toolUse'}),
        fauxAssistantMessage('Should never be consumed.')]});
    t.after(() => session.dispose());
    session.emit('coc:mods-bridge', {async after() {}, async prepare(method) {
        if (method === 'narrate') return {mode: 'pre', reviewed: {mode: 'pre', job: JOB, verdict: 'pass'}};
    }});
    await session.session.prompt('I nod.');
    await waitForIdle(session.session);
    await until(() => session.kernelRequests().some(request => request.method === 'table.warn' && request.params.lane === 'continuity-review'), 'the pass record');
    const warned = session.kernelRequests().find(request => request.method === 'table.warn' && request.params.lane === 'continuity-review');
    assert.deepEqual([warned.params.mode, warned.params.job], ['pre', JOB]);
    const requests = session.kernelRequests();
    const narrate = requests.findIndex(request => request.method === 'table.narrate');
    const record = requests.findIndex(request => request.method === 'table.warn' && request.params.lane === 'continuity-review');
    assert.ok(narrate >= 0 && narrate < record, 'recorded after the commit, never before it');
});
