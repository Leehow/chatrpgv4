/** Real RPC continuity checks; controlled fixtures are not live-play acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,RpcClient,CAMPAIGN,type Row} from './support.ts';
import {compileTurnPacket,turnPacket} from '../../runtime/turn-packet-prototype.ts';
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

for(const [label,facts] of [
    ['eight short facts',['A narrow table stands by the wall.','A tray rests on it.','Letters lie beside the tray.','Hooks line the wall.',
        'Two coats hang on the hooks.','An umbrella stand is beside them.','A mirror hangs above the table.','A doorway leads onward.']],
    ['a complete larger view',Array.from({length:65},(_,i)=>String(i)+' '+String.fromCodePoint(0x1f642).repeat(i===0?16000:700))],
] as const)test(label+' survive canonical write, receipt, delivery, inspection and restart',async t=>{
    const k=await kernel(t);await street(k);const before=world(k).clock.minutes;
    const observed={kind:'place',action:'observe',to:'Street',at:'front steps',sense:'sight',access:'clear',scope:'The visible near wall.',facts:[...facts]};
    const result=await k.table('apply',{call_id:'t1-c2',effects:[{kind:'time',minutes:2,why:'The selected brief inspection.'},observed]});
    assert.deepEqual(result.outcomes[1].observation.facts,facts);
    assert.deepEqual(locations(k).observations[0].facts,facts);
    assert.equal(world(k).clock.minutes,before+2);
    const staged=await inspect(k);
    assert.deepEqual(staged.observation.latest_settled.facts,facts);
    assert.equal(staged.observation.last_observation,undefined,'unpublished facts remain outside player knowledge');
    await k.table('narrate',{call_id:'t1-c3',text:'The near wall and its furnishings are visible.'});
    assert.deepEqual((await inspect(k)).observation.last_observation.facts,facts);
    await k.close();const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());await restarted.table('open');
    assert.deepEqual((await inspect(restarted)).observation.last_observation.facts,facts);
    assert.equal(world(restarted).clock.minutes,before+2,'publication and restart do not charge extra observation time');
});

test('malformed observation facts still refuse atomically (§250)',async t=>{
    const k=await kernel(t);await street(k);const before=world(k);
    for(const facts of [[42],'one fact',[{text:'A table.'}]]){
        const error=await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'time',minutes:2,why:'The selected brief inspection.'},
            {kind:'place',action:'observe',to:'Street',at:'front steps',sense:'sight',access:'clear',scope:'The near wall.',facts}]});
        assert.equal(error.code,'invalid_params');assert.deepEqual(world(k),before);
    }
});

test('the same incident survives viewpoint changes, real NPC departure, delivery and restart',async t=>{
    const k=await kernel(t);await street(k);
    const first=await k.table('apply',{call_id:'t1-c2',effects:[initial]});
    const refs=first.outcomes[0].observation.people.map((person:Row)=>person.ref);
    assert.equal(refs.length,2);assert(refs.every((ref:string)=>ref.startsWith('npc_')));
    const incident=locations(k).situations[0].id,atFirst=world(k).clock.minutes;
    assert.equal((await inspect(k)).observation.last_observation,undefined,'settlement alone is not player knowledge');
    assert.equal((await inspect(k)).observation.latest_settled.publication,'undelivered');
    assert.deepEqual((await inspect(k)).observation.recent_observations,[],'unpublished settlement cannot enter observation history');
    await k.table('narrate',{call_id:'t1-c3',text:'The two men trade accusations beside the entrance.'});
    await k.table('player_input',{text:'I go upstairs and watch the entrance through the closed window.'});
    await room(k);
    const before=world(k);
    const view=(await inspect(k)).observation;
    assert.deepEqual(view.from,{place:'Inn room',at:'window',relation:'beside'});assert.equal(view.last_observation.observed_clock.minutes,atFirst);
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
    assert.equal(pending.recent_observations.length,1,'only the first delivered sighting is player history');
    assert(pending.last_observation.elapsed_minutes>=3);assert.equal(pending.situations[0].elapsed_minutes,0);
    assert.equal((await inspect(k,{at:'far corner'})).observation.last_observation,undefined,'one observed corner is not the entire street');
    await k.table('narrate',{call_id:'t2-c4',text:'Through the closed glass you see the same man in the cap. His companion is no longer in view.'});
    const saved=world(k);await k.close();
    const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());await restarted.table('open');
    assert.deepEqual(locations(restarted),saved.mods.state['enhanced-locations'].locations);
    const after=(await inspect(restarted)).observation;
    assert.equal(after.last_observation.observed_clock.minutes,saved.clock.minutes);assert.equal(after.latest_settled.publication,'delivered');
    assert.equal(after.people[0].ref,refs[0]);assert.equal(after.situations[0].participants.length,2);
    assert.deepEqual(after.recent_observations.map((observation:Row)=>observation.observed_clock.minutes),[saved.clock.minutes,atFirst]);
    assert(after.recent_observations.every((observation:Row)=>observation.people[0].ref===refs[0]),'one canonical identity survives both viewpoints');
    for(let turn=3;turn<=5;turn++){
        await restarted.table('player_input',{text:'I continue watching the same entrance.'});
        await restarted.table('apply',{call_id:`t${turn}-c1`,effects:[{kind:'time',minutes:1,why:'The selected continued watch.'},observed]});
        await restarted.table('narrate',{call_id:`t${turn}-c2`,text:'The same man remains beside the entrance.'});
    }
    const unchanged=world(restarted),history=(await inspect(restarted)).observation.recent_observations;
    assert.equal(history.length,4,'focused history is bounded instead of loading every past turn');
    assert.equal(history[0].observed_clock.minutes,unchanged.clock.minutes);
    assert(history.every((observation:Row)=>observation.people[0].ref===refs[0]));
    assert.deepEqual(world(restarted),unchanged,'reading identity history never observes or advances time');
});

test('senses and direction are separate, and blocked attempts do not overwrite last seen',async t=>{
    const k=await kernel(t);await street(k);await k.table('apply',{call_id:'t1-c2',effects:[initial]});
    await k.table('narrate',{call_id:'t1-c3',text:'Two men argue beside the entrance.'});
    await k.table('player_input',{text:'I watch through the upstairs window without opening it.'});await room(k);
    await k.table('apply',{call_id:'t2-c2',effects:[{kind:'place',action:'relate',relations:[relation]}]});
    const seen=await k.table('apply',{call_id:'t2-c3',effects:[{...initial,situations:undefined}]});
    assert.equal(seen.outcomes[0].observation.access,'clear','closed glass can transmit sight without passage');
    await k.table('apply',{call_id:'t2-c4',effects:[{...initial,sense:'hearing',access:'limited',facts:['Raised voices are audible, but individual words are unclear.'],situations:undefined,
        relations:[{...relation,sense:'hearing',description:'Raised voices can carry faintly through the casement.'}]}]});
    assert.equal((await inspect(k,{sense:'hearing'})).observation.latest_settled.access,'limited');
    assert.equal(locations(k).observations.length,2,'sight and hearing have independent latest records');
    await k.table('narrate',{call_id:'t2-c5',text:'You can see the men, although the glass muffles their words.'});
    await k.table('player_input',{text:'I try to see the entrance after the curtain is drawn.'});
    const clock=world(k).clock.minutes;
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
    const valid={...packet,effects:[initial]};await k.table('apply',valid);
    const saved=world(k);assert.equal((await k.table('apply',valid)).replayed,true);assert.deepEqual(world(k),saved);
    assert.equal(locations(k).observations.length,1);assert.equal(locations(k).situations.length,1);assert.equal(locations(k).places[0].id,identity);
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
    const before=world(k);
    const description='From the counter, the open doorway shows the pavement at the entrance.';
    const result=await k.table('apply',{call_id:'t2-c2',effects:[{...initial,view:description}]});
    assert.deepEqual(result.outcomes[0].observation.from,{place:'Inn room',at:'counter',relation:'beside'});
    assert.deepEqual(locations(k).position,before.mods.state['enhanced-locations'].locations.position);
    assert.equal(locations(k).relations.length,1);assert.equal(locations(k).relations[0].description,description);
    assert.equal(locations(k).features.some((feature:Row)=>feature.name==='doorway'),false);
    assert.equal(locations(k).places.some((place:Row)=>place.name.endsWith('doorway')),false);
    await k.table('apply',{call_id:'t2-c3',effects:[{...initial,view:'The same view through the entrance from beside the counter.'}]});
    assert.equal(locations(k).relations.length,1);assert.equal(locations(k).relations[0].description,description,'a new wording reuses established layout');
});

test('an explicit empty parent is root only; a blank name refuses while blank descriptions and unknown parents are repaired (§250)',async t=>{
    const k=await kernel(t);await openTurn(k,'I look at the ordinary building across the street.');
    const effect={kind:'place',action:'establish',additions:[{name:'Across the street',within:'',description:'An ordinary independent building.'}]};
    await k.table('apply',{call_id:'t1-c1',effects:[effect]});
    const saved=world(k),place=locations(k).places.find((place:Row)=>place.name==='Across the street');assert.equal(place.within,null);
    const error=await k.tableErr('apply',{call_id:'t1-c2',effects:[{...effect,additions:[{...effect.additions[0],name:'',within:''}]}]});
    assert.equal(error.code,'invalid_params');assert.deepEqual(world(k),saved);
    await k.table('apply',{call_id:'t1-c2',effects:[{kind:'place',action:'establish',additions:[{name:'Blank description',within:'',description:''},{name:'Unknown parent',within:'null'},{name:'Whitespace parent',within:' '}]}]});
    const records=locations(k).places;
    for(const name of ['Blank description','Unknown parent','Whitespace parent'])assert.equal(records.find((place:Row)=>place.name===name)?.within,null,name);
    assert.equal(records.find((place:Row)=>place.name==='Blank description').description,'Blank description','a missing description uses the name');
    const receipt=(await k.table('status',{projection:'receipts'})).receipts.find((row:Row)=>row.call_id==='t1-c2'&&row.kind==='place');
    assert.equal(receipt.adjusted.filter((row:Row)=>row.reason==='unregistered_parent_ignored').length,2);
});

test('native remote creation shares NPC and place rollback, then reuses the one created identity',async t=>{
    const k=await kernel(t);await openTurn(k,'I stay here, wait five minutes and watch the vendor outside.');
    const before=world(k),packet={version:4,commands:[{kind:'time',minutes:5,reason:'The player explicitly waits five minutes.'},{kind:'walk_on',slot:'new_1',label:'Street vendor',to:'Outside',reason:'Selling papers outside.'},
        {kind:'place',action:'observe',to:'Outside',sense:'sight',access:'clear',scope:'The entrance pavement.',view:'The open doorway shows the street from here.',facts:['The vendor counts his coins.'],
            additions:[{name:'Outside',within:'',description:'The street outside the current room.'}],people:['new_1']}]};
    const effects=compileTurnPacket(turnPacket(JSON.stringify(packet))).effects;
    const invalid=[...structuredClone(effects),{kind:'time',minutes:-1,why:'An invalid amount.'}];
    assert.equal((await k.tableErr('apply',{call_id:'t1-c1',effects:invalid})).code,'invalid_params');
    assert.deepEqual(world(k),before,'the staged place, person, relation and observation all roll back');
    const result=await k.table('apply',{call_id:'t1-c1',effects});
    const ref=result.outcomes.find((outcome:Row)=>outcome.action==='observe').observation.people[0].ref;
    assert.equal(world(k).clock.minutes,before.clock.minutes+5);
    assert.equal(result.outcomes.find((outcome:Row)=>outcome.action==='observe').observation.observed_clock.minutes,before.clock.minutes+5);
    assert.equal((await k.table('look',{focus:'npc',name:ref})).scene,'Outside');assert.equal(world(k).active_scene,before.active_scene);
    assert.equal((await k.table('capsule')).present.some((person:Row)=>person.ref===ref),false);
    const saved=world(k);assert.equal((await k.table('apply',{call_id:'t1-c1',effects})).replayed,true);assert.deepEqual(world(k),saved);
});

test('a current observation route binds an investigative target without granting local reach',async t=>{
    const k=await kernel(t);await street(k);
    await k.table('narrate',{call_id:'t1-c2',text:'Two men stand at the entrance.'});
    await k.table('player_input',{text:'I watch the men through the upstairs window.'});await room(k);
    const action={actor:'Thomas Hayes',intent:'investigate',decision:'core-check:ordinary-check',skill:'Spot Hidden',
        target:'Man in cap',goal:'See what the man at the entrance is holding.',method:'Watch through the clear window.',stakes:'The detail remains unclear.'};
    const before=world(k);
    assert.equal((await k.tableErr('resolve',{call_id:'t2-c2',action})).code,'unknown_entity');
    assert.deepEqual(world(k),before,'a remote person without a current observation route cannot be targeted');
    await k.table('apply',{call_id:'t2-c2',effects:[{kind:'place',action:'relate',relations:[relation]}]});
    const resolved=await k.table('resolve',{call_id:'t2-c3',action});
    assert(resolved.receipts.length>0);assert.equal(resolved.outcome.skill,'Spot Hidden');
    const after=world(k);assert.equal(after.active_scene,'Inn room');assert.equal(after.npc_presence['Man in cap'],'Street');
    assert.equal((await k.tableErr('resolve',{call_id:'t2-c4',action:{...action,intent:'combat',decision:'combat:attack',skill:'Handgun',weapon:'.38 Revolver'}})).code,'unknown_entity');
    assert.equal((await k.tableErr('resolve',{call_id:'t2-c4',action:{...action,decision:'core-check:combined-check'}})).code,'unknown_entity');
    await k.table('apply',{call_id:'t2-c4',effects:[{kind:'time',minutes:1,why:'A minute of the selected observation passes.'}]});
    const stale=world(k),later=await k.table('resolve',{call_id:'t2-c5',action});assert(later.receipts.length>0);assert.deepEqual(world(k),stale,'a later check does not write a new observation or move anyone');
    await k.table('apply',{call_id:'t2-c6',effects:[initial]});
    await k.table('apply',{call_id:'t2-c7',effects:[{...initial,access:'blocked',reason:'The curtain covers the window.',facts:[],people:[],situations:[]}]});
    assert.equal((await k.tableErr('resolve',{call_id:'t2-c8',action})).code,'unknown_entity');
    await k.table('apply',{call_id:'t2-c8',effects:[initial]});
    await k.table('apply',{call_id:'t2-c9',effects:[{kind:'place',action:'move',to:'here'}]});
    assert.equal((await k.tableErr('resolve',{call_id:'t2-c10',action})).code,'unknown_entity','a different current viewpoint cannot borrow the window percept');
    await k.table('apply',{call_id:'t2-c10',effects:[{kind:'place',action:'move',to:'here',at:'window',relation:'beside'}]});await k.table('apply',{call_id:'t2-c11',effects:[initial]});
    await k.table('apply',{call_id:'t2-c12',effects:[{kind:'npc',name:'Man in cap',to:'away',why:'He leaves during the selected observation.'}]});
    assert.equal((await k.tableErr('resolve',{call_id:'t2-c13',action})).code,'unknown_entity','last-seen identity is not current presence');
});

test('observation shapes are repaired and reported instead of refused (§250)',async t=>{
    const k=await kernel(t);await street(k);
    await k.table('apply',{call_id:'t1-c2',effects:[{...initial,to:'Another street',at:undefined,people:['An unregistered stranger','Man in cap','Steven Knott','Man in cap']}]});
    const receipt=(await k.table('status',{projection:'receipts'})).receipts.find((row:Row)=>row.call_id==='t1-c2'&&row.kind==='place');
    const reasons=receipt.adjusted.map((row:Row)=>row.reason);
    assert(reasons.includes('unregistered_target_as_spot'));assert(reasons.includes('unrecognized_person_dropped'));
    assert.equal(receipt.observation.to.spot,'Another street');assert.equal(receipt.observation.people.length,1,'one present person, named once');
    await k.table('narrate',{call_id:'t1-c3',text:'The man in the cap stands at the steps.'});
    await k.table('player_input',{text:'I go upstairs and watch the entrance, then listen.'});await room(k);
    await k.table('apply',{call_id:'t2-c2',effects:[{...initial,situations:undefined},{...initial,sense:'hearing',access:'blocked',reason:'Glass muffles everything.',facts:['Raised voices carry faintly.'],situations:undefined}]});
    const settled=(await k.table('status',{projection:'receipts'})).receipts.filter((row:Row)=>row.call_id==='t2-c2'&&row.kind==='place');
    assert.equal(locations(k).relations.length,2,'each sense records its sightline from the Keeper scope');
    assert(settled[0].adjusted.some((row:Row)=>row.reason==='relation_from_scope'));
    assert.equal(settled[1].observation.access,'limited');assert(settled[1].adjusted.some((row:Row)=>row.reason==='blocked_with_facts_as_limited'));
    await k.table('apply',{call_id:'t2-c3',effects:[{...initial,situations:undefined,relations:[{...relation,from:{...relation.from,relation:'beside'},description:'Another wording.'}]}]});
    assert.equal(locations(k).relations.length,2);
});
