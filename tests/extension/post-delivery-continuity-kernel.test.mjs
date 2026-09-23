/**
 * Contract §130, kernel side, over the real TS kernel in process: a continuity review may be bound
 * after the turn it reviewed has closed, its verdict lands on that turn's record through `table.warn`,
 * and the next capsule carries it forward — first, with a forward-looking `fix`, and late when the
 * player answered before the review did.
 *
 * Retained live baseline (2026-09-22, `game-21ac44b7-5f91-41a5-8ea7-9faf5b801a29`): the review held
 * `narrate` for 14.3 s, 20.1 s and 15.3 s on turns 0-2, every one of them a `pass`. Publishing first is
 * only lawful if the verdict still reaches the Keeper afterwards; that is what this file proves.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {table} from './object-usages-fixture.mjs';

const DRAFT = 'You raise the chair. Knott steps back from the desk and the lamp swings.';
const CLAIM = 'Knott steps back from the desk and the lamp swings.';

/**
 * A checked report whose one conflict cites the draft and a retained evidence file. The fixture table
 * carries the product's `narration-audit`, so this is the schema-2 selector artifact the private
 * reviewer actually submits: aliases only, never copied prose (§36.14, T14).
 */
async function writeRevise(job) {
    assert.equal(job.continuity_schema, 2);
    const sources = job.focus.sources;
    const evidence = sources.evidence.find(source => source.text === 'I swing the chair at Knott.') ?? sources.evidence[0];
    await writeFile(join(job.cwd, 'result.json'), JSON.stringify({schema: 2, missing: [],
        findings: [{reason: 'The desk position contradicts the retained scene.', fix: 'Rewrite the whole candidate so Knott stays where he stood.'}],
        continuity_review: {verdict: 'revise', summary: 'Knott was never at the desk.', conflicts: [
            {claim_source: sources.draft.find(source => source.text.includes('Knott')).alias, reason: 'The retained turn places Knott elsewhere.', evidence_sources: [evidence.alias]}],
            intelligibility_review: {verdict: 'pass', source: null}, player_address_review: {verdict: 'pass', source: null},
            locus_review: {verdict: 'pass', mode: 'same_locus', basis: 'active_scene', locus_source: null, claim_source: null}}}));
}
const record = async (game, turn) => JSON.parse(await readFile(join(game.directory, 'turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));

test('a review bound after delivery reaches the record and the next capsule, and never reopens the turn', async t => {
    const game = await table(t);
    const job = await game.call('mods.job', {role: 'audit', input: {text: DRAFT}});
    assert.equal(job.continuity_review, true);
    await writeRevise(job);

    // The delivery publishes first: nothing about the review is in front of it.
    const delivered = await game.call('table.narrate', {call_id: game.next(), text: DRAFT});
    assert.equal(delivered.turn, 1);

    // The live comparisons of the gate cannot hold any more: the cursor moved on.
    await assert.rejects(game.call('mods.accept', {job: job.job}), /another turn/);
    const accepted = await game.call('mods.accept', {job: job.job, after_delivery: true}).catch(error => { throw new Error(JSON.stringify(error.details)); });
    assert.equal(accepted.continuity_review.verdict, 'revise');

    const warned = await game.call('table.warn', {turn: 1, lane: 'continuity-review', mode: 'post', job: job.job});
    assert.equal(warned.accepted, 2);
    const closed = await record(game, 1);
    assert.equal(closed.rendered_text, DRAFT, 'the published words are the published words');
    assert.deepEqual({mode: closed.continuity_review.mode, reviewed: closed.continuity_review.reviewed,
        verdict: closed.continuity_review.verdict, job: closed.continuity_review.job},
        {mode: 'post', reviewed: true, verdict: 'revise', job: job.job});
    const conflict = closed.warnings.find(row => row.kind === 'continuity_conflict');
    assert.equal(conflict.quote, CLAIM, 'a claim the player read is anchored to the rendered text');
    assert.match(conflict.fix, /do not rewrite/i);
    const finding = closed.warnings.find(row => row.kind === 'continuity_finding');
    assert.doesNotMatch(finding.fix, /candidate/, 'the reviewer’s draft-rewrite fix is not forwarded after publication');

    // Idempotent: a retry of the same job adds nothing, and a later "nothing was read" cannot erase a reading.
    await game.call('table.warn', {turn: 1, lane: 'continuity-review', mode: 'post', job: job.job});
    await game.call('table.warn', {turn: 1, lane: 'continuity-review', mode: 'post', unreviewed: {cause: 'stale replay pin', service: true}});
    assert.equal((await record(game, 1)).warnings.length, 2);
    assert.equal((await record(game, 1)).continuity_review.verdict, 'revise');

    const opened = await game.call('table.player_input', {text: 'I lower the chair.'});
    assert.equal(opened.capsule.warnings[0].kind, 'continuity_conflict', 'the verdict rides first');
    assert.match(opened.capsule.warnings[0].fix, /fiction/);
    assert.equal(opened.state, 'open', 'the next turn opens normally; nothing reopened turn 1');
});

test('a job that did not review the published words cannot be bound to them', async t => {
    const game = await table(t);
    const job = await game.call('mods.job', {role: 'audit', input: {text: DRAFT}});
    await writeRevise(job);
    await game.call('table.narrate', {call_id: game.next(), text: 'Different words reached the player.'});
    await assert.rejects(game.call('mods.accept', {job: job.job, after_delivery: true}),
        error => error.details?.reason === 'delivery_mismatch');
    await assert.rejects(game.call('table.warn', {turn: 1, lane: 'continuity-review', mode: 'post', job: job.job}),
        error => error.code === 'invalid_params');
});

test('retained evidence that changed after the pin is not approval', async t => {
    const game = await table(t);
    const job = await game.call('mods.job', {role: 'audit', input: {text: DRAFT}});
    await writeRevise(job);
    await game.call('table.narrate', {call_id: game.next(), text: DRAFT});
    const path = join(job.cwd, 'notes.json');
    const {chmod} = await import('node:fs/promises');
    await chmod(path, 0o600);
    await writeFile(path, JSON.stringify([{note: 'tampered'}]));
    await assert.rejects(game.call('mods.accept', {job: job.job, after_delivery: true}),
        error => error.details?.reason === 'mod_audit_evidence');
});

test('an unreviewed delivery is told apart from a reviewed one on the record', async t => {
    const game = await table(t);
    await game.call('table.narrate', {call_id: game.next(), text: DRAFT});
    await game.call('table.warn', {turn: 1, lane: 'continuity-review', mode: 'post',
        unreviewed: {cause: 'The private reviewer ended without a checked submission', service: true}});
    const closed = await record(game, 1);
    assert.deepEqual([closed.continuity_review.mode, closed.continuity_review.reviewed, closed.continuity_review.service],
        ['post', false, true]);
    assert.equal(closed.continuity_review.cause, 'The private reviewer ended without a checked submission');
    assert.equal(closed.warnings ?? undefined, undefined, 'nothing was judged, so nothing is warned');
    await assert.rejects(game.call('table.warn', {turn: 1, lane: 'continuity-review', mode: 'sideways',
        unreviewed: {cause: 'x', service: true}}), error => error.code === 'invalid_params');
});

test('a warning written after the next capsule was assembled rides the one after it, once', async t => {
    const game = await table(t);
    await game.call('table.narrate', {call_id: game.next(), text: DRAFT});
    // The player answered before the lane did: turn 2's capsule is assembled with nothing to show.
    const second = await game.call('table.player_input', {text: 'I wait.'});
    assert.equal(second.capsule.warnings.length, 0);
    await game.call('table.warn', {turn: 1, lane: 'verifier', findings: [{kind: 'uncommitted_state', quote: CLAIM, why: 'No move receipt.'}]});
    await game.call('table.narrate', {call_id: 't2-c1', text: 'Knott says nothing.'});
    const third = await game.call('table.player_input', {text: 'I leave.'});
    const late = third.capsule.warnings.filter(row => row.late === true);
    assert.equal(late.length, 1, JSON.stringify(third.capsule.warnings));
    assert.deepEqual([late[0].turn, late[0].kind, late[0].quote], [1, 'uncommitted_state', CLAIM]);
    await game.call('table.narrate', {call_id: 't3-c1', text: 'The hall is empty.'});
    const fourth = await game.call('table.player_input', {text: 'I go home.'});
    assert.equal(fourth.capsule.warnings.filter(row => row.late).length, 0, 'carried once, not forever');
});
