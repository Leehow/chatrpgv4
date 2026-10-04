/**
 * Contract §179.2: the capsule's `own` carries the investigator's own record -- the card's backstory and the player's own
 * words from turns the Keeper's history no longer carries -- hung on the investigator rather than on who is present.
 *
 * App table `game-8e41c325` (Blood Road, 2026-10-04), turn 6: the player leafed through the investigator's notes and the
 * Keeper wrote the room. The card named the notes and nothing in them; whom they sought (a nineteen-year-old blonde) and
 * what she drove (a blue Beetle) were the player's words on turns 2 and 3. At the bar `recent` held turns 4-5, and
 * `memory` ranked by the people present, so no section of the turn-6 capsule carried either particular.
 *
 * These tests drive the real kernel over RPC.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { KernelClient } from '../../extensions/kernel/client.ts';
import { playtestScratch } from './playtest-scratch.mjs';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content'), RPC = join(ROOT, 'build/kernel/rpc.mjs');
const evidence = playtestScratch('investigator-own-record', 'run-');
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

function environment() {
	return {
		...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
		GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0',
		GIT_AUTHOR_DATE: '2000-01-02T03:04:05Z', GIT_COMMITTER_DATE: '2000-01-02T03:04:05Z',
		GIT_AUTHOR_NAME: 'coc', GIT_AUTHOR_EMAIL: 'coc@example.invalid',
		GIT_COMMITTER_NAME: 'coc', GIT_COMMITTER_EMAIL: 'coc@example.invalid',
	};
}

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
	let turn = 0;
	return {
		call,
		capsule: () => call('table.capsule'),
		/** One delivered turn: the player's words, then the Keeper's. */
		async play(words) {
			turn += 1;
			await call('table.player_input', { text: words });
			await call('table.narrate', { call_id: `t${turn}-c1`, text: `The table answers turn ${turn}.` });
			return turn;
		},
	};
}

test('the card and the player\'s words that left the history reach the capsule on the investigator (§179.2)', async (t) => {
	const game = await table(t);
	const first = await game.capsule();
	assert.ok(first.own, 'every capsule with an investigator carries own');
	assert.deepEqual(first.own.said, [], 'no earlier turn, no earlier words');
	// The pregen nests its errand one level down; the card keeps the path, never a list of category names.
	assert.match(first.own.card['scenario_bound.description'] ?? '', /Knott/, `the errand reaches the card: ${JSON.stringify(first.own.card)}`);
	assert.ok(first.own.card.treasured_possessions, 'what they carry and value reaches the card');
	assert.equal('personal_description' in first.own.card, false, 'appearance stays in known.investigator');
	// The pregen has no key_connection: an absent field is absent, never the word an absent value renders as.
	assert.equal('key_connection' in first.own.card, false, `no key connection on this card: ${JSON.stringify(first.own.card)}`);
	assert.equal(Object.values(first.own.card).some((value) => value === 'None' || value === ''), false);
	assert.match(first.head, /\bown is the investigator's own record\b/, 'the head names the interface');

	await game.play('I tell Knott I am looking for a nineteen-year-old blonde who drove a blue Beetle.');
	await game.play('I ask him where to eat.');
	await game.play('I order a burger.');
	const capsule = await game.capsule();
	const shown = capsule.recent.map((entry) => entry.turn);
	assert.deepEqual(shown, [2, 3], 'recent holds the last two turns');
	assert.deepEqual(capsule.own.said.map((entry) => entry.turn), [1], 'own carries the turn recent no longer does, and only it');
	assert.match(capsule.own.said[0].player, /blue Beetle/, 'the player\'s particular reaches the turn it would have left');
	assert.equal('omitted' in capsule.own, false, 'nothing between is left out');
	assert.equal((capsule.truncated ?? []).includes('own'), false);
});

test('a long table keeps the earliest and the latest words and names the turns between (§179.2)', async (t) => {
	const game = await table(t);
	const filler = 'and I keep my eyes on the room while I wait for anyone to come back through the door, ';
	await game.play('I am looking for my client\'s daughter, Mary, nineteen, blonde, last seen in a blue Beetle.');
	for (let i = 2; i <= 30; i += 1) await game.play(`Turn ${i}: I walk the street once more, ${filler.repeat(2)}`);
	const capsule = await game.capsule();
	const own = capsule.own, said = own.said.map((entry) => entry.turn);
	assert.ok(bytes(own) <= 2048, `own stays within its budget: ${bytes(own)} bytes`);
	assert.equal(said[0], 1, 'the first words stay: they are where the player said who the investigator is');
	assert.ok(said.includes(28), `the latest words outside the window stay: ${said}`);
	assert.equal(said.some((turn) => capsule.recent.some((entry) => entry.turn === turn)), false, 'never a turn recent carries');
	assert.ok(Array.isArray(own.omitted) && own.omitted.length === 2, `the gap is named: ${JSON.stringify(own.omitted)}`);
	const [from, to] = own.omitted;
	for (let turn = 1; turn <= 28; turn += 1)
		assert.equal(said.includes(turn), !(turn >= from && turn <= to), `turn ${turn} is either said or inside omitted, never both or neither`);
	assert.ok(own.said.every((entry) => entry.player.length <= 160), 'one turn\'s words are bounded');
	assert.ok(own.said.some((entry) => entry.cut === true), 'a cut line says so');
	assert.equal((capsule.truncated ?? []).includes('own'), false, 'selection is by design, not a budget cut');
});
