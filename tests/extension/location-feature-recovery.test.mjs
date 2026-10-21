/** Exercise the production location conflict before any receipt or movement. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importSource} from '../integration/support.ts';
const {stageLocation}=await importSource('kernel-ts/mods/locations.ts');

test('a repeated feature conflict supplies its canonical identity without changing it',()=>{
 const node={node_id:'scene-location-inn',name:'Inn',properties:{description:'A small inn.'}};
 const feature={id:'feature-location-door',place:'Inn',name:'Door',description:'An old oak door.',state:'closed',passable:false};
 const world={active_scene:'Inn',mods:{state:{'enhanced-locations':{locations:{schema:1,places:[{id:node.node_id,name:'Inn'}],features:[feature]}}}}};
 const before=structuredClone(world);
 const context={world,graph:{scenes:()=>[node],nameKeys:()=>['Inn'],handle:()=> 'Inn'},turn:{turn:1},callId:'fixture'};
 assert.throws(()=>stageLocation(context,{kind:'place',action:'establish',additions:[{name:'Inn',features:[{name:'Door',description:'A newly painted door.'}]}]},[{id:'enhanced-locations',requires:['locations.v1']}]),error=>{
  assert.equal(error.details.reason,'feature_redefinition');
  assert.deepEqual(error.details.existing_feature,{name:'Door',description:feature.description,state:'closed',passable:false});
  assert.deepEqual(error.details.conflicting_fields,['description']);
  assert.match(error.fix,/omit.*additions/i);
  return true;
 });
 assert.deepEqual(world,before);
});
