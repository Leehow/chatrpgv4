/** Native corrections through kernel-ts/turn-events.ts, using the existing disclosure authority. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,readJson,RpcClient,prepared,type Row} from './support.ts';

for(const kind of ['player-input-to-reply','already-read-to-reply','observed-to-player-speech'])test(`wrong optional speech binding omits ${kind} without rewriting the valid turn`,async t=>{
  const k=await kernel(t);await openTurn(k,'I tell Knott what I saw and read in my notebook.');
  const investigator=(await k.table('view')).investigators[0].name,npc='Steven Knott';
  const playerSpeech=kind==='observed-to-player-speech';
  const speaker=playerSpeech?investigator:npc,audience=[playerSpeech?npc:investigator];
  const actor=kind==='player-input-to-reply'||playerSpeech?npc:investigator;
  const acquired={actor,statement:`PRIVATE_ACQUIRED_${kind}`,mode:kind==='player-input-to-reply'?'heard':kind==='already-read-to-reply'?'read':'observed',
    ...(kind==='player-input-to-reply'?{source:investigator}:{}),state:'uncertain'};
  const materials=[{name:'room',kind:'description',visibility:'player',text:'A desk stands beside the window.'},
    {name:'reply',kind:'speech',visibility:'player',speaker,audience,text:'The office is open.'}];
  const event={name:'Already acquired account',summary:'An account was already acquired.',materials,
    knowledge:[{actor:investigator,statement:'A desk stands here.',mode:'observed',state:'accurate'},{...acquired,material:'reply'}]};
  const params={call_id:'t1-c1',effects:[{kind:'time',minutes:5}],event};
  const accepted=await k.table('apply',params),omitted=accepted.not_landed[0];
  assert.equal(omitted.code,'invalid_params');assert.match(omitted.message,/speech cognition must match/);
  assert.equal(omitted.details.field,'event.knowledge[1].material');
  assert.equal(omitted.details.knowledge_index,1);assert.equal(omitted.details.material_index,1);
  assert.equal(omitted.index,undefined,'the knowledge index is not a physical effect index');
  assert.deepEqual(omitted.details.mismatches,kind==='player-input-to-reply'?['source','audience']:['mode','source']);
  assert.deepEqual(omitted.details.expected,{mode:'heard',source:speaker,actor_in_audience:audience});
  assert.equal(accepted.outcome.knowledge_changes.length,1);
  assert.equal(accepted.outcome.knowledge_changes[0].statement,'A desk stands here.');
  assert.equal((await k.table('capsule')).where.clock.minutes,5);
  assert.deepEqual(await k.table('apply',params),{...accepted,replayed:true},'the original input identity replays its original result');
  assert.equal((await k.table('status')).receipts.filter((item:Row)=>item.kind==='time').length,1);
  const beforeCorrection=actor===investigator?(await k.table('capsule')).player_knows:await k.ok('npc.perspective',{campaign:'c1',name:actor});
  assert.equal(JSON.stringify(beforeCorrection).includes(acquired.statement),false);

  // Already acquired input/reading/observation is independent; no other knowledge row is discarded.
  const corrected=await k.table('apply',{call_id:'t1-c2',effects:[],event:{...event,name:'Corrected acquired account',corrects:'event:t1:Already acquired account',knowledge:[event.knowledge[0],acquired]}});
  assert.equal(corrected.outcome.knowledge_changes.filter((item:Row)=>item.event==='event:t1:Corrected acquired account').length,2);
  assert.ok(corrected.outcome.knowledge_changes.every((item:Row)=>item.status==='active'));
  assert.equal((await k.table('capsule')).where.clock.minutes,5);
  const owner=actor===investigator?(await k.table('capsule')).player_knows:await k.ok('npc.perspective',{campaign:'c1',name:actor});
  assert.ok(owner.cognition.some((item:Row)=>item.statement===acquired.statement));

  // A genuine prospective hearing uses the offered relation and waits for accepted delivery.
  const expected=omitted.details.expected;
  const futureHeard='PRIVATE_FUTURE_HEARD',futureRead='PRIVATE_FUTURE_NONSPEECH';
  const prospective=await k.table('apply',{call_id:'t1-c3',effects:[],event:{name:'Prospective acquisition',summary:'An acquisition awaits its delivery.',
    materials:[{...materials[1],name:'future-reply'},
      {name:'future-view',kind:'description',visibility:'player',text:'The notice is visible beside the door.'}],
    knowledge:[{actor:expected.actor_in_audience[0],source:expected.source,mode:expected.mode,state:'uncertain',statement:futureHeard,material:'future-reply'},
      {actor:investigator,mode:'observed',state:'accurate',statement:futureRead,material:'future-view'}]}});
  const pending=prospective.outcome.knowledge_changes.filter((item:Row)=>[futureHeard,futureRead].includes(item.statement));
  assert.equal(pending.length,2);assert.ok(pending.every((item:Row)=>item.status==='pending'));
  let capsule=await k.table('capsule');
  assert.equal(JSON.stringify(capsule.player_knows).includes(futureHeard),false);assert.equal(JSON.stringify(capsule.player_knows).includes(futureRead),false);
  const published=await k.table('narrate',{call_id:'t1-c4',text:'You pause before any reply.'});
  assert.deepEqual(published.disclosures,[],'unselected prospective materials are not activated by other prose');
  capsule=await k.table('capsule');
  assert.equal(JSON.stringify(capsule.player_knows).includes(futureHeard),false);assert.equal(JSON.stringify(capsule.player_knows).includes(futureRead),false);
  const saved=readJson(join(campaignDir(k.workspace),'turns','0001.json'));
  const original=saved.receipts.find((item:Row)=>item.kind==='event'&&item.event.name==='Already acquired account');
  assert.equal(original.event.knowledge.length,1);
  assert.equal(JSON.stringify(original).includes(acquired.statement),false,'the rejected binding never becomes a pending canonical row');
  const future=saved.receipts.find((item:Row)=>item.kind==='event'&&item.event.name==='Prospective acquisition');
  assert.equal(future.event.knowledge.length,2,'prospective non-speech bindings retain the same stored contract');
  assert.equal(future.event.knowledge[1].mode,'observed');assert.ok(future.event.knowledge[1].material.endsWith('/future-view'));
  await k.close();const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());
  assert.equal((await restarted.table('capsule')).where.clock.minutes,5);
  const recalled=await restarted.table('recall',{what:'memory',about:[actor]});
  assert.equal(recalled.hits.filter((item:Row)=>item.statement===acquired.statement&&item.authority==='canonical_event').length,1);
});

test('omitting a reverse speech binding keeps valid inventory, notes and time once across publication and restart',async t=>{
  const k=await kernel(t);await openTurn(k,'I write a note while Knott answers my question.');
  const draft={name:'Notebook',category:'item',description:'An ordinary writable carrier.',basis:'Ordinary fixture paper.',
    parameters:{charges:null,effects:[]},document:{text:'A',presentation:'notebook'},player_view:{description:'A notebook.',fields:[]}};
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'Notebook',to:'Thomas Hayes'}]});
  const params={call_id:'t1-c2',effects:[{kind:'time',minutes:5},{kind:'item',name:'Loose test slips',quantity:3},
    {kind:'object',name:'Notebook',from:'Thomas Hayes',to:'Thomas Hayes',document:{action:'append',text:'B'},why:'Write the chosen note.'}],
    event:{name:'Notes and reply',summary:'The visitor records the note while the clerk replies.',
      materials:[{name:'reply',kind:'speech',visibility:'player',speaker:'Steven Knott',audience:['Thomas Hayes'],text:'The office is open.'}],
      knowledge:[{actor:'Steven Knott',source:'Thomas Hayes',statement:'OMITTED_REVERSE_ACCOUNT',mode:'heard',state:'accurate',material:'reply'},
        {actor:'Thomas Hayes',statement:'The note is now written.',mode:'observed',state:'accurate'},
        {actor:'Thomas Hayes',source:'Steven Knott',statement:'PENDING_VALID_ACCOUNT',mode:'heard',state:'uncertain',material:'reply'}],
      relationships:[{actor:'Steven Knott',toward:'Thomas Hayes',statement:'Knott remains willing to answer.'}]}};
  const settled=await k.table('apply',params);
  assert.equal(settled.not_landed.length,1);assert.equal(settled.outcome.knowledge_changes.length,2);
  assert.equal(settled.outcome.knowledge_changes.find((item:Row)=>item.statement==='PENDING_VALID_ACCOUNT').status,'pending');
  const document=()=>k.ok('mods.document.view',{campaign:'c1',actor:'Thomas Hayes',name:'Notebook'});
  const paper=await document();assert.equal(paper.text,'AB');
  const before=readJson(join(campaignDir(k.workspace),'world.json'));
  assert.equal((await k.table('apply',params)).replayed,true);assert.deepEqual(await document(),paper);
  assert.deepEqual(readJson(join(campaignDir(k.workspace),'world.json')),before);
  await k.table('narrate',{call_id:'t1-c3',text:'You finish writing the note. No reply is heard yet.'});
  const saved=readJson(join(campaignDir(k.workspace),'turns','0001.json'));
  assert.equal(saved.receipts.filter((item:Row)=>item.kind==='time').length,1);
  assert.equal(saved.receipts.filter((item:Row)=>item.writing_result).length,1);
  const event=saved.receipts.find((item:Row)=>item.kind==='event').event;
  assert.equal(event.knowledge.length,2);assert.equal(JSON.stringify(event).includes('OMITTED_REVERSE_ACCOUNT'),false);
  const memory=await k.ok('memory.job',{campaign:'c1',turn:1});
  assert.equal(JSON.stringify(memory).includes('OMITTED_REVERSE_ACCOUNT'),false,'the background packet cannot recover an omitted row from canonical input');
  const npc=await k.ok('npc.perspective',{campaign:'c1',name:'Steven Knott'});
  assert.equal(JSON.stringify(npc).includes('OMITTED_REVERSE_ACCOUNT'),false);
  await k.close();const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());
  assert.equal((await restarted.table('capsule')).where.clock.minutes,5);
  assert.equal((await restarted.ok('mods.document.view',{campaign:'c1',actor:'Thomas Hayes',name:'Notebook'})).text,'AB');
  const sheet=readJson(join(campaignDir(k.workspace),'party/thomas-hayes.json'));
  assert.equal(sheet.equipment.find((item:Row)=>item.name==='Loose test slips').quantity,3);
  assert.equal(sheet.equipment.filter((item:Row)=>item.name==='Notebook').length,1);
  const recall=await restarted.table('recall',{what:'memory',about:['Steven Knott','Thomas Hayes']});
  assert.equal(JSON.stringify(recall).includes('OMITTED_REVERSE_ACCOUNT'),false);
  assert.equal(JSON.stringify((await restarted.table('capsule')).player_knows).includes('PENDING_VALID_ACCOUNT'),false);
});

test('optional speech omissions cannot hide hard event constraints or create an empty occurrence',async t=>{
  const k=await kernel(t);await openTurn(k);
  const material={name:'reply',kind:'speech',visibility:'player',speaker:'Steven Knott',audience:['Thomas Hayes'],text:'The office is open.'};
  const wrong={actor:'Steven Knott',source:'Thomas Hayes',statement:'REVERSE_ACCOUNT',mode:'heard',state:'accurate',material:'reply'};
  const cases:[string,Row,RegExp][]=[
    ['unknown actor',{...wrong,actor:'Unregistered person'},/unknown actor/],
    ['unknown source',{...wrong,source:'Unregistered source'},/unknown actor/],
    ['missing heard source',{...wrong,source:undefined},/heard source/],
    ['invalid mode',{...wrong,mode:'invented'},/knowledge/],
    ['invalid state',{...wrong,state:'invented'},/knowledge/],
    ['unknown field',{...wrong,extra:true},/knowledge\[1\]/],
    ['private binding',{...wrong,material:'secret'},/permitted public component/],
    ['unknown binding',{...wrong,material:'absent'},/permitted public component/],
    ['player belief',{...wrong,actor:'Thomas Hayes',mode:'belief'},/player belief/],
  ];
  const before=readJson(join(campaignDir(k.workspace),'world.json')),receipts=(await k.table('status')).receipts;
  for(const [name,knowledge,expected]of cases){
    const error=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:5}],event:{name,summary:'A proposed reply.',
      materials:[material,{name:'secret',kind:'context',visibility:'keeper',text:'PRIVATE_CONTEXT'}],knowledge:[wrong,knowledge]}});
    assert.equal(error.code,'invalid_params');assert.match(error.message,expected);
    assert.deepEqual(readJson(join(campaignDir(k.workspace),'world.json')),before);assert.deepEqual((await k.table('status')).receipts,receipts);
  }
  const empty=await k.tableErr('apply',{call_id:'t1-c1',effects:[],event:{name:'Empty after omission',materials:[material],knowledge:[wrong]}});
  assert.match(empty.message,/requires an occurrence/);
  const invalidEffect=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:-1}],event:{name:'Wrong physical effect',summary:'A reply.',materials:[material],knowledge:[wrong]}});
  assert.equal(invalidEffect.code,'invalid_params');assert.equal(invalidEffect.details.index,0);
  assert.deepEqual(readJson(join(campaignDir(k.workspace),'world.json')),before);assert.deepEqual((await k.table('status')).receipts,receipts);
});
