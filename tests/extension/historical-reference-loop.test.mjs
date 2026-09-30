import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {EXA_ENV,HISTORY_NEED} from '../../runtime/historical-reference.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';

async function table({enabled=true,needed=true,narrator=true}={}) {
  const bus=new Map(),announced=[],batches=[];
  const pi={events:{on:(name,fn)=>bus.set(name,fn),emit:(name,value)=>{if(name==='coc:model-step')announced.push(value);bus.get(name)?.(value);}},
    on:()=>{},registerTool:()=>{},getActiveTools:()=>['look','lookup','recall','apply','resolve','narrate','ask'],setActiveTools:()=>{}};
  const engine=createHybridEngine({env:{[EXA_ENV]:'test-exa-key',TYPESAFE_API_KEY:'test-jev-key',COC_NARRATOR_ONLY:narrator?'on':'off'},
    npcAct:null,decision:{decide:async batch=>{batches.push(batch);return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key===HISTORY_NEED&&needed?0.95:0.01}])),issues:[],coverage:{required:[],answered:[],unknown:[]}};}}});
  engine.extension(pi);
  pi.events.emit('coc:kernel-bridge',{campaign:'c',call:async method=>method==='table.capsule'
    ?{where:{scene:'archive'},mods:{active:enabled?[{id:'historical-reference',version:'1.0.0'}]:[]},present:[],known:{},
      _context:{version:1,campaign:'c',worldline:'main',loop:0,turn:1,source_revision:'a'.repeat(64)}}
    :method==='table.status'?{turn:1,state:'open',receipts:[]}:method==='table.apply.options'?{candidates:[]}:{}});
  const plan=engine.runDriver.prepare({runId:'r',inputRevision:'input',rawInput:'I look around the archive',session:{}});
  const signal=new AbortController().signal;
  await plan.ports.read.read({origin:'policy',operation:'read',readOnly:true},{runId:'r',stepId:'read',operationId:'read-op',origin:'policy',inputRevision:'input',scopeId:'root',signal});
  await plan.ports.decision.decide({runId:'r',stepId:'compile',purpose:'compile',signal,question:{candidates:[],batch:{id:'base',model:JEV_MODEL,
    family:'single-loop-compile',familyVersion:'1',scope:{owner:'test',audience:'keeper'},readSet:[],state:{player_input:'I look around the archive'},questions:[]}}});
  const messages=await plan.ports.projection.project({view:{policyState:{view:{}}},stepId:'compose',step:{kind:'infer',purpose:'compose',reason:'ready'}});
  let serial=0;
  async function call(kind, params={}) {
    const id=`call-${++serial}`;
    await plan.ports.operations.execute({origin:'model',operation:'lookup',params:{kind,query:'archive details',...params},assistantMessage:{serial},toolCall:{id}},
      {runId:'r',stepId:'compose',operationId:id,origin:'model',inputRevision:'input',scopeId:'root',signal,
        executeModelTool:async()=>({isError:!!announced.at(-1)?.refuse,content:[{type:'text',text:announced.at(-1)?.refuse??'result'}]})});
    return announced.at(-1);
  }
  return {batches,note:messages.map(m=>m.content).join(''),call};
}
for(const narrator of [false,true])test(`one existing decision offers history and permits only its lookup subtype (narrator=${narrator})`,async()=>{
  const f=await table({narrator});assert.equal(f.batches.length,1);assert(f.batches[0].questions.some(q=>q.key===HISTORY_NEED));
  assert.match(f.note,/Historical reference is available/);
  const history=await f.call('historical_reference');assert.equal(history.refuse,undefined);assert.equal(history.historical_reference.allowed,true);
  const other=await f.call('module');if(narrator)assert.match(other.refuse,/not in this narrator-only/);
});
test('a declined historical need or disabled Mod does not grant the narrowed read',async()=>{
  for(const options of [{needed:false},{enabled:false}]) {
    const f=await table(options);assert(!f.note.includes('Historical reference is available'));
    assert.match((await f.call('historical_reference')).refuse,/not in this narrator-only/);
  }
});
test('saved reads remain available without a web grant in narrator-only composition',async()=>{
  const f=await table({needed:false});
  for(const reference_mode of ['catalog','read','saved'])
    assert.equal((await f.call('historical_reference',{reference_mode,name:'An issued saved title'})).refuse,undefined);
  assert.match((await f.call('historical_reference',{reference_mode:'web'})).refuse,/not in this narrator-only/);
});
