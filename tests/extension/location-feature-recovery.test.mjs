/** Exercise the production location repair before any movement. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir} from '../integration/support.ts';

test('a repeated feature keeps its canonical identity and is reported, never refused (§250)',async t=>{
 const k=await kernel(t);await openTurn(k,'I examine the inn door.');
 const world=()=>JSON.parse(readFileSync(join(campaignDir(k.workspace),'world.json'),'utf8'));
 const locations=()=>world().mods.state['enhanced-locations'].locations;
 await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'establish',additions:[{name:'Inn',within:null,description:'A small inn.',features:[{name:'Door',description:'An old oak door.',state:'closed',passable:false}]}]}]});
 const before=structuredClone(locations()),beforeWorld=world();
 await k.table('apply',{call_id:'t1-c2',effects:[{kind:'place',action:'establish',additions:[{name:'Inn',features:[{name:'Door',description:'A newly painted door.',state:'open'}]}]}]});
 const receipt=(await k.table('status',{projection:'receipts'})).receipts.find(row=>row.call_id==='t1-c2'&&row.kind==='place');
 assert.ok(receipt,'the canonical transaction retains its place receipt');
 assert.deepEqual(locations().features,before.features,'identity, description and state stay as registered');
 assert.deepEqual(locations().places,before.places,'a repeated addition does not nest or duplicate an existing place');
 assert.equal(world().active_scene,beforeWorld.active_scene);
 assert.deepEqual(world().clock,beforeWorld.clock);
 assert.deepEqual(receipt.added,[]);
 assert.deepEqual(receipt.features,[]);
 assert.deepEqual(receipt.adjusted,[{field:'additions[0].features',reason:'existing_feature_kept',place:'Inn',feature:'Door'}]);
});
