/** Real TS RPC transactions, not live-play evidence (contract 242). */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,RpcClient,CAMPAIGN,ROOT,type Row} from './support.ts';
import {turnPacket,compileTurnPacket} from '../../runtime/turn-packet-prototype.ts';
const state=(k:RpcClient)=>JSON.parse(readFileSync(join(campaignDir(k.workspace),'world.json'),'utf8'));
const locations=(k:RpcClient)=>state(k).mods.state['enhanced-locations'].locations;
const inspect=(k:RpcClient,name?:string)=>k.ok('mods.locations.inspect',{campaign:CAMPAIGN,...(name?{name}:{})});
const hotel=(name:string)=>({name,within:null,description:`The public entrance of ${name}.`});
const room=(parent:string)=>({name:'Room 203',within:parent,description:`A small room in ${parent}.`,features:[{name:'window',description:'A narrow wooden window.',state:'closed',passable:false}]});

test('places have scoped durable identities, public detail, local position and remote reads',async t=>{
    const k=await kernel(t);await openTurn(k,'I visit a nearby ordinary hotel.');
    const original=state(k).active_scene;
    const result=await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'Hotel A / Lobby',via:'Along the street and through the entrance',travel_band:'local_travel',
        additions:[hotel('Hotel A'),{name:'Lobby',within:'Hotel A',description:'A modest tiled lobby.',features:[{name:'front desk',description:'A wooden counter with a brass bell.'}]},room('Hotel A'),hotel('Hotel B'),room('Hotel B')]}]});
    assert.equal(result.outcomes[0].kind,'move');assert(result.outcomes[0].minutes>0);
    const records=locations(k).places;
    assert.equal(new Set(records.map((record:Row)=>record.id)).size,5);
    assert(records.every((record:Row)=>record.from===undefined&&record.source_anchor===original),'registration keeps a reading anchor without inventing roads');
    assert.equal(records.find((record:Row)=>record.name==='Hotel A').within,null,'omission/null is not the departure office');
    assert.equal((await inspect(k,'Hotel B / Room 203')).place.description,'A small room in Hotel B.');
    assert.equal(state(k).active_scene,'Hotel A / Lobby','remote inspection cannot move');
    await k.table('apply',{call_id:'t1-c2',effects:[{kind:'place',action:'move',to:'here',at:'front desk',relation:'beside'}]});
    assert.deepEqual(locations(k).position,{place:'Hotel A / Lobby',at:'front desk',relation:'beside'});
    const capsule=await k.table('capsule');
    assert.equal(capsule.where.location.position.at,'front desk');
    assert.equal(capsule.public_scene.description,'A modest tiled lobby.');
    assert.equal(capsule.where.location.features[0].description,'A wooden counter with a brass bell.');
    const instruction=capsule.mods.instructions.find((entry:Row)=>entry.mod==='enhanced-locations');
    assert.equal(instruction.form,'indexed');assert(!instruction.instruction.includes('## Identity and structure'));
    const contract=await k.ok('mods.locations.inspect',{campaign:CAMPAIGN,need:'contract'});
    assert(contract.parameters&&contract.command);assert.equal(contract.location_inspection.turn,1);
    assert(contract.sections.some((section:Row)=>section.heading==='Travel and local position'));
    const view=await inspect(k);assert.equal(view.place.position.at,'front desk');
    await k.table('apply',{call_id:'t1-c3',effects:[{kind:'place',action:'move',to:'Room 203',via:'Up the stairs',travel_band:'adjacent'}]});
    assert.equal(state(k).active_scene,'Hotel A / Room 203','a scoped leaf reuses this hotel room');
    await k.table('apply',{call_id:'t1-c4',effects:[{kind:'place',action:'move',to:original,via:'Back along the street',travel_band:'local_travel'}]});
    const ambiguous=await k.err('mods.locations.inspect',{campaign:CAMPAIGN,name:'Room 203'});
    assert.equal(ambiguous.details.reason,'ambiguous');assert.equal(ambiguous.details.candidates.length,2);
    assert.equal((await k.tableErr('apply',{call_id:'t1-c5',effects:[{kind:'move',to:'Hotel B / Room 203'}]})).code,'not_reachable','an unvisited registered room has no forged road from the old office');
    await k.table('apply',{call_id:'t1-c5',effects:[{kind:'place',action:'move',to:'Hotel B / Room 203',via:'Across town',travel_band:'local_travel'}]});
    const before=locations(k).places.map((record:Row)=>[record.id,record.name]);
    await k.close();const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());
    await restarted.table('open');
    assert.deepEqual(locations(restarted).places.map((record:Row)=>[record.id,record.name]),before);
    assert.equal((await inspect(restarted)).place.features[0].state,'closed');
});

test('atomic failure, replay and an earlier feature change share the canonical batch',async t=>{
    const k=await kernel(t);await openTurn(k,'I go to the garden through the window.');
    const original=state(k),input={call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'Inn',via:'Down the street',travel_band:'adjacent',
        additions:[{...hotel('Inn'),features:[{name:'window',description:'A tall casement.',state:'locked',passable:false}]}]},{kind:'time',minutes:-1}]};
    assert.equal((await k.tableErr('apply',input)).code,'invalid_params');
    assert.deepEqual(state(k),original,'rejected creation and travel must not change disk');
    assert.equal((await inspect(k,'Inn')).status,'unregistered','failed graph additions cannot leak');
    const accepted={...input,effects:input.effects.slice(0,1)};
    await k.table('apply',accepted);const committed=state(k);
    assert.equal((await k.table('apply',accepted)).replayed,true);assert.deepEqual(state(k),committed);
    const blocked={call_id:'t1-c2',effects:[{kind:'place',action:'move',to:'Garden',via:'Through the casement',through:{place:'Inn',feature:'window'},travel_band:'adjacent',additions:[hotel('Garden')]}]};
    const refusal=await k.tableErr('apply',blocked);
    assert.equal(refusal.code,'not_reachable');assert.equal(refusal.details.reason,'place_barrier');assert.equal(refusal.details.state,'locked');
    assert.deepEqual(state(k),committed);
    const landed=await k.table('apply',{call_id:'t1-c3',effects:[{kind:'item',name:'Room key',quantity:1},{kind:'place',action:'feature',to:'Inn',at:'window',state:'open',passable:true},...blocked.effects]});
    assert.deepEqual((await k.table('status',{projection:'receipts'})).receipts.filter((receipt:Row)=>receipt.call_id==='t1-c3').map((receipt:Row)=>receipt.kind),['item','place','move']);
    assert.equal((await inspect(k,'Inn')).place.features[0].state,'open');assert.equal(state(k).active_scene,'Garden');
    await k.table('apply',{call_id:'t1-c4',effects:[{kind:'move',to:'Inn'}]});
    assert.equal(locations(k).position,undefined,'legacy canonical arrival clears stale local position');
    assert.equal((await inspect(k)).place.features[0].passable,true);
});

test('a shared parent supplies neither a free route nor zero travel and source features remain overlays',async t=>{
    const k=await kernel(t);await openTurn(k,'I travel between districts.');
    const authored=state(k).active_scene;
    await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'establish',additions:[hotel('City'),{name:'East',within:'City',description:'The east district.'},{name:'West',within:'City',description:'The west district.'},
        {name:authored,features:[{name:'side corner',description:'A quiet corner beside the wall.'}]}]}]});
    await k.table('apply',{call_id:'t1-c2',effects:[{kind:'place',action:'move',to:'City / East',via:'Along the road',travel_band:'local_travel'}]});
    const offered=(await k.table('apply.options')).candidates.find((candidate:Row)=>candidate.effect.kind==='move'&&candidate.effect.to==='City / West');
    assert.equal(offered.description.locations,true);assert.equal(offered.description.requires_via,true);
    const legacy=await k.tableErr('apply',{call_id:'t1-c3',effects:[{kind:'move',to:'City / West'}]});assert.equal(legacy.code,'not_reachable');
    const error=await k.tableErr('apply',{call_id:'t1-c3',effects:[{kind:'place',action:'move',to:'City / West',travel_band:'local_travel'}]});
    assert.equal(error.code,'invalid_params');assert.equal(error.details.reason,'place_route_required');assert.equal(error.details.field,'via');
    const moved=await k.table('apply',{call_id:'t1-c4',effects:[{kind:'place',action:'move',to:'City / West',via:'Across the city',travel_band:'local_travel'}]});
    assert(moved.outcomes[0].minutes>0);
    assert.equal((await inspect(k,authored)).place.features[0].name,'side corner');
});

test('a versioned Mod migration and disable keep saved places readable while enhanced writes stop',async t=>{
    const k=await kernel(t);await openTurn(k,'I visit an ordinary inn.');
    await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'Inn',via:'Along the road',travel_band:'adjacent',additions:[hotel('Inn')]}]});
    await k.table('narrate',{call_id:'t1-c2',text:'The inn stands beside the road.'});
    const identity=locations(k).places[0].id;
    const path=join(k.workspace,'location-upgrade');mkdirSync(path);
    for(const file of ['agent.md','sections.json'])writeFileSync(join(path,file),readFileSync(join(ROOT,'mods/enhanced-locations',file)));
    const manifest=JSON.parse(readFileSync(join(ROOT,'mods/enhanced-locations/mod.json'),'utf8'));
    manifest.version='1.1.0';manifest.state_version=2;manifest.migrations=[{from:1,to:2,operations:[{op:'default',key:'migration_marker',value:true}]}];
    writeFileSync(join(path,'mod.json'),JSON.stringify(manifest));
    await k.ok('mods.install',{campaign:CAMPAIGN,path});
    await k.ok('mods.configure',{campaign:CAMPAIGN,id:'enhanced-locations',version:'1.1.0'});
    assert.equal(locations(k).places[0].id,identity);
    assert.equal(state(k).mods.state['enhanced-locations'].migration_marker,true);
    await k.ok('mods.configure',{campaign:CAMPAIGN,id:'enhanced-locations',enabled:false});
    const view=await inspect(k);assert.equal(view.enabled,false);assert.equal(view.place.name,'Inn');
    await k.table('player_input',{text:'I move locally.'});
    const error=await k.tableErr('apply',{call_id:'t2-c1',effects:[{kind:'place',action:'move',to:'Inn'}]});
    assert.equal(error.details.reason,'location_mod_inactive');assert.equal(locations(k).places[0].id,identity);
});

test('repeated destinations in one mixed journey have unique receipts and real travelled roads',async t=>{
    const k=await kernel(t);await openTurn(k,'I visit the inn, return, and visit it again.');
    const original=state(k).active_scene,input={call_id:'t1-c1',effects:[
        {kind:'place',action:'move',to:'Inn',via:'Along the street',travel_band:'local_travel',additions:[hotel('Inn')]},
        {kind:'place',action:'move',to:original},
        {kind:'place',action:'move',to:'Inn'},
    ]};
    await k.table('apply',input);
    const receipts=(await k.table('status',{projection:'receipts'})).receipts.filter((receipt:Row)=>receipt.call_id===input.call_id);
    assert.equal(receipts.length,3);assert.equal(new Set(receipts.map((receipt:Row)=>receipt.id)).size,3);
    assert(receipts.every((receipt:Row)=>receipt.minutes>0));assert.equal(locations(k).places.length,1);
    const before=state(k);assert.equal((await k.table('apply',input)).replayed,true);assert.deepEqual(state(k),before);
});

test('a typed place journey and its subsequent purchase preview the same day without writing',async t=>{
    const k=await kernel(t);await openTurn(k,'I travel to another town and buy the agreed meal.');
    await k.table('apply',{call_id:'t1-c1',effects:[{kind:'cash',delta:1,source:'found'},{kind:'cash',delta:-1,source:'found'}]});
    const sheet=()=>JSON.parse(readFileSync(join(campaignDir(k.workspace),'party/thomas-hayes.json'),'utf8'));
    const effects=[{kind:'place',action:'move',to:'Roadside cafe',via:'A day on the road',travel_minutes:1440,additions:[hotel('Roadside cafe')]},
        {kind:'cash',delta:-1,source:'quote',with:'Steven Knott',category:'purchase',why:'The agreed meal.'}];
    const before=state(k),card=sheet(),preview=await k.table('apply.options',{cash_effects:effects});
    assert.deepEqual(state(k),before);assert.deepEqual(sheet(),card);assert.equal(preview.cash_previews[0].index,1);
    await k.table('apply',{call_id:'t1-c2',effects});
    const paid=(await k.table('status',{projection:'receipts'})).receipts.filter((receipt:Row)=>receipt.kind==='cash'&&receipt.call_id==='t1-c2').at(-1);
    assert.equal(paid.delta,preview.cash_previews[0].delta);assert(state(k).clock.minutes>=1440);assert.equal(state(k).active_scene,'Roadside cafe');
});

test('a missing parent returns its exact correction and a native arrival plus activity shares one clock',async t=>{
    const k=await kernel(t);await openTurn(k,'I visit an ordinary hotel and ask about a room.');
    const before=state(k),journey={kind:'place',action:'move',to:'Ordinary Hotel',via:'Along the street',travel_band:'local_travel',additions:[{...hotel('Ordinary Hotel'),within:'null'}]};
    const error=await k.tableErr('apply',{call_id:'t1-c1',effects:[journey]});
    assert.equal(error.details.reason,'place_parent_unregistered');assert.equal(error.details.field,'additions[0].within');
    assert.match(error.fix,/JSON null/);assert.deepEqual(state(k),before);
    const packet=turnPacket(JSON.stringify({version:4,commands:[{...journey,additions:[hotel('Ordinary Hotel')]},
        {kind:'time',band:'speak_briefly',reason:'Ask the clerk about a room.',beyond_travel:true}]}));
    await k.table('apply',{call_id:'t1-c1',effects:compileTurnPacket(packet).effects});
    const receipts=(await k.table('status',{projection:'receipts'})).receipts.filter((receipt:Row)=>receipt.call_id==='t1-c1');
    assert.deepEqual(receipts.map((receipt:Row)=>receipt.kind),['move','time']);
    assert.equal(receipts[1].beyond_travel,true);assert(receipts[0].minutes>=10);assert(receipts[1].minutes<=3);
    assert.equal(state(k).clock.minutes-before.clock.minutes,receipts.reduce((sum:number,receipt:Row)=>sum+receipt.minutes,0));
    assert.equal(state(k).active_scene,'Ordinary Hotel');assert.equal(locations(k).places.length,1);
});

test('a qualified child addition canonicalizes once and remains locally addressable',async t=>{
    const k=await kernel(t);await openTurn(k,'I enter the inn room.');
    await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'Inn / Room 203',via:'Through the entrance and up the stairs',travel_band:'adjacent',
        additions:[hotel('Inn'),{...room('Inn'),name:'Inn / Room 203'}]}]});
    const records=locations(k).places;
    assert.deepEqual(records.map((record:Row)=>record.name),['Inn','Inn / Room 203']);assert.equal(records[1].label,'Room 203');
    assert.equal((await inspect(k,'Room 203')).place.name,'Inn / Room 203');
    await k.table('apply',{call_id:'t1-c2',effects:[{kind:'place',action:'establish',additions:[{name:'Inn / Room 203',within:'Inn'}]}]});
    assert.deepEqual(locations(k).places.map((record:Row)=>record.id),records.map((record:Row)=>record.id));
});

test('an unregistered destination or local feature is a recoverable definition gap, not a physical barrier',async t=>{
    const k=await kernel(t);await openTurn(k,'I visit the inn and approach its window.');
    const missing=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'Inn',via:'Along the street'}]});
    assert.equal(missing.code,'invalid_params');assert.equal(missing.details.field,'to');assert.equal(missing.details.reason,'place_reference_unresolved');
    await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'Inn',via:'Along the street',travel_band:'adjacent',additions:[hotel('Inn')]}]});
    const before=state(k),error=await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'place',action:'move',to:'here',at:'window',relation:'beside'}]});
    assert.equal(error.code,'invalid_params');assert.equal(error.details.field,'at');assert.deepEqual(state(k),before);
    await k.table('apply',{call_id:'t1-c2',effects:[{kind:'place',action:'move',to:'here',at:'window',relation:'beside',additions:[{name:'Inn',features:[{name:'window',description:'A wooden window.',state:'closed',passable:false}]}]}]});
    assert.equal(locations(k).position.at,'window');assert.equal(locations(k).places.length,1);
});
