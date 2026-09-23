/**
 * Contract §80: a clue's summary is the Keeper's, and the player is told what this table earned.
 *
 * `clue.summary` is the module graph's own sentence about a clue. The reader writes it from the
 * book, and the book writes for the Keeper: it carries staging, intentions and agendas the player
 * has not earned. Two player surfaces unfolded it anyway.
 *
 * Campaign `game-7dca41f9` proved it against the product's own verifier. Turn 69 discovered
 * `hunters-seek-sarah`, whose graph summary ends 「他们怀疑莎拉被教堂牧师逮住，打算回城救她。」 -- a
 * plan the NPCs have not spoken. Both the delivery card and the right-hand clue panel unfolded that
 * sentence to the player on turn 69. Twenty-six turns later, on turn 95, the Keeper said the same
 * thing in prose and the verifier lane filed `kind: "reveal"` against it: 「克莱尔未赚取的秘密议程
 * ...被直接说给玩家。」 One piece of data, two consumers, opposite verdicts about secrecy.
 *
 * The player surfaces reached for `summary` because the field that was theirs had no projection.
 * `apply clue` has always taken `how` -- "one sentence: how they got it", written by the Keeper at
 * this table in the play language -- and it landed on the receipt and on the `clue-discovered`
 * event and was read by nothing at all (§31: written, never read). Now it is kept in
 * `world.clue_how` beside the name in `world.clue_labels`, and it is what both surfaces open into.
 *
 * Nothing below is hand-built. The product kernel creates the campaign and settles the clue, the
 * case board is drawn by `pipicoc/board.js` and the delivery card by `pipicoc/mechanics.js`, both
 * with the captions this build ships -- a test that spelled the projection out itself would pass
 * while the player's screen said something else.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createComponent as createBoard } from '../../pipicoc/board.js';
import { createComponent as createCard } from '../../pipicoc/mechanics.js';
import { resolveUiWords } from '../../runtime/ui-words.ts';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'clue-summary-'));
after(() => rm(temporary, { recursive: true, force: true }));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({
	stdin: { contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: root, sourcefile: 'clue-summary-api.ts' },
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node',
	target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

/** The captions this build ships for the table's language, exactly as a host attaches them (§23). */
const UI = await resolveUiWords({ contentRoot: join(root, 'content'), home: temporary, tag: 'zh-Hans' });

/**
 * The module this runs on is `the-haunting-rulebook`, the source-bound starter: its clue summaries
 * are the book's own Keeper prose rather than a restatement of the clue's name, which is the case
 * that leaks. This one is read off the shipped graph rather than quoted here, so the assertion
 * cannot drift away from what the product actually carries.
 */
const GRAPH = JSON.parse(await readFile(join(root, 'content/starters/the-haunting-rulebook/module-graph.json'), 'utf8'));
const CLUE = GRAPH.nodes.find((node) => node.node_id === 'clue-windows-nailed-shut');
/** The half of that sentence the player has not earned: what else the front door is carrying. */
const UNEARNED = 'four additional bolts';

/** What the Keeper filed at this table: the name, and the account of how they came by it. */
const LABEL = '窗户被钉死';
const HOW = '克罗挨个去推一楼的窗框，全都推不动。';
/** The same, told on each of two worldlines that never met. */
const MAIN = '主线：她挨个去推一楼的窗框。';
const SIDE = '支线：杜利在门廊上讲了马卡里奥家的事。';

const PROFILE = {
	name: 'Martha Alden',
	occupation: 'Missionary',
	occupation_stated: 'visiting nurse',
	age: 28,
	sex: 'woman',
	concept: 'A parish charity nurse who walks her rounds by day and carries the bag at night.',
	own_language: 'English',
	occupation_skills: ['First Aid', 'Medicine', 'Persuade', 'Psychology', 'Navigate', 'Listen', 'Mechanical Repair', 'Natural World'],
	interest_skills: ['Library Use', 'History', 'Spot Hidden'],
	backstory: {
		personal_description: 'A small sharp-featured woman of about twenty-eight.',
		ideology_beliefs: 'People matter more than houses.',
		significant_people: 'A mother who took in washing.',
		meaningful_locations: 'The parish charity clinic.',
		treasured_possessions: 'The medicine bag she reaches for first in the dark.',
		traits: 'She can hear a lie while she is winding a bandage.',
		scenario_bound: 'A landlord asked her to find out why his tenants keep leaving.',
	},
	key_connection: { backstory_field: 'ideology_beliefs', summary: 'She took the work for the people who lived there.' },
	equipment: ['Medicine bag'],
};

/** One real campaign on the product kernel, standing in front of the house with the clue to find. */
async function table(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({
		workspace: home, content: join(root, 'content'), seed: 'clue-summary',
		locks: api.createAdvisoryLocks(async () => {}),
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
	});
	const runtime = api.createKernelRuntime(context);
	t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({ campaign: 'c1', ...params });
	await call('campaign.create', { id: 'c1', module: 'the-haunting-rulebook', play_language: 'zh-Hans' });
	const drafted = await call('setup.draft', { profile: PROFILE });
	await call('setup.confirm', { revision: drafted.revision, consent: 'delegated' });
	await call('setup.complete');
	await call('table.open');
	await call('table.narrate', { call_id: 't0-c1', text: '门在你身后合上。' });
	let turn = 1, ordinal = 0;
	const game = {
		call, home,
		next: () => `t${turn}-c${++ordinal}`,
		async say(text) { await call('table.player_input', { text }); turn += 1; ordinal = 0; },
		/** The panel reads what the transport delivered, so the answer crosses JSON as it does in the product. */
		view: async () => JSON.parse(api.pythonJsonDumps(await call('table.view'))),
		record: async (n) => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/turns', `${String(n).padStart(4, '0')}.json`), 'utf8')),
		/** Walk to the house, which is one of the introduction's own exits. */
		async approach() {
			await call('table.apply', { call_id: game.next(), effects: [{ kind: 'move', to: 'corbitt-house-approach', minutes: 20, why: '走过去' }] });
		},
		async find(effect) {
			return call('table.apply', { call_id: game.next(), effects: [{ kind: 'clue', clue: 'windows-nailed-shut', ...effect }] });
		},
	};
	await game.say('我走去看那栋房子。');
	await game.approach();
	return game;
}

/**
 * The case board, drawn by the shipped renderer.
 *
 * The clue surface moved to `pipicoc/board.js` with the case board (contract §39.3): the sheet is
 * one credential and one body, and a kept clue is neither. `board.js` takes React by injection, so
 * a stand-in with the four hooks it uses runs the real component over the real `table.view`.
 */
async function drawBoard(view, campaign = 'c1') {
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
	const Board = createBoard(React);
	const props = { api: { invoke: async () => ({ ok: true, data: { status: 'ready', campaign, view, maps: [], ui: { tag: UI.tag, words: UI.words } } }) } };
	let tree = null;
	for (let pass = 0; pass < 8 && dirty; pass += 1) {
		dirty = false; slot = 0; ref = 0; effects.length = 0;
		tree = Board(props);
		for (const effect of effects) effect();
		await new Promise((done) => setTimeout(done, 0));
	}
	return drawn(tree);
}

function drawn(node) {
	if (node === null || node === undefined || node === false) return '';
	if (Array.isArray(node)) return node.map(drawn).join('');
	if (typeof node !== 'object') return String(node);
	if (typeof node.type === 'function') return drawn(node.type({ ...node.props, children: node.children }));
	return [...(node.children ?? []), ...(node.props?.children ? [node.props.children] : [])].map(drawn).join('');
}

/**
 * The delivery card, drawn by the shipped renderer with the captions this build ships, and read the
 * way the player reads it: the turn's mechanics slip starts folded, so it is opened by its own toggle
 * first. A card read folded would pass the "never draws the book's sentence" checks by drawing nothing.
 */
function cardText(mechanics) {
	const states = [];
	let slot = 0;
	const Card = createCard({
		createElement: (type, props, ...children) => typeof type === 'function'
			? type({ ...(props || {}), children }) : { type, props: props || {}, children },
		useState(initial) {
			const index = slot++;
			if (!(index in states)) states[index] = initial;
			return [states[index], (value) => { states[index] = value; }];
		},
	});
	const draw = () => { slot = 0; return Card({ details: { ui: { tag: UI.tag, words: { mechanics: UI.words.mechanics } }, mechanics } }); };
	const toggles = [];
	const walk = (node) => {
		if (Array.isArray(node)) return node.forEach(walk);
		if (!node || typeof node !== 'object') return;
		if (node.type === 'button' && node.props?.['aria-expanded'] === false && node.props?.['aria-controls']) toggles.push(node);
		[...(node.children ?? []), node.props?.children].forEach(walk);
	};
	walk(draw());
	assert.equal(toggles.length, 1, 'the card has one folded mechanics slip');
	toggles[0].props.onClick();
	return drawn(draw());
}

test("the book's own sentence about a clue reaches no player surface, and what the table earned does", async (t) => {
	const game = await table(t);
	assert.ok(CLUE.summary.includes(UNEARNED),
		`the shipped graph still carries the Keeper half of this clue:\n${CLUE.summary}`);

	await game.find({ how: HOW, label: LABEL });
	const delivery = await game.call('table.narrate', { call_id: game.next(), text: '窗框纹丝不动。' });

	// The card the player is handed on the turn it happened.
	const [row] = delivery.mechanics.filter((entry) => entry.kind === 'clue');
	assert.equal(row.summary, undefined, `the card carries the book's sentence:\n${JSON.stringify(row)}`);
	assert.equal(row.how, HOW, 'and carries the account the Keeper filed for this table');
	assert.equal(row.label, LABEL);

	// The same card read back out of history, which is a second path (§16.2) and was the one that
	// used to be wired on its own.
	const [kept] = (await game.record(delivery.turn)).mechanics.filter((entry) => entry.kind === 'clue');
	assert.deepEqual(kept, row, 'the live card and the history card are the same object');

	// The persistent panel, which is where the leak lived the longest: it is open all game.
	const view = await game.view();
	assert.deepEqual(view.clues.discovered, [{ clue: 'windows-nailed-shut', label: LABEL, how: HOW }],
		`the projection hands the panel only what this table earned:\n${JSON.stringify(view.clues)}`);

	// And drawn, because a field the projection drops can still be reached for by a renderer that
	// has another way in, and a field it carries can still be drawn nowhere.
	const sheet = await drawBoard(view);
	assert.ok(!sheet.includes(UNEARNED), `the panel draws the Keeper's half of the sentence:\n${sheet}`);
	assert.ok(sheet.includes(LABEL), 'the panel names the clue');
	assert.ok(sheet.includes(HOW), `the panel opens into how this table came by it:\n${sheet}`);

	const card = cardText(delivery.mechanics);
	assert.ok(!card.includes(UNEARNED), `the delivery card draws the Keeper's half of the sentence:\n${card}`);
	assert.ok(card.includes(HOW), `the delivery card opens into the account:\n${card}`);
});

test('the Keeper keeps the whole of it: the graph is where the module speaks to the Keeper', async (t) => {
	const game = await table(t);
	await game.find({ how: HOW, label: LABEL });
	const delivery = await game.call('table.narrate', { call_id: game.next(), text: '窗框纹丝不动。' });

	// Undiscovered or discovered, `look focus=clues` is a Keeper action (§22) and hands back the
	// module's own text. Nothing here is narrowed: the fix is a projection boundary, not a redaction
	// of the book, and a Keeper who lost this would have to guess at what they are running.
	const look = await game.call('table.look', { focus: 'clues' });
	assert.ok(JSON.stringify(look).includes(UNEARNED),
		`the Keeper still reads the book's sentence:\n${JSON.stringify(look).slice(0, 600)}`);

	// The receipt is the Keeper's record and the audit trail, so it keeps the summary too. What
	// changed is that the §16.2 projection no longer copies it across.
	const [receipt] = (await game.record(delivery.turn)).receipts.filter((entry) => entry.kind === 'clue');
	assert.ok(String(receipt.summary).includes(UNEARNED), 'the receipt records what the module said');
	assert.equal(receipt.how, HOW);
});

test('a clue nobody accounted for is a name and nothing more, on both surfaces', async (t) => {
	const game = await table(t);
	// `how` is optional and always has been. Without it there is nothing the player earned to open
	// into -- and the answer to that is a plain line, not the book's sentence standing in for one.
	await game.find({ label: LABEL });
	const delivery = await game.call('table.narrate', { call_id: game.next(), text: '窗框纹丝不动。' });

	const [row] = delivery.mechanics.filter((entry) => entry.kind === 'clue');
	assert.equal(row.summary, undefined);
	assert.equal(row.how, undefined, `nothing was filed, so nothing is offered:\n${JSON.stringify(row)}`);

	const view = await game.view();
	assert.deepEqual(view.clues.discovered, [{ clue: 'windows-nailed-shut', label: LABEL }]);

	const sheet = await drawBoard(view);
	assert.ok(sheet.includes(LABEL), 'the clue is still on the sheet by name');
	assert.ok(!sheet.includes(UNEARNED), `and the book does not fill the silence:\n${sheet}`);
	assert.ok(!cardText(delivery.mechanics).includes(UNEARNED));
});

test('the account survives the turn it was filed on, because it is world state and not a receipt', async (t) => {
	const game = await table(t);
	await game.find({ how: HOW, label: LABEL });
	await game.call('table.narrate', { call_id: game.next(), text: '窗框纹丝不动。' });

	// Turns later, with the clue long settled, the panel still says how they got it. That is the
	// difference between `world.clue_how` and reading it back off one turn's receipts: the panel is
	// a standing surface and a clue found an hour ago is still on it.
	await game.say('我再绕到屋后看看。');
	await game.call('table.narrate', { call_id: game.next(), text: '后院的草没过膝盖。' });
	await game.say('我敲门。');
	await game.call('table.narrate', { call_id: game.next(), text: '没有人应门。' });

	const view = await game.view();
	assert.deepEqual(view.clues.discovered, [{ clue: 'windows-nailed-shut', label: LABEL, how: HOW }]);
	assert.ok((await drawBoard(view)).includes(HOW));
	assert.deepEqual(JSON.parse(await readFile(join(game.home, '.coc/campaigns/c1/world.json'), 'utf8')).clue_how,
		{ 'windows-nailed-shut': HOW }, 'and it is kept per clue, beside the name');
});

test('a confluence keeps both lines\' accounts, by the same union that keeps both lines\' names', async (t) => {
	const game = await table(t);

	// The fork comes first, so each line earns a clue the other never sees: the side line hears it
	// from a neighbour, the main line finds it on the windows. How a line came by a clue is a record
	// of what happened on that line, not a claim two lines can disagree about, so a merge unions it
	// exactly as it unions the names (§15.6). Taking the first line's map whole would empty the panel
	// of everything the other line earned -- the same shape as losing the account in the first place.
	await game.call('table.apply', { call_id: game.next(), effects: [{ kind: 'fork', name: 'side', mode: 'if' }] });
	await game.call('table.narrate', { call_id: game.next(), text: '换一条路。' });

	await game.say('我去敲邻居的门。');
	await game.call('table.apply', { call_id: game.next(), effects: [{ kind: 'move', to: 'neighborhood', minutes: 40, why: '去问邻居' }] });
	await game.call('table.apply', { call_id: game.next(), effects: [{ kind: 'clue', clue: 'dooley-macario-gossip', how: SIDE, label: '邻居的说法' }] });
	await game.call('table.narrate', { call_id: game.next(), text: '杜利靠在门框上。' });

	await game.say('回到原来那条路。');
	await game.call('table.apply', { call_id: game.next(), effects: [{ kind: 'switch', line: 'main' }] });
	await game.call('table.narrate', { call_id: game.next(), text: '回到窗前。' });
	await game.say('我去推一楼的窗。');
	await game.find({ how: MAIN, label: LABEL });
	await game.call('table.narrate', { call_id: game.next(), text: '窗框纹丝不动。' });

	assert.deepEqual((await game.view()).clues.discovered, [{ clue: 'windows-nailed-shut', label: LABEL, how: MAIN }],
		'each line knows only what it earned');

	await game.say('把两条路合起来。');
	await game.call('table.apply', { call_id: game.next(), effects: [{ kind: 'merge', name: 'joined', lines: ['main', 'side'] }] });
	// A confluence lands when the turn's narrate commits, not when `apply` returns it.
	await game.call('table.narrate', { call_id: game.next(), text: '两条路合上。' });

	const view = await game.view();
	assert.deepEqual(view.clues.discovered.map((clue) => clue.how).sort(), [MAIN, SIDE].sort(),
		`both lines' accounts stand after the merge:\n${JSON.stringify(view.clues)}`);

	const sheet = await drawBoard(view);
	assert.ok(sheet.includes(MAIN) && sheet.includes(SIDE), 'and the merged panel draws both');
	for (const clue of GRAPH.nodes.filter((node) => ['clue-windows-nailed-shut', 'clue-dooley-macario-gossip'].includes(node.node_id)))
		assert.ok(!sheet.includes(clue.summary), `the merged panel draws the book's sentence:\n${clue.summary}`);
});
