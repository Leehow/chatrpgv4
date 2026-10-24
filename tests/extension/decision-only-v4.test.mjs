/** Real contract regression: no complete prose can use the old model write entrances. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {turnPacket,turnPacketParameterSchema,TURN_PACKET_PARAMETERS} from '../../runtime/turn-packet-prototype.ts';
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

import {DecisionContent,decisionPerson,decisionCharacter,bindCreatedDecisionPerson} from '../../runtime/decision-content.ts';
test('service categories can be proposed without creating inventory or inventing references',()=>{
 const owner=new DecisionContent();owner.prepare('c:1',capsule,[],[],['Investigator']);
 const fact={predicate:'service_at',provider:'npc_1',items:[{label:'Soup'},{label:'Coffee'}],when:{day_offset:0,hour:16,minute:45},fulfillment:'dine_in'};
 const packet={version:4,commands:[{kind:'move',to:'Library'}],interactions:[{actor:'npc_1',to:['investigator_1'],act:'greet',content:[{new:fact}]}]};
 assert.deepEqual(turnPacket(JSON.stringify(packet)),packet);
 const selected=owner.hydrate(packet.interactions).responses[0].claims[0];
 assert.equal(Errors(turnPacketParameterSchema(false,undefined,undefined,false,owner.bindings()),{version:4,interactions:packet.interactions}).length,0);
 assert.deepEqual(selected.value,fact);assert.equal(selected.kind,'proposed_claim');
 assert.ok(!owner.bindings().entities.includes('Soup'),'a proposed category is not issued inventory');
 assert.throws(()=>owner.resolve({new:{...fact,items:['unissued-item']}},'npc_1'),/unissued item/);
 assert.throws(()=>turnPacket(JSON.stringify({...packet,interactions:[{...packet.interactions[0],content:[{new:{...fact,items:[{label:'x'.repeat(81)}]}}]}]})));
});
const capsule={_context:{task_source_revision:'s1'},where:{scene:'Office',exits:[{to:'Library'}]},present:[{ref:'npc_1',display_name:'The clerk',knowledge:['A report about the office.'],keeper_note:'PRIVATE_CAUSE'}],npc_references:{people:[{ref:'npc_2',display_name:'The visitor'}]}};
test('current carried writing is selectable without promoting historical speech into current state',()=>{
 const owner=new DecisionContent(),document={name:'Collection receipt',revision:3,text:'Collect tomorrow at noon. Already paid.',cut:false,open:false};
 const view={...capsule,own:{documents:[document]},present:[{...capsule.present[0],recent_speech:[{statement:'Collect in four days.',turn:2}]}]};
 const prepared=owner.prepare('c:1',view,[],[],['Investigator']);
 const current=prepared.facts.find(fact=>fact.kind==='current_document');
 assert.ok(current,'the current physical document must be selectable');
 assert.equal(current.availability,'current');assert.deepEqual(current.value,document);
 const history=prepared.facts.find(fact=>fact.kind==='recent_speech');
 assert.equal(history.availability,'supplemental');assert.equal(history.value.turn,2);
 assert.deepEqual(owner.hydrate([],[{fact_ref:current.ref}]).materials[0].value,document);
 assert.throws(()=>owner.resolve({fact_ref:current.ref},'npc_1'),/Private carried writing/);
 const schema=turnPacketParameterSchema(false,undefined,undefined,false,owner.bindings());
 assert.equal(Errors(schema,{version:4,reveal:[{fact_ref:current.ref}]}).length,0);
 assert.ok(Errors(schema,{version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:current.ref}]}]}).length);
 const next=owner.prepare('c:2',{...view,own:{documents:[{...document,revision:4,text:'Collect at one.'}]}},[],[],['Investigator']);
 assert.throws(()=>owner.resolve({fact_ref:current.ref}),/retired|Unissued/);
 assert.equal(next.facts.find(fact=>fact.kind==='current_document').value.text,'Collect at one.');
 owner.prepare('c:3',{...view,own:{documents:[]}},[],[],['Investigator']);
 assert.throws(()=>owner.resolve({fact_ref:next.facts.find(fact=>fact.kind==='current_document').ref}),/retired|Unissued/);
});
test('an actor observed document remains attributed and never grants another actor knowledge',()=>{
 const owner=new DecisionContent(),observed={document:'Collection receipt',revision:2,observed_turn:2,writing:'Collect tomorrow at noon.',scope:'excerpt'};
 const prepared=owner.prepare('c:1',capsule,[{ref:'npc_1',observed_documents:[observed]}],[],['Investigator']);
 const fact=prepared.facts.find(fact=>fact.kind==='observed_document');assert.ok(fact);
 assert.equal(fact.availability,'supplemental');assert.deepEqual(owner.resolve({fact_ref:fact.ref},'npc_1').value,observed);
 assert.throws(()=>owner.resolve({fact_ref:fact.ref},'npc_2'),/another actor/);
 const schema=turnPacketParameterSchema(false,undefined,undefined,false,owner.bindings());
 const uncorrelated=turnPacketParameterSchema(false,undefined,undefined,false,{...owner.bindings(),factActors:undefined});
 assert.equal(Errors(uncorrelated,{version:4,interactions:[{actor:'npc_2',to:['investigator_1'],act:'answer',content:[{fact_ref:fact.ref}]}]}).length,0,'existence-only binding reproduces the original wrong-actor gap');
 assert.ok(Errors(schema,{version:4,interactions:[{actor:'npc_2',to:['investigator_1'],act:'answer',content:[{fact_ref:fact.ref}]}]}).length,'issued fact references must remain correlated with their owning actor');
 assert.equal(Errors(schema,{version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:fact.ref}]}]}).length,0);
 assert.ok(Errors(schema,{version:4,reveal:[{fact_ref:fact.ref}]}).length,'an actor-scoped observation cannot be offered as unscoped narration');
});
test('character projection cannot bypass the selected catalog with duplicate known or observed facts',()=>{
 const person={ref:'npc_1',display_name:'Clerk',state:{mood:'calm'},knows:[{summary:'Past claim'}],knowledge:['Claim'],observed_documents:[{writing:'Observed claim'}],recent_speech:[{statement:'Spoken claim'}]};
 assert.deepEqual(decisionCharacter(person),{ref:'npc_1',display_name:'Clerk',state:{mood:'calm'}});
});
test('existing own plans are selectable attributed plans, never executed results or another actor knowledge',()=>{
 const owner=new DecisionContent(),intent={ref:'internal-ref',text:'Develop the film before tomorrow noon.',status:'planned',since_turn:2,last_turn:2};
 const view=owner.prepare('c:1',capsule,[{ref:'npc_1',ledger:{intents:[intent]}}]);
 const fact=view.facts.find(fact=>fact.kind==='npc_intention');assert.ok(fact);
 assert.equal(fact.availability,'supplemental');assert.equal(fact.actor,'npc_1');assert.equal(fact.value.status,'planned');
 assert.equal(fact.value.ref,undefined);assert.equal(owner.resolve({fact_ref:fact.ref},'npc_1').value.statement,intent.text);
 assert.throws(()=>owner.resolve({fact_ref:fact.ref},'npc_2'),/another actor/);
 assert.deepEqual(decisionCharacter({ref:'npc_1',tried:[intent],ledger:{intents:[intent],stance:'neutral'}}),{ref:'npc_1',ledger:{stance:'neutral'}});
});
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

test('native personality descriptions and current embodied guidance survive the author projection',()=>{
 const source={ref:'npc_1',display_name:'The clerk',personality:{description:'Practical and patient; pauses before a weighty answer.',origin:'table_supplement'},
  variation:{stable:{speech:'Compact complete sentences.'},initial:{emotion:'Tentatively hopeful.'}},now:{feels:'Concerned',since_turn:3},
  activity:{current:true,summary:'Resting a hand on the counter.'},reunion:{status:'available',required:true,elapsed_minutes:45},knowledge:['PRIVATE_FACT']};
 const person=decisionPerson(source,[]);
 assert.equal(person.personality.description,source.personality.description);
 assert.deepEqual(person.variation,source.variation);assert.equal(person.activity.summary,source.activity.summary);
 assert.equal(person.reunion.elapsed_minutes,45);assert.ok(!JSON.stringify(person).includes('PRIVATE_FACT'));
 assert.equal(decisionPerson({...source,activity:{...source.activity,current:false,review_required:true}},[]).activity,undefined);
});

test('same-place public history is optional selectable evidence rather than mandatory new narration',()=>{
 const owner=new DecisionContent(),text='The clerk set the cup beside the register.';
 const view=owner.prepare('c:1',{...capsule,public_scene:{entries:[{turn:2,text}]}},[],[],['Investigator']);
 const fact=view.facts.find(f=>f.kind==='public_scene_history');assert.equal(fact.value.text,text);
 assert.equal(fact.availability,'supplemental');assert.deepEqual(owner.hydrate([],[{fact_ref:fact.ref}]).materials[0].value,{turn:2,text});
 assert.throws(()=>owner.resolve({fact_ref:fact.ref},'npc_1'),/not an actor knowledge grant/);
});

test('a substantive answer cannot reach the author without selected communication meaning',()=>{
 for(const act of ['answer','ask','offer','clarify','report','warn'])for(const content of [undefined,[]])
  assert.throws(()=>turnPacket(JSON.stringify({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act,...(content?{content}:{})}]})),/content|response/);
 const packet=turnPacket(JSON.stringify({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{new:{predicate:'directions',to:'Library',retrace:true}}]}]}));
 const owner=new DecisionContent();owner.prepare('c:1',capsule,[],[],['Investigator']);
 const claim=owner.hydrate(packet.interactions).responses[0].claims[0];
 assert.equal(claim.value.predicate,'directions');assert.equal(claim.value.retrace,true);assert.equal(packet.commands,undefined);
 // §264.5: a destination alone is where the place is, not a missing route.
 assert.equal(turnPacket(JSON.stringify({...packet,interactions:[{...packet.interactions[0],content:[{new:{predicate:'directions',to:'Library'}}]}]})).interactions[0].content[0].new.to,'Library');
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
 assert.deepEqual(person.relationships,[{toward:'investigator_1',public:'friendly'}]);
});
test('prepared place and operation references share one issuance vocabulary with the provider',()=>{
 const owner=new DecisionContent();owner.prepare('c:1',{...capsule,where:{...capsule.where,places:[{name:'Marathon Cafe',line:'A known cafe.'}]}},[],[],['Investigator'],[],[{operation:{effects:[{kind:'move',to:'Clinic'}]}}]);
 for(const to of ['Marathon Cafe','Clinic'])assert.equal(owner.resolve({new:{predicate:'directions',to,retrace:true}},'npc_1').value.to,to);
 const schema=turnPacketParameterSchema(false,undefined,undefined,false,owner.bindings());
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
 const schema=turnPacketParameterSchema(false,undefined,undefined,false,owner.bindings());
 for(const claim of [{predicate:'whereabouts',actor:'npc_1',to:'investigator_1',when:'habitual'},{predicate:'planned_visit',actor:'npc_1',to:'npc_2',when:{day_offset:1,hour:12,minute:0}},{predicate:'directions',to:'Library',via:['investigator_1']}]){
  assert.throws(()=>owner.resolve({new:claim},'npc_1'),/place/);
  assert.ok(Errors(schema,{version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{new:claim}]}]}).length);
 }
 assert.throws(()=>owner.resolve({new:{predicate:'whereabouts',actor:'Library',to:'Library',when:'now'}},'npc_1'),/person/);
});

test('a procedural answer can select required information without writing the answer or starting work',()=>{
 const packet={version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{new:{predicate:'input_requirements',topic:'Library',fields:['subject_name','location','time_range']}}]}]};
 assert.deepEqual(turnPacket(JSON.stringify(packet)),packet);
 const owner=new DecisionContent();owner.prepare('c:1',capsule,[],[],['Investigator']);
 const claim=owner.hydrate(packet.interactions).responses[0].claims[0];assert.equal(claim.kind,'proposed_claim');assert.deepEqual(claim.value.fields,['subject_name','location','time_range']);
 assert.equal(packet.commands,undefined);assert.equal(claim.executed,undefined);
 for(const fields of [['Please tell me the address and approximate year.'],['location','location']])assert.throws(()=>turnPacket(JSON.stringify({...packet,interactions:[{...packet.interactions[0],content:[{new:{...packet.interactions[0].content[0].new,fields}}]}]})));
});
