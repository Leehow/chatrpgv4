/**
 * Contract §38: a turn whose review can approve nothing must still be able to return to the player.
 * Retained live evidence `midgame-bridge-live-21` turn 3 deadlocked because `table.player_input` refused
 * every further utterance while `narrate` could never pass, and a cold restart did not clear it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { KernelClient } from '../../extensions/kernel/client.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content'), RPC = join(ROOT, 'build/kernel/rpc.mjs');
const evidence = join(ROOT, '.coc/playtests/ts-turn-stranding');
await mkdir(evidence, { recursive: true });
const create = { id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en' };

function environment() {
	return {
		...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
		GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0',
		GIT_AUTHOR_DATE: '2000-01-02T03:04:05Z', GIT_COMMITTER_DATE: '2000-01-02T03:04:05Z',
		GIT_AUTHOR_NAME: 'coc', GIT_AUTHOR_EMAIL: 'coc@example.invalid',
		GIT_COMMITTER_NAME: 'coc', GIT_COMMITTER_EMAIL: 'coc@example.invalid',
	};
}
const client = (home) => new KernelClient({ command: [process.execPath, RPC, '--workspace', home, '--content', CONTENT], cwd: ROOT, env: environment(), inheritEnv: false, timeoutMs: 20000 });
const turnFile = (home) => readFile(join(home, '.coc/campaigns/c1/turn.json'), 'utf8').then(JSON.parse);
const recordFile = (home, n) => readFile(join(home, '.coc/campaigns/c1/turns', `${String(n).padStart(4, '0')}.json`), 'utf8').then(JSON.parse);

/** Open the table, close turn 0, and leave turn 1 `acting` with one receipt already landed. */
async function actingTurn(home, kernel) {
	await kernel.call('campaign.create', create);
	await kernel.call('table.open', { campaign: 'c1' });
	await kernel.call('table.narrate', { campaign: 'c1', call_id: 't0-c1', text: 'The case begins.' });
	await kernel.call('table.player_input', { campaign: 'c1', text: 'I listen at the door.' });
	await kernel.call('table.resolve', { campaign: 'c1', call_id: 't1-c1', action: { intent: 'investigate', skill: 'Listen' } });
	const cursor = await turnFile(home);
	assert.equal(cursor.state, 'acting');
	assert.equal(cursor.turn, 1);
	assert.equal(cursor.receipts.length, 1);
	return cursor;
}

test('a stranded acting turn is released, recorded with its receipts, and the next turn opens', async (t) => {
	const home = await mkdtemp(join(evidence, 'release-')), kernel = client(home);
	t.after(() => kernel.close());
	const before = await actingTurn(home, kernel);

	// Without the release the guard is unchanged: the campaign stays where it was.
	await assert.rejects(kernel.call('table.player_input', { campaign: 'c1', text: 'I give up on the door.' }),
		(error) => error.code === 'turn_state');
	assert.equal((await turnFile(home)).state, 'acting');

	const opened = await kernel.call('table.player_input', { campaign: 'c1', text: 'I give up on the door.', release: 'stranded' });
	assert.equal(opened.turn, 2);
	assert.equal(opened.state, 'open');
	assert.ok(opened.capsule);

	const stranded = await recordFile(home, 1);
	assert.equal(stranded.closed_by, 'stranded');
	assert.equal(stranded.text, null);
	assert.equal(stranded.rendered_text, null);
	assert.equal(stranded.commit, null);
	assert.equal(stranded.player_text, before.player_text);
	assert.deepEqual(stranded.receipts.map((receipt) => receipt.id), before.receipts.map((receipt) => receipt.id));

	const cursor = await turnFile(home);
	assert.equal(cursor.turn, 2);
	assert.equal(cursor.state, 'open');
	assert.equal(cursor.player_text, 'I give up on the door.');

	const events = (await readFile(join(home, '.coc/campaigns/c1/events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
	const strandedEvent = events.find((event) => event.type === 'turn-stranded');
	assert.ok(strandedEvent, 'the release appends a turn-stranded event');
	assert.equal(strandedEvent.turn, 1);
	assert.deepEqual(strandedEvent.data.receipts, before.receipts.map((receipt) => receipt.id));

	// A stranded record is not a delivery: nothing reads it back as one.
	const transcript = (await readFile(join(home, '.coc/campaigns/c1/transcript.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
	assert.equal(transcript.filter((line) => line.turn === 1 && line.role === 'keeper').length, 0);
});

test('release is refused on a turn that is not stranded', async (t) => {
	const home = await mkdtemp(join(evidence, 'guard-')), kernel = client(home);
	t.after(() => kernel.close());
	await kernel.call('campaign.create', create);
	await kernel.call('table.open', { campaign: 'c1' });
	await kernel.call('table.narrate', { campaign: 'c1', call_id: 't0-c1', text: 'The case begins.' });
	assert.equal((await turnFile(home)).state, 'awaiting_player');
	await assert.rejects(kernel.call('table.player_input', { campaign: 'c1', text: 'I read the letter.', release: 'stranded' }),
		(error) => error.code === 'invalid_params');
	await assert.rejects(kernel.call('table.player_input', { campaign: 'c1', text: 'I read the letter.', release: 'abandon' }),
		(error) => error.code === 'invalid_params');
	// The refusals changed nothing; an ordinary input still opens the turn.
	assert.equal((await kernel.call('table.player_input', { campaign: 'c1', text: 'I read the letter.' })).turn, 1);
});

test('the released turn survives a cold restart and the next turn commits normally', async (t) => {
	const home = await mkdtemp(join(evidence, 'restart-')), first = client(home);
	t.after(() => first.close());
	await actingTurn(home, first);
	await first.call('table.player_input', { campaign: 'c1', text: 'I try the window instead.', release: 'stranded' });
	await first.close();

	const second = client(home);
	t.after(() => second.close());
	const reopened = await second.call('table.open', { campaign: 'c1' });
	assert.equal(reopened.turn.number, 2);
	assert.equal(reopened.pending_turn?.player_text, 'I try the window instead.');
	const committed = await second.call('table.narrate', { campaign: 'c1', call_id: 't2-c1', text: 'The sash lifts an inch and sticks.' });
	assert.ok(committed.commit);
	assert.equal((await recordFile(home, 2)).closed_by, 'narrate');
	assert.equal((await recordFile(home, 1)).closed_by, 'stranded');
});
