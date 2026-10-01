/**
 * Contract §161: what a person feels right now is a ledger row the Keeper writes (`apply npc mood`) and reads on the
 * present card (`present[].now`) before they speak.
 *
 * Evidence this answers: the 40-turn table `blood-road-jev-20260930`, where nothing in the kernel, the extensions or the
 * host held what a person felt at that moment, and people spoke like an information desk. The tests below travel the
 * real paths: the emitted kernel as a subprocess over its RPC surface (the same bundle the product spawns), the
 * registered `apply` schema, and the text tool-call path that closes it. Nothing here reads what a mood says.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {build} from 'esbuild';
import {KernelClient} from '../../extensions/kernel/client.ts';
import {COC_TOOLS, MOOD_MAX} from '../../extensions/kernel/tools.ts';
import {leanTools} from '../../extensions/kernel/lean-apply.ts';
import {textToolCalls} from '../../extensions/kernel/text-tool-call.ts';
import {markNpcAct} from '../../extensions/kernel/npc-act-marks.ts';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'npc-mood-'));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({entryPoints: [join(root, 'kernel-ts/rpc.ts')], outfile: join(temporary, 'rpc.mjs'), bundle: true, packages: 'external',
	platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});

const campaign = 'mood-test', KNOTT = 'Steven Knott';
const SWEAT = 'Sweating through his collar, sick of strangers asking about that house.';
const RELIEF = 'Relieved someone finally believes him, and ashamed of it.';
const SHORT = 'Bored; wants his lunch.';
const ZH = '热得心烦，只想把这陌生人打发走。';

async function opened(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const connect = () => new KernelClient({command: [process.execPath, join(temporary, 'rpc.mjs'), '--workspace', home, '--content', join(root, 'content')],
		cwd: root, env: {...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', COC_KERNEL_SEED: 'npc-mood'}, timeoutMs: 30000});
	const client = connect();
	t.after(() => client.close());
	await client.call('campaign.create', {id: campaign, module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	const open = await client.call('table.open', {campaign});
	const directory = join(home, '.coc', 'campaigns', campaign);
	const file = async name => JSON.parse(await readFile(join(directory, name), 'utf8'));
	return {client, connect, home, directory, open, file,
		world: () => readFile(join(directory, 'world.json'), 'utf8'),
		ledger: async () => Object.entries(await file('npc-ledger.json')).find(([id]) => id.includes('knott'))?.[1] ?? {},
		record: turn => file(join('turns', `${String(turn).padStart(4, '0')}.json`))};
}
const apply = (client, call_id, effect) => client.call('table.apply', {campaign, call_id, effects: [{kind: 'npc', name: KNOTT, ...effect}]});
const refusal = promise => promise.then(value => assert.fail(`expected a refusal, got ${JSON.stringify(value)}`), error => error);
/** Close the opening and take the first player line: the table is on turn 1. */
async function begin(client) {
	await client.call('table.narrate', {campaign, call_id: 't0-c1', text: 'Knott slaps the key on the desk.'});
	await client.call('table.player_input', {campaign, text: 'I ask him about the house.'});
}
/** Close turn `turn` and take the next line; returns the next turn's capsule. */
async function nextTurn(client, turn, text = 'I wait for him to go on.') {
	await client.call('table.narrate', {campaign, call_id: `t${turn}-c9`, text: 'Knott looks out of the window for a while.'});
	return (await client.call('table.player_input', {campaign, text})).capsule;
}
const knottCard = capsule => capsule.present.find(person => person.name === KNOTT);
const capsuleOf = async client => { const value = await client.call('table.capsule', {campaign}); return value.capsule ?? value; };

test('a mood is a keeper-only npc receipt: no world value, no mechanics card, an npc-changed event', async t => {
	const {client, world, record, directory} = await opened(t);
	await begin(client);
	const before = await world();
	const landed = await apply(client, 't1-c1', {mood: SWEAT, why: 'the office is an oven and the party pushed him'});
	assert.deepEqual(landed.receipts, ['npc:steven-knott-t1-c1'], 'the ordinary npc receipt id');
	assert.deepEqual(landed.markers, [], 'no marker: nothing for the player surface to place');
	assert.equal(await world(), before, 'a mood changes no world value');
	// A card-drawing effect in its own call, so the turn's mechanics are not empty for the wrong reason.
	await client.call('table.apply', {campaign, call_id: 't1-c2', effects: [{kind: 'time', minutes: 5, why: 'he lets the silence sit'}]});
	const delivered = await client.call('table.narrate', {campaign, call_id: 't1-c3', text: 'Knott mops his neck and says nothing for a while.'});
	assert.ok(delivered.mechanics.length >= 1, 'the time effect draws its card');
	assert.equal(delivered.mechanics.filter(card => card.call === 't1-c1').length, 0, 'the mood draws none (§161.4)');
	const turn = await record(1);
	const receipt = turn.receipts.find(value => value.id === 'npc:steven-knott-t1-c1');
	assert.deepEqual(receipt.mood, {text: SWEAT, previous: null});
	assert.equal(receipt.visibility, 'keeper');
	assert.equal(receipt.kind, 'npc');
	for (const field of ['to', 'stance', 'dead', 'skill', 'intent']) assert.equal(receipt[field], undefined, `the mood receipt carries no ${field}`);
	assert.equal(turn.mechanics.filter(card => card.call === 't1-c1').length, 0, 'the committed turn record has no card for it');
	assert.equal(JSON.stringify(turn.speech ?? []).includes(SWEAT), false, 'the speech rows never carry it');
	assert.equal(String(turn.rendered_text).includes(SWEAT), false, 'nor the delivered prose');
	const events = (await readFile(join(directory, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
	const changed = events.filter(event => event.type === 'npc-changed' && event.receipt === 'npc:steven-knott-t1-c1');
	assert.equal(changed.length, 1);
	assert.deepEqual(changed[0].data.mood, {text: SWEAT, previous: null});
});

test('the next turn\'s present card carries now after the identity, before the dossier; look shows the ledger', async t => {
	const {client, ledger} = await opened(t);
	await begin(client);
	const unset = knottCard((await capsuleOf(client)));
	assert.equal(Object.hasOwn(unset, 'now'), false, 'no mood written: no now key');
	await apply(client, 't1-c1', {mood: SWEAT, why: 'the heat and the questions'});
	const sameTurn = knottCard((await capsuleOf(client)));
	assert.equal(Object.hasOwn(sameTurn, 'now'), false, 'the projection reads the committed ledger: this turn the Keeper has just written it');
	const card = knottCard(await nextTurn(client, 1));
	assert.deepEqual(card.now, {feels: SWEAT, since_turn: 1});
	const keys = Object.keys(card), at = keys.indexOf('now');
	// Everything before `now` is who they are and what their body is doing; everything after is the dossier and the
	// account, which `fitPresent` cuts from the bottom.
	const identity = ['name', 'runtime_inputs', 'called', 'untold', 'origin', 'state'];
	assert.ok(keys.slice(0, at).every(key => identity.includes(key)), `only identity and state come before now: ${keys}`);
	assert.ok(keys.slice(at + 1).every(key => !identity.includes(key)), `nothing of the identity comes after it: ${keys}`);
	for (const dossier of ['role', 'wants', 'voice', 'knows', 'history'])
		if (keys.includes(dossier)) assert.ok(keys.indexOf(dossier) > at, `${dossier} comes after now`);
	assert.ok(keys.includes('wants'), 'the card under test has a dossier to be ahead of');
	const present = (await client.call('table.look', {campaign, focus: 'npc'})).present.find(person => person.name === KNOTT);
	assert.deepEqual(present, card, 'look and the capsule never disagree');
	const view = await client.call('table.look', {campaign, focus: 'npc', name: KNOTT});
	assert.deepEqual(view.ledger.mood, {text: SWEAT, since_turn: 1, receipt: 'npc:steven-knott-t1-c1', why: 'the heat and the questions'});
	assert.deepEqual(view.ledger, await ledger(), 'look shows the ledger as it is');
});

test('a person never given a mood has neither ledger key and no now on the card', async t => {
	const {client, ledger} = await opened(t);
	await begin(client);
	await apply(client, 't1-c1', {stance: 'wary', why: 'the party pushed him about the house'});
	const card = knottCard(await nextTurn(client, 1));
	const entry = await ledger();
	assert.equal(entry.stance.value, 'wary', 'the ledger entry exists and was written');
	assert.equal(Object.hasOwn(entry, 'mood'), false);
	assert.equal(Object.hasOwn(entry, 'mood_earlier'), false);
	assert.equal(Object.hasOwn(card, 'now'), false);
});

test('a new mood replaces the old, which moves to mood_earlier (the last two); the newest in a turn wins; the ledger rebuilds', async t => {
	const {client, connect, home, ledger, record} = await opened(t);
	await begin(client);
	await apply(client, 't1-c1', {mood: SWEAT});
	await nextTurn(client, 1);
	// Turn 2: two lines in two calls. The receipt's previous is what the committed ledger holds.
	await apply(client, 't2-c1', {mood: SHORT});
	await apply(client, 't2-c2', {mood: RELIEF, why: 'the investigator said he believes him'});
	await nextTurn(client, 2);
	const turn2 = await record(2);
	assert.deepEqual(turn2.receipts.filter(value => value.mood).map(value => value.mood),
		[{text: SHORT, previous: SWEAT}, {text: RELIEF, previous: SWEAT}]);
	let entry = await ledger();
	assert.deepEqual(entry.mood, {text: RELIEF, since_turn: 2, receipt: 'npc:steven-knott-t2-c2', why: 'the investigator said he believes him'},
		'the newest written last in the turn wins');
	assert.deepEqual(entry.mood_earlier, [{text: SWEAT, since_turn: 1, until_turn: 2}], 'a line superseded inside the turn is not history');
	// Turn 3: the same line again is accepted and minted again; nothing compares meanings.
	const again = await apply(client, 't3-c1', {mood: RELIEF});
	assert.equal(again.receipts.length, 1);
	await nextTurn(client, 3);
	assert.deepEqual((await record(3)).receipts.find(value => value.mood).mood, {text: RELIEF, previous: RELIEF});
	// Turn 4: a line in another language is the person's own line, kept as written.
	await apply(client, 't4-c1', {mood: ZH});
	const card = knottCard(await nextTurn(client, 4));
	assert.deepEqual(card.now, {feels: ZH, since_turn: 4});
	entry = await ledger();
	assert.deepEqual(entry.mood_earlier, [{text: RELIEF, since_turn: 2, until_turn: 3}, {text: RELIEF, since_turn: 3, until_turn: 4}],
		'the last two replaced lines');
	const folded = await readFile(join(home, '.coc', 'campaigns', campaign, 'npc-ledger.json'), 'utf8');
	await client.close();
	await rm(join(home, '.coc', 'campaigns', campaign, 'npc-ledger.json'));
	const fresh = connect();
	t.after(() => fresh.close());
	await fresh.call('table.open', {campaign});
	assert.deepEqual(JSON.parse(await readFile(join(home, '.coc', 'campaigns', campaign, 'npc-ledger.json'), 'utf8')), JSON.parse(folded),
		'the rebuilt ledger is the same fold of the turn records');
});

test('each malformed line is refused by the kernel itself with reason mood_text, and nothing is written', async t => {
	const {client, world, record} = await opened(t);
	await begin(client);
	const before = await world();
	// These go straight to the kernel over RPC: no schema stands in front of them, so the kernel's own check is tested.
	const cases = {empty: '', blank: '   ', long: 'x'.repeat(MOOD_MAX + 1), newline: 'Hot.\nTired.', separator: 'Hot.\u2028Tired.', marker: 'Hot {{say:Knott}} and tired.', number: 42};
	for (const [label, mood] of Object.entries(cases)) {
		const error = await refusal(apply(client, `t1-c1`, {mood}));
		assert.equal(error.code, 'invalid_params', label);
		assert.equal(error.details?.reason, 'mood_text', `${label}: ${JSON.stringify(error.details)}`);
		assert.equal(error.details?.field, 'npc.mood', label);
		if (label === 'long') assert.deepEqual([error.details.length, error.details.max], [MOOD_MAX + 1, MOOD_MAX]);
	}
	assert.equal(await world(), before);
	// Code points, as the schema's maxLength counts them: 120 characters of four UTF-8 bytes each is one short line.
	const wide = '\u{1F610}'.repeat(MOOD_MAX);
	assert.equal(wide.length, MOOD_MAX * 2, 'every one of them is two UTF-16 units');
	const accepted = await apply(client, 't1-c1', {mood: `  ${wide}  `});
	assert.equal(accepted.receipts.length, 1);
	await client.call('table.narrate', {campaign, call_id: 't1-c9', text: 'Knott says nothing.'});
	assert.equal((await record(1)).receipts.find(value => value.mood).mood.text, wide, 'stored trimmed');
});

test('a mood stands alone in its npc effect: combined with another field it refuses with details.conflicts', async t => {
	const {client, world} = await opened(t);
	await begin(client);
	const before = await world();
	const combos = [
		[{stance: 'warm'}, ['stance']],
		[{to: 'away'}, ['to']],
		[{intends: 'Bolt the door behind them.', outcome: 'attempted'}, ['intends', 'outcome']],
		[{intent_ref: 'intent:steven-knott:0123456789ab', intent_outcome: 'failed'}, ['intent_ref', 'intent_outcome']],
		[{dead: true, conditions: {gained: ['unconscious']}}, ['dead', 'conditions']],
		[{defense: 'dodge'}, ['defense']],
	];
	for (const [fields, conflicts] of combos) {
		const error = await refusal(apply(client, 't1-c1', {mood: SWEAT, why: 'probe', ...fields}));
		assert.equal(error.code, 'invalid_params', JSON.stringify(fields));
		assert.equal(error.details?.field, 'npc.mood');
		assert.deepEqual(error.details?.conflicts, conflicts, JSON.stringify(fields));
	}
	assert.equal(await world(), before, 'nothing in a refused batch lands');
	// Two effects of one batch carry both.
	const both = await client.call('table.apply', {campaign, call_id: 't1-c1', effects: [
		{kind: 'npc', name: KNOTT, stance: 'warm', why: 'the party found his brother'}, {kind: 'npc', name: KNOTT, mood: RELIEF}]});
	assert.equal(both.receipts.length, 2);
});

test('a person who cannot act carries no now: incapacitated (state.cannot_act) or dead', async t => {
	for (const [label, change, check] of [
		['incapacitated', {conditions: {gained: ['unconscious']}, why: 'the laudanum takes him'}, card => assert.ok(card.state?.cannot_act, 'the card says he cannot act')],
		['dead', {dead: true, why: 'the thing in the house got to him'}, card => assert.ok(card.history?.dead_since_turn != null, 'the card says he died')],
	]) {
		const {client, ledger} = await opened(t);
		await begin(client);
		await apply(client, 't1-c1', {mood: SWEAT});
		assert.deepEqual(knottCard(await nextTurn(client, 1)).now, {feels: SWEAT, since_turn: 1}, `${label}: shown while he can act`);
		await apply(client, 't2-c1', change);
		const card = knottCard(await nextTurn(client, 2));
		check(card);
		assert.equal(Object.hasOwn(card, 'now'), false, `${label}: a person who cannot act has no now`);
		assert.equal((await ledger()).mood.text, SWEAT, `${label}: the ledger still holds the line; only the card leaves it out`);
		await client.close();
	}
});

test('the kernel declares npc.mood.v1 and narration-craft 2.1.5, which requires it, loads and contributes', async t => {
	const {client, open, file} = await opened(t);
	const listed = await client.call('mods.list', {campaign});
	assert.ok(listed.capabilities.includes('npc.mood.v1'), 'the kernel provides the capability');
	const craft = listed.mods.find(mod => mod.id === 'narration-craft' && mod.version === '2.1.5');
	assert.ok(craft, 'the package is in the catalog');
	assert.ok(craft.requires.includes('npc.mood.v1'), 'and requires it');
	assert.equal(JSON.stringify(open.mods_unreadable ?? []).includes('narration-craft'), false, `no build skew for it: ${JSON.stringify(open.mods_unreadable)}`);
	const active = (await file('world.json')).mods.active['narration-craft'];
	assert.deepEqual([active?.version, active?.enabled], ['2.1.5', true], 'a new campaign locks and enables it');
	await begin(client);
	const capsule = (await capsuleOf(client));
	const brief = capsule.mods.instructions.find(row => row.mod === 'narration-craft');
	assert.ok(brief?.instruction.includes('`now`'), 'its brief reaches the capsule and names the card field');
	assert.ok(capsule.head.includes('present[].now is what that person feels right now'), 'the base states the interface in the head');
	assert.ok(capsule.head.includes('apply npc mood'));
});

// ---- the extension side: the registered schema and every path that closes it (§161.5) -------------------------------

const npcVariant = tools => tools.find(tool => tool.name === 'apply').parameters.properties.effects.items.anyOf
	.find(branch => branch.properties.kind.const === 'npc' || branch.properties.kind.enum?.[0] === 'npc');
const envelope = effect => JSON.stringify({apply: {effects: [{kind: 'npc', name: KNOTT, ...effect}]}});

test('apply npc declares mood: a string of at most 120 characters, described as standalone', async t => {
	const mood = npcVariant(COC_TOOLS).properties.mood;
	assert.equal(mood.type, 'string');
	assert.equal(mood.maxLength, MOOD_MAX);
	assert.equal(MOOD_MAX, 120);
	assert.match(mood.description, /feels right now/);
	assert.match(mood.description, /stands alone in one npc effect/);
	assert.match(npcVariant(COC_TOOLS).properties.kind.description, /what they feel right now \(mood\)/, 'the apply tool names it');
	// The kernel's own bound is the same number: the refusal reports it.
	const {client} = await opened(t);
	await begin(client);
	const error = await refusal(apply(client, 't1-c1', {mood: 'x'.repeat(MOOD_MAX + 1)}));
	assert.equal(error.details.max, MOOD_MAX);
});

test('every path that closes the schema accepts mood and still refuses an undeclared field', () => {
	for (const [label, tools] of [['ordinary', COC_TOOLS], ['lean', leanTools(COC_TOOLS)]]) {
		// §160.2: the text path reads a whole body of envelopes and routes all of them or none.
		const calls = textToolCalls(envelope({mood: SWEAT, why: 'the heat'}), tools);
		assert.deepEqual(calls, [{name: 'apply', arguments: {effects: [{kind: 'npc', name: KNOTT, mood: SWEAT, why: 'the heat'}]}}], label);
		assert.equal(textToolCalls(envelope({feeling: SWEAT}), tools), undefined, `${label}: the path is closed`);
		assert.equal(textToolCalls(envelope({mood: 'x'.repeat(MOOD_MAX + 1)}), tools), undefined, `${label}: maxLength holds`);
	}
	// §143.3: a mood is no bare carrier of what an act brings out, so the host never stamps a draw onto it.
	const params = {effects: [{kind: 'npc', name: KNOTT, mood: SWEAT}]};
	markNpcAct('apply', params, {clerk: 'npc_act', basis: {draw: {weapon: 'knife'}}});
	assert.equal(params.effects[0]._draws, undefined);
});
