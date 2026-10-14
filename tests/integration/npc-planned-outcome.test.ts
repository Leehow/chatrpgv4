/** Ordinary plan outcomes use the existing intention transaction, not an intermediate attempted write. */
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {test} from 'node:test';
import {campaignDir,kernel,openTurn,readJson,type Row} from './support.ts';

const npc='Steven Knott';

for(const outcome of ['done','failed'])test(`an ordinary planned action can become ${outcome} directly without changing resources`,async t=>{
  const k=await kernel(t);await openTurn(k,'I ask Knott to arrange an appointment.');
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'damage',dice:'1D1',why:'A fixture bruise.'}]});
  const before=await k.table('look',{focus:'investigator'});
  const intention='Arrange an appointment for the visitor later.';
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'npc',name:npc,intends:intention,outcome:'planned'}]});
  const plan=(await k.table('status')).receipts.find((receipt:Row)=>receipt.intent?.outcome==='planned').intent;
  await k.table('narrate',{call_id:'t1-c3',text:'Knott offers to arrange an appointment later.'});
  await k.table('player_input',{text:'I ask whether he arranged the appointment.'});
  const result=outcome==='done'?{intends:intention,outcome}:{intent_ref:plan.ref,intent_outcome:outcome};
  await k.table('apply',{call_id:'t2-c1',effects:[{kind:'npc',name:npc,...result}]});
  const receipts=(await k.table('status')).receipts;
  const settled=receipts.find((receipt:Row)=>receipt.intent?.ref===plan.ref);
  assert.equal(settled.previous,'planned');assert.equal(settled.intent.outcome,outcome);
  assert.ok(!receipts.some((receipt:Row)=>receipt.intent?.outcome==='attempted'));
  assert.deepEqual(await k.table('look',{focus:'investigator'}),before,'an intention result changes no rule-owned resource or condition');
  const situation=await k.ok('npc.situation',{campaign:'c1',name:npc});
  assert.equal(situation.done.find((intent:Row)=>intent.ref===plan.ref).status,outcome);
  await k.table('narrate',{call_id:'t2-c2',text:'Knott reports the appointment result.'});
  await k.table('player_input',{text:'I confirm the same result without asking for another attempt.'});
  const directory=campaignDir(k.workspace),intentRow=()=>Object.values(readJson(join(directory,'npc-ledger.json')))
    .flatMap((entry:any)=>entry.intents??[]).find((intent:Row)=>intent.ref===plan.ref);
  const original=structuredClone(intentRow()),priorTurn=readJson(join(directory,'turns/0002.json')),
    priorWorld=readJson(join(directory,'world.json'));
  assert.equal(original.status,outcome);assert.equal(original.last_turn,2);
  const repeated=await k.table('apply',{call_id:'t3-c1',effects:[{kind:'npc',name:npc,...result}]});
  assert.equal(repeated.receipts.length,1,'a same-outcome acknowledgment records only its bookkeeping receipt');
  const acknowledgment=(await k.table('status')).receipts;
  assert.equal(acknowledgment.length,1);assert.equal(acknowledgment[0].kind,'npc');
  assert.equal(acknowledgment[0].intent.ref,plan.ref);assert.equal(acknowledgment[0].intent.outcome,outcome);
  assert.deepEqual((await k.ok('npc.situation',{campaign:'c1',name:npc})).done.find((intent:Row)=>intent.ref===plan.ref),
    situation.done.find((intent:Row)=>intent.ref===plan.ref),'acknowledgment does not rewrite the first intention result');
  assert.deepEqual(await k.table('look',{focus:'investigator'}),before);
  assert.deepEqual(readJson(join(directory,'world.json')),priorWorld,'acknowledgment executes no physical change');
  for(const [index,effect] of [
    {intent_ref:plan.ref,outcome:'attempted'},
    {intent_ref:plan.ref,outcome:outcome==='done'?'failed':'done'},
    {to:'away',intent_ref:plan.ref,intent_outcome:outcome},
  ].entries()){
    const rejected=await k.tableErr('apply',{call_id:`t3-c${index+2}`,effects:[{kind:'npc',name:npc,...effect}]});
    assert.equal(rejected.details.reason,'intent_settled');
    assert.deepEqual((await k.table('status')).receipts,acknowledgment);
    assert.deepEqual(readJson(join(directory,'world.json')),priorWorld);
  }
  await k.table('narrate',{call_id:'t3-c5',text:'The same settled result stands.'});
  await k.table('player_input',{text:'I turn to a different matter.'});
  assert.deepEqual(intentRow(),original,'status, last turn, attempts and original fields survive receipt folding unchanged');
  assert.deepEqual(readJson(join(directory,'turns/0002.json')),priorTurn,'the first settlement and its receipts are retained');
  assert.deepEqual(await k.table('look',{focus:'investigator'}),before);
});

for(const status of ['planned','attempted'])test(`a generated ${status} action still rejects an unsupported intention result`,async t=>{
  const k=await kernel(t);await openTurn(k,'I watch Knott prepare a mechanical action.');
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:npc,intends:'Try to force the locked mechanism.',outcome:status,_generated:true}]});
  const before=await k.table('look',{focus:'investigator'}),receipts=(await k.table('status')).receipts;
  const generated=receipts.find((receipt:Row)=>receipt.intent?.generated===true).intent;
  for(const [index,outcome] of ['done','failed'].entries()){
    const error=await k.tableErr('apply',{call_id:`t1-c${index+2}`,effects:[{kind:'npc',name:npc,intent_ref:generated.ref,outcome}]});
    assert.equal(error.details.reason,'table_act_unsettled');assert.equal(error.details.index,0);
    assert.deepEqual((await k.table('status')).receipts,receipts);
    assert.deepEqual(await k.table('look',{focus:'investigator'}),before);
  }
  const situation=await k.ok('npc.situation',{campaign:'c1',name:npc});
  assert.equal(situation.done.find((intent:Row)=>intent.ref===generated.ref).status,status);
});
