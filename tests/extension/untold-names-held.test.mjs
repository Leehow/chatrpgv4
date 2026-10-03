/**
 * Contract §103.8 (owner, 2026-10-03): the Keeper does not hold the name of a person nobody has named to the investigator.
 *
 * Table 20 of the installed App (Blood Road): the Keeper's capsule carried each untold person's book name in `untold.name`,
 * and the trucker's biography (a look result) mentioned the owner by his alias "拉斯", which the request's rename did not
 * cover. In one step without thinking the Keeper wrote "史蒂夫·布朗" and "拉斯·威廉姆斯" as epithets, and the prose then
 * said "史蒂夫" and "拉斯". Here: the roster carries every book name, aliases too; the Keeper's copy carries none; an epithet
 * carrying one, or a piece of one, is refused; and `{{name:<who>}}` puts the book's name into a delivery, which tells it.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'untold-names-held-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {ModuleGraph} from './kernel-ts/read/module-graph.ts';
export {untoldRoster} from './kernel-ts/read/capsule.ts';
export {bookNames, namePieces} from './kernel-ts/journal/naming.ts';
export * from './extensions/table/context-runtime.ts';
export * from './extensions/table/workspace/workpad-store.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const people = () => new api.ModuleGraph('names', {nodes: [
	{node_id: 'npc-lars', node_kind: 'npc', name: '拉塞尔·威廉姆斯', aliases: ['拉斯', '拉索']},
	{node_id: 'npc-mary', node_kind: 'npc', name: '玛丽·威廉姆斯', aliases: ['拉索']},
]}, '', {});

test('§103.8: every name the book gives a person, aliases too, and the pieces a name separates with punctuation', () => {
	const graph = people(), lars = graph.find('拉塞尔·威廉姆斯', ['npc']);
	assert.deepEqual(api.bookNames(graph, lars), ['拉塞尔·威廉姆斯', '拉斯', '拉索']);
	assert.ok(!api.bookNames(graph, lars).includes(graph.handle(lars)), 'a handle is not a name');
	assert.deepEqual(new Set(api.namePieces(['拉塞尔·威廉姆斯'])), new Set(['拉塞尔·威廉姆斯', '拉塞尔', '威廉姆斯']));
	assert.deepEqual(api.namePieces(['Mr. Dooley']), ['Mr. Dooley', 'Mr', 'Dooley']);
	assert.deepEqual(api.namePieces(['Steven Knott']), ['Steven Knott'], 'a space is not punctuation: no piece is cut from it');
});

test('§103.8: the roster carries every untold name, and leaves a name someone told also goes by with them', () => {
	const graph = people();
	const roster = api.untoldRoster(graph, {}, {entries: {'npc-mary': {named_at: 2}}}, []);
	assert.deepEqual(roster.map(row => row.name), ['拉塞尔·威廉姆斯', '拉斯'], 'Mary is told, so 拉索, hers too, is not hidden');
	assert.ok(roster.every(row => row.shown === row.id), 'with no epithet yet, the handle stands in');
});

test('§103.8: the Keeper holds no book name; an epithet carrying one is refused; {{name:…}} says it and tells it', async t => {
	const home = await mkdtemp(join(temporary, 'real-'));
	const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'untold-names-held',
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
	await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	await call('table.open');
	const untold = async () => (await call('table.untold')).people;
	const knott = (await untold()).find(person => person.name === 'Steven Knott');
	const dooley = (await untold()).find(person => person.name === 'Mr. Dooley');
	assert.ok(knott && dooley, JSON.stringify(await untold()));

	const input = await call('table.player_input', {text: 'I ask the man at the desk what he wants.'});
	const rows = [], hooks = new Map(), bus = new Map();
	api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
		row => rows.push(row), () => api.workpadStoreRoot(home));
	bus.get('coc:kernel-bridge')({campaign: 'c1', call});
	bus.get('coc:capsule')({capsule: input.capsule, context: input._context});
	const messages = [{role: 'user', content: 'I ask the man at the desk what he wants.'},
		{role: 'custom', customType: 'coc-clerk', content: JSON.stringify({note: 'Steven Knott waits; Mr. Dooley sells papers.'}), display: false}];
	const {messages: sent} = await hooks.get('context')({messages}, {model: {contextWindow: 1000000}});
	const written = sent.filter(message => message.role !== 'user').map(message => JSON.stringify(message.content)).join('\n');
	assert.ok(!written.includes('Steven Knott') && !written.includes('Mr. Dooley'), 'no book name anywhere the host wrote, untold.name included');
	const capsule = JSON.parse(sent.find(message => message.customType === 'coc-capsule').content);
	const row = capsule.present.find(person => person.untold && person.name === knott.id);
	if (row) assert.equal('name' in row.untold, false, 'the untold block keeps no seat for the name');

	// The refusal repeats the Keeper's own word and names no book name the word did not already carry.
	const refused = async (who, name, book, k) => assert.rejects(call('table.apply', {call_id: `t${input._context.turn}-c${k}`, effects: [{kind: 'person', who, name}]}),
		error => error?.details?.reason === 'untold_name' && (name.includes(book) || !String(error.message + JSON.stringify(error.details)).includes(book)),
		`${name} carries a book name`);
	await refused(knott.id, "Steven Knott's clerk", 'Steven Knott', 1);
	await refused(dooley.id, 'old Dooley', 'Mr. Dooley', 2);
	await call('table.apply', {call_id: `t${input._context.turn}-c3`, effects: [{kind: 'person', who: knott.id, name: 'the ink-stained clerk'}]});

	const delivered = await call('table.narrate', {call_id: `t${input._context.turn}-c4`,
		text: 'He looks up. {{say:the ink-stained clerk}}"I am {{name:the ink-stained clerk}}, of the commission."{{/say}}'});
	assert.match(delivered.rendered_text, /I am Steven Knott, of the commission/);
	assert.ok(!delivered.rendered_text.includes('{{') && !String(delivered.marked_text ?? '').includes('{{name'));
	assert.equal(delivered.unresolved_names, undefined);
	assert.ok(!(await untold()).some(person => person.id === knott.id), 'said in the delivery, he is told');

	const next = await call('table.player_input', {text: 'And who sells the papers?'});
	const unknown = await call('table.narrate', {call_id: `t${next._context.turn}-c1`, text: 'Nobody answers. {{name:nobody-at-all}} is not a name here.'});
	assert.deepEqual(unknown.unresolved_names, ['nobody-at-all']);
	assert.match(unknown.rendered_text, /nobody-at-all is not a name here/);

	const third = await call('table.player_input', {text: 'I call him by his name.'});
	await call('table.apply', {call_id: `t${third._context.turn}-c1`, effects: [{kind: 'person', who: knott.id, name: 'Steven Knott'}]});
});
