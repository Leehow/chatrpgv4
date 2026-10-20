/** Shared observation interfaces and author privacy, not simulated live play. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check} from 'typebox/value';
import {PlaceEffect,PlaceParameters} from '../../shared/place-structures.ts';
import {turnPacket,compileTurnPacket,turnPacketParameterSchema,turnPacketResult} from '../../runtime/turn-packet-prototype.ts';
import {decisionCast,decisionObservationScope} from '../../runtime/isolated-expression.ts';
import {locationToolDeclarations} from '../../extensions/table/location-context.ts';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {admissionRequest} from '../../extensions/kernel/admission.ts';
import {continuousConsentLine,continuousConsentQuestions} from '../../runtime/jev/continuous-consent.ts';
const observe={kind:'place',action:'observe',to:'Street',at:'steps',sense:'sight',access:'limited',scope:'The entrance pavement.',facts:['The man in a cap remains by the entrance.'],people:['npc_1']};
test('all entrances preserve the same typed observation and demand-only grammar',()=>{
    assert(Check(PlaceEffect,observe));assert(Check(PlaceParameters,{op:'inspect',need:'observation',name:'Street',at:'steps',sense:'hearing'}));
    const packet=turnPacket(JSON.stringify({version:4,commands:[observe]}));
    assert.deepEqual(compileTurnPacket(packet).effects,[observe]);
    assert(Check(turnPacketParameterSchema(false,undefined,undefined,false,undefined,true),packet));
    const small=locationToolDeclarations(COC_TOOLS,false).find(tool=>tool.name==='place').parameters;
    assert(Check(small,{op:'inspect',need:'observation',name:'Street'}));assert.equal(JSON.stringify(small).includes('assessed_clock'),false);
    assert(!Check(PlaceEffect,{...observe,teleport:true}));assert(!Check(PlaceEffect,{...observe,facts:['x'.repeat(601)]}));
});
test('observation newcomers bind after placement without a second identity or implicit speech',()=>{
    const packet=turnPacket(JSON.stringify({version:4,commands:[{kind:'walk_on',slot:'new_1',label:'Man in cap',reason:'He is beside the steps.'},{...observe,to:'here',at:undefined,people:['new_1']}]}));
    const compiled=compileTurnPacket(packet);
    assert.equal(compiled.effects[0].walk_on,true);assert.deepEqual(compiled.effects[1].people,['Man in cap']);
    assert.equal(compiled.responses.length,0);
    assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[{...observe,people:['new_2']}]})),/Unbound observation/);
});
test('the final author distinguishes observed people from current presence and drops private identity fields',()=>{
    const identity={ref:'npc_1',display_name:'Man in cap',name_known:false,keeper_only:'private objective',knowledge:['secret']};
    const observation={from:{place:'Room',at:'window'},to:{place:'Street',at:'steps'},sense:'sight',access:'limited',facts:observe.facts,people:[identity]};
    const result=turnPacketResult({outcomes:[{kind:'place',status:'changed',action:'observe',observation}]});
    assert.deepEqual(result.outcomes[0].observation.facts,observe.facts);
    const scope=decisionObservationScope(result.outcomes,[identity]);
    assert.deepEqual(scope[0].people,[{ref:'npc_1',display_name:'Man in cap',name_known:false}]);
    const cast=decisionCast(['Thomas'],[],{presence:{people:[]}},scope);
    assert.equal(cast.find(person=>person.ref==='npc_1').presence,'observed');
    assert(!JSON.stringify(cast).includes('secret'));assert(!JSON.stringify(scope).includes('private objective'));
    assert.equal(decisionCast(['Thomas'],[],{presence:{people:[identity]}},scope).find(person=>person.ref==='npc_1').presence,'current');
});
test('structural relations are Keeper authoring while actual observation keeps ordinary consent',()=>{
    const relation={kind:'place',action:'relate',relations:[{from:{place:'Room',at:'window'},to:{place:'Street',at:'steps'},sense:'sight',description:'The casement overlooks the entrance.'}]};
    assert.equal(admissionRequest('apply',{effects:[relation]},{party:[{name:'Thomas'}],scene:{handle:'Room'}}),null);
    assert(admissionRequest('apply',{effects:[observe]},{party:[{name:'Thomas'}],scene:{handle:'Room'}}));
    assert.equal(continuousConsentLine(observe).perception_scope.settles[0],'selected_perception_only');
    assert(continuousConsentQuestions(['place'])[0].instructions.includes('it is not a journey or entry'));
});
