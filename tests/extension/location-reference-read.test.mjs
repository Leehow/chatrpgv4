/** Real location-read boundaries; controlled fixtures are not live-play evidence. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,CAMPAIGN} from '../integration/support.ts';

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
    assert.deepEqual(world(k),before,'inspection grants no movement, perception or state change');
});
