import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,createCampaign} from './support.ts';
import {compileTurnPacket,turnPacket} from '../../runtime/turn-packet-prototype.ts';
import {scenePopulationRequired} from '../../runtime/scene-population.ts';

test('an unnamed staffed scene gets a real temporary person and time-bound population, not inferred emptiness',async t=>{
 const k=await kernel(t);await createCampaign(k);await k.table('open');
 await k.table('narrate',{call_id:'t0-c1',text:'You stand outside the office.'});
 await k.table('player_input',{text:'I visit the public shop.'});
 await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'Fixture Shop',travel_minutes:3,via:'street',establish:{summary:'A public shop with a counter.',within:null}}]});
 const before=await k.table('capsule');assert.equal(before.present.length,0);assert.equal(scenePopulationRequired(before),true);
 const packet=turnPacket(JSON.stringify({version:3,commands:[{kind:'walk_on',slot:'new_1',label:'the day attendant',reason:'The open public shop is staffed during this shift.'},{kind:'scene',service:'open',crowd:'quiet'}],responses:[{actor:'new_1',act:'answer',points:['We are open.']}]}));
 const birth=await k.table('apply',{call_id:'t1-c2',effects:compileTurnPacket(packet).effects});
 const current=await k.table('capsule');assert.equal(scenePopulationRequired(current),false);
 const person=current.present.find((p:any)=>p.display_name==='the day attendant');assert.match(person.ref,/^npc_\d+$/);
 assert.equal(birth.outcomes.find((outcome:any)=>outcome.kind==='npc').actor,person.ref,'new people use the same stable canonical outcome reference at birth');
 assert.equal(current.where.temporal.service,'open');assert.equal(current.where.temporal.review_at_minutes,current.where.clock.minutes+15);
 await k.table('apply',{call_id:'t1-c2',effects:compileTurnPacket(packet).effects});
 await k.tableErr('apply',{call_id:'t1-c2',effects:compileTurnPacket(packet).effects.map(effect=>{const copy={...effect};delete copy._new_person;delete copy._population;return copy;})});
 assert.equal((await k.table('capsule')).present.filter((p:any)=>p.ref===person.ref).length,1,'idempotent retry cannot duplicate the temporary person');
 await k.table('narrate',{call_id:'t1-c3',text:'{{say:'+person.ref+'}}We are open.{{/say}}'});
 const job=await k.ok('journal.job',{campaign:'c1',turn:1,mode:'referenced'});
 const selected=job.recordable.find((row:any)=>row.name==='the day attendant');
 assert.equal(selected.epithet,'the day attendant','the public role is already the canonical table word');
 await k.ok('journal.submit',{campaign:'c1',job_id:job.job_id,protocol:job.protocol,selection_binding:job.selection_binding,
  entries:[{person:selected.alias,description:'The day attendant holds the ledger.',exchange:'The day attendant answered the opening-hours inquiry.'}]});
 await k.table('player_input',{text:'I wait for the next shift.'});
 await k.table('apply',{call_id:'t2-c1',effects:[{kind:'time',minutes:16,why:'A wait passes.'}]});
 const expired=await k.table('capsule');assert.equal(scenePopulationRequired(expired),true);assert.ok(expired.where.temporal.review_reasons.includes('review_boundary_reached'));
 const empty=compileTurnPacket({version:3,commands:[{kind:'scene',service:'closed',crowd:'empty'}],responses:[]}).effects;
 await k.tableErr('apply',{call_id:'t2-c2',effects:empty});
 await k.table('apply',{call_id:'t2-c3',effects:[{kind:'npc',name:person.ref,to:'away',why:'The day shift leaves.'},...empty]});
 const closed=await k.table('capsule');assert.equal(closed.where.temporal.crowd,'empty');assert.equal(scenePopulationRequired(closed),false);
 assert.equal((await k.table('look',{focus:'npc',name:person.ref})).ref,person.ref,'leaving does not erase identity');
 await k.tableErr('apply',{call_id:'t2-c4',effects:[{kind:'npc',name:'the day attendant',to:'here',walk_on:true,_new_person:true,why:'A slot may not select an existing identity.'}]});
});
test('the opening can establish a temporary local person through the same narrow owner',async t=>{
 const k=await kernel(t);await createCampaign(k);await k.table('open');
 const effects=compileTurnPacket({version:3,commands:[{kind:'walk_on',slot:'new_1',label:'the visiting delivery attendant',reason:'A courier is waiting at the public office during business hours.'},{kind:'scene',service:'open',crowd:'quiet'}],responses:[]}).effects;
 await k.table('apply',{call_id:'t0-c1',effects});
 const state=await k.table('capsule');assert.match(state.present.find((p:any)=>p.display_name==='the visiting delivery attendant').ref,/^npc_\d+$/);
 assert.equal(scenePopulationRequired(state),false);
});
