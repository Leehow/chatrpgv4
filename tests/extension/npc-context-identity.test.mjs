/** §237.57: the present actor's registered identity reaches the existing native look. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {cpSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel, ROOT, MODULE, PREGEN, RpcClient, rpcCommand} from '../integration/support.ts';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

function collisionContent(workspace, shared = true) {
  const content = join(workspace, 'identity-content');
  cpSync(join(ROOT, 'content'), content, {recursive:true});
  const file = join(content, 'starters/the-haunting/module-graph.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const node of data.nodes) {
    if (node.properties?.runtime_projection?.record?.is_start) node.properties.runtime_projection.record.is_start = false;
  }
  data.nodes.push(
    {node_id:'scene-identity-office',node_kind:'scene',name:'Identity office',summary:'A public office.',visibility:'public',
      properties:{runtime_projection:{kind:'scene',record:{scene_id:'identity-office',is_start:true}}}},
    {node_id:'scene-identity-offstage',node_kind:'scene',name:'Other office',summary:'A separate office.',visibility:'keeper-only',properties:{}},
    {node_id:'npc-identity-present',node_kind:'npc',name:'Avery',summary:'PRIVATE_PRESENT_PROFILE',visibility:'keeper-only',
      properties:{runtime_projection:{kind:'npc',record:{npc_id:'identity-present',display_name:'Avery'}}}},
    {node_id:'npc-identity-offstage',node_kind:'npc',name:shared?'Avery':'Blair',summary:'PRIVATE_OFFSTAGE_PROFILE',visibility:'keeper-only',
      properties:{runtime_projection:{kind:'npc',record:{npc_id:'identity-offstage',display_name:shared?'Avery':'Blair'}}}},
  );
  data.relations.push(
    {relation_id:'identity-present-location',from_node_id:'npc-identity-present',relation_kind:'present-in',to_node_id:'scene-identity-office',properties:{}},
    {relation_id:'identity-offstage-location',from_node_id:'npc-identity-offstage',relation_kind:'present-in',to_node_id:'scene-identity-offstage',properties:{}},
  );
  writeFileSync(file, JSON.stringify(data));
  return content;
}

test('native present actor retains the full look identity when two registered NPC names collide', async t => {
  const client = await kernel(t);
  const content = collisionContent(client.workspace);
  await client.close();
  const native = new RpcClient(client.workspace, {content});
  t.after(() => native.close());
  await native.ok('campaign.create', {id:'identity-table',module:MODULE,pregen:PREGEN,play_language:'en'});
  await native.ok('table.open', {campaign:'identity-table'});
  const collision = await native.call('table.look', {campaign:'identity-table',focus:'npc',name:'Avery'});
  assert.equal(collision.ok, false);
  assert.equal(collision.error.code, 'unknown_entity');
  assert.equal(collision.error.details.candidates.length, 2);
  const capsule = await native.ok('table.capsule', {campaign:'identity-table',_context_read:true});
  const present = capsule.present.filter(person => person.name === 'Avery');
  assert.equal(present.length, 1);
  assert.equal(typeof present[0].id, 'string', 'the compact producer must retain its existing registered handle');
  assert.ok(present[0].id.trim());
  const full = await native.ok('table.look', {campaign:'identity-table',focus:'npc',name:present[0].id});
  assert.equal(full.id, present[0].id);
  assert.equal(full.name, 'Avery');
  assert.equal(full.summary, 'PRIVATE_PRESENT_PROFILE');
  assert.equal(JSON.stringify(present).includes('PRIVATE_OFFSTAGE_PROFILE'), false);
});

function clerkPeople(context) {
  const found = [];
  for (const message of context.messages) {
    const texts = typeof message.content === 'string' ? [message.content]
      : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text);
    for (const text of texts) {
      let value;
      try { value = JSON.parse(text); } catch { continue; }
      if (value.authority === 'Keeper-only current state and actor perspectives; no disclosure grant') found.push(...value.people);
    }
  }
  return found;
}

async function projectedPeople(t, {shared = true, legacy} = {}) {
  const engine = createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null,npcAct:null});
  let handle, people;
  const legacyReads = [];
  const frames = [];
  const table = await openTable({legacyDeliveryFixtures:false,realKernel:true,seedCampaign:false,
    runDriver:engine.runDriver,env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_KERNEL_CMD:JSON.stringify(rpcCommand())},
    prepareWorkspace:async workspace => {
      const content = collisionContent(workspace, shared);
      const client = new RpcClient(workspace, {content});
      try {
        await client.ok('campaign.create', {id:'test-camp',module:MODULE,pregen:PREGEN,play_language:'en'});
        handle = (await client.ok('table.look', {campaign:'test-camp',focus:'npc',name:'npc-identity-present'})).id;
        await client.ok('table.narrate', {campaign:'test-camp',call_id:'t0-c1',text:'You wait in the public office.'});
      } finally { await client.close(); }
      process.env.PI_COC_KERNEL_CMD = JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',content]);
    },
    extraExtensions:[
      {name:'identity-stream',factory:pi => pi.events.on('coc:final-delivery', frame => frames.push(frame))},
      {name:'identity-driver',factory:engine.extension},
      ...(legacy !== undefined ? [{name:'legacy-present-row',factory:pi => {
        let forwarding = false;
        pi.events.on('coc:kernel-bridge', binding => {
          if (forwarding || !binding?.call) return;
          const original = binding.call.bind(binding);
          forwarding = true;
          try { pi.events.emit('coc:kernel-bridge', {...binding,call:async (method, params, ...rest) => {
            if (method === 'table.look' && params.focus === 'npc') legacyReads.push(params.name);
            const value = await original(method, params, ...rest);
            if (method !== 'table.capsule' || !Array.isArray(value.present)) return value;
            return {...value,present:value.present.map(person => {
              if (person.name !== 'Avery') return person;
              const copy = {...person};
              if (legacy === 'missing') delete copy.id; else copy.id = legacy;
              return copy;
            })};
          }}); } finally { forwarding = false; }
        });
      }}] : []),
    ],
    responses:[context => { people = clerkPeople(context); return fauxAssistantMessage(JSON.stringify({version:1,text:'The visitor waits.'})); }],
  });
  t.after(() => table.dispose());
  await table.session.prompt('I wait in the office and look at Avery.');
  assert.deepEqual(table.extensionErrors, []);
  assert.ok(Array.isArray(people));
  assert.equal(frames.filter(frame => frame.event === 'delta').map(frame => frame.delta).join(''), 'The visitor waits.');
  assert.equal(JSON.stringify(frames).includes('PRIVATE_PRESENT_PROFILE'), false);
  assert.equal(JSON.stringify(frames).includes('PRIVATE_OFFSTAGE_PROFILE'), false);
  return {people, handle, legacyReads};
}

test('the actual hybrid enrichment reads the registered present handle without an offstage perspective', async t => {
  const {people, handle} = await projectedPeople(t);
  const actor = people.find(person => person.summary === 'PRIVATE_PRESENT_PROFILE');
  assert.ok(actor, 'the real clerk packet must contain the successful identity-bound full look');
  assert.ok(handle);
  assert.equal(actor.name, 'Avery');
  assert.equal(actor.summary, 'PRIVATE_PRESENT_PROFILE');
  assert.equal(JSON.stringify(people).includes('PRIVATE_OFFSTAGE_PROFILE'), false);
  assert.equal(people.some(person => typeof person.coverage === 'string' && person.coverage.includes('unavailable')), false);
});

for (const [label, legacy] of [['name-only','missing'],['empty-id',''],['whitespace-id','   ']]) {
  test(`hybrid enrichment keeps the ${label} legacy name fallback`, async t => {
    const {people, handle, legacyReads} = await projectedPeople(t, {shared:false,legacy});
    const actor = people.find(person => person.id === handle);
    assert.ok(actor, 'the actual native name read must still enrich a legacy row');
    assert.equal(actor.name, 'Avery');
    assert.equal(actor.summary, 'PRIVATE_PRESENT_PROFILE');
    assert.ok(legacyReads.includes('Avery'));
    assert.equal(legacyReads.includes(handle), false);
    assert.equal(JSON.stringify(people).includes('PRIVATE_OFFSTAGE_PROFILE'), false);
  });
}
