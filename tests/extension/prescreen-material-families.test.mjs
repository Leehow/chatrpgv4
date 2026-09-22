import {supportDecision,supportWire,supportChoices} from './support-agent-helpers.mjs';
/**
 * Request-boundary regression tests for §124 material families.
 *
 * These use scripted bounded selection only to choose named real-owner candidates. They are
 * component tests of kernel -> context -> converted provider payload, not live play, Keeper
 * semantic-quality evidence, or a substitute for the canonical A/B.
 */
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=resolve(import.meta.dirname,'../..');
await mkdir(join(root,'.tmp'),{recursive:true});
const buildRoot=await mkdtemp(join(root,'.tmp/prescreen-material-families-'));
after(()=>rm(buildRoot,{recursive:true,force:true}));
await build({stdin:{contents:`
export * from './extensions/table/context-policy.ts';
export * from './extensions/table/context-runtime.ts';
export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {convertToLlm} from './node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js';
`,resolveDir:root,sourcefile:'prescreen-material-families-api.ts'},outfile:join(buildRoot,'api.mjs'),
  bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
const api=await import(pathToFileURL(join(buildRoot,'api.mjs')).href);

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const asObject=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
function contains(value,expected,seen=new Set()){
  if(typeof value==='string')return value===expected||value.includes(expected);
  if(!value||typeof value!=='object'||seen.has(value))return false;seen.add(value);
  return (Array.isArray(value)?value:Object.values(value)).some(child=>contains(child,expected,seen));
}

async function openCampaign(t,id){
  const home=await mkdtemp(join(buildRoot,`${id}-`));
  const kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:`family-${id}`,
    locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  const runtime=api.createKernelRuntime(kernel);t.after(async()=>{await runtime.close();await rm(home,{recursive:true,force:true});});
  const call=(method,params={})=>runtime.handlers[method]({campaign:id,...params});
  await call('campaign.create',{id,module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  await call('table.open');
  return {call};
}

async function requestMaterials(t,table,query,select){
  const opened=await table.call('table.open'),input=await table.call('table.player_input',{text:query}),capsuleResult=await table.call('table.capsule',{rehydrate:true});
  const {_context,...capsule}=capsuleResult,hooks=new Map(),bus=new Map(),events=[];
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='request-boundary-test-key';
  globalThis.fetch=async(_url,options)=>{
    return Response.json(supportWire(JSON.parse(options.body),candidate=>select(candidate)?'necessary':'skip'));
  };
  api.installContextPolicy({on:(name,fn)=>hooks.set(name,fn),events:{on:(name,fn)=>bus.set(name,fn)},getActiveTools:()=>[],getAllTools:()=>[]},event=>events.push(event));
  bus.get('coc:kernel-bridge')({campaign:opened.campaign?.id??capsuleResult._context.campaign,call:table.call});
  bus.get('coc:table-open')({campaign:capsuleResult._context.campaign,open:opened});
  bus.get('coc:capsule')({capsule,context:_context,epoch:input.epoch??`${_context.campaign}:${_context.turn}`});
  try{
    const projected=await hooks.get('context')({type:'context',messages:[{role:'user',content:query}]},
      {model:{contextWindow:1_000_000},getSystemPrompt:()=>''});
    const packet=projected.messages.find(message=>message.customType===api.PRESCREEN_TYPE);
    assert(packet,`no prescreen packet: ${JSON.stringify(events)}`);
    const payload={model:'fixture',input:api.convertToLlm(structuredClone(projected.messages))};
    assert(contains(payload,String(packet.content)),'the exact packet content reaches the converted provider payload');
    await hooks.get('before_provider_request')({type:'before_provider_request',payload},{});
    const delivered=events.findLast(event=>event.lane==='prescreen'&&event.event==='delivered');
    assert.equal(delivered?.delivered,true,JSON.stringify(events));
    return {packet,content:JSON.parse(packet.content),payload,events};
  }finally{
    await hooks.get('session_shutdown')();
    if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
    if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;
    globalThis.fetch=oldFetch;
  }
}

test('real material owners reach the converted Keeper request with semantic provenance',async t=>{
  await t.test('graph material and committed history carry actual bodies and bound revisions',async t=>{
    const table=await openCampaign(t,'families-graph-record');
    await table.call('table.player_input',{text:'I accept the commission and ask for its terms.'});
    await table.call('table.narrate',{call_id:'t1-c1',text:'{{say:Steven Knott}}The signed commission names the Corbitt House and twenty dollars per day.{{/say}}'});
    const result=await requestMaterials(t,table,"What did Knott offer, and where does his office lead?",candidate=>
      candidate.kind==='committed_record'||candidate.kind==='graph_entity'&&(candidate.label==="Knott's Office"||candidate.label.startsWith("Knott's Office —")));
    const record=result.content.materials.find(row=>row.kind==='committed_record'),graph=result.content.materials.find(row=>row.kind==='graph_entity');
    assert(record,'real committed history was not delivered');assert(graph,'real graph material was not delivered');
    const recordBody=JSON.parse(record.content);assert.equal(record.authority,'table_record');assert.equal(recordBody.turn,1);
    assert.match(recordBody.keeper,/signed commission names the Corbitt House/);assert.equal(recordBody.speech[0].who.name,'Steven Knott');
    const graphBody=JSON.parse(graph.content);assert.equal(graph.authority,'module_source');assert.equal(graphBody.entity.name,'commission-briefing');
    const units=result.content.materials.filter(row=>row.kind==='graph_entity'&&row.provenance?.locator===graph.provenance?.locator).map(row=>JSON.parse(row.content));
    assert(units.some(unit=>unit.authored),'actual authored content accompanies the identity');
    const relationUnit=units.find(unit=>unit.relations);assert(relationUnit,JSON.stringify({labels:result.content.materials.map(row=>row.label),trace:result.packet.details.prescreen.loop_trace}));
    const relations=Array.isArray(relationUnit.relations)?relationUnit.relations:Object.values(relationUnit.relations);
    assert(relations.some(relation=>relation.to==='newspaper-morgue'),'the real authored office exit is delivered');
    assert.equal(JSON.stringify(units).includes('source_refs'),false);
    assert.equal(typeof graph.provenance?.locator,'string');
    const meta=result.packet.details.prescreen,binding=meta.binding,graphIndex=result.content.materials.indexOf(graph),graphKey=meta.material_keys[graphIndex];
    assert(hash(binding.source_revision));assert(hash(binding.records_revision));assert.ok(Array.isArray(meta.refs[graphKey])&&meta.refs[graphKey].length>0);
    assert.equal(JSON.stringify(result.payload).includes(binding.source_revision),false,'host source hashes stay out of the provider payload');
  });

  await t.test('rule clauses and dependency groups reach the final request as actual rule material',async t=>{
    const table=await openCampaign(t,'families-rule');
    const result=await requestMaterials(t,table,'rule:coc7:combat:armor-reduction',candidate=>candidate.kind==='rule_clause');
    const rules=result.content.materials.filter(row=>row.kind==='rule_clause');assert(rules.length>0,'no real rule clause reached the request');
    const material=rules.find(row=>{try{return JSON.parse(row.content).source_group?.length;}catch{return false;}});assert(material);
    const body=JSON.parse(material.content);assert.ok(body.source_group.length>0);assert.ok(Array.isArray(body.relations));
    assert.equal(material.authority,'rules_source');assert.equal(typeof material.provenance?.locator,'string');
    assert.ok(material.coverage.projection==='rule_dependency_group'||material.coverage.omitted?.includes('rule_dependency_group'));
    assert(hash(result.packet.details.prescreen.binding.rules_revision));
  });

  await t.test('printed catalog discovery reaches the request without creating an object instance',async t=>{
    const table=await openCampaign(t,'families-catalog');
    const result=await requestMaterials(t,table,'.45 Automatic',candidate=>candidate.kind==='catalog_record'&&candidate.label==='.45 Automatic');
    const catalog=result.content.materials.find(row=>row.kind==='catalog_record'&&row.label==='.45 Automatic');assert(catalog,'catalog row was not delivered');
    assert.equal(catalog.content.name,'.45 Automatic');assert.equal(catalog.content.source.table,'equipment.json');assert.equal(catalog.authority,'rulebook_read');
    assert.equal(result.content.materials.some(row=>row.kind==='object'&&/\.45 Automatic/.test(row.label)),false,'catalog discovery must not invent possession');
    assert(hash(result.packet.details.prescreen.binding.catalog_revision));
  });

  await t.test('current investigator, NPC, object and session reads reach one final request',async t=>{
    const table=await openCampaign(t,'families-current');
    await table.call('table.player_input',{text:'I arrange the interview materials.'});
    const definition={name:'Interview ledger',category:'item',description:'A ruled ledger for signed interview notes.',basis:'Deterministic request-boundary fixture.',
      parameters:{effects:[]},player_view:{description:'A ruled interview ledger.',fields:[]}};
    const creator=await table.call('mods.job',{role:'create',input:{name:definition.name,category:definition.category,description:definition.description}});
    assert.equal(creator.enabled,true);await writeFile(join(creator.cwd,'result.json'),JSON.stringify(definition));
    const accepted=await table.call('mods.accept',{job:creator.job});
    await table.call('table.apply',{call_id:'t1-c1',effects:[
      {kind:'npc',name:'Steven Knott',to:'here',why:'he is present for the interview'},
      {kind:'define',name:'Interview ledger',category:'item',_definition:accepted.definition,_provenance:accepted.provenance},
      {kind:'object',name:'Knott interview ledger',definition:'Interview ledger',to:'here'}]});
    await table.call('table.narrate',{call_id:'t1-c2',text:'Knott and the ledger are ready for review.'});
    const result=await requestMaterials(t,table,'Review Steven Knott, the interview ledger, my investigator sheet, and the active session.',candidate=>
      candidate.kind==='investigator'||candidate.kind==='session'||candidate.kind==='npc'&&candidate.label==='Steven Knott'
        ||candidate.kind==='object'&&candidate.label.startsWith('Knott interview ledger'));
    const byKind=kind=>result.content.materials.find(row=>row.kind===kind),investigator=byKind('investigator'),npc=byKind('npc'),object=byKind('object'),session=byKind('session');
    assert(investigator&&npc&&object&&session,JSON.stringify(result.content));
    assert.equal(investigator.content.kind,'investigator');assert.equal(investigator.content.name,'托马斯·海斯');assert.equal(investigator.content.hp,12);
    assert.equal(npc.content.kind,'npc');assert.equal(npc.content.name,'Steven Knott');assert.ok(npc.content.scene);
    assert.equal(object.content.definition.name,'Interview ledger');assert.equal(object.content.instance.name,'Knott interview ledger');assert.ok(object.content.instance.owner);
    assert.deepEqual(Object.keys(session.content).sort(),['pending_choice','session']);assert.equal(session.content.pending_choice,null);
    assert(hash(result.packet.details.prescreen.binding.npc_revision));assert(hash(result.packet.details.prescreen.binding.memory_revision));
  });

  await t.test('memory preserves speaker, turn, line and correction status while private identities stay hidden',async t=>{
    const table=await openCampaign(t,'families-memory');
    const wrong={kind:'knowledge',subject:'Thomas Hayes',knowers:[],entities:['Steven Knott'],statement:'The house belongs to Thomas Hayes.',
      privacy:'keeper_only',state:'accurate'};
    const correction={kind:'keeper_correction',subject:'keeper',knowers:[],entities:['Steven Knott'],statement:'The previous ownership claim has no support and is withdrawn.',
      privacy:'keeper_only',state:'accurate'};
    await table.call('table.narrate',{call_id:'t0-c1',text:wrong.statement});
    let job=await table.call('memory.job',{turn:0});await table.call('memory.submit',{job_id:job.job_id,candidates:[wrong]});
    await table.call('table.player_input',{text:'Clarify the ownership account.'});
    await table.call('table.narrate',{call_id:'t1-c1',text:correction.statement});
    job=await table.call('memory.job',{turn:1});const target=job.correction_targets.find(row=>row.statement===wrong.statement);assert(target);
    await table.call('memory.submit',{job_id:job.job_id,candidates:[{...correction,corrects:[{subject:target.subject,statement:target.statement}]}]});
    await table.call('table.player_input',{text:'I ask Knott to repeat his promised fee.'});
    await table.call('table.narrate',{call_id:'t2-c1',text:'{{say:Steven Knott}}I will pay twenty dollars per day.{{/say}}'});
    job=await table.call('memory.job',{turn:2});const investigator=job.investigators[0].name;
    await table.call('memory.submit',{job_id:job.job_id,candidates:[{kind:'promise',subject:'Steven Knott',entities:[investigator],knowers:[investigator,'Steven Knott'],
      statement:'I will pay twenty dollars per day.',privacy:'player_safe',state:'accurate'}]});
    const result=await requestMaterials(t,table,'Which ownership claim was withdrawn, and what fee did Steven Knott promise?',candidate=>candidate.kind==='memory');
    const memories=result.content.materials.filter(row=>row.kind==='memory');assert(memories.length>=2,JSON.stringify(result.content));
    const corrected=memories.find(row=>row.content.entry?.kind==='keeper_correction'),promise=memories.find(row=>row.content.entry?.kind==='promise');
    assert(corrected&&promise,JSON.stringify(memories));
    assert.equal(corrected.content.entry.status,'candidate');assert.equal(corrected.content.original.turn,1);assert.equal(corrected.content.original.line,'main');
    assert(corrected.content.context.some(row=>row.role==='keeper'&&row.text.includes(correction.statement)));assert.equal(corrected.content.assessment.applicability,'unknown');
    assert.equal(promise.content.entry.kind,'promise');
    assert.equal(promise.content.original.turn,2);assert.equal(promise.content.original.line,'main');
    const spoken=promise.content.context.find(row=>row.role==='keeper');assert(spoken);assert.ok(spoken.speakers.some(row=>row.name==='Steven Knott'&&row.kind==='npc'));
    for(const memory of memories){const text=JSON.stringify(memory);assert.equal(text.includes('"ref"'),false);assert.equal(text.includes('"refs"'),false);assert.equal(text.includes('"commit"'),false);}
    assert(hash(result.packet.details.prescreen.binding.memory_revision));
  });
});
