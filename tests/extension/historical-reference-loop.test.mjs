/** Native search remains an optional capability of the same Keeper inference. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';
async function projected({enabled=true,provider='openai-codex',model}={}){
 const handlers=new Map(),bus=new Map(),policies=[];
 const pi={events:{on:(name,fn)=>bus.set(name,fn),emit:(name,value)=>{if(name==='coc:native-search-policy')policies.push(value);bus.get(name)?.(value);}},on:(name,fn)=>handlers.set(name,fn)};
 const engine=createHybridEngine({env:{},decision:{decide:()=>{throw new Error('No mandatory classifier');}}});
 engine.extension(pi);await handlers.get('session_start')?.({}, {model:model??{provider,id:'model',api:'openai-codex-responses'}});
 pi.events.emit('coc:kernel-bridge',{campaign:'c',call:async()=>({where:{scene:'archive'},mods:{active:enabled?[{id:'historical-reference'}]:[]},present:[],_context:{worldline:'main',loop:0}})});
 const plan=engine.runDriver.prepare({runId:'r',inputRevision:'input',rawInput:'I examine the archive room.',session:{}});
 const messages=await plan.ports.projection.project({stepId:'compose',signal:new AbortController().signal});
 return{policy:policies.at(-1),note:JSON.parse(messages.find(m=>m.customType==='coc-clerk').content)};
}
test('same Keeper receives native search with no separate decision or researcher',async()=>{
 const {policy,note}=await projected();assert.equal(policy.allowed,true);assert.equal(policy.campaign,'c');
 assert.deepEqual(note.native_search_scope,{run:'r',step:'compose'});assert.match(note.historical_reference,/ordinary game tools/);
});
test('disabled Mod and unsupported provider do not grant native search',async()=>{
 for(const options of [{enabled:false},{provider:'unknown'}])assert.equal((await projected(options)).policy.allowed,false);
});
test('Go DeepSeek receives the same Historical Reference grant while other Go models and proxies remain unavailable',async()=>{
 const model={provider:'opencode-go',id:'deepseek-v4.1-flash',api:'openai-completions',baseUrl:'https://opencode.ai/zen/go/v1'};
 const active=await projected({model});assert.equal(active.policy.allowed,true);
 assert.deepEqual(active.note.native_search_scope,{run:'r',step:'compose'});
 for(const options of [{enabled:false,model},{model:{...model,id:'kimi-k3'}},{model:{...model,baseUrl:'https://proxy.example'}}]) {
  assert.equal((await projected(options)).policy.allowed,false);
 }
});
