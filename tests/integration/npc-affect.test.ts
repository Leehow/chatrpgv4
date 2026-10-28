/** Contract §259.6: fear and pressure, raised by events, set by the Keeper, settled back as the day parts pass. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {rmSync} from 'node:fs';
import {importSource,kernel,openTurn,campaignDir,readJson,CONTENT_DIR,type RpcClient,type Row} from './support.ts';

const KNOTT='npc-steven-knott';
const ledger=(k:RpcClient)=>readJson(join(campaignDir(k.workspace),'npc-ledger.json'));
const card=(capsule:Row)=>capsule.present.find((p:Row)=>p.name==='Steven Knott');

test('the Keeper sets fear; the card shows it beside the mood; each day part crossed brings it back one step',async t=>{
 const k=await kernel(t);await openTurn(k);
 await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',fear:4,why:'the shot through the window'}]});
 await k.table('narrate',{call_id:'t1-c2',text:'诺特缩在桌后。'});
 assert.equal(ledger(k)[KNOTT].affect.fear.level,4);
 let capsule=(await k.table('player_input',{text:'我安慰诺特。'})).capsule;
 assert.equal(card(capsule).affect.fear.level,4);
 assert.equal(card(capsule).affect.fear.because.at(-1),'turn 1: keeper');
 // From the module's opening hour, 300 minutes crosses two of the capsule's day-part edges at most and at least one.
 await k.table('apply',{call_id:'t2-c1',effects:[{kind:'time',minutes:300,why:'they wait out the afternoon'}]});
 await k.table('narrate',{call_id:'t2-c2',text:'几个小时过去了。'});
 const api=await importSource('kernel-ts/npc/affect.ts'),capsuleApi=await importSource('kernel-ts/read/capsule.ts');
 const graphApi=await importSource('kernel-ts/read/module-graph.ts');
 const graph=new graphApi.ModuleGraph('the-haunting',readJson(join(CONTENT_DIR,'starters/the-haunting/module-graph.json')),'t',readJson(join(CONTENT_DIR,'modules/module-graph-contract-v3.json')).actor_dossier);
 const start=capsuleApi.clockStart(graph).minutes,before=readJson(join(campaignDir(k.workspace),'turns','0001.json')).world.clock.minutes;
 const after=readJson(join(campaignDir(k.workspace),'turns','0002.json')).world.clock.minutes;
 const crossed=api.dayPartOrdinal(start,after)-api.dayPartOrdinal(start,before);
 assert.ok(crossed>=1,`${crossed} day parts crossed`);
 assert.equal(ledger(k)[KNOTT].affect.fear.level,Math.max(0,4-crossed));
});

test('fear and pressure are their own effect and stay in range',async t=>{
 const k=await kernel(t);await openTurn(k);
 const mixed=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',fear:2,stance:'hostile',why:'x'}]});
 assert.equal(mixed.code,'invalid_params');assert.deepEqual(mixed.details.conflicts,['stance']);
 const high=await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'npc',name:'Steven Knott',pressure:9,why:'x'}]});
 assert.equal(high.details.field,'npc.pressure');
});

test('a person very afraid moves the stakes die a rung, and the ledger rebuilds the same levels',async t=>{
 const k=await kernel(t);await openTurn(k);
 await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',fear:5,pressure:5,why:'cornered'}]});
 const result=await k.ok('npc.stakes',{campaign:'c1',name:'Steven Knott'});
 const receipt=(await k.table('status')).receipts.find((r:Row)=>r.kind==='roll'&&r.family==='stakes');
 assert.ok(receipt.shifts.includes('fear_at_least')&&receipt.shifts.includes('pressure_at_least'),JSON.stringify(receipt.shifts));
 assert.ok(result.stakes);
 await k.table('narrate',{call_id:'t1-c2',text:'诺特盯着门。'});
 const folded=ledger(k)[KNOTT].affect;
 rmSync(join(campaignDir(k.workspace),'npc-ledger.json'));await k.table('open');
 assert.deepEqual(ledger(k)[KNOTT].affect,folded);
});

test('events raise the levels by the table, once a turn each; a death near them shakes those tied to the dead',async()=>{
 const api=await importSource('kernel-ts/write/contributions.ts'),graphApi=await importSource('kernel-ts/read/module-graph.ts');
 const graph=new graphApi.ModuleGraph('the-haunting',readJson(join(CONTENT_DIR,'starters/the-haunting/module-graph.json')),'t',readJson(join(CONTENT_DIR,'modules/module-graph-contract-v3.json')).actor_dossier);
 const attitude=readJson(join(CONTENT_DIR,'rulesets/coc7/rules-json/npc-attitude.json')),affect=readJson(join(CONTENT_DIR,'rulesets/coc7/rules-json/npc-affect.json'));
 const ledger:Row={};
 const blow={kind:'roll',family:'combat',npc:'steven-knott',actor:'inv-1',level:'regular',passed:true};
 api.foldNpcTurn(ledger,graph,{turn:1,receipts:[{...blow,id:'r1'},{...blow,id:'r2'}]},attitude,affect);
 assert.equal(ledger[KNOTT].affect.fear.level,affect.events.attacked.fear,'two blows in one turn are one event');
 api.foldNpcTurn(ledger,graph,{turn:2,receipts:[{id:'r3',kind:'roll',family:'social',approach:'intimidate',npc:'steven-knott',actor:'inv-1',level:'extreme',passed:true}]},attitude,affect);
 assert.equal(ledger[KNOTT].affect.fear.level,Math.min(5,affect.events.attacked.fear+affect.events.intimidated.by_level.extreme));
 // No starter ties two people; tie Knott to Michael Thomas the way a book would (§17.2's allied-with).
 const raw=readJson(join(CONTENT_DIR,'starters/the-haunting/module-graph.json'));
 const sample=raw.relations.find((r:Row)=>r.relation_kind==='member-of');
 raw.relations.push({...sample,relation_id:'relation:test-knott-thomas',from_node_id:KNOTT,to_node_id:'npc-michael-thomas',relation_kind:'allied-with'});
 const tiedGraph=new graphApi.ModuleGraph('the-haunting',raw,'t2',readJson(join(CONTENT_DIR,'modules/module-graph-contract-v3.json')).actor_dossier);
 const knottNode=tiedGraph.nodes.get(KNOTT);
 assert.ok(tiedGraph.npcTies(knottNode).some((tie:Row)=>tie.node.node_id==='npc-michael-thomas'),'the tie reads');
 const tied=knottNode,dead=tiedGraph.nodes.get('npc-michael-thomas');
 const after:Row={};
 api.foldNpcTurn(after,tiedGraph,{turn:3,receipts:[{id:'n1',kind:'npc',npc:dead.node_id,dead:true}]},attitude,affect);
 assert.equal(after[tied.node_id].affect.pressure.level,affect.events.tied_person_dead.pressure);
});
