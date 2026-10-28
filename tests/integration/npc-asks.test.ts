/** Contract §259.4: what a person can be asked for, settled by the host as grant, check or impossible. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {importSource,kernel,openTurn,campaignDir,readJson,CONTENT_DIR,type RpcClient,type Row} from './support.ts';

const REQUESTS=readJson(join(CONTENT_DIR,'rulesets','coc7','rules-json','npc-requests.json'));
const knott=(capsule:Row)=>capsule.present.find((p:Row)=>p.name==='Steven Knott');
const receiptsOf=(k:RpcClient,turn:number)=>readJson(join(campaignDir(k.workspace),'turns',String(turn).padStart(4,'0')+'.json')).receipts as Row[];
async function setAttitude(k:RpcClient,stance:string){
 await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',stance,why:'test'}]});
 await k.table('narrate',{call_id:'t1-c2',text:'诺特看着我。'});
 return (await k.table('player_input',{text:'我请诺特帮忙。'})).capsule;
}

test('a neutral person gives what they know openly and an ordinary favour without a roll',async t=>{
 const k=await kernel(t);const {capsule}=await openTurn(k) as Row;
 const asks=knott(capsule).asks;
 assert.ok(asks.grant.length>=2,JSON.stringify(asks));
 assert.equal(asks.grant.at(-1),'ordinary favour');
 assert.ok(!asks.check&&!asks.impossible);
 assert.match(String(capsule.head),/A good impression is not consent/);
 const look=(await k.table('look',{focus:'npc'})).present.find((p:Row)=>p.name==='Steven Knott');
 assert.deepEqual(look.asks,asks,'look and the capsule say the same');
});

test('a hostile person needs a roll for the same things, two steps harder',async t=>{
 const k=await kernel(t);await openTurn(k);
 const asks=knott(await setAttitude(k,'hostile')).asks;
 assert.equal(REQUESTS.difficulty_shift_by_attitude.hostile,2);
 assert.ok(!asks.grant,'nothing is given to a hostile person without a roll');
 const favour=asks.check.find((row:Row)=>row.for==='ordinary favour');
 assert.ok(favour&&Object.keys(favour.skills).length>0,JSON.stringify(asks));
 for(const difficulty of Object.values(favour.skills))assert.ok(['hard','extreme'].includes(String(difficulty)),String(difficulty));
});

test('resolve binds an ask: grant and unknown rows refuse, a check row rolls one of its skills and records the row',async t=>{
 const k=await kernel(t);const {capsule}=await openTurn(k) as Row;
 const granted=await k.tableErr('resolve',{call_id:'t1-c1',action:{intent:'social',target:'Steven Knott',ask:'ask_1',skill:'Persuade'}});
 assert.equal(granted.code,'turn_state');assert.equal(granted.details.reason,'ask_granted');
 const missing=await k.tableErr('resolve',{call_id:'t1-c2',action:{intent:'social',target:'Steven Knott',ask:'ask_99',skill:'Persuade'}});
 assert.equal(missing.code,'invalid_params');assert.ok(missing.details.options.includes('ask_1'));
 const next=await setAttitude(k,'unfriendly');
 const row=knott(next).asks.check.find((a:Row)=>a.for!=='ordinary favour');
 assert.ok(row,'an unfriendly person makes the open clue a roll');
 const wrong=await k.tableErr('resolve',{call_id:'t2-c1',action:{intent:'social',target:'Steven Knott',ask:row.ask,skill:'Spot Hidden'}});
 assert.equal(wrong.code,'invalid_params');assert.deepEqual(wrong.details.options,Object.keys(row.skills));
 const [skill,rowDifficulty]=Object.entries(row.skills)[0] as [string,string];
 const rolled=await k.table('resolve',{call_id:'t2-c2',action:{intent:'social',target:'Steven Knott',ask:row.ask,skill,eased_by:'he showed the clipping'}});
 await k.table('narrate',{call_id:'t2-c3',text:'诺特犹豫了。'});
 const receipt=receiptsOf(k,2).find((r:Row)=>r.id===rolled.receipt);
 assert.ok(receipt,'the roll receipt');
 assert.deepEqual({ask:receipt.ask.ask,clue:receipt.ask.what.clue,eased_by:receipt.ask.eased_by},{ask:row.ask,clue:row.for,eased_by:'he showed the clipping'});
 const api=await importSource('kernel-ts/npc/asks.ts');
 assert.equal(receipt.difficulty??receipt.check?.difficulty,api.shiftedDifficulty(rowDifficulty,-1),'the reason lowered the row one step');
});

test('past extreme a request is impossible, and asking it is refused without a roll',async t=>{
 const api=await importSource('kernel-ts/npc/asks.ts');
 assert.equal(api.shiftedDifficulty('hard',1),'extreme');
 assert.equal(api.shiftedDifficulty('hard',2),null);
 assert.equal(api.shiftedDifficulty('regular',-1),'regular');
 const k=await kernel(t);await openTurn(k);
 const table={...REQUESTS,difficulty_shift_by_attitude:{...REQUESTS.difficulty_shift_by_attitude,hostile:3}};
 const graphApi=await importSource('kernel-ts/read/module-graph.ts');
 const raw=readJson(join(CONTENT_DIR,'starters/the-haunting/module-graph.json'));
 const graph=new graphApi.ModuleGraph('the-haunting',raw,'test',readJson(join(CONTENT_DIR,'modules/module-graph-contract-v3.json')).actor_dossier);
 const world=readJson(join(campaignDir(k.workspace),'world.json'));
 const rows=api.asksFor(graph,world,graph.find('Steven Knott',['npc']),'hostile',table);
 assert.ok(rows.every((r:Row)=>r.tier==='impossible'),JSON.stringify(rows));
 assert.throws(()=>api.bindAsk(graph,world,{intent:'social',target:'Steven Knott',ask:rows[0].ask,skill:'Persuade'},'hostile',table),
  (error:any)=>error.details?.reason==='ask_impossible');
});
