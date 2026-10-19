/** Real contract regression: no complete prose can use the old model write entrances. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {turnPacket,turnPacketProviderPayload,TURN_PACKET_PARAMETERS} from '../../runtime/turn-packet-prototype.ts';
import {Errors} from 'typebox/value';
import {offeredTools} from '../../extensions/kernel/lean-apply.ts';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1'};
test('old decision packets cannot submit complete speech through event or points',()=>{
 const event={name:'A reply',materials:[{name:'reply',text:'I will meet you at the bar tomorrow.',kind:'speech',visibility:'player',speaker:'npc_1',audience:['investigator_1']}]};
 assert.throws(()=>turnPacket(JSON.stringify({version:3,commands:[],responses:[],event})));
 assert.throws(()=>turnPacket(JSON.stringify({version:3,commands:[],responses:[{actor:'npc_1',act:'answer',points:['I will meet you at the bar tomorrow.']}]})));
 assert.equal(TURN_PACKET_PARAMETERS.properties.event,undefined);
 assert.equal(TURN_PACKET_PARAMETERS.properties.responses,undefined);
});
test('model mechanical apply retains effects without the mixed event writing entrance',()=>{
 const apply=offeredTools(COC_TOOLS,env).find(x=>x.name==='apply');
 assert.ok(apply.parameters.properties.effects);
 for(const field of ['event','delivery','narrate','quotes'])assert.equal(apply.parameters.properties[field],undefined,field);
});
test('v4 declares communication recipients and selected content without prose fields',()=>{
 const packet={version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:'fact_1'}]}]};
 assert.deepEqual(turnPacket(JSON.stringify(packet)),packet);
 for(const fields of [{points:['Complete dialogue.']},{intent:'Complete dialogue.'},{stance:'Complete dialogue.'},{event:{summary:'Complete dialogue.'}}])
  assert.throws(()=>turnPacket(JSON.stringify({...packet,interactions:[{...packet.interactions[0],...fields}]})));
});

import {DecisionContent,decisionPerson,bindCreatedDecisionPerson} from '../../runtime/decision-content.ts';
const capsule={_context:{task_source_revision:'s1'},where:{scene:'Office',exits:[{to:'Library'}]},present:[{ref:'npc_1',display_name:'The clerk',knowledge:['A report about the office.'],keeper_note:'PRIVATE_CAUSE'}],npc_references:{people:[{ref:'npc_2',display_name:'The visitor'}]}};
test('exact prepared actor facts preserve attribution and exclude unselected private causes',()=>{
 const owner=new DecisionContent(),view=owner.prepare('c:1',capsule,[],[{name:'Public text',text:'Exact original fragment.'}],['Investigator']);
 assert.ok(!JSON.stringify(view).includes('PRIVATE_CAUSE'));
 const fact=view.facts.find(x=>x.actor==='npc_1'),source=view.facts.find(x=>x.ref.startsWith('source_'));
 const packet=turnPacket(JSON.stringify({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:fact.ref}]}]}));
 assert.equal(owner.hydrate(packet.interactions).responses[0].claims[0].value,'A report about the office.');
 assert.throws(()=>owner.hydrate([{actor:'npc_2',to:['investigator_1'],act:'answer',content:[{fact_ref:fact.ref}]}]),/another actor/);
 assert.throws(()=>owner.hydrate([],[{fact_ref:fact.ref}]),/another actor/);
 assert.throws(()=>owner.resolve({source_ref:fact.ref}),/wrong-kind/);
 assert.throws(()=>owner.resolve({fact_ref:source.ref}),/wrong-kind/);
 assert.equal(owner.resolve({source_ref:source.ref}).value.text,'Exact original fragment.');
 assert.throws(()=>owner.assertCurrent({_context:{task_source_revision:'changed'}}),/revision/);
});
test('unchanged materials keep aliases while retired and new-input material cannot bind',()=>{
 const owner=new DecisionContent(),first=owner.prepare('c:1',capsule,[],[],['Investigator']);
 const ref=first.facts[0].ref;
 assert.equal(owner.prepare('c:1',capsule,[],[],['Investigator']).facts[0].ref,ref);
 const changed={...capsule,present:[{...capsule.present[0],knowledge:[]}]};
 owner.prepare('c:1',changed,[],[],['Investigator']);assert.throws(()=>owner.resolve({fact_ref:ref},'npc_1'),/retired/);
 owner.prepare('c:2',changed,[],[],['Investigator']);assert.throws(()=>owner.resolve({fact_ref:ref},'npc_1'),/Unissued/);
 assert.equal(owner.prepare('c:3',capsule,[],[],['Investigator']).facts[0].ref,ref,'same immutable material can be reissued without regenerating it');
});
test('typed offers and future visits remain communication content rather than effects or heard records',()=>{
 const owner=new DecisionContent();owner.prepare('c:1',capsule,[],[],['Investigator']);
 const content={new:{predicate:'planned_visit',actor:'npc_1',to:'Library',when:{day_offset:1,hour:12,minute:0}}};
 const wire={version:4,interactions:[{actor:'npc_1',to:['npc_2'],act:'offer',content:[content]}]};
 const parsed=turnPacket(JSON.stringify(wire)),selected=owner.hydrate(parsed.interactions);
 assert.equal(selected.responses[0].to[0],'npc_2');assert.equal(selected.responses[0].claims[0].kind,'proposed_claim');
 assert.equal(parsed.commands,undefined);assert.equal(parsed.event,undefined);assert.equal(selected.responses[0].claims[0].heard,undefined);
 for(const fields of [{text:'Complete dialogue.'},{predicate:'statement',text:'Complete dialogue.'}])assert.throws(()=>turnPacket(JSON.stringify({...wire,interactions:[{...wire.interactions[0],content:[{new:{...content.new,...fields}}]}]})));
 assert.throws(()=>owner.hydrate([{...wire.interactions[0],to:['investigator_99']}]),/audience/);
});
test('character state and directed relationships come from a narrow host projection',()=>{
 const person=decisionPerson({ref:'npc_1',display_name:'The clerk',name_known:false,name:'PRIVATE_NAME',knowledge:['PRIVATE_FACT'],keeper_note:'PRIVATE_CAUSE',now:{feels:'Concerned'},personality:{profile:{profile:{expression:'Measured speech',priorities:['PRIVATE_MOTIVE']}}},source_relationships:[{toward:'Visitor',kind:'colleague',note:'PRIVATE_NOTE'}]},[{ref:'npc_2',name:'Visitor',display_name:'The visitor'}]);
 assert.deepEqual(person.relationships,[{toward:'npc_2',kind:'colleague'}]);assert.equal(person.now.feels,'Concerned');assert.equal(person.speech_style,'Measured speech');
 assert.ok(!JSON.stringify(person).includes('PRIVATE_'));
});

test('a substantive answer cannot reach the author without selected communication meaning',()=>{
 for(const act of ['answer','ask','offer','clarify','report','warn'])for(const content of [undefined,[]])
  assert.throws(()=>turnPacket(JSON.stringify({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act,...(content?{content}:{})}]})),/content|response/);
 const packet=turnPacket(JSON.stringify({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{new:{predicate:'directions',to:'Library',retrace:true}}]}]}));
 const owner=new DecisionContent();owner.prepare('c:1',capsule,[],[],['Investigator']);
 const claim=owner.hydrate(packet.interactions).responses[0].claims[0];
 assert.equal(claim.value.predicate,'directions');assert.equal(claim.value.retrace,true);assert.equal(packet.commands,undefined);
 assert.throws(()=>turnPacket(JSON.stringify({...packet,interactions:[{...packet.interactions[0],content:[{new:{predicate:'directions',to:'Library'}}]}]})));
});
test('audience aliases bind only actual people, never an issued place',()=>{
 const owner=new DecisionContent(),view={...capsule,known:{investigator:{id:'investigator',name:'Investigator'}}};owner.prepare('c:1',view,[],[],['Investigator']);
 assert.equal(owner.hydrate([{actor:'npc_1',to:['investigator'],act:'greet'}]).responses[0].to[0],'investigator_1');
 assert.throws(()=>owner.hydrate([{actor:'npc_1',to:['Library'],act:'greet'}]),/non-person/);
});
test('created people bind nested claim references without rewriting exact original material',()=>{
 const owner=new DecisionContent();owner.prepare('c:1',capsule,[],[{name:'Exact source',text:'new_1 is a literal source token.'}],['Investigator']);owner.addEntities(['new_1']);
 const selected=owner.hydrate([{actor:'new_1',to:['investigator_1'],act:'offer',content:[{new:{predicate:'planned_visit',actor:'new_1',to:'Library',when:{day_offset:1,hour:12,minute:0}}}]}],[{source_ref:'source_2'}]);
 bindCreatedDecisionPerson(selected,'new_1',{ref:'npc_3',display_name:'The host'});
 assert.equal(selected.responses[0].actor,'npc_3');assert.equal(selected.responses[0].claims[0].value.actor,'npc_3');
 assert.deepEqual(selected.responses[0].claims[0].entities,[{ref:'npc_3',display_name:'The host'}]);
 assert.equal(selected.materials[0].value.text,'new_1 is a literal source token.');
});
test('the newest canonical directed attitude wins over older relationship evidence',()=>{
 const cast=[{ref:'investigator_1',name:'Investigator',display_name:'Investigator'}];
 const person=decisionPerson({ref:'npc_1',display_name:'The clerk',relationships:['friendly','hostile'].map(affinity=>({toward:'Investigator',evidence:[{statement:JSON.stringify({kind:'directed_relationship',affinity}),authority:'canonical_event'}]}))},cast);
 assert.deepEqual(person.relationships,[{toward:'investigator_1',affinity:'friendly'}]);
});
test('prepared place and operation references share one issuance vocabulary with the provider',()=>{
 const owner=new DecisionContent();owner.prepare('c:1',{...capsule,where:{...capsule.where,places:[{name:'Marathon Cafe',line:'A known cafe.'}]}},[],[],['Investigator'],[],[{operation:{effects:[{kind:'move',to:'Clinic'}]}}]);
 for(const to of ['Marathon Cafe','Clinic'])assert.equal(owner.resolve({new:{predicate:'directions',to,retrace:true}},'npc_1').value.to,to);
 const schema=turnPacketProviderPayload({tools:[{name:'output',input_schema:{}}]},false,true,undefined,undefined,false,owner.bindings()).tools[0].input_schema;
 const packet={version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{new:{predicate:'directions',to:'Marathon Cafe',retrace:true}}]}]};
 assert.equal(Errors(schema,packet).length,0);
 for(const fields of [{to:'unissued destination',retrace:true},{to:'Marathon Cafe',via:['unissued waypoint']},{to:'Marathon Cafe',retrace:true,heading:'east'}]){
  const value={...packet,interactions:[{...packet.interactions[0],content:[{new:{predicate:'directions',...fields}}]}]};
  assert.equal(Errors(schema,value).length===0,fields.heading==='east');
 }
 const wrongAudience={...packet,interactions:[{...packet.interactions[0],to:['Marathon Cafe']}]};assert.ok(Errors(schema,wrongAudience).length);
 assert.ok(Errors(schema,{version:4,reveal:[{source_ref:'unissued source'}]}).length);
});
test('a communication audience cannot be mistaken for a location or a route waypoint',()=>{
 const owner=new DecisionContent();owner.prepare('c:1',capsule,[],[],['Investigator']);
 const schema=turnPacketProviderPayload({tools:[{name:'output',input_schema:{}}]},false,true,undefined,undefined,false,owner.bindings()).tools[0].input_schema;
 for(const claim of [{predicate:'whereabouts',actor:'npc_1',to:'investigator_1',when:'habitual'},{predicate:'planned_visit',actor:'npc_1',to:'npc_2',when:{day_offset:1,hour:12,minute:0}},{predicate:'directions',to:'Library',via:['investigator_1']}]){
  assert.throws(()=>owner.resolve({new:claim},'npc_1'),/place/);
  assert.ok(Errors(schema,{version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{new:claim}]}]}).length);
 }
 assert.throws(()=>owner.resolve({new:{predicate:'whereabouts',actor:'Library',to:'Library',when:'now'}},'npc_1'),/person/);
});
