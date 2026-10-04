/**
 * Contract §177.15: the places a text writes an untold person's printed name are asked of Jev -- the name, or part of another
 * word -- before the delivery gate reads them and before the request's rename rewrites them.
 *
 * Table 27 (App e634c3eb0, Blood Road, turn 8): the Keeper wrote Dallas in Chinese, whose last two characters are the station
 * owner's printed nickname. The gate refused it, quoting the name, which the request then renamed into the owner's word; the
 * second delivery replaced it, and the player read "a letter to Da-<the station owner>".
 */
import assert from 'node:assert/strict';
import {mkdtemp, symlink} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';
import {KernelClient} from '../../extensions/kernel/client.ts';
import {createUntoldSpanJudge} from '../../extensions/kernel/untold-spans.ts';
import {createRenameJudge} from '../../extensions/table/untold-rename-judge.ts';
import {renameUntold} from '../../extensions/kernel/untold-view.ts';
import {NAME_SPAN_AT, nameSpanBatch} from '../../runtime/jev/untold-name-spans.ts';
import {playtestScratch} from './playtest-scratch.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), CONTENT = join(ROOT, 'content');
const CITY = '达拉斯', NICK = '拉斯', OWNER = 'the station owner';

/** A decision port answering each place by `judge(markedText)`; every batch it saw is kept in `seen`. */
const port = (judge, seen = []) => ({async decide(batch) {
	seen.push(batch);
	const answers = Object.fromEntries(batch.questions.map(question => [question.key,
		{status: 'answered', type: 'noul', noul: judge(batch.state.items[question.target].text)}]));
	return {batchId: batch.id, status: 'complete', answers, coverage: {required: [], answered: [], unknown: []}, issues: []};
}});
const cityIsNoName = text => text.includes(`达⟦${NICK}⟧`) ? 0.05 : 0.95;

test('§177.15: the question names the marked span and its text; the bar is the measured one', () => {
	const batch = nameSpanBatch([{name: NICK, text: `寄到达⟦${NICK}⟧的信`}], 'c1');
	assert.equal(batch.family, 'untold-name-spans');
	assert.deepEqual(batch.state.items.s1, {text: `寄到达⟦${NICK}⟧的信`, marked: NICK});
	assert.equal(batch.questions[0].type, 'noul');
	assert.match(batch.questions[0].instructions, /piece of a longer word or of the name of a place/);
	assert.equal(NAME_SPAN_AT, 0.75);
});

test('§177.15: a delivery goes to the kernel with the places Jev judged part of another word cleared, and only those', async () => {
	const rows = [], seen = [], asked = [];
	const text = `你把要寄到${CITY}的信递过去。${NICK}说他今天不修车。`;
	const first = text.indexOf(NICK), second = text.lastIndexOf(NICK);
	const spans = [{name: NICK, nth: 0, start: first, end: first + 2}, {name: NICK, nth: 1, start: second, end: second + 2}];
	const direct = async (method, params) => { asked.push([method, params.text, params.campaign]); return {spans}; };
	const judge = createUntoldSpanJudge({record: row => rows.push(row), decision: () => port(cityIsNoName, seen)});
	const sent = await judge('table.narrate', {campaign: 'c1', call_id: 't1-c1', text, untold_cleared: [{name: NICK, nth: 1}]}, direct);
	assert.deepEqual(asked, [['table.untold_spans', text, 'c1']], 'the kernel is asked where the places are');
	assert.deepEqual(sent.untold_cleared, [{name: NICK, nth: 0}], 'the city is cleared; the list the Keeper sent is dropped');
	assert.equal(seen[0].questions.length, 2, 'one question per place, in one request');
	assert.deepEqual([rows.at(-1).lane, rows.at(-1).event, rows.at(-1).places, rows.at(-1).cleared], ['untold-spans', 'judged', 2, 1]);

	const names = await createUntoldSpanJudge({record: () => {}, decision: () => port(() => 0.9)})('table.ask', {campaign: 'c1', text, untold_cleared: [{name: NICK, nth: 0}]}, direct);
	assert.equal('untold_cleared' in names, false, 'every place a name: nothing cleared, and nothing the Keeper sent survives');
	const off = await createUntoldSpanJudge({record: row => rows.push(row), decision: () => undefined})('table.narrate', {campaign: 'c1', text, untold_cleared: [{name: NICK, nth: 0}]}, direct);
	assert.equal('untold_cleared' in off, false, 'no Jev: the gate stands as before');
	assert.deepEqual([rows.at(-1).event, rows.at(-1).reason], ['fallback', 'unconfigured']);
	const quiet = await judge('table.narrate', {campaign: 'c1', text: 'no names here'}, async () => ({spans: []}));
	assert.deepEqual(quiet, {campaign: 'c1', text: 'no names here'}, 'no place: no question');
	const apply = {campaign: 'c1', effects: [], untold_cleared: [{name: NICK, nth: 0}]};
	assert.equal(await judge('table.apply', apply, direct), apply, 'only the delivering methods are read');
});

test('§177.15: the request keeps a place Jev judges part of another word, renames the name and every handle, and decides each place once', async () => {
	const seen = [];
	const roster = [{name: NICK, shown: OWNER, id: 'lars'}, {name: 'book-4-lars-williams', shown: OWNER, id: 'lars', handle: true}];
	const judge = createRenameJudge({record: () => {}, decision: () => port(cityIsNoName, seen)});
	const result = `他离开了${CITY}。${NICK}身材高瘦。 npc:book-4-lars-williams-t1-c2`;
	const messages = [{role: 'toolResult', toolCallId: 'a', toolName: 'lookup', content: [{type: 'text', text: result}]},
		{role: 'user', content: `寄到${CITY}`}];
	await judge.prepare(messages, roster);
	const [sent, user] = renameUntold(messages, roster, judge.keep);
	const text = sent.content.map(part => part.text).join('\n');
	assert.ok(text.includes(`离开了${CITY}。${OWNER}身材`), `the city stands, the name is renamed: ${text}`);
	assert.ok(text.includes(`npc:${OWNER}-t1-c2`), 'a handle is renamed wherever it stands');
	assert.equal(seen.length, 1);
	assert.equal(seen[0].questions.length, 2, 'the handle is never asked about');
	assert.equal(user.content, `寄到${CITY}`, 'the player\'s words are theirs');
	await judge.prepare(messages, roster);
	assert.equal(seen.length, 1, 'a place decided once is not asked again, so the request stays the same');

	const cityOnly = [{role: 'toolResult', toolCallId: 'b', toolName: 'lookup', content: [{type: 'text', text: `他离开了${CITY}。`}]}];
	await judge.prepare(cityOnly, roster);
	assert.deepEqual(renameUntold(cityOnly, roster, judge.keep), cityOnly, 'nothing renamed: no untold-names note either');

	const down = createRenameJudge({record: () => {}, decision: () => ({async decide(batch) {
		return {batchId: batch.id, status: 'unavailable', answers: {}, coverage: {required: [], answered: [], unknown: []}, issues: [], failure: {code: 'service_error', retryable: true}};
	}})});
	await down.prepare(messages, roster);
	assert.ok(renameUntold(messages, roster, down.keep)[0].content[0].text.includes(`离开了达${OWNER}`), 'without an answer every place is renamed, as before');
});

test('§177.15: the client runs the host hook inside its queue, and the hook reaches the kernel past it', async t => {
	const suite = playtestScratch('untold-name-spans'), temporary = await mkdtemp(join(suite, 'case-')), rpc = join(temporary, 'rpc.mjs');
	await symlink(join(ROOT, 'node_modules'), join(temporary, 'node_modules'), 'dir');
	await build({entryPoints: [join(ROOT, 'kernel-ts/rpc.ts')], outfile: rpc, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
	const home = await mkdtemp(join(temporary, 'workspace-')), seen = [];
	const env = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
	const client = new KernelClient({command: [process.execPath, rpc, '--workspace', home, '--content', CONTENT], cwd: ROOT, env, inheritEnv: false, timeoutMs: 20_000,
		prepareCall: async (method, params, direct) => {
			if (method !== 'table.narrate') return params;
			seen.push(await direct('table.untold_spans', {campaign: params.campaign, text: params.text}));
			return {...params, text: `${params.text} (checked)`};
		}});
	t.after(() => client.close());
	await client.call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	await client.call('table.open', {campaign: 'c1'});
	const done = await client.call('table.narrate', {campaign: 'c1', call_id: 't0-c1', text: 'The investigation begins.'});
	assert.deepEqual(seen, [{spans: []}], 'an authored module has no printed names to place');
	assert.equal(done.rendered_text, 'The investigation begins. (checked)', 'the call went out with the hook\'s params');
});
