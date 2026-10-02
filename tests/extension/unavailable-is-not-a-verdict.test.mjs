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


/**
 * Turn 60. The reviewer submitted, and the shared allowance was spent. §38.9 calls that `service:
 * false` because it is not a lane being down -- and that is right, and it is also not a reading of
 * this draft. The two questions are different, and only the second may hold a delivery back.
 */


/**
 * Turns 92 and 107, and the boundary of this section: the reviewer read the draft, refused it, read
 * the one bounded repair `max_rewrites` permits and refused that too. That is the guard working, it
 * still ends the input, and no part of §91 reaches it.
 */


/** And the retained verdict is replayed as a verdict, not downgraded on the next read of the file. */


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







/**
 * Cold recovery reads the same cut. A retained block a verdict stands behind still strands the turn
 * it recovered (§38, §36.14); one that nothing read this draft to reach lets the recovery run finish,
 * and its own delivery meets the review on the terms above.
 */


// Section 166 retires automatic prose-review integration cases.
// Current no-review delivery coverage: single-pass-narration.test.mjs and post-delivery-continuity.test.mjs.
