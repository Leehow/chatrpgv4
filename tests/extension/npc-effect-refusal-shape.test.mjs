/**
 * §11.5.7 addendum (SL-73, gate #12): `apply npc`'s `unknown_entity` on a name the graph is silent on
 * says "pick a name from details.candidates or look first" even when `details.candidates` is empty --
 * advice with nothing to act on. Retained live evidence: `apply npc name:"托马斯·海斯" skill:{...}`
 * (the investigator's own Chinese name, mistaken for an npc) answered exactly that, `candidates: []`,
 * and the Keeper had no way to tell it had named the investigator rather than an unknown person.
 *
 * Everything below travels the real path: the product kernel's own handlers create a campaign and
 * settle `table.apply` on an `npc` effect. Nothing is hand-built.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'npc-refusal-shape-'));
after(() => rm(temporary, { recursive: true, force: true }));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({
	stdin: { contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: root, sourcefile: 'npc-refusal-api.ts' },
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node',
	target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

/** One real campaign on the product kernel, opened and past its first delivery. */
async function table(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({
		workspace: home, content: join(root, 'content'), seed: 'npc-effect-refusal-shape',
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
		call,
		next: () => `t${turn}-c${++ordinal}`,
		investigator: async () => JSON.parse(await readFile(file, 'utf8')),
		apply: (effect) => call('table.apply', { call_id: game.next(), effects: [effect] }),
		async say(text) { await call('table.player_input', { text }); turn += 1; ordinal = 0; },
	};
	turn = 1;
	await call('table.narrate', { call_id: 't0-c1', text: 'The door closes behind you.' });
	await game.say('I look around the room.');
	turn = 1;
	return game;
}

/**
 * `apply npc {name, skill}` never mints: a skill pin on a name the graph does not know is refused
 * (`kernel-ts/apply/entities.ts`'s `personOfEffect`), and this is the shape the refusal takes when the
 * name is the investigator's own -- gate #12's t19.
 */
test("apply npc's skill pin on the investigator's own name says so, not \"pick from an empty list\"", async (t) => {
	const game = await table(t);
	const investigator = await game.investigator();
	const error = await game.apply({ kind: 'npc', name: investigator.name, skill: { name: 'STR', value: 60 }, why: 'probe' })
		.then(() => null, (thrown) => thrown);
	assert.ok(error, 'the investigator is not a person apply npc can pin a skill onto');
	assert.equal(error.code, 'unknown_entity');
	assert.equal(error.details?.is_investigator, true);
	assert.equal(error.details?.candidates, undefined, 'no empty candidates key when there is nothing to list');
	assert.match(error.fix, new RegExp(investigator.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

/**
 * The same shape for a name that matches something else the graph already knows -- a scene, here --
 * rather than a person: the refusal names the kind instead of repeating "pick from details.candidates".
 */
test("apply npc's skill pin on a scene's own name says what it actually is", async (t) => {
	const game = await table(t);
	const error = await game.apply({ kind: 'npc', name: 'central-library', skill: { name: 'STR', value: 60 }, why: 'probe' })
		.then(() => null, (thrown) => thrown);
	assert.ok(error, 'a scene is not a person apply npc can pin a skill onto');
	assert.equal(error.code, 'unknown_entity');
	assert.equal(error.details?.matched_kind, 'scene');
	assert.equal(error.details?.is_investigator, undefined);
	assert.equal(error.details?.candidates, undefined);
});

/**
 * A name the graph and the roster are both genuinely silent on: still `unknown_entity`, still no
 * `is_investigator` or `matched_kind`, and still no `candidates` key with nothing in it -- the fix
 * points at establishing the person or looking first, the two lawful next steps, instead of a list.
 */
test("apply npc's skill pin on a name nobody knows still refuses, with a real next step and no empty candidates key", async (t) => {
	const game = await table(t);
	const error = await game.apply({ kind: 'npc', name: 'totally invented nonsense xyzzy 12345', skill: { name: 'STR', value: 60 }, why: 'probe' })
		.then(() => null, (thrown) => thrown);
	assert.ok(error);
	assert.equal(error.code, 'unknown_entity');
	assert.equal(error.details?.is_investigator, undefined);
	assert.equal(error.details?.matched_kind, undefined);
	assert.equal(error.details?.candidates, undefined);
	assert.match(error.fix, /establish|look npc/);
});

/**
 * Unaffected: a name with real similar candidates still gets them, exactly as before this ticket.
 */
test('apply npc keeps its ordinary candidates list when the name has real similar matches', async (t) => {
	const game = await table(t);
	await game.apply({ kind: 'npc', name: 'Fabius Okonkwo', to: 'here', walk_on: true, why: 'a face at the table' });
	const error = await game.apply({ kind: 'npc', name: 'Fabius Okonko', skill: { name: 'STR', value: 60 }, why: 'probe' })
		.then(() => null, (thrown) => thrown);
	assert.ok(error);
	assert.equal(error.code, 'unknown_entity');
	assert.ok(Array.isArray(error.details?.candidates) && error.details.candidates.length > 0, 'a real near-match still lists candidates');
	assert.equal(error.details?.is_investigator, undefined);
	assert.equal(error.details?.matched_kind, undefined);
});
