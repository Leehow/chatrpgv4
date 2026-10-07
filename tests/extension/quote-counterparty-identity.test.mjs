/**
 * Contract §185.2 (amends §58.9): a saved quote is settled with the person who named it, compared as that person.
 *
 * A quote stores the counterparty as the Keeper wrote it (`with`) beside the resolved handle (`with_id`), and settling
 * compared the new `with` to the stored spelling. Naming the same person another way was refused: by the handle, by a new
 * word after `apply person`, or by the name once it has been said. Here, on the real kernel with The Haunting: each of
 * those settles; another person, and free text that does not match, are refused.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'quote-counterparty-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const DOOLEY = 'dooley', EPITHET = 'the paper seller';

async function table(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'quote-counterparty',
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
	await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	await call('table.open');
	assert.ok((await call('table.untold')).people.some(person => person.id === DOOLEY), 'Dooley is untold, under his handle');
	assert.deepEqual((await call('epithets.submit', {entries: [{id: DOOLEY, word: EPITHET}]})).refused, []);
	await call('table.narrate', {call_id: 't0-c1', text: 'The investigation begins.'});
	await call('table.player_input', {text: 'I buy a paper.'});
	let ordinal = 0;
	const apply = effects => call('table.apply', {call_id: `t1-c${++ordinal}`, effects});
	const quote = (name, who) => apply([{kind: 'cash', mode: 'quote', quote: name, category: 'purchase', source: 'quote', with: who,
		items: [{name: 'Newspaper', quantity: 1, unit_price: '0.05'}]}]);
	const settle = (name, who) => apply([{kind: 'cash', quote: name, with: who}]);
	const saved = async name => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8')).cash_quotes.find(row => row.name === name);
	return {call, apply, quote, settle, saved};
}
const refusedWith = error => error.code === 'invalid_params' && error.details?.field === 'with';

test('§185.2: a quote settles with its counterparty named by the handle, a new word or the told name', async t => {
	const game = await table(t);
	await t.test('registered by the book\'s name, settled by the handle', async () => {
		await game.quote('Morning paper', 'Mr. Dooley');
		assert.equal((await game.saved('Morning paper')).with_id, DOOLEY);
		await game.settle('Morning paper', DOOLEY);
		assert.ok((await game.saved('Morning paper')).settled);
	});
	await t.test('registered by the table\'s word, settled by the name once said', async () => {
		await game.quote('Evening paper', EPITHET);
		assert.equal((await game.saved('Evening paper')).with_id, DOOLEY, 'the word is read as the person when the quote is registered');
		await game.settle('Evening paper', 'Mr. Dooley');
		assert.ok((await game.saved('Evening paper')).settled);
	});
	await t.test('registered before apply person gives a new word, settled by that word', async () => {
		await game.quote('Late paper', 'Mr. Dooley');
		await game.apply([{kind: 'person', who: 'Mr. Dooley', name: 'the newsboy'}]);
		await game.settle('Late paper', 'the newsboy');
		assert.ok((await game.saved('Late paper')).settled);
	});
});

test('§185.2: another person, or free text that differs, does not settle a quote', async t => {
	const game = await table(t);
	await game.quote('Sunday paper', 'Mr. Dooley');
	await assert.rejects(game.settle('Sunday paper', 'Steven Knott'), refusedWith, 'someone else is refused');
	assert.equal((await game.saved('Sunday paper')).settled, null);
	await game.quote('Counter coffee', 'the counter clerk');
	assert.equal((await game.saved('Counter coffee')).with_id, 'the counter clerk', 'free text stays as written');
	await assert.rejects(game.settle('Counter coffee', 'Mr. Dooley'), refusedWith, 'a person against free text compares the spelling');
	await game.settle('Counter coffee', 'The Counter Clerk');
	assert.ok((await game.saved('Counter coffee')).settled, 'free text settles by its normalized spelling, as before');
});
