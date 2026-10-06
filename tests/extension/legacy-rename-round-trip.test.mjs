/**
 * Contract §185.2 and §185.3 (owner ruling 2026-10-06, docs/specs/name-free-handles.md), on the real path: the kernel in
 * process and the context hooks as installed.
 *
 * In a legacy campaign a book person's handle is their name as a slug, and the request's rename (§176.5) puts their word
 * wherever that string stands -- inside every handle it begins as well. On book-4 as the App held it, nine handles began
 * with a person's handle; `intent:<handle>:<digest>` on a card came back `intent:<word>:<digest>` and was refused as
 * someone else's, and `<handle>-home` came back `<word>-home` and resolved to nothing.
 *
 * Here the rulebook Haunting, with a house and a ledger whose handles begin with Steven Knott's, Knott worded by the
 * epithet lane, and an intention of his on the card. The Keeper's assembled request is taken as the hooks build it, and
 * the renamed intention reference, scene handle and clue handle are copied from it into tool calls.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'legacy-rename-round-trip-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export * from './extensions/table/context-runtime.ts';
export * from './extensions/table/workspace/workpad-store.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

// The repository's content, with one more starter: the rulebook Haunting plus Knott's house and his rent ledger.
const content = join(temporary, 'content');
await mkdir(join(content, 'starters'), {recursive: true});
for (const name of await readdir(join(root, 'content'))) if (name !== 'starters') await symlink(join(root, 'content', name), join(content, name));
for (const name of await readdir(join(root, 'content/starters'))) await symlink(join(root, 'content/starters', name), join(content, 'starters', name));
const MODULE = 'rename-fixture', KNOTT = 'steven-knott', HOUSE = 'steven-knott-house', LEDGER = 'steven-knott-ledger';
await cp(join(root, 'content/starters/the-haunting-rulebook'), join(content, 'starters', MODULE), {recursive: true});
await cp(join(root, 'content/starters/the-haunting/pregens'), join(content, 'starters', MODULE, 'pregens'), {recursive: true});
{
  const path = join(content, 'starters', MODULE, 'module-graph.json'), graph = JSON.parse(await readFile(path, 'utf8'));
  graph.module_id = MODULE;
  const hall = graph.nodes.find(node => node.node_id === 'scene-hall-of-records'), clue = graph.nodes.find(node => node.node_kind === 'clue');
  assert.ok(graph.nodes.some(node => node.node_id === `npc-${KNOTT}`) && hall && clue);
  graph.nodes.push({...structuredClone(hall), node_id: `scene-${HOUSE}`, name: "Knott's house", aliases: [], summary: "Knott's narrow brick house.",
    properties: {runtime_projection: {document: 'story-graph.json', collection: 'scenes', record: {scene_id: HOUSE, display_name: "Knott's house", is_start: false, is_final: false}}}});
  graph.nodes.push({...structuredClone(clue), node_id: `clue-${LEDGER}`, name: "Knott's rent ledger", aliases: [], summary: 'The rents Knott took from the house, year by year.'});
  graph.relations.push(
    {relation_id: 'rel-intro-to-house', relation_kind: 'may-lead-to', from_node_id: 'scene-introduction', to_node_id: `scene-${HOUSE}`, claim_id: null, properties: {}},
    {relation_id: 'rel-ledger-at-intro', relation_kind: 'discoverable-at', from_node_id: `clue-${LEDGER}`, to_node_id: 'scene-introduction', claim_id: null, properties: {}});
  await writeFile(path, JSON.stringify(graph));
}

const WORD = '戴圆眼镜的房东', LINE = 'Get the visitor to sign for the keys before dark.';

async function table(t) {
  const home = await mkdtemp(join(temporary, 'home-'));
  const kernel = await api.createKernelContext({workspace: home, content, seed: 'legacy-rename-round-trip',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: MODULE, pregen: 'thomas-hayes', play_language: 'zh-Hans'});
  await call('table.open');
  const worded = await call('epithets.submit', {entries: [{id: KNOTT, word: WORD}]});
  assert.deepEqual(worded.refused, [], JSON.stringify(worded.refused));
  await call('table.narrate', {call_id: 't0-c1', text: '雨停了。委托人在办公室里等你。'});
  await call('table.player_input', {text: '我走进办公室。'});
  await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'npc', name: WORD, intends: LINE, outcome: 'attempted'}]});
  await call('table.narrate', {call_id: 't1-c9', text: '他把钥匙推过桌面。'});
  const input = await call('table.player_input', {text: '我看看桌上有什么。'});
  const receipts = async () => (await call('table.status')).receipts;
  const ledger = async () => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/npc-ledger.json'), 'utf8'))[`npc-${KNOTT}`];
  return {call, home, input, receipts, ledger};
}

/** The Keeper's request as the installed context hook assembles it: the capsule, and the scene the Keeper looked at. */
async function keeperRequest(game) {
  const hooks = new Map(), bus = new Map();
  api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
    () => {}, () => api.workpadStoreRoot(game.home));
  bus.get('coc:kernel-bridge')({campaign: 'c1', call: game.call});
  bus.get('coc:capsule')({capsule: game.input.capsule, context: game.input._context});
  const look = await game.call('table.look', {focus: 'scene'});
  const {messages} = await hooks.get('context')({messages: [{role: 'user', content: '我看看桌上有什么。'},
    {role: 'assistant', content: [{type: 'toolCall', id: 'look-1', name: 'look', arguments: {focus: 'scene'}}]},
    {role: 'toolResult', toolCallId: 'look-1', toolName: 'look', content: [{type: 'text', text: JSON.stringify(look)}]}]},
    {model: {contextWindow: 1000000}});
  return messages;
}
/** Every string in `value` that `pick` keeps. */
const strings = (value, pick, out = []) => {
  if (typeof value === 'string') { if (pick(value)) out.push(value); }
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, pick, out);
  return out;
};

test('§185.2/§185.3: references the rename rewrote resolve to their originals when the Keeper copies them back', async t => {
  const game = await table(t);
  const original = (await game.ledger()).intents.find(row => row.text === LINE).ref;
  assert.match(original, new RegExp(`^intent:${KNOTT}:[0-9a-f]{12}$`), 'the ledger stores the canonical form');

  const sent = await keeperRequest(game);
  const capsule = JSON.parse(sent.find(message => message.customType === 'coc-capsule').content);
  const result = JSON.parse(sent.find(message => message.role === 'toolResult').content[0].text);
  assert.ok(!JSON.stringify(sent).includes(KNOTT), 'no handle of his reaches the Keeper as written');
  // What the Keeper holds: the card's reference and the scene's handles, each with his word where his handle stood.
  const ref = capsule.present.find(person => person.name === WORD)?.history?.intents?.find(row => row.intent === LINE)?.ref;
  assert.equal(ref, original.replace(KNOTT, WORD), JSON.stringify(capsule.present));
  const [house] = strings([capsule, result], value => value === `${WORD}-house`);
  const [ledger] = strings([capsule, result], value => value === `${WORD}-ledger`);
  assert.ok(house && ledger, 'the scene and clue handles reach the Keeper renamed');

  await t.test('the intention reference settles the intention', async () => {
    const landed = await game.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'npc', name: WORD, intent_ref: ref, outcome: 'done'}]});
    const receipt = (await game.receipts()).find(row => row.id === landed.receipts[0]);
    assert.deepEqual([receipt.intent.ref, receipt.intent.outcome, receipt.previous], [original, 'done', 'attempted'], 'the receipt stores the canonical form');
    await game.call('table.narrate', {call_id: 't2-c9', text: '他签了字。'});
    await game.call('table.player_input', {text: '我收好钥匙。'});
    const rows = (await game.ledger()).intents.filter(row => row.text === LINE);
    assert.deepEqual(rows.map(row => [row.ref, row.status]), [[original, 'done']], 'one row, settled, its stored ref unchanged');
  });
  await t.test('the clue handle names the clue', async () => {
    const {turn} = await game.call('table.status');
    const landed = await game.call('table.apply', {call_id: `t${turn}-c1`, effects: [{kind: 'clue', clue: ledger, how: '在抽屉里翻到的'}]});
    const receipt = (await game.receipts()).find(row => row.id === landed.receipts[0]);
    assert.equal(receipt.clue, LEDGER);
  });
  await t.test('the scene handle names the scene', async () => {
    const {turn} = await game.call('table.status');
    const landed = await game.call('table.apply', {call_id: `t${turn}-c2`, effects: [{kind: 'move', to: house}]});
    const receipt = (await game.receipts()).find(row => row.id === landed.receipts.find(id => id.startsWith('move:')));
    assert.equal(receipt.to, HOUSE);
  });
});

test('§185.2: an intention reference written with any word for its owner settles it; another person\'s is refused', async t => {
  const game = await table(t);
  const original = (await game.ledger()).intents.find(row => row.text === LINE).ref, digest = original.split(':').at(-1);
  await assert.rejects(game.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'npc', name: 'Mr. Dooley', intent_ref: `intent:${WORD}:${digest}`, outcome: 'done'}]}),
    error => error.code === 'invalid_params' && error.details?.owner === KNOTT, 'his intention is not Dooley\'s');
  await assert.rejects(game.call('table.apply', {call_id: 't2-c2', effects: [{kind: 'npc', name: WORD, intent_ref: `intent:${WORD}:0123456789ab`, outcome: 'done'}]}),
    error => error.code === 'invalid_params' && error.details?.reason === 'unknown_intent');
  // What he brings out by that intention (§143.29, host-only) records the canonical form, whatever word named him.
  await game.call('table.apply', {call_id: 't2-c3', effects: [{kind: 'npc', name: WORD, intent_ref: `intent:${WORD}:${digest}`, intent_outcome: 'done',
    _produces: {name: 'a brass key', description: 'He takes a second key out of his waistcoat.'}}]});
  const world = JSON.parse(await readFile(join(game.home, '.coc/campaigns/c1/world.json'), 'utf8'));
  assert.deepEqual(Object.values(world.objects.instances).find(item => item.name === 'a brass key')?.brought_out?.ref, original);
  // As the result of another effect (§142.2), by the book's name for him: the stamp is canonical.
  const opened = await game.call('table.apply', {call_id: 't2-c4', effects: [{kind: 'npc', name: WORD, intends: 'Lock the office behind the visitor.', outcome: 'attempted'}]});
  const next = (await game.receipts()).find(row => row.id === opened.receipts[0]).intent.ref;
  const landed = await game.call('table.apply', {call_id: 't2-c5', effects: [{kind: 'flag', name: 'office-locked', value: true, intent_ref: `intent:Steven Knott:${next.split(':').at(-1)}`}]});
  const receipt = (await game.receipts()).find(row => row.id === landed.receipts[0]);
  assert.deepEqual([receipt.intent?.ref, receipt.intent?.npc, receipt.intent?.outcome], [next, KNOTT, 'done']);
});

test('§185.2: a stored ref that spells its owner another way is shown canonical, settled by what is shown, and not rewritten', async t => {
  const game = await table(t);
  const path = join(game.home, '.coc/campaigns/c1/npc-ledger.json'), ledger = JSON.parse(await readFile(path, 'utf8'));
  const row = ledger[`npc-${KNOTT}`].intents.find(item => item.text === LINE), canonical = row.ref, digest = canonical.split(':').at(-1);
  const stored = `intent:Steven Knott:${digest}`;
  row.ref = stored;
  await writeFile(path, JSON.stringify(ledger));
  // Every view shows the canonical form: the card, the Director's offer, and both kinds of refusal options.
  const view = await game.call('table.capsule');
  const capsule = view.capsule ?? view;
  const card = capsule.present.find(person => person.untold?.id === KNOTT || person.name === 'Steven Knott');
  assert.deepEqual(card?.history?.intents?.map(item => item.ref), [canonical], JSON.stringify(card?.history));
  assert.ok(capsule.director.offer.some(item => item.ref === canonical), JSON.stringify(capsule.director.offer.map(item => item.ref)));
  assert.ok(!strings(capsule, value => value.includes(stored)).length, 'the stored spelling reaches no view');
  const perspective = await game.call('npc.perspective', {name: WORD});
  assert.ok(strings(perspective, value => value === canonical).length && !strings(perspective, value => value.includes(stored)).length, 'the perspective too');
  await assert.rejects(game.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'npc', name: WORD, intent_ref: `intent:${WORD}:0123456789ab`, outcome: 'done'}]}),
    error => error.details?.reason === 'unknown_intent' && JSON.stringify(error.details.options.map(item => item.ref)) === JSON.stringify([canonical]));
  await assert.rejects(game.call('table.apply', {call_id: 't2-c2', effects: [{kind: 'flag', name: 'keys-signed', intent_ref: `intent:nobody-here:${digest}`}]}),
    error => error.code === 'invalid_params' && JSON.stringify(error.details?.options?.map(item => [item.ref, item.npc])) === JSON.stringify([[canonical, KNOTT]]));
  const shown = card.history.intents[0].ref;
  await game.call('table.apply', {call_id: 't2-c3', effects: [{kind: 'npc', name: WORD, intent_ref: shown, outcome: 'failed'}]});
  await game.call('table.narrate', {call_id: 't2-c9', text: '他没能让你签字。'});
  await game.call('table.player_input', {text: '我把钥匙放回桌上。'});
  const rows = (await game.ledger()).intents.filter(item => item.text === LINE);
  assert.deepEqual(rows.map(item => [item.ref, item.status]), [[stored, 'failed']], 'one row, settled under the ref it was stored with');
});

test('§185.1/§185.3: the retry is a legacy campaign\'s; a campaign marked name-free resolves references only as written', async t => {
  const game = await table(t);
  const path = join(game.home, '.coc/campaigns/c1/campaign.json');
  await writeFile(path, JSON.stringify({...JSON.parse(await readFile(path, 'utf8')), handles: 'name-free'}));
  await assert.rejects(game.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'clue', clue: `${WORD}-ledger`, how: '在抽屉里翻到的'}]}),
    error => error.code === 'unknown_entity');
  const landed = await game.call('table.apply', {call_id: 't2-c2', effects: [{kind: 'clue', clue: LEDGER, how: '在抽屉里翻到的'}]});
  assert.equal((await game.receipts()).find(row => row.id === landed.receipts[0]).clue, LEDGER);
});
