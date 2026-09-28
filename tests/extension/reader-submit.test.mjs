import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Agent} from './pi-agent-core.mjs';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import readerSubmit from '../../extensions/module/reader-submit.ts';
import {normalizeSourceDraft} from '../../extensions/module/reader-normalize.ts';
import {readerInput,readerCommand,nativeSourceReaderEnabled} from '../../extensions/module/reader.ts';

const draft={nodes:[{node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:[{page:1}],properties:{is_entrance:true}}],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:[]};
const guidance={opening:'At the dock, who are you?',advice:'Public source premise.',scene:'Dock',guide:'',handoff:'Continue the meeting.'};
const review={checked:[{paths:['/nodes/0'],source_refs:[{page:1}],verdict:'supported'}],missing:[],guidance:{approved:true,issues:[]}};
const json=(path,value)=>writeFile(path,JSON.stringify(value)+'\n');
test('source syntax normalization resolves exact identities and signed zero without changing semantic values',()=>{
 const candidate={nodes:[{node_id:'npc-a',properties:{mechanics:{profile:{derived:{DB:'+0'}}}}}],claims:[],
  critical:['/nodes/npc-a/properties/mechanics','/nodes/0','/nodes/unknown']};
 normalizeSourceDraft(candidate);
 assert.equal(candidate.nodes[0].properties.mechanics.profile.derived.DB,0);
 assert.deepEqual(candidate.critical,['/nodes/0/properties/mechanics','/nodes/0','/nodes/unknown']);
 candidate.nodes[0].properties.mechanics.profile.derived.DB='+1D4';
 candidate.nodes.push(structuredClone(candidate.nodes[0]));candidate.critical=['/nodes/npc-a'];
 normalizeSourceDraft(candidate);
 assert.equal(candidate.nodes[0].properties.mechanics.profile.derived.DB,'+1D4');
 assert.deepEqual(candidate.critical,['/nodes/npc-a'],'ambiguous identities remain for the checker to refuse');
});

test('the actual source submit materializes semantic critical references before checking',async t=>{
 const {tool,see,dir}=await setup(t);see();
 const result=await tool.execute('semantic-critical',{draft:{...draft,critical:['/nodes/scene-dock/properties/is_entrance']},guidance});
 assert.equal(result.terminate,true);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'draft.json'),'utf8')).critical,['/nodes/0/properties/is_entrance']);
});
async function setup(t,reviewing=false,purpose="guidance",extraTask={}){
 const cwd=process.cwd(),dir=await mkdtemp(join(tmpdir(),'coc-submit-'));
 t.after(async()=>{process.chdir(cwd);await rm(dir,{recursive:true,force:true});});
 await json(join(dir,'task.json'),{purpose,...(purpose==='opening'?{opening_batch:true}:{}),module_id:'book-1',source:{page_count:2},known_nodes:[],...(reviewing?{required_review:['/nodes/0']}: {}),...extraTask});
 await json(join(dir,'draft.json'),draft);await json(join(dir,'guidance.json'),guidance);
 process.chdir(dir);const handlers={};let tool;
 await readerSubmit({on(name,fn){handlers[name]=fn},registerTool(value){tool=value},async exec(file,args,options){
  try{return {...await promisify(execFile)(file,args,options),code:0}}catch(error){return {code:error.code,stdout:error.stdout,stderr:error.stderr}}}});
 const see=(pages=[1])=>handlers.context({messages:[{role:'toolResult',content:[{type:'image',data:'AA=='}],details:{kind:'source_pages',observations:pages.map(page=>({page}))}}]});
 const overview=()=>handlers.context({messages:[{role:'toolResult',content:[{type:'image',data:'AA=='}],details:{kind:'source_overview',manifest:{tiles:[{page:1}]}}}]});
 return {tool,see,overview,dir};
}

test('small reader input is supplied up front while oversized input retains file access',()=>{
 assert.match(readerInput({task:{source:{bookmarks:[]}}}),/input_json/);
 assert.match(readerInput({task:'x'.repeat(50000)}),/^Read task.json/);
 const args=readerCommand('xai/grok-4.6','brief','low',true,true);
 assert.ok(args.includes('read,write,edit,bash,pdf,submit_reading'));
 assert.ok(args.some(arg=>arg.endsWith('/build/extensions/module/reader-submit.mjs')));
 assert.ok(!readerCommand(undefined,undefined,undefined,true).some(arg=>arg.endsWith('/reader-submit.mjs')));
});

test('a checked PDF answer can launch the Pi-native source driver with the existing checked tools',()=>{
 const args=readerCommand('grok-build/grok-4.5',undefined,'low',true,true,undefined,undefined,false,false,true);
 assert.ok(args[1].endsWith('/build/runtime/pi-source-reader.mjs'));
 assert.ok(args.includes('--no-extensions'));
 assert.ok(args.includes('read,write,edit,bash,pdf,submit_reading,request_source'));
 assert.ok(args.some(arg=>arg.endsWith('/build/extensions/module/reader-pdf.mjs')));
 assert.ok(args.some(arg=>arg.endsWith('/build/extensions/module/reader-submit.mjs')));
});

test('guidance submission issues the closed top-level draft and review fields before the model calls the tool',async t=>{
 const author=await setup(t,false,'guidance');
 assert.ok(author.tool.parameters.properties.draft.required.includes('node_refs'));
 assert.ok(author.tool.parameters.properties.draft.required.includes('coverage'));
});

test('selected guidance submits only prose and refuses changes to the reviewed scene shard',async t=>{
 const {tool,see,dir}=await setup(t,false,'guidance',{guidance_projection:{scene:'Dock',source_pages:[1]}});
 assert.equal(tool.parameters.properties.draft,undefined);
 assert.equal(tool.parameters.properties.guidance.properties.guide.const,'');
 await assert.rejects(tool.execute('remote-person',{guidance:{...guidance,guide:'A telephone contact'}}),/guide must be empty/);
 await assert.rejects(tool.execute('unseen',{guidance}),/View original physical pages/);
 see();
 assert.equal((await tool.execute('selected',{guidance})).terminate,true);
 await assert.rejects(tool.execute('changed-input',{draft,guidance}),/host-owned selected entrance shard changed/);
 await json(join(dir,'draft.json'),{...draft,nodes:[]});
 await assert.rejects(tool.execute('changed-file',{guidance}),/host-owned selected entrance shard changed/);
});

test('guidance review submission issues its checked and guidance fields',async t=>{
 const reviewer=await setup(t,true,'guidance');
 assert.ok(reviewer.tool.parameters.properties.review.required.includes('checked'));
 assert.ok(reviewer.tool.parameters.properties.review.required.includes('guidance'));
 const checked=JSON.stringify(reviewer.tool.parameters.properties.review.properties.checked);
 assert.match(checked,/\/nodes\/0/);
 assert.doesNotMatch(checked,/\/guidance\/opening/);
});

test('the native source route requires a checked answer or guidance task and an available Jev credential',()=>{
 const answer={source:{pdf:'/bound/source.pdf',cache:'/bound/cache'},prompt:{phase:'read',answer:true}};
 assert.equal(nativeSourceReaderEnabled(answer,{}),false);
 assert.equal(nativeSourceReaderEnabled(answer,{EXT_JEV_APIKEY:'test-only-key'}),true);
 assert.equal(nativeSourceReaderEnabled({...answer,prompt:{phase:'read',guidance:true}},{EXT_JEV_APIKEY:'test-only-key'}),true);
 assert.equal(nativeSourceReaderEnabled({...answer,prompt:{phase:'read'}},{EXT_JEV_APIKEY:'test-only-key'}),false);
 assert.equal(nativeSourceReaderEnabled({...answer,prompt:{phase:'read'},submission:true},{EXT_JEV_APIKEY:'test-only-key'}),true);
 assert.equal(nativeSourceReaderEnabled({...answer,source:undefined},{EXT_JEV_APIKEY:'test-only-key'}),false);
});

test('failed draft and unseen source checks return to repair before a terminating submission',async t=>{
 const {tool,see,dir}=await setup(t);
 await assert.rejects(tool.execute('bad',{draft:{},guidance}),/reading_failed/);
 await assert.rejects(tool.execute('unseen',{draft,guidance}),/View original physical pages/);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'draft.json'),'utf8')),draft);
 see();assert.equal((await tool.execute('fixed',{})).terminate,true);
 await assert.rejects(tool.execute('cancel',{},AbortSignal.abort()),/cancelled/);
});

test('a contact-sheet overview cannot satisfy source-reference evidence',async t=>{
	const {tool,overview}=await setup(t);
	overview();
	await assert.rejects(tool.execute('overview-only',{draft,guidance}),/View original physical pages/);
});

test('public guidance uses the same submission and requires its own original-page evidence',async t=>{
 const {tool,see,dir}=await setup(t,false,'guidance',{public_progress_required:true});
 const fields=Object.fromEntries(['era','starting_place','public_premise','creation_advice'].map(field=>[field,{status:'value',text:'Public '+field,source_refs:[{page:2}]}]));
 see([1]);
 await assert.rejects(tool.execute('missing-fields',{draft,guidance}),/four public_fields/);
 await assert.rejects(tool.execute('unseen-public-source',{draft,guidance,public_fields:fields}),/View original physical pages.*2/);
 see([2]);assert.equal((await tool.execute('public-source-read',{guidance,public_fields:fields})).terminate,true);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'public-fields.json'),'utf8')),fields);
});

test('a required source gap stays retained and returns to retrieval instead of terminating the reader',async t=>{
 const {tool,see,dir}=await setup(t,false,'detail');
 const previous=process.env.PI_COC_READER_SOURCE;process.env.PI_COC_READER_SOURCE=JSON.stringify({file_sha256:'a'.repeat(64)});
 t.after(()=>{if(previous===undefined)delete process.env.PI_COC_READER_SOURCE;else process.env.PI_COC_READER_SOURCE=previous;});
 const need={kind:'source_read',focus:'Dock',question:'Who is the third participant?',reason:'Their identity changes the current interaction.',trigger:'Before the current scene is ready.',source_refs:[{page:1}]};
 const candidate={...draft,ready_nodes:['scene-dock'],source_needs:[need]};
 const pending=await tool.execute('required-gap',{draft:candidate});
 assert.equal(pending.terminate,undefined);assert.equal(pending.details.kind,'source_need_batch');
 const retained=JSON.parse(await readFile(join(dir,'pending-source-needs.json'),'utf8'));
 assert.equal(retained.needs[0].question,need.question);
 see();assert.equal((await tool.execute('candidate-repaired',{draft:{...candidate,source_needs:[]}})).terminate,true);
 assert.equal(JSON.parse(await readFile(join(dir,'pending-source-needs.json'),'utf8')).needs.length,1,'the independent reviewer still receives the original question');
});

test('a host-projected original page counts only after a bound successful request',async t=>{
 const {tool,dir}=await setup(t,false,'guidance');
 const cache=join(dir,'cache');await mkdir(cache);const image=join(cache,'page-1.jpg'),bytes=Buffer.from('original page');await writeFile(image,bytes);
 const sourceSha='a'.repeat(64),digest=createHash('sha256').update(bytes).digest('hex'),log=join(dir,'images.jsonl');
 const before={PI_COC_READER_IMAGES_LOG:process.env.PI_COC_READER_IMAGES_LOG,PI_COC_READER_SOURCE:process.env.PI_COC_READER_SOURCE};
 process.env.PI_COC_READER_IMAGES_LOG=log;process.env.PI_COC_READER_SOURCE=JSON.stringify({pdf:join(dir,'source.pdf'),cache,file_sha256:sourceSha});
 t.after(()=>{for(const [key,value] of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 const page={page:1,path:image,image_sha256:digest,source_sha256:sourceSha,box:[0,0,1,1]};
 await writeFile(log,JSON.stringify({delivery:'attempted',host_pages:[page]})+'\n');
 await assert.rejects(tool.execute('premature',{draft,guidance}),/View original physical pages/);
 await writeFile(log,JSON.stringify({delivery:'succeeded',host_pages:[page]})+'\n');
 assert.equal((await tool.execute('delivered',{draft,guidance})).terminate,true);
});

test('review submission preserves negative findings and refuses unread citations or edited candidates',async t=>{
 const {tool,see,dir}=await setup(t,true);
 await assert.rejects(tool.execute('unseen',{review}),/not supplied/);
 see();const negative={...review,missing:['Necessary fact conflicts with source.'],guidance:{approved:false,issues:['Source conflict.']}};
 assert.equal((await tool.execute('negative',{review:negative})).terminate,true);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'review.json'),'utf8')),negative);
 await json(join(dir,'guidance.json'),{...guidance,opening:'Tampered'});
 await assert.rejects(tool.execute('changed',{review}),/candidate pair/);
});

test('Pi ends a checked submission without a final model request; mixed batches still continue',async t=>{
 const {tool,see}=await setup(t,true);see();
 for(const mixed of [false,true]){
  let requests=0;
  const model={id:'fixture',provider:'fixture',api:'openai-completions'};
  const agent=new Agent({initialState:{model,tools:[tool,{name:'other',description:'Nonterminal test tool',parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'Continue'}],details:{}}}}]},
   streamFn(){const stream=createAssistantMessageEventStream();const first=requests++===0;const message={role:'assistant',model:'fixture',provider:'fixture',api:'openai-completions',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:first?'toolUse':'stop',content:first?[{type:'toolCall',id:'submit',name:'submit_reading',arguments:{review}},...(mixed?[{type:'toolCall',id:'other',name:'other',arguments:{}}]:[])]:[{type:'text',text:'Finished mixed batch'}]};queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end();});return stream;}});
  await agent.prompt('Exercise native completion.');assert.equal(requests,mixed?2:1);assert.equal(agent.state.error,undefined);
 }
});

test('opening submission checks one first scene and permits thin deferred destinations without guidance',async t=>{
 const {tool,see,dir}=await setup(t,false,'opening');see();
 const opening={...draft,ready_nodes:['scene-dock'],nodes:[...draft.nodes,{node_id:'scene-warehouse',node_kind:'scene',name:'Warehouse',source_refs:[{page:1}],properties:{}}]};
 await assert.rejects(tool.execute('too-broad',{draft:{...opening,ready_nodes:['scene-dock','scene-warehouse']}}),/exactly the selected first scene/);
 assert.equal((await tool.execute('first-batch',{draft:opening})).terminate,true);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'draft.json'),'utf8')).ready_nodes,['scene-dock']);
});

test('detail submission checks its scoped delta without imposing the first-opening batch rule',async t=>{
 const {tool,see}=await setup(t,false,'detail',{focus:'Dock and warehouse',question:'Prepare these two adjoining rooms.'});
 const detail={...draft,nodes:[...draft.nodes,{node_id:'scene-warehouse',node_kind:'scene',name:'Warehouse',source_refs:[{page:1}],properties:{}}],ready_nodes:['scene-dock','scene-warehouse']};
 await assert.rejects(tool.execute('unseen',{draft:detail}),/View original physical pages/);
 see();assert.equal((await tool.execute('detail',{draft:detail})).terminate,true);
});

test('first-interaction opening requires the sourced encounter after its entry and rejects deferred current participants',async t=>{
 const {tool,see}=await setup(t,false,'opening',{focus:'Dock',opening_scope:'first_interaction'});
 const encounter={node_id:'scene-warehouse',node_kind:'scene',name:'Warehouse',source_refs:[{page:2}],properties:{}};
 const npc={node_id:'npc-witness',node_kind:'npc',name:'Witness',source_refs:[{page:2}],properties:{}};
 const current={...draft,nodes:[...draft.nodes,encounter,npc],interaction_scene:'scene-warehouse',ready_nodes:['scene-dock','scene-warehouse'],
  claims:[{subject_id:'scene-dock',predicate:'route-to',object:{node_id:'scene-warehouse'},truth_status:'authored-fact',source_refs:[{page:2}]},
   {subject_id:'npc-witness',predicate:'present-in',object:{node_id:'scene-warehouse'},truth_status:'authored-fact',source_refs:[{page:2}]}]};
 see([1,2]);
 await assert.rejects(tool.execute('missing-current-person',{draft:current}),/first interaction depends on/);
 const ready={...current,ready_nodes:[...current.ready_nodes,'npc-witness']};
 await assert.rejects(tool.execute('missing-progression',{draft:{...ready,claims:ready.claims.slice(1)}}),/source-authored route or progression/);
 assert.equal((await tool.execute('complete-first-interaction',{draft:ready})).terminate,true);
});

test('detail coverage submission views every assigned page and preserves negative findings',async t=>{
 const {tool,see,dir}=await setup(t,true,'detail',{required_review:['/coverage'],review_scope_pages:[1,2]});
 see();const findings={checked:[{path:'/coverage',verdict:'unclear',source_refs:[{page:1}],reason:'The route needs more evidence.'}],missing:['A necessary condition remains unclear.']};
 await assert.rejects(tool.execute('partial',{review:findings}),/did not view every assigned source page/);
 see([2]);assert.equal((await tool.execute('complete',{review:findings})).terminate,true);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'review.json'),'utf8')),findings);
 await json(join(dir,'draft.json'),{...draft,changed:true});
 await assert.rejects(tool.execute('changed',{review:findings}),/candidate pair/);
});

test('source answer submission checks the bounded artifact and requires original-page evidence',async t=>{
 const {tool,see,overview}=await setup(t,false,'answer');
 const answer={status:'answered',answer:'The source describes a harbor.',source_refs:[{page:1}],limitations:''};
 overview();await assert.rejects(tool.execute('navigation',{draft:answer}),/View original physical pages/);
 see();assert.equal((await tool.execute('answer',{draft:answer})).terminate,true);
 await assert.rejects(tool.execute('graph',{draft:{...answer,nodes:[]}}),/exactly.*fields/);
});

test('opening review can terminate with required source evidence without a guidance document',async t=>{
 const {tool,see}=await setup(t,true,'opening');see();
 const result=await tool.execute('review',{review:{checked:review.checked,missing:[]}});
 assert.equal(result.terminate,true);assert.equal(result.details.phase,'review');
 await assert.rejects(tool.execute('unread',{review:{checked:[{path:'/nodes/0',source_refs:[{page:2}],verdict:'supported'}],missing:[]}}),/page not supplied/);
});

test('opening identity mismatches are rejected before expensive review, using kernel name and handle rules',async t=>{
 const {tool,see,dir}=await setup(t,false,'opening');see();
 const batch={...draft,nodes:[{...draft.nodes[0],name:'Dock — an expanded title'}],ready_nodes:['scene-dock']};
 const packet=JSON.parse(await readFile(join(dir,'task.json'),'utf8'));
 const focus=name=>json(join(dir,'task.json'),{...packet,focus:name});
 await focus('Selected Dock');
 await assert.rejects(tool.execute('mismatch',{draft:batch}),/preserve the selected opening/);
 for(const name of ['dock','scene-dock','Dock — an expanded title']){await focus(name);assert.equal((await tool.execute('matched',{draft:batch})).terminate,true);}
 batch.nodes[0].properties={...batch.nodes[0].properties,runtime_projection:{record:{scene_id:'selected-dock'}}};
 await focus('selected-dock');assert.equal((await tool.execute('handle',{draft:batch})).terminate,true);
});


test('the first scene cannot be submitted while its present NPC still requires detail reading',async t=>{
 const {tool,see}=await setup(t,false,'opening');see();
 const batch={...draft,nodes:[...draft.nodes,{node_id:'npc-witness',node_kind:'npc',name:'Witness',source_refs:[{page:1}],properties:{}}],
  claims:[{subject_id:'npc-witness',predicate:'present-in',object:{node_id:'scene-dock'},truth_status:'authored-fact',source_refs:[{page:1}]}],ready_nodes:['scene-dock']};
 await assert.rejects(tool.execute('incomplete',{draft:batch}),/first interaction depends on/);
 batch.ready_nodes.push('npc-witness');assert.equal((await tool.execute('ready',{draft:batch})).terminate,true);
});
