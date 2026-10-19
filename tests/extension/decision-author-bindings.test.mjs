import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as expression from '../../runtime/isolated-expression.ts';
import {turnPacketResult} from '../../runtime/turn-packet-prototype.ts';
import {importSource} from '../integration/support.ts';

test('the existing author owner binds investigators as player roles distinct from NPCs',()=>{
 assert.equal(typeof expression.decisionCast,'function');
 const cast=expression.decisionCast(['Jack Miller'],[{ref:'npc_2',display_name:'The colleague',name_known:false}],
  {presence:{people:[{ref:'npc_2',display_name:'The colleague',name_known:false}]}});
 assert.deepEqual(cast,[{ref:'investigator_1',role:'player',display_name:'Jack Miller'},
  {ref:'npc_2',role:'npc',display_name:'The colleague',name_known:false,presence:'current'}]);
 assert.ok(!cast.some(person=>person.role==='npc'&&person.display_name==='Jack Miller'));
});

test('the actual pre/post presence binds a farewell before arrival without teleporting a caller',()=>{
 assert.equal(typeof expression.decisionResponseScope,'function');
 const before={where:{scene:'Diner',clock:{at:'1975-07-01T11:40'}},present:[{ref:'npc_20',display_name:'Diner owner',name_known:false}]};
 const current={where:{scene:'Photo shop',clock:{at:'1975-07-01T12:50'}},present:[{ref:'npc_21',display_name:'Clerk',name_known:false}]};
 const result=expression.decisionResponseScope(before,current,[{actor:'npc_21',act:'answer',points:['Price.']},
  {actor:'npc_20',act:'acknowledge',points:['Goodbye.']},{actor:'npc_22',act:'answer',points:['I am on the phone.']}]);
 assert.deepEqual(result.responses.map(row=>[row.actor,row.location]),[
  ['npc_20',{scope:'departure',scene:'Diner'}],['npc_21',{scope:'current',scene:'Photo shop'}],['npc_22',{scope:'offstage'}]]);
 assert.equal(result.departure_scene.name,'Diner');
 assert.deepEqual(result.departure_clock,{at:'1975-07-01T11:40'});
 assert.equal(current.present.length,1);
});

test('canonical physical custody reaches the compact result without private definition or false adoption',async()=>{
 const {operationOutcomes}=await importSource('kernel-ts/apply/outcomes.ts');
 const receipts=[{kind:'definition',name:'Film',adopted:'Film',visibility:'keeper',description:'Unpublished'},
  {kind:'item',name:'Exposed roll',label:'Exposed roll',from:'pc-id',from_label:'Jack Miller',subject:'clerk-id',subject_label:'Clerk',quantity:1,instance:'private-instance',state:{condition:'intact',charges:99}},
  {kind:'item',name:'Secret item',visibility:'keeper',quantity:1}];
 const outcomes=operationOutcomes(receipts,{actor:()=>null},{});
 assert.deepEqual(outcomes,[{kind:'item',status:'changed',name:'Exposed roll',from:'Jack Miller',to:'Clerk',quantity:1}]);
 assert.deepEqual(turnPacketResult({outcomes}).outcomes,outcomes);
});

test('native consent identity ignores object key ordering while retaining every authority boundary',async()=>{
 const admission=await import('../../extensions/kernel/admission.ts');
 assert.equal(typeof admission.continuousAdmissionKey,'function');
 const a={tool:'apply',lines:['ignored when operations exist'],kinds:['object'],operations:[{kind:'object',name:'Exposed roll',definition:'Film',to:'Jack Miller'}]};
 const b={...a,operations:[{to:'Jack Miller',definition:'Film',name:'Exposed roll',kind:'object'}]};
 const key=admission.continuousAdmissionKey('I check the roll.','w','s',a);
 assert.equal(admission.continuousAdmissionKey('I check the roll.','w','s',b),key);
 for(const [input,world,source,proposal] of [['Other input','w','s',a],['I check the roll.','w2','s',a],['I check the roll.','w','s2',a],['I check the roll.','w','s',{...a,operations:[{...a.operations[0],to:'Clerk'}]}]])
  assert.notEqual(admission.continuousAdmissionKey(input,world,source,proposal),key);
});
