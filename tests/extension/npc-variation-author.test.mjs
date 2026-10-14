// Deterministic author-packet boundary evidence, never gameplay acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFinalOutputOwner} from '../../extensions/kernel/final-output.ts';

const variation = () => ({
  origin: 'table_random',
  stable: {
    temperament: 'Patient and measured; allow another person to finish.',
    values: 'PRIVATE_VALUE',
    speech: 'Put the useful point first, then a relevant qualification.',
    private_detail: 'PRIVATE_STABLE_DETAIL',
  },
  initial: {emotion: 'PRIVATE_INITIAL_EMOTION', social: 'PRIVATE_INITIAL_SOCIAL'},
  seed: 'PRIVATE_SEED',
  rolls: {temperament: 'PRIVATE_ROLL_ID'},
});

async function outgoingPacket(t, present) {
  const home = await mkdtemp(join(tmpdir(), 'npc-variation-author-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const capsule = {
    _context: {campaign: 'packet-test', turn: 1, worldline: 'main', loop: 0,
      task_world_revision: 'world-1', task_source_revision: 'source-1'},
    play_language: 'en',
    turn: {player_text: 'I ask whether the way is open.'},
    present,
    known: {investigator: {name: 'Investigator'}},
  };
  const original = structuredClone(capsule);
  let packet, request, starts = 0;
  const runtime = {home, async runTask(task) {
    starts++;
    request = task.request;
    packet = JSON.parse(await readFile(join(request.cwd, 'task.json'), 'utf8'));
    const text = 'The room is cold. {{say:the clerk}}The way is open.{{/say}}';
    await writeFile(join(request.cwd, 'draft.json'), JSON.stringify({version: 1, text,
      coverage: [{name: 'room', quote: 'The room is cold.'},
        {name: 'speech:1', quote: 'The way is open.'}]}));
    const slash = request.model.indexOf('/');
    request.onEvent({type: 'message_end', message: {role: 'assistant',
      provider: request.model.slice(0, slash), model: request.model.slice(slash + 1)}});
    return {ok: true, ms: 1};
  }};
  const owner = createFinalOutputOwner({runtime: () => runtime,
    call: async method => {
      if (method === 'table.capsule') return capsule;
      if (method === 'table.status') return {receipts: [], mechanics: []};
      if (method === 'table.delivery.check' || method === 'table.untold') return {};
      throw Error('Unexpected packet-boundary method: ' + method);
    }, record: async () => {}});
  const delivery = await owner.write('packet-test', 1, {version: 1,
    materials: [{name: 'room', text: 'The room is cold.', kind: 'description',
      visibility: 'player', required: true},
      {name: 'hidden', text: 'PRIVATE_MATERIAL', kind: 'context', visibility: 'keeper'}],
    utterances: [{speaker: 'PRIVATE_BOOK_NAME', audience: ['Investigator'],
      meaning: 'The way is open.', stance: 'A plain practical answer.'}]});
  assert.equal(starts, 1, 'the real writing owner starts the in-process model fixture');
  assert.equal(delivery.text, 'The room is cold. {{say:the clerk}}The way is open.{{/say}}');
  assert.deepEqual(capsule, original, 'projection does not rewrite the Keeper capsule');
  return {packet, request};
}

test('the outgoing author task receives only compatible stable phrasing under the shown name', async t => {
  const {packet, request} = await outgoingPacket(t, [{name: 'PRIVATE_BOOK_NAME',
    called: {name: 'the clerk'}, untold: {id: 'PRIVATE_ACTOR_ID'},
    variation: variation(), now: 'PRIVATE_CURRENT_FEELING',
    dossier: {hides: 'PRIVATE_DOSSIER'}, private_intention: 'PRIVATE_INTENTION'}]);
  assert.equal(request.tools, 'read,write,edit,bash');
  assert.equal(request.finalOutput, true);
  assert.equal(packet.people.length, 1);
  assert.equal(packet.people[0].name, 'the clerk');
  const guidance = packet.people[0].speech_guidance;
  assert.deepEqual(Object.keys(guidance).sort(), ['authority', 'speech', 'temperament']);
  assert.equal(guidance.temperament, variation().stable.temperament);
  assert.equal(guidance.speech, variation().stable.speech);
  assert.match(guidance.authority, /Compatible phrasing guidance only/);
  assert.match(guidance.authority, /Supplied utterance meaning and stance govern/);
  assert.match(guidance.authority, /add no facts, feelings, gestures or actions/);
  assert.deepEqual(packet.materials.find(row => row.name === 'speech:1'), {
    name: 'speech:1', kind: 'speech', authority: 'attributed_intention',
    meaning: 'The way is open.', speaker: 'the clerk', audience: ['Investigator'],
    stance: 'A plain practical answer.',
  });
  assert.ok(!JSON.stringify(packet).includes('PRIVATE_'),
    'values, emotions, social seed, dossier, private material, ids and seed metadata stay outside task.json');
});

test('prepared source and accepted personality suppress random author guidance', async t => {
  const {packet} = await outgoingPacket(t, [
    {name: 'PRIVATE_BOOK_NAME', called: {name: 'the clerk'}, untold: {id: 'PRIVATE_ACTOR_ID'},
      variation: variation(), personality: {origin: 'module_derived',
        profile: {expression: 'PRIVATE_SOURCE_PERSONALITY'}}},
    {name: 'Witness', variation: variation(), personality: {origin: 'table_supplement',
      description: 'PRIVATE_ACCEPTED_PERSONALITY'}},
    {name: 'Bystander'},
  ]);
  assert.deepEqual(packet.people, [{name: 'the clerk'}, {name: 'Witness'}, {name: 'Bystander'}]);
  assert.ok(!JSON.stringify(packet).includes('PRIVATE_'));
  assert.ok(!JSON.stringify(packet).includes(variation().stable.temperament),
    'an established personality prevents a second random portrayal request');
});
