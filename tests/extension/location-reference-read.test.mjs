/** Real location-read boundaries; controlled fixtures are not live-play evidence. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,CAMPAIGN} from '../integration/support.ts';
import {locationIdentityContext} from '../../extensions/table/location-context.ts';

const world=k=>JSON.parse(readFileSync(join(campaignDir(k.workspace),'world.json'),'utf8'));
const inspect=(k,params)=>k.ok('mods.locations.inspect',{campaign:CAMPAIGN,...params});
async function room(t,extra=[]){
    const k=await kernel(t);await openTurn(k,'I stand by the room window.');
    await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'establish',additions:[
        {name:'Inn room',description:'An upstairs room.',features:[{name:'window',description:'A glass casement.',state:'closed',passable:false}]},...extra]}]});
    return k;
}

test('the exact offered feature reference reads its owning place instead of reporting it unregistered',async t=>{
    const k=await room(t),before=world(k);
    const offered=(await inspect(k,{name:'Inn room'})).catalogue.find(candidate=>candidate.kind==='feature'&&candidate.feature==='window');
    assert(offered,'the existing catalogue must offer the window');
    const read=await inspect(k,{name:offered.name});
    assert.notEqual(read.status,'unregistered','a reference offered by this read API must be readable');
    assert.deepEqual(read.reference,{kind:'feature',place:'Inn room',at:'window'});
    assert.equal(read.place.name,'Inn room');
    assert.deepEqual(read.target_feature,{name:'window',description:'A glass casement.',state:'closed',passable:false});
    assert.deepEqual(offered.reference,read.reference);
    assert.deepEqual(offered.read,{action:'inspect',need:'context',name:'Inn room',at:'window'});
    const {action,...pointer}=offered.read;
    assert.equal(action,'inspect');
    assert.deepEqual((await inspect(k,pointer)).reference,read.reference);
    const projected=locationIdentityContext({catalogue:[{...offered,private_notes:'NEVER_PROJECT'}]});
    assert.deepEqual(projected.candidates[0].reference,read.reference);
    assert.deepEqual(projected.candidates[0].read,offered.read);
    assert(!JSON.stringify(projected).includes('NEVER_PROJECT'));
    assert.deepEqual(world(k),before,'inspection grants no movement, perception or state change');
});

test('context and observation inspections preserve explicit features, spots and exact child-place identity',async t=>{
    const k=await room(t,[{name:'window',within:'Inn room',description:'A separately registered small room with this name.'}]),before=world(k);
    const child=await inspect(k,{name:'Inn room / window'});
    assert.deepEqual(child.reference,{kind:'place',place:'Inn room / window'},'an actual exact place wins over a feature display name');
    const explicit=await inspect(k,{name:'Inn room',at:'window',relation:'near'});
    assert.deepEqual(explicit.reference,{kind:'feature',place:'Inn room',at:'window',relation:'near'});
    const observation=await inspect(k,{name:'Inn room',at:'window',relation:'near',need:'observation'});
    assert.deepEqual(observation.observation.to,{place:'Inn room',at:'window',relation:'near'});
    const spot=await inspect(k,{name:'Inn room',spot:'clear floor',relation:'standing'});
    assert.deepEqual(spot.reference,{kind:'spot',place:'Inn room',spot:'clear floor',relation:'standing'});
    assert.equal(spot.target_spot,'clear floor');
    assert.equal((await inspect(k,{name:'Inn room',at:'unknown window'})).status,'unregistered');
    assert.equal((await inspect(k,{name:'Inn room / invented window'})).status,'unregistered');
    const invalid=await k.err('mods.locations.inspect',{campaign:CAMPAIGN,name:'Inn room',at:'window',spot:'clear floor'});
    assert.equal(invalid.code,'invalid_params');assert.equal(invalid.details.reason,'place_point_shape');
    assert.deepEqual(world(k),before,'all reads leave every canonical field unchanged');
});

test('a qualified feature observation read matches its explicit target and does not grant new perception',async t=>{
    const k=await room(t),before=world(k);
    const qualified=await inspect(k,{name:'Inn room / window',relation:'near',need:'observation'});
    const explicit=await inspect(k,{name:'Inn room',at:'window',relation:'near',need:'observation'});
    assert.deepEqual(qualified.observation,explicit.observation);
    assert.deepEqual(qualified.observation.to,{place:'Inn room',at:'window',relation:'near'});
    assert.equal(qualified.observation.last_observation,undefined);
    assert.equal(qualified.observation.latest_settled,undefined);
    assert.deepEqual(world(k),before);
});

test('a mistaken feature-as-place write refuses atomically with its exact correction and then settles once',async t=>{
    const k=await room(t),before=world(k);
    const command={kind:'place',action:'observe',to:'Inn room / window',sense:'sight',access:'clear',scope:'The casement.',view:'The casement is visible from the current place.',facts:['The glass is dusty.']};
    const error=await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'time',minutes:2,why:'The selected inspection.'},command]});
    assert.equal(error.code,'invalid_params');assert.equal(error.details.reason,'place_observation_point_unresolved');
    assert.deepEqual(error.details.reference,{kind:'feature',place:'Inn room',at:'window'});
    assert.deepEqual(world(k),before,'no time or partial observation survives a refused proposal');
    const corrected={...command,to:error.details.reference.place,at:error.details.reference.at};
    const result=await k.table('apply',{call_id:'t1-c2',effects:[{kind:'time',minutes:2,why:'The selected inspection.'},corrected]});
    assert.equal(world(k).clock.minutes,before.clock.minutes+2);
    assert.deepEqual(result.outcomes[1].observation.to,{place:'Inn room',at:'window'});
    const saved=world(k);assert.equal((await k.table('apply',{call_id:'t1-c2',effects:[{kind:'time',minutes:2,why:'The selected inspection.'},corrected]})).replayed,true);
    assert.deepEqual(world(k),saved,'replay cannot charge time or perception twice');
});
