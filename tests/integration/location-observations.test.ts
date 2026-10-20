/** Real RPC continuity checks; controlled fixtures are not live-play acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,RpcClient,CAMPAIGN,type Row} from './support.ts';
const world=(k:RpcClient)=>JSON.parse(readFileSync(join(campaignDir(k.workspace),'world.json'),'utf8'));
const locations=(k:RpcClient)=>world(k).mods.state['enhanced-locations'].locations;
const inspect=(k:RpcClient,extra:Row={})=>k.ok('mods.locations.inspect',{campaign:CAMPAIGN,need:'observation',name:'Street',at:'front steps',sense:'sight',...extra});
const additions=[{name:'Street',description:'The street outside a modest inn.',features:[{name:'front steps',description:'The pavement at the inn entrance.'},{name:'far corner',description:'A separate corner beyond a delivery cart.'}]},
    {name:'Inn room',description:'An upstairs room with a view of the entrance.',features:[{name:'window',description:'A clear glass casement.',state:'closed',passable:false}]}];
const relation={from:{place:'Inn room',at:'window'},to:{place:'Street',at:'front steps'},sense:'sight',description:'The casement overlooks the inn entrance through clear glass.'};
const initial={kind:'place',action:'observe',to:'Street',at:'front steps',sense:'sight',access:'clear',scope:'Only the pavement at the entrance.',
    facts:['The man in a cap and the man in a coat are arguing beside the steps.'],people:['Man in cap','Man in coat'],
    situations:[{name:'Dispute at the steps',summary:'The two men are exchanging accusations.',status:'ongoing',participants:['Man in cap','Man in coat']}]};
async function street(k:RpcClient){
    await openTurn(k,'I stop at the inn entrance and watch the two men.');
    await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'Street',at:'front steps',relation:'beside',via:'Along the street',travel_band:'adjacent',additions},
        {kind:'npc',name:'Man in cap',to:'here',walk_on:true,_new_person:true,why:'A passerby at the entrance.'},
        {kind:'npc',name:'Man in coat',to:'here',walk_on:true,_new_person:true,why:'Another passerby at the entrance.'}]});
}
async function room(k:RpcClient,call='t2-c1'){
    await k.table('apply',{call_id:call,effects:[{kind:'place',action:'move',to:'Inn room',at:'window',relation:'beside',via:'Through the inn and upstairs',travel_band:'adjacent'}]});
}

test('the same incident survives viewpoint changes, real NPC departure, delivery and restart',async t=>{
    const k=await kernel(t);await street(k);
    const first=await k.table('apply',{call_id:'t1-c2',effects:[initial]});
    const refs=first.outcomes[0].observation.people.map((person:Row)=>person.ref);
    assert.equal(refs.length,2);assert(refs.every((ref:string)=>ref.startsWith('npc_')));
    const incident=locations(k).situations[0].id,atFirst=world(k).clock.minutes;
    assert.equal((await inspect(k)).observation.last_observation,undefined,'settlement alone is not player knowledge');
    assert.equal((await inspect(k)).observation.latest_settled.publication,'undelivered');
    await k.table('narrate',{call_id:'t1-c3',text:'The two men trade accusations beside the entrance.'});
    await k.table('player_input',{text:'I go upstairs and watch the entrance through the closed window.'});
    await room(k);
    const before=world(k);
    const missing=await k.tableErr('apply',{call_id:'t2-c2',effects:[initial]});
    assert.equal(missing.code,'invalid_params');assert.equal(missing.details.reason,'place_observation_relation_required');assert.deepEqual(world(k),before);
    const view=(await inspect(k)).observation;
    assert.deepEqual(view.from,{place:'Inn room',at:'window'});assert.equal(view.last_observation.observed_clock.minutes,atFirst);
    assert.equal(view.people.length,2);assert.equal(view.relations.length,0);
    assert.deepEqual(world(k),before,'preparation reads cannot observe, advance or alter the world');
    const observed={...initial,relations:[relation],people:['Man in cap'],facts:['Only the man in the cap remains beside the steps.'],
        situations:[{name:'Dispute at the steps',summary:'One participant remains; the other is no longer in view.',status:'unknown'}]};
    const result=await k.table('apply',{call_id:'t2-c3',effects:[{kind:'time',minutes:3,why:'The selected walk and observation take a few minutes.'},
        {kind:'npc',name:'Man in coat',to:'away',why:'He leaves the street during the interval.'},observed]});
    const observation=result.outcomes.find((outcome:Row)=>outcome.action==='observe').observation;
    assert.equal(observation.people[0].ref,refs[0]);assert.equal(observation.observed_clock.minutes,world(k).clock.minutes);
    assert.equal(locations(k).situations[0].id,incident);assert.equal(locations(k).situations[0].participants.length,2);
    assert.equal(locations(k).situations[0].assessed_clock.minutes,world(k).clock.minutes);
    const capsule=await k.table('capsule');assert.equal(capsule.present.length,0);assert.equal(capsule.where.scene,'Inn room');
    assert.equal(capsule.where.location.features[0].state,'closed');assert.equal(capsule.where.location.features[0].passable,false);
    assert.equal(capsule.where.location.observation_routes[0].to.place,'Street');
    const pending=(await inspect(k)).observation;
    assert.equal(pending.last_observation.observed_clock.minutes,atFirst);assert.equal(pending.latest_settled.publication,'undelivered');
    assert(pending.last_observation.elapsed_minutes>=3);assert.equal(pending.situations[0].elapsed_minutes,0);
    assert.equal((await inspect(k,{at:'far corner'})).observation.last_observation,undefined,'one observed corner is not the entire street');
    await k.table('narrate',{call_id:'t2-c4',text:'Through the closed glass you see the same man in the cap. His companion is no longer in view.'});
    const saved=world(k);await k.close();
    const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());await restarted.table('open');
    assert.deepEqual(locations(restarted),saved.mods.state['enhanced-locations'].locations);
    const after=(await inspect(restarted)).observation;
    assert.equal(after.last_observation.observed_clock.minutes,saved.clock.minutes);assert.equal(after.latest_settled.publication,'delivered');
    assert.equal(after.people[0].ref,refs[0]);assert.equal(after.situations[0].participants.length,2);
});

test('senses and direction are separate, and blocked attempts do not overwrite last seen',async t=>{
    const k=await kernel(t);await street(k);await k.table('apply',{call_id:'t1-c2',effects:[initial]});
    await k.table('narrate',{call_id:'t1-c3',text:'Two men argue beside the entrance.'});
    await k.table('player_input',{text:'I watch through the upstairs window without opening it.'});await room(k);
    await k.table('apply',{call_id:'t2-c2',effects:[{kind:'place',action:'relate',relations:[relation]}]});
    const start=world(k),hearing=await k.tableErr('apply',{call_id:'t2-c3',effects:[{...initial,sense:'hearing'}]});
    assert.equal(hearing.details.reason,'place_observation_relation_required');assert.deepEqual(world(k),start);
    const seen=await k.table('apply',{call_id:'t2-c3',effects:[{...initial,situations:undefined}]});
    assert.equal(seen.outcomes[0].observation.access,'clear','closed glass can transmit sight without passage');
    await k.table('apply',{call_id:'t2-c4',effects:[{...initial,sense:'hearing',access:'limited',facts:['Raised voices are audible, but individual words are unclear.'],situations:undefined,
        relations:[{...relation,sense:'hearing',description:'Raised voices can carry faintly through the casement.'}]}]});
    assert.equal((await inspect(k,{sense:'hearing'})).observation.latest_settled.access,'limited');
    assert.equal(locations(k).observations.length,2,'sight and hearing have independent latest records');
    await k.table('narrate',{call_id:'t2-c5',text:'You can see the men, although the glass muffles their words.'});
    await k.table('player_input',{text:'I try to see the entrance after the curtain is drawn.'});
    const clock=world(k).clock.minutes;
    const invalid=await k.tableErr('apply',{call_id:'t3-c1',effects:[{...initial,access:'blocked',reason:'The curtain covers the window.'}]});
    assert.equal(invalid.details.reason,'place_observation_blocked_shape');
    await k.table('apply',{call_id:'t3-c1',effects:[{kind:'place',action:'feature',to:'Inn room',at:'window',state:'curtain drawn'},
        {...initial,access:'blocked',reason:'The curtain covers the window.',facts:[],people:[],situations:[]}]});
    await k.table('narrate',{call_id:'t3-c2',text:'The curtain blocks the view of the entrance.'});
    const blocked=(await inspect(k)).observation;
    assert.equal(blocked.last_observation.delivered_turn,2);assert.equal(blocked.latest_settled.access,'blocked');
    assert.equal(world(k).clock.minutes,clock);assert.equal(locations(k).situations[0].status,'ongoing');
    const target={name:'Inn room',at:'window'};
    await k.table('player_input',{text:'I return to the street and look toward the room.'});
    await k.table('apply',{call_id:'t4-c1',effects:[{kind:'place',action:'move',to:'Street',at:'front steps',relation:'beside'}]});
    assert.equal((await inspect(k,target)).observation.relations.length,0,'a directed window view is not automatically reversible');
});

test('observation writes are atomic, replayable and additive to old schema-1 locations',async t=>{
    const k=await kernel(t);await street(k);
    const identity=locations(k).places[0].id;
    assert.equal(locations(k).schema,1);assert.equal(locations(k).observations,undefined);
    const before=world(k),packet={call_id:'t1-c2',effects:[initial,{kind:'time',minutes:-1}]};
    assert.equal((await k.tableErr('apply',packet)).code,'invalid_params');assert.deepEqual(world(k),before);
    const missing=await k.tableErr('apply',{call_id:'t1-c2',effects:[{...initial,to:'Another street',at:undefined}]});
    assert.equal(missing.code,'invalid_params');assert.equal(missing.details.reason,'place_observation_point_unresolved');assert.deepEqual(world(k),before);
    const unknown=await k.tableErr('apply',{call_id:'t1-c2',effects:[{...initial,people:['An unregistered stranger']}]});
    assert.equal(unknown.code,'invalid_params');assert.equal(unknown.details.reason,'place_observation_person_unresolved');assert.deepEqual(world(k),before);
    const valid={...packet,effects:[initial]};await k.table('apply',valid);
    const saved=world(k);assert.equal((await k.table('apply',valid)).replayed,true);assert.deepEqual(world(k),saved);
    assert.equal(locations(k).observations.length,1);assert.equal(locations(k).situations.length,1);assert.equal(locations(k).places[0].id,identity);
    const elsewhere={...initial,people:['Man in cap','Steven Knott'],situations:[]};
    assert.equal((await k.tableErr('apply',{call_id:'t1-c3',effects:[elsewhere]})).details.reason,'place_observation_presence');
    assert.deepEqual(world(k),saved,'observation cannot teleport an existing person');
    await k.table('narrate',{call_id:'t1-c3',text:'The men remain beside the steps.'});
    await k.ok('mods.configure',{campaign:CAMPAIGN,id:'enhanced-locations',enabled:false});
    assert.equal((await inspect(k)).enabled,false);assert.equal((await inspect(k)).observation.last_observation.access,'clear');
    await k.table('player_input',{text:'I watch the same corner again.'});
    assert.equal((await k.tableErr('apply',{call_id:'t2-c1',effects:[initial]})).details.reason,'location_mod_inactive');
    assert.equal(locations(k).places[0].id,identity);
});

test('an ordinary view derives the actual counter position without registering its doorway as a viewpoint',async t=>{
    const k=await kernel(t);await street(k);
    await k.table('narrate',{call_id:'t1-c2',text:'The entrance is visible from the inn.'});
    await k.table('player_input',{text:'I stay at the counter and look outside through the doorway.'});
    await k.table('apply',{call_id:'t2-c1',effects:[{kind:'place',action:'move',to:'Inn room',at:'counter',relation:'beside',via:'Inside the inn',travel_band:'adjacent',
        additions:[{name:'Inn room',features:[{name:'counter',description:'A counter opposite the entrance.'}]}]}]});
    const before=world(k),wrong={...relation,from:{place:'Inn room',at:'doorway'}};
    const rejected=await k.tableErr('apply',{call_id:'t2-c2',effects:[{...initial,relations:[wrong]}]});
    assert.equal(rejected.details.reason,'place_observation_point_unresolved');assert.equal(rejected.details.field,'relations[0].from');
    assert.deepEqual(rejected.details.current_viewpoint,{place:'Inn room',at:'counter'});
    assert.match(rejected.fix,/features/);assert.match(rejected.fix,/not as a child place/);assert.match(rejected.fix,/use view/);
    assert.deepEqual(world(k),before);
    const child=await k.tableErr('apply',{call_id:'t2-c2',effects:[{...initial,relations:[wrong],additions:[{name:'doorway',within:'Inn room',description:'The open doorway.'}]}]});
    assert.equal(child.details.reason,'place_observation_point_unresolved');assert.deepEqual(world(k),before);
    const description='From the counter, the open doorway shows the pavement at the entrance.';
    const result=await k.table('apply',{call_id:'t2-c2',effects:[{...initial,view:description}]});
    assert.deepEqual(result.outcomes[0].observation.from,{place:'Inn room',at:'counter'});
    assert.deepEqual(locations(k).position,before.mods.state['enhanced-locations'].locations.position);
    assert.equal(locations(k).relations.length,1);assert.equal(locations(k).relations[0].description,description);
    assert.equal(locations(k).features.some((feature:Row)=>feature.name==='doorway'),false);
    assert.equal(locations(k).places.some((place:Row)=>place.name.endsWith('doorway')),false);
    await k.table('apply',{call_id:'t2-c3',effects:[{...initial,view:'The same view through the entrance from beside the counter.'}]});
    assert.equal(locations(k).relations.length,1);assert.equal(locations(k).relations[0].description,description,'a new wording reuses established layout');
});
