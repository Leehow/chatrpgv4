/**
 * A state that takes the action away is a clock the Keeper is told to drive (contract §NN).
 *
 * The retained table is `t9` (The Haunting, `H-MAIN-2`), turns 46-54. The investigator failed a
 * Climb, fell into the cellar, took 6 of his 8 hit points, fumbled the major-wound CON roll and went
 * down: `major_wound`, `prone`, `unconscious`, HP 2/8. Every part of that was settled correctly and
 * every part of it was shown -- the damage card, the HP, the state card, the `condition` receipt,
 * and an out-of-fiction line above the input box on every turn after (§42.6). Then the campaign
 * stopped. The clock ran from 1966 to 3776 -- 1810 minutes, thirty hours and ten -- across seven
 * turns with zero `condition` receipts, and the Keeper said in as many words: "I will not have
 * anyone touch the same wound again", and "I will not move the clock forward for you."
 *
 * §42.5 recorded that as BUG-076: the exits existed and nothing at the table was obliged to drive
 * one. The refusal of §42.4 only fires when the Keeper tries to settle something, so a Keeper who
 * settles nothing is never prompted; the §42.6 notice goes to the player, who by definition cannot
 * act; and `apply time` is a verb only the Keeper has. Underneath it, two things the Keeper was
 * never told: no rule-graph decision reads `actor.conditions.unconscious`, so the body produced no
 * situation and therefore no pressure row at all; and the capsule's own sentence promised that rest
 * returns a hit point, which for a character with a major wound ticked returns nothing whatever.
 *
 * Everything below travels the real path -- the product kernel's handlers, a real campaign, the
 * capsule the Keeper is actually served. Nothing is hand-built.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'unconscious-'));
after(() => rm(temporary, { recursive: true, force: true }));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({
	stdin: { contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: root, sourcefile: 'unconscious-api.ts' },
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node',
	target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

/**
 * One real campaign driven into t9's state.
 *
 * `fall-2` is the seed whose major-wound CON roll fails, which is what makes this the t9 case and
 * not the §42 one: a single blow of `HP_max - 2` is over half of maximum, so the wound is major and
 * the character is left above zero -- `unconscious` without `dying`, the state with no clock. The
 * assertion on the condition list below is what holds the seed honest: change the roll stream and
 * this fails loudly here rather than passing somewhere harmless.
 */
async function fallen(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({
		workspace: home, content: join(root, 'content'), seed: 'fall-2',
		locks: api.createAdvisoryLocks(async () => {}),
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
	});
	const runtime = api.createKernelRuntime(context);
	t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({ campaign: 'c1', ...params });
	await call('campaign.create', { id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans' });
	await call('table.open');
	const party = join(home, '.coc/campaigns/c1/party');
	const file = join(party, (await readdir(party)).find((name) => name.endsWith('.json')));
	const sheet = JSON.parse(await readFile(file, 'utf8'));
	let turn = 1, ordinal = 0;
	const game = {
		call, sheet,
		read: async () => JSON.parse(await readFile(file, 'utf8')),
		next: () => `t${turn}-c${++ordinal}`,
		async say(text) { await call('table.player_input', { text }); turn += 1; ordinal = 0; },
		/** Close the turn the way the Keeper does, so the next player line is allowed. */
		async close(text) { await call('table.narrate', { call_id: game.next(), text }); },
		/** The clock for `unconscious`, as the Keeper is served it. */
		async clock() {
			const capsule = await call('table.capsule');
			return (capsule.pressures ?? []).find((pressure) => String(pressure.name ?? '').startsWith('unconscious'));
		},
	};
	await call('table.narrate', { call_id: 't0-c1', text: '门在你身后合上。' });
	await game.say('我逐级往地窖下踩。');
	await call('table.apply', {
		call_id: game.next(),
		effects: [{ kind: 'damage', subject: sheet.id, dice: `${sheet.derived.HP - 2}D1`, why: '踏板断裂，他摔了下去' }],
	});
	await game.close('踏板在他脚下断了。');
	const body = await game.read();
	assert.deepEqual(body.conditions, ['major_wound', 'prone', 'unconscious'], 'the fall reproduces t9: a major wound, prone, and a failed CON roll');
	assert.equal(body.current_hp, 2, 'and above zero, so this is unconscious without dying -- the state with no clock of its own');
	return game;
}

test('the body that cannot act is a clock in the capsule, with the minutes and the call on the line', async (t) => {
	const game = await fallen(t);
	await game.say('（我昏着，动不了。）');

	const clock = await game.clock();
	assert.ok(clock, 'an unconscious investigator puts a row in pressures[]; t9 had none for thirty hours');
	assert.equal(clock.kind, 'clock');
	assert.match(clock.state, /HP 2\/12/, 'the row says what his body is at');
	assert.match(clock.state, /major wound/, 'and that the major wound is what closes the ordinary route');
	// The due side. The whole of t9's deadlock was that nobody could name what the rules would do
	// next by themselves, so nobody moved the clock at all.
	assert.match(clock.due, /weekly recovery roll/, `the row names the next thing the rules run themselves: ${clock.due}`);
	assert.match(clock.due, /no hit point returns while the major wound is ticked/, 'and says plainly that rest is not an exit here');
	assert.match(clock.due, /\d+ min/, 'with the minutes to it, not a vague "eventually"');
	// The next side: what it costs and what it produces, on the same line. A clock the Keeper has to
	// turn into a call himself is a clock the Keeper does not use.
	assert.match(clock.next, /apply time \{minutes: \d+\}/, `the row carries the exact call: ${clock.next}`);
	assert.match(clock.next, /healing:weekly-major-wound-recovery/, 'and the settlement at the end of it');
	// And the exits that need somebody else, named as decisions rather than as skill names.
	assert.match(clock.cue, /healing:medicine-ordinary/, `the sooner exit is a decision ref, not a skill to look up: ${clock.cue}`);

	// Thirty in-game hours, which is what t9 actually played, and the row is still there and still
	// arithmetically true. A notice that appears once is the defect §42.6 was written for.
	await game.call('table.apply', { call_id: game.next(), effects: [{ kind: 'time', minutes: 1810, why: '夜里，人一直没醒' }] });
	await game.close('天亮了，他还是那个样子。');
	assert.deepEqual((await game.read()).conditions, ['major_wound', 'unconscious'], 'thirty hours of rest clears nothing, because a major wound returns no hit point');
	const later = await game.clock();
	assert.ok(later, 'and the row is still standing thirty hours on');
	const [before] = clock.due.match(/(\d+) min/), [now] = later.due.match(/(\d+) min/);
	assert.ok(Number(now.split(' ')[0]) < Number(before.split(' ')[0]), `the clock moved with the world clock: ${before} -> ${now}`);
});

test('the capsule and the refusal stop promising a hit point that rest does not return', async (t) => {
	const game = await fallen(t);
	await game.say('（我昏着。）');

	const capsule = await game.call('table.capsule');
	const sentence = capsule.known.investigator.cannot_act;
	assert.match(sentence, /unconscious/, 'the Keeper is still told the state (§42.3)');
	assert.match(sentence, /First Aid or Medicine/, 'and still told the exits that need somebody present');
	// The sentence used to end "including the one a day of rest returns" for every character alive.
	// t9's Keeper read it, applied six hours, got nothing back, and stopped moving the clock.
	assert.doesNotMatch(sentence, /a day of rest returns/, `rest returns no hit point to a major-wounded body: ${sentence}`);
	assert.match(sentence, /not rest/, 'and the sentence says so rather than staying silent about it');

	const refusal = await game.call('table.resolve', {
		call_id: game.next(),
		action: { intent: 'investigate', goal: '看看地窖那面墙', method: '爬起来走过去', skill: 'Spot Hidden' },
	}).then((ok) => assert.fail(`an unconscious investigator settled an action: ${JSON.stringify(ok).slice(0, 200)}`), (error) => error);
	assert.equal(refusal.details.reason, 'actor_incapacitated');
	assert.doesNotMatch(refusal.fix, /apply time -- until natural healing returns one/, 'the fix is read literally, so it no longer names a route the engine has closed');
	assert.match(refusal.fix, /pressures\[\]/, 'and it points at the row that carries the call');
	assert.doesNotMatch(refusal.fix, /resend|try again/i, 'nothing here invites a retry');
	assert.doesNotMatch(refusal.fix, /declare .* over|end the state yourself/i, 'and nothing here lets the Keeper declare the state over');
});

test('following the row reaches the exit, and the exit leaves a receipt', async (t) => {
	const game = await fallen(t);
	await game.say('（我昏着。）');

	// The Keeper does what the row says. `apply time` of the named minutes runs the weekly
	// major-wound recovery roll inside the healing time trigger; a success returns hit points, and a
	// hit point is what CoC 7e rouses on. The roll can fail, which is the rules working, so this
	// drives the clock the way a Keeper would rather than demanding the first week land.
	let roused = null;
	for (let week = 0; week < 6 && !roused; week += 1) {
		const clock = await game.clock();
		assert.ok(clock, 'the row is there every turn until the state lifts');
		const minutes = Number((clock.next.match(/minutes: (\d+)/) ?? [, '10080'])[1]);
		const applied = await game.call('table.apply', { call_id: game.next(), effects: [{ kind: 'time', minutes, why: '他躺着，week ' + week }] });
		if (applied.receipts.some((id) => id.startsWith('condition:'))) roused = applied;
		await game.close('一周过去了。');
		if (!roused) await game.say('（我还是昏着。）');
	}
	assert.ok(roused, 'driving the clock the row names reaches the exit; before §NN nothing named it at all');
	const sheet = await game.read();
	assert.ok(!sheet.conditions.includes('unconscious'), `the state lifted: ${JSON.stringify(sheet.conditions)}`);
	assert.ok(sheet.current_hp > 2, 'and it lifted because a hit point came back, not because time passed');

	await game.say('我撑着地坐起来，去看那面钉死的木板。');
	const settled = await game.call('table.resolve', {
		call_id: game.next(),
		action: { intent: 'investigate', goal: '看那面钉死的木板', method: '走过去细看', skill: 'Spot Hidden' },
	});
	assert.ok(settled.outcome || settled.receipts?.length, 'and the action the state forbade is settled once the state is gone');
});

/**
 * The other half of the branch, and the case §42 already had: zero hit points with no major wound.
 * Here rest really is an exit, so the row says so and names the six hours the healing time trigger
 * needs -- the same arithmetic, the other answer. A row that gave every body the weekly roll would
 * be as wrong as the sentence that gave every body the daily hit point.
 */
test('without a major wound the row names rest, because for that body rest is the exit', async (t) => {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({
		workspace: home, content: join(root, 'content'), seed: 'felled',
		locks: api.createAdvisoryLocks(async () => {}),
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
	});
	const runtime = api.createKernelRuntime(context);
	t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({ campaign: 'c1', ...params });
	await call('campaign.create', { id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans' });
	await call('table.open');
	const party = join(home, '.coc/campaigns/c1/party');
	const file = join(party, (await readdir(party)).find((name) => name.endsWith('.json')));
	const sheet = JSON.parse(await readFile(file, 'utf8'));
	await call('table.narrate', { call_id: 't0-c1', text: '门在你身后合上。' });
	await call('table.player_input', { text: '我反击。' });
	// Every blow under half of maximum, so no wound is major: zero hit points without `major_wound`
	// is `unconscious`, not `dying`.
	const under = Math.floor((sheet.derived.HP + 1) / 2) - 1;
	let hp = sheet.current_hp, ordinal = 0;
	while (hp > 0) {
		const damage = Math.min(hp, under);
		await call('table.apply', { call_id: `t1-c${++ordinal}`, effects: [{ kind: 'damage', subject: sheet.id, dice: `${damage}D1`, why: 'the claws' }] });
		hp -= damage;
	}
	await call('table.narrate', { call_id: `t1-c${++ordinal}`, text: '爪子落下。' });
	assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).conditions, ['unconscious'], '0 HP with no major wound is unconscious alone');

	await call('table.player_input', { text: '（我昏着。）' });
	const capsule = await call('table.capsule');
	const clock = capsule.pressures.find((pressure) => String(pressure.name ?? '').startsWith('unconscious'));
	assert.ok(clock, 'the row is there for this body too');
	assert.doesNotMatch(clock.state, /major wound/);
	assert.match(clock.due, /natural healing returns one hit point/, `rest is the exit here, and the row says so: ${clock.due}`);
	assert.match(clock.next, /apply time \{minutes: 360\}/, `and names the six hours the time trigger needs: ${clock.next}`);
	assert.doesNotMatch(clock.next, /weekly/, 'the weekly roll is not this body\'s next step');
	assert.doesNotMatch(capsule.known.investigator.cannot_act, /not rest/, 'and the sentence still offers rest, because here it is true');
});
