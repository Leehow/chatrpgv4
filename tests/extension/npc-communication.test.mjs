/** §258 P0: who said what to whom, told marks, telling strategies and promise origins. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Errors} from 'typebox/value';
import {DecisionContent} from '../../runtime/decision-content.ts';
import {turnPacket,turnPacketParameterSchema} from '../../runtime/turn-packet-prototype.ts';
import {importSource} from '../integration/support.ts';
const {communicationRecord,toldView,promiseHasOrigin,selectionsOf}=await importSource('kernel-ts/npc/communication.ts');

const graph={find:handle=>({node_id:handle})};
const world={npc_references:{version:1,next:3,by_node:{russ:'npc_1',nate:'npc_2'}}};
const party=[{name:'Ada'}];
const scope={worldline:'main',loop:0};
const offer=content_id=>({actor:'npc_1',act:'offer',to:['investigator_1'],items:[{content_id,strategy:'new',kind:'new:service_at',gist:'coffee at 09:20'}]});
const record=(turn,selections,speech)=>({turn,communication:communicationRecord(graph,world,party,scope,turn,{selections},speech,[{node_id:'russ'},{node_id:'nate'}])});
const russSays=[{who:{npc:'russ',name:'Russ'},text:'Coffee is on.'}];

test('a voiced selection is attested to its addressee and heard by everyone else present',()=>{
 const {communication}=record(2,[offer('n:abc')],russSays);
 assert.equal(communication.events.length,1);
 const [event]=communication.events;
 assert.equal(event.status,'attested');assert.deepEqual(event.to,['investigator_1']);assert.deepEqual(event.heard,['npc_2']);
 assert.deepEqual(communication.scope,{worldline:'main',loop:0});
});

test('a selection the author gave no words is missing and counts only as unverified',()=>{
 const records=[record(1,[offer('n:abc')],[])];
 assert.equal(records[0].communication.events[0].status,'missing');
 const [row]=toldView(records,'npc_1',scope);
 assert.deepEqual(row.to.investigator_1,{unverified:1,last_turn:1});
});

test('told counts fold from the turn records by strategy, newest first, and ignore later turns and other lines',()=>{
 const refer={...offer('n:abc'),items:[{content_id:'n:abc',strategy:'refer'}]};
 const records=[record(1,[offer('n:abc')],russSays),record(3,[refer],russSays),record(4,[offer('n:def')],russSays),
  {turn:2,communication:{...record(2,[offer('n:abc')],russSays).communication,scope:{worldline:'fork',loop:0}}}];
 const told=toldView(records,'npc_1',scope,4);
 assert.deepEqual(told.map(row=>row.content_id),['n:abc'],'turn 4 is not before turn 4; the fork is another line');
 assert.equal(told[0].to.investigator_1.new,1);assert.equal(told[0].to.investigator_1.refer,1);assert.equal(told[0].to.investigator_1.addressed,true);
 assert.equal(told[0].to.npc_2.new,1,'Nate overheard it');assert.equal(told[0].to.npc_2.addressed,undefined);
 assert.deepEqual(toldView(records,'npc_2',scope),[],'what Nate heard is not what Nate told');
});

test('malformed host selections are dropped, never trusted',()=>{
 assert.deepEqual(selectionsOf({selections:[{actor:'Russ',act:'offer'},{actor:'npc_1',act:'answer',to:['someone'],items:[{content_id:'bad id'}]}]}),
  [{seq:1,actor:'npc_1',act:'answer',to:[],items:[]}]);
});

test('a promise from a turn with communication needs its obligor to have spoken; older turns stand',()=>{
 const records=[record(5,[offer('n:abc')],[])];
 assert.equal(promiseHasOrigin(records,'npc_1',5,scope),false);
 assert.equal(promiseHasOrigin([record(5,[offer('n:abc')],russSays)],'npc_1',5,scope),true);
 assert.equal(promiseHasOrigin(records,'npc_1',3,scope),true,'a turn before §258 has no communication to judge by');
});

const capsule={where:{scene:'Esso',display_name:'Esso station'},present:[{ref:'npc_1',id:'russ',name:'Russ',display_name:'Russ'}]};
const russ=told=>({ref:'npc_1',display_name:'Russ',knowledge_reports:[{id:'mem:t1-1',statement:'The road north is closed.',authority:'conversation_report'}],
 commitments:[{subject:'Russ',statement:'Coffee at 09:20.',valid_from_turn:0}],...(told?{told}:{})});

test('a told fact carries its marks to the Keeper and a reselection defaults to refer',()=>{
 const first=new DecisionContent();first.prepare('c:1',capsule,[russ()],[],['Ada']);
 const fact=first.prepare('c:1',capsule,[russ()],[],['Ada']).facts.find(row=>row.kind==='knowledge_reports');
 const {units}=first.hydrate([{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:fact.ref}]}]);
 assert.equal(units[0][0].strategy,'new');assert.match(units[0][0].content_id,/^m:/);
 const owner=new DecisionContent();
 const catalog=owner.prepare('c:1',capsule,[russ([{content_id:units[0][0].content_id,to:{investigator_1:{new:2,last_turn:3}},last_turn:3}])],[],['Ada']);
 const marked=catalog.facts.find(row=>row.kind==='knowledge_reports');
 assert.deepEqual(marked.told,{to:{investigator_1:2},last_turn:3});
 assert.ok(catalog.telling,'the catalog says what told means');
 const promise=catalog.facts.find(row=>row.kind==='commitments');
 assert.deepEqual(promise.told,{earlier:true,turn:0},'their own promise was said before the counts');
 const hydrated=owner.hydrate([{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:marked.ref}]}]);
 assert.equal(hydrated.units[0][0].strategy,'refer');assert.equal(hydrated.units[0][0].told_times,2);
 assert.deepEqual(hydrated.responses[0].claims[0].telling,{strategy:'refer',times:2});
 const restated=owner.hydrate([{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:marked.ref,strategy:'restate'}]}]);
 assert.equal(restated.units[0][0].strategy,'restate');
 assert.throws(()=>owner.hydrate([{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:marked.ref,strategy:'update'}]}]),/update needs a new item/);
 const updated=owner.hydrate([{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:marked.ref,strategy:'update'},
  {new:{predicate:'knowledge_status',topic:'npc_1',status:'uncertain'}}]}]);
 assert.deepEqual(updated.units[0].map(unit=>unit.strategy),['update','new']);
});

test('nothing_more is an answer, and a service never serves a person',()=>{
 const owner=new DecisionContent();owner.prepare('c:1',capsule,[russ()],[],['Ada']);
 const packet={version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{new:{predicate:'knowledge_status',topic:'npc_1',status:'nothing_more'}}]}]};
 assert.deepEqual(turnPacket(JSON.stringify(packet)),packet);
 assert.equal(Errors(turnPacketParameterSchema(false,undefined,undefined,false,owner.bindings()),packet).length,0);
 const invented={predicate:'service_at',provider:'npc_1',items:['investigator_1'],when:{day_offset:0,hour:9,minute:20},fulfillment:'takeaway'};
 assert.ok(Errors(turnPacketParameterSchema(false,undefined,undefined,false,owner.bindings()),{version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'offer',content:[{new:invented}]}]}).length>0);
 assert.throws(()=>owner.resolve({new:invented},'npc_1'),/never a person/);
});

test('a reworded earlier answer carries the identity of the item that turn delivered, and one row stands for it',()=>{
 const words=(turn,statement)=>({statement,turn,authority:'conversation_report',attribution:{kind:'speech',speaker:{kind:'npc',name:'Russ'}}});
 const person={ref:'npc_1',display_name:'Russ',recent_speech:[words(2,'Last Stop, straight down the road.'),words(3,'The Last Stop. Follow this road.')],
  told:[{content_id:'m:aaaa',to:{investigator_1:{new:1,refer:1}},last_turn:3,turns:[2,3]}]};
 const owner=new DecisionContent(),catalog=owner.prepare('c:1',capsule,[person],[],['Ada']);
 const rows=catalog.facts.filter(row=>row.actor==='npc_1'&&['recent_speech','public_speech_history'].includes(row.kind));
 assert.equal(rows.length,1,'the second wording is the same item');
 assert.deepEqual(rows[0].told,{to:{investigator_1:2},last_turn:3});
 const {units}=owner.hydrate([{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:rows[0].ref}]}]);
 assert.equal(units[0][0].content_id,'m:aaaa');assert.equal(units[0][0].strategy,'refer');assert.equal(units[0][0].told_times,2);
});

test('an exhibit said as refer keeps its telling when the author claim replaces the placeholder',()=>{
 const owner=new DecisionContent();
 const claims=owner.authorClaims([{actor:'npc_1',act:'answer',claims:[{kind:'exhibit',ref:'exhibit_1',telling:{strategy:'refer',times:1}}]}],
  new Map([['exhibit_1',{kind:'exhibit',exhibit:{kind:'testimony',surface:'Marathon has better food.'}}]]));
 assert.deepEqual(claims[0].claims[0].telling,{strategy:'refer',times:1});
});
