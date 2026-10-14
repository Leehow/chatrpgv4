/** Random portrayal prompts cross the real kernel boundary once, without becoming source truth. */
import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {cpSync, readFileSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {nativeStorageFixture} from './storage-support.ts';
import {CAMPAIGN, CONTENT_DIR, ROOT, RpcClient, campaignDir, createCampaign, importSource, kernel, readJson, writeJson, type Row} from './support.ts';

const NAME = 'the photographic shopkeeper';
const tables = readJson(join(ROOT, 'mods/natural-npc/character-tables.json')).tables as Row[];
const version = readJson(join(ROOT, 'mods/natural-npc/mod.json')).version;
const world = (k:RpcClient):Row => readJson(join(campaignDir(k.workspace), 'world.json'));
const turn = (k:RpcClient):Row => readJson(join(campaignDir(k.workspace), 'turn.json'));
const apply = (k:RpcClient, call_id:string, effects:Row[]) => k.table('apply', {call_id, effects});
const variationReceipts = (k:RpcClient) => (turn(k).receipts ?? []).filter((r:Row) => r.kind === 'roll' && r.family === 'npc-variation' && r.variation);
const npc = async (k:RpcClient, name = NAME):Promise<Row> => {
  const present = (await k.table('capsule')).present.find((person:Row) => person.name === name);
  assert.ok(present, `${name} is present before narration`);
  return present;
};
const saved = (k:RpcClient, name = NAME):Row => {
  const character = Object.values(world(k).npc_character ?? {}).find((person:any) => person.variation?.receipt?.name === name) as Row | undefined;
  assert.ok(character, `${name} has persisted random guidance`);
  return character.variation;
};
async function setup(t:TestContext, enabled = true):Promise<RpcClient> {
  const k = await kernel(t, {env:{COC_KERNEL_SEED:'7'}});
  await createCampaign(k);
  await k.ok('mods.configure', {campaign:CAMPAIGN, id:'natural-npc', version, enabled});
  await k.table('open');
  await k.table('narrate', {call_id:'t0-c1', text:'Knott sets the keys on the desk.'});
  await k.table('player_input', {text:'I ask the photographic shopkeeper about a delivery.'});
  return k;
}
const walkOn = (k:RpcClient, call_id = 't1-c1', name = NAME) => apply(k, call_id, [{kind:'npc', name, walk_on:true, to:'here'}]);
function checkedRolls(value:Row):void {
  assert.equal(value.origin, 'table_random');
  assert.equal(value.mod, 'natural-npc');
  assert.equal(value.version, version);
  assert.equal(value.rolled.length, tables.length);
  assert.equal(value.receipt.kind, 'roll');
  assert.equal(value.receipt.family, 'npc-variation');
  assert.equal(value.receipt.form, 'dice');
  assert.equal(value.receipt.visibility, 'keeper');
  assert.deepEqual(value.receipt.faces, value.rolled.map((row:Row) => row.roll));
  assert.equal(value.receipt.total, value.rolled.reduce((sum:number, row:Row) => sum + row.roll, 0));
  assert.deepEqual(Object.keys(value.stable).sort(), ['speech', 'temperament', 'values']);
  assert.deepEqual(Object.keys(value.initial).sort(), ['emotion', 'social']);
  for (const table of tables) {
    const roll = value.rolled.find((row:Row) => row.table === table.key);
    assert.ok(roll, `${table.key} was rolled`);
    assert.equal(roll.sides, table.rows.length);
    assert.ok(Number.isInteger(roll.roll) && roll.roll >= 1 && roll.roll <= roll.sides);
    assert.equal(value[table.lifetime][table.key], table.rows[roll.roll - 1]);
  }
}

test('opening and first walk-on receive real random guidance before any dialogue', async t => {
  const k = await setup(t);
  const opening = saved(k, 'Steven Knott');
  checkedRolls(opening);
  assert.equal(opening.initialized_turn, 0);
  assert.deepEqual(readJson(join(campaignDir(k.workspace), 'turns/0000.json')).receipts.filter((row:Row) => row.variation), [opening.receipt]);
  const result = await walkOn(k);
  const value = saved(k);
  checkedRolls(value);
  assert.equal(value.initialized_turn, 1);
  const receipt = variationReceipts(k).find((row:Row) => row.name === NAME)!;
  assert.equal(receipt.visibility, 'keeper');
  assert.deepEqual(receipt.variation, {stable:value.stable, initial:value.initial, rolled:value.rolled});
  assert.ok(!result.receipts.includes(receipt.id), 'private portrayal dice do not change ordinary effect receipt counts');
  assert.deepEqual(receipt, value.receipt, 'the canonical turn retains the private initialization receipt');
  assert.ok(!receipt.id.includes(receipt.npc), 'the minted receipt identifier contains no source node identity');
  assert.deepEqual((await npc(k)).variation, {stable:value.stable, initial:value.initial, origin:'table_random', since_turn:1});
  assert.deepEqual((await k.table('look', {focus:'npc', name:NAME})).variation, (await npc(k)).variation);
  assert.deepEqual((await k.ok('npc.perspective', {campaign:CAMPAIGN, name:NAME})).variation, (await npc(k)).variation);
  const situation = await k.ok('npc.situation', {campaign:CAMPAIGN, name:NAME});
  assert.deepEqual(situation.who.variation, (await npc(k)).variation);
  assert.ok(!situation.happened.some((line:string) => line.includes(receipt.skill)), 'portrayal dice are no event this person enacted');
  const {committedFacts} = await importSource('kernel-ts/write/text.ts');
  assert.deepEqual(committedFacts([receipt], {}, () => NAME, null), committedFacts([], {}, () => NAME, null), 'portrayal initialization adds no committed fiction facts');
  const {PythonRandom} = await importSource('kernel-ts/random.ts');
  for (const record of [opening, value]) {
    assert.equal(typeof record.seed, 'string');
    const rng = new PythonRandom(record.seed);
    for (const rolled of record.rolled) assert.equal(rolled.roll, rng.randint(1, rolled.sides), 'the recorded choice replays from its dedicated portrayal stream');
  }
  const delivered = await k.table('narrate', {call_id:'t1-c2', text:'The shopkeeper listens and gives an ordinary answer.'});
  assert.equal(delivered.rendered_text, 'The shopkeeper listens and gives an ordinary answer.');
  const die = delivered.mechanics.find((row:Row) => row.receipt === receipt.id);
  assert.ok(die, 'the audit log retains the private dice');
  assert.equal(die.visibility, 'keeper', 'the established player-rendering tier hides the portrayal dice');
  const ledger = readJson(join(campaignDir(k.workspace), 'npc-ledger.json'));
  assert.ok(!(ledger[receipt.npc]?.interactions ?? []).some((row:Row) => row.receipt === receipt.id), 'portrayal initialization is no social interaction');
});

test('replay, return and kernel restart retain the same identity and do not roll again', async t => {
  const k = await setup(t);
  const result = await walkOn(k);
  const value = structuredClone(saved(k));
  const recorded = readFileSync(join(campaignDir(k.workspace), 'world.json'), 'utf8');
  assert.deepEqual(await walkOn(k), {...result, replayed:true});
  assert.equal(readFileSync(join(campaignDir(k.workspace), 'world.json'), 'utf8'), recorded);
  assert.equal(variationReceipts(k).filter((r:Row) => r.name === NAME).length, 1);
  await apply(k, 't1-c2', [{kind:'npc', name:NAME, to:'away'}, {kind:'npc', name:NAME, to:'here'}]);
  assert.deepEqual(saved(k), value);
  assert.equal(variationReceipts(k).filter((r:Row) => r.name === NAME).length, 1);
  await k.table('narrate', {call_id:'t1-c3', text:'The shopkeeper looks up from the counter.'});
  await k.close();
  const reopened = new RpcClient(k.workspace, {env:{COC_KERNEL_SEED:'different-seed'}});
  try {
    await reopened.table('open');
    assert.deepEqual((await npc(reopened)).variation.stable, value.stable);
    await reopened.table('player_input', {text:'I return to the shopkeeper and ask again.'});
    assert.deepEqual((await npc(reopened)).variation, {stable:value.stable, initial:value.initial, origin:'table_random', since_turn:1});
    assert.equal(variationReceipts(reopened).filter((r:Row) => r.name === NAME).length, 0, 'a later turn gets no duplicate seed receipt');
    const characters = world(reopened).npc_character;
    assert.deepEqual(Object.values(characters).find((row:any) => row.variation?.receipt?.name === NAME), {variation:value});
  } finally { await reopened.close(); }
});

test('entering a new scene initializes authored residents before their first exchange', async t => {
  const k = await setup(t);
  const original = world(k).npc_character;
  assert.ok(!Object.hasOwn(original, 'npc-arty-wilmot'));
  assert.ok(!Object.hasOwn(original, 'npc-ruth-blake'));
  const result = await apply(k, 't1-c1', [{kind:'move', to:'newspaper-morgue'}]);
  for (const name of ['Arty Wilmot', 'Ruth Blake']) {
    const person = await npc(k, name), value = saved(k, name);
    checkedRolls(value);
    assert.equal(value.initialized_turn, 1);
    assert.deepEqual(person.variation.stable, value.stable);
    assert.ok(!result.receipts.includes(value.receipt.id));
    assert.deepEqual(variationReceipts(k).find((receipt:Row) => receipt.name === name), value.receipt);
    assert.equal(variationReceipts(k).filter((receipt:Row) => receipt.name === name).length, 1);
  }
});

test('a crowded scene keeps every random seed and focused look returns full portrayal', async t => {
  const k = await setup(t), names = ['the reception clerk', 'the parcel carrier', 'the caretaker', 'the neighborhood customer'];
  await apply(k, 't1-c1', names.map(name => ({kind:'npc', name, walk_on:true, to:'here'})));
  const capsule = await k.table('capsule');
  assert.ok(capsule.truncated.includes('present'), 'this fixture exercises the existing crowded-room budget');
  assert.ok(names.some(name => !capsule.present.find((person:Row) => person.name === name)?.variation), 'some people are indexed instead of fully projected');
  for (const name of names) {
    assert.ok(capsule.present.some((person:Row) => person.name === name), 'the budget keeps every identity');
    const value = saved(k, name);
    checkedRolls(value);
    assert.equal(typeof value.seed, 'string');
    const look = await k.table('look', {focus:'npc', name});
    assert.deepEqual(look.variation, {stable:value.stable, initial:value.initial, origin:'table_random', since_turn:1});
    assert.equal(variationReceipts(k).filter((receipt:Row) => receipt.name === name).length, 1);
  }
});

test('source authored personality remains intact alongside compatible random guidance', async t => {
  const root = nativeStorageFixture(t), content = join(root, 'content');
  cpSync(CONTENT_DIR, content, {recursive:true});
  symlinkSync(join(ROOT, 'mods'), join(root, 'mods'), 'dir');
  const path = join(content, 'starters/the-haunting/module-graph.json'), graph = readJson(path);
  const authored = 'Protects the dignity of others; patient in ordinary conversation and firm about a supported commitment.';
  graph.nodes.find((node:Row) => node.node_id === 'npc-steven-knott').properties.personality = authored;
  writeJson(path, graph);
  const originalSource = readFileSync(path, 'utf8');
  const k = await kernel(t, {content});
  await createCampaign(k);
  await k.table('open');
  const person = await npc(k, 'Steven Knott');
  assert.equal(person.personality.description, authored);
  assert.equal(person.personality.origin, 'source_authored');
  checkedRolls(saved(k, 'Steven Knott'));
  assert.equal(readFileSync(path, 'utf8'), originalSource, 'random guidance never rewrites authored material');
  const perspective = await k.ok('npc.perspective', {campaign:CAMPAIGN, name:'Steven Knott'});
  assert.deepEqual(perspective.personality, person.personality);
  assert.deepEqual(perspective.variation, person.variation);
});

test('previously accepted personality survives enabling the random tables', async t => {
  const k = await setup(t, false);
  await walkOn(k);
  const job = await k.ok('npc.job', {campaign:CAMPAIGN, name:NAME});
  assert.ok(job.job_id);
  const description = 'Values fair dealing, notices hesitation, and prefers a careful answer over a reassuring guess.';
  await k.ok('npc.submit', {campaign:CAMPAIGN, job_id:job.job_id, claim:job.claim, personality:{description}});
  const accepted = structuredClone(Object.values(world(k).npc_character).find((row:any) => row.personality?.description === description)) as Row;
  await k.table('narrate', {call_id:'t1-c2', text:'The shopkeeper listens and answers carefully.'});
  await k.ok('mods.configure', {campaign:CAMPAIGN, id:'natural-npc', version, enabled:true});
  await k.table('player_input', {text:'I tell the shopkeeper I appreciate the careful answer.'});
  const person = await npc(k), value = saved(k);
  checkedRolls(value);
  assert.equal(person.personality.description, description);
  assert.equal(person.personality.origin, 'table_supplement');
  assert.deepEqual(Object.values(world(k).npc_character).find((row:any) => row.personality?.description === description), {...accepted, variation:value});
});

test('pending and committed played mood replace initial state across all portrayal reads', async t => {
  const k = await setup(t);
  await walkOn(k);
  const value = structuredClone(saved(k)), mood = 'Relieved by the apology, still cautious about the promise.';
  await apply(k, 't1-c2', [{kind:'npc', name:NAME, mood}]);
  const check = async () => {
    const present = await npc(k);
    assert.equal(present.now.feels, mood);
    assert.deepEqual(present.variation.stable, value.stable);
    assert.ok(!Object.hasOwn(present.variation, 'initial'), 'initial prompts cannot compete with an actual mood');
    const look = await k.table('look', {focus:'npc', name:NAME});
    assert.equal(look.now.feels, mood);
    assert.ok(!Object.hasOwn(look.variation, 'initial'));
    const perspective = await k.ok('npc.perspective', {campaign:CAMPAIGN, name:NAME});
    assert.equal(perspective.now.feels, mood);
    assert.ok(!Object.hasOwn(perspective.variation, 'initial'));
    const situation = await k.ok('npc.situation', {campaign:CAMPAIGN, name:NAME});
    assert.equal(situation.who.now.feels, mood);
    assert.ok(!Object.hasOwn(situation.who.variation, 'initial'));
  };
  await check();
  await k.table('narrate', {call_id:'t1-c3', text:'The shopkeeper relaxes, then returns to the remaining concern.'});
  await k.table('player_input', {text:'I ask what would make that promise credible.'});
  await check();
  assert.deepEqual(world(k).npc_character[value.receipt.npc].variation, value, 'played mood suppresses projection without rewriting original rolls');
});

test('creatures receive no personality or emotional variation', async t => {
  const k = await setup(t), name = 'the alley dog';
  await apply(k, 't1-c1', [{kind:'npc', name, walk_on:true, creature:'Dog', to:'here'}]);
  const person = await npc(k, name);
  assert.equal(person.kind, 'creature');
  assert.ok(!Object.hasOwn(person, 'variation'));
  assert.ok(!Object.hasOwn(person, 'personality'));
  const look = await k.table('look', {focus:'npc', name});
  assert.ok(!Object.hasOwn(look, 'variation'));
  assert.equal(variationReceipts(k).filter((r:Row) => r.name === name).length, 0);
  assert.equal(Object.values(world(k).npc_character ?? {}).filter((row:any) => row.variation?.receipt?.name === name).length, 0);
});

test('disabled tables stay inert and disable-enable preserves established guidance', async t => {
  const k = await setup(t, false);
  await walkOn(k);
  assert.equal(variationReceipts(k).length, 0);
  assert.ok(!Object.hasOwn(await npc(k), 'variation'));
  assert.ok(!Object.hasOwn(await npc(k, 'Steven Knott'), 'variation'));
  const before = readFileSync(join(campaignDir(k.workspace), 'world.json'), 'utf8');
  await k.table('look', {focus:'npc', name:NAME});
  await k.ok('npc.perspective', {campaign:CAMPAIGN, name:NAME});
  await k.ok('npc.situation', {campaign:CAMPAIGN, name:NAME});
  assert.equal(readFileSync(join(campaignDir(k.workspace), 'world.json'), 'utf8'), before);
  await k.table('narrate', {call_id:'t1-c2', text:'The shopkeeper returns to work.'});
  await k.ok('mods.configure', {campaign:CAMPAIGN, id:'natural-npc', version, enabled:true});
  await k.table('player_input', {text:'I return to the counter.'});
  const value = structuredClone(saved(k));
  checkedRolls(value);
  await k.table('narrate', {call_id:'t2-c1', text:'The same shopkeeper greets you again.'});
  for (const enabled of [false, true]) await k.ok('mods.configure', {campaign:CAMPAIGN, id:'natural-npc', version, enabled});
  await k.table('player_input', {text:'I continue the conversation.'});
  assert.deepEqual(world(k).npc_character[value.receipt.npc].variation, value);
  assert.equal(variationReceipts(k).filter((r:Row) => r.name === NAME).length, 0);
});

test('refused apply and ordinary portrayal reads cannot initialize or persist a new person', async t => {
  const k = await setup(t);
  const files = ['world.json', 'turn.json'];
  const snapshot = () => files.map(path => readFileSync(join(campaignDir(k.workspace), path), 'utf8'));
  const before = snapshot();
  await k.tableErr('apply', {call_id:'t1-c1', effects:[{kind:'npc', name:NAME, walk_on:true, to:'here'}, {kind:'clue', clue:'not-an-authored-clue'}]});
  assert.deepEqual(snapshot(), before);
  assert.equal((world(k).table_people ?? []).filter((person:Row) => person.name === NAME).length, 0);
  assert.equal(variationReceipts(k).filter((r:Row) => r.name === NAME).length, 0);
  const receiptsBefore = variationReceipts(k);
  const callsBefore = turn(k).calls;
  // Existing read entrances can begin acting; they must not publish a person, dice or world changes.
  await k.table('capsule');
  await k.table('look', {focus:'npc', name:'Steven Knott'});
  await k.ok('npc.perspective', {campaign:CAMPAIGN, name:'Steven Knott'});
  await k.ok('npc.situation', {campaign:CAMPAIGN, name:'Steven Knott'});
  assert.equal(snapshot()[0], before[0]);
  assert.deepEqual(turn(k).calls, callsBefore);
  assert.deepEqual(variationReceipts(k), receiptsBefore);
});
