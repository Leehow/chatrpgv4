import test from 'node:test';
import assert from 'node:assert/strict';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {preparationPeople} from '../../runtime/jev/keeper-preparation.ts';

const signal=new AbortController().signal;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const snapshot=()=>({_context:{campaign:'c1',worldline:'main',loop:0,turn:3,world_revision:'world-1',source_revision:'source-1'},
  where:{scene:'cafe'},present:[{name:'Vera',id:'vera',ref:'npc_1'}],voices:[],
  npc_references:{people:[{ref:'npc_1',display_name:'Vera'},{ref:'npc_2',display_name:'Doctor Bob'},
    {ref:'npc_3',display_name:'Unused person'}]}});

function fixture({input='I ask Vera where to find Doctor Bob.',read,decision,serial=false,bandPrerequisite=false}={}){
  const listeners=new Map(),rows=[],reads=[];let capsule=snapshot();
  const engine=createHybridEngine({env:{PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_PACKET_PRESCREEN:'1'},
    decision:decision??null,record:row=>rows.push(row)});
  const host={on(){},events:{on(name,fn){const list=listeners.get(name)??[];list.push(fn);listeners.set(name,list);},
    emit(name,value){for(const fn of listeners.get(name)??[])fn(value);}}};
  engine.extension(host);
  const invoke=async(method,args)=>{
    if(method==='table.capsule')return structuredClone(capsule);
    if(method==='table.apply.options')return{candidates:[{effect:{kind:'move',to:'library'},description:{display_name:'Library',travel_minutes:10,unlock_when:{met:true}}},
      ...(bandPrerequisite?[{effect:{kind:'move',to:'annex'},description:{display_name:'Annex',unlock_when:{met:true}}}]:[])]};
    if(method==='fixture.bands')return[{handle:'local_travel',min:5,max:30,default:20}];
    if(method==='table.look'){
      reads.push(args.name);if(read)await read(args);
      return{name:args.name==='vera'?'Vera':args.name==='npc_2'?'Doctor Bob':args.name,
        id:args.name,summary:'PRIVATE_CARD_'+args.name,knowledge:['KNOWN_'+args.name]};
    }
    return{};
  };
  let tail=Promise.resolve();
  const call=(method,args)=>{
    if(!serial)return invoke(method,args);
    const result=tail.then(()=>invoke(method,args));tail=result.catch(()=>{});return result;
  };
  host.events.emit('coc:kernel-bridge',{campaign:'c1',call,timeBands:()=>call('fixture.bands',{})});
  host.events.emit('coc:operation-dispatcher',{dispatch:async()=>{throw Error('No writes in preparation test');}});
  const prepare=run=>engine.runDriver.prepare({runId:run,inputRevision:run,rawInput:input,session:{}});
  const prepared=prepare('first');
  const project=async(port=prepared)=>{
    const messages=await port.ports.projection.project({stepId:'test',signal});
    return messages.filter(row=>row.customType==='coc-clerk').map(row=>JSON.parse(row.content)).at(-1);
  };
  return{prepared,project,rows,reads,prepare,get capsule(){return capsule;},set capsule(value){capsule=value;}};
}

test('the first Keeper context includes an explicitly named offstage person by issued identity',async()=>{
  const f=fixture(),context=await f.project();
  assert.ok(context.people.some(person=>person.summary==='PRIVATE_CARD_npc_2'));
  assert.deepEqual(f.reads.sort(),['npc_2','vera']);
  assert.equal(context.people.some(person=>person.summary==='PRIVATE_CARD_npc_3'),false);
});

test('unchanged same-input projections reuse preparation; a write or new input reads fresh',async()=>{
  const f=fixture();await f.project();await f.project();assert.equal(f.reads.length,2);
  f.capsule._context.world_revision='world-2';await f.project();assert.equal(f.reads.length,4);
  await f.project(f.prepare('second'));assert.equal(f.reads.length,6);
});

test('preparation starts before and overlaps existing judgment, then joins before inference',async()=>{
  const readGate=deferred(),decisionGate=deferred(),decisions=[];
  const f=fixture({input:'I go to Library, then ask Vera about Doctor Bob.',read:()=>readGate.promise,
    decision:{decide:async batch=>{decisions.push(batch);await decisionGate.promise;return{batchId:batch.id,status:'unavailable',answers:{},coverage:{},issues:[]};}}});
  await f.prepared.ports.operations.execute({operation:'continuous_prepare'},{signal,stepId:'prepare'});
  assert.deepEqual(f.reads.sort(),['npc_2','vera'],'independent reads must already be in flight');
  const deciding=f.prepared.ports.decision.decide({signal});
  await Promise.resolve();assert.equal(decisions.length,1);
  let projected=false;const projecting=f.project().then(value=>{projected=true;return value;});
  decisionGate.resolve();await deciding;assert.equal(projected,false);
  readGate.resolve();await projecting;assert.equal(f.reads.length,2);
});

for(const bands of [false,true])test('serial native RPC prioritizes judgment prerequisites, bands='+bands,async()=>{
  const gate=deferred(),decisions=[];
  const f=fixture({serial:true,bandPrerequisite:bands,input:'I go to Library, then ask Vera about Doctor Bob.',read:()=>gate.promise,
    decision:{decide:async batch=>{decisions.push(batch);return{batchId:batch.id,status:'unavailable',answers:{},coverage:{},issues:[]};}}});
  const preparing=f.prepared.ports.operations.execute({operation:'continuous_prepare'},{signal,stepId:'prepare'});
  const deciding=preparing.then(()=>f.prepared.ports.decision.decide({signal}));
  try{await new Promise(done=>setImmediate(done));assert.equal(decisions.length,1,'judgment must start while the optional RPC card is still blocked');}
  finally{gate.resolve();await deciding;}
});

test('ambiguous offstage names are not guessed and quoted names grant no presence',async()=>{
  const f=fixture({input:'I discuss Doctor Bob, but do not travel.'});
  f.capsule.npc_references.people.push({ref:'npc_4',display_name:'Doctor Bob'});
  await f.project();assert.deepEqual(f.reads,['vera']);
  assert.deepEqual(f.capsule.present.map(person=>person.ref),['npc_1']);
});

test('a failed optional named read is explicit and cannot substitute another person',async()=>{
  const f=fixture({read:args=>{if(args.name==='npc_2')throw Error('unavailable');}});
  const context=await f.project();
  assert.ok(context.people.some(person=>person.ref==='npc_2'&&person.coverage));
  assert.equal(f.reads.includes('Doctor Bob'),false);
});

test('missing canonical revision disables reuse',async()=>{
  const f=fixture();delete f.capsule._context.world_revision;await f.project();await f.project();
  assert.equal(f.reads.length,4);
});

test('exact reference tokens do not select reference prefixes and named supplements are bounded',()=>{
  const capsule=snapshot();capsule.npc_references.people.push({ref:'npc_20',display_name:'Other doctor'});
  assert.deepEqual(preparationPeople(capsule,'I discuss npc_20.').people.map(person=>person.ref),['npc_1','npc_20']);
  capsule.npc_references.people=Array.from({length:20},(_,index)=>({ref:'npc_'+(index+2),display_name:'Person '+index}));
  const selection=preparationPeople(capsule,capsule.npc_references.people.map(person=>person.ref).join(', '));
  assert.equal(selection.named,8);assert.equal(selection.omitted,12);assert.equal(selection.people.length,9);
});

test('an older in-flight preparation cannot replace a newer revision',async()=>{
  const old=deferred();let calls=0;
  const f=fixture({read:()=>{calls++;if(calls<=2)return old.promise;}});
  const earlier=f.project();await Promise.resolve();
  f.capsule._context.world_revision='world-new';await f.project();
  old.resolve();await earlier;await f.project();assert.equal(f.reads.length,4);
});

test('a superseded run cannot publish completed prefetched cards',async()=>{
  const gate=deferred(),f=fixture({read:()=>gate.promise});
  const earlier=f.project();await Promise.resolve();f.prepare('new-run');gate.resolve();
  await assert.rejects(earlier,/keeper_preparation_cancelled/);
});
