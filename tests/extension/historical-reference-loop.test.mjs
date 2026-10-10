/** Native-search grants cross the real hybrid projection seam; this fixture is not live play. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';
import {HISTORY_NEED,HISTORY_INTERRUPTION} from '../../runtime/historical-reference.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';
async function projected({enabled=true,needed=true,urgent=false,provider='openai-codex'}={}){
 const handlers=new Map(),bus=new Map(),policies=[],rows=[];
 const pi={events:{on:(name,fn)=>bus.set(name,fn),emit:(name,value)=>{if(name==='coc:native-search-policy')policies.push(value);bus.get(name)?.(value);}},
  on:(name,fn)=>handlers.set(name,fn),registerTool:()=>{},getActiveTools:()=>['look','lookup','recall','apply','narrate','ask'],setActiveTools:()=>{}};
 const engine=createHybridEngine({env:{TYPESAFE_API_KEY:'test-jev'},npcAct:null,record:r=>rows.push(r),decision:{decide:async batch=>({status:'complete',
  answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key===HISTORY_NEED?(needed?.95:.05):q.key===HISTORY_INTERRUPTION?(urgent?.95:.05):.05}]))})}});
 engine.extension(pi);await handlers.get('session_start')?.({}, {model:{provider,id:'model',api:'openai-codex-responses'}});
 pi.events.emit('coc:kernel-bridge',{campaign:'c',call:async method=>method==='table.capsule'
  ?{where:{scene:'archive',display_name:'Archive'},historical_setting:{era:'1920s'},mods:{active:enabled?[{id:'historical-reference'}]:[]},present:[],known:{},_context:{version:1,campaign:'c',worldline:'main',loop:0,turn:1,source_revision:'a'.repeat(64)}}
  :method==='table.status'?{turn:1,state:'open',receipts:[]}:method==='table.apply.options'?{candidates:[]}:{}});
 const signal=new AbortController().signal;
 const plan=engine.runDriver.prepare({runId:'r',inputRevision:'input',rawInput:'I examine the archive room.',session:{}});
 await plan.ports.read.read({origin:'policy',operation:'read',readOnly:true},{runId:'r',stepId:'read',operationId:'read',origin:'policy',inputRevision:'input',scopeId:'root',signal});
 await plan.ports.decision.decide({runId:'r',stepId:'compile',purpose:'compile',signal,question:{candidates:[],batch:{id:'b',model:JEV_MODEL,family:'single-loop-compile',familyVersion:'1',scope:{owner:'test',audience:'keeper'},readSet:[],state:{player_input:'I examine the archive room.'},questions:[]}}});
 const messages=await plan.ports.projection.project({view:{policyState:{view:{}}},stepId:'compose',step:{kind:'infer',purpose:'compose',reason:'ready'}});
 return {policy:policies.at(-1),note:messages?.find(m=>m.customType==='coc-clerk'),rows};
}
test('the same Keeper inference receives native search scope and retains ordinary game-tool authority',async()=>{
 const {policy,note}=await projected();assert.equal(policy.allowed,true);assert.equal(policy.campaign,'c');assert.equal(policy.run,'r');assert.equal(policy.step,'compose');
 const row=JSON.parse(note.content);assert.deepEqual(row.native_search_scope,{run:'r',step:'compose'});assert.match(row.historical_reference,/ordinary game tools/);
 assert.equal(row.historical_reference_materials,undefined);
});
test('disabled Mod, declined need, urgent action and unsupported provider never grant search',async()=>{
 for(const options of [{enabled:false},{needed:false},{urgent:true},{provider:'unknown'}]){const {policy}=await projected(options);assert.equal(policy.allowed,false,JSON.stringify(options));}
});
