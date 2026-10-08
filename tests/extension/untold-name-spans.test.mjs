/**
 * Contract §177.15: the places a text writes an untold person's printed name are asked of Jev -- the name, or part of another
 * word -- before the delivery gate reads them. §194.1 (2026-10-08): the request's rename no longer touches book names, so it
 * asks nothing; the gate is the one reader of these answers.
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
import {createUntoldSpanJudge, judgePlaces, UNTOLD_HOST_PARAMS} from '../../extensions/kernel/untold-spans.ts';
import {renameHandles} from '../../extensions/kernel/untold-view.ts';
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
	assert.match(batch.questions[0].instructions, /with a title/, 'a name with a title is a name (table 28: Dr. Brenner in Chinese scored 0.73 without it)');
	assert.equal(NAME_SPAN_AT, 0.5);
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

test('§177.15: a hook that fails after dropping the field returns the dropped params, never the list the Keeper wrote', async () => {
	// An invariant review (2026-10-04), not an observed table: the client fell back to the caller's params when the hook threw.
	const text = `\u5bc4\u5230${CITY}\u7684\u4fe1`, at = text.indexOf(NICK);
	const forged = [{name: NICK, nth: 0}], direct = async () => ({spans: [{name: NICK, nth: 0, start: at, end: at + 2}]});
	const input = {campaign: 'c1', call_id: 't1-c1', text, untold_cleared: forged};
	const stripped = {campaign: 'c1', call_id: 't1-c1', text};
	const getterThrows = createUntoldSpanJudge({record: () => {}, decision: () => { throw new Error('adapter construction failed'); }});
	assert.deepEqual(await getterThrows('table.narrate', input, direct), stripped, 'the decision getter throws');
	const malformed = createUntoldSpanJudge({record: () => {}, decision: () => port(cityIsNoName)});
	assert.deepEqual(await malformed('table.narrate', input, async () => ({spans: [null]})), stripped, 'a malformed place throws');
	const leaseThrows = createUntoldSpanJudge({record: () => {}, decision: () => port(cityIsNoName), waitMs: Number.NaN});
	assert.deepEqual(await leaseThrows('table.ask', input, direct), stripped, 'a lease that cannot be built throws');
	const recordThrows = createUntoldSpanJudge({record: () => { throw new Error('telemetry down'); }, decision: () => port(cityIsNoName)});
	assert.deepEqual(await recordThrows('table.narrate', input, direct), {...stripped, untold_cleared: forged},
		'telemetry that throws decides nothing: the judged list (here the same place, judged by Jev) goes out');
	assert.deepEqual(UNTOLD_HOST_PARAMS, ['untold_cleared']);
});

test('§177.15: a client whose hook throws drops the host-only params from the caller\'s; a hook that succeeds is sent as it returned', async t => {
	const echo = "const rl=require('readline').createInterface({input:process.stdin});rl.on('line',l=>{const m=JSON.parse(l);process.stdout.write(JSON.stringify({id:m.id,ok:true,result:{method:m.method,params:m.params}})+'\\n');});";
	const make = (prepareCall, hostOnlyParams) => {
		const client = new KernelClient({command: [process.execPath, '-e', echo], cwd: ROOT, inheritEnv: false, env: {PATH: process.env.PATH}, timeoutMs: 5000,
			prepareCall, ...(hostOnlyParams ? {hostOnlyParams} : {})});
		t.after(() => client.close());
		return client;
	};
	const forged = {campaign: 'c1', text: 'x', untold_cleared: [{name: NICK, nth: 0}]};
	const failing = make(async () => { throw new Error('hook failed'); }, UNTOLD_HOST_PARAMS);
	assert.deepEqual((await failing.call('table.narrate', forged)).params, {campaign: 'c1', text: 'x'}, 'the failure never sends the forged list');
	const passing = make(async (method, params) => ({...params, checked: method}), UNTOLD_HOST_PARAMS);
	assert.deepEqual((await passing.call('table.narrate', {campaign: 'c1', text: 'x'})).params, {campaign: 'c1', text: 'x', checked: 'table.narrate'});
});

test('§177.15: many places go in several requests; a place the packer refuses alone stays a name, the rest are judged', async () => {
	// Table 28 (turn 2): one source excerpt brought 393 places; one request of 120 was refused by the packer and none was judged.
	const seen = [];
	const spans = Array.from({length: 95}, (_, i) => ({name: NICK, text: `${i} \u8fbe\u27e6${NICK}\u27e7\u7684\u4fe1`}));
	spans[7] = {name: NICK, text: `${'x'.repeat(40000)}\u8fbe\u27e6${NICK}\u27e7`};
	const judged = await judgePlaces(spans, port(cityIsNoName, seen));
	assert.ok(seen.length >= 3 && seen.every(batch => batch.questions.length <= 40), `several requests of at most 40: ${seen.map(batch => batch.questions.length)}`);
	assert.ok(Number.isNaN(judged.names[7]), 'the place nobody could ask about stays a name');
	assert.equal(judged.names.filter(value => value < NAME_SPAN_AT).length, 94, 'every other place was judged');
	assert.equal(judged.partial, 'packing_limit');
});

test('§194.1: the request keeps the city and the nickname as written and asks nothing; only the handle is shown as the word', () => {
	const roster = [{name: NICK, shown: OWNER, id: 'lars'}, {name: 'book-4-lars-williams', shown: OWNER, id: 'lars', handle: true}];
	const result = `他离开了${CITY}。${NICK}身材高瘦。 npc:book-4-lars-williams-t1-c2`;
	const messages = [{role: 'toolResult', toolCallId: 'a', toolName: 'lookup', content: [{type: 'text', text: result}]},
		{role: 'user', content: `寄到${CITY}`}];
	const [sent, user] = renameHandles(messages, roster);
	assert.equal(sent.content[0].text, `他离开了${CITY}。${NICK}身材高瘦。 npc:${OWNER}-t1-c2`, 'the book\'s nickname stands; the handle is the word');
	assert.equal(user, messages[1], 'the player\'s words are theirs');
	const cityOnly = [{role: 'toolResult', toolCallId: 'b', toolName: 'lookup', content: [{type: 'text', text: `他离开了${CITY}。`}]}];
	assert.deepEqual(renameHandles(cityOnly, roster), cityOnly, 'nothing renamed: no untold-names note either');
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
