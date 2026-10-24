/**
 * Contract §258.13: deal marks read back from the delivered reply in the background (owner 2026-10-24). PipiCOC app, Blood
 * Road: the owner was paid to fix the radiator and to fit four tyres by evening, and the deal ledger stayed empty; the Keeper
 * never marked an agreement, and a service priced with cash never was a proposal.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importSource} from '../integration/support.ts';
import {dealQuestions,decideDeals,DEAL_MARK_CONFIDENCE} from '../../runtime/jev/deal-marks.ts';
const {dealJob,checkDealMarks,applyAsides}=await importSource('kernel-ts/npc/deal-marks.ts');
const {communicationRecord,agreementView}=await importSource('kernel-ts/npc/communication.ts');

const graph={find:handle=>({node_id:handle}),handle:node=>node.node_id};
const world={npc_references:{version:1,next:3,by_node:{russ:'npc_1',nate:'npc_2'}}};
const scope={worldline:'main',loop:0};
const present=[{node_id:'russ'},{node_id:'nate'}];
const offer={turn:1,communication:communicationRecord(graph,world,[{name:'Ada'}],scope,1,{selections:[{actor:'npc_1',act:'offer',to:['investigator_1'],
 items:[{content_id:'n:fuel',strategy:'new',kind:'new:service_at',gist:'加满油'}]}],artifact_text:'{{say:npc_1}}“加满？”{{/say}}'},[],present)};
const tyres={id:'cash:t4-c1',kind:'cash',category:'purchase',purchase_amount:145,with:'加油站老板',with_label:'加油站老板',why:'四条新轮胎',currency:'USD'};
const record={turn:4,closed_by:'narrate',receipts:[{...tyres,id:'cash:t4-c0',settlement:'quote'},tyres,{id:'cash:t4-c2',kind:'cash',category:'transfer',purchase_amount:0}]};
const name=node=>({russ:'加油站老板',nate:'卡车司机'})[node.node_id];

test('the job names the open deals of the people there and the turn\'s paid purchases, by the words the table uses',()=>{
 const job=dealJob(graph,world,present,[offer],record,scope,name);
 assert.deepEqual(job.people,[{ref:'npc_1',name:'加油站老板'},{ref:'npc_2',name:'卡车司机'}]);
 assert.deepEqual(job.deals.map(deal=>[deal.content_id,deal.by,deal.by_name,deal.status]),[['n:fuel','npc_1','加油站老板','open']]);
 assert.deepEqual(job.paid,[{receipt:'cash:t4-c1',with:'加油站老板',what:'四条新轮胎',amount:145,currency:'USD'}],'a quote and a transfer are not paid purchases');
});

test('a submission moves a deal one allowed step and records a paid deal owed by a person present; anything else is dropped',()=>{
 const job=dealJob(graph,world,present,[offer],record,scope,name);
 const {marks,paid,dropped}=checkDealMarks(job,{marks:[{content_id:'n:fuel',by:'npc_1',status:'accepted'},{content_id:'n:fuel',by:'npc_1',status:'kept'},
  {content_id:'n:nope',by:'npc_1',status:'accepted'}],paid:[{receipt:'cash:t4-c1',by:'npc_1'},{receipt:'cash:t4-c2',by:'npc_1'}]},record,'investigator_1');
 assert.deepEqual(marks,[{content_id:'n:fuel',by:'npc_1',status:'accepted',with:['investigator_1'],by_lane:true}]);
 assert.deepEqual(paid.map(row=>[row.receipt,row.by,row.gist]),[['cash:t4-c1','npc_1','四条新轮胎']]);
 assert.deepEqual(dropped.map(row=>row.reason),['not_a_next_status','unknown_deal','unknown_receipt']);
 // Written back, the ledger reads both: the fuel offer is now an accepted deal, and the tyres are owed.
 const written={...record,communication:{version:1,scope,turn:4,events:[],agreements:marks,paid}};
 const deals=agreementView([offer,written],'npc_1',scope,5);
 assert.deepEqual(deals.map(deal=>[deal.content_id,deal.status]).sort(),[[paid[0].content_id,'accepted'],['n:fuel','accepted']].sort());
 assert.equal(checkDealMarks(dealJob(graph,world,present,[offer,written],written,scope,name),{paid:[{receipt:'cash:t4-c1',by:'npc_1'}]},written,'investigator_1').paid.length,0,
  'a purchase already recorded is not asked or recorded again');
});

test('the lane asks typed choices only, records nothing below its confidence floor, and a paid deal needs both owed and a seller',async()=>{
 const input={campaign:'c',turn:4,prose:'他收了钱，说傍晚来取车。',player_text:'换四个轮胎，傍晚取',
  deals:[{content_id:'n:fuel',by:'npc_1',by_name:'加油站老板',status:'open',gist:'加满油'}],
  paid:[{receipt:'cash:t4-c1',with:'加油站老板',what:'四条新轮胎',amount:145}],people:[{ref:'npc_1',name:'加油站老板'},{ref:'npc_2',name:'卡车司机'}]};
 const {questions,state}=dealQuestions(input);
 assert.deepEqual(questions.map(q=>[q.key,q.type]),[['deal-1','choice'],['paid-1','choice'],['seller-1','choice']]);
 assert.deepEqual(Object.keys(questions[0].criteria),['accepted','declined','withdrawn','unchanged']);
 assert.deepEqual(Object.keys(questions[2].criteria),['person-1','person-2','none']);
 assert.ok(!JSON.stringify(state).includes('npc_1'),'the model sees the table\'s words, not references');
 const port=answers=>({decide:async()=>({status:'complete',answers:Object.fromEntries(Object.entries(answers).map(([key,[choice,confidence]])=>
  [key,{status:'answered',type:'choice',choice,confidence}]))})});
 const sure=await decideDeals(input,port({'deal-1':['accepted',.9],'paid-1':['owed',.9],'seller-1':['person-1',.9]}),new AbortController().signal);
 assert.deepEqual([sure.marks,sure.paid],[[{content_id:'n:fuel',by:'npc_1',status:'accepted'}],[{receipt:'cash:t4-c1',by:'npc_1'}]]);
 const unsure=await decideDeals(input,port({'deal-1':['accepted',DEAL_MARK_CONFIDENCE-.01],'paid-1':['owed',.9],'seller-1':['none',.9]}),new AbortController().signal);
 assert.deepEqual([unsure.marks,unsure.paid,unsure.blockers],[[],[],1]);
 const done=await decideDeals(input,port({'deal-1':['unchanged',.95],'paid-1':['done',.95],'seller-1':['person-1',.95]}),new AbortController().signal);
 assert.deepEqual([done.marks,done.paid],[[],[]],'handed over within the reply: no deal is owed');
});

test('the Keeper is told the host records what became of a deal, so its agreement command is optional',async()=>{
 const {TURN_PACKET_GUIDANCE}=await import('../../runtime/turn-packet-prototype.ts');
 assert.match(TURN_PACKET_GUIDANCE,/after delivery the host reads from the reply what was accepted, declined, kept or broken and records it, so an \{kind:"agreement",proposal:fact_ref,status\} command is optional/);
});

test('a line the reply has said low becomes an aside after delivery; only a bystander who passes their own Listen still heard it',async()=>{
 // App smoke (2026-10-24): the Keeper did not mark the whisper aside, so the owner behind the counter was recorded as hearing
 // it. The deal lane now also asks, for each line said aloud with a bystander, whether the reply has it said low.
 const said=communicationRecord(graph,world,[{name:'Ada'}],scope,6,{selections:[{actor:'npc_2',act:'answer',to:['investigator_1'],items:[{content_id:'n:x',strategy:'new',gist:'八点见'}]}],
  artifact_text:'{{say:npc_2}}“行，八点。”{{/say}}'},[],present,'我低声对他说：今晚八点。');
 const turnRecord={turn:6,closed_by:'narrate',receipts:[],communication:said};
 const job=dealJob(graph,world,present,[turnRecord],turnRecord,scope,name,ref=>ref==='investigator_1'?'Ada':ref);
 assert.deepEqual(job.spoken.map(row=>[row.event,row.speaker,row.to]),[['t6:p','Ada',['卡车司机']],['t6:0','卡车司机',['Ada']]]);
 const {asides}=checkDealMarks(job,{asides:['t6:p','t6:0','t9:nope']},turnRecord,'investigator_1');
 assert.deepEqual(asides,['t6:p','t6:0']);
 const communication=structuredClone(said);
 const changed=applyAsides(communication,asides,(seq,ref)=>({ref,skill:'Listen',roll:seq<0?5:90,target:25,passed:seq<0}));
 assert.deepEqual(changed.map(event=>[event.id,event.channel,event.heard]),[['t6:p','aside',['npc_1']],['t6:0','aside',[]]],
  'the owner passed Listen on the whisper and failed on the answer');
 const port={decide:async()=>({status:'complete',answers:{'voice-1':{status:'answered',type:'choice',choice:'aside',confidence:.9},
  'voice-2':{status:'answered',type:'choice',choice:'aloud',confidence:.9}}})};
 const lane=await decideDeals({campaign:'c',turn:6,prose:'你压低声音……',deals:[],paid:[],people:job.people,spoken:job.spoken},port,new AbortController().signal);
 assert.deepEqual(lane.asides,['t6:p']);
});
