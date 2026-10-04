/**
 * Contract §176 (owner ruling 2026-10-04 on docs/specs/graph-epithets.md): every book person has the table's word before the
 * table meets them, the kernel checks it, and every tool resolves it.
 *
 * Table 21 (the installed App, Blood Road, 2026-10-03): the Keeper never gave the three men at the gas station a word; the
 * journal lane's labels moved between them; the word the Keeper was shown did not resolve as `who` (five of six refusals);
 * and asked a name, a Keeper holding only the handle made one up from it. Here, on the real kernel with The Haunting: the
 * epithet lane's job, every refusal, the fold at the turn's start, resolution by `apply person` and say tokens, the journal's
 * label becoming a word (spec Q3), and the roster renaming the handle (spec Q2).
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'graph-epithets-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

async function haunting(t) {
	const home = await mkdtemp(join(temporary, 'real-'));
	const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'graph-epithets',
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
	await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	await call('table.open');
	const world = async () => JSON.parse(await readFile(join(home, '.coc', 'campaigns', 'c1', 'world.json'), 'utf8'));
	const roster = (await call('table.untold')).people, idOf = name => roster.find(person => person.name === name)?.id;
	return {call, world, home, knott: idOf('Steven Knott'), dooley: idOf('Mr. Dooley')};
}
const reasonOf = (answer, id) => answer.refused.find(row => row.id === id)?.reason;

test('§176.3: the job lists every untold book person without a word, with what a stranger sees; submit checks each word on its own', async t => {
	const {call, world, home, knott: knottId, dooley: dooleyId} = await haunting(t);
	const job = await call('epithets.job');
	assert.match(job.job_id, /^epithets:c1:/);
	assert.equal(job.play_language, 'en');
	assert.match(job.instruction, /play language en/, 'the instruction names the language the word is written in');
	const knott = job.people.find(person => person.id === knottId), dooley = job.people.find(person => person.id === dooleyId);
	assert.ok(knott && dooley, JSON.stringify(job.people.map(person => person.id)));
	assert.ok(job.people.every(person => !('secret' in person) && !('agenda' in person) && !('fear' in person)), 'nothing but id, role and looks');
	assert.deepEqual(job.taken, []);
	const others = job.people.filter(person => person.id !== knott.id && person.id !== dooley.id);

	const first = await call('epithets.submit', {entries: [
		{id: knott.id, word: "Steven Knott's clerk"},
		{id: dooley.id, word: knott.id},
		{id: 'corbitt-house-ghost-nobody', word: 'the wind'},
		{id: others[0].id, word: 'the man who drinks with Dooley'},
		{id: others[1].id, word: 'two\nlines'},
	]});
	assert.deepEqual(first.written, []);
	assert.equal(reasonOf(first, knott.id), 'untold_name', 'his own name');
	assert.equal(reasonOf(first, dooley.id), 'handle');
	assert.equal(reasonOf(first, 'corbitt-house-ghost-nobody'), 'unknown_entity');
	assert.equal(reasonOf(first, others[0].id), 'untold_name', "another untold person's name is refused too: it would tell his name");
	assert.equal(reasonOf(first, others[1].id), 'shape');

	const second = await call('epithets.submit', {entries: [{id: knott.id, word: 'the ink-stained clerk'}, {id: dooley.id, word: 'The Ink-Stained Clerk'}]});
	assert.deepEqual(second.written, [{id: knott.id, word: 'the ink-stained clerk'}]);
	assert.equal(reasonOf(second, dooley.id), 'taken', 'two people under one word cannot be told apart, the batch included');
	assert.equal(reasonOf(await call('epithets.submit', {entries: [{id: knott.id, word: 'the quiet lawyer'}]}), knott.id), 'settled');
	const stored = JSON.parse(await readFile(join(home, '.coc', 'campaigns', 'c1', 'epithets.json'), 'utf8'));
	assert.equal(stored.people[knott.id].word, 'the ink-stained clerk');
	assert.ok(!(await call('epithets.job')).people.some(person => person.id === knott.id), 'a worded person is not asked for again');
	assert.deepEqual((await call('epithets.job')).taken, ['the ink-stained clerk']);
	assert.equal((await world()).person_epithets, undefined, 'the lane never writes the world itself (§176.1)');
});

test('§176.1/§176.2: the word reaches the world at the turn\'s start, the capsule shows it, and every tool resolves it', async t => {
	const {call, world, knott} = await haunting(t);
	await call('epithets.submit', {entries: [{id: knott, word: 'the ink-stained clerk'}]});
	const input = await call('table.player_input', {text: 'I ask the man at the desk what he wants.'});
	assert.deepEqual((await world()).person_epithets[knott].word, 'the ink-stained clerk');
	assert.equal((await world()).person_epithets[knott].by, 'graph');
	const row = input.capsule.present?.find(person => person.untold?.id === knott);
	if (row) assert.equal(row.untold.label, 'the ink-stained clerk', 'the capsule shows the word from the first turn');
	assert.equal((await world()).person_labels?.[knott], undefined, 'an epithet is not a meeting: person_labels is untouched');

	// §176.5: the roster renames the handle and the node id to the word, so neither reaches the Keeper.
	const roster = (await call('table.untold')).people.filter(person => person.id === knott);
	assert.ok(roster.every(person => person.shown === 'the ink-stained clerk'));
	assert.ok(roster.some(person => person.name === knott) && roster.some(person => person.name === `npc-${knott}`), JSON.stringify(roster));

	// Every junction takes the word: apply person, a say token, and the name token.
	const applied = await call('table.apply', {call_id: `t${input._context.turn}-c1`, effects: [{kind: 'person', who: 'the ink-stained clerk', address: 'sir'}]});
	assert.equal(applied.receipts.length, 1);
	assert.equal((await world()).person_labels[knott].address, 'sir', 'the word resolved to him');
	const delivered = await call('table.narrate', {call_id: `t${input._context.turn}-c2`,
		text: 'He looks up. {{say:the ink-stained clerk}}"I am {{name:the ink-stained clerk}}, of the commission."{{/say}}'});
	assert.match(delivered.rendered_text, /I am Steven Knott, of the commission/);
	assert.equal(delivered.unresolved_names, undefined);
});

test('§176.3: an epithet may carry no piece of any untold name, through apply person as well', async t => {
	const {call, knott, dooley} = await haunting(t);
	const input = await call('table.player_input', {text: 'I look around the office.'});
	await assert.rejects(call('table.apply', {call_id: `t${input._context.turn}-c1`, effects: [{kind: 'person', who: knott, name: 'the man who knows Dooley'}]}),
		error => error?.details?.reason === 'untold_name', "Dooley's name in Knott's word tells Dooley's name");
	await call('table.apply', {call_id: `t${input._context.turn}-c2`, effects: [{kind: 'person', who: dooley, name: 'the newsboy'}]});
	const answer = await call('epithets.submit', {entries: [{id: knott, word: 'The Newsboy'}, {id: dooley, word: 'the paper seller'}]});
	assert.equal(reasonOf(answer, knott), 'taken', 'a word the fiction gave Dooley is taken for the lane too');
	assert.equal(reasonOf(answer, dooley), 'settled', 'a person the fiction already gave a word is not worded again');
	assert.ok(!(await call('epithets.job')).people.some(person => person.id === dooley));
});

test('§176.4 (spec Q3): the journal\'s label for someone without a word is folded in and resolves; a graph epithet replaces it', async t => {
	const {call, world, dooley} = await haunting(t);
	const first = await call('table.player_input', {text: 'Who sells the papers?'});
	await call('table.narrate', {call_id: `t${first._context.turn}-c1`, text: `A boy calls from the street: {{say:${dooley}}}"Papers!"{{/say}}`});
	const job = await call('journal.job', {turn: first._context.turn});
	assert.ok(job.recordable.includes('Mr. Dooley'), JSON.stringify(job.recordable));
	await call('journal.submit', {job_id: job.job_id, entries: [{name: 'Mr. Dooley', label: 'the newsboy with the ink-black cap'}]});
	const second = await call('table.player_input', {text: 'I wave the newsboy over.'});
	assert.deepEqual([(await world()).person_epithets[dooley].word, (await world()).person_epithets[dooley].by], ['the newsboy with the ink-black cap', 'journal']);
	await call('table.apply', {call_id: `t${second._context.turn}-c1`, effects: [{kind: 'person', who: 'the newsboy with the ink-black cap', address: 'kid'}]});
	assert.equal((await world()).person_labels[dooley].address, 'kid', 'the word the Keeper is shown resolves');
	await call('table.narrate', {call_id: `t${second._context.turn}-c2`, text: 'He trots over.'});
	await call('epithets.submit', {entries: [{id: dooley, word: 'the paper seller'}]});
	await call('table.player_input', {text: 'I buy a paper.'});
	assert.deepEqual([(await world()).person_epithets[dooley].word, (await world()).person_epithets[dooley].by], ['the paper seller', 'graph']);
});
