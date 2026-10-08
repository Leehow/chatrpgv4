/**
 * Contract §198.3 at the host: the people a reference book places in its opening are judged by Jev when the table opens, and
 * the ones it puts there are seated before the opening run is sent. Real table TR-F2 run 2 (Cold Harvest): the opening's
 * text put Captain Aganin behind the desk, `present` was empty, and the Keeper narrated an empty room. §149.1's case stays:
 * a person the book links to the opening but brings in only if something happens first (Dust to Dust's Eric Helverson) is
 * not seated.
 *
 * The lane (`seatOpeningPeople`) over a scripted decision port and a recording kernel call. The real entry -- the kernel
 * extension opening `roster-book.mjs`'s campaign on the real kernel through the product's own Jev adapter -- is
 * `opening-presence-table.test.mjs`.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CAMPAIGN, CAPTAIN, VISITOR} from './roster-book.mjs';
import {OPENING_SEAT_WHY, openingPeopleOf, seatOpeningPeople} from '../../extensions/kernel/opening-presence.ts';
import {OPENING_PRESENCE_AT, OPENING_PRESENCE_FAMILY, openingPresenceBatch} from '../../runtime/jev/opening-presence.ts';

const OPEN = {opening_needed: true, opening_people: {scene: {name: 'scene-x', display_name: 'Chapter Two', text: 'The captain stands behind the desk.'},
	people: [{name: 'npc-a', display_name: CAPTAIN, summary: 'The commissar.', placed_by: {name: 'Briefing One', summary: 'The captain briefs them.'}},
		{name: 'npc-b', display_name: VISITOR, summary: 'Comes in only if they refuse the orders.', conditions: {when: 'the orders are refused'}}]}};

/** A decision port that answers each person's Noul from `nouls` by the name the item carries, and records the batches. */
function port(nouls, {status = 'complete'} = {}) {
	const asked = [];
	return {asked, decide: async batch => {
		asked.push(batch);
		const answers = Object.fromEntries(batch.questions.map(question => [question.key, {status: 'answered', type: 'noul', noul: nouls[batch.state.items[question.target].name]}]));
		return {batchId: batch.id, status, answers, coverage: {required: [], answered: [], unknown: []}, issues: []};
	}};
}
function host(decision, {refuse = null} = {}) {
	const calls = [], rows = [];
	let ordinal = 0;
	return {calls, rows, deps: {campaign: CAMPAIGN, open: OPEN, decision: () => decision, mintCallId: () => `t0-c${++ordinal}`, record: row => rows.push(row),
		call: async (method, params) => { calls.push({method, params}); if (refuse) throw refuse; return {receipts: ['npc:x']}; }}};
}

test('§198.3: the lane asks one Noul per person and seats the ones Jev puts in the opening, in one apply', async () => {
	const decision = port({[CAPTAIN]: 0.94, [VISITOR]: 0.08}), h = host(decision);
	assert.deepEqual(await seatOpeningPeople(h.deps), ['npc-a']);
	assert.equal(decision.asked.length, 1, 'one batch for the opening');
	const [batch] = decision.asked;
	assert.equal(batch.family, OPENING_PRESENCE_FAMILY);
	assert.deepEqual(batch.state.scene, {name: 'Chapter Two', text: 'The captain stands behind the desk.'}, 'the book\'s own text for the scene');
	assert.deepEqual(batch.state.items.p1.placed_by, {name: 'Briefing One', summary: 'The captain briefs them.'});
	assert.deepEqual(batch.state.items.p2.conditions, {when: 'the orders are refused'}, 'the conditions the book states travel to the judge');
	assert.match(batch.questions[0].instructions, /only if something happens first/, 'the question names the conditional arrival');
	assert.deepEqual(h.calls, [{method: 'table.apply', params: {campaign: CAMPAIGN, call_id: 't0-c1', effects: [{kind: 'npc', name: 'npc-a', to: 'here', why: OPENING_SEAT_WHY}]}}]);
	assert.deepEqual(h.rows.map(row => [row.lane, row.event, row.seated, row.nouls]), [['opening-presence', 'seated', ['npc-a'], [0.94, 0.08]]]);
});

test('§198.3: the bar is the bar, and nobody below it is seated', async () => {
	const h = host(port({[CAPTAIN]: OPENING_PRESENCE_AT - 0.01, [VISITOR]: 0.2}));
	assert.deepEqual(await seatOpeningPeople(h.deps), []);
	assert.deepEqual(h.calls, [], 'no write when nobody is there');
	assert.equal(h.rows[0].event, 'seated');
	const at = host(port({[CAPTAIN]: OPENING_PRESENCE_AT, [VISITOR]: 0.2}));
	assert.deepEqual(await seatOpeningPeople(at.deps), ['npc-a'], 'at the bar is in');
});

test('§198.3: Jev unconfigured, unavailable or refused seats nobody, and the opening goes on', async () => {
	const none = host(undefined);
	assert.deepEqual(await seatOpeningPeople(none.deps), []);
	assert.deepEqual([none.calls.length, none.rows[0].event, none.rows[0].reason], [0, 'fallback', 'no_jev']);
	const down = host(port({[CAPTAIN]: 0.9, [VISITOR]: 0.9}, {status: 'unavailable'}));
	assert.deepEqual(await seatOpeningPeople(down.deps), []);
	assert.deepEqual([down.calls.length, down.rows[0].event], [0, 'fallback']);
	const refused = host(port({[CAPTAIN]: 0.9, [VISITOR]: 0.1}), {refuse: Object.assign(new Error('opening_seat'), {code: 'invalid_params', details: {reason: 'opening_seat'}})});
	assert.deepEqual(await seatOpeningPeople(refused.deps), [], 'a refused seat is reported, never thrown');
	assert.deepEqual([refused.rows[0].event, refused.rows[0].reason, refused.rows[0].detail], ['fallback', 'seat_refused', 'opening_seat']);
	assert.equal(openingPeopleOf({opening_needed: true}), null, 'no opening_people, nothing to ask');
});

test('§198.3: the batch packs and binds as the product sends it', () => {
	const batch = openingPresenceBatch({name: 'Chapter Two', text: 'x'}, [{name: CAPTAIN}], 'c');
	assert.deepEqual(batch.questions.map(question => [question.key, question.type, question.target]), [['present_p1', 'noul', 'p1']]);
});
