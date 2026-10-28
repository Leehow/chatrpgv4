/** Contract §259.5: a failed request freezes what it was after, says what is still given, and holds at delivery. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {rmSync} from 'node:fs';
import {kernel,openTurn,campaignDir,readJson,type RpcClient,type Row} from './support.ts';

const KNOTT='npc-steven-knott';
const knott=(capsule:Row)=>capsule.present.find((p:Row)=>p.name==='Steven Knott');
const ledger=(k:RpcClient)=>readJson(join(campaignDir(k.workspace),'npc-ledger.json'));
const record=(k:RpcClient,turn:number)=>readJson(join(campaignDir(k.workspace),'turns',String(turn).padStart(4,'0')+'.json'));

/** A table where an unfriendly Knott refused one open clue on turn 2: the first seed whose roll fails. */
async function refused(t:any){
 for(let seed=1;seed<=40;seed++){
  const k=await kernel(t,{env:{COC_KERNEL_SEED:String(seed)}});await openTurn(k);
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',stance:'unfriendly',why:'test'}]});
  await k.table('narrate',{call_id:'t1-c2',text:'诺特冷冷地看着我。'});
  const capsule=(await k.table('player_input',{text:'我请诺特告诉我。'})).capsule;
  const row=knott(capsule).asks.check.find((a:Row)=>a.for!=='ordinary favour');
  const [skill,other]=Object.keys(row.skills);
  const rolled=await k.table('resolve',{call_id:'t2-c1',action:{intent:'social',target:'Steven Knott',ask:row.ask,skill}});
  const receipt=(await k.table('status')).receipts?.find((r:Row)=>r.id===rolled.receipt)??null;
  if(rolled.outcome?.passed===false||receipt?.passed===false||rolled.outcome?.success===false)return {k,row,skill,other,rolled};
  await k.close();
 }
 throw new Error('no seed of 40 failed the roll');
}

test('a failed request freezes its target, says what is still given, and refuses the same skill again',async t=>{
 const {k,row,skill,other}=await refused(t);
 const again=await k.tableErr('resolve',{call_id:'t2-c2',action:{intent:'social',target:'Steven Knott',ask:row.ask,skill}});
 assert.equal(again.code,'turn_state');assert.equal(again.details.reason,'ask_blocked');
 const handover=await k.tableErr('apply',{call_id:'t2-c3',effects:[{kind:'clue',clue:row.for,from:'Steven Knott',how:'he tells it'}]});
 assert.equal(handover.details.reason,'ask_blocked');
 await k.table('narrate',{call_id:'t2-c4',text:'诺特摇了摇头。'});
 const failed=record(k,2).receipts.find((r:Row)=>r.kind==='roll'&&r.ask);
 assert.deepEqual(failed.scope.blocked,[{kind:'open_clue',clue:row.for}]);
 assert.ok(failed.scope.still_open.includes('ordinary favour'),'an unfriendly person still does an ordinary favour');
 const block=ledger(k)[KNOTT].blocked.find((b:Row)=>b.key===row.for);
 assert.equal(block.skill,skill);assert.equal(block.word,'unfriendly');
 const capsule=(await k.table('player_input',{text:'我换个说法。'})).capsule;
 assert.deepEqual(knott(capsule).asks.blocked.map((b:Row)=>b.for),[row.for]);
 if(other){
  const tried=await k.table('resolve',{call_id:'t3-c1',action:{intent:'social',target:'Steven Knott',ask:row.ask,skill:other}});
  assert.ok(tried.receipt,'another skill is another approach and rolls');
 }
});

test('a warmer attitude lifts the freeze, and the ledger rebuilds the same freezes',async t=>{
 const {k,row}=await refused(t);
 await k.table('narrate',{call_id:'t2-c2',text:'诺特摇了摇头。'});
 const frozen=ledger(k)[KNOTT].blocked;
 rmSync(join(campaignDir(k.workspace),'npc-ledger.json'));await k.table('open');
 assert.deepEqual(ledger(k)[KNOTT].blocked,frozen,'rebuilt from the turn records');
 await k.table('player_input',{text:'我帮诺特找回了他的弟弟。'});
 await k.table('apply',{call_id:'t3-c1',effects:[{kind:'npc',name:'Steven Knott',stance:'friendly',why:'the party found his brother'}]});
 await k.table('narrate',{call_id:'t3-c2',text:'诺特松了口气。'});
 assert.ok(!ledger(k)[KNOTT].blocked.some((b:Row)=>b.key===row.for));
});
