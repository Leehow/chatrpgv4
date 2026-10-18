/** §237.57: the present actor's registered identity reaches the existing native look. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {cpSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel, ROOT, MODULE, PREGEN, RpcClient, rpcCommand, importSource} from '../integration/support.ts';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

function collisionContent(workspace, shared = true, pressure = false, bothPresent = false) {
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
      properties:{...(pressure?{personality:'PRIVATE_PRESENT_DETAIL '.repeat(220),agenda:'Attend the public office. '.repeat(20)}:{}),
        runtime_projection:{kind:'npc',record:{npc_id:'identity-present',display_name:'Avery'}}}},
    {node_id:'npc-identity-offstage',node_kind:'npc',name:shared?'Avery':'Blair',summary:'PRIVATE_OFFSTAGE_PROFILE',visibility:'keeper-only',
      properties:{runtime_projection:{kind:'npc',record:{npc_id:'identity-offstage',display_name:shared?'Avery':'Blair'}}}},
  );
  data.relations.push(
    {relation_id:'identity-present-location',from_node_id:'npc-identity-present',relation_kind:'present-in',to_node_id:'scene-identity-office',properties:{}},
    {relation_id:'identity-offstage-location',from_node_id:'npc-identity-offstage',relation_kind:'present-in',to_node_id:bothPresent?'scene-identity-office':'scene-identity-offstage',properties:{}},
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

async function projectedPeople(t, {shared = true, legacy, pressure = false} = {}) {
  const engine = createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null,npcAct:null});
  let handle, people;
  const legacyReads = [];
  const capsules = [];
  const frames = [];
  const table = await openTable({legacyDeliveryFixtures:false,realKernel:true,seedCampaign:false,
    runDriver:engine.runDriver,env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_KERNEL_CMD:JSON.stringify(rpcCommand())},
    prepareWorkspace:async workspace => {
      const content = collisionContent(workspace, shared, pressure);
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
      {name:'identity-native-reads',factory:pi => {
        let forwarding = false;
        pi.events.on('coc:kernel-bridge', binding => {
          if (forwarding || !binding?.call) return;
          const original = binding.call.bind(binding);
          forwarding = true;
          try { pi.events.emit('coc:kernel-bridge', {...binding,call:async (method, params, ...rest) => {
            if (method === 'table.look' && params.focus === 'npc') legacyReads.push(params.name);
            const value = await original(method, params, ...rest);
            if (method !== 'table.capsule' || !Array.isArray(value.present)) return value;
            capsules.push(value);
            if (legacy === undefined) return value;
            return {...value,present:value.present.map(person => {
              if (person.name !== 'Avery') return person;
              const copy = {...person};
              if (legacy === 'missing') delete copy.id; else copy.id = legacy;
              return copy;
            })};
          }}); } finally { forwarding = false; }
        });
      }},
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
  assert.equal(JSON.stringify(frames).includes('PRIVATE_PRESENT_DETAIL'), false);
  return {people, handle, legacyReads, capsules};
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

test('native default budget stubs preserve the registered identity used by actual hybrid enrichment', async t => {
  const {people, handle, legacyReads, capsules} = await projectedPeople(t, {pressure:true});
  assert.ok(capsules.length, 'the actual hybrid must request the native capsule');
  for (const capsule of capsules) {
    const present = capsule.present.filter(person => person.name === 'Avery');
    assert.equal(present.length, 1);
    assert.equal(present[0].truncated, true, 'the unchanged native present budget must produce a real stub');
    assert.equal(present[0].id, handle, 'budget fitting must retain the producer identity');
    assert.equal(Object.hasOwn(present[0], 'personality'), false);
    assert.equal(JSON.stringify(present).includes('PRIVATE_OFFSTAGE_PROFILE'), false);
  }
  assert.ok(legacyReads.includes(handle), 'the actual implicit native look must use the retained handle');
  assert.equal(legacyReads.includes('Avery'), false, 'the colliding display name must not replace the identity');
  const actor = people.find(person => person.summary === 'PRIVATE_PRESENT_PROFILE');
  assert.ok(actor, 'the actual Keeper packet must contain the successful full actor read after truncation');
  assert.equal(actor.name, 'Avery');
  assert.equal(JSON.stringify(people).includes('PRIVATE_OFFSTAGE_PROFILE'), false);
  assert.equal(people.some(person => typeof person.coverage === 'string' && person.coverage.includes('unavailable')), false);
});

test('budget stubs preserve nonempty identity verbatim and keep legacy rows without an identity', async () => {
  const {fitPresent} = await importSource('kernel-ts/read/assemble.ts');
  for (const id of [undefined, '', '   ', 'identity-present', ' identity-present ']) {
    const rows = [{name:'Avery',...(id === undefined?{}:{id}),kind:'npc',
      wants:'Attend the public office. '.repeat(20),personality:{description:'PRIVATE_PRESENT_DETAIL '.repeat(220)}}];
    assert.equal(fitPresent(rows, 3072), true);
    assert.deepEqual(rows, [{name:'Avery',...(typeof id === 'string' && id.trim()?{id}:{}),kind:'npc',truncated:true}]);
  }
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

test('a native actor refusal reaches the same Keeper with the registered handle and an explicit corrected event', async t => {
  const engine = createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},npcAct:null,decision:{decide:async batch=>({batchId:batch.id,status:'complete',
    answers:Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'noul',noul:batch.family==='held-act-outcome'||question.key.startsWith('restriction_')?.01:.99}])),
    coverage:{required:batch.questions.map(question=>question.key),answered:batch.questions.map(question=>question.key),unknown:[]},issues:[]})}});
  let handle, offstage, party, beforeWorld, privateError, recoveryActor, partyRecovery, offstageOffered, atomicUnchanged, failedFrameCount, correctedSucceeded;
  const frames = [];
  const event = name => ({name:'office-answer',summary:'PRIVATE_EVENT_CAUSE',
    materials:[{name:'office-reply',text:'The office stays open.',kind:'speech',visibility:'player',speaker:name,audience:[party]}],
    knowledge:[{actor:name,statement:'The visitor asked about office hours.',mode:'heard',state:'accurate',source:party}],
    relationships:[{actor:name,toward:party,statement:'Willing to answer this visitor.'}]});
  const table = await openTable({legacyDeliveryFixtures:false,realKernel:true,seedCampaign:false,
    runDriver:engine.runDriver,env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_KERNEL_CMD:JSON.stringify(rpcCommand())},
    prepareWorkspace:async workspace => {
      const content = collisionContent(workspace);
      const native = new RpcClient(workspace, {content});
      try {
        await native.ok('campaign.create', {id:'test-camp',module:MODULE,pregen:PREGEN,play_language:'en'});
        handle = (await native.ok('table.look', {campaign:'test-camp',focus:'npc',name:'npc-identity-present'})).id;
        offstage = (await native.ok('table.look', {campaign:'test-camp',focus:'npc',name:'npc-identity-offstage'})).id;
        party = (await native.ok('table.look', {campaign:'test-camp',focus:'investigator'})).name;
        const ambiguous = await native.call('table.look', {campaign:'test-camp',focus:'npc',name:'Avery'});
        assert.equal(ambiguous.ok, false);
        assert.equal(ambiguous.error.code, 'unknown_entity');
        assert.equal(ambiguous.error.details.candidates.length, 2);
        assert.notEqual(handle, offstage, 'both existing identities remain separate');
        await native.ok('table.narrate', {campaign:'test-camp',call_id:'t0-c1',text:'You wait in the public office.'});
      } finally { await native.close(); }
      process.env.PI_COC_KERNEL_CMD = JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',content]);
    },
    extraExtensions:[{name:'actor-recovery-stream',factory:pi => pi.events.on('coc:final-delivery', frame => frames.push(frame))},
      {name:'actor-recovery-driver',factory:engine.extension}],
    responses:[
      () => {
        beforeWorld = readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8');
        return fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:5}],event:event('Avery')})],{stopReason:'toolUse'});
      },
      context => {
        const result = context.messages.filter(message=>message.role==='toolResult'&&message.toolName==='apply').at(-1);
        assert.ok(result?.isError, 'the actual native ambiguity must remain an error, not an automatic binding');
        privateError = result.content.filter(part=>part.type==='text').map(part=>part.text).join('\n');
        const actorsLine = privateError.split('\n').find(line=>line.startsWith('actors: '));
        assert.ok(actorsLine, 'the actual private tool result exposes the existing recovery actors');
        const actors = JSON.parse(actorsLine.slice('actors: '.length));
        recoveryActor = actors.find(value=>value.name==='Avery');
        partyRecovery = actors.find(value=>value.name===party);
        offstageOffered = actors.some(value=>value.id===offstage);
        atomicUnchanged = readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')===beforeWorld;
        failedFrameCount = frames.length;
        if (!recoveryActor?.id) return fauxAssistantMessage('{{reference}}No recovery identity was supplied.');
        return fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:5}],event:event(recoveryActor.id)})],{stopReason:'toolUse'});
      },
      context => {
        const result = context.messages.filter(message=>message.role==='toolResult'&&message.toolName==='apply').at(-1);
        correctedSucceeded = !!result&&!result.isError;
        return fauxAssistantMessage('{{public}}{{say:Avery}}The office stays open.{{/say}}');
      },
    ],
  });
  t.after(()=>table.dispose());
  await table.session.prompt('I ask Avery about office hours and wait five minutes while he answers.');
  assert.deepEqual(table.extensionErrors, []);
  assert.ok(privateError.includes('invalid_params'));
  assert.equal(recoveryActor?.id, handle, 'the native refusal must carry its existing operational identity to the same Keeper');
  assert.deepEqual(partyRecovery, {name:party}, 'party recovery shape is unchanged');
  assert.equal(offstageOffered, false);
  assert.equal(atomicUnchanged, true, 'the invalid actor rolls the whole proposed time/event batch back');
  assert.equal(failedFrameCount, 0, 'the rejected event and its private diagnosis publish no story');
  assert.equal(correctedSucceeded, true, 'the same Keeper receives the corrected native success');
  const record = JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  const events = record.receipts.filter(receipt=>receipt.kind==='event');
  assert.equal(events.length, 1);
  const saved = events[0].event;
  assert.equal(saved.materials[0].speaker.id, handle);
  assert.equal(saved.knowledge[0].actor.id, handle);
  assert.equal(saved.relationships[0].actor.id, handle);
  assert.equal(JSON.stringify(saved).includes(offstage), false);
  assert.equal(record.receipts.filter(receipt=>receipt.kind==='time').length, 1);
  assert.equal(record.world.clock.minutes, 5);
  const publicText = frames.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join('');
  assert.ok(publicText.includes('The office stays open.'));
  assert.equal(JSON.stringify(frames).includes('PRIVATE_'), false);
  assert.equal(publicText.includes(handle)||publicText.includes(offstage), false);
});

test('two present actors with one display name remain ambiguous and expose both existing recovery identities', async t => {
  const client = await kernel(t);
  const content = collisionContent(client.workspace, true, false, true);
  await client.close();
  const native = new RpcClient(client.workspace, {content});
  t.after(()=>native.close());
  await native.ok('campaign.create', {id:'identity-table',module:MODULE,pregen:PREGEN,play_language:'en'});
  await native.ok('table.open', {campaign:'identity-table'});
  await native.ok('table.narrate', {campaign:'identity-table',call_id:'t0-c1',text:'You enter the public office.'});
  const input = await native.ok('table.player_input', {campaign:'identity-table',text:'I wait five minutes and ask Avery about the office.'});
  const identities = input.capsule.present.filter(person=>person.name==='Avery').map(person=>person.id);
  assert.equal(new Set(identities).size, 2);
  const party = (await native.ok('table.look', {campaign:'identity-table',focus:'investigator'})).name;
  const worldPath = join(client.workspace,'.coc/campaigns/identity-table/world.json');
  const before = readFileSync(worldPath,'utf8');
  const result = await native.call('table.apply', {campaign:'identity-table',call_id:'t1-c1',effects:[{kind:'time',minutes:5}],
    event:{name:'ambiguous-answer',materials:[{name:'answer',text:'The office stays open.',kind:'speech',visibility:'player',speaker:'Avery',audience:[party]}]}});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_params');
  const actors = result.error.details.actors.filter(actor=>actor.name==='Avery');
  assert.equal(actors.length, 2);
  assert.deepEqual(actors.map(actor=>actor.id).sort(), identities.sort());
  assert.equal(readFileSync(worldPath,'utf8'), before, 'neither same-name actor is selected and the full batch remains unlanded');
});
