import {supportDecision,supportWire,supportChoices} from './support-agent-helpers.mjs';
/** Actual request-supply seam tests. No provider or live-play claims. */
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {PRESELECT_ALLOWANCE_DEFAULT_MS} from '../../extensions/jev/agent/config.js';

const root=resolve(import.meta.dirname,'../..');
await mkdir(join(root,'.tmp'),{recursive:true});
const temp=await mkdtemp(join(root,'.tmp/prescreen-request-supply-'));
after(()=>rm(temp,{recursive:true,force:true}));
await build({stdin:{contents:"export * from './extensions/table/prescreen.ts'; export * from './extensions/table/prescreen-types.ts'; export * from './extensions/table/context-policy.ts'; export * from './extensions/table/context-runtime.ts'; export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts'; export {convertToLlm} from './node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js';",resolveDir:root},
  outfile:join(temp,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);

const binding={version:1,campaign:'c1',worldline:'main',loop:0,turn:1,source_revision:'a'.repeat(64)};
const capsule={turn:{number:1,player_text:'What is in the archive?'},where:{scene:'office'},present:[],known:{}};
const archive={locator:'scene:Archive',kind:'scene',name:'Archive',authority:'module_source',body:'Exact archive material.',
  text:'Exact archive material.',coverage:{status:'complete'},entity_refs:['Archive'],audience:'keeper_only',adapter:'static-evidence-v2',
  scope:{campaign:'c1',worldline:'main',loop:0},source_revision:binding.source_revision,identity:'archive-v1'};
const snapshot={status:'valid',authority:{checked:true},binding:{...binding,stateStamp:'b'.repeat(64),rules_revision:'c'.repeat(64),
  memory_revision:'d'.repeat(64),npc_revision:'e'.repeat(64),records_revision:'f'.repeat(64),catalog_revision:'1'.repeat(64),scene:'office',adapter:'static-evidence-v2'},
  read_catalog:{version:1,candidates:[],omitted:0},candidates:{static:[archive],records:[]}};
const decision=supportDecision();
function loopDecision(batch,label){
  const retained=batch.state.materials.some(material=>material.label===label),operations=batch.state.operations,
    operation=retained?undefined:operations.find(value=>value.tool==='read'&&value.label===label)??operations.find(value=>value.tool==='discover');
  return {status:'complete',attempts:1,usage:{inputTokens:10,outputTokens:2},answers:Object.fromEntries(Object.entries({
    operation:operation?.alias??'finish',coverage:retained?'sufficient':'missing',consistency:'clear'
  }).map(([key,choice])=>[key,{status:'answered',type:'choice',choice}]))};
}

test('actual baseline material is deduplicated before selection and prepared metadata stays host-only',async()=>{
  const supplied=api.customMessage(api.WORKSPACE_TYPE,{evidence:[archive]});
  let materialReads=0;
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,
    record:()=>{},suppliedMessages:[{role:'user',content:capsule.turn.player_text},supplied],byteBudget:8192,
    call:async(method,params)=>{
      assert.equal(method,'table.workspace.read');
      if(params.preselect?.mode==='check'||params.binding)return snapshot;
      if(params.preselect?.mode==='read'){materialReads++;return snapshot;}
      return snapshot;
    }});
  assert.equal(JSON.parse(result.content).materials.length,0,'already supplied material is not duplicated');
  assert.equal(materialReads,0);
});

test('exact complete ordinary tool material is reused while richer partial coverage is not discarded',async()=>{
  const body='Exact ordinary tool body.',tool={role:'toolResult',toolCallId:'look-1',toolName:'look',content:[{type:'text',text:body}]},complete={...snapshot,
    materials:{version:2,candidates:[{key:'graph:tool',kind:'graph_entity',label:'Tool fact',summary:'Tool fact',authority:'module_source',
      coverage:{status:'complete'},body}],coverage:{graph_entity:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}};
  let decisions=0;const counted={decide:async batch=>{decisions++;return decision.decide(batch);}},baseInput={campaign:'c1',binding,capsule,decision:counted,
    signal:new AbortController().signal,record:()=>{},suppliedMessages:[{role:'user',content:capsule.turn.player_text},tool],byteBudget:8192};
  const deduplicated=await api.preparePrescreen({...baseInput,call:async()=>complete});assert.equal(JSON.parse(deduplicated.content).materials.length,0);assert.equal(decisions,1);
  const richer={...complete,materials:{...complete.materials,candidates:[{...complete.materials.candidates[0],coverage:{status:'partial',omitted:['required_condition']}}]}};
  const result=await api.preparePrescreen({...baseInput,call:async()=>richer});assert(result);assert(decisions>0);
});

test('same locator does not hide richer material and partial supplied rows stay incomplete',async()=>{
  const skinny={...archive,body:'Skinny summary.',text:'Skinny summary.',coverage:{status:'partial',omitted:['conditions']}};
  const supplied=api.customMessage(api.WORKSPACE_TYPE,{evidence:[skinny]});
  const richer={...snapshot,materials:{version:2,candidates:[{key:'graph:archive',kind:'graph_entity',label:'Archive',summary:'Archive',
    authority:'module_source',locator:archive.locator,coverage:{status:'complete'},body:'Structured conditions and relationships.'}],
    coverage:{graph_entity:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}};
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text},supplied],byteBudget:8192,call:async()=>richer});
  assert(result);assert.equal(JSON.parse(result.content).materials[0].content,'Structured conditions and relationships.');
  assert.equal(api.suppliedPreview([supplied]).complete,false);
});

test('cached rich material survives a later skinny workspace with the same locator',async()=>{
  const richer={...snapshot,materials:{version:2,candidates:[{key:'graph:archive',kind:'graph_entity',label:'Archive',summary:'Archive',
    authority:'module_source',locator:archive.locator,coverage:{status:'complete'},body:'Structured conditions and relationships.'}],
    coverage:{graph_entity:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}};
  const prepared=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,call:async()=>richer});
  assert(prepared);
  const skinny={...archive,body:'Skinny summary.',text:'Skinny summary.',coverage:{status:'partial',omitted:['conditions']}},baseline=[
    {role:'user',content:capsule.turn.player_text},api.customMessage(api.WORKSPACE_TYPE,{evidence:[skinny]})];
  const reused=await api.reusePrescreen({campaign:'c1',binding,query:capsule.turn.player_text,message:prepared,suppliedMessages:baseline,
    byteBudget:8192,signal:new AbortController().signal,call:async()=>({...richer,materials:{version:2,candidates:[],coverage:{},
      check:{status:'current',changed:[],keys:['graph:archive'],dependencies:['source_revision']}}})});
  assert(reused);const content=JSON.parse(reused.content);
  assert(content.materials.some(row=>row.content==='Structured conditions and relationships.'));
  assert(content.gaps.some(row=>row.reason==='reassessment_required'));
});

test('a packet carries actual material while private preparation metadata remains outside content',async()=>{
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,
    record:()=>{},suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,
    call:async()=>snapshot});
  assert(result);
  const content=JSON.parse(result.content);
  assert.equal(content.materials[0].content,'Exact archive material.');
  assert.equal(content.materials[0].authority,'module_source');
  assert.equal(content.complete,false);
  assert(result.details?.prescreen?.prepared_digest);
  assert(!result.content.includes(result.details.prescreen.prepared_digest));
});

test('qualified native consultation projects one structured excerpt copy with semantic provenance',()=>{
  const material=api.publicMaterial({key:'qualified',kind:'source',label:'Supported consultation',summary:'',authority:'native_consultation',body:'duplicate body',refs:[{private:true}],
    coverage:{status:'complete',supported:true,derived:false,limitations:['No visual proof.']},data:{qualified_question:'What does the notice say?',supported:true,
      prepared:false,source_refs:[{source_id:'pdf:book',pdf_index:2}],excerpts:[{alias:'private-candidate-key',page:3,text:'Exact notice text.'}]}},'material_1');
  assert.equal(material.authority,'native_consultation');assert.equal(material.content.question,'What does the notice say?');
  assert.equal(material.content.supported,true);assert.equal(material.content.prepared,false);assert.deepEqual(material.content.excerpts,[{page:3,text:'Exact notice text.'}]);
  assert.equal(Object.hasOwn(material.content,'text'),false,'the joined body must not duplicate exact excerpt bytes');
  assert.deepEqual(material.provenance,{kind:'native_consultation',question:'What does the notice say?',pages:[3]});
  assert(!JSON.stringify(material).includes('private-candidate-key'));assert(!JSON.stringify(material).includes('private'));
});

test('an oversized qualified aggregate falls back to the selected raw excerpt without a complete claim',async()=>{
  const hash=value=>createHash('sha256').update(value).digest('hex'),file='7'.repeat(64),text='Authored excerpt '+'.'.repeat(1100),textHash=hash(text),extraction='native-budget-v1',
    revision=hash(JSON.stringify([extraction,file,1,textHash])),sourceSnapshot={version:1,module_id:'book',generation:0,revision:'8'.repeat(64),
      pdf:'/owned/budget.pdf',file_sha256:file,page_count:1,answers_revision:'9'.repeat(64),checked_answers:[],checked_answers_omitted:0,
      checked_answers_invalid:0,next:null},empty={...snapshot,materials:{version:2,candidates:[],coverage:{}}},source={home:'/owned',
      sourceInfo:async()=>({file_sha256:file,page_count:1}),sourceText:async()=>({file_sha256:file,extraction_version:extraction,page_count:1,
        snapshots:[{page:1,pdf_label:null,text,text_sha256:textHash,revision,availability:'text'}],errors:[]})};
  const sourceDecision=supportDecision(()=> 'necessary',{qualify:true});
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision:sourceDecision,timeoutMs:1000,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:2800,source:{moduleId:'book',runtime:source},call:async(method)=>{
      if(method==='module.source.materials.snapshot')return sourceSnapshot;if(method==='module.source.snapshot')return sourceSnapshot;return empty;}});
  assert(result);const content=JSON.parse(result.content),raw=content.materials.find(row=>row.authority==='native_text');assert(raw,JSON.stringify(content));
  assert.equal(raw.coverage.supported,false);assert(!content.materials.some(row=>row.authority==='native_consultation'));
  assert(content.gaps.some(row=>row.reason==='native_qualification_request_budget'),JSON.stringify(content));
  assert(api.requestSize([result])<=2800,'the compact gap and raw source fit the actual message allowance');
  assert(raw.read,'the retained partial excerpt keeps its source continuation');
});

test('one accepted-turn provider budget is consumed across repeated preparations',async()=>{
  let decisions=0;const providerBudget={actions:1,inputTokens:1000,outputTokens:1000,costUsd:1},counted={decide:async batch=>{
    decisions++;return {...await decision.decide(batch),usage:{inputTokens:10,outputTokens:2,costUsd:.01}};}};
  const input={campaign:'c1',binding,capsule,decision:counted,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,providerBudget,call:async()=>snapshot};
  assert(await api.preparePrescreen(input));assert.equal(providerBudget.actions,0);
  assert.equal(await api.preparePrescreen(input),undefined);assert.equal(decisions,1);
});

test('completed initial groups survive a sibling semantic timeout with explicit unknown gaps',async()=>{
  const candidates=Array.from({length:17},(_,index)=>({key:`graph:${index}`,kind:'graph_entity',label:`Evidence ${index}`,summary:`Evidence ${index}`,
    authority:'module_source',coverage:{status:'complete'},body:`Exact evidence ${index}.`})),view={...snapshot,materials:{version:2,candidates,
    coverage:{graph_entity:{inspected:17,emitted:17,omitted:0,unavailable:0,status:'complete'}}}};
  const partial={decide:async(batch,lease)=>{
    if(batch.state.materials?.some(m=>m.label==='Evidence 0')){await new Promise(resolve=>lease.signal.addEventListener('abort',resolve,{once:true}));return {status:'unavailable',answers:{},attempts:1,failure:{code:'timeout'}};}
    return supportDecision(c=>['Evidence 0','Evidence 16'].includes(c.label)?'necessary':'skip').decide(batch);
  }};
  const events=[],result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision:partial,timeoutMs:300,signal:new AbortController().signal,
    record:event=>events.push(event),suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,call:async()=>view});
  assert(result,JSON.stringify(events));const content=JSON.parse(result.content);
  assert(content.materials.some(row=>row.content==='Exact evidence 0.'));
  // Both independently necessary reads share the first round now that no decision is spent opening index groups.
  assert(content.materials.some(row=>row.content==='Exact evidence 16.'));
  assert(content.gaps.some(row=>row.reason==='loop_timeout'&&row.label==='Evidence 1'),'unread candidates stay explicit unknown gaps');
  assert.equal(content.retrieval.stop_reason,'timeout');
});

test('combined coverage and operation timeout keeps validated material with an unknown assessment',async()=>{
  const candidate={key:'graph:A',kind:'graph_entity',label:'Evidence A',summary:'Evidence A',authority:'module_source',coverage:{status:'complete'},body:'Exact A'},
    view={...snapshot,materials:{version:2,candidates:[candidate],coverage:{graph_entity:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}};
  let calls=0;const partial={decide:async(batch,lease)=>{calls++;
    if(batch.state.materials?.length){await new Promise(resolve=>lease.signal.addEventListener('abort',resolve,{once:true}));return {status:'unavailable',answers:{},attempts:1,failure:{code:'timeout'}};}
    return supportDecision().decide(batch);
  }};
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision:partial,timeoutMs:300,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,call:async()=>view});
  assert(result);const content=JSON.parse(result.content);assert.equal(content.materials[0].content,'Exact A');
  assert(content.gaps.some(row=>row.kind==='coverage'&&row.reason==='timeout'));assert.equal(content.assessment.coverage,'uncertain');
});

test('optional supplement timeout keeps initial material and names the remaining candidate',async()=>{
  const candidates=['A','B'].map(label=>({key:`graph:${label}`,kind:'graph_entity',label:`Evidence ${label}`,summary:`Evidence ${label}`,
    authority:'module_source',coverage:{status:'complete'},body:`Exact ${label}`})),view={...snapshot,materials:{version:2,candidates,
    coverage:{graph_entity:{inspected:2,emitted:2,omitted:0,unavailable:0,status:'complete'}}}};
  let calls=0;const partial={decide:async(batch,lease)=>{calls++;
    if(batch.state.materials?.length){await new Promise(resolve=>lease.signal.addEventListener('abort',resolve,{once:true}));return {status:'unavailable',answers:{},attempts:1,failure:{code:'timeout'}};}
    return supportDecision(c=>c.label==='Evidence A'?'necessary':'skip').decide(batch);
  }};
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision:partial,timeoutMs:300,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,call:async()=>view});
  assert(result);const content=JSON.parse(result.content);assert(content.materials.some(row=>row.content==='Exact A'));
  assert(content.gaps.some(row=>row.reason==='loop_timeout'&&row.label==='Evidence B'));
  assert.equal(calls,2,'read, then the unavailable next decision');
});

test('complete bound catalog content is reused without a duplicate materialization RPC',async()=>{
  const view={...snapshot,materials:{version:2,candidates:[{key:'graph:A',kind:'graph_entity',label:'A',summary:'Complete source unit',
    authority:'module_source',body:'Complete bound text.',coverage:{status:'complete'}}],coverage:{graph_entity:{status:'complete'}}}};
  const calls=[];
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[],byteBudget:8192,call:async(method,params)=>{calls.push(method==='table.workspace.read'?params.preselect?.mode:method);return view;}});
  assert.equal(JSON.parse(result.content).materials[0].content,'Complete bound text.');
  // The query-independent index read precedes discovery (§124.10); an index this fixture cannot supply only skips the locate.
  assert.deepEqual(calls,['index','catalog','table.resolve.options','check'],'reuse retains the final owner check');
});

test('host parallel NPC reads retain issued packing order and use one combined decision round',async()=>{
  const candidates=[{key:'graph:A',kind:'graph_entity',label:'A',summary:'Context',authority:'module_source',body:'Known context.',coverage:{status:'complete'}},
    ...['B','C'].map(name=>({key:`npc:${name}`,kind:'npc',label:name,summary:`Current dossier ${name}`,authority:'current_read',
      coverage:{status:'partial',omitted:['material_not_read']},method:'table.look',params:{focus:'npc',name}}))];
  const view={...snapshot,materials:{version:2,candidates,coverage:{npc:{status:'partial'}}}},events=[];
  let decisions=0,active=0,peak=0,releaseB;const waitingB=new Promise(resolve=>{releaseB=resolve;}),completed=[];
  const select={decide:async batch=>{decisions++;return supportDecision().decide(batch);}};
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision:select,signal:new AbortController().signal,record:event=>events.push(event),
    suppliedMessages:[],byteBudget:8192,timeoutMs:2000,call:async(method,params)=>{
      if(method==='table.workspace.read'){assert.notEqual(params.preselect?.mode,'read','issued look descriptors execute without a second catalog scan');return view;}
      assert.equal(method,'table.look');active++;peak=Math.max(peak,active);
      if(params.name==='B')await waitingB;else{completed.push('C');releaseB();active--;return{name:'C',journal:'Complementary evidence C.'};}
      completed.push('B');active--;return{name:'B',journal:'Independent evidence B.'};
    }});
  assert(result);assert.equal(peak,2);assert.deepEqual(completed,['C','B']);
  assert.deepEqual(JSON.parse(result.content).materials.map(row=>row.label),['A','B','C']);
  assert.equal(decisions,2,'read independent materials together, then assess the result');
  assert.equal(events.find(event=>event.event==='loop_cycle').parallel_width,3);
});

test('missing coverage triggers one bounded progress-making supplement and final recheck',async()=>{
  const candidates=['A','B'].map(label=>({key:`graph:${label}`,kind:'graph_entity',label,summary:`Evidence ${label}`,authority:'module_source',
    coverage:{status:'complete'},body:`Exact ${label}`})),view={...snapshot,materials:{version:2,candidates,
    coverage:{graph_entity:{inspected:2,emitted:2,omitted:0,unavailable:0,status:'complete'}}}};
  let coverageCalls=0;const events=[],scripted=supportDecision();
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision:scripted,signal:new AbortController().signal,record:event=>events.push(event),
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,providerBudget:{actions:8,inputTokens:10000,outputTokens:10000,costUsd:1},
    call:async()=>view});
  assert(result);const content=JSON.parse(result.content);assert.deepEqual(content.materials.map(row=>row.content),['Exact A','Exact B'],JSON.stringify(content));
  assert.deepEqual(content.assessment,{coverage:'sufficient',consistency:'clear'});assert.equal(events.at(-1).selected,2);
  assert.equal(content.retrieval.status,'ready');assert.equal(content.retrieval.steps,2);
});

test('missing coverage consumes one bound v2 catalog continuation before supplement selection',async()=>{
  const make=label=>({key:`graph:${label}`,kind:'graph_entity',label,summary:`Evidence ${label}`,authority:'module_source',coverage:{status:'complete'},body:`Exact ${label}`}),
    first={...snapshot,materials:{version:2,candidates:[make('A')],coverage:{graph_entity:{inspected:2,emitted:1,omitted:1,unavailable:0,status:'partial'}},next:1}},
    second={...snapshot,materials:{version:2,candidates:[make('B')],coverage:{graph_entity:{inspected:2,emitted:1,omitted:1,unavailable:0,status:'partial'}},next:null}};
  let coverageCalls=0;const cursors=[],scripted=supportDecision(()=> 'necessary',{discover:true});
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision:scripted,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,providerBudget:{actions:8,inputTokens:10000,outputTokens:10000,costUsd:1},
    call:async(method,params)=>{if(method!=='table.workspace.read')throw Error(`unexpected ${method}`);if(params.preselect?.mode==='catalog'){
      cursors.push(params.preselect.cursor);return params.preselect.cursor===1?second:first;}
      if(params.preselect?.mode==='read'&&params.preselect.keys.includes('graph:B'))return second;return first;}});
  assert(result);const content=JSON.parse(result.content);assert.deepEqual(content.materials.map(row=>row.content),['Exact A','Exact B'],JSON.stringify(content));
  assert.deepEqual(cursors,[0,1]);assert.deepEqual(content.coverage.catalog,{pages:2,candidates:2,continuation:null});
});

test('supplemented dynamic read also replaces unread coverage while preserving owner omissions',async()=>{
  const candidates=[{key:'graph:A',kind:'graph_entity',label:'Evidence A',summary:'Evidence A',authority:'module_source',coverage:{status:'complete'},body:'Exact A'},
    {key:'read:npc:N',kind:'npc',label:'NPC N',summary:'Current NPC dossier',authority:'current_read',coverage:{status:'partial',omitted:['material_not_read']},
      method:'table.look',params:{focus:'npc',name:'N'}}],view={...snapshot,materials:{version:2,candidates,
        coverage:{graph_entity:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'},npc:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}};
  let coverageCalls=0;const scripted=supportDecision();
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision:scripted,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,providerBudget:{actions:8,inputTokens:10000,outputTokens:10000,costUsd:1},
    call:async(method)=>method==='table.look'?{name:'N',journal:'Supplemented current body.',coverage:{omitted:['sealed_notes']}}:view});
  assert(result);const content=JSON.parse(result.content),npc=content.materials.find(row=>row.kind==='npc');assert.equal(npc.content.journal,'Supplemented current body.');
  assert(npc.coverage.supplied.includes('materialized_read'));assert(npc.coverage.omitted.includes('sealed_notes'));
  assert(npc.coverage.unknown.includes('projection_completeness'));assert(!JSON.stringify(npc.coverage).includes('material_not_read'));
});

test('failed dynamic read remains a gap with its unread placeholder',async()=>{
  const dynamic={key:'read:npc:N',kind:'npc',label:'NPC N',summary:'Current NPC dossier',authority:'current_read',coverage:{status:'partial',
    omitted:['material_not_read']},method:'table.look',params:{focus:'npc',name:'N'}},view={...snapshot,materials:{version:2,candidates:[dynamic],
      coverage:{npc:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}};
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,call:async method=>{if(method==='table.look')throw Error('unavailable');return view;}});
  assert(result);const gap=JSON.parse(result.content).gaps.find(row=>row.kind==='npc'&&row.reason==='read_failed');assert(gap);
  assert(gap.coverage.omitted.includes('material_not_read'));assert(!gap.coverage.supplied?.includes('materialized_read'));
});

test('semantic necessity lets late source evidence survive ahead of helpful kernel material',async()=>{
  const candidates=[...Array.from({length:12},(_,index)=>({key:`graph:${index}`,kind:'graph_entity',label:`Graph ${index}`,summary:'Helpful context',
    authority:'module_source',coverage:{status:'complete'},body:'g'.repeat(700)})),{key:'source:late',kind:'source',label:'Late PDF fact',summary:'Required fact',
    authority:'native_text',coverage:{status:'partial'},body:'Required literal source evidence.'}],view={...snapshot,materials:{version:2,candidates,
    coverage:{graph_entity:{inspected:12,emitted:12,omitted:0,unavailable:0},source:{inspected:1,emitted:1,omitted:0,unavailable:0}}}};
  const prioritizer=supportDecision(c=>c.kind==='source'?'necessary':'helpful');
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision:prioritizer,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:2300,call:async()=>view});
  assert(result);const content=JSON.parse(result.content);assert(content.materials.some(row=>row.content==='Required literal source evidence.'));
  assert(content.gaps.some(row=>row.reason==='request_budget'),'helpful overflow remains explicit');
  assert(result.details.prescreen.selection_trace.some(row=>row.reason==='request_budget'));
  if(content.coverage.gaps_omitted)assert(Object.keys(content.coverage.gaps_omitted_by_reason).length>0);
});

test('existing source owner contributes exact native content with host-only refs',async()=>{
  const hash=value=>createHash('sha256').update(value).digest('hex'),file='2'.repeat(64),text='Exact native source paragraph.';
  const textHash=hash(text);let extraction='native-v1';
  const sourceSnapshot={version:1,module_id:'book',generation:0,revision:'3'.repeat(64),pdf:'/owned/book.pdf',file_sha256:file,page_count:1,
    answers_revision:'4'.repeat(64),checked_answers:[],checked_answers_omitted:0,checked_answers_invalid:0,next:null};
  const empty={...snapshot,materials:{version:2,candidates:[],coverage:{}}};
  const source={home:'/owned',sourceInfo:async()=>({file_sha256:file,page_count:1}),sourceText:async()=>({file_sha256:file,
    extraction_version:extraction,page_count:1,snapshots:[{page:1,pdf_label:null,text,text_sha256:textHash,
      revision:hash(JSON.stringify([extraction,file,1,textHash])),availability:'text'}],errors:[]})};
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,source:{moduleId:'book',runtime:source},
    call:async(method,params)=>method==='module.source.materials.snapshot'?sourceSnapshot:empty});
  assert(result);const content=JSON.parse(result.content),material=content.materials.find(row=>row.authority==='native_text');assert(material);
  assert.equal(material.content,text);assert.equal(material.provenance.page,1);assert(!result.content.includes('selector'));
  assert.deepEqual(content.assessment,{coverage:'sufficient',consistency:'clear'});
  assert(Object.keys(result.details.prescreen.refs).length>0,'exact refs stay in host metadata');
  const changedBaseline=[{role:'user',content:capsule.turn.player_text},{role:'toolResult',toolCallId:'look-1',toolName:'look',content:[{type:'text',text:'New current-state evidence.'}]}];
  const carried=await api.reusePrescreen({campaign:'c1',binding,query:capsule.turn.player_text,message:result,
    suppliedMessages:changedBaseline,byteBudget:8192,signal:new AbortController().signal,source:{moduleId:'book',runtime:source},
    call:async(method)=>method==='module.source.materials.snapshot'?sourceSnapshot:{...empty,status:'unverifiable',authority:{checked:false},
      materials:{version:2,candidates:[],coverage:{},check:{status:'stale',changed:['stateStamp'],keys:[]}}}});
  assert(carried);const carriedContent=JSON.parse(carried.content);assert.equal(carriedContent.materials[0].content,text);
  assert.deepEqual(carriedContent.assessment,{coverage:'uncertain',consistency:'uncertain'});assert(carriedContent.gaps.some(row=>row.reason==='reassessment_required'));
  assert.equal(carried.details.prescreen.needs_reassessment,true);
  extraction='native-v2';
  const reused=await api.reusePrescreen({campaign:'c1',binding,query:capsule.turn.player_text,message:result,
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,signal:new AbortController().signal,source:{moduleId:'book',runtime:source},
    call:async(method)=>method==='module.source.materials.snapshot'?sourceSnapshot:{...empty,materials:{version:2,candidates:[],coverage:{},
      check:{status:'current',changed:[],keys:[],dependencies:[]}}}});
  assert.equal(reused,undefined,'same PDF bytes with a changed native extraction cannot reuse old material');
});

test('memory routes through snapshot page original and finish without table transport fields',async()=>{
  const route={key:'read-memory',kind:'memory',label:'Memory evidence',summary:'Purpose-aware retained evidence',authority:'conversation_report',
    coverage:{status:'partial'},method:'memory.evidence',params:{action:'snapshot',query:capsule.turn.player_text,filters:{}}};
  const v2={...snapshot,materials:{version:2,candidates:[route],coverage:{memory:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}};
  const calls=[];const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,call:async(method,params)=>{
      calls.push({method,params});assert.equal(params._context_read,undefined);
      if(method==='table.workspace.read')return v2;
      if(params.action==='snapshot')return {snapshot:'memory-s1',query:capsule.turn.player_text};
      if(params.action==='page')return {snapshot:'memory-s1',offset:0,total:1,rows:[{alias:'m1',statement:'Knott promised payment.',state:'current'}],next_offset:null};
      if(params.action==='original')return {alias:'m1',verified:true,entry:{statement:'Knott promised payment.'},context:[{role:'keeper',text:'I will pay you.',range:{offset:0,end:15}}],refs:[{version:1}]};
      if(params.action==='finish')return {status:'ready',hits:[{alias:'m1',entry:{statement:'Knott promised payment.'},context:[{role:'keeper',text:'I will pay you.'}]}],refs:[{version:1}],coverage:{used:['m1'],omitted:[],unknown:[]}};
      throw Error(`unexpected ${method}`);
    }});
  assert(result);const content=JSON.parse(result.content),memory=content.materials.find(row=>row.kind==='memory');assert(memory);
  assert.equal(memory.content.context[0].text,'I will pay you.');assert.deepEqual(calls.filter(row=>row.method==='memory.evidence').map(row=>row.params.action),
    ['snapshot','page','original','finish','finish']);assert(result.details.prescreen.refs[Object.keys(result.details.prescreen.refs)[0]]);
});

test('memory candidate pagination leaves an explicit continuation gap after the bounded scan',async()=>{
  const route={key:'read-memory',kind:'memory',label:'Memory evidence',summary:'Purpose-aware retained evidence',authority:'conversation_report',
    coverage:{status:'partial'},method:'memory.evidence',params:{action:'snapshot',query:capsule.turn.player_text,filters:{}}};
  const v2={...snapshot,materials:{version:2,candidates:[route],coverage:{memory:{inspected:5,emitted:1,omitted:4,unavailable:0,status:'partial'}}}};
  const skipMemory=supportDecision(()=> 'skip');
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision:skipMemory,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,call:async(method,params)=>{
      if(method==='table.workspace.read')return v2;
      if(params.action==='snapshot')return {snapshot:'memory-pages',query:capsule.turn.player_text};
      if(params.action==='page')return {total:5,rows:[{alias:`m${params.offset+1}`,statement:`Memory ${params.offset+1}.`,state:'current'}],next_offset:params.offset+1};
      if(params.action==='original')return {alias:params.alias,verified:true,context:[{role:'keeper',text:`Original ${params.alias}.`}],refs:[]};
      if(params.action==='finish')return {status:'ready',hits:params.selected.map(alias=>({alias,context:[{role:'keeper',text:`Original ${alias}.`}]})),refs:[],
        coverage:{used:params.selected,omitted:[],unknown:params.unknown}};
      throw Error(`unexpected ${method}`);
    }});
  assert(result);const content=JSON.parse(result.content),gap=content.gaps.find(row=>row.reason==='candidate_page_limit');
  assert.equal(content.materials.length,0);assert(gap,JSON.stringify(content));assert.equal(gap.coverage.inspected,4);assert.equal(gap.coverage.total,5);
  assert.equal(gap.coverage.omitted,1);assert.equal(gap.coverage.continuation,true);assert.deepEqual(gap.read,{tool:'recall',what:'memory',query:capsule.turn.player_text});
  assert(!JSON.stringify(gap).includes('next_offset'));
});

test('one unread memory alias does not discard other owner-verified evidence',async()=>{
  const route={key:'read-memory',kind:'memory',label:'Memory evidence',summary:'Purpose-aware retained evidence',authority:'conversation_report',
    coverage:{status:'partial'},method:'memory.evidence',params:{action:'snapshot',query:capsule.turn.player_text,filters:{}}};
  const v2={...snapshot,materials:{version:2,candidates:[route],coverage:{memory:{inspected:2,emitted:2,omitted:0,unavailable:0,status:'complete'}}}};
  const finishes=[];const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,call:async(method,params)=>{
      if(method==='table.workspace.read')return v2;
      if(params.action==='snapshot')return {snapshot:'memory-partial',query:capsule.turn.player_text};
      if(params.action==='page')return {total:2,rows:[{alias:'m1',statement:'Verified memory.'},
        {alias:'m2',statement:'Unread memory.',state:'current'}],next_offset:null};
      if(params.action==='original'&&params.alias==='m1')return {alias:'m1',verified:true,context:[{role:'keeper',text:'Verified original.'}],refs:[]};
      if(params.action==='original'&&params.alias==='m2')throw Error('owner read failed');
      if(params.action==='finish'){finishes.push(structuredClone(params));return {status:'ready',hits:[{alias:'m1',context:[{role:'keeper',text:'Verified original.'}]}],
        refs:[],coverage:{used:['m1'],omitted:[],unknown:params.unknown}};}
      throw Error(`unexpected ${method}`);
    }});
  assert(result);const content=JSON.parse(result.content);
  assert(content.materials.some(row=>row.kind==='memory'&&row.content.context[0].text==='Verified original.'));
  assert(content.gaps.some(row=>row.kind==='memory'&&row.reason==='read_failed'));
  assert.equal(finishes.length,2);for(const finish of finishes){assert.deepEqual(finish.selected,['m1']);assert.deepEqual(finish.considered,['m1']);assert.deepEqual(finish.unknown,[]);
    assert.equal(finish.assessments[0].applicability,'unknown');}
});

test('memory owner changing after dependent checks prevents publication',async()=>{
  const route={key:'read-memory',kind:'memory',label:'Memory evidence',summary:'Purpose-aware retained evidence',authority:'conversation_report',
    coverage:{status:'partial'},method:'memory.evidence',params:{action:'snapshot',query:capsule.turn.player_text,filters:{}}};
  const v2={...snapshot,materials:{version:2,candidates:[route],coverage:{memory:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}};
  let finishes=0;const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,record:()=>{},
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,call:async(method,params)=>{
      if(method==='table.workspace.read')return v2;if(params.action==='snapshot')return {snapshot:'memory-s2',query:capsule.turn.player_text};
      if(params.action==='page')return {rows:[{alias:'m1',statement:'Current memory.'}],next_offset:null};
      if(params.action==='original')return {alias:'m1',verified:true,context:[{role:'keeper',text:'Current memory.'}],refs:[{version:1}]};
      if(params.action==='finish')return ++finishes===1?{status:'ready',hits:[{alias:'m1',context:[{role:'keeper',text:'Current memory.'}]}],refs:[],coverage:{used:['m1'],omitted:[],unknown:[]}}
        :{status:'refresh',snapshot:'memory-s2'};throw Error(`unexpected ${method}`);}});
  assert.equal(result,undefined);assert.equal(finishes,2);
});

test('outer deadline still blocks publication when final owner validation cannot finish',async()=>{
  const candidate={key:'graph:final-check',kind:'graph_entity',label:'Final check',summary:'Final check',authority:'module_source',
    coverage:{status:'complete'},body:'Validated only before the final check.'},view={...snapshot,materials:{version:2,candidates:[candidate],
      coverage:{graph_entity:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}},events=[];
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,timeoutMs:300,signal:new AbortController().signal,record:event=>events.push(event),
    suppliedMessages:[{role:'user',content:capsule.turn.player_text}],byteBudget:8192,call:async(method,params)=>{
      if(method!=='table.workspace.read')throw Error(`unexpected ${method}`);
      if(params.preselect?.mode==='check')return new Promise(()=>{});
      return view;
    }});
  assert.equal(result,undefined);assert(events.some(event=>event.event==='fallback'&&event.reason==='cancelled_or_timeout'));
});

test('real committed memory owner reaches provider payload without private refs or commit hashes',async t=>{
  const home=await mkdtemp(join(root,'.coc/prescreen-memory-owner-')),kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),
    seed:'prescreen-memory-owner',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(kernel);
  t.after(async()=>{await runtime.close();await rm(home,{recursive:true,force:true});});
  const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
  await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');
  await call('table.player_input',{text:'I ask what Knott promised.'});await call('table.narrate',{call_id:'t1-c1',text:'Knott says, "I will pay twenty dollars per day."'});
  const opened=await call('table.open'),input=await call('table.player_input',{text:'What exactly did Knott promise to pay?'}),{_context,...capsule}=await call('table.capsule',{rehydrate:true});
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='mechanical-test-key';
  t.after(()=>{if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
    if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;globalThis.fetch=oldFetch;});
  globalThis.fetch=async(_url,options)=>{return Response.json(supportWire(JSON.parse(options.body),c=>c.kind==='memory'?'necessary':'skip'));};
  const hooks=new Map(),bus=new Map(),events=[];api.installContextPolicy({on:(key,fn)=>hooks.set(key,fn),events:{on:(key,fn)=>bus.set(key,fn)},
    getActiveTools:()=>[],getAllTools:()=>[]},event=>events.push(event));
  bus.get('coc:kernel-bridge')({campaign:'c1',call});bus.get('coc:table-open')({campaign:'c1',open:opened});
  bus.get('coc:capsule')({capsule,context:_context,epoch:input.epoch??'real-memory'});
  const projected=await hooks.get('context')({type:'context',messages:[{role:'user',content:'What exactly did Knott promise to pay?'}]},
    {model:{contextWindow:1000000},getSystemPrompt:()=>''});
  const packet=projected.messages.find(message=>message.customType===api.PRESCREEN_TYPE);assert(packet,JSON.stringify(events));
  const memory=JSON.parse(packet.content).materials.filter(row=>row.kind==='memory');assert(memory.length);assert.match(JSON.stringify(memory),/twenty dollars per day/i);
  const publicText=JSON.stringify(memory);assert(!publicText.includes('"ref"'));assert(!publicText.includes('"refs"'));assert(!publicText.includes('"commit"'));
  await hooks.get('before_provider_request')({type:'before_provider_request',payload:{input:api.convertToLlm(projected.messages)}},{});
  assert.equal(events.findLast(event=>event.lane==='prescreen'&&event.event==='delivered')?.delivered,true);
  await hooks.get('session_shutdown')();
});

test('actual context and provider hooks recover material dropped with an oversized workspace',async t=>{
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldBudget=process.env.PI_COC_REQUEST_BYTES,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='mechanical-test-key';process.env.PI_COC_REQUEST_BYTES='4096';
  t.after(()=>{for(const [key,value] of [['PI_COC_JEV_PRESELECT',oldFlag],['TYPESAFE_API_KEY',oldKey],['PI_COC_REQUEST_BYTES',oldBudget]])
    if(value===undefined)delete process.env[key];else process.env[key]=value;globalThis.fetch=oldFetch;});
  globalThis.fetch=async(_url,options)=>{return Response.json(supportWire(JSON.parse(options.body)));};
  const big=index=>({...archive,locator:`scene:Bulk-${index}`,identity:`bulk-${index}`,entity_refs:[`Bulk-${index}`],
    body:`Bulk ${index} `+'x'.repeat(3800),text:`Bulk ${index} `+'x'.repeat(3800)});
  const ordinary={...snapshot,candidates:{static:[big(1),big(2),big(3)],records:[]}};
  const v2={...snapshot,materials:{version:2,candidates:[{key:'source:archive',kind:'source',label:'Archive excerpt',summary:'Relevant archive text',
    authority:'module_source',coverage:{status:'complete'},body:'Exact archive material.'}],coverage:{inspected:1,emitted:1,omitted:0,unavailable:0}}};
  const current={...capsule,mods:{instructions:[{mod:'keeper-context',settings:{mode:'on',budget_bytes:16384,workpad_enabled:false}}]}};
  const hooks=new Map(),bus=new Map(),events=[];
  api.installContextPolicy({on:(key,fn)=>hooks.set(key,fn),events:{on:(key,fn)=>bus.set(key,fn)},getActiveTools:()=>[],getAllTools:()=>[]},event=>events.push(event));
  const call=async(method,params)=>{
    if(method==='table.capsule')return {...current,_context:binding};
    if(method==='table.recall')return params.what==='transcript'?{cards:[],_snapshot:'history'}:{hits:[]};
    if(method==='table.workspace.read')return params.preselect?.version===2?v2:ordinary;
    throw Error(`unexpected ${method}`);
  };
  bus.get('coc:kernel-bridge')({campaign:'c1',call});
  bus.get('coc:capsule')({capsule:current,context:binding,epoch:'epoch-1'});
  const projected=await hooks.get('context')({messages:[{role:'user',content:capsule.turn.player_text}],type:'context'},
    {model:{contextWindow:1000000},getSystemPrompt:()=>''});
  assert(!projected.messages.some(message=>message.customType===api.WORKSPACE_TYPE),'oversized workspace is absent from the actual baseline');
  const packet=projected.messages.find(message=>message.customType===api.PRESCREEN_TYPE);assert(packet,'smaller actual material packet survives');
  assert.equal(JSON.parse(packet.content).materials[0].content,'Exact archive material.');
  const converted=api.convertToLlm(structuredClone(projected.messages));
  await hooks.get('before_provider_request')({type:'before_provider_request',payload:{model:'fixture',input:converted}},{});
  const delivered=events.findLast(event=>event.lane==='prescreen'&&event.event==='delivered');
  assert.equal(delivered?.delivered,true,JSON.stringify(events));
  assert(delivered?.request_id);assert.equal(delivered.retained.length,1);assert(delivered.retained[0].digest);
  assert(!JSON.stringify(delivered).includes('Exact archive material.'));
  await hooks.get('session_shutdown')();
});

test('private host metadata cannot evict model material, while large visible content still obeys the ceiling',()=>{
  const messages=[{role:'user',content:capsule.turn.player_text},
    {...api.customMessage('coc-capsule',capsule),details:{context:binding}}];
  const packet=api.customMessage(api.PRESCREEN_TYPE,{materials:[{content:'Exact retained evidence.'}]});
  packet.details={prescreen:{diagnostic:'x'.repeat(100_000)}};
  const input={messages,binding,history:{turns:[]},budget:4096,prescreen:packet},projected=api.projectedMessages(input);
  assert.equal(projected.prescreenKept,true);
  assert(projected.messages.includes(packet),'private host state remains attached for its owner');
  assert(api.sizeOf(projected.messages)>4096);assert(api.requestSize(projected.messages)<=4096);
  assert(!JSON.stringify(api.convertToLlm(projected.messages)).includes(packet.details.prescreen.diagnostic));
  const oversized=api.projectedMessages({...input,prescreen:api.customMessage(api.PRESCREEN_TYPE,{materials:[{content:'Visible source '.repeat(2000)}]})});
  assert(!oversized.prescreenKept);assert(api.requestSize(oversized.messages)<=4096);
});

test('successful dynamic read replaces the unread placeholder in the final provider payload',async t=>{
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='mechanical-test-key';
  t.after(()=>{if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
    if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;globalThis.fetch=oldFetch;});
  globalThis.fetch=async(_url,options)=>{return Response.json(supportWire(JSON.parse(options.body)));};
  const dynamic={key:'read:npc:Knott',kind:'npc',label:'Steven Knott',summary:'Current NPC dossier',authority:'current_read',
    coverage:{status:'partial',omitted:['material_not_read']},method:'table.look',params:{focus:'npc',name:'Steven Knott'}},view={...snapshot,
    materials:{version:2,candidates:[dynamic],coverage:{npc:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}},hooks=new Map(),bus=new Map(),events=[];
  api.installContextPolicy({on:(key,fn)=>hooks.set(key,fn),events:{on:(key,fn)=>bus.set(key,fn)},getActiveTools:()=>[],getAllTools:()=>[]},event=>events.push(event));
  const call=async(method,params)=>{if(method==='table.capsule')return {...capsule,_context:binding};
    if(method==='table.recall')return params.what==='transcript'?{cards:[],_snapshot:'history'}:{hits:[]};
    if(method==='table.workspace.read')return view;if(method==='table.look')return {name:'Steven Knott',journal:'Actual dynamic body.',
      coverage:{status:'partial',omitted:['private_notes']}};throw Error(`unexpected ${method}`);};
  bus.get('coc:kernel-bridge')({campaign:'c1',call});bus.get('coc:capsule')({capsule,context:binding,epoch:'dynamic-read-input'});
  const projected=await hooks.get('context')({messages:[{role:'user',content:capsule.turn.player_text}],type:'context'},
    {model:{contextWindow:1000000},getSystemPrompt:()=>''}),packet=projected.messages.find(message=>message.customType===api.PRESCREEN_TYPE);assert(packet,JSON.stringify(events));
  const material=JSON.parse(packet.content).materials.find(row=>row.kind==='npc');assert.equal(material.content.journal,'Actual dynamic body.');
  assert(material.coverage.supplied.includes('materialized_read'));assert(material.coverage.omitted.includes('private_notes'));
  assert(material.coverage.unknown.includes('projection_completeness'));assert(!JSON.stringify(material.coverage).includes('material_not_read'));
  const payload={model:'fixture',input:api.convertToLlm(projected.messages)};assert.match(JSON.stringify(payload),/Actual dynamic body/);
  assert(!JSON.stringify(payload).includes('material_not_read'));await hooks.get('before_provider_request')({type:'before_provider_request',payload},{});
  assert.equal(events.findLast(event=>event.lane==='prescreen'&&event.event==='delivered')?.delivered,true);await hooks.get('session_shutdown')();
});

test('first eligible context arms one allowance after delayed mandatory work and never rearms it',async t=>{
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch,actualNow=Date.now;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='mechanical-test-key';let decisions=0;
  t.after(()=>{if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
    if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;globalThis.fetch=oldFetch;Date.now=actualNow;});
  globalThis.fetch=async(_url,options)=>{decisions++;return Response.json(supportWire(JSON.parse(options.body)));};
  const candidate={key:'graph:delayed',kind:'graph_entity',label:'Delayed evidence',summary:'Delayed evidence',authority:'module_source',
    coverage:{status:'complete'},body:'Material after mandatory work.'},view={...snapshot,materials:{version:2,candidates:[candidate],
      coverage:{graph_entity:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}},hooks=new Map(),bus=new Map(),events=[];
  api.installContextPolicy({on:(key,fn)=>hooks.set(key,fn),events:{on:(key,fn)=>bus.set(key,fn)},getActiveTools:()=>[],getAllTools:()=>[]},event=>events.push(event));
  const call=async(method,params)=>{if(method==='table.capsule')return {...capsule,_context:binding};
    if(method==='table.recall')return params.what==='transcript'?{cards:[],_snapshot:'history'}:{hits:[]};
    if(method==='table.workspace.read')return view;throw Error(`unexpected ${method}`);};
  bus.get('coc:kernel-bridge')({campaign:'c1',call});bus.get('coc:capsule')({capsule,context:binding,epoch:'accepted-input-1'});
  Date.now=()=>actualNow()+7000;
  const ctx={model:{contextWindow:1000000},getSystemPrompt:()=>''},messages=[{role:'user',content:capsule.turn.player_text}],first=await hooks.get('context')({messages,type:'context'},ctx);
  Date.now=actualNow;const packet=first.messages.find(message=>message.customType===api.PRESCREEN_TYPE);assert(packet,JSON.stringify(events));
  await hooks.get('before_provider_request')({type:'before_provider_request',payload:{input:api.convertToLlm(first.messages)}},{});
  assert.equal(events.findLast(event=>event.lane==='prescreen'&&event.event==='delivered')?.delivered,true);
  const firstDecisions=decisions;bus.get('coc:source-published')({campaign:'c1'});Date.now=()=>actualNow()+7000+PRESELECT_ALLOWANCE_DEFAULT_MS+1000;
  const second=await hooks.get('context')({messages,type:'context'},ctx);Date.now=actualNow;
  assert(!second.messages.some(message=>message.customType===api.PRESCREEN_TYPE));assert.equal(decisions,firstDecisions);
  assert.equal(events.filter(event=>event.lane==='prescreen'&&event.event==='allowance_started').length,1);
  assert(events.some(event=>event.lane==='prescreen'&&event.event==='skipped'&&event.reason==='turn_budget_exhausted'));
  await hooks.get('session_shutdown')();
});

test('earlier validated material reaches the provider when the next agent decision times out',async t=>{
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='mechanical-test-key';
  t.after(()=>{if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
    if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;globalThis.fetch=oldFetch;});
  globalThis.fetch=async(_url,options)=>{const sent=JSON.parse(options.body);
    if(sent.state.materials?.some(row=>row.label==='Evidence 0'))return new Promise((_,reject)=>{const abort=()=>reject(options.signal.reason??Error('timeout'));
      options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();});
    return Response.json(supportWire(sent,c=>['Evidence 0','Evidence 16'].includes(c.label)?'necessary':'skip'));};
  const candidates=Array.from({length:17},(_,index)=>({key:`graph:${index}`,kind:'graph_entity',label:`Evidence ${index}`,summary:`Evidence ${index}`,
    authority:'module_source',coverage:{status:'complete'},body:`Provider evidence ${index}.`})),view={...snapshot,materials:{version:2,candidates,
      coverage:{graph_entity:{inspected:17,emitted:17,omitted:0,unavailable:0,status:'complete'}}}},hooks=new Map(),bus=new Map(),events=[];
  api.installContextPolicy({on:(key,fn)=>hooks.set(key,fn),events:{on:(key,fn)=>bus.set(key,fn)},getActiveTools:()=>[],getAllTools:()=>[]},event=>events.push(event));
  const call=async(method,params)=>{if(method==='table.capsule')return {...capsule,_context:binding};
    if(method==='table.recall')return params.what==='transcript'?{cards:[],_snapshot:'history'}:{hits:[]};
    if(method==='table.workspace.read')return view;throw Error(`unexpected ${method}`);};
  bus.get('coc:kernel-bridge')({campaign:'c1',call});bus.get('coc:capsule')({capsule,context:binding,epoch:'mixed-provider-input'});
  const projected=await hooks.get('context')({messages:[{role:'user',content:capsule.turn.player_text}],type:'context'},
    {model:{contextWindow:1000000},getSystemPrompt:()=>''}),packet=projected.messages.find(message=>message.customType===api.PRESCREEN_TYPE);
  assert(packet,JSON.stringify(events));const content=JSON.parse(packet.content);
  assert(content.materials.some(row=>row.content==='Provider evidence 0.'));assert(content.gaps.some(row=>row.reason==='loop_timeout'));
  const payload={model:'fixture',input:api.convertToLlm(projected.messages)};await hooks.get('before_provider_request')({type:'before_provider_request',payload},{});
  assert.equal(events.findLast(event=>event.lane==='prescreen'&&event.event==='delivered')?.delivered,true);
  const prepared=events.findLast(event=>event.lane==='prescreen'&&event.event==='prepared');assert.equal(prepared.optional_decision_timeouts,1);assert(prepared.validation_ms>=0);assert(prepared.discovery_ms>=0);assert(prepared.read_ms>=0);
  await hooks.get('session_shutdown')();
});

test('unchanged graph material survives while volatile memory is dropped for refresh',async t=>{
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='mechanical-test-key';let decisions=0,hp=10;
  t.after(()=>{if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
    if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;globalThis.fetch=oldFetch;});
  globalThis.fetch=async(_url,options)=>{decisions++;return Response.json(supportWire(JSON.parse(options.body)));};
  const graphCandidate={key:'graph:archive',kind:'graph_entity',label:'Archive',summary:'Authored archive',authority:'module_source',
    coverage:{status:'complete'},body:'Stable authored archive material.',locator:'scene:Archive'};
  const memoryRoute={key:'read-memory',kind:'memory',label:'Memory',summary:'Memory evidence',authority:'conversation_report',coverage:{status:'partial'},
    method:'memory.evidence',params:{action:'snapshot',query:capsule.turn.player_text,filters:{}}};
  const hooks=new Map(),bus=new Map();api.installContextPolicy({on:(key,fn)=>hooks.set(key,fn),events:{on:(key,fn)=>bus.set(key,fn)},
    getActiveTools:()=>[],getAllTools:()=>[]},()=>{});
  const view=()=>({...snapshot,binding:{...snapshot.binding,stateStamp:`state-${hp}`},materials:{version:2,candidates:[graphCandidate,memoryRoute],
    coverage:{graph_entity:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'},memory:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}});
  const call=async(method,params)=>{
    if(method==='table.capsule')return {...capsule,known:{investigator:{name:'P',hp}},_context:binding};
    if(method==='table.recall')return params.what==='transcript'?{cards:[],_snapshot:'history'}:{hits:[]};
    if(method==='memory.evidence'){
      if(params.action==='snapshot')return {snapshot:'reuse-memory',query:capsule.turn.player_text};
      if(params.action==='page')return {rows:[{alias:'m1',statement:'Old volatile memory.'}],next_offset:null};
      if(params.action==='original')return {alias:'m1',verified:true,context:[{role:'keeper',text:'Old volatile memory.'}],refs:[{version:1}]};
      if(params.action==='finish')return {status:'ready',hits:[{alias:'m1',context:[{role:'keeper',text:'Old volatile memory.'}]}],refs:[{version:1}],coverage:{used:['m1'],omitted:[],unknown:[]}};
    }
    if(method==='table.workspace.read'){
      const result=view();if(params.preselect?.mode==='check')result.materials={version:2,candidates:[],coverage:{},
        check:{status:'current',changed:[],keys:params.preselect.keys,dependencies:['source_revision']}};return result;
    }
    throw Error(`unexpected ${method}`);
  };
  bus.get('coc:kernel-bridge')({campaign:'c1',call});bus.get('coc:capsule')({capsule,context:binding,epoch:'epoch-reuse'});
  const ctx={model:{contextWindow:1000000},getSystemPrompt:()=>''},messages=[{role:'user',content:capsule.turn.player_text}];
  const first=await hooks.get('context')({messages,type:'context'},ctx),firstPacket=JSON.parse(first.messages.find(message=>message.customType===api.PRESCREEN_TYPE).content);
  assert(firstPacket.materials.some(material=>material.kind==='memory'));
  const firstDecisions=decisions;
  await hooks.get('tool_call')({toolName:'apply',toolCallId:'effect',input:{effects:[]}});hp=7;
  await hooks.get('tool_result')({toolName:'apply',toolCallId:'effect',isError:true,details:{}});
  const actualNow=Date.now;Date.now=()=>actualNow()+PRESELECT_ALLOWANCE_DEFAULT_MS+1000;t.after(()=>{Date.now=actualNow;});
  const second=await hooks.get('context')({messages:first.messages,type:'context'},ctx);Date.now=actualNow;
  const secondPacket=JSON.parse(second.messages.find(message=>message.customType===api.PRESCREEN_TYPE).content);
  assert(secondPacket.materials.some(material=>material.content==='Stable authored archive material.'));
  assert(!secondPacket.materials.some(material=>material.kind==='memory'));assert(secondPacket.gaps.some(gap=>gap.reason==='owner_refresh_required'));
  assert.equal(decisions,firstDecisions,'no repeated Jev call for valid graph subset');
  await hooks.get('session_shutdown')();
});

test('same-generation memo rechecks NPC journal revision before provider delivery',async t=>{
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='mechanical-test-key';let revision='npc-v1',note='old journal',decisions=0;
  t.after(()=>{if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
    if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;globalThis.fetch=oldFetch;});
  globalThis.fetch=async(_url,options)=>{decisions++;return Response.json(supportWire(JSON.parse(options.body)));};
  const key='read:["npc","Knott"]',candidate=()=>({key,kind:'npc',label:'Knott',summary:'Current NPC dossier',authority:'current_read',
    coverage:{status:'complete'},data:{name:'Knott',journal:note}}),hooks=new Map(),bus=new Map();
  api.installContextPolicy({on:(name,fn)=>hooks.set(name,fn),events:{on:(name,fn)=>bus.set(name,fn)},getActiveTools:()=>[],getAllTools:()=>[]},()=>{});
  const view=()=>({...snapshot,binding:{...snapshot.binding,npc_revision:revision,memory_revision:'m',records_revision:'r',catalog_revision:'c'},
    materials:{version:2,candidates:[candidate()],coverage:{npc:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}});
  const call=async(method,params)=>{if(method==='table.capsule')return {...capsule,_context:binding};if(method==='table.recall')return params.what==='transcript'?{cards:[],_snapshot:'h'}:{hits:[]};
    if(method==='table.workspace.read'){const current=view();if(params.preselect?.mode==='check'&&params.binding?.npc_revision!==revision)
      return {...current,status:'unverifiable',authority:{checked:false},materials:{version:2,candidates:[],coverage:{},check:{status:'stale',changed:['npc_revision'],keys:[key]}}};return current;}
    throw Error(`unexpected ${method}`);};
  bus.get('coc:kernel-bridge')({campaign:'c1',call});bus.get('coc:capsule')({capsule,context:binding,epoch:'npc-epoch'});
  const ctx={model:{contextWindow:1000000},getSystemPrompt:()=>''},messages=[{role:'user',content:capsule.turn.player_text}];
  const first=await hooks.get('context')({type:'context',messages},ctx);assert.match(first.messages.find(row=>row.customType===api.PRESCREEN_TYPE).content,/old journal/);
  const before=decisions;revision='npc-v2';note='new journal';
  const second=await hooks.get('context')({type:'context',messages:first.messages},ctx),packet=second.messages.find(row=>row.customType===api.PRESCREEN_TYPE);
  assert.match(packet.content,/new journal/);assert.doesNotMatch(packet.content,/old journal/);assert(decisions>before);
  await hooks.get('session_shutdown')();
});

test('independent final checks overlap and stale check advice preserves valid material',async t=>{
  for(const stale of [false,true])await t.test(stale?'stale advice':'concurrent checks',async()=>{
    let optionReads=0;const optionsEntered=Promise.withResolvers(),workspaceEntered=Promise.withResolvers();
    const value={version:1,profiles:[],decisions:[],revision:'options',world_revision:'world',context:{
      _binding:{campaign:'c1',turn:1,worldline:'main',loop:0},declared_action:capsule.turn.player_text,pending_choice:null,session:null}};
    const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,
      record:()=>{},timeoutMs:1000,byteBudget:8192,call:async(method,params)=>{
        if(method==='table.resolve.options'){
          if(++optionReads===2){optionsEntered.resolve();await workspaceEntered.promise;return {...value,world_revision:stale?'changed':'world'};}
          return value;
        }
        assert.equal(method,'table.workspace.read');
        if(params.binding){workspaceEntered.resolve();await optionsEntered.promise;}
        return snapshot;
      }});
    assert(result);const content=JSON.parse(result.content);assert.equal(content.materials[0].content,'Exact archive material.');
    assert.equal(content.check.disposition,stale?'unknown':'no_roll');assert.equal(optionReads,2);
  });
});

test('a focused follow exposes target units already present behind an unopened index',async()=>{
  const graph=(key,label,body)=>({key,kind:'graph_entity',label,summary:label,body,authority:'module_source',coverage:{status:'complete'},
    read:{tool:'lookup',kind:'module',query:label}}),seed=graph('seed','Seed',JSON.stringify({relations:[{kind:'supports',to:'Target'}]})),target=graph('target','Target','Exact target conditions.');
  const candidates=[seed,...Array.from({length:15},(_,index)=>graph(`other-${index}`,`Other ${index}`,'Other source.')),target],
    view={...snapshot,materials:{version:2,candidates,coverage:{}}};
  const followDecision={decide:async batch=>{
    if(!batch.state.materials?.some(row=>row.label==='Seed'))return supportDecision(candidate=>candidate.label==='Seed'?'necessary':'skip').decide(batch);
    const follow=batch.state.operations?.find(row=>row.tool==='follow'&&row.basis?.target==='Target');
    const result=await supportDecision(candidate=>candidate.label==='Target'?'necessary':'skip').decide(batch);
    if(follow)result.answers.operation.choice=follow.alias;return result;
  }};
  const result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision:followDecision,signal:new AbortController().signal,record:()=>{},
    timeoutMs:1000,call:async(method,params)=>method==='table.workspace.read'&&params.preselect?.entity==='Target'
      ?{...view,materials:{...view.materials,candidates:[target]}}:view});
  assert(result);assert(JSON.parse(result.content).materials.some(row=>row.content==='Exact target conditions.'));
});

test('all preparation decisions settle before final owner freshness checks start',async()=>{
  const routeEntered=Promise.withResolvers(),releaseRoute=Promise.withResolvers(),retrievalReady=Promise.withResolvers();let finalChecks=0;
  const options={version:1,profiles:[],decisions:[],revision:'options',world_revision:'world',context:{
    _binding:{campaign:'c1',turn:1,worldline:'main',loop:0},declared_action:capsule.turn.player_text,pending_choice:null,session:null}};
  const delayed={decide:async batch=>{
    if(batch.family==='ordinary-resolve'){routeEntered.resolve();await releaseRoute.promise;}
    const result=await decision.decide(batch);if(batch.family==='keeper-support-agent'&&batch.state.materials.length)retrievalReady.resolve();return result;
  }};
  const pending=api.preparePrescreen({campaign:'c1',binding,capsule,decision:delayed,signal:new AbortController().signal,
    record:()=>{},timeoutMs:1000,call:async(method,params)=>{
      if(method==='table.resolve.options')return options;
      if(params.binding)finalChecks++;return snapshot;
    }});
  try{await routeEntered.promise;await retrievalReady.promise;await new Promise(setImmediate);assert.equal(finalChecks,0);}
  finally{releaseRoute.resolve();}
  assert(await pending);assert.equal(finalChecks,1);
});

test('rule-family materialization retains the owner clauses without a second family lookup',async()=>{
  const family={key:'rule-family',kind:'rule',label:'core-check',summary:'Compiled ordinary check family',authority:'rulebook_read',
    method:'table.lookup',params:{kind:'rule',query:'core-check'},coverage:{status:'partial',omitted:['material_not_read']}},
    body=JSON.stringify({family:'core-check',rules:[{name:'ordinary-check',source_group:[{text:'Exact compiled conditions.'}]}]});
  const methods=[],result=await api.preparePrescreen({campaign:'c1',binding,capsule,decision,signal:new AbortController().signal,record:()=>{},
    call:async(method,params)=>{
      methods.push(method);assert.notEqual(method,'table.lookup');
      return {...snapshot,materials:{version:2,candidates:[params.preselect?.mode==='read'?{...family,body,coverage:{status:'partial',omitted:['family_rule_remainder']}}:family],coverage:{}}};
    }});
  assert.equal(JSON.parse(result.content).materials[0].content,body);
  assert(JSON.parse(result.content).materials[0].coverage.omitted.includes('family_rule_remainder'));assert(!methods.includes('table.lookup'));
});
