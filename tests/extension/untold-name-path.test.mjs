/**
 * Contract §176.8, on the real path: the kernel in process and the context hooks as installed.
 *
 * Replay of the App table game-24bb66cb (Blood Road, 2026-10-04, four sequences, grok-build/grok-4.5 low): on turn 5 the
 * player asked the navy veteran his name. present[]'s budget had cut him, the third man under the awning, to
 * `{name, truncated}`; the stub had no untold block, so the Keeper's view gave him no `say_name`, while the request rename
 * still replaced his name with his epithet. Three Keepers made a name up, one deflected. On turn 7 the bartender's row was
 * whole and carried the token, and three of four copied it. Here: a crowded room on the voice bench, a cut person's stub
 * carrying the token into the Keeper's request, and the copied token saying the book's name.
 *
 * §194.1 (owner ruling 2026-10-08, two ledgers): the request no longer renames book names. The excerpt reaches the Keeper with
 * the man's name as the book prints it, no note, and the stub carries `book_name` beside his word.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'untold-name-path-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {fitPresent} from './kernel-ts/read/assemble.ts';
export {UNTOLD_VIEW_USE} from './extensions/kernel/untold-view.ts';
export * from './extensions/table/context-runtime.ts';
export * from './extensions/table/workspace/workpad-store.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

/** The voice bench: nine people in one teahouse, nobody named yet. */
async function bench(t) {
  const home = await mkdtemp(join(temporary, 'real-'));
  const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'untold-name-path',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'voice-bench', pregen: 'shen-zhiwei', play_language: 'zh-Hans'});
  await call('table.open');
  return {call, home};
}

/** A word for each person, through the epithet lane's own submit: one that carries nobody's name. */
async function worded(call) {
  const job = await call('epithets.job');
  const entries = job.people.map((person, at) => ({id: person.id, word: `第${at + 1}张桌边的客人`}));
  const answer = await call('epithets.submit', {entries});
  assert.deepEqual(answer.refused, [], JSON.stringify(answer.refused));
  return new Map(entries.map(entry => [entry.id, entry.word]));
}

test('§176.8: a person the budget cuts keeps the name path, through the Keeper\'s request and back to the book\'s name', async t => {
  const {call, home} = await bench(t);
  const words = await worded(call);
  await call('table.narrate', {call_id: 't0-c1', text: '雨夜。三义茶馆里坐满了人。'});
  const input = await call('table.player_input', {text: '我找个空位坐下，先看看屋里都有谁。'});
  const present = input.capsule.present;
  const stubs = present.filter(person => person.truncated);
  assert.ok(stubs.length && present.length === 9, JSON.stringify(present.map(person => person.name)));
  const roster = (await call('table.untold')).people;
  const handleOf = name => roster.find(person => person.name === name)?.id;
  for (const stub of stubs) {
    const word = words.get(handleOf(stub.name));
    assert.ok(word, stub.name);
    assert.deepEqual(stub, {name: stub.name, activity: {current: false, review_required: true, review_reasons: ['unassessed']}, truncated: true, untold: {label: word, id: handleOf(stub.name), say_name: `{{name:${word}}}`}},
      'a stub keeps who is untold and the token that says their name, without the line');
  }
  for (const person of present.filter(person => !person.truncated))
    assert.equal(person.untold.say_name, `{{name:${person.untold.label}}}`, 'a whole row carries the same token from the kernel');
  const cut = stubs[0], word = cut.untold.label;
  assert.equal((await call('table.look', {focus: 'npc', name: word})).untold.say_name, cut.untold.say_name, 'look by the word carries it too');

  // The Keeper's request, through the installed context hook: the stub by its word, with the token and the line.
  const hooks = new Map(), bus = new Map();
  api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
    () => {}, () => api.workpadStoreRoot(home));
  bus.get('coc:kernel-bridge')({campaign: 'c1', call});
  bus.get('coc:capsule')({capsule: input.capsule, context: input._context});
  // U3, turn 5: the Keeper looked the name up in the book; the excerpt came back with it renamed and nothing else. Now (§194.1)
  // it comes back as the book wrote it.
  const excerpt = `[Original page 3] ${cut.name}坐在窗边，一言不发。`;
  const {messages: sent} = await hooks.get('context')({messages: [{role: 'user', content: '我找个空位坐下，先看看屋里都有谁。'},
    {role: 'assistant', content: [{type: 'toolCall', id: 'lookup-1', name: 'lookup', arguments: {kind: 'source', query: word}}]},
    {role: 'toolResult', toolCallId: 'lookup-1', toolName: 'lookup', content: [{type: 'text', text: JSON.stringify({answer: excerpt})}]}]},
    {model: {contextWindow: 1000000}});
  const result = sent.find(message => message.role === 'toolResult');
  assert.deepEqual(result.content, [{type: 'text', text: JSON.stringify({answer: excerpt})}], 'the excerpt as the book wrote it, no note');
  const capsule = JSON.parse(sent.find(message => message.customType === 'coc-capsule').content);
  const shown = capsule.present.find(person => person.name === word);
  assert.deepEqual(shown, {name: word, book_name: cut.name, activity: {current: false, review_required: true, review_reasons: ['unassessed']}, truncated: true, untold: {label: word, say_name: `{{name:${word}}}`, use: api.UNTOLD_VIEW_USE}},
    JSON.stringify(capsule.present));

  // Copied where the fiction has him say it, the token says the book's name, and from then on he is told.
  const said = await call('table.narrate', {call_id: `t${input._context.turn}-c1`,
    text: `他抬起头。{{say:${word}}}「我叫${shown.untold.say_name}。」{{/say}}`});
  assert.match(said.rendered_text, new RegExp(`我叫${cut.name}。`));
  const next = await call('table.player_input', {text: '我点点头。'});
  const again = next.capsule.present.find(person => person.name === cut.name);
  assert.ok(again && !again.untold, JSON.stringify(again));
  assert.ok(!(await call('table.untold')).people.some(person => person.id === handleOf(cut.name)), 'off the rename roster');
});

test('§176.8: a stub of someone told stays bare', async t => {
  const {call} = await bench(t);
  await worded(call);
  const names = (await call('table.look', {focus: 'npc'})).present.map(person => person.name);
  assert.equal(names.length, 9);
  await call('table.narrate', {call_id: 't0-c1', text: `雨夜。${names.join('、')}都在三义茶馆里。`});
  const input = await call('table.player_input', {text: '我找个空位坐下。'});
  const stubs = input.capsule.present.filter(person => person.truncated);
  assert.ok(stubs.length, JSON.stringify(input.capsule.present.map(person => person.name)));
  for (const stub of stubs) assert.deepEqual(stub, {name: stub.name, activity: {current: false, review_required: true, review_reasons: ['unassessed']}, truncated: true}, 'temporal status stays; nobody untold, no name path to keep');
});

test('§176.8: the people cut are found by position, so two people the book gives one name both keep a row', () => {
  const big = 'x'.repeat(900);
  const rows = [
    {name: '罗伯特·泰勒', role: big, untold: {label: '留铅笔胡的酒吧老板', id: 'book-4-robert-taylor', say_name: '{{name:留铅笔胡的酒吧老板}}', use: 'line'}},
    {name: '卡洛斯·加尔萨', role: big},
    {name: '罗伯特·泰勒', role: big, untold: {label: '寄钱养侄的屠夫', id: 'book-4-r-taylor', say_name: '{{name:寄钱养侄的屠夫}}', use: 'line'}},
  ];
  assert.equal(api.fitPresent(rows, 2400), true);
  assert.equal(rows.length, 3, JSON.stringify(rows));
  assert.deepEqual(rows.at(-1), {name: '罗伯特·泰勒', truncated: true,
    untold: {label: '寄钱养侄的屠夫', id: 'book-4-r-taylor', say_name: '{{name:寄钱养侄的屠夫}}'}});
  assert.equal(rows[0].role, big, 'the rows that fit stay whole');
});
