/**
 * A condition that changes what the investigator can do reaches the player, blocks the action, and
 * has a way out (contract §42).
 *
 * The retained turns are 107-111 of `game-83177d61` (The Haunting, zh-Hans). Walter Corbitt's claws
 * took the investigator's last 6 hit points and the kernel settled it exactly right -- 0 HP with no
 * major wound is `unconscious`, not `dying`, and the receipt says so. Not one word of it reached the
 * player. The mechanics card had no case for a `condition` row, so it drew the row's own kind and
 * nothing else; the capsule's `known.investigator` carried `hp: 0` and no conditions at all, so the
 * Keeper was never told either. For the next two turns the player declared things an unconscious man
 * cannot do -- holding on to consciousness, driving a dagger up into a chest -- and the Keeper wrote
 * around each one with the same halted tableau. From the player's chair that is a table going in
 * circles. He had been out of the fight for three turns and did not know.
 *
 * Then the other half: told out of band, he played to the state and let time pass, the Keeper
 * narrated him waking, and no `condition` receipt exists in any later turn. The engine still holds
 * `unconscious` in `party/investigator.json` today. The fiction recovered and the engine did not.
 *
 * Everything below travels the real path: the product kernel's own handlers create a campaign, drive
 * an investigator to zero, and the projection the player is actually served is the one asserted --
 * `table.narrate`'s `mechanics` (§16.2), drawn through `pipicoc/mechanics.js` with the captions this
 * build ships. Nothing is hand-built.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createComponent } from '../../pipicoc/mechanics.js';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'incapacitating-'));
after(() => rm(temporary, { recursive: true, force: true }));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({
	stdin: { contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: root, sourcefile: 'conditions-api.ts' },
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node',
	target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

/** The play-language chrome the host attaches to every delivery (§23), read from what ships. */
const MECHANICS_WORDS = JSON.parse(await readFile(join(root, 'content/ui/zh-Hans/mechanics.json'), 'utf8'));
const ui = { tag: 'zh-Hans', words: { mechanics: MECHANICS_WORDS } };

/**
 * The delivery card rendered without a DOM.
 *
 * `pipicoc/mechanics.js` takes React by injection and a condition row reaches for nothing but
 * `createElement`, so the element tree can be built with a stand-in and read as text. The point is
 * that this is the shipped renderer and the shipped captions: a test that spelled either out itself
 * would pass while the player's card said something else.
 */
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
const Card = createComponent(React);
function drawn(node) {
	if (node === null || node === undefined || node === false) return '';
	if (Array.isArray(node)) return node.map(drawn).join('');
	if (typeof node === 'object') return [...(node.children ?? []), ...(node.props?.children ? [node.props.children] : [])].map(drawn).join('');
	return String(node);
}
const cardText = (details) => drawn(Card({ details: { ui, ...details } }));

/** One real campaign on the product kernel, opened and past its first delivery. */
async function table(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({
		workspace: home, content: join(root, 'content'), seed: 'incapacitating',
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
	let turn = 1, ordinal = 0;
	return {
		call, sheet,
		read: async () => JSON.parse(await readFile(file, 'utf8')),
		next: () => `t${turn}-c${++ordinal}`,
		async say(text) { await call('table.player_input', { text }); turn += 1; ordinal = 0; },
		/**
		 * Zero hit points without a major wound, which is the case the retained turn settled: a
		 * major wound would make it `dying` instead. Every blow is kept under half of maximum HP
		 * (rounded up), so the last one lands on a character already low rather than felling a
		 * whole one, and `D1` dice keep it arithmetic rather than a seeded roll.
		 */
		async fell() {
			const maximum = sheet.derived.HP, under = Math.floor((maximum + 1) / 2) - 1;
			let hp = sheet.current_hp;
			while (hp > 0) {
				const damage = Math.min(hp, under);
				await call('table.apply', { call_id: this.next(), effects: [{ kind: 'damage', subject: sheet.id, dice: `${damage}D1`, why: 'the claws' }] });
				hp -= damage;
			}
		},
	};
}

/** The action the player declared on turn 109, in the shape the Keeper sends it. */
const ATTACK = { intent: 'combat', goal: 'drive the dagger home', method: 'his own dagger', skill: 'Fighting (Brawl)' };
/** An ordinary check with nobody else in it, so the only thing that can decide it is the state. */
const LOOK = { intent: 'investigate', goal: 'see how deep the shoulder is cut', method: 'look down at it', skill: 'Spot Hidden' };

test('a condition that takes the action away reaches the player as the state it is', async (t) => {
	const game = await table(t);
	await game.say('我反击，刃不撒手。');
	await game.fell();
	const delivery = await game.call('table.narrate', { call_id: game.next(), text: '爪子落下。' });

	const rows = delivery.mechanics.filter((row) => row.kind === 'condition');
	assert.equal(rows.length, 1, 'the settlement projected exactly one condition row');
	const [row] = rows;
	assert.deepEqual(row.gained, ['unconscious'], '0 HP with no major wound is unconscious, not dying');
	assert.deepEqual(row.standing, ['unconscious'], 'the row carries the state now standing, not only the change');
	assert.deepEqual(row.incapacitated, ['unconscious'], 'and which of those the rules say takes the action away');
	assert.equal(row.subject_is_investigator, true);

	// The card the player is served. Before this repair the row fell through to the renderer's
	// `default` branch and drew its own kind -- `身体状态` and nothing else.
	const card = cardText(delivery);
	assert.ok(card.includes(MECHANICS_WORDS['condition.unconscious']), `the card names the state:\n${card}`);
	assert.ok(card.includes(MECHANICS_WORDS.cannotAct), `and says it takes the action away:\n${card}`);
	assert.ok(card.includes(row.subject_label), `and whose body it is:\n${card}`);
	// The bare kind is what the row drew before: a caption and nothing else.
	assert.notEqual(card.trim(), MECHANICS_WORDS['kind.condition']);

	// The Keeper's half of the same seam (§31): the capsule showed `hp: 0` and no conditions.
	await game.say('我拼最后一口气不昏过去。');
	const capsule = await game.call('table.capsule');
	assert.deepEqual(capsule.known.investigator.conditions, ['unconscious']);
	assert.match(capsule.known.investigator.cannot_act, /unconscious/);
	assert.match(capsule.known.investigator.cannot_act, /First Aid|Medicine/);
});

test('an action the state forbids is refused by naming the state, and the rules keep their own clocks', async (t) => {
	const game = await table(t);
	await game.say('我反击。');
	await game.fell();
	await game.call('table.narrate', { call_id: game.next(), text: '爪子落下。' });
	await game.say('把他自己的刀从底下顶进心口。');

	const refusal = await game.call('table.resolve', { call_id: game.next(), action: ATTACK }).then(
		(result) => assert.fail(`an unconscious investigator settled an attack: ${JSON.stringify(result).slice(0, 200)}`),
		(error) => error);
	assert.equal(refusal.code, 'needs');
	assert.equal(refusal.next, 'narrate', 'the Keeper puts the state in front of the player rather than resending');
	assert.match(refusal.message, /unconscious/, 'the refusal names the state, which is the whole point');
	assert.equal(refusal.details.reason, 'actor_incapacitated');
	assert.deepEqual(refusal.details.incapacitated, ['unconscious']);
	assert.equal(refusal.details.hp, 0);
	assert.match(refusal.fix, /First Aid/, 'and the fix names the ways out the rules have');
	assert.doesNotMatch(refusal.fix, /resend|try again/i, 'a fix is read literally: nothing here invites a retry');

	// The clocks that can take the condition off again are not the character acting, so they are not
	// refused -- a gate that stopped them would lock the state it exists to report.
	const clock = await game.call('table.resolve', {
		call_id: game.next(),
		action: { intent: 'combat', decision: 'healing:dying-round-clock', actor: game.sheet.id, goal: 'the clock', method: 'CON' },
	}).catch((error) => error);
	assert.notEqual(clock?.details?.reason, 'actor_incapacitated', `the rules' own clock was refused as a voluntary action: ${clock?.message}`);
});

test('the state clears by the route the rules give it, and does not clear without it', async (t) => {
	const game = await table(t);
	await game.say('我反击。');
	await game.fell();
	await game.call('table.narrate', { call_id: game.next(), text: '爪子落下。' });
	await game.say('（我人昏着，动不了。）时间过去。');

	// Turn 110's forty minutes. CoC 7e rouses an unconscious character when a hit point comes back
	// -- the First Aid and Medicine descriptions in `content/rulesets/coc7/rules-json` say so in as
	// many words -- and forty minutes returns none. The Keeper narrated him waking anyway.
	for (const [minutes, why] of [[40, 'lying there'], [120, 'and the hours after']]) {
		const short = await game.call('table.apply', { call_id: game.next(), effects: [{ kind: 'time', minutes, why }] });
		assert.ok(!short.receipts.some((id) => id.startsWith('condition:')), `${minutes} minutes heals nothing, so it clears nothing`);
		assert.deepEqual((await game.read()).conditions, ['unconscious'], `still unconscious after ${minutes} minutes`);
		assert.equal((await game.read()).current_hp, 0, `and still at zero after ${minutes} minutes`);
	}
	const still = await game.call('table.resolve', { call_id: game.next(), action: ATTACK }).catch((error) => error);
	assert.equal(still.details?.reason, 'actor_incapacitated', 'and the state still forbids the action');

	// Rest long enough for the natural hit point, which is the one exit an investigator alone on the
	// floor can take. It always cleared the condition on the sheet; it left no receipt, so the table
	// had no record that it had, and by §"narrated without a receipt did not happen" it had not.
	const night = await game.call('table.apply', { call_id: game.next(), effects: [{ kind: 'time', minutes: 600, why: 'the night' }] });
	const minted = night.receipts.filter((id) => id.startsWith('condition:'));
	assert.equal(minted.length, 1, `rest that clears a condition leaves a receipt: ${night.receipts.join(', ')}`);
	const sheet = await game.read();
	assert.deepEqual(sheet.conditions, []);
	assert.ok(sheet.current_hp >= 1, 'and it cleared because a hit point came back, not because time passed');

	const delivery = await game.call('table.narrate', { call_id: game.next(), text: '眼皮终于抬得动。' });
	const [row] = delivery.mechanics.filter((value) => value.kind === 'condition');
	assert.deepEqual(row.lost, ['unconscious']);
	assert.deepEqual(row.incapacitated, [], 'nothing takes the action away any more');
	assert.ok(cardText(delivery).includes(MECHANICS_WORDS['condition.unconscious']), 'and the player reads that it lifted');

	await game.say('我撑着土坐起来。');
	const settled = await game.call('table.resolve', { call_id: game.next(), action: LOOK });
	assert.ok(settled.outcome || settled.receipts?.length, 'the same action the state forbade is settled once the state is gone');
});
