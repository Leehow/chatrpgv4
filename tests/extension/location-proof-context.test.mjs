/** Completion reads exact current location facts and carries identity across its narrow reviews. */
import test from 'node:test';import assert from 'node:assert/strict';
const {locationCoverageContext,locationRouteBatch,locationObservationBatch}=await import('../../extensions/table/location-relevance.ts');
const binding={campaign:'proof',turn:4};
const input={player_declaration:'Return to the landlord office and look for a light inside.',current_place:'commission-briefing',current_display_name:"Knott's Office",current_position:{place:'commission-briefing'},place_identities:[{name:'commission-briefing',display_name:"Knott's Office"}],
 settled_receipts:[{kind:'move',from:'Shop',to:'commission-briefing'},{kind:'place',action:'observe',observation:{from:{place:'commission-briefing'},to:{place:'commission-briefing',at:'Window'},sense:'sight',access:'clear',scope:'The light inside.',facts:['The desk lamp is on.']}}],proposed_effects:[]};
test('exact location read retains features and only identities referenced by the current proof',()=>{
 const read={place:{name:'commission-briefing',display_name:"Knott's Office",features:[{name:'Window',description:'A green window.'}]},catalogue:[{kind:'place',name:'Shop',display_name:'Grocery'},{kind:'place',name:'Unrelated secret',summary:'Do not carry this.'}]};
 const value=locationCoverageContext(read,input.settled_receipts);
 assert.equal(value.features[0].name,'Window');assert.equal(value.current_position.place,'commission-briefing');
 assert.deepEqual(value.place_identities.map(x=>x.name),['commission-briefing','Shop']);assert(!JSON.stringify(value).includes('Unrelated secret'));
});
test('route proof retains the canonical handle and its display identity without copying scenery',()=>{
 const batch=locationRouteBatch(input,binding),point=batch.state.location_steps[0].destination;
 assert.equal(point.place,'commission-briefing');assert.equal(point.display_name,"Knott's Office");assert(!JSON.stringify(batch.state).includes('desk lamp'));
});
test('observation proof retains actual scope, stage and reference context without unrelated proposed actions',()=>{
 const before=structuredClone(input),batch=locationObservationBatch({...input,proposed_effects:[{kind:'npc',name:'Other',to:'here'}],people:[{ref:'npc_1',display_name:'The landlord'}]},binding);
 assert.equal(batch.state.observations[0].stage,'committed');assert.deepEqual(batch.state.observations[0].facts,['The desk lamp is on.']);
 assert.equal(batch.questions[0].target,'observations');assert(!JSON.stringify(batch.state).includes('Other'));
 assert.deepEqual(input,before);
});
