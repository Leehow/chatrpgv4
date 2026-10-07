/**
 * Contract §188.4, batch B (NR-04b): every tool entrance that names a person or an entity reads it through
 * `ModuleGraph.resolve` plus the §87.8 junction, and a stored reference is compared by what it names, never by its spelling.
 *
 * On the real kernel in process with The Haunting (the object-usages fixture): the memory lane's `subject` / `knowers` /
 * `entities` and `apply note` `entities` (`EntityIndex`), a note stored under another word, `apply ruling` anchors,
 * `resolve action.obligation`, a Mod dossier's `name`, the say token, the clue-label matcher, the chase's target, roster and
 * conflict, and a promise's cash counterparty. Each is reached by this table's word (`apply person`), by the told name and
 * by the handle (or node id), and lands on the same person or entity; another one is refused or lands on that other one; a
 * word two people carry is refused naming both; free text that names nobody keeps the behaviour it had.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {table} from './object-usages-fixture.mjs';

const KNOTT = 'steven-knott', DOOLEY = 'dooley';
const WORD = 'the letting agent', SHARED = 'the old man';

/** The receipts one call landed, read back from the open turn. */
async function landed(game, effects) {
	const result = await game.call('table.apply', {call_id: game.next(), effects});
	const receipts = (await game.call('table.status')).receipts;
	return result.receipts.map(id => receipts.find(receipt => receipt.id === id));
}
/** Two people this table calls one word, written on the record directly (§103.7: `apply person` refuses a taken word). */
async function shareWord(game) {
	const path = join(game.directory, 'world.json'), world = JSON.parse(await readFile(path, 'utf8'));
	world.person_labels = {...world.person_labels, 'arty-wilmot': {name: SHARED}, 'kim-debrun': {name: SHARED}};
	await writeFile(path, JSON.stringify(world));
}
const twoOwners = error => error.details?.query === SHARED && error.details?.candidates?.length === 2;
/** Knott worded by this table, and a word two others carry. */
async function worded(t) {
	const game = await table(t);
	await game.apply([{kind: 'person', who: 'Steven Knott', name: WORD}]);
	await shareWord(game);
	return game;
}
const rejects = (promise, check, message) => assert.rejects(promise, error => { assert.ok(check(error), `${message}: ${JSON.stringify({message: error.message, details: error.details})}`); return true; });

test('§188.4: the memory lane names a person by the table\'s word, the told name or the handle, stored as one person', async t => {
	const game = await worded(t);
	const job = await game.call('memory.job', {turn: 0});
	const fact = (subject, extra = {}) => ({kind: 'knowledge', subject, statement: `${subject} wants the house cleared.`, ...extra});
	const submit = candidates => game.call('memory.submit', {job_id: job.job_id, candidates});
	const refused = (name, field = 'subject') => error => error.code === 'invalid_params' && error.details?.field === field && error.details?.name === name;
	await rejects(submit([fact('Mr. Dooley')]), refused('Mr. Dooley'), 'a person not in this turn is refused as before');
	await rejects(submit([fact('a passing stranger')]), refused('a passing stranger'), 'free text names nobody, as before');
	const result = await submit([fact(WORD, {knowers: [WORD], entities: ['Steven Knott']}), fact('Steven Knott', {knowers: [KNOTT]}), fact(KNOTT),
		fact(WORD, {kind: 'belief', entities: ['a passing stranger']})]);
	assert.equal(result.candidates, 4);
	assert.deepEqual(result.dropped_entities, ['a passing stranger'], 'an entity that names nobody is still dropped');
	const rows = (await readFile(join(game.directory, 'memory/candidates.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
	assert.deepEqual(rows.map(row => row.subject), ['Steven Knott', 'Steven Knott', 'Steven Knott', 'Steven Knott']);
	assert.deepEqual([rows[0].knowers, rows[0].entities, rows[1].knowers], [['Steven Knott'], ['Steven Knott'], ['Steven Knott']]);

	await t.test('a memory evidence query about him, by any word, holds the four rows', async () => {
		for (const about of [WORD, 'Steven Knott', KNOTT]) {
			const snapshot = await game.call('memory.evidence', {action: 'snapshot', query: 'What does the landlord want?', filters: {about: [about]}});
			assert.equal(snapshot.indexed, 4, about);
		}
		assert.equal((await game.call('memory.evidence', {action: 'snapshot', query: 'Who else?', filters: {about: ['Mr. Dooley']}})).indexed, 0, 'another person holds none');
	});

	await t.test('recall finds them by any word for him, and refuses a word two people carry', async () => {
		for (const about of [WORD, 'Steven Knott', KNOTT]) {
			const hits = (await game.call('table.recall', {what: 'memory', about: [about]})).hits;
			assert.equal(hits.length, 4, about);
		}
		await rejects(game.call('table.recall', {what: 'memory', about: [SHARED]}), error => error.code === 'unknown_entity' && error.details?.candidates?.length === 2, 'two owners');
	});
});

test('§188.4: the referenced memory lane names a person by the table\'s word too', async t => {
	const game = await worded(t);
	const packet = await game.call('memory.job', {turn: 0, mode: 'referenced'});
	const decisions = packet.step.segments.map(segment => segment.role === 'keeper'
		? {source: segment.alias, outcome: 'retain', annotations: [{kind: 'knowledge', subject: WORD, knowers: [KNOTT], entities: [WORD], state: 'accurate'}]}
		: {source: segment.alias, outcome: 'skip'});
	await game.call('memory.submit', {job_id: packet.job_id, referenced: {step: packet.step.key, decisions,
		...(packet.story_context ? {story: {status: 'unclear', thread: null, frame_source: null, bridge_delivered: false, delivery_source: null}} : {})}});
	const rows = (await readFile(join(game.directory, 'memory/candidates.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
	assert.ok(rows.length);
	for (const row of rows) assert.deepEqual([row.subject, row.knowers, row.entities], ['Steven Knott', ['Steven Knott'], ['Steven Knott']]);
});

test('§188.4: a note\'s entities are read as people, and a note stored under the table\'s word links where he is', async t => {
	const game = await worded(t);
	const note = async (name, entities) => (await landed(game, [{kind: 'note', name, text: 'Ask about the rent.', entities}]))[0].entities;
	assert.deepEqual(await note('rent-a', [WORD]), ['Steven Knott'], 'the table\'s word is that person');
	assert.deepEqual(await note('rent-b', ['Steven Knott']), ['Steven Knott']);
	assert.deepEqual(await note('rent-c', [KNOTT]), ['Steven Knott']);
	assert.deepEqual(await note('paper', ['Mr. Dooley']), ['Mr. Dooley'], 'another person is that other person');
	assert.deepEqual(await note('stranger', ['a passing stranger']), ['a passing stranger'], 'free text stays as written');
	assert.deepEqual(await note('either', [SHARED]), [SHARED], 'a word two people carry names neither and stays as written');

	// A note an older kernel stored under the table's word, behind four newer notes about nobody here: the capsule shows the
	// note linked to the person present (§134's note rows lead with the linked ones; three unlinked ones follow).
	const path = join(game.directory, 'notes.jsonl');
	const older = {name: 'old-rent', text: 'He owes the plumber.', entities: [WORD], turn: 0, status: 'open'};
	const filler = index => ({name: `elsewhere-${index}`, text: 'Nothing here.', entities: ['a passing stranger'], turn: 1, status: 'open'});
	await writeFile(path, [older, ...[1, 2, 3, 4].map(filler)].map(row => JSON.stringify(row)).join('\n') + '\n');
	await game.call('table.narrate', {call_id: game.next(), text: 'Knott waits.'});
	const {capsule} = await game.call('table.player_input', {text: 'I ask Knott about the plumber.'});
	const notes = capsule.obligations.filter(row => row.kind === 'note').map(row => row.name);
	assert.equal(notes[0], 'old-rent', `the note stored under his word is linked to him: ${notes}`);
});

test('§188.4: a ruling anchored by the table\'s word, the told name or the handle is anchored on that person', async t => {
	const game = await worded(t);
	const anchor = async (name, entities) => (await landed(game, [{kind: 'ruling', name, statement: 'Haggling with him is Hard.', anchor: {entities}}]))[0].anchor.entities;
	for (const [index, name] of [WORD, 'Steven Knott', KNOTT].entries()) assert.deepEqual(await anchor(`haggle-${index}`, [name]), [KNOTT], name);
	assert.deepEqual(await anchor('papers', ['Mr. Dooley']), [DOOLEY], 'another person is that other person');
	assert.deepEqual(await anchor('self', [game.sheet.name]), [`investigator:${game.sheet.id}`], 'an investigator keeps their own namespace');
	await rejects(anchor('either', [SHARED]), error => error.code === 'invalid_params' && twoOwners(error), 'a word two people carry is refused naming both');
	await rejects(anchor('stranger', ['a passing stranger']), error => error.code === 'invalid_params' && error.details?.field === 'entities', 'free text is refused as before');
});

test('§188.4: action.obligation names a stated obligation by its handle, node id or name, compared as the node', async t => {
	const game = await table(t);
	const claim = obligation => game.call('table.resolve', {call_id: game.next(), action: {intent: 'social', goal: 'take the job', method: 'shake on it',
		skill: 'Persuade', target: 'Steven Knott', obligation}});
	const reason = expected => error => error.details?.reason === expected;
	// Knott's commission is settled by accepting his offer, not by a roll: the refusal says so once the reference is his.
	for (const name of ['knott-accept-commission', 'requirement-knott-accept-commission', "Accept Knott's commission"])
		await rejects(claim(name), reason('obligation_step'), name);
	// The Globe's clippings belong to another scene: named by its handle or its name, it is that obligation, not here.
	for (const name of ['globe-clippings-access', 'Access to the Globe clippings'])
		await rejects(claim(name), reason('obligation_not_here'), name);
	await rejects(claim('the rent dispute'), reason('obligation_unknown'), 'free text names no obligation, as before');
});

test('§188.4: a Mod dossier names a person by the table\'s word, the told name or the handle', async t => {
	const game = await worded(t);
	const speaks = async (name, language) => (await landed(game, [{kind: 'dossier', name, values: {language}, why: 'he said so'}]))[0];
	for (const [name, language] of [[WORD, 'English'], ['Steven Knott', 'English and some Italian'], [KNOTT, 'English, Italian and Latin']])
		assert.equal((await speaks(name, language)).handle, KNOTT, name);
	assert.equal((await speaks('Mr. Dooley', 'English')).handle, DOOLEY, 'another person is that other person');
	await rejects(speaks(SHARED, 'English'), twoOwners, 'a word two people carry is refused naming both');
	await rejects(speaks('a passing stranger', 'English'), error => error.code === 'unknown_entity', 'free text is refused as before');
	const recorded = (await game.world()).mods.state['natural-npc'].dossier;
	assert.equal(recorded[`npc-${KNOTT}`].language.value, 'English, Italian and Latin');
	assert.equal(recorded[`npc-${DOOLEY}`].language.value, 'English');
});

test('§188.4: a say token names a person by the graph\'s anchored run, as every entrance reads one', async t => {
	const game = await worded(t);
	await game.call('table.narrate', {call_id: game.next(), text: [
		'{{say:Hall of Records clerk}}The files are closed.{{/say}}',
		`{{say:${WORD}}}Twenty dollars a day.{{/say}}`,
		'{{say:Steven Knott}}And the keys.{{/say}}',
		`{{say:${SHARED}}}Who knows.{{/say}}`,
		'{{say:a passing stranger}}Evening.{{/say}}'].join('\n')});
	const record = JSON.parse(await readFile(join(game.directory, 'turns/0001.json'), 'utf8'));
	assert.deepEqual(record.speech.map(entry => entry.who.npc ?? entry.who.label), ['records-clerk', KNOTT, KNOTT, SHARED, 'a passing stranger'],
		JSON.stringify(record.speech.map(entry => entry.who)));
});

test('§188.4: a clue label is filed under the clue its stored handle names, and two clues under one label are refused', async t => {
	const game = await table(t);
	const path = join(game.directory, 'world.json'), world = JSON.parse(await readFile(path, 'utf8'));
	// The same clue filed under its handle and under its node id (a key written before the handle it has now), and a label two
	// different clues carry.
	world.clue_labels = {'knott-keys': 'the brass keys', 'clue-knott-keys': 'the brass keys', 'knott-research-leads': 'the list', 'knott-commission': 'the list'};
	await writeFile(path, JSON.stringify(world));
	const look = name => game.call('table.look', {focus: 'object', name});
	const keys = await look('the brass keys');
	assert.deepEqual([keys.kind, keys.entity.name, keys.label], ['clue', 'knott-keys', 'the brass keys']);
	await rejects(look('the list'), error => error.code === 'unknown_entity' && error.details?.candidates?.length === 2, 'two clues under one label');
	await rejects(look('a torn ticket'), error => error.code === 'unknown_entity' && !error.details?.candidates, 'free text is refused as before');
});

/** Knott and Dooley in Knott's office, each with a stat block, so either can run in a chase. */
async function runners(t) {
	const game = await worded(t);
	await game.apply([{kind: 'npc', name: 'Mr. Dooley', to: 'here', why: 'he came about the papers'}]);
	await game.apply([{kind: 'person', who: 'Mr. Dooley', name: 'the paper seller'}]);
	for (const name of ['Steven Knott', 'Mr. Dooley'])
		await game.apply([{kind: 'npc', name, archetype: 'capable_adult', why: 'an ordinary grown man'}]);
	const resolve = action => game.call('table.resolve', {call_id: game.next(), action: {goal: 'get away', method: 'out the door', ...action}});
	const chase = async () => JSON.parse(await readFile(join(game.directory, 'save/chase.json'), 'utf8'));
	return {...game, resolve, chase};
}
const pursuers = saved => saved.participants.filter(entry => entry.side === 'pursuer').map(entry => entry.actor_id).sort();

test('§188.4: chase:start runs from the person action.target names, compared by identity', async t => {
	for (const [target, expected] of [['npc-steven-knott', [KNOTT]], ['npc-dooley', [DOOLEY]], ['a passing stranger', [DOOLEY, KNOTT]]]) {
		const game = await runners(t);
		await game.resolve({decision: 'chase:start', intent: 'flee', target});
		assert.deepEqual(pursuers(await game.chase()), expected, target);
	}
});

test('§188.4: a chase roster names its runners and a passenger\'s driver by any word for them', async t => {
	const me = 'thomas-hayes';
	for (const [actor, expected] of [[WORD, KNOTT], ['Steven Knott', KNOTT], [KNOTT, KNOTT], ['the paper seller', DOOLEY]]) {
		const game = await runners(t);
		await game.resolve({decision: 'chase:start', intent: 'flee', chase_roster: [{actor: me, role: 'foot'}, {actor, role: 'foot'}]});
		assert.deepEqual(pursuers(await game.chase()), [expected], actor);
	}
	const game = await runners(t);
	await rejects(game.resolve({decision: 'chase:start', intent: 'flee', chase_roster: [{actor: me, role: 'foot'}, {actor: SHARED, role: 'foot'}]}),
		twoOwners, 'a word two people carry is refused naming both');
	await rejects(game.resolve({decision: 'chase:start', intent: 'flee', chase_roster: [{actor: me, role: 'foot'}, {actor: 'a passing stranger', role: 'foot'}]}),
		error => error.details?.reason === 'chase_participant_unprepared', 'free text names nobody here, as before');
	// The passenger rides with the driver the roster lists by another word for him (the driver's Drive Auto pinned, so the
	// binding reaches the passengers); riding with someone the roster does not list as a driver is refused as before.
	const drive = async riding_with => {
		const fresh = await runners(t);
		await fresh.apply([{kind: 'npc', name: 'Steven Knott', skill: {name: 'Drive Auto', value: 40}, why: 'he drives his own truck'}]);
		const started = await fresh.resolve({decision: 'chase:start', intent: 'flee', chase_roster: [{actor: me, role: 'driver', vehicle: 'car_standard'},
			{actor: 'Steven Knott', role: 'driver', vehicle: 'pickup_truck'}, {actor: 'the paper seller', role: 'passenger', riding_with}]}).then(() => null, error => error);
		return started ? started.details?.reason ?? started.message : (await fresh.chase()).participants.find(entry => entry.actor_id === DOOLEY).vehicle_actor_id;
	};
	for (const riding_with of [WORD, KNOTT]) assert.equal(await drive(riding_with), KNOTT, riding_with);
	assert.equal(await drive('Mr. Dooley'), 'chase_passenger_driver_unprepared', 'a passenger cannot ride with himself');
	assert.equal(await drive('a passing stranger'), 'chase_passenger_driver_unprepared', 'nor with nobody');
});

test('§188.4: chase:conflict takes the caught opponent action.target names, compared by identity', async t => {
	for (const [target, caught] of [['npc-steven-knott', true], [WORD, true], ['Steven Knott', true], ['a passing stranger', false]]) {
		const game = await runners(t);
		await game.resolve({decision: 'chase:start', intent: 'move', target: 'Steven Knott', goal: 'run him down', method: 'after him'});
		// Caught: he stands where the investigator stands, and it is the investigator's move.
		const saved = await game.chase(), me = saved.participants.find(entry => entry.actor_id === 'thomas-hayes');
		saved.participants.find(entry => entry.actor_id === KNOTT).position = me.position;
		saved.rounds.at(-1).dex_order = ['thomas-hayes', KNOTT];
		await writeFile(join(game.directory, 'save/chase.json'), JSON.stringify(saved));
		const result = await game.resolve({decision: 'chase:conflict', intent: 'combat', target, goal: 'tackle him', method: 'dive at his legs'}).then(value => value, error => error);
		const refused = result instanceof Error && /needs the caught opponent/.test(result.message);
		assert.equal(refused, !caught, `${target}: ${result instanceof Error ? result.message : result.decision}`);
	}
});
