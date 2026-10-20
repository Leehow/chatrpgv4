/** Explicit action identity survives target-field normalization; reads never become writes. */
import {test} from 'node:test';import assert from 'node:assert/strict';import {Check} from 'typebox/value';
import {normalizePlaceTarget,placeOperation,placeModeConflict} from '../../extensions/kernel/place-operation.ts';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
const schema=COC_TOOLS.find(tool=>tool.name==='place').parameters;
test('an explicit native target alias reaches the same canonical effect without changing its input',()=>{
 for(const input of [{action:'move',name:'Inn',at:'Window',relation:'beside'},{action:'feature',name:'Inn',at:'Door',state:'closed'},{action:'observe',name:'Street',sense:'sight',access:'clear',scope:'The pavement',facts:['The pavement is empty.']}]){
  const before=structuredClone(input),args=normalizePlaceTarget(input);assert.equal(args.to,input.name);assert(!Object.hasOwn(args,'name'));assert.equal(args.action,input.action);assert(Check(schema,args));assert.deepEqual(input,before);
  const operation=placeOperation('place',input);assert.equal(operation.name,'apply');assert.equal(operation.params.effects[0].to,input.name);assert.equal(operation.params.effects[0].action,input.action);
 }
});
test('conflicting targets refuse before routing, while identical targets have one canonical spelling',()=>{
 const input={action:'move',name:'Inn',to:'Library'};assert.throws(()=>normalizePlaceTarget(input),error=>error.toToolText().includes('invalid_params')&&/conflicting/.test(error.message));assert.throws(()=>placeOperation('place',input));
 assert.deepEqual(normalizePlaceTarget({action:'move',name:'Inn',to:'Inn'}),{action:'move',to:'Inn'});
});
test('inspection, missing action, unknown actions and legacy envelopes do not infer a write',()=>{
 for(const input of [{action:'inspect',name:'Inn'},{name:'Inn'},{action:'go',name:'Inn'},{op:'submit',change:{action:'move',name:'Inn'}},{action:'move',name:7}])assert.equal(normalizePlaceTarget(input),input);
 const mixed={action:'inspect',name:'Inn',to:'Inn',relation:'beside'};assert.equal(normalizePlaceTarget(mixed),mixed);assert(placeModeConflict(mixed));assert(!Check(schema,mixed));
});
