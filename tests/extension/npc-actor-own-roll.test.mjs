/**
 * §11.5.9 (SL-71): a `resolve` whose `actor` is a person the table knows -- an authored NPC, a table
 * person, a `from_passage` person -- is that NPC's own roll, not the investigator's. Retained live
 * evidence: long gate #11 refused five such calls `unknown_entity` because `read/handlers.ts`'s
 * `actor()` only ever knew investigators; the Keeper repeated each to the class limit and the refusal
 * budget cut two runs.
 *
 * Everything below travels the real path: the product kernel's own handlers create a campaign, place
 * and pin an NPC, and settle a `resolve` naming that NPC as the actor. Nothing is hand-built.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'npc-actor-'));
after(() => rm(temporary, { recursive: true, force: true }));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({
	stdin: { contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: root, sourcefile: 'npc-actor-api.ts' },
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node',
	target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

/** A person nobody in the module authored: established at the table, exactly like Steven Knott's
 *  table (gate #11) or Larkin's (§66) -- a name the Keeper introduced, never a book NPC. */
const GUARD = 'Fabius Okonkwo';
/** A second table person, for the shape where neither `actor` nor `target` is an investigator. */
const OTHER = 'Cassius Vane';

/** One real campaign on the product kernel, opened and past its first delivery. */
async function table(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({
		workspace: home, content: join(root, 'content'), seed: 'npc-actor-own-roll',
		locks: api.createAdvisoryLocks(async () => {}),
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
	});
	const runtime = api.createKernelRuntime(context);
	t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({ campaign: 'c1', ...params });
	await call('campaign.create', { id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en' });
	await call('table.open');
	const partyDir = join(home, '.coc/campaigns/c1/party');
	const file = join(partyDir, (await readdir(partyDir)).find((name) => name.endsWith('.json')));
	let turn = 0, ordinal = 0;
	const game = {
		call, home,
		next: () => `t${turn}-c${++ordinal}`,
		investigator: async () => JSON.parse(await readFile(file, 'utf8')),
		investigatorRaw: async () => readFile(file, 'utf8'),
		receipts: async () => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/turn.json'), 'utf8')).receipts,
		apply: (effect) => call('table.apply', { call_id: game.next(), effects: [effect] }),
		resolve: (action) => call('table.resolve', { call_id: game.next(), action }),
		async say(text) { await call('table.player_input', { text }); turn += 1; ordinal = 0; },
	};
	turn = 1;
	await call('table.narrate', { call_id: 't0-c1', text: 'The door closes behind you.' });
	await game.say('I look around the room.');
	turn = 1;
	return game;
}

/** Places `name` (default `GUARD`) in the current scene, a table person the module never authored. */
async function place(game, name = GUARD) {
	const result = await game.apply({ kind: 'npc', name, to: 'here', why: 'a face at the table' });
	const receipt = (await game.receipts()).find((row) => result.receipts.includes(row.id) && row.kind === 'npc');
	assert.ok(receipt, 'placing the person minted an npc receipt');
	return receipt.handle;
}

test('an NPC actor with a pinned skill rolls it, Keeper-side, and never touches the investigator', async (t) => {
	const game = await table(t);
	const handle = await place(game);
	await game.apply({ kind: 'npc', name: GUARD, skill: { name: 'Fighting (Brawl)', value: 65 }, why: 'a rough sort' });
	const before = await game.investigatorRaw();

	const result = await game.resolve({ intent: 'investigate', actor: GUARD, skill: 'Fighting (Brawl)', goal: 'wrestle the door open' });
	assert.equal(result.outcome.kind, 'check');
	assert.equal(result.outcome.target, 65, "the roll used the guard's pinned value, not the investigator's");

	const rolls = (await game.receipts()).filter((row) => row.kind === 'roll' && row.id === result.receipt);
	assert.equal(rolls.length, 1);
	const [roll] = rolls;
	assert.equal(roll.actor, handle, 'the receipt names the guard as the actor');
	assert.equal(roll.actor_is_investigator, false, 'never the investigator');
	assert.equal(roll.visibility, 'keeper', 'Keeper-side by default: no name and no number reaches the player');

	// The investigator's own sheet is byte-for-byte the same: nothing about this roll wrote to it.
	assert.equal(await game.investigatorRaw(), before);
});

test('an NPC actor with no pinned or authored skill rolls the skill\'s rulebook base chance instead of refusing', async (t) => {
	const game = await table(t);
	await place(game);
	// Only Fighting (Brawl) is pinned; Spot Hidden is untouched, book or ledger.
	await game.apply({ kind: 'npc', name: GUARD, skill: { name: 'Fighting (Brawl)', value: 65 }, why: 'a rough sort' });

	const result = await game.resolve({ intent: 'investigate', actor: GUARD, skill: 'Spot Hidden', goal: 'watch the yard' });
	assert.equal(result.outcome.kind, 'check');
	// Call of Cthulhu 7e's printed base chance for Spot Hidden is 25%: the same deterministic number an
	// investigator's own unlisted skill already falls back to (`resolveTarget`'s `rulebook_base`).
	assert.equal(result.outcome.target, 25);
});

test("an NPC actor's bare characteristic, with no authored or pinned value, still asks instead of guessing", async (t) => {
	const game = await table(t);
	const handle = await place(game);
	const error = await game.resolve({ intent: 'investigate', actor: GUARD, skill: 'STR', goal: 'force the door' })
		.then(() => null, (thrown) => thrown);
	assert.ok(error, 'a characteristic has no rulebook-wide default to fall back to');
	assert.equal(error.code, 'needs');
	assert.equal(error.details?.needs?.field, 'npc.skill');
	assert.equal(error.details?.actor, handle);
});

test('an actor nobody at the table or in the book knows is refused, naming investigators and known people alike', async (t) => {
	const game = await table(t);
	const handle = await place(game);
	// A name close enough to the guard's to be ranked as a candidate, but not an exact match.
	const error = await game.resolve({ intent: 'investigate', actor: 'Fabius Okonko', skill: 'Spot Hidden', goal: 'look around' })
		.then(() => null, (thrown) => thrown);
	assert.ok(error, 'an unresolved actor name is refused');
	assert.equal(error.code, 'unknown_entity');
	const candidates = error.details?.candidates ?? [];
	assert.ok(candidates.some((row) => row.kind === 'investigator'), 'the sole investigator is offered');
	assert.ok(candidates.some((row) => row.kind === 'npc' && row.name === handle), "the guard the table has already met is offered by his handle");
});

/**
 * §11.5.9 addendum (gate #11 t0/t19): `natural-npc:first-impression`'s roles are fixed by the rules --
 * the investigator rolls, the NPC is the target -- but the Keeper wrote "Steven Knott's first
 * impression of Thomas Hayes" as `{actor: "Steven Knott", target: "Thomas Hayes"}`, the pair the
 * English sentence suggests and the rules' own order reversed. That used to be `unknown_entity` (no
 * investigator named Steven Knott); it now settles as the investigator's own roll and says so.
 */
test('a first-impression written with the NPC as actor and the investigator as target settles oriented, not refused', async (t) => {
	const game = await table(t);
	const handle = await place(game);
	const investigator = await game.investigator();
	const before = await game.investigatorRaw();

	const result = await game.resolve({ intent: 'social', decision: 'natural-npc:first-impression', actor: GUARD, target: investigator.name });
	assert.equal(result.outcome.kind, 'check');
	assert.deepEqual(result.outcome.oriented_from, { actor: GUARD, target: investigator.name });
	assert.equal(result.outcome.actor, investigator.name, "settled as the investigator's own roll, not the guard's");
	assert.equal(result.outcome.target_npc, GUARD, "the impression is of the guard, the true target after the swap");

	const roll = (await game.receipts()).find((row) => row.id === result.receipt);
	assert.ok(roll);
	assert.equal(roll.actor, investigator.id, 'the investigator is the one who rolled');
	assert.equal(roll.actor_is_investigator, true);
	assert.deepEqual(roll.oriented_from, { actor: GUARD, target: investigator.name });
	assert.equal(roll.npc, handle, "the guard is the one the impression is of");

	// This is the investigator's own roll, so their sheet legitimately supplies APP/Credit Rating --
	// reading it is not the same defect as writing to it. Confirm it is still untouched either way.
	assert.equal(await game.investigatorRaw(), before);
});

/**
 * §11.5.9 addendum: the swap is only taken when it is real. Neither name here is an investigator, so
 * this is exactly the refusal it always was -- now naming both an investigator and this table's known
 * people as candidates, since `graph.candidates` already ranks an established person like `GUARD`.
 */
test('a first-impression whose target is also an NPC still refuses unknown_entity, naming both kinds of candidate', async (t) => {
	const game = await table(t);
	const handle = await place(game);
	await place(game, OTHER);
	const error = await game.resolve({ intent: 'social', decision: 'natural-npc:first-impression', actor: GUARD, target: OTHER })
		.then(() => null, (thrown) => thrown);
	assert.ok(error, 'neither side is an investigator, so this is not settled');
	assert.equal(error.code, 'unknown_entity');
	const candidates = error.details?.candidates ?? [];
	assert.ok(candidates.some((row) => row.kind === 'investigator'), 'the sole investigator is still offered');
	assert.ok(candidates.some((row) => row.kind === 'npc' && row.name === handle), 'the guard, already known to the table, is offered too');
});

/**
 * §11.5.9's original shape (gate #11 t4): an ordinary check with an NPC actor and no target at all is
 * that NPC's own roll, exactly as the earlier tests in this file already prove for other skills --
 * Charm included, the exact skill the Keeper's own Ruth Blake attempt used.
 */
test('an ordinary Charm check with an NPC actor and no target is that NPC\'s own roll, not the investigator\'s', async (t) => {
	const game = await table(t);
	const handle = await place(game);
	const before = await game.investigatorRaw();

	const result = await game.resolve({ intent: 'social', actor: GUARD, skill: 'Charm', goal: 'talk his way past the gate' });
	assert.equal(result.outcome.kind, 'check');

	const roll = (await game.receipts()).find((row) => row.id === result.receipt);
	assert.ok(roll);
	assert.equal(roll.actor, handle);
	assert.equal(roll.actor_is_investigator, false);
	assert.equal(roll.visibility, 'keeper');
	assert.equal(await game.investigatorRaw(), before);
});
