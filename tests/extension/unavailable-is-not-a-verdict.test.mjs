/**
 * Contract §91. A continuity review that never reached a verdict about a draft may not refuse it.
 *
 * Retained live evidence (`playtest-evidence/pipicoc-20260914`, M-MAIN campaign
 * `game-3dd94f0a-4b26-41bc-96fa-f89a60abb143`, 2026-09-17, 112 turns). Nine turns ended
 * `closed_by: "stranded"` with `text: null`; seven of them on `continuity_review_unavailable`. Read
 * from the campaign's own telemetry they are not one fact but two:
 *
 *   turns 25 and 33  `submitted: false, timed_out: true`  -- the reviewer was killed at its 40 s cap
 *   turn 60          `The shared review allowance is exhausted`
 *   turns 92 and 107 `The bounded Keeper repair did not resolve the review` (two submitted reviews)
 *
 * The first three are the lane failing to answer; the last two are the guard doing its job. Turn 107
 * cost the most -- five receipts on disk (three document definitions, an NPC move, an eight-minute
 * clock advance) and `rendered_text: null` -- and it is on the *verdict* side, so it is untouched
 * here. What is repaired is the other side: across the nine tables of that evidence set 601 reviews
 * reached a verdict (552 pass, 49 revise) and 13 never did, and each of those 13 could destroy a turn
 * on the strength of a reading nobody performed.
 *
 * The 63 retained `revise` artifacts say what the gate actually catches: 41 carry `findings` and 14
 * carry `missing`, nearly all of them "the narrated writing or consumption has not reached the
 * existing object instance"; only 5 carry a continuity `conflict` at all. That class is exactly what
 * §12.5's post-delivery verifier reports as `uncommitted_state`, advisory, on every delivered turn --
 * so a delivery published unreviewed is still read, just not held.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {AUDIT_LIMITS} from '../../kernel-ts/mods/audit-result.ts';
import modsExtension from '../../extensions/mods/index.ts';
import {customMessages, openTable, waitForIdle} from './harness.mjs';
// These cases pin the pre-delivery gate (§36.14, §26.1, §91), which §130 keeps whole as the `pre` mode.
process.env.PI_COC_CONTINUITY_GATE = 'pre';

const root = resolve(import.meta.dirname, '../..');
const base = join(root, '.coc/playtests/unavailable-is-not-a-verdict');
await mkdir(base, {recursive: true});
const directory = await mkdtemp(join(base, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));

const pass = () => ({missing: [], findings: [], continuity_review: {verdict: 'pass', summary: 'Compatible campaign detail.', conflicts: []}});
const revise = () => ({missing: [], findings: [], continuity_review: {verdict: 'revise', summary: 'The notebook writing has not reached the instance.',
    conflicts: [{claim: 'He writes the line down.', reason: 'The document instance does not hold it.',
        evidence: [{file: 'world.json', quote: 'The notebook holds nothing new.'}]}]}});

/** The bridge under test, with a scripted reviewer child and a scripted `mods.accept`. */
function bridgeOn(cwd, scope, {runTask, accept = pass}) {
    const rows = [];
    let bridge, accepts = 0;
    const pi = {events: new EventEmitter(), on() {}};
    pi.events.on('coc:mods-bridge', value => bridge = value);
    modsExtension(pi);
    pi.events.emit('coc:kernel-bridge', {
        record: row => rows.push(row),
        call: async (method, params) => {
            if (method === 'mods.job') return {enabled: true, continuity_review: true, cwd, job: `draft-${accepts}`,
                review_scope: scope, limits: AUDIT_LIMITS, focus: {}, system_prompt: join(cwd, 'prompt.md')};
            if (method !== 'mods.accept') return {};
            accepts++;
            return accept(params);
        },
        runtime: {runTask}});
    return {get bridge() { return bridge; }, rows, get accepts() { return accepts; }};
}

/** A child that submits a checked report. */
const submits = async task => {
    const control = JSON.parse(await readFile(join(task.request.cwd, task.request.audit.control), 'utf8'));
    await writeFile(join(task.request.cwd, control.status_file), JSON.stringify({requests: 1, artifact_repairs: 0, submitted: true, unavailable: ''}));
    task.request.onEvent({type: 'tool_execution_end', toolName: 'submit_audit', result: {details: {kind: 'audit_submission'}}});
    return {ok: true, ms: 1, code: 0, timedOut: false, command: ['pi', '--model', 'lane/fixture-1']};
};

/**
 * Turns 25 and 33: the child was killed at `per_review_ms` having submitted nothing. Nothing was read,
 * so nothing may be refused -- and the report that says so is what the host counts.
 */
test('a reviewer killed at its cap hands the delivery back, unreviewed, instead of destroying the turn', async () => {
    const cwd = await mkdtemp(join(directory, 'timeout-')), scope = join(cwd, 'budget');
    const host = bridgeOn(cwd, scope, {runTask: async () => ({ok: false, ms: AUDIT_LIMITS.per_review_ms, code: 143, timedOut: true, command: ['pi', '--model', 'lane/slow-1']})});

    const outcome = await host.bridge.prepare('narrate', {campaign: 'c1', text: 'A draft nobody read.'});
    assert.equal(typeof outcome?.unreviewed, 'object', 'the delivery goes through, and says it was never judged');
    assert.equal(outcome.unreviewed.cause, 'The private reviewer ended without a checked submission');
    assert.equal(outcome.unreviewed.service, true, 'a dead child is still an outage for §38.9 purposes');
    assert.equal(host.accepts, 0, 'a report that was never submitted is never bound as an accepted one');

    // The retained accounting still latches, so this input buys no second review of the same draft.
    const retained = JSON.parse(await readFile(join(scope, 'review-budget.json'), 'utf8'));
    assert.equal(retained.blocked, 'The private reviewer ended without a checked submission');
    assert.equal(retained.blocked_reviewed, false, 'no verdict stands behind it');

    const lane = host.rows.filter(row => row.lane === 'continuity-review');
    assert.equal(lane.length, 2, JSON.stringify(host.rows));
    assert.deepEqual([lane[0].ok, lane[0].reason, lane[0].timed_out, lane[0].submitted], [false, 'continuity_review_unavailable', true, false]);
    assert.deepEqual([lane[1].ok, lane[1].unreviewed, lane[1].delivered], [true, true, true]);
});

/**
 * Turn 60. The reviewer submitted, and the shared allowance was spent. §38.9 calls that `service:
 * false` because it is not a lane being down -- and that is right, and it is also not a reading of
 * this draft. The two questions are different, and only the second may hold a delivery back.
 */
test('an exhausted allowance bounds what may be started, and judges nothing', async () => {
    const cwd = await mkdtemp(join(directory, 'spent-')), scope = join(cwd, 'budget');
    await mkdir(scope, {recursive: true});
    await writeFile(join(scope, 'review-budget.json'), JSON.stringify({version: 1, input_token: null, requests: 0,
        ms: AUDIT_LIMITS.time_ms, rewrites: 0, artifact_repairs: 0, reviewed_jobs: {}, previous: [], blocked: null,
        blocked_service: null, blocked_reviewed: null}));
    const host = bridgeOn(cwd, scope, {runTask: async () => { throw new Error('no review may be started at all'); }});

    const outcome = await host.bridge.prepare('narrate', {campaign: 'c1', text: 'A draft nobody could afford to read.'});
    assert.equal(outcome?.unreviewed?.cause, 'The shared review allowance is exhausted');
    assert.equal(outcome.unreviewed.service, false, 'a spent allowance is not an outage, and never enters §38.5’s streak');
    assert.equal(JSON.parse(await readFile(join(scope, 'review-budget.json'), 'utf8')).blocked_reviewed, false);
});

/**
 * Turns 92 and 107, and the boundary of this section: the reviewer read the draft, refused it, read
 * the one bounded repair `max_rewrites` permits and refused that too. That is the guard working, it
 * still ends the input, and no part of §91 reaches it.
 */
test('a bounded repair refused twice still refuses the delivery', async () => {
    const cwd = await mkdtemp(join(directory, 'verdict-')), scope = join(cwd, 'budget');
    const host = bridgeOn(cwd, scope, {runTask: submits, accept: revise});

    await assert.rejects(host.bridge.prepare('narrate', {campaign: 'c1', text: 'A draft.'}),
        error => error.details?.reason === 'mod_narrative_repair');
    await assert.rejects(host.bridge.prepare('narrate', {campaign: 'c1', text: 'A repaired draft.'}),
        error => error.details?.reason === 'continuity_review_unavailable' && error.details?.reviewed === true,
        'a verdict the reviewer’s own reading stands behind keeps its power to refuse');
    const retained = JSON.parse(await readFile(join(scope, 'review-budget.json'), 'utf8'));
    assert.equal(retained.blocked, 'The bounded Keeper repair did not resolve the review');
    assert.equal(retained.blocked_reviewed, true);
});

/** And the retained verdict is replayed as a verdict, not downgraded on the next read of the file. */
test('a retained verdict block keeps its authority across a restart', async () => {
    const cwd = await mkdtemp(join(directory, 'retained-')), scope = join(cwd, 'budget');
    const first = bridgeOn(cwd, scope, {runTask: submits, accept: revise});
    await assert.rejects(first.bridge.prepare('narrate', {campaign: 'c1', text: 'A draft.'}), () => true);
    await assert.rejects(first.bridge.prepare('narrate', {campaign: 'c1', text: 'A repaired draft.'}), () => true);

    const second = bridgeOn(cwd, scope, {runTask: async () => { throw new Error('no review may be started at all'); }});
    await assert.rejects(second.bridge.prepare('narrate', {campaign: 'c1', text: 'A third draft.'}),
        error => error.details?.reason === 'continuity_review_unavailable' && error.details?.reviewed === true);
});

/**
 * The product path, in the shape turn 107 had: receipts already on disk and a draft already written.
 * The turn reaches the player instead of becoming a stranded record with `text: null`.
 */
const settledThenDelivered = () => [
    fauxAssistantMessage([fauxToolCall('resolve', {action: {intent: 'investigate', goal: '看清崖上那盏灯', method: '用侦查盯住'}})], {stopReason: 'toolUse'}),
    fauxAssistantMessage([fauxToolCall('narrate', {text: 'The turn the review never judged.'})], {stopReason: 'toolUse'}),
    fauxAssistantMessage('Should never be consumed.'),
];

async function tableWith(t, prepare, turns = 1) {
    const responses = [];
    for (let index = 0; index < turns; index++) responses.push(...settledThenDelivered());
    const session = await openTable({retainAt: directory, responses});
    t.after(() => session.dispose());
    session.emit('coc:mods-bridge', {async after() {}, prepare});
    return session;
}

test('a turn whose review never answered is published, and the player is told nothing about it', async t => {
    const session = await tableWith(t, async method => (method === 'narrate'
        ? {unreviewed: {cause: 'The private reviewer ended without a checked submission', service: true}} : undefined));
    await session.session.prompt('我盯住崖顶那盏灯。');
    await waitForIdle(session.session);

    const delivered = session.kernelRequests().filter(request => request.method === 'table.narrate');
    assert.ok(delivered.length >= 1, 'the delivery reached the kernel, so it renders, commits and strips its own machine tokens');
    assert.equal(delivered[0].params.text, 'The turn the review never judged.');
    assert.ok(session.telemetry().some(row => row.tool === 'narrate' && row.ok === true));
    // Nothing of §38's stranding path runs: no undelivered card, no service sentence, no release.
    assert.equal(session.telemetry().filter(row => row.reason === 'settled_without_delivery').length, 0);
    assert.equal(customMessages(session.session, 'coc-delivery').filter(message => message.details?.review_unavailable).length, 0);
    assert.equal(session.kernelRequests().filter(request => request.params?.release === 'stranded').length, 0);

    // The record is the evidence (§26.1): one row, on the turn that paid for it, naming the cause.
    const noted = session.telemetry().filter(row => row.lane === 'continuity-review' && row.reason === 'delivered_unreviewed');
    assert.ok(noted.length >= 1, JSON.stringify(session.telemetry().filter(row => row.lane === 'continuity-review')));
    assert.equal(noted[0].turn, 1);
    assert.equal(noted[0].streak, 1);
    assert.equal(noted[0].cause, 'The private reviewer ended without a checked submission');
    // One unreviewed turn is not a lane to escalate: the operator hears nothing yet.
    assert.equal(session.entries('coc-review-status').length, 0);
});

test('a lane that keeps not answering reaches the operator once, and never the player', async t => {
    const session = await tableWith(t, async method => (method === 'narrate'
        ? {unreviewed: {cause: 'The private reviewer ended without a checked submission', service: true}} : undefined), 3);
    for (const line of ['一', '二', '三']) {
        await session.session.prompt(line);
        await waitForIdle(session.session);
    }
    const noted = session.telemetry().filter(row => row.reason === 'delivered_unreviewed');
    assert.deepEqual(noted.map(row => row.streak), [1, 2, 3], 'the streak survives a landed narrate, which §38.5’s does not');
    const statuses = session.entries('coc-review-status');
    assert.equal(statuses.length, 1, JSON.stringify(statuses));
    assert.equal(statuses[0].status, 'unreviewed');
    assert.equal(statuses[0].streak, 2);
    assert.match(statuses[0].fix, /Lane model/);
    assert.equal(customMessages(session.session, 'coc-delivery').filter(message => message.details?.review_unavailable).length, 0,
        'the player’s turns arrived; a table that plays is not a notice');
});

test('a review that answers clears the streak', async t => {
    let answered = false;
    const session = await tableWith(t, async method => {
        if (method !== 'narrate') return undefined;
        if (answered) return undefined;
        answered = true;
        return {unreviewed: {cause: 'The private reviewer ended without a checked submission', service: true}};
    }, 3);
    for (const line of ['一', '二', '三']) {
        await session.session.prompt(line);
        await waitForIdle(session.session);
    }
    const noted = session.telemetry().filter(row => row.reason === 'delivered_unreviewed');
    assert.deepEqual(noted.map(row => row.streak), [1]);
    assert.equal(session.entries('coc-review-status').length, 0);
});

/**
 * Cold recovery reads the same cut. A retained block a verdict stands behind still strands the turn
 * it recovered (§38, §36.14); one that nothing read this draft to reach lets the recovery run finish,
 * and its own delivery meets the review on the terms above.
 */
for (const [reviewed, stranded] of [[true, true], [false, false]])
test(`a retained ${reviewed ? 'verdict' : 'unjudged'} block ${stranded ? 'strands' : 'does not strand'} the recovered turn`, async t => {
    const session = await openTable({retainAt: directory, env: {FAKE_KERNEL_PENDING: '1'},
        responses: [fauxAssistantMessage([fauxToolCall('narrate', {text: 'Finishing the recovered turn.'})], {stopReason: 'toolUse'}),
            fauxAssistantMessage('done')],
        extraExtensions: [{name: 'mods-bridge-probe', factory: pi => {
            pi.events.emit('coc:mods-bridge', {async after() {}, async prepare() {},
                async reviewStatus() { return {enabled: true, paused: true, reason: 'A retained block', service: true, reviewed}; }});
        }}]});
    t.after(() => session.dispose());
    assert.equal(session.entries('coc-review-status').length, stranded ? 1 : 0,
        JSON.stringify(session.entries('coc-review-status')));
});
