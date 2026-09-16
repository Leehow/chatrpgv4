/**
 * A state that takes the action away stays in front of the player for as long as it stands (§41.6).
 *
 * The first half landed on 2026-09-16: a `condition` receipt reaches the player, the card draws the
 * state and a `cannot act` stamp, and `table.resolve` refuses an action the state forbids
 * (`tests/extension/incapacitating-conditions.test.mjs`). It made a *change* of state visible.
 *
 * The state itself stayed invisible. `game-83177d61` turn 107 minted
 * `condition:investigator-t107-c1` and that row rendered; turns 108 through 114 settled no condition
 * at all, so no card in that stretch said anything about it -- while
 * `save/healing-state/investigator.json` still reads `conditions: ["unconscious"]` today. What
 * finally reached the player, hours later, was the Keeper choosing to write 「人却动不了」 into the
 * fiction. That works and it is not guaranteed.
 *
 * Two of the three layers are here: the delivery carries `standing`, which the host says on its own
 * out-of-fiction channel (`standing-condition-notice.test.mjs`), and the character sheet draws the
 * conditions it has always been handed and never drew. The third, `table.resolve`'s refusal, is done.
 *
 * Nothing below is hand-built: the product kernel's own handlers create a campaign and drive an
 * investigator to zero hit points, and the sheet is drawn by `pipicoc/panel.js` with the captions
 * this build ships.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createComponent } from '../../pipicoc/panel.js';
import { resolveUiWords } from '../../runtime/ui-words.ts';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'standing-conditions-'));
after(() => rm(temporary, { recursive: true, force: true }));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({
	stdin: { contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: root, sourcefile: 'standing-api.ts' },
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node',
	target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

/** The captions this build ships for the table's language, exactly as a host attaches them (§23). */
const UI = await resolveUiWords({ contentRoot: join(root, 'content'), home: temporary, tag: 'zh-Hans' });
const MECHANICS = UI.words.mechanics;

/** One real campaign on the product kernel, opened and past its first delivery. */
async function table(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({
		workspace: home, content: join(root, 'content'), seed: 'standing',
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
	const game = {
		call, sheet, home,
		read: async () => JSON.parse(await readFile(file, 'utf8')),
		record: async (n) => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/turns', `${String(n).padStart(4, '0')}.json`), 'utf8')),
		next: () => `t${turn}-c${++ordinal}`,
		async say(text) { await call('table.player_input', { text }); turn += 1; ordinal = 0; },
		async hit(damage) {
			await call('table.apply', { call_id: game.next(), effects: [{ kind: 'damage', subject: sheet.id, dice: `${damage}D1`, why: 'the claws' }] });
		},
		/**
		 * Zero hit points without a major wound, which is the case turn 107 settled: every blow stays
		 * under half of maximum (rounded up), so `unconscious` is the only condition the rules put on
		 * the body, and `D1` dice keep the damage arithmetic rather than a seeded roll.
		 */
		async fell() {
			const under = Math.floor((sheet.derived.HP + 1) / 2) - 1;
			let hp = sheet.current_hp;
			while (hp > 0) { const damage = Math.min(hp, under); await game.hit(damage); hp -= damage; }
		},
		/**
		 * The same zero reached by one blow big enough to be a major wound, so the body ends up
		 * carrying four conditions: `major_wound` and `prone` from the blow, `unconscious` and `dying`
		 * from the zero. Two of the four take the action away and two do not, and no seeded roll
		 * decides it -- the CON check a new major wound rolls can only add `unconscious`, which the
		 * zero adds anyway.
		 */
		async maul() {
			const half = Math.floor((sheet.derived.HP + 1) / 2), under = half - 1;
			let hp = sheet.current_hp;
			while (hp > half) { const damage = Math.min(hp - half, under); await game.hit(damage); hp -= damage; }
			await game.hit(hp);
		},
	};
	return game;
}

test('a state that takes the action away rides every delivery that did not change it', async (t) => {
	const game = await table(t);
	await game.say('我反击，刃不撒手。');
	await game.fell();
	await game.call('table.narrate', { call_id: game.next(), text: '爪子落下。' });

	// The next turn settles nothing at all, which is exactly what turns 108 through 114 of
	// `game-83177d61` look like, and what left the player blind for three of them.
	await game.say('我还想爬起来。');
	const delivery = await game.call('table.narrate', { call_id: game.next(), text: '尘埃在光里落下。' });
	assert.deepEqual(delivery.mechanics.filter((row) => row.kind === 'condition'), [], 'the turn settled no condition');

	assert.deepEqual(delivery.standing, [{ investigator: game.sheet.id, name: game.sheet.name, conditions: ['unconscious'] }],
		`a delivery that changed nothing still says what stands:\n${JSON.stringify(delivery.mechanics)}`);
	// And it is not a mechanics row. The card is a record of what this turn settled; a state that did
	// not change settled nothing, and reprinting it on the slip every turn is how a card stops being read.
	assert.deepEqual(delivery.mechanics.filter((row) => row.kind === 'standing'), []);

	// It keeps saying it, and the record keeps what the player was told -- which is not a receipt and
	// so survives nowhere else.
	await game.say('我一动不动。');
	const later = await game.call('table.narrate', { call_id: game.next(), text: '水从屋顶滴下来。' });
	assert.equal(later.standing.length, 1, 'two turns on, and still said');
	assert.deepEqual((await game.read()).conditions, ['unconscious'], 'because the engine still holds it');
	assert.deepEqual((await game.record(later.turn)).standing, later.standing);
});

test('on the turn the state lands the delivery says it once, on the card, and not again beside it', async (t) => {
	const game = await table(t);
	await game.say('我反击，刃不撒手。');
	await game.fell();
	const delivery = await game.call('table.narrate', { call_id: game.next(), text: '爪子落下。' });

	assert.equal(delivery.mechanics.filter((row) => row.kind === 'condition').length, 1, 'the settlement projected one condition row');
	assert.equal(delivery.standing, undefined,
		'and nothing stands beside it: that row already names the state, the standing set and the stamp');
	assert.equal((await game.record(delivery.turn)).standing, undefined);
});

test('a state that only costs dice or position is not repeated; the ones that stop the character are', async (t) => {
	const game = await table(t);
	await game.say('我硬挨了一下。');
	await game.maul();
	await game.call('table.narrate', { call_id: game.next(), text: '爪子整个扫过来。' });
	const sheet = await game.read();
	for (const name of ['major_wound', 'prone', 'unconscious', 'dying'])
		assert.ok(sheet.conditions.includes(name), `the body carries ${name}: ${sheet.conditions.join(', ')}`);

	await game.say('我什么也做不了。');
	const delivery = await game.call('table.narrate', { call_id: game.next(), text: '血在土里散开。' });
	assert.deepEqual(delivery.standing[0].conditions, ['unconscious', 'dying'],
		'the rules engine drew that line once, and the delivery carries its answer rather than the whole list');
});

test('when the state clears the delivery stops saying it', async (t) => {
	const game = await table(t);
	await game.say('我反击。');
	await game.fell();
	await game.call('table.narrate', { call_id: game.next(), text: '爪子落下。' });
	await game.say('（我人昏着。）时间过去。');

	// Rest long enough for the natural hit point, which is what CoC 7e rouses an unconscious
	// character on. That mints a condition receipt, so the turn it lifts is the turn the card says it.
	await game.call('table.apply', { call_id: game.next(), effects: [{ kind: 'time', minutes: 600, why: 'the night' }] });
	assert.deepEqual((await game.read()).conditions, []);
	const clearing = await game.call('table.narrate', { call_id: game.next(), text: '眼皮终于抬得动。' });
	assert.equal(clearing.standing, undefined, 'nothing stands any more');
	assert.deepEqual(clearing.mechanics.filter((row) => row.kind === 'condition')[0].lost, ['unconscious']);

	await game.say('我撑着土坐起来。');
	const after = await game.call('table.narrate', { call_id: game.next(), text: '他慢慢站直。' });
	assert.equal(after.standing, undefined, 'and no later delivery brings it back');
});

/**
 * The character sheet, drawn by the shipped renderer.
 *
 * `pipicoc/panel.js` takes React by injection, so a stand-in with the four hooks it uses is enough
 * to run the real component over the real `table.view`: the point is that this is the page the
 * player opens and the captions the product ships, not a shape spelled out here.
 */
async function drawSheet(view, campaign = 'c1') {
	const states = [], refs = [], effects = [];
	let slot = 0, ref = 0, dirty = true;
	const React = {
		createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
		useState(initial) {
			const index = slot++;
			if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
			return [states[index], (value) => {
				const next = typeof value === 'function' ? value(states[index]) : value;
				if (next !== states[index]) { states[index] = next; dirty = true; }
			}];
		},
		useRef(initial) { const index = ref++; if (!(index in refs)) refs[index] = { current: initial }; return refs[index]; },
		useCallback: (fn) => fn,
		useEffect: (fn) => { effects.push(fn); },
	};
	const Panel = createComponent(React);
	const props = { api: { invoke: async () => ({ ok: true, data: { campaign, view, ui: { tag: UI.tag, words: UI.words } } }) } };
	let tree = null;
	for (let pass = 0; pass < 8 && dirty; pass += 1) {
		dirty = false; slot = 0; ref = 0; effects.length = 0;
		tree = Panel(props);
		for (const effect of effects) effect();
		await new Promise((done) => setTimeout(done, 0));
	}
	const drawn = (node) => {
		if (node === null || node === undefined || node === false) return '';
		if (Array.isArray(node)) return node.map(drawn).join('');
		if (typeof node !== 'object') return String(node);
		if (typeof node.type === 'function') return drawn(node.type({ ...node.props, children: node.children }));
		return [...(node.children ?? []), ...(node.props?.children ? [node.props.children] : [])].map(drawn).join('');
	};
	return drawn(tree);
}

test('the character sheet carries the states the rules hold on the body, and marks the ones that stop it', async (t) => {
	const game = await table(t);
	await game.say('我硬挨了一下。');
	await game.maul();
	await game.call('table.narrate', { call_id: game.next(), text: '爪子整个扫过来。' });

	// `conditions` rode this view all along and the sheet drew none of them: the Condition section
	// printed HP, SAN and MP and stopped. `incapacitated` is the rules engine's answer, projected so
	// the panel marks the blocking ones without keeping a second copy of the rule.
	const view = await game.call('table.view');
	const [investigator] = view.investigators;
	assert.deepEqual(investigator.incapacitated, ['unconscious', 'dying']);
	for (const name of ['major_wound', 'prone']) assert.ok(investigator.conditions.includes(name));

	const page = await drawSheet(view);
	for (const name of ['major_wound', 'prone', 'unconscious', 'dying'])
		assert.ok(page.includes(MECHANICS[`condition.${name}`]), `the sheet draws ${name}:\n${page}`);
	assert.ok(page.includes(MECHANICS.cannotAct), `and stamps that the body cannot act:\n${page}`);

	// A sheet with nothing on the body draws no stamp and no chips.
	const healthy = await game.call('table.view', { campaign: 'c1' });
	healthy.investigators = healthy.investigators.map((row) => ({ ...row, conditions: [], incapacitated: [] }));
	const clean = await drawSheet(healthy);
	assert.ok(!clean.includes(MECHANICS.cannotAct), `nothing stands, so nothing is stamped:\n${clean}`);
	assert.ok(!clean.includes(MECHANICS['condition.unconscious']), clean);
});
