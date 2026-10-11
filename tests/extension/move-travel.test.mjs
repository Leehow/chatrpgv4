/**
 * Contract §218.3: a move carries its road's time. Live d6c (campaign game-dcad7727-...): the table's own lodging was minted
 * at t27 with a 20-minute walk and reached at t45/t46 in 30 and 40 minutes, yet every later retrace to or from it (t48, t56,
 * t57) and the Keeper's improvised walk on the road t46 had walked in 40 (t50) landed 0 minutes, because `stageMove` fell back
 * to 0 when no book edge carried minutes; the book road previous-tenants/corbitt-house-ground, left untimed at build (Jev .43),
 * did the same at t40. Here, over the TS kernel: a road walked with minutes keeps them both ways, a road row names them, an
 * untimed journey says so, and the clerk's move along an untimed way asks its road row.
 */
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
const root=resolve(import.meta.dirname,'../..');
let api,bundle;
before(async()=>{
    await mkdir(join(root,'.tmp'),{recursive:true});bundle=await mkdtemp(join(root,'.tmp/move-travel-'));
    await build({stdin:{contents:[
        "export {buildCandidates,kernelCall} from './runtime/jev/candidates.ts';",
        "export {bindBatch,initialView,interpretBind} from './runtime/jev/step-policy.ts';",
        "export {createKernelContext} from './kernel-ts/context.ts';",
        "export {createKernelRuntime} from './kernel-ts/registry.ts';",
        "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
        "export {CampaignWriter} from './kernel-ts/write/store.ts';",
        "export {COC_TOOLS} from './extensions/kernel/tools.ts';",
        "export {ROUTE_TRAVEL_ROWS,TRAVEL_ADJACENT} from './kernel-ts/modules/route-travel.ts';",
    ].join('\n'),resolveDir:root,sourcefile:'move-travel-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
    api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{if(bundle)await rm(bundle,{recursive:true,force:true});});

async function table(name,t){
    const home=playtestScratch(name),kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:name,locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(kernel);
    t.after(()=>runtime.close());
    const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
    await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');
    return {call,campaign:new api.CampaignWriter(kernel,'c1')};
}
const lastMove=async call=>(await call('table.status')).receipts.filter(r=>r.kind==='move').at(-1);
const LODGING={kind:'move',to:'rooming-house',establish:{summary:'A cheap rooming house a short walk from the commission office.'},via:'Walking down the hill to the rooming house.'};

test('§218.3 a road walked with minutes is walked back with them, and an improvised walk on it takes them too',async t=>{
    const {call,campaign}=await table('move-travel-kept',t);
    const start=(await campaign.readWorld()).active_scene;
    await call('table.player_input',{text:'I walk to my rooming house.'});
    await call('table.apply',{call_id:'t1-c1',effects:[{...LODGING,travel_minutes:20}]});
    assert.equal((await lastMove(call)).minutes,20);
    assert.equal((await lastMove(call)).travel,undefined,'given minutes need no provenance');
    // The base landed this retrace with 0: the minted place has no book road.
    await call('table.apply',{call_id:'t1-c2',effects:[{kind:'move',to:start}]});
    const back=await lastMove(call);
    assert.equal(back.minutes,20,'the road keeps its length both ways');assert.deepEqual(back.travel,{basis:'travelled',turn:1});
    const before=(await campaign.readWorld()).clock.minutes;
    await call('table.apply',{call_id:'t1-c3',effects:[{kind:'move',to:'rooming-house',via:'Down the hill again.'}]});
    const again=await lastMove(call);
    assert.equal(again.minutes,20);assert.equal(again.travel.basis,'travelled');
    assert.equal((await campaign.readWorld()).clock.minutes-before,20,'the clock moved by the road');
    // The way back is shown with the minutes the table knows (§218.3's move rows).
    const row=(await call('table.apply.options')).candidates.find(entry=>entry.effect?.kind==='move'&&entry.effect.to===start);
    assert.equal(row?.description?.travel_minutes,20);
});

test('§218.3 travel_band names a road row: its usual minutes, kept as the road; conflicts and unknown rows are refused',async t=>{
    const {call}=await table('move-travel-band',t);
    await call('table.player_input',{text:'I take the tram to my rooming house.'});
    await assert.rejects(call('table.apply',{call_id:'t1-c1',effects:[{...LODGING,travel_band:'local_travel',travel_minutes:12}]}),error=>error.details?.reason==='travel_conflict');
    await assert.rejects(call('table.apply',{call_id:'t1-c2',effects:[{...LODGING,travel_band:'a_long_way'}]}),
        error=>error.details?.reason==='travel_band_unknown'&&error.details.options.includes('local_travel')&&error.details.options.includes('adjacent'));
    await call('table.apply',{call_id:'t1-c3',effects:[{...LODGING,travel_band:'local_travel'}]});
    const landed=await lastMove(call);
    assert.equal(landed.minutes,30,'local_travel\'s default');assert.deepEqual(landed.travel,{basis:'banded',band:'local_travel'});
    await call('table.apply',{call_id:'t1-c4',effects:[{kind:'move',to:'commission-briefing'}]});
    assert.equal((await lastMove(call)).minutes,30,'the banded road is kept');
});

test('§218.3 a journey no road has timed lands 0 and says so',async t=>{
    const {call}=await table('move-travel-unknown',t);
    await call('table.player_input',{text:'I walk to my rooming house.'});
    const result=await call('table.apply',{call_id:'t1-c1',effects:[LODGING]});
    const landed=await lastMove(call);
    assert.equal(landed.minutes,0);assert.deepEqual(landed.travel,{basis:'unknown'});
    assert.match(result.travel_note,/did not move/);assert.match(result.travel_note,/travel_minutes or travel_band/);
});

test('§218.3 the tool schema carries travel_band; its values are the road rows',()=>{
    const apply=api.COC_TOOLS.find(tool=>tool.name==='apply');
    const text=JSON.stringify(apply.parameters);
    assert.ok(text.includes('travel_band'));
    for(const value of [api.TRAVEL_ADJACENT,...api.ROUTE_TRAVEL_ROWS])assert.ok(text.includes(`"${value}"`),value);
});

// The clerk's move along a way no road has timed (t40/t56/t57): the row carries no minutes, so the move asks its road row.
const reads={capsule:{where:{display_name:'Hall of Records',summary:'The county records office.'}},
    applyOptions:{candidates:[{effect:{kind:'move',to:'rooming-house'},description:{kind:'move',to:'rooming-house',display_name:'Rooming house',material:'A cheap rooming house.'}},
        {effect:{kind:'move',to:'newspaper-morgue'},description:{kind:'move',to:'newspaper-morgue',display_name:'Globe morgue',travel_minutes:30}},
        {effect:{kind:'move',to:'attic'},description:{kind:'move',to:'attic',display_name:'Attic',within:'corbitt-house'}}]},
    resolveOptions:{},bands:{time:[{handle:'brief_activity',min:2,max:10},{handle:'local_travel',min:10,max:120,default:30},{handle:'long_travel',min:120,max:720,default:360}],gates:{time:0.5}}};
const scope={owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'};
const context={scene:'hall-of-records',clock:null,present:[],receipts:[]};
function bindMove(candidate,choice,top=0.8){
    const view=api.initialView({runId:'travel-band',rawInput:'I take the tram home.',context,candidates:[candidate],compile:false,readFirst:false});
    const batch=api.bindBatch(view,candidate,scope,[]),question=batch.questions.find(q=>q.key==='travel_band');
    const keys=Object.keys(question.criteria),probabilities=Object.fromEntries(keys.map(key=>[key,key===choice?top:(1-top)/(keys.length-1)]));
    const result={status:'complete',answers:{travel_band:{status:'answered',type:'choice',choice,confidence:top,probabilities}}};
    return {batch,question,...api.interpretBind(candidate,batch,result,0.6)};
}
test('§218.3 the clerk\'s move along an untimed way asks its road row and carries it; unknown leaves it out and the move still runs',()=>{
    const candidates=api.buildCandidates(reads,'I take the tram home.'),move=key=>candidates.find(c=>c.key===`apply:move:${key}`);
    assert.equal(move('newspaper-morgue').unbound.some(u=>u.name==='travel_band'),false,'a timed road asks nothing');
    assert.equal(move('attic').unbound.some(u=>u.name==='travel_band'),false,'a move within a place asks nothing');
    const home=move('rooming-house'),parameter=home.unbound.find(u=>u.name==='travel_band');
    assert.deepEqual(parameter.options,['adjacent','local_travel','long_travel']);
    assert.deepEqual(home.detail.road,{from:{name:'Hall of Records',summary:'The county records office.'},to:{name:'Rooming house',summary:'A cheap rooming house.'}});
    const bound=bindMove(home,'local_travel');
    assert.match(bound.question.instructions,/Judge where the two places are/);
    assert.deepEqual(bound.pending.map(p=>[p.kind,p.purpose]),[['direct','execute']]);
    assert.deepEqual(api.kernelCall(home,bound.extra).params.effects[0],{kind:'move',to:'rooming-house',travel_band:'local_travel'});
    const low=bindMove(home,'local_travel',0.4);
    assert.equal(api.kernelCall(home,low.extra).params.effects[0].travel_band,'local_travel','Jev\'s lead below the gate is nearer the truth than 0');
    const unknown=bindMove(home,'unknown',0.9);
    assert.deepEqual(unknown.pending.map(p=>[p.kind,p.purpose]),[['direct','execute']],'the move still lands');
    assert.deepEqual(api.kernelCall(home,unknown.extra).params.effects[0],{kind:'move',to:'rooming-house'});
    const unavailable=api.interpretBind(home,bound.batch,undefined,0.6);
    assert.deepEqual(unavailable.pending.map(p=>[p.kind,p.purpose]),[['direct','execute']]);
});
