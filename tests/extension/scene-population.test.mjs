/** Population/identity component checks, not a simulated playtest. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {turnPacket,compileTurnPacket} from '../../runtime/turn-packet-prototype.ts';
import {decisionScene} from '../../runtime/isolated-expression.ts';
import {scenePopulationRequired} from '../../runtime/scene-population.ts';

test('an empty registered cast does not assert an empty scene',()=>{
 const scene=decisionScene({where:{scene:'Daytime shop',clock:{day_part:'afternoon'},temporal:{current:false,review_required:true}},present:[]});
 assert.equal(scene.presence.population,'unknown');assert.equal(scene.presence.complete,undefined);
});
test('scene assessment and a temporary role share the normal transaction, with a local response slot',()=>{
 const packet=turnPacket(JSON.stringify({version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'},{kind:'walk_on',slot:'new_1',label:'the day attendant',reason:'The public shop is staffed this afternoon.'}],interactions:[{actor:'new_1',to:['investigator_1'],act:'answer',content:[{result_ref:'scene'}]}]}));
 const compiled=compileTurnPacket(packet);
 assert.equal(compiled.effects[0].kind,'npc');assert.equal(compiled.effects[0].walk_on,true);assert.equal(compiled.effects[0].to,'here');
 assert.equal(compiled.effects[1].kind,'scene');assert.equal(compiled.effects[1].activity.review_after_minutes,15);
 assert.throws(()=>turnPacket(JSON.stringify({...packet,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})),/slot/);
 assert.throws(()=>turnPacket(JSON.stringify({...packet,commands:[...packet.commands,{kind:'walk_on',slot:'new_2',label:' THE DAY ATTENDANT ',reason:'A duplicate label.'}]})),/Duplicate newcomer labels/);
 assert.equal(compileTurnPacket({...packet,commands:[{kind:'scene',service:'open',crowd:'quiet',review_after_minutes:2}]}).effects[0].activity.review_after_minutes,2);
});
test('only a current coherent assessment qualifies for the warm travel path',()=>{
 const attendant={kind:'npc',ref:'npc_1',display_name:'the attendant'};
 const capsule=(current,crowd,present=[])=>({where:{temporal:{current,crowd}},present});
 for(const state of [capsule(false,'empty'),capsule(true,'unknown'),capsule(true,'quiet'),capsule(true,'empty',[attendant])])assert.equal(scenePopulationRequired(state),true);
 assert.equal(scenePopulationRequired(capsule(true,'empty')),false);
 assert.equal(scenePopulationRequired(capsule(true,'quiet',[attendant])),false);
});
