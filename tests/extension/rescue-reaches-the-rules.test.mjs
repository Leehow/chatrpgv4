/**
 * Harm and treatment reach the rules for whoever they are about, not only for the party (§66).
 *
 * Retained live evidence, campaign `game-3d8ab658` (M-DETOUR, `zh-Hans`). Augustus Larkin lay
 * unconscious from a heroin overdose from turn 55 on. Turn 64 the investigator dragged him
 * downstairs on a blanket and the check was settled -- `roll:first-aid-t64-c1`, First Aid 79
 * against 70, `failure`, and the receipt even carries `npc: "augustus-larkin"`, with declared
 * failure stakes of "拖楼梯时头颈磕碰或气道受压，伤情加重". The turn's other receipt is an `npc`
 * effect whose `skill` is `null` and whose `why` is a sentence of prose. No hit points, no
 * `delta`, no condition: a roll that happened, judged against a number, about a named person,
 * left nothing on that person. The same turn's investigator had hit points, sanity, a cash
 * ledger and item conditions.
 *
 * Three ends of §31, and the reason each one was empty:
 *
 *   writer -- `apply damage` resolved its subject through `actor()`, which searches the party and
 *             refuses everything else with `no investigator <name> at the table`. There was no
 *             verb that could put a number on anyone else, so the Keeper used the one field left,
 *             which was prose.
 *   reader -- the capsule's `present[]` carried a person's agenda, fears, voice and stance and had
 *             no field for the state of their body at all. For ten turns it described a man
 *             unconscious on a bed as "warm and friendly despite a tired appearance".
 *   actor  -- both the tool and the Keeper's prompt say `target` names the patient; `table.resolve`
 *             looked for it in the party alone, so First Aid on an NPC was settled on the rescuer
 *             and reported them as the patient.
 *
 * Everything below travels the real path: the product kernel's own handlers create a campaign,
 * hurt a person, read the capsule the Keeper is served, and settle a treatment. Nothing is
 * hand-built, and each assertion hangs on the structure -- a subject id, a receipt kind, a hit
 * point -- rather than on a sentence this same change is free to reword.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'rescue-rules-'));
after(() => rm(temporary, { recursive: true, force: true }));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({
	stdin: { contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: root, sourcefile: 'rescue-api.ts' },
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node',
	target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

/** A book NPC the source gives no numbers -- the shape Larkin was, and the shape most minor NPCs are. */
const BYSTANDER = 'Arty Wilmot';

/** One real campaign on the product kernel, opened and past its first delivery. */
async function table(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({
		workspace: home, content: join(root, 'content'), seed: 'rescue-reaches-the-rules',
		locks: api.createAdvisoryLocks(async () => {}),
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
	});
	const runtime = api.createKernelRuntime(context);
	t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({ campaign: 'c1', ...params });
	await call('campaign.create', { id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en' });
	await call('table.open');
	const party = join(home, '.coc/campaigns/c1/party');
	const file = join(party, (await readdir(party)).find((name) => name.endsWith('.json')));
	const sheet = JSON.parse(await readFile(file, 'utf8'));
	await call('table.narrate', { call_id: 't0-c1', text: 'The door closes behind you.' });
	let turn = 0, ordinal = 0;
	const game = {
		call, sheet, home,
		next: () => `t${turn}-c${++ordinal}`,
		investigator: async () => JSON.parse(await readFile(file, 'utf8')),
		world: async () => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8')),
		// `table.apply` answers with receipt ids; the receipts themselves are the turn's ledger.
		receipts: async () => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/turn.json'), 'utf8')).receipts,
		apply: (effect) => call('table.apply', { call_id: game.next(), effects: [effect] }),
		async say(text) { await call('table.player_input', { text }); turn += 1; ordinal = 0; },
		/**
		 * Zero hit points and no major wound, which is plain `unconscious` rather than `dying`:
		 * every blow is kept under half of maximum (rounded up), and `D1` dice keep it arithmetic
		 * rather than a seeded roll.
		 */
		async fell(subject, maximum, from) {
			const under = Math.floor((maximum + 1) / 2) - 1;
			let hp = from;
			const minted = [];
			while (hp > 0) {
				const damage = Math.min(hp, under);
				const result = await game.apply({ kind: 'damage', subject, dice: `${damage}D1`, why: 'the stairs' });
				minted.push(...result.receipts);
				hp -= damage;
			}
			const ledger = await game.receipts();
			return ledger.filter((row) => minted.includes(row.id));
		},
	};
	turn = 1;
	await game.say('I look around the room.');
	turn = 1;
	return game;
}

/** Give a book NPC the numbers the book never printed, the one way the product has (§34.10). */
async function pin(game) {
	await game.apply({ kind: 'npc', name: BYSTANDER, to: 'here', why: 'he is in the room' });
	const result = await game.apply({ kind: 'npc', name: BYSTANDER, archetype: 'ordinary_adult', why: 'an ordinary man' });
	const receipt = (await game.receipts()).find((row) => result.receipts.includes(row.id) && row.profile);
	assert.ok(receipt, 'the archetype pin minted a profile');
	return { handle: receipt.handle, maximum: receipt.profile.derived.HP };
}

test('a person the book gave no numbers is refused by naming the verb that gives them some', async (t) => {
	const game = await table(t);
	await game.apply({ kind: 'npc', name: BYSTANDER, to: 'here', why: 'he is in the room' });
	const error = await game.apply({ kind: 'damage', subject: BYSTANDER, dice: '1D1', why: 'the stairs' })
		.then(() => null, (thrown) => thrown);
	assert.ok(error, 'damage to a person with no hit points is refused');
	// Structural: the refusal names the field whose absence stops it, so the Keeper's next call is
	// the one that fixes it. Not the sentence -- the machine-readable need.
	assert.equal(error.details?.needs?.field, 'npc.archetype');
	assert.equal(error.details?.subject, 'arty-wilmot', 'and it names whom it could not settle for');
});

test('harm to someone who is not at the table lands on that person, in receipts and in the world', async (t) => {
	const game = await table(t);
	const { handle, maximum } = await pin(game);
	const before = await game.investigator();

	const receipts = await game.fell(BYSTANDER, maximum, maximum);

	const deltas = receipts.filter((row) => row.kind === 'delta' && row.resource === 'hp');
	assert.ok(deltas.length, 'the hit points moved and said so');
	// Every one of them is about him. Before §66 there were none, because the call was refused.
	assert.deepEqual([...new Set(deltas.map((row) => row.subject))], [handle]);
	assert.deepEqual([...new Set(deltas.map((row) => row.subject_is_investigator))], [false]);
	assert.equal(deltas.at(-1).after, 0);

	const condition = receipts.filter((row) => row.kind === 'condition');
	assert.equal(condition.length, 1, 'the state change minted exactly one condition receipt');
	assert.equal(condition[0].subject, handle);
	// The rules layer's own answer rides the receipt (§42.2); the reader never re-derives it.
	assert.deepEqual(condition[0].gained, ['unconscious']);
	assert.deepEqual(condition[0].incapacitated, ['unconscious']);

	const world = await game.world();
	assert.equal(world.npc_resources[handle].current_hp, 0, 'his body is kept where an NPC body is kept');
	assert.deepEqual(world.npc_resources[handle].conditions, ['unconscious']);

	// The person who was not hurt is untouched: a mis-aimed subject would show here.
	assert.deepEqual(await game.investigator().then((sheet) => [sheet.current_hp, sheet.conditions ?? []]),
		[before.current_hp, before.conditions ?? []]);
});

test('the capsule tells the Keeper that someone in the room cannot act', async (t) => {
	const game = await table(t);
	const { handle, maximum } = await pin(game);

	const before = await game.call('table.capsule');
	const standing = before.present.find((row) => row.name === BYSTANDER);
	assert.ok(standing, 'he is in the room');
	assert.ok(!('state' in standing), 'a person who can act carries no state, so a reader tests the key');

	await game.fell(BYSTANDER, maximum, maximum);

	const after = await game.call('table.capsule');
	const down = after.present.find((row) => row.name === BYSTANDER);
	assert.ok(down?.state, 'the state of his body reaches the Keeper');
	assert.deepEqual(down.state.incapacitated, ['unconscious']);
	assert.equal(typeof down.state.cannot_act, 'string');
	assert.ok(down.state.cannot_act.includes(BYSTANDER), 'the sentence names him');

	// The same answer on the other surface the Keeper has for one person.
	const looked = await game.call('table.look', { focus: 'npc', name: BYSTANDER });
	assert.deepEqual(looked.state?.incapacitated, ['unconscious']);
});

test('First Aid is settled on the patient named in target, whoever the patient is', async (t) => {
	const game = await table(t);
	const { handle, maximum } = await pin(game);
	await game.fell(BYSTANDER, maximum, maximum);
	const rescuer = await game.investigator();

	const result = await game.call('table.resolve', {
		call_id: game.next(),
		action: { intent: 'investigate', actor: rescuer.name, target: BYSTANDER, skill: 'First Aid',
			goal: 'bring him round', method: 'clear the airway and work on him', stakes: 'he stops breathing' },
	});

	// Whatever the dice said, the settlement is about him: the kernel reports the patient it used.
	assert.equal(result.outcome?.patient ?? result.outcome?.subject, handle,
		'the patient of the settlement is the person named in target');

	const world = await game.world();
	const after = await game.investigator();
	// The rescuer was at full hit points and is not the patient: before §66 this check healed her
	// for +0 and filed her as the patient, and nothing in the receipt said the patient was wrong.
	assert.equal(after.current_hp, rescuer.current_hp, 'the rescuer is not the one being treated');
	assert.deepEqual(after.conditions ?? [], rescuer.conditions ?? []);
	// A successful First Aid grants one hit point and any hit point regained ends `unconscious`
	// (§42.5); a failure leaves both. Either way the account that moved is his.
	const hp = world.npc_resources[handle].current_hp, conditions = world.npc_resources[handle].conditions;
	assert.ok([0, 1].includes(hp), `his hit points are 0 or 1, not ${hp}`);
	assert.equal(conditions.includes('unconscious'), hp === 0,
		'he is unconscious exactly while he has no hit points');
});

test('First Aid on an investigator is still settled on that investigator', async (t) => {
	const game = await table(t);
	const { handle } = await pin(game);
	const sheet = await game.investigator();
	await game.fell(sheet.name, sheet.derived.HP, sheet.current_hp);
	const felled = await game.investigator();
	assert.equal(felled.current_hp, 0);
	assert.ok((felled.conditions ?? []).includes('unconscious'), 'the party path still assigns the state');

	// The rescuer is the NPC now, so the two roles are the reverse of the previous test and the
	// patient is the party member. `apply npc {skill}` is the existing way to give a rescuer a value.
	await game.apply({ kind: 'npc', name: BYSTANDER, skill: { name: 'First Aid', value: 60 }, why: 'he has done this before' });
	const result = await game.call('table.resolve', {
		call_id: game.next(),
		action: { intent: 'investigate', actor: BYSTANDER, target: sheet.name, skill: 'First Aid',
			goal: 'bring her round', method: 'clear the airway and work on her', stakes: 'she stops breathing' },
	});
	assert.equal(result.outcome?.patient ?? result.outcome?.subject, sheet.id,
		'the patient of the settlement is the investigator named in target');

	const treated = await game.investigator();
	assert.ok([0, 1].includes(treated.current_hp));
	assert.equal((treated.conditions ?? []).includes('unconscious'), treated.current_hp === 0);
	// And nothing of it landed on the NPC who did the treating.
	const world = await game.world();
	assert.ok(!(world.npc_resources?.[handle]?.conditions ?? []).length, 'the rescuer took none of it');
});
