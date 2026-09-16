/**
 * Contract §69: a turn that settled and was never told reaches the Keeper's next capsule.
 *
 * §38 lets a stranded turn end honestly and §50 hands the player its mechanics card. Both stop at the
 * state surface. Retained live evidence (`playtest-evidence/pipicoc-20260914`, home `t4`, campaign
 * `game-1c0faba5`, turn 81, 2026-09-16): an extreme Spot Hidden success landed a clue, handout 9 and a
 * twenty-minute advance; the continuity review returned `revise`, the bounded repair did not resolve,
 * and the turn was released `closed_by: "stranded"` with `text: null`.
 *
 * The next turn is where the cost actually fell. The capsule told the Keeper nothing about turn 81 --
 * `recent` carried it with `keeper: ""`, which reads exactly like a turn where nothing happened, and
 * `known.clues_here` already showed the clue `discovered: true`, which reads exactly like a delivery.
 * Turn 82's prose therefore said those observations were still not written down. The player, reading
 * that the page was blank, searched the same wall again on turn 83, and the clock charged twice for
 * one act. The receipts were never lost; the fiction came out contradicting them.
 *
 * These tests drive the real kernel over RPC and gate the undelivered turn explicitly, with
 * `table.player_input(release: "stranded")`, rather than by racing a delivery.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { KernelClient } from '../../extensions/kernel/client.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content'), RPC = join(ROOT, 'build/kernel/rpc.mjs');
const evidence = join(ROOT, '.coc/playtests/untold-turn-receipts');
await mkdir(evidence, { recursive: true });

function environment() {
	return {
		...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
		GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0',
		GIT_AUTHOR_DATE: '2000-01-02T03:04:05Z', GIT_COMMITTER_DATE: '2000-01-02T03:04:05Z',
		GIT_AUTHOR_NAME: 'coc', GIT_AUTHOR_EMAIL: 'coc@example.invalid',
		GIT_COMMITTER_NAME: 'coc', GIT_COMMITTER_EMAIL: 'coc@example.invalid',
	};
}

/** A live table on the real kernel, opened and already past turn 0. */
async function table(t) {
	const home = await mkdtemp(join(evidence, 'table-'));
	const kernel = new KernelClient({
		command: [process.execPath, RPC, '--workspace', home, '--content', CONTENT],
		cwd: ROOT, env: environment(), inheritEnv: false, timeoutMs: 30000,
	});
	t.after(() => kernel.close());
	const call = (method, params = {}) => kernel.call(method, { campaign: 'c1', ...params });
	await call('campaign.create', { id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en' });
	await call('table.open');
	await call('table.narrate', { call_id: 't0-c1', text: 'Knott hands over the address.' });
	return {
		call,
		capsule: () => call('table.capsule'),
		record: (turn) => readFile(join(home, '.coc/campaigns/c1/turns', `${String(turn).padStart(4, '0')}.json`), 'utf8').then(JSON.parse),
	};
}

/** Land a check and a clue on the open turn, then release it undelivered. Returns the stranded turn number. */
async function strandWithReceipts(game, turn, clue) {
	await game.call('table.resolve', { call_id: `t${turn}-c1`, action: { intent: 'investigate', skill: 'Listen' } });
	await game.call('table.apply', { call_id: `t${turn}-c2`, effects: [{ kind: 'clue', clue, how: 'Knott slid it across the desk.' }] });
	await game.call('table.player_input', { text: 'I keep going.', release: 'stranded' });
	return turn;
}

test('a turn that settled and was never told reaches the next capsule, receipt by receipt (§69)', async (t) => {
	const game = await table(t);
	await game.call('table.player_input', { text: 'I ask Knott for the keys and listen for anyone else in the office.' });
	await strandWithReceipts(game, 1, 'knott-keys');

	const stranded = await game.record(1);
	assert.equal(stranded.closed_by, 'stranded', 'the turn under test really is the undelivered one');
	assert.equal(stranded.text, null, 'and nothing was said on it');

	const capsule = await game.capsule();
	assert.equal(capsule.turn.number, 2);
	const rows = capsule.untold;
	assert.equal(rows.length, 1, `one undelivered turn, one row: ${JSON.stringify(rows)}`);
	assert.equal(rows[0].turn, stranded.turn, 'the row names the turn it is owed from');

	// Anchored on the record, not on wording: every receipt the kernel projects onto a delivered
	// turn's card is here, addressed by the id the record itself carries.
	const projected = new Set(rows[0].receipts.map((row) => row.receipt));
	const landed = stranded.receipts.map((receipt) => receipt.id);
	assert.ok(landed.some((id) => id.startsWith('roll:')) && landed.some((id) => id.startsWith('clue:')),
		`the stranded turn settled both a check and a finding: ${JSON.stringify(landed)}`);
	for (const id of landed.filter((value) => value.startsWith('roll:') || value.startsWith('clue:')))
		assert.ok(projected.has(id), `receipt ${id} settled and the capsule does not carry it: ${JSON.stringify(rows[0].receipts)}`);

	// The two shapes the capsule used to show, which together read as a delivered turn.
	const clue = capsule.known.clues_here.find((entry) => entry.name === 'knott-keys');
	assert.equal(clue.discovered, true, 'the ledger counts it: this is why the capsule read as delivered');
	assert.equal(capsule.recent.find((entry) => entry.turn === stranded.turn).keeper, '',
		'and the Keeper line for that turn is empty, which reads exactly like a turn where nothing happened');
});

test('a delivered turn discharges it, and nothing has to retract it (§69)', async (t) => {
	const game = await table(t);
	await game.call('table.player_input', { text: 'I ask Knott for the keys.' });
	await strandWithReceipts(game, 1, 'knott-keys');
	assert.equal((await game.capsule()).untold.length, 1);

	await game.call('table.narrate', { call_id: 't2-c1', text: 'The ring of keys is in your hand, and the room behind the door stays quiet.' });
	await game.call('table.player_input', { text: 'I go out to the house.' });
	assert.deepEqual((await game.capsule()).untold, [],
		'writing once with the findings in hand is what clears it; no writer has to');
});

test('undelivered turns accumulate until a delivery, and one that settled nothing adds no row (§69)', async (t) => {
	const game = await table(t);
	await game.call('table.player_input', { text: 'I ask Knott for the keys.' });
	await strandWithReceipts(game, 1, 'knott-keys');
	await strandWithReceipts(game, 2, 'knott-commission');

	const rows = (await game.capsule()).untold;
	assert.deepEqual(rows.map((row) => row.turn), [1, 2], 'the first is not dropped by the second, and they arrive in play order');

	// A turn that settled nothing is not a debt: an empty row would be a nag with no finding behind it.
	await game.call('table.player_input', { text: 'I say nothing.', release: 'stranded' });
	assert.deepEqual((await game.capsule()).untold.map((row) => row.turn), [1, 2],
		'the turn that settled nothing adds no row of its own');
});
