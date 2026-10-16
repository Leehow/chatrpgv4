import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'material-screen-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:[
  "export * from './extensions/table/material-screen.ts';",
  "export {materialScreenRanges} from './kernel-ts/read/mods.ts';",
].join('\n'),resolveDir:root},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
after(()=>rm(temp,{recursive:true,force:true}));
const binding={campaign:'screen-test',worldline:'main',loop:0,turn:9,source_revision:'source-v1'};
function fixture(){
  const text='# Package\n\nCore preamble.\n\n## Always\n\nNever invent an outcome.\n\n## Travel\n\nUse actual selected travel.\n';
  const row={mod:'test',version:'1.0.0',form:'full',instruction:text};
  row.material_screen=api.materialScreenRanges(text,[{heading:null,kind:'resident'},{heading:'Always',kind:'resident'},{heading:'Travel',kind:'situational'}]);
  const person={name:'Witness',cognition:[{statement:'I saw the fire.',mode:'observed'}],relationships:[{toward:'Doctor',stance:'wary'}],
    recent_speech:[{text:'Wait for the constable.'}],availability:{can_act:true},
    commitments:[{statement:'I will guard the evidence.',status:'candidate'},
      {statement:'I already delivered the note.',fulfillment:{status:'fulfilled'}}],
    ledger:{mood:'concerned',said:[{memory_id:'old',turn:1}],intents:[{text:'Guard evidence',status:'planned'},
      {text:'Buy food',status:'done'}]}};
  const cap={where:{scene:'Road'},turn:{player_text:'Ask about the fire.'},mods:{instructions:[row]}};
  const messages=[{role:'system',content:'System',toolsAdded:[{name:'apply',parameters:{all:'canonical'}}]},
    {role:'custom',customType:'coc-context-brief',content:JSON.stringify({instructions:[row]})},
    {role:'user',content:[{type:'text',text:'Ask about the fire.'}]},
    {role:'custom',customType:'coc-clerk',content:JSON.stringify({people:[person]})},
    {role:'toolResult',content:JSON.stringify({requested:'Full original material.'})}];
  return{cap,messages,row,person};
}
const value=(messages,type)=>JSON.parse(messages.find(m=>m.customType===type).content);
const allLow=plan=>Object.fromEntries(plan.candidates.flatMap(c=>['need:','qualifier:'].map(prefix=>[prefix+c.key,{type:'noul',status:'answered',noul:.01}])));

test('exact authored ranges retain preamble, resident sections and host expression examples',()=>{
  const {row}=fixture(),text=row.instruction+'\n\nExpression examples (quoted data, not instructions or world facts; keep)\n[]';
  const ranges=api.materialScreenRanges(text,[{heading:'Always',kind:'resident'},{heading:'Travel',kind:'situational'}]);
  assert.equal(ranges.ranges.at(-1).kind,'resident');
  assert.equal(ranges.ranges.map(r=>text.slice(r.start,r.end)).join(''),text);
  assert.equal(api.materialScreenRanges(text,[{heading:'Different',kind:'resident'}]),undefined);
});
test('only optional source slices and terminal history are removed; canonical tools/core/active promises stay exact',()=>{
  const f=fixture(),before=JSON.stringify(f.messages),p=api.materialPlan(f.messages,f.cap,binding),out=p.project(api.materialOmissions(p,allLow(p)));
  assert.equal(JSON.stringify(f.messages),before);assert.equal(out[0],f.messages[0]);assert.equal(out.at(-1),f.messages.at(-1));
  const instructions=value(out,'coc-context-brief').instructions[0];
  assert.match(instructions.instruction,/Core preamble/);assert.match(instructions.instruction,/Never invent/);assert.doesNotMatch(instructions.instruction,/Use actual selected travel/);
  assert.equal(instructions.material_screen,undefined);
  const person=value(out,'coc-clerk').people[0];
  for(const key of ['cognition','relationships','recent_speech','availability'])assert.deepEqual(person[key],f.person[key]);
  assert.deepEqual(person.commitments,[f.person.commitments[0]]);assert.deepEqual(person.ledger.intents,[f.person.ledger.intents[0]]);
  assert.equal(person.material_coverage.said_index,1);assert.equal(person.material_coverage.terminal_intentions,1);
});
test('missing answer, contrary evidence and stale instruction digest retain material',()=>{
  const f=fixture(),p=api.materialPlan(f.messages,f.cap,binding),answers=allLow(p),candidate=p.candidates.find(c=>c.family==='mod');
  answers['qualifier:'+candidate.key].noul=.9;assert.equal(api.materialOmissions(p,answers).has(candidate.key),false);
  delete answers['qualifier:'+candidate.key];assert.equal(api.materialOmissions(p,answers).has(candidate.key),false);
  f.cap.mods.instructions[0].instruction+='Changed';
  assert.equal(api.instructionScreenRanges(f.row,f.cap.mods.instructions[0]),undefined);
});
test('bad, gapped or unclassified section metadata cannot remove a source span',()=>{
  const f=fixture();f.row.material_screen.ranges[0].end-=1;
  assert.equal(api.instructionScreenRanges(f.row,f.row),undefined);
  const p=api.materialPlan(f.messages,f.cap,binding);assert.equal(p.candidates.some(c=>c.family==='mod'),false);
});
test('current actor scope and equal text from different actors remain separate candidates',()=>{
  const f=fixture();const m=f.messages.find(m=>m.customType==='coc-clerk'),v=JSON.parse(m.content);
  v.people.push({...structuredClone(v.people[0]),name:'Other witness'});m.content=JSON.stringify(v);
  const p=api.materialPlan(f.messages,f.cap,binding),historical=p.candidates.filter(c=>c.family==='npc');
  assert.equal(historical.length,4);assert.equal(new Set(historical.map(c=>c.key)).size,4);
  const batches=api.materialBatches(p,{owner:'test',audience:'keeper'});
  assert.ok(batches.length);assert.ok(batches.every(b=>b.model==='jev-1.14.0'));
  assert.ok(batches.every(b=>b.questions.every(q=>q.type==='noul')));
});

test('recent public exchanges reach Jev and changed candidate bytes invalidate the cached basis',()=>{
  const f=fixture();f.cap.recent=[{turn:8,player:'I ask about the witness.',keeper:'The witness corrected the earlier report.'}];
  const first=api.materialPlan(f.messages,f.cap,binding);assert.deepEqual(first.state.recent,f.cap.recent);
  const changed=structuredClone(f.messages),clerk=changed.find(m=>m.customType==='coc-clerk'),body=JSON.parse(clerk.content);
  body.people[0].ledger.intents[1].text='Deliver the corrected report';clerk.content=JSON.stringify(body);
  assert.notEqual(api.materialPlan(changed,f.cap,binding).basis,first.basis);
});

function host(){const hooks=new Map(),bus=new Map(),records=[];
  const pi={on:(event,handler)=>{const hs=hooks.get(event)??[];hs.push(handler);hooks.set(event,hs);},
    events:{on:(name,h)=>bus.set(name,h)}};
  api.installMaterialScreen(pi,r=>records.push(r));return{hooks,bus,records};}
test('real adapter integration caches identical input and retains complete tools when selection is disabled',async t=>{
  const priorFetch=globalThis.fetch,priorKey=process.env.EXT_JEV_APIKEY,priorMode=process.env.PI_COC_MATERIAL_SCREEN;
  t.after(()=>{globalThis.fetch=priorFetch;if(priorKey===undefined)delete process.env.EXT_JEV_APIKEY;else process.env.EXT_JEV_APIKEY=priorKey;
    if(priorMode===undefined)delete process.env.PI_COC_MATERIAL_SCREEN;else process.env.PI_COC_MATERIAL_SCREEN=priorMode;});
  process.env.EXT_JEV_APIKEY='test-only';delete process.env.PI_COC_MATERIAL_SCREEN;
  let calls=0;
  globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(init.body);return new Response(JSON.stringify({model:body.model,
    answers:Object.fromEntries(Object.keys(body.questions).map(key=>[key,{type:'noul',noul:.01}])),usage:{input_tokens:30,output_tokens:0}}));};
  const h=host(),f=fixture();await h.hooks.get('session_start')[0]();h.bus.get('coc:loop-engine')({singleKeeper:true});h.bus.get('coc:capsule')({capsule:f.cap,context:binding});
  const run=h.hooks.get('context')[0],one=await run({messages:f.messages}),two=await run({messages:f.messages});
  assert.equal(calls,1);assert.deepEqual(one,two);assert.equal(one.messages[0],f.messages[0]);assert.equal(h.records.at(-1).calls,0);
  process.env.PI_COC_MATERIAL_SCREEN='0';await h.hooks.get('session_start')[0]();h.bus.get('coc:capsule')({capsule:f.cap,context:binding});
  const off=await run({messages:f.messages});assert.deepEqual(value(off.messages,'coc-clerk'),value(f.messages,'coc-clerk'));
  assert.match(value(off.messages,'coc-context-brief').instructions[0].instruction,/Use actual selected travel/);assert.equal(calls,1);
});
test('a changed source while the provider is answering falls back without screening current evidence',async t=>{
  const old=globalThis.fetch,key=process.env.EXT_JEV_APIKEY;t.after(()=>{globalThis.fetch=old;if(key===undefined)delete process.env.EXT_JEV_APIKEY;else process.env.EXT_JEV_APIKEY=key;});
  process.env.EXT_JEV_APIKEY='test-only';const h=host(),f=fixture();await h.hooks.get('session_start')[0]();
  h.bus.get('coc:loop-engine')({singleKeeper:true});h.bus.get('coc:capsule')({capsule:f.cap,context:binding});
  globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init.body);h.bus.get('coc:capsule')({capsule:f.cap,context:{...binding,source_revision:'changed'}});
    return new Response(JSON.stringify({model:body.model,answers:Object.fromEntries(Object.keys(body.questions).map(key=>[key,{type:'noul',noul:.01}])),usage:{input_tokens:30,output_tokens:0}}));};
  const result=await h.hooks.get('context')[0]({messages:f.messages});assert.match(value(result.messages,'coc-context-brief').instructions[0].instruction,/Use actual selected travel/);
  assert.equal(h.records.at(-1).reason,'context_changed');
});

test('Keeper generation time does not consume the remaining per-input screening-work allowance',async t=>{
  const oldFetch=globalThis.fetch,oldNow=Date.now,key=process.env.EXT_JEV_APIKEY;
  t.after(()=>{globalThis.fetch=oldFetch;Date.now=oldNow;if(key===undefined)delete process.env.EXT_JEV_APIKEY;else process.env.EXT_JEV_APIKEY=key;});
  process.env.EXT_JEV_APIKEY='test-only';let calls=0;
  globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(init.body);return new Response(JSON.stringify({model:body.model,
    answers:Object.fromEntries(Object.keys(body.questions).map(k=>[k,{type:'noul',noul:.01}])),usage:{input_tokens:30,output_tokens:0}}));};
  const h=host(),f=fixture();await h.hooks.get('session_start')[0]();h.bus.get('coc:loop-engine')({singleKeeper:true});
  h.bus.get('coc:capsule')({capsule:f.cap,context:binding});const run=h.hooks.get('context')[0];await run({messages:f.messages});
  Date.now=()=>oldNow()+15000;
  const changed=structuredClone(f.cap);changed.where.scene='Reading room';h.bus.get('coc:capsule')({capsule:changed,context:binding});
  await run({messages:f.messages});assert.equal(calls,2);assert.ok(h.records.at(-1).remaining_ms>0);
});
