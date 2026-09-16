/**
 * What the money block on a character sheet is allowed to say (§23.4, §42.6's projection rule).
 *
 * Two facts the kernel records correctly never survived the last inch to the player:
 *
 *   1. The rulebook's `Penniless` row prints no assets. `content/rulesets/coc7/rules-json/
 *      cash-assets.json` carries that as `assets: null`, and the kernel writes it onto the card as
 *      `{amount: null, currency: 'USD', formula: 'None'}` -- the derivation *is* "None", which is an
 *      accounting fact and not a hole. Two live tables on 2026-09-14 (`game-1c0faba5`,
 *      `game-33a2a97a`) drew that as the literal word `null` in front of a currency, and one of the
 *      players wrote the string back into the fiction asking what it meant.
 *   2. A book set in a year the rulebook never tabulated builds its card off the table's own
 *      nominated column and the kernel records the swap in `finance.substituted_for`. In
 *      `game-b4cebfe0` the book is set in 1895, the money is the 1920s column, and the card said
 *      only "9 USD". The contract asks the setup agent to say it once in prose; that transcript
 *      never says it.
 *
 * Nothing below is hand-built: the product kernel's own setup handlers calculate the card, the
 * campaign opens, and `pipicoc/panel.js` draws it with the captions this build ships.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createComponent } from '../../pipicoc/panel.js';
import { resolveUiWords } from '../../runtime/ui-words.ts';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'finance-facts-'));
after(() => rm(temporary, { recursive: true, force: true }));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({
	stdin: { contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: root, sourcefile: 'finance-api.ts' },
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node',
	target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

/** The captions this build ships for the table's language, exactly as a host attaches them (§23). */
const UI = await resolveUiWords({ contentRoot: join(root, 'content'), home: temporary, tag: 'zh-Hans' });
const SHEET_WORDS = UI.words.sheet;

/**
 * A complete semantic profile, of the shape the setup agent hands `setup.draft`. The occupation is
 * `Missionary` because its credit range opens at 0, which is the rulebook's `Penniless` row -- the
 * same occupation `game-1c0faba5` was playing when it printed `null`.
 */
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
		personal_description: 'A small sharp-featured woman of about twenty-eight, brown hair pinned behind the ears.',
		ideology_beliefs: 'People matter more than houses. She carries no gun.',
		significant_people: 'A mother who took in washing; a father drowned off the docks.',
		meaningful_locations: 'The parish charity clinic and the alleys on her visiting list.',
		treasured_possessions: 'The medicine bag she reaches for first in the dark.',
		traits: 'She can hear a lie while she is winding a bandage.',
		scenario_bound: 'A landlord asked her to find out why his tenants keep leaving.',
	},
	key_connection: { backstory_field: 'ideology_beliefs', summary: 'She took the work for the people who lived there, not for the house.' },
	equipment: ['Medicine bag', 'Notebook'],
};

/**
 * A content root of this build's own content, with one book's authored era replaced.
 *
 * The starters all declare `1920s`, which is a rulebook period, so no shipped book can produce a
 * substitution. `game-b4cebfe0`'s book declares prose spanning years, and that prose is what the
 * rulebook has no column for -- so the fixture changes exactly the one authored field that case
 * turns on and leaves every rules table as shipped.
 */
async function contentWithEra(era) {
	const contentRoot = join(temporary, `content-${Buffer.from(era).toString('hex').slice(0, 12)}`);
	await cp(join(root, 'content'), contentRoot, { recursive: true });
	const file = join(contentRoot, 'starters/the-haunting/module-graph.json');
	const graph = JSON.parse(await readFile(file, 'utf8'));
	const module = graph.nodes.find((node) => node.node_kind === 'module');
	assert.ok(module, 'the starter has a module node to author an era on');
	// The module node carries its declaration as a projected `module-meta.json` document, and that
	// document wins over the node's own properties (`moduleDeclaration`), so the era is authored
	// where the kernel actually reads it rather than where it looks like it should be.
	const meta = module.properties.runtime_projection.documents.find((document) => document.filename === 'module-meta.json');
	assert.ok(meta?.root, 'the module node carries a module-meta.json document to author an era in');
	meta.root.era = era;
	await writeFile(file, JSON.stringify(graph));
	return contentRoot;
}

/** One real campaign, carried through the product's own setup handlers and opened for play. */
async function table(t, { contentRoot = join(root, 'content'), profile = PROFILE } = {}) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({
		workspace: home, content: contentRoot, seed: 'finance',
		locks: api.createAdvisoryLocks(async () => {}),
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
	});
	const runtime = api.createKernelRuntime(context);
	t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({ campaign: 'c1', ...params });
	await call('campaign.create', { id: 'c1', module: 'the-haunting', play_language: 'zh-Hans' });
	const drafted = await call('setup.draft', { profile });
	await call('setup.previewed', { revision: drafted.revision });
	await call('setup.confirm', { revision: drafted.revision, consent: 'delegated' });
	await call('setup.complete');
	await call('table.open');
	// The panel reads what the transport delivered, so the answer crosses JSON exactly as it does in
	// the product: an in-memory rules number is not the value a renderer is ever handed.
	return { call, home, draft: drafted.sheet, view: async () => JSON.parse(api.pythonJsonDumps(await call('table.view'))) };
}

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

test('a row the rulebook prints no figure for draws the card\'s empty cell, never the word null', async (t) => {
	const game = await table(t);
	const view = await game.view();
	const finance = view.investigators[0].finance;
	assert.equal(finance.living_standard, 'Penniless', 'the credit range opens at 0, which is the Penniless row');
	assert.deepEqual(finance.assets, { amount: null, currency: 'USD', formula: 'None' },
		'the kernel records the row as the rulebook prints it: no figure, and a derivation that says None');

	const drawn = await drawSheet(view);
	assert.ok(!/null/.test(drawn), `the sheet prints a value the player cannot read:\n${drawn.slice(0, 400)}`);
	// The mark the rest of the card already uses for a cell with nothing in it, and not a bare
	// currency either -- a unit with no figure in front of it is not a reading.
	const assets = drawn.slice(drawn.indexOf(SHEET_WORDS.assets));
	assert.ok(assets.startsWith(`${SHEET_WORDS.assets}—`),
		`the assets cell reads the way every other empty cell on this card reads:\n${assets.slice(0, 80)}`);
	assert.ok(drawn.includes(`${SHEET_WORDS.cash}0.5 USD`), 'and a row the table does print keeps its figure');
});

test('a card built off a period the book is not set in says so where the numbers are', async (t) => {
	const era = '1895 (default); investigators then reach the night before the 1287 storm';
	const game = await table(t, { contentRoot: await contentWithEra(era) });
	const view = await game.view();
	const finance = view.investigators[0].finance;
	assert.equal(finance.period, '1920s', "the table's own nominated column stands in");
	assert.equal(finance.substituted_for, era, 'and the card records what it stood in for');

	const drawn = await drawSheet(view);
	// Two halves, and they are separate on purpose (§23.4): the caption is the shipped one with the
	// table's own word for the period, and the authored setting follows it verbatim as its own text.
	// Splicing a source string into the middle of a play-language sentence reads as neither, so the
	// test pins the two pieces rather than one template.
	const said = SHEET_WORDS.financeStandsIn.replace('{period}', view.labels['1920s'] ?? '1920s');
	const block = drawn.slice(drawn.indexOf(SHEET_WORDS.finance), drawn.indexOf(SHEET_WORDS.finance) + 600);
	assert.ok(drawn.includes(said),
		`the finance block never tells the player these figures are a stand-in:\n${block}`);
	assert.ok(drawn.includes(`${said} ${era}`),
		`the authored setting is not said in the book's own words beside the caption:\n${block}`);
});

test('a book the rulebook does tabulate says nothing, so the note is a fact and not decoration', async (t) => {
	const game = await table(t);
	const view = await game.view();
	assert.equal(view.investigators[0].finance.substituted_for, undefined, 'the shipped book is set in a period the rules print');
	const drawn = await drawSheet(view);
	assert.ok(!drawn.includes(SHEET_WORDS.financeStandsIn.split('{')[0]),
		'a card whose period was not substituted carries no substitution note');
});
