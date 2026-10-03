/**
 * Contract §103.1, on the real path: the kernel in process and the context hooks as installed.
 *
 * Installed App, Blood Road (2026-10-03): the Keeper named the gas station's owner on turn 2. Three ways the book's name
 * reached him or the player: the capsule the context hook sends is its own copy, not the persisted message the Keeper's
 * view was applied to; the clerk's note and tool results carry the book's names; and a say token resolved to the book's
 * name, which the transcript shows on hover and the kernel then counted as told.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'untold-request-suite-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export * from './extensions/table/context-runtime.ts';
export * from './extensions/table/workspace/workpad-store.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

test('§103.1: the request names an untold person by handle everywhere the host wrote, and a say token by handle tells nothing', async t => {
  const home = await mkdtemp(join(temporary, 'real-'));
  const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'untold-request',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  const knott = (await call('table.untold')).people.find(person => person.name === 'Steven Knott');
  assert.deepEqual(knott, {name: 'Steven Knott', id: 'steven-knott', shown: 'steven-knott'});

  const input = await call('table.player_input', {text: 'I ask Steven Knott what he wants.'});
  const rows = [], hooks = new Map(), bus = new Map();
  api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
    row => rows.push(row), () => api.workpadStoreRoot(home));
  bus.get('coc:kernel-bridge')({campaign: 'c1', call});
  bus.get('coc:capsule')({capsule: input.capsule, context: input._context});
  const messages = [
    {role: 'user', content: 'I ask Steven Knott what he wants.'},
    {role: 'custom', customType: 'coc-clerk', content: JSON.stringify({clerk_did: [{label: 'Initialize the authored presence of Steven Knott'}]}), display: false},
    {role: 'assistant', content: [{type: 'toolCall', id: 'look-1', name: 'look', arguments: {focus: 'npc', name: 'steven-knott'}}]},
    {role: 'toolResult', toolCallId: 'look-1', toolName: 'look', content: [{type: 'text', text: JSON.stringify({name: 'Steven Knott'})}]},
  ];
  const {messages: sent} = await hooks.get('context')({messages}, {model: {contextWindow: 1000000}});
  assert.ok(!sent.some(message => message.customType === 'coc-context-status'), JSON.stringify(rows.slice(-3)));
  const capsule = JSON.parse(sent.find(message => message.customType === 'coc-capsule').content);
  const row = capsule.present.find(person => person.untold?.name === 'Steven Knott');
  assert.ok(row, JSON.stringify(capsule.present));
  assert.equal(row.name, 'steven-knott', 'the capsule the hook itself sends carries the Keeper\'s view');
  const elsewhere = sent.filter(message => message.role !== 'user' && message.role !== 'assistant').map(message => JSON.stringify(message.content))
    .join('\n').replaceAll('\\"untold\\":{\\"name\\":\\"Steven Knott\\"', '');
  assert.ok(!elsewhere.includes('Steven Knott'), 'nothing the host wrote names him outside untold.name');
  assert.match(JSON.stringify(sent), /presence of steven-knott/, 'the clerk\'s note is renamed');
  assert.match(sent.find(message => message.role === 'toolResult').content[0].text, /"name":"steven-knott"/, 'and a tool result');
  assert.equal(sent.find(message => message.role === 'user').content, 'I ask Steven Knott what he wants.', 'the player\'s words are theirs');

  const byHandle = await call('table.narrate', {call_id: `t${input._context.turn}-c1`, text: 'The man behind the desk looks up. {{say:steven-knott}}"Sit down."{{/say}}'});
  assert.deepEqual(byHandle.speech?.[0]?.who, {npc: 'steven-knott', name: 'Steven Knott', shown: ''}, JSON.stringify(byHandle.speech));
  assert.ok((await call('table.untold')).people.some(person => person.id === 'steven-knott'), 'a token by handle shows nothing and tells nothing');

  const next = await call('table.player_input', {text: 'Who are you?'});
  const byName = await call('table.narrate', {call_id: `t${next._context.turn}-c1`, text: '{{say:Steven Knott}}"Steven Knott, of the commission."{{/say}}'});
  assert.deepEqual(byName.speech?.[0]?.who, {npc: 'steven-knott', name: 'Steven Knott'}, 'the book\'s name in a token is shown as it always was');
  assert.ok(!(await call('table.untold')).people.some(person => person.id === 'steven-knott'), 'and once shown it is told');
});
