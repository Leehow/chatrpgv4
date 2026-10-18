import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,createCampaign} from './support.ts';

test('author scene material reuses only committed stationary public deliveries at the current place',async t=>{
 const k=await kernel(t);await createCampaign(k);await k.table('open');
 await k.table('narrate',{call_id:'t0-c1',text:'A blue lamp stands on the office desk.'});
 await k.table('player_input',{text:'I look at the lamp.'});
 let c=await k.table('capsule');
 assert.ok(c.public_scene.entries.some((r:any)=>r.text==='A blue lamp stands on the office desk.'));
 assert.ok(!JSON.stringify(c.public_scene).includes('Corbitt'));
 await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'Fixture Street',via:'front door',travel_minutes:3,establish:{summary:'PRIVATE SCENE SUMMARY',within:null}}]});
 await k.table('narrate',{call_id:'t1-c2',text:'You leave the blue lamp and walk into the street.'});
 await k.table('player_input',{text:'I look around.'});c=await k.table('capsule');
 assert.deepEqual(c.public_scene.entries,[],'travel prose cannot be assumed to belong entirely to its destination');
 assert.ok(!JSON.stringify(c.public_scene).includes('PRIVATE SCENE SUMMARY'));
 await k.table('narrate',{call_id:'t2-c1',text:'A red postbox stands beside the street gate.'});
 await k.table('player_input',{text:'I wait by the gate.'});c=await k.table('capsule');
 assert.equal(c.public_scene.entries[0].text,'A red postbox stands beside the street gate.');
});
