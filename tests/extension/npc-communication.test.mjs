/** §258 P0: who said what to whom, told marks, telling strategies and promise origins. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Errors} from 'typebox/value';
import {DecisionContent} from '../../runtime/decision-content.ts';
import {turnPacket,turnPacketParameterSchema,TURN_PACKET_GUIDANCE} from '../../runtime/turn-packet-prototype.ts';
import {DECISION_AUTHOR_INSTRUCTION} from '../../runtime/isolated-expression.ts';
import {importSource} from '../integration/support.ts';
const {communicationRecord,toldView,promiseHasOrigin,selectionsOf,agreementView:dealsOf}=await importSource('kernel-ts/npc/communication.ts');

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

import {decisionCharacter,decisionPerson} from '../../runtime/decision-content.ts';
import {compileTurnPacket} from '../../runtime/turn-packet-prototype.ts';
const {heardView}=await importSource('kernel-ts/npc/communication.ts');

test('§258.7 a directed attitude compiles with its numbers, folds newest-over-oldest, and the author sees only what is shown',()=>{
 const packet={version:4,commands:[{kind:'relationship',actor:'npc_1',toward:'investigator_1',disposition:'hostile',fear:3,public:'friendly',hidden:['disposition']}]};
 assert.deepEqual(turnPacket(JSON.stringify(packet)),packet);
 const statement=JSON.parse(compileTurnPacket(packet).event.relationships[0].statement);
 assert.deepEqual(statement,{kind:'directed_relationship',affinity:'hostile',disposition:'hostile',fear:3,public:'friendly',hidden:['disposition']});
 const legacy=JSON.parse(compileTurnPacket({version:4,commands:[{kind:'relationship',actor:'npc_1',toward:'investigator_1',affinity:'guarded'}]}).event.relationships[0].statement);
 assert.equal(legacy.disposition,'unfriendly');
 const later={kind:'directed_relationship',control:'coerced'};
 const person={ref:'npc_1',display_name:'Russ',relationships:[{toward:'Ada',evidence:[{statement:JSON.stringify(later),turn:4}]},{toward:'Ada',evidence:[{statement:JSON.stringify(statement),turn:2}]}]};
 assert.deepEqual(decisionCharacter(person).attitude,[{toward:'Ada',disposition:'hostile',fear:3,public:'friendly',hidden:['disposition'],control:'coerced',since_turn:4}]);
 const shown=decisionPerson(person,[{ref:'investigator_1',name:'Ada',display_name:'Ada'}]);
 assert.deepEqual(shown.relationships,[{toward:'investigator_1',public:'friendly'}]);
 assert.ok(!JSON.stringify(shown).includes('hidden'),'no mark says something is hidden');
 assert.ok(!JSON.stringify(shown).includes('hostile')&&!JSON.stringify(shown).includes('coerced'),'nothing concealed reaches the author');
 assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[{kind:'relationship',actor:'npc_1',toward:'investigator_1',disposition:'hostile',fear:9}]})));
});

test('§258.8 a bystander hears attested lines and gets them as attributed hearsay',()=>{
 const records=[record(1,[offer('n:abc')],russSays),record(2,[{...offer('n:zzz'),items:[{content_id:'n:zzz',gist:'unsaid'}]}],[])];
 assert.deepEqual(heardView(records,'npc_2',scope),[{content_id:'n:abc',said_by:'npc_1',to:['investigator_1'],gist:'coffee at 09:20',turn:1}]);
 assert.deepEqual(heardView(records,'npc_1',scope),[],'a speaker does not overhear themself');
 const owner=new DecisionContent();
 const nate={ref:'npc_2',display_name:'Nate',heard:heardView(records,'npc_2',scope)};
 const cast={...capsule,present:[...capsule.present,{ref:'npc_2',id:'nate',name:'Nate',display_name:'Nate'}]};
 const fact=owner.prepare('c:1',cast,[russ(),nate],[],['Ada']).facts.find(row=>row.kind==='heard');
 assert.equal(fact.actor,'npc_2');assert.equal(fact.value.said_by,'Russ');assert.match(fact.value.authority,/attribute it to Russ/);
 const {units}=owner.hydrate([{actor:'npc_2',to:['investigator_1'],act:'report',content:[{fact_ref:fact.ref}]}]);
 assert.equal(units[0][0].content_id,'n:abc');
});

test('live P1 findings: author say tokens attest without resolved speech; heard keeps the first speaker and never the listener own words',()=>{
 const viaTokens=communicationRecord(graph,world,party,scope,4,{selections:[offer('n:abc')],artifact_text:'He wipes his hands. {{say:npc_1}}"Coffee is on."{{/say}}'},[],[{node_id:'russ'},{node_id:'nate'}]);
 assert.equal(viaTokens.events[0].status,'attested');
 const empty=communicationRecord(graph,world,party,scope,4,{selections:[offer('n:abc')],artifact_text:'{{say:npc_1}}{{/say}}'},[],[]);
 assert.equal(empty.events[0].status,'missing');
 const nateSays=[{who:{npc:'nate',name:'Nate'},text:'Like he said.'}];
 const records=[record(1,[offer('n:abc')],russSays),record(2,[{actor:'npc_2',act:'report',to:['investigator_1'],items:[{content_id:'n:abc',strategy:'new',gist:'coffee at 09:20'}]}],nateSays)];
 assert.deepEqual(heardView(records,'npc_1',scope),[],'Russ does not overhear his own words when Nate repeats them');
 const third={...world,npc_references:{version:1,next:4,by_node:{russ:'npc_1',nate:'npc_2',steve:'npc_3'}}};
 const both=[1,2].map(turn=>({turn,communication:communicationRecord(graph,third,party,scope,turn,{selections:[turn===1?offer('n:abc'):records[1].communication.events[0]]},turn===1?russSays:nateSays,[{node_id:'russ'},{node_id:'nate'},{node_id:'steve'}])}));
 assert.equal(heardView(both,'npc_3',scope)[0].said_by,'npc_1','Steve heard it first from Russ');
});

test('a bystander who says, as their own new item, what they heard is given it as hearsay',()=>{
 const value={predicate:'directions',to:'Esso',retrace:true};
 const owner=new DecisionContent(),cast={...capsule,present:[...capsule.present,{ref:'npc_2',id:'nate',name:'Nate',display_name:'Nate'}]};
 const russId=(()=>{const probe=new DecisionContent();probe.prepare('c:1',capsule,[russ()],[],['Ada']);return probe.hydrate([{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{new:value}]}]).units[0][0].content_id;})();
 owner.prepare('c:1',cast,[russ(),{ref:'npc_2',display_name:'Nate',heard:[{content_id:russId,said_by:'npc_1',gist:'back the way you came',turn:1}]}],[],['Ada']);
 const hydrated=owner.hydrate([{actor:'npc_2',to:['investigator_1'],act:'answer',content:[{new:value}]}]);
 assert.equal(hydrated.units[0][0].content_id,russId);assert.equal(hydrated.units[0][0].kind,'heard');
 assert.equal(hydrated.responses[0].claims[0].heard_from,'Russ');assert.match(hydrated.responses[0].claims[0].authority,/attribute it to Russ/);
});

const {partySaidView}=await importSource('kernel-ts/npc/communication.ts');

test('§258.9 what the investigator said is recorded to the people who answered and heard by the rest, and reaches them as the investigator claim',()=>{
 const said=(turn,text)=>({turn,communication:communicationRecord(graph,world,party,scope,turn,{selections:[offer('n:abc')]},russSays,[{node_id:'russ'},{node_id:'nate'}],text)});
 const records=[said(1,'我们是来查水源的。'),said(2,'  ')];
 const [event,answer]=records[0].communication.events;
 assert.equal(event.actor,'investigator_1');assert.equal(event.status,'attested');assert.deepEqual(event.to,['npc_1']);assert.deepEqual(event.heard,['npc_2']);
 assert.equal(answer.actor,'npc_1');assert.equal(records[1].communication.events.length,1,'no words, no event');
 assert.deepEqual(partySaidView(records,'npc_1',scope).map(({said_by,to_me,gist,turn})=>({said_by,to_me,gist,turn})),[{said_by:'investigator_1',to_me:true,gist:'我们是来查水源的。',turn:1}]);
 assert.equal(partySaidView(records,'npc_2',scope)[0].to_me,undefined,'Nate only heard it');
 assert.deepEqual(heardView(records,'npc_2',scope).map(row=>row.said_by),['npc_1'],'investigator words are not hearsay rows');
 assert.deepEqual(toldView(records,'npc_1',scope).map(row=>row.content_id),['n:abc']);
 const owner=new DecisionContent();
 const fact=owner.prepare('c:1',capsule,[{...russ(),party_said:partySaidView(records,'npc_1',scope)}],[],['Ada']).facts.find(row=>row.kind==='party_said');
 assert.equal(fact.actor,'npc_1');assert.equal(fact.value.statement,'我们是来查水源的。');assert.match(fact.value.authority,/not verified truth/);
 assert.equal(owner.hydrate([{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:fact.ref}]}]).units[0][0].content_id,event.items[0].content_id);
});

test('§258.9 an aside reaches only its addressees',()=>{
 const aside={...offer('n:abc'),channel:'aside'};
 assert.equal(selectionsOf({selections:[aside]})[0].channel,'aside');
 assert.equal(selectionsOf({selections:[{...aside,channel:'telepathy'}]})[0].channel,undefined);
 const {communication}=record(1,[aside],russSays);
 assert.deepEqual(communication.events[0].heard,[]);
 assert.deepEqual(heardView([{turn:1,communication}],'npc_2',scope),[]);
 assert.deepEqual(turnPacket(JSON.stringify({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'greet',channel:'aside'}]})).interactions[0].channel,'aside');
});

test('live P1 re-run: the Keeper is told disposition follows the exchange, and the author wraps every spoken line and rewords a told claim', () => {
 assert.match(TURN_PACKET_GUIDANCE,/disposition is the standing attitude and follows what the exchange did to it: a threat or insult toward this person moves it to unfriendly or hostile/);
 assert.match(TURN_PACKET_GUIDANCE,/when they hide the change, public is what they show instead/);
 assert.match(DECISION_AUTHOR_INSTRUCTION,/Every quoted line any person speaks, a greeting or acknowledgement with no claim included, sits inside its own say token/);
 assert.match(DECISION_AUTHOR_INSTRUCTION,/never a bare quote/);
 assert.match(DECISION_AUTHOR_INSTRUCTION,/clarify means they explain the part that was misunderstood in different words than before/);
 assert.match(DECISION_AUTHOR_INSTRUCTION,/only restate, because they were asked to say it again, may carry the earlier wording/);
});

test('a bare quote attests nobody, a say span attests its speaker without speech', () => {
 const bare=communicationRecord(graph,world,party,scope,5,{selections:[{actor:'npc_2',act:'acknowledge',to:['investigator_1'],content:[]}],artifact_text:'“开了一夜车，先喝口水。”退休司机晃了晃啤酒罐。'},[],[{node_id:'russ'},{node_id:'nate'}]);
 assert.equal(bare.events.find(e=>e.actor==='npc_2')?.status,'missing');
 const wrapped=communicationRecord(graph,world,party,scope,5,{selections:[{actor:'npc_2',act:'acknowledge',to:['investigator_1'],content:[]}],artifact_text:'{{say:npc_2}}“开了一夜车，先喝口水。”{{/say}}'},[],[{node_id:'russ'},{node_id:'nate'}]);
 assert.equal(wrapped.events.find(e=>e.actor==='npc_2')?.status,'attested');
});

test('P2 live fixes: a whispered question is not overheard, an NPC pointing back to the investigator keeps the investigator as the speaker, and every speech_only response carries its say token',async()=>{
 const sel=(channel,to=['investigator_1'])=>({actor:'npc_1',act:'answer',to,items:[],...(channel?{channel}:{})});
 const quiet=communicationRecord(graph,world,party,scope,4,{selections:[sel('aside')],artifact_text:'{{say:npc_1}}“他嘴松。”{{/say}}'},[],[{node_id:'russ'},{node_id:'nate'}],'我只对他一个人说：那个人靠得住吗？');
 const asked=quiet.events.find(e=>e.act==='player_input');
 assert.equal(asked.channel,'aside');assert.deepEqual(asked.heard,[]);
 assert.deepEqual(quiet.events.find(e=>e.act==='answer').heard,[]);
 const open=communicationRecord(graph,world,party,scope,4,{selections:[sel()],artifact_text:'{{say:npc_1}}“好。”{{/say}}'},[],[{node_id:'russ'},{node_id:'nate'}],'你好');
 const openAsked=open.events.find(e=>e.act==='player_input');
 assert.equal(openAsked.channel,undefined);assert.deepEqual(openAsked.heard,['npc_2']);
 const first=communicationRecord(graph,world,party,scope,1,{selections:[sel()],artifact_text:'{{say:npc_1}}“好。”{{/say}}'},[],[{node_id:'russ'},{node_id:'nate'}],'今晚借宿一夜吗？');
 const pid=first.events.find(e=>e.act==='player_input').items[0].content_id;
 const back=communicationRecord(graph,world,party,scope,2,{selections:[{actor:'npc_2',act:'answer',to:['investigator_1'],items:[{content_id:pid,strategy:'refer',gist:'今晚借宿一夜吗？'}]}],artifact_text:'{{say:npc_2}}“你问过借宿。”{{/say}}'},[],[{node_id:'russ'},{node_id:'nate'}]);
 const rows=heardView([{turn:1,communication:first},{turn:2,communication:back}],'npc_1',scope,3);
 assert.equal(rows.length,1);assert.equal(rows[0].said_by,'investigator_1');
 assert.match(DECISION_AUTHOR_INSTRUCTION,/its words still sit inside the speaker's say token/);
 assert.match(DECISION_AUTHOR_INSTRUCTION,/Every speech_only response carries say_as/);
});

test('P2-4: an aside line stays marked with who received it in recent_public and last_public_exchange, and the author is told nobody else may know it',async()=>{
 const {decisionDialogueContinuity}=await import('../../runtime/public-exchanges.ts');
 const line=(turn,statement,extra={})=>({statement,turn,authority:'conversation_report',attribution:{kind:'speech',speaker:{kind:'npc',name:'Russ'}},...extra});
 const russ={ref:'npc_1',display_name:'Russ',recent_speech:[line(2,'Aloud.'),line(4,'He talks too much.',{aside:true,to:['investigator_1']})]};
 const shown=decisionPerson(russ,[{ref:'investigator_1',name:'Ada',display_name:'Ada'}]);
 assert.deepEqual(shown.last_public_exchange,{turn:4,words:['He talks too much.'],aside:true,to:['investigator_1']});
 const open=decisionPerson({...russ,recent_speech:[line(2,'Aloud.')]},[]);
 assert.equal(open.last_public_exchange.aside,undefined,'an ordinary line carries no aside mark');
 const [exchange]=decisionDialogueContinuity([],[{...shown,display_name:'Russ',ref:'npc_1'},{ref:'investigator_1',display_name:'Ada'}]);
 assert.deepEqual(exchange.aside,[{speaker:'Russ',to:['Ada']}]);
 assert.match(exchange.keeper,/Russ: He talks too much\./);
 assert.match(DECISION_AUTHOR_INSTRUCTION,/an exchange carrying aside holds words said low to the listed recipients only/);
 assert.match(DECISION_AUTHOR_INSTRUCTION,/nobody else may repeat, quote, paraphrase or react to them as known/);
});

test('P2-4: npcRecentSpeech marks the lines of a turn the person spoke as an aside, and only those',async()=>{
 const {npcRecentSpeech}=await importSource('kernel-ts/npc/perspective.ts');
 const fake={handle:()=>'russ',displayName:()=>'Russ'};
 const turn=(n,channel)=>({turn:n,commit:true,speech:[{who:{npc:'russ'},text:`line ${n}`}],
  communication:{version:1,scope:{worldline:'main',loop:0},turn:n,events:[{actor:'npc_1',act:'answer',to:['investigator_1'],heard:channel?[]:['npc_2'],...(channel?{channel}:{}),status:'attested',items:[]}]}});
 const rows=npcRecentSpeech(fake,{},[turn(1),turn(2,'aside')],{},'npc_1');
 assert.equal(rows.length,2);
 assert.equal(rows[0].aside,undefined);
 assert.deepEqual([rows[1].aside,rows[1].to],[true,['investigator_1']]);
 assert.equal(npcRecentSpeech(fake,{},[turn(2,'aside')],{})[0].aside,undefined,'without the person reference nothing is marked');
});

const {agreementView,agreementsOf}=await importSource('kernel-ts/npc/communication.ts');

test('§258.10 phone and letter reach only their addressees; the investigator side of a call is still heard nearby',()=>{
 const said=(channel,text)=>communicationRecord(graph,world,party,scope,1,{selections:[{...offer('n:abc'),channel}]},russSays,[{node_id:'nate'}],text);
 for(const channel of ['phone','letter'])assert.deepEqual(said(channel).events[0].heard,[],channel);
 assert.deepEqual(said('phone','你好？').events[0].heard,['npc_2'],'Nate hears the investigator talk into the phone');
 assert.deepEqual(said('letter','回信').events[0].heard,[],'a letter answers a letter');
 assert.equal(selectionsOf({selections:[{...offer('n:abc'),channel:'phone'}]})[0].channel,'phone');
 assert.equal(turnPacket(JSON.stringify({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'greet',channel:'letter'}]})).interactions[0].channel,'letter');
});

test('§258.11 an attested offer is a proposal, an accepted mark makes it the speaker\'s commitment, and kept settles it',()=>{
 const mark=(turn,status,extra={})=>({turn,communication:communicationRecord(graph,world,party,scope,turn,{agreements:[{content_id:'n:abc',by:'npc_1',status,...extra}]},[],[])});
 const offered=record(1,[offer('n:abc')],russSays),unvoiced=record(1,[offer('n:zzz')],[]);
 assert.deepEqual(agreementView([offered],'npc_1',scope).map(row=>[row.content_id,row.status,row.made_turn]),[['n:abc','open',1]]);
 assert.deepEqual(agreementView([unvoiced],'npc_1',scope),[],'an offer nobody voiced proposes nothing');
 assert.deepEqual(agreementView([offered],'npc_2',scope),[],'a bystander holds no deal');
 const accepted=[offered,mark(2,'accepted')];
 assert.equal(mark(2,'accepted').communication.agreements.length,1,'agreement marks are recorded without selections');
 const [deal]=agreementView(accepted,'npc_1',scope);
 assert.deepEqual([deal.status,deal.with,deal.since_turn],['accepted',['investigator_1'],2]);
 assert.equal(agreementView(accepted,'investigator_1',scope)[0].status,'accepted','owed to the investigator');
 assert.equal(agreementView([...accepted,mark(3,'declined')],'npc_1',scope)[0].status,'accepted','an accepted deal is not declined later');
 assert.deepEqual(agreementView([...accepted,mark(3,'kept')],'npc_1',scope),[],'a kept deal is no longer open');
 assert.equal(agreementView([...accepted,mark(3,'kept')],'npc_1',scope,undefined,true)[0].status,'kept');
 assert.equal(agreementView([offered,mark(2,'kept')],'npc_1',scope)[0].status,'open','kept needs an accepted deal');
 assert.deepEqual(agreementsOf({agreements:[{content_id:'n:abc',by:'Russ',status:'accepted'},{content_id:'n:abc',by:'npc_1',status:'maybe'}]}),[]);
});

test('§258.11 only a service or a visit makes a deal: an exhibit line or an input request inside an offer proposes nothing',()=>{
 const mixed={actor:'npc_1',act:'offer',to:['investigator_1'],items:[{content_id:'n:svc',strategy:'new',kind:'new:service_at',gist:'tyre repair'},
  {content_id:'x:ex',strategy:'new',kind:'exhibit',gist:'stock spiel'},{content_id:'n:in',strategy:'new',kind:'new:input_requirements',gist:'quantity'}]};
 const records=[record(1,[mixed],russSays)];
 assert.deepEqual(agreementView(records,'npc_1',scope).map(row=>row.content_id),['n:svc']);
});

test('§258.11 the Keeper sees open offers and deals as facts and marks them by fact_ref; the mark resolves to the deal',()=>{
 const owner=new DecisionContent();
 const deals=[{content_id:'n:abc',by:'npc_1',to:['investigator_1'],gist:'coffee at 09:20',made_turn:1,status:'open'}];
 const facts=owner.prepare('c:1',capsule,[{...russ(),deals}],[],['Ada']).facts;
 const proposal=facts.find(row=>row.kind==='proposal');
 assert.equal(proposal.actor,'npc_1');assert.match(proposal.value.authority,/still open, nothing is agreed/);
 assert.equal(proposal.value.to.length,1,'the offer names who it was made to');assert.doesNotMatch(proposal.value.authority,/made to ;/);
 assert.deepEqual(owner.agreement({proposal:proposal.ref,status:'accepted'}),{content_id:'n:abc',by:'npc_1',status:'accepted'});
 assert.throws(()=>owner.agreement({proposal:proposal.ref,status:'kept'}),/proposal: its status is one of accepted, declined, withdrawn/);
 assert.throws(()=>owner.agreement({proposal:'fact_999',status:'accepted'}),/not an issued proposal or commitment fact/);
 const commitment=new DecisionContent().prepare('c:1',capsule,[{...russ(),deals:[{...deals[0],status:'accepted',with:['investigator_1']}]}],[],['Ada']).facts.find(row=>row.kind==='commitment');
 assert.match(commitment.value.authority,/their own obligation until kept or broken/);
 const packet={version:4,commands:[{kind:'agreement',proposal:'fact_3',status:'accepted'}]};
 assert.deepEqual(turnPacket(JSON.stringify(packet)),packet);
 const compiled=compileTurnPacket(packet);
 assert.deepEqual(compiled.agreements,[{proposal:'fact_3',status:'accepted'}]);assert.deepEqual(compiled.effects,[]);
 assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[{kind:'agreement',proposal:'fact_3',status:'maybe'}]})));
 // live P2b: the schema every turn is actually checked against (not just the static one) declares the agreement command.
 for(const journeySettled of [false,true])assert.deepEqual(turnPacket(JSON.stringify(packet),turnPacketParameterSchema(journeySettled)),packet,'agreement is declared in the live per-turn schema');
});

test('app re-test: a whisper answered low by its addressee stays theirs when a bystander also speaks up, and the Keeper is told the others did not hear it',()=>{
 // PipiCOC app, Blood Road (2026-10-23): the veteran was whispered to, the trucker answered aloud, and the trucker was counted
 // an addressee of the whisper; next turn he quoted it word for word.
 const rec=communicationRecord(graph,world,party,scope,5,{selections:[
  {actor:'npc_1',act:'refuse',to:['investigator_1'],items:[],channel:'aside'},
  {actor:'npc_2',act:'answer',to:['investigator_1'],items:[]}],
  artifact_text:'{{say:npc_1}}“我不去酒吧。”{{/say}}{{say:npc_2}}“还是最后一站。”{{/say}}'},[],[{node_id:'russ'},{node_id:'nate'}],'我弯下腰，用只有他能听见的声音说：今晚我请你喝一杯。');
 const asked=rec.events.find(e=>e.act==='player_input');
 assert.equal(asked.channel,'aside');assert.deepEqual(asked.to,['npc_1']);assert.deepEqual(asked.heard,[]);
 assert.deepEqual(rec.events.find(e=>e.actor==='npc_1').heard,[]);
 assert.match(TURN_PACKET_GUIDANCE,/when the investigator speaks low or privately to someone \(a whisper, a word aside\), that person answers with channel aside, and nobody else responds to those words/);
});

test('app re-test: a bystander passes on an overheard offer as the other person\'s words, and an own earlier line is attributed by the name the player knows',()=>{
 // PipiCOC app, Blood Road (2026-10-23): the trucker repeated the owner's repair quote as "你点头，我就动手", and his own
 // earlier line came back as "内特·帕特森说过" although the investigator never learned his name.
 assert.match(DECISION_AUTHOR_INSTRUCTION,/A claim of kind heard is another person's words that the speaker overheard: they pass it on as that person's words, reported in their own voice/);
 assert.match(DECISION_AUTHOR_INSTRUCTION,/never spoken in the first person as their own offer, promise or knowledge/);
 assert.match(TURN_PACKET_GUIDANCE,/a person of the book who is elsewhere speaks on the telephone under their own npc ref \(find it with lookup\), never as a walk_on/);
});

test('owner 2026-10-24: whether someone present catches a whisper is their own Listen roll, made by the commit, not the Keeper',async()=>{
 const {overhearRoll,LISTEN_BASE}=await importSource('kernel-ts/npc/communication.ts');
 const whisper=[{actor:'npc_1',act:'answer',to:['investigator_1'],items:[],channel:'aside'}];
 const text='{{say:npc_1}}“今晚八点。”{{/say}}',here=[{node_id:'russ'},{node_id:'nate'}];
 const at=listen=>communicationRecord(graph,world,party,scope,6,{selections:whisper,artifact_text:text},[],here,'我压低声音问他今晚在哪儿见。',[],{seed:'s',listen:()=>listen});
 const sure=at(100),deaf=at(0);
 const roll=sure.events.find(e=>e.actor==='npc_1').overhear_rolls[0];
 assert.deepEqual([roll.ref,roll.skill,roll.difficulty,roll.target],['npc_2','Listen','hard',50],'the bystander, at Hard: half their Listen');
 assert.equal(roll.roll,overhearRoll('s',6,0,'npc_2',100).roll,'drawn from the turn seed: a replay rolls the same');
 const passed=roll.passed;
 assert.deepEqual(sure.events.find(e=>e.actor==='npc_1').heard,passed?['npc_2']:[]);
 assert.deepEqual(sure.events.find(e=>e.act==='player_input').heard,passed?['npc_2']:[],'whoever caught the answer caught the whisper it answered');
 const missed=deaf.events.find(e=>e.actor==='npc_1');
 assert.equal(missed.overhear_rolls[0].target,0);assert.deepEqual(missed.heard,missed.overhear_rolls[0].roll===1?['npc_2']:[]);
 assert.equal(LISTEN_BASE,20,'a person nobody gave a Listen value rolls the base chance');
 const rolls=Array.from({length:200},(_,i)=>overhearRoll('seed',i,0,'npc_2',60));
 assert.ok(rolls.every(r=>r.passed===(r.roll===1||r.roll<=30)));
 assert.ok(rolls.some(r=>r.passed)&&rolls.some(r=>!r.passed),'it is a roll, not a rule');
 assert.equal(communicationRecord(graph,world,party,scope,6,{selections:[{...whisper[0],channel:undefined}],artifact_text:text},[],here,'你好',[],{seed:'s',listen:()=>100}).events.find(e=>e.actor==='npc_1').overhear_rolls,undefined,'only an aside is rolled for');
 assert.match(TURN_PACKET_GUIDANCE,/whether someone present catches it is their Listen roll, which the host makes itself for everyone present not spoken to; do not roll it/);
});
test('app play-test: a service paid for while its seller sets out to do it is the seller\'s accepted commitment, kept when the intention is done',()=>{
 // PipiCOC app, Blood Road (2026-10-23): the owner was paid twenty dollars and set out to fix the radiator, but the deal ledger
 // stayed empty: the price went through cash and the work through an NPC intent, and neither made a proposal to mark.
 const intent='intent:russ:abc';
 const receipts=[{id:'cash:t8-c2',kind:'cash',category:'purchase',purchase_amount:20,with:'russ',subject_label:'Ada',why:'换散热器水管',items:[{name:'水管'}]},
  {id:'npc:russ-t8',kind:'npc',handle:'russ',intent:{ref:intent,outcome:'attempted'}}];
 const paid=communicationRecord(graph,world,party,scope,8,{selections:[]},[],[{node_id:'russ'},{node_id:'nate'}],undefined,receipts);
 assert.equal(paid.paid.length,1);assert.equal(paid.paid[0].by,'npc_1');assert.deepEqual(paid.paid[0].to,['investigator_1']);assert.equal(paid.paid[0].intent,intent);
 const records=[{turn:8,communication:paid,receipts}];
 const [deal]=dealsOf(records,'npc_1',scope,9);
 assert.equal(deal.status,'accepted');assert.equal(deal.paid,true);assert.equal(deal.gist,'换散热器水管');
 assert.equal(dealsOf(records,'npc_2',scope,9).length,0,'a bystander owes nothing and is owed nothing');
 const later=communicationRecord(graph,world,party,scope,9,{selections:[]},[],[{node_id:'russ'}],undefined,[{kind:'npc',handle:'russ',intent:{ref:intent,outcome:'done'}}]);
 assert.deepEqual(later.settled_intents,[{ref:intent,outcome:'done'}]);
 const done=[...records,{turn:9,communication:later}];
 assert.equal(dealsOf(done,'npc_1',scope,10).length,0,'done: kept, no longer open');
 assert.equal(dealsOf(done,'npc_1',scope,10,true)[0].status,'kept');
 const byLabel=communicationRecord(graph,world,party,scope,8,{selections:[]},[],[{node_id:'russ'}],undefined,
  [{...receipts[0],with:'加油站老板',with_label:'加油站老板'},{...receipts[1],label:'加油站老板'}]);
 assert.equal(byLabel.paid[0].by,'npc_1','a seller written by role still finds the person who set out');
 const noIntent=communicationRecord(graph,world,party,scope,8,{selections:[]},[],[{node_id:'russ'}],undefined,[receipts[0]]);
 assert.equal(noIntent,undefined,'a purchase handed over at once, with nobody setting out to do anything, makes no deal');
});

test('app play-test: "never seen this boy" has a topic: what the investigator just asked about',async()=>{
 const {DecisionContent,ASKED_TOPIC}=await import('../../runtime/decision-content.ts');
 assert.equal(ASKED_TOPIC,'player_input');
 const owner=new DecisionContent();
 owner.prepare('c:3',{where:{scene:'Esso'},present:[{ref:'npc_1',display_name:'Owner'}]},[],[],['Ada']);
 const [response]=owner.hydrate([{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{new:{predicate:'knowledge_status',topic:'player_input',status:'unknown'}}]}]).responses;
 assert.equal(response.claims[0].value.topic,'player_input');
 assert.deepEqual(response.claims[0].entities,[{ref:'player_input',display_name:'what the investigator just asked about (player_input)'}]);
 assert.match(TURN_PACKET_GUIDANCE,/A topic may be player_input: what the investigator just asked about/);
});
