import test from 'node:test';
import assert from 'node:assert/strict';
import {locationDeclarationContext} from '../../extensions/table/location-relevance.ts';

test('the original arrival assessment distinguishes a room survey from chosen movement',()=>{
 const input={status:'answered',needed:true,selection:{move:.96,feature:.57,observation:.07}},before=structuredClone(input);
 const context=locationDeclarationContext(input);
 assert.deepEqual(context.selection,{move:{probability:.96,assessment:'selected'},feature:{probability:.57,assessment:'uncertain'},observation:{probability:.07,assessment:'not_selected'}});
 assert.match(context.authority,/not canonical intent/);assert.match(context.authority,/retain normal admission and completion/);
 assert.deepEqual(input,before);
});
test('a selected view stays selected and existing uncertainty bounds are retained',()=>{
 const context=locationDeclarationContext({status:'answered',needed:true,selection:{move:.4,feature:.59,observation:.6}});
 assert.equal(context.selection.move.assessment,'not_selected');assert.equal(context.selection.feature.assessment,'uncertain');
 assert.equal(context.selection.observation.assessment,'selected');
});
test('absent, irrelevant or unavailable context never becomes an invented negative assessment',()=>{
 for(const input of [{},{status:'fallback',needed:true},{status:'answered',needed:false},
  ...[undefined,NaN,Infinity,-.1,1.1].map(observation=>({status:'answered',needed:true,selection:{move:.9,feature:.1,observation}}))])
  assert.equal(locationDeclarationContext(input),undefined);
});
