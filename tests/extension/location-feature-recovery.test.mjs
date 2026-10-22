/** Exercise the production location repair before any movement. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importSource} from '../integration/support.ts';
const {stageLocation}=await importSource('kernel-ts/mods/locations.ts');

test('a repeated feature keeps its canonical identity and is reported, never refused (§250)',()=>{
 const node={node_id:'scene-location-inn',name:'Inn',properties:{description:'A small inn.'}};
 const feature={id:'feature-location-door',place:'Inn',name:'Door',description:'An old oak door.',state:'closed',passable:false};
 const world={active_scene:'Inn',mods:{state:{'enhanced-locations':{locations:{schema:1,places:[{id:node.node_id,name:'Inn'}],features:[feature]}}}}};
 const before=structuredClone(world);
 const context={world,graph:{scenes:()=>[node],nameKeys:()=>['Inn'],handle:()=> 'Inn'},turn:{turn:1},callId:'fixture',mint:id=>id};
 const {receipt}=stageLocation(context,{kind:'place',action:'establish',additions:[{name:'Inn',features:[{name:'Door',description:'A newly painted door.',state:'open'}]}]},[{id:'enhanced-locations',requires:['locations.v1']}]);
 assert.deepEqual(world.mods.state['enhanced-locations'].locations.features,before.mods.state['enhanced-locations'].locations.features,'description and state stay as registered');
 assert.deepEqual(receipt.features,[]);
 assert.deepEqual(receipt.adjusted,[{field:'additions[0].features',reason:'existing_feature_kept',place:'Inn',feature:'Door'}]);
});
