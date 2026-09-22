import {supportDecision,supportWire,supportChoices} from './support-agent-helpers.mjs';
/** Mechanical preselection and context seam tests. No live model or play claims. */
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'../..');await mkdir(join(root,'.tmp'),{recursive:true});
const temp=await mkdtemp(join(root,'.tmp/prescreen-test-'));after(()=>rm(temp,{recursive:true,force:true}));
await build({stdin:{contents:"export * from './extensions/table/prescreen.ts'; export * from './extensions/table/context-policy.ts'; export * from './extensions/table/context-runtime.ts'; export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {sourceReference} from './kernel-ts/read/workspace-candidates.ts';",resolveDir:root},
  outfile:join(temp,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
const binding={version:1,campaign:'c1',worldline:'main',loop:0,turn:1,source_revision:'a'.repeat(64)};
const capsule={turn:{number:1,player_text:'What is needed for my next action?'},where:{name:'Room',clock:{minutes:2}},known:{investigator:{name:'P',hp:10}},present:[],recent:[]};
const descriptors=[
  {kind:'investigator',label:'P',method:'table.look',params:{focus:'investigator',name:'P'}},
  {kind:'npc',label:'N',method:'table.look',params:{focus:'npc',name:'N'}},
  {kind:'object',label:'Lamp',method:'table.look',params:{focus:'object',name:'Lamp'}},
  {kind:'catalog',label:'Printed lamp',method:'table.lookup',params:{kind:'catalog',query:'Lamp'}},
  {kind:'rule',label:'Checks',method:'table.lookup',params:{kind:'rule',query:'core-check'}},
  {kind:'memory',label:'Prior reports',method:'table.recall',params:{what:'memory',limit:8}},
  {kind:'session',label:'Current session',method:'table.look',params:{focus:'session'}},
].map((c,i)=>({...c,key:`read-${i}`,summary:`Available ${c.kind} detail.`}));
function snapshot(){return {status:'valid',authority:{checked:true},binding:{...binding,stateStamp:'b'.repeat(64),rules_revision:'c'.repeat(64),scene:'room',adapter:'test'},
  read_catalog:{version:1,candidates:structuredClone(descriptors),omitted:0},candidates:{static:[],records:[]}};}
function decider(choice=()=> 'necessary'){return supportDecision(choice);}
const base=()=>({campaign:'c1',binding,capsule,signal:new AbortController().signal,record:()=>{},timeoutMs:2000});

test('preselection uses shared Jev credentials without enabling its feature implicitly',()=>{
  assert.equal(api.prescreenEnabled({EXT_JEV_APIKEY:'shared-test-key'}),false);
  assert.equal(api.prescreenEnabled({PI_COC_JEV_PRESELECT:'1',EXT_JEV_APIKEY:'shared-test-key'}),true);
  assert.equal(api.prescreenEnabled({PI_COC_JEV_PRESELECT:'1',PIPIUI_SPAWN_CONTRACT:'{}',
    PIPIUI_MOUNTED_EXTENSIONS:'kernel',EXT_JEV_APIKEY:'stale-test-key',TYPESAFE_API_KEY:'cli-test-key'}),false);
});

test('disabled preselection reads nothing and never removes the current capsule',async()=>{
  let reads=0;const c=structuredClone(capsule);
  assert.equal(await api.preparePrescreen({...base(),capsule:c,env:{},call:async()=>{reads++;}}),undefined);
  assert.equal(reads,0);assert.deepEqual(c,capsule);
});
test('a closed turn starts no further preselection work',async()=>{
  let reads=0,decisions=0;
  const result=await api.preparePrescreen({...base(),capsule:{...capsule,turn:{...capsule.turn,state:'awaiting_player'}},
    decision:{decide:async()=>{decisions++;}},call:async()=>{reads++;}});
  assert.equal(result,undefined);assert.equal(reads,0);assert.equal(decisions,0);
});
test('heterogeneous selected reads run concurrently; uncertain is retained; private transport stays private',async()=>{
  let active=0,peak=0;const calls=[],events=[],s=snapshot();
  s.read_catalog.candidates.push({key:'bad',kind:'npc',label:'Forbidden',method:'table.apply',params:{effects:[]}});
  const result=await api.preparePrescreen({...base(),record:e=>events.push(e),decision:decider(c=>c.kind==='catalog'?'skip':c.kind==='memory'?'uncertain':'necessary'),
    call:async(method,params)=>{calls.push({method,params});if(method==='table.workspace.read')return s;if(method==='table.resolve.options')return {};
      active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;
      return method==='table.recall'?{_snapshot:'host-only',hits:[{authority:'conversation_report',status:'superseded',statement:'An old belief.'}]}:{name:params.name??params.kind??params.focus};}});
  const view=JSON.parse(result.content);
  assert.equal(view.materials.length,6);assert(peak>1&&peak<=4);
  assert(!calls.some(c=>c.method==='table.apply'||c.params.kind==='catalog'));
  assert(!result.content.includes('host-only'));
  assert.equal(view.materials.find(c=>c.kind==='memory').content.hits[0].status,'superseded');
  assert.equal(view.assessment.coverage,'sufficient');assert.equal(events.at(-1).reads,6);
});
test('unavailable decision fails open and changed state never publishes stale supplemental data',async()=>{
  const s=snapshot();let reads=0;
  const missing=await api.preparePrescreen({...base(),decision:{decide:async()=>({status:'unavailable',answers:{},attempts:0})},
    call:async method=>{if(method==='table.resolve.options')return {};reads++;assert.equal(method,'table.workspace.read');return s;}});
  assert.equal(JSON.parse(missing.content).retrieval.stop_reason,'unavailable');assert.equal(JSON.parse(missing.content).check.disposition,'unknown');assert.equal(reads,2);
  const stale=await api.preparePrescreen({...base(),decision:decider(),call:async(method,params)=>method==='table.workspace.read'
    ?params.binding?{...s,binding:{...s.binding,stateStamp:'changed'}}:s:{ok:true}});
  assert.equal(stale,undefined);
});
test('failed or oversized reads remain follow-up references, never claimed complete',async()=>{
  const s=snapshot();
  const result=await api.preparePrescreen({...base(),decision:decider(),call:async(method,params)=>{
    if(method==='table.workspace.read')return s;if(params.focus==='npc')throw Error('unavailable');
    return {large:'x'.repeat(30_000)};}});
  const view=JSON.parse(result.content);assert.equal(view.materials.length,0);assert(view.gaps.length>=7);
  assert(view.gaps.some(x=>x.reason==='read_failed'));assert(api.sizeOf(result)<17*1024);
});
test('parent cancellation drops a late read without waiting for its provider',async()=>{
  const controller=new AbortController(),s=snapshot();let began,finish;
  const started=new Promise(r=>{began=r;}),pending=new Promise(r=>{finish=r;});
  const work=api.preparePrescreen({...base(),signal:controller.signal,decision:decider(),call:async(method)=>{
    if(method==='table.workspace.read')return s;began();return pending;}});
  await started;controller.abort();assert.equal(await work,undefined);finish({late:true});
});
test('optional preselection cannot displace protected current input or capsule',()=>{
  const messages=[{role:'user',content:'Current player words'},api.customMessage('coc-capsule',capsule)];
  messages[1].details={context:binding};
  const plain=api.projectedMessages({messages,binding,history:{quotes:[]},budget:4096});
  const extra=api.customMessage(api.PRESCREEN_TYPE,{body:'x'.repeat(10_000)});
  const bounded=api.projectedMessages({messages,binding,history:{quotes:[]},budget:4096,prescreen:extra});
  assert.deepEqual(bounded.messages,plain.messages);assert.equal(bounded.prescreenKept,undefined);
});
test('preselection never evicts workspace evidence already excluded from its candidate pool',async()=>{
  const s=snapshot(),ref=sourceRef('Archive',2000);s.binding.adapter='static-evidence-v2';s.candidates.static=[ref];
  const result=await api.preparePrescreen({...base(),alreadySupplied:[ref.locator],decision:decider(),
    call:async method=>method==='table.workspace.read'?s:{detail:'x'.repeat(180)}});
  assert(!JSON.parse(result.content).materials.some(c=>c.kind==='source'));
  const workspace=api.customMessage(api.WORKSPACE_TYPE,{evidence:[ref]});
  const messages=[{role:'user',content:capsule.turn.player_text},{...api.customMessage('coc-capsule',capsule),details:{context:binding}}];
  const args={messages,binding,history:{quotes:[]},workspace};
  let contested=0;
  for(let budget=1500;budget<=9000;budget+=250){
    const plain=api.projectedMessages({...args,budget});
    const extra=api.projectedMessages({...args,budget,prescreen:result});
    if(plain.workspaceKept){
      assert.equal(extra.workspaceKept,true,`workspace vanished at budget ${budget}`);
      if(!extra.prescreenKept)contested++;
    }
  }
  assert(contested>0,'the comparison must include budgets that cannot fit both optional messages');
});
function sourceRef(name,bytes){
  const graph=new api.ModuleGraph('fixture',{nodes:[{node_id:name,node_kind:'scene',name,
    properties:{description:'x'.repeat(bytes)}}],relations:[]},'fixture',{});
  return api.sourceReference(graph,[...graph.nodes.values()][0],{campaign:'c1',worldline:'main',loop:0},binding.source_revision,'room',true);
}
test('source excerpts and budget omissions retain their exact coverage and usable source lookup',async()=>{
  const s=snapshot();s.binding.adapter='static-evidence-v2';s.read_catalog.candidates=[];
  const refs=[sourceRef('Archive',9500),sourceRef('Cellar',9500),sourceRef('Attic',9500)];s.candidates.static=refs;
  const result=await api.preparePrescreen({...base(),decision:decider(),call:async()=>s});
  const view=JSON.parse(result.content);
  assert(view.materials.length>0&&view.gaps.length>0,'exercise delivered and omitted excerpts');
  for(const item of [...view.materials,...view.gaps.filter(item=>item.kind==='source')]){
    const locator=item.provenance?.locator;const ref=refs.find(r=>r.locator===locator);assert(ref,'every row identifies its source');
    assert.deepEqual(item.coverage,ref.coverage);
    assert.equal(item.coverage.entity_complete,false);
    assert(item.coverage.omitted.includes('source_projection_remainder'));
    assert.deepEqual(item.read,{tool:'lookup',kind:'module',query:ref.entity_refs[0]});
    if(item.content!==undefined)assert.equal(item.content,ref.body);
  }
  assert.equal(new Set([...view.materials,...view.gaps.filter(item=>item.kind==='source')].map(c=>c.label)).size,3);
});
test('Jev replaces optional workspace preload while preserving the full-request bound',async t=>{
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.TYPESAFE_API_KEY='mechanical-test-key';
  t.after(()=>{if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
    if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;globalThis.fetch=oldFetch;});
  globalThis.fetch=async(_url,options)=>{return Response.json(supportWire(JSON.parse(options.body)));};
  const s=snapshot();s.binding.adapter='static-evidence-v2';s.candidates.static=[sourceRef('Archive',2000)];
  const current={...capsule,mods:{instructions:[{mod:'keeper-context',settings:{mode:'on',workpad_enabled:false}}]}};
  let overhead=0;
  const ctx={model:{contextWindow:1000000},getSystemPrompt:()=> 'x'.repeat(overhead)};
  const messages=[{role:'user',content:capsule.turn.player_text}];
  async function host(flag){
    process.env.PI_COC_JEV_PRESELECT=flag;
    const hooks=new Map(),bus=new Map();
    api.installContextPolicy({on:(k,f)=>hooks.set(k,f),events:{on:(k,f)=>bus.set(k,f)}},()=>{});
    const call=async(method,params)=>method==='table.capsule'?{...current,_context:binding}:method==='table.workspace.read'?structuredClone(s)
      :method==='table.recall'?params.what==='transcript'?{cards:[],_snapshot:'history'}:{hits:[]}:{detail:'x'.repeat(200)};
    bus.get('coc:kernel-bridge')({campaign:'c1',call});bus.get('coc:capsule')({capsule:current,context:binding,epoch:'budget-input'});
    t.after(()=>hooks.get('session_shutdown')());
    return ()=>hooks.get('context')({messages},ctx);
  }
  const off=await host('0'),plain=await off();
  const workspace=plain.messages.find(m=>m.customType===api.WORKSPACE_TYPE);assert(workspace);
  overhead=api.requestBudget(ctx.model.contextWindow)-api.sizeOf(plain.messages)-api.sizeOf({system:'',tools:[]})-100;
  assert((await off()).messages.some(m=>m.customType===api.WORKSPACE_TYPE));
  const on=await host('1'),extra=await on();
  assert(!extra.messages.some(m=>m.customType===api.WORKSPACE_TYPE),'active Jev replaces the old optional preload');
  assert(extra.messages.some(m=>m.customType==='coc-capsule'));assert(extra.messages.some(m=>m.role==='user'&&m.content===capsule.turn.player_text));
  assert(api.requestSize(extra.messages)+api.sizeOf({system:ctx.getSystemPrompt(),tools:[]})<=api.requestBudget(ctx.model.contextWindow));
});
test('actual context hooks inject one current prescreen and invalidate it after an effect even with workspace off',async t=>{
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='mechanical-test-key';
  t.after(()=>{if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
    if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;globalThis.fetch=oldFetch;});
  let count=0,hp=10;globalThis.fetch=async(_url,options)=>{count++;return Response.json(supportWire(JSON.parse(options.body)));};
  const hooks=new Map(),bus=new Map(),events=[];
  api.installContextPolicy({on:(k,f)=>hooks.set(k,f),events:{on:(k,f)=>bus.set(k,f)}},e=>events.push(e));
  const call=async(method,params)=>{
    if(method==='table.capsule')return {...capsule,known:{investigator:{name:'P',hp}},_context:binding};
    if(method==='table.workspace.read')return {...snapshot(),binding:{...snapshot().binding,stateStamp:String(hp)}};
    if(method==='table.recall')return params.what==='transcript'?{cards:[],_snapshot:'history'}:{hits:[]};
    return {...(params.name?{name:params.name}:{}),hp};
  };
  bus.get('coc:kernel-bridge')({campaign:'c1',call});bus.get('coc:capsule')({capsule,context:binding,epoch:'effect-input'});
  const ctx={model:{contextWindow:1000000}},messages=[{role:'user',content:'What is needed for my next action?'}];
  const first=await hooks.get('context')({messages},ctx);
  assert.equal(first.messages.filter(m=>m.customType==='coc-prescreen').length,1,JSON.stringify(events));
  const countBefore=count;
  await hooks.get('tool_call')({toolName:'apply',toolCallId:'effect',input:{effects:[]}});hp=7;
  await hooks.get('tool_result')({toolName:'apply',toolCallId:'effect',isError:true,details:{}});
  const second=await hooks.get('context')({messages:first.messages},ctx);
  assert(count>countBefore);assert.equal(second.messages.filter(m=>m.customType==='coc-prescreen').length,1);
  const updated=JSON.parse(second.messages.find(m=>m.customType==='coc-prescreen').content);
  assert.equal(updated.materials.find(x=>x.kind==='investigator').content.hp,7);
  assert(events.some(e=>e.lane==='context'&&e.prescreen_injected===true));
  await hooks.get('session_shutdown')();
});
