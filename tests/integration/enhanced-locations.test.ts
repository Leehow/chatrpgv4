/** Real TS RPC transactions, not live-play evidence (contract 242). */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,RpcClient,CAMPAIGN,ROOT,importSource,type Row} from './support.ts';
import {turnPacket,compileTurnPacket} from '../../runtime/turn-packet-prototype.ts';
import {PLACE_CONTRACT_GUIDE} from '../../shared/place-structures.ts';
const state=(k:RpcClient)=>JSON.parse(readFileSync(join(campaignDir(k.workspace),'world.json'),'utf8'));
const locations=(k:RpcClient)=>state(k).mods.state['enhanced-locations'].locations;
const inspect=(k:RpcClient,name?:string)=>k.ok('mods.locations.inspect',{campaign:CAMPAIGN,...(name?{name}:{})});
const hotel=(name:string)=>({name,within:null,description:`The public entrance of ${name}.`});
const room=(parent:string)=>({name:'Room 203',within:parent,description:`A small room in ${parent}.`,features:[{name:'window',description:'A narrow wooden window.',state:'closed',passable:false}]});

test('campaign graph hydration resolves forward references once and retains strict missing targets',async()=>{
    const {ModuleGraph}=await importSource('kernel-ts/read/module-graph.ts');
    const raw={nodes:[],relations:[],claims:[]},before=structuredClone(raw),graph=new ModuleGraph('fixture',raw,'digest',{});
    const records=[{id:'clue-table-scratch',kind:'clue',name:'Scratch',scene:'Annex / Room'},
        {id:'scene-table-room',kind:'scene',name:'Annex / Room',within:'Annex'},
        {id:'scene-table-annex',kind:'scene',name:'Annex'}];
    graph.addTableEntities(records);
    assert.ok(graph.sceneClueIds(graph.scene('Annex / Room')).includes('clue-table-scratch'));
    assert.ok(graph.groupOut(graph.scene('Annex / Room')).some((edge:Row)=>edge.relation_kind==='located-in'&&edge.to_node_id==='scene-table-annex'));
    graph.addTableEntities([...records].reverse());
    assert.equal(graph.groupOut(graph.scene('Annex / Room')).filter((edge:Row)=>edge.relation_kind==='located-in').length,1);
    assert.equal(graph.groupIncoming(graph.scene('Annex / Room')).filter((edge:Row)=>edge.relation_kind==='discoverable-at').length,1);
    assert.equal(graph.addTableEntity({...records[2],name:'Replacement'}).name,'Annex');
    assert.throws(()=>graph.addTableEntity({id:'clue-table-missing',kind:'clue',name:'Missing target',scene:'Unregistered'}),/no scene named/);
    assert.deepEqual(raw,before);
});

test('new clues in Mod places remain readable across every reload and a fresh kernel process',async t=>{
    const k=await kernel(t);await openTurn(k,'I enter an unlisted tea room and examine its window.');
    await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'Ordinary tea room',via:'Across the street',travel_band:'adjacent',additions:[hotel('Ordinary tea room')]}]});
    await k.table('apply',{call_id:'t1-c2',effects:[{kind:'clue',clue:'A scratch on the window',how:'Seen while examining the window.',establish:{summary:'A fresh scratch crosses the glass.'}}]});
    const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());
    for(const client of [k,restarted]){
        assert.equal((await client.table('capsule')).where.scene,'Ordinary tea room');
        assert.ok((await client.table('look',{focus:'clues'})).discovered_clues.includes('A scratch on the window'));
        assert.equal((await client.table('status')).receipts.filter((receipt:Row)=>receipt.kind==='clue').length,1);
    }
    assert.equal(locations(k).places.filter((place:Row)=>place.name==='Ordinary tea room').length,1);
});

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
    await k.table('apply',{call_id:'t1-c2',effects:[{kind:'place',action:'move',to:'here',at:'front desk',relation:'beside',via:'Along the tiled lobby aisle'}]});
    const local=(await k.table('status',{projection:'receipts'})).receipts.find((receipt:Row)=>receipt.call_id==='t1-c2');
    assert.equal(local.via,'Along the tiled lobby aisle','the committed local route remains available after the apply response');
    assert.deepEqual(locations(k).position,{place:'Hotel A / Lobby',at:'front desk',relation:'beside'});
    const capsule=await k.table('capsule');
    assert.equal(capsule.where.location.position.at,'front desk');
    assert.equal(capsule.public_scene.description,'A modest tiled lobby.');
    assert.equal(capsule.where.location.features[0].description,'A wooden counter with a brass bell.');
    const instruction=capsule.mods.instructions.find((entry:Row)=>entry.mod==='enhanced-locations');
    assert.equal(instruction.form,'indexed');assert(!instruction.instruction.includes('## Identity and structure'));
    const contract=await k.ok('mods.locations.inspect',{campaign:CAMPAIGN,need:'contract'});
    // §250: the contract read is a pointer to the declared tool and output schemas, never a second grammar.
    assert.equal(contract.guide,PLACE_CONTRACT_GUIDE);assert.equal(contract.location_inspection.turn,1);
    assert.equal(contract.parameters,undefined);assert.equal(contract.command,undefined);assert.equal(contract.sections,undefined);
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
    // §250: a new route the Keeper did not describe is an open, improvised arrival with its band's travel time.
    const moved=await k.table('apply',{call_id:'t1-c3',effects:[{kind:'place',action:'move',to:'City / West',travel_band:'local_travel'}]});
    assert(moved.outcomes[0].minutes>0);
    const arrival=(await k.table('status',{projection:'receipts'})).receipts.find((receipt:Row)=>receipt.call_id==='t1-c3'&&receipt.kind==='move');
    assert.equal(arrival.improvised,true);assert(arrival.adjusted.some((row:Row)=>row.reason==='open_route'));
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
    manifest.version='1.2.0';manifest.state_version=2;manifest.migrations=[{from:1,to:2,operations:[{op:'default',key:'migration_marker',value:true}]}];
    writeFileSync(join(path,'mod.json'),JSON.stringify(manifest));
    await k.ok('mods.install',{campaign:CAMPAIGN,path});
    await k.ok('mods.configure',{campaign:CAMPAIGN,id:'enhanced-locations',version:'1.2.0'});
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

test('an unresolvable parent registers a standalone place, and a native arrival plus activity shares one clock (§250)',async t=>{
    const k=await kernel(t);await openTurn(k,'I visit an ordinary hotel and ask about a room.');
    const before=state(k),journey={kind:'place',action:'move',to:'Ordinary Hotel',via:'Along the street',travel_band:'local_travel',additions:[hotel('Ordinary Hotel')]};
    await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'establish',additions:[{...hotel('Other Hotel'),within:'null'}]}]});
    const other=locations(k).places.find((record:Row)=>record.name==='Other Hotel');assert(other);assert.equal(other.within,null);
    const registered=(await k.table('status',{projection:'receipts'})).receipts.find((row:Row)=>row.call_id==='t1-c1'&&row.kind==='place');
    assert(registered.adjusted.some((row:Row)=>row.reason==='unregistered_parent_ignored'&&row.requested==='null'));
    assert.equal(state(k).active_scene,before.active_scene,'registration moves nobody');
    const packet=turnPacket(JSON.stringify({version:4,commands:[journey,{kind:'time',band:'speak_briefly',reason:'Ask the clerk about a room.'}]}));
    await k.table('apply',{call_id:'t1-c2',effects:compileTurnPacket(packet).effects});
    const receipts=(await k.table('status',{projection:'receipts'})).receipts.filter((receipt:Row)=>receipt.call_id==='t1-c2');
    assert.deepEqual(receipts.map((receipt:Row)=>receipt.kind),['move','time']);
    assert(receipts[0].minutes>=10);assert(receipts[1].minutes<=3);
    assert.equal(state(k).clock.minutes-before.clock.minutes,receipts.reduce((sum:number,receipt:Row)=>sum+receipt.minutes,0));
    assert.equal(state(k).active_scene,'Ordinary Hotel');assert.equal(locations(k).places.length,2);
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

test('an undefined destination refuses with the known places, and an unregistered feature becomes a descriptive spot (§250)',async t=>{
    const k=await kernel(t);await openTurn(k,'I visit the inn and approach its window.');
    const before=state(k),missing=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'Inn',via:'Along the street'}]});
    assert.equal(missing.code,'invalid_params');assert.equal(missing.details.reason,'place_destination_unknown');
    assert(Array.isArray(missing.details.known_places)&&missing.details.known_places.includes(before.active_scene),'the known places travel with the refusal');
    assert.deepEqual(state(k),before,'another wording of a known place is never registered as a second place');
    await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'Inn',via:'Along the street',travel_band:'adjacent',additions:[hotel('Inn')]}]});
    await k.table('apply',{call_id:'t1-c2',effects:[{kind:'place',action:'move',to:'here',at:'window',relation:'beside'}]});
    assert.equal(locations(k).position.spot,'window');assert.equal(locations(k).position.at,undefined);assert.equal(locations(k).features.length,0);
    await k.table('apply',{call_id:'t1-c3',effects:[{kind:'place',action:'move',to:'here',at:'window',relation:'beside',additions:[{name:'Inn',features:[{name:'window',description:'A wooden window.',state:'closed',passable:false}]}]}]});
    assert.equal(locations(k).position.at,'window');assert.equal(locations(k).places.length,1);
});

test('descriptive positions persist through real observation and restart without creating features',async t=>{
    const k=await kernel(t);await openTurn(k,'I stand in an ordinary unregistered corner and look across the room.');
    const here=state(k).active_scene;
    const move=await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'here',spot:'left corner beside the rug',relation:'standing'}]});
    assert.deepEqual(move.outcomes[0].position,{place:here,spot:'left corner beside the rug',relation:'standing'});
    assert.equal(locations(k).features.length,0);assert.equal(locations(k).places.length,0);
    const seen=await k.table('apply',{call_id:'t1-c2',effects:[{kind:'place',action:'observe',to:'here',sense:'sight',access:'clear',scope:'Across the room from the corner',facts:['The desk remains across the room.']}]});
    assert.deepEqual(locations(k).observations[0].from,locations(k).position);
    assert.equal(seen.outcomes[0].observation.from.spot,locations(k).position.spot);
    assert.equal(seen.outcomes[0].observation.from.relation,locations(k).position.relation);
    assert.notEqual(seen.outcomes[0].observation.from.place,here,'public observation does not leak a private source handle');
    assert.equal(seen.outcomes[0].observation.observed_clock.minutes,state(k).clock.minutes);
    await k.table('narrate',{call_id:'t1-c3',text:'From the left corner beside the rug, you see the desk across the room.'});
    const saved=locations(k),restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());await restarted.table('open');
    assert.deepEqual(locations(restarted),saved);
    const history=await restarted.ok('mods.locations.inspect',{campaign:CAMPAIGN,need:'observation',name:'here'});
    assert.equal(history.observation.last_observation.from.spot,'left corner beside the rug');
    assert.equal(history.observation.last_observation.from.relation,'standing');
    assert.equal((await inspect(restarted)).place.features.length,0);
});

test('a known barrier still refuses atomically while other position shapes are repaired and reported (§250)',async t=>{
    const k=await kernel(t);await openTurn(k,'I approach a corner but do not cross the closed door.');
    await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'establish',additions:[hotel('Inn'),hotel('Garden'),{name:'Inn',features:[{name:'Door',description:'A closed oak door.',state:'locked',passable:false}]}]}]});
    await k.table('apply',{call_id:'t1-c2',effects:[{kind:'place',action:'move',to:'Inn',via:'Across the road',travel_band:'adjacent',spot:'front corner'}]});
    const before=state(k);
    const blocked=await k.tableErr('apply',{call_id:'t1-c3',effects:[{kind:'place',action:'move',to:'Garden',via:'Through the closed door',travel_band:'adjacent',spot:'garden corner',through:{place:'Inn',feature:'Door'}}]});
    assert.equal(blocked.details.reason,'place_barrier');assert.deepEqual(state(k),before);
    await k.table('apply',{call_id:'t1-c3',effects:[{kind:'place',action:'move',to:'here',at:'Door',spot:'front corner'}]});
    assert.equal(locations(k).position.at,'Door');assert.equal(locations(k).position.spot,undefined,'a registered feature wins over a spot');
    await k.table('apply',{call_id:'t1-c4',effects:[{kind:'place',action:'move',to:'here',at:'unregistered fixture'}]});
    assert.equal(locations(k).position.spot,'unregistered fixture');
    await k.table('apply',{call_id:'t1-c5',effects:[{kind:'place',action:'feature',to:'here',at:'Shutter',state:'open'}]});
    const shutter=locations(k).features.find((feature:Row)=>feature.name==='Shutter');assert.equal(shutter.state,'open');
    const receipts=(await k.table('status',{projection:'receipts'})).receipts;
    assert(receipts.find((row:Row)=>row.call_id==='t1-c3'&&row.kind==='place').adjusted.some((row:Row)=>row.reason==='spot_dropped_for_feature'));
    assert(receipts.find((row:Row)=>row.call_id==='t1-c4'&&row.kind==='place').adjusted.some((row:Row)=>row.reason==='unregistered_feature_as_spot'));
    assert(receipts.find((row:Row)=>row.call_id==='t1-c5'&&row.kind==='place').adjusted.some((row:Row)=>row.reason==='implicit_feature'));
});
