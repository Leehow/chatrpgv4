import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Agent} from './pi-agent-core.mjs';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import {Check} from 'typebox/value';
import readerSubmit from '../../extensions/module/reader-submit.ts';
import {normalizeSourceDraft} from '../../extensions/module/reader-normalize.ts';
import {readerInput,readerCommand,nativeSourceReaderEnabled} from '../../extensions/module/reader.ts';

const draft={nodes:[{node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:[{page:1}],properties:{is_entrance:true}}],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:[]};
const guidance={opening:'At the dock, who are you?',advice:'Public source premise.',scene:'Dock',guide:'',handoff:'Continue the meeting.'};
const review={checked:[{paths:['/nodes/0'],source_refs:[{page:1}],verdict:'supported'}],missing:[],guidance:{approved:true,issues:[]}};
const json=(path,value)=>writeFile(path,JSON.stringify(value)+'\n');
async function submitSaved(tool,dir,id,values,signal){
 for(const [key,value] of Object.entries(values))await json(join(dir,key==='public_fields'?'public-fields.json':key+'.json'),value);
 return tool.execute(id,{},signal);
}
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
 const result=await submitSaved(tool,dir,'semantic-critical',{draft:{...draft,critical:['/nodes/scene-dock/properties/is_entrance']},guidance});
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

test('inline navigation references fail at their field before replacing the saved draft',async t=>{
 const {tool,dir}=await setup(t,false,'index');
 const before=await readFile(join(dir,'draft.json'));
 const navigation={sections:[{name:'Opening',pages:[[1,2]],source_refs:['physical page 1']}]};
 await assert.rejects(tool.execute('malformed-reference',{draft:navigation}),/sections\[0\]\.source_refs\[0\].*object.*page/);
 assert.deepEqual(await readFile(join(dir,'draft.json')),before,'an invalid inline reference must not overwrite the saved artifact');
 const corrected={sections:[{...navigation.sections[0],source_refs:[{page:1}]}]};
 assert.equal((await tool.execute('corrected-reference',{draft:corrected})).terminate,true);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'draft.json'),'utf8')),corrected);
});

test('the index submission schema describes optional bounded original-page reference objects',async t=>{
 const {tool}=await setup(t,false,'index');
 const wire=JSON.parse(JSON.stringify(tool.parameters));
 const schemas=[wire];
 while(schemas.length){
  const value=schemas.pop();
  if(!value||typeof value!=='object')continue;
  if(Object.hasOwn(value,'items'))assert.equal(Array.isArray(value.items),false,'the provider rejects array-valued items before it can call the index tool');
  schemas.push(...Object.values(value));
 }
 const section={name:'Opening',pages:[[1,2]]};
 assert.equal(Check(tool.parameters,{draft:{sections:[section]}}),true,'omitted references retain the native full-range fallback');
 for(const pages of [[],[1,2],[[1]],[[1,2,3]],[[0,1]],[[-1,2]],[[1.5,2]],[['1',2]]]){
  assert.equal(Check(tool.parameters,{draft:{sections:[{...section,pages}]}}),false,`invalid page-pair shape ${JSON.stringify(pages)}`);
 }
 for(const source_refs of [[],[{page:1,note:'Observed heading'}]]){
  assert.equal(Check(tool.parameters,{draft:{sections:[{...section,source_refs}]}}),true);
 }
 for(const source_refs of [null,'page 1',[1],['page 1'],[null],[{}],[{page:'1'}],[{page:0}],[{page:1.5}],[{page:3}]]){
  assert.equal(Check(tool.parameters,{draft:{sections:[{...section,source_refs}]}}),false,`invalid reference shape ${JSON.stringify(source_refs)}`);
 }
});

for(const written of [false,true])test(`malformed ${written?'file-backed':'inline'} index references preserve the artifact for correction`,async t=>{
 const {tool,dir}=await setup(t,false,'index');
 const valid={sections:[{name:'Opening',pages:[[1,2]],source_refs:[{page:1,note:'Observed heading'}]}]};
 await json(join(dir,'draft.json'),valid);
 for(const source_refs of [null,'page 1',[1],['page 1'],[null],[{}],[{page:'1'}],[{page:0}],[{page:1.5}],[{page:3}]]){
  const invalid={sections:[{...valid.sections[0],source_refs}]};
  if(written)await json(join(dir,'draft.json'),invalid);
  const before=await readFile(join(dir,'draft.json'));
  await assert.rejects(tool.execute('invalid-reference',written?{}:{draft:invalid}),/sections\[0\]\.source_refs/);
  assert.deepEqual(await readFile(join(dir,'draft.json')),before,'failed submission leaves the retained file unchanged');
 }
 for(const source_refs of [undefined,[],[{page:1,note:'Observed heading'}]]){
  const section={...valid.sections[0]};if(source_refs===undefined)delete section.source_refs;else section.source_refs=source_refs;
  const corrected={sections:[section]};
  assert.equal((await tool.execute('corrected-reference',{draft:corrected})).terminate,true);
  assert.deepEqual(JSON.parse(await readFile(join(dir,'draft.json'),'utf8')),corrected);
 }
 await assert.rejects(tool.execute('cancelled-reference',{draft:valid},AbortSignal.abort()),/cancelled/);
});

for(const written of [false,true])test(`the same Pi loop corrects ${written?'file-backed':'inline'} navigation references before terminating`,async t=>{
 const {tool,dir}=await setup(t,false,'index');
 const invalid={sections:[{name:'Opening',pages:[[1,2]],source_refs:['physical page 1']}]};
 if(written)await json(join(dir,'draft.json'),invalid);
 const corrected={sections:[{...invalid.sections[0],source_refs:[{page:1,note:'Observed heading'}]}]};
 let requests=0;const model={id:'fixture',provider:'fixture',api:'openai-completions'};
 const agent=new Agent({initialState:{model,tools:[tool]},streamFn(){
  const stream=createAssistantMessageEventStream(),first=requests++===0;
  const message={role:'assistant',model:'fixture',provider:'fixture',api:'openai-completions',timestamp:Date.now(),
   usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'toolUse',
   content:[{type:'toolCall',id:`reference-${requests}`,name:'submit_reading',arguments:first?(written?{}:{draft:invalid}):{draft:corrected}}]};
  queueMicrotask(()=>{stream.push({type:'done',reason:'toolUse',message});stream.end();});return stream;
 }});
 await agent.prompt('Save navigation references using observed physical page objects.');
 assert.equal(requests,2,'only the corrected artifact ends the actual Pi tool loop');
 const results=agent.state.messages.filter(message=>message.role==='toolResult');
 assert.equal(results[0].isError,true);assert.match(results[0].content[0].text,/source_refs/);
 assert.equal(results[1].isError,false);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'draft.json'),'utf8')),corrected);
});

test('a shape-correct navigation citation still requires the original native viewed-page authority',async t=>{
 const {dir}=await setup(t,false,'index');
 const {RpcClient}=await import('../integration/support.ts');
 const native=new RpcClient(dir);t.after(()=>native.close());
 const pdf=join(dir,'original.pdf'),bytes=Buffer.from('%PDF-1.7\nNavigation evidence fixture\n%%EOF\n');await writeFile(pdf,bytes);
 const sourceSha=createHash('sha256').update(bytes).digest('hex');
 const {module_id}=await native.ok('module.source.bind',{source:{path:pdf,page_count:2,file_sha256:sourceSha}});
 await native.ok('module.read.request',{module_id,purpose:'index'});
 const job=await native.ok('module.read.claim',{module_id,owner:'navigation-reference-test'});
 await json(join(job.work_dir,'task.json'),{purpose:'index',source:{page_count:2}});
 let tool;process.chdir(job.work_dir);await readerSubmit({on(){},registerTool(value){tool=value}});
 const navigation={language:'en',sections:[{name:'Opening',pages:[[1,2]],source_refs:[{page:2}]}]};
 assert.equal((await tool.execute('save-unseen-reference',{draft:navigation})).terminate,true,'shape submission does not grant source acceptance');
 await json(join(job.work_dir,'observations.json'),{file_sha256:sourceSha,read_pages:[1],full_pages:[1],review_pages:[]});
 const publish={module_id,job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:join(job.work_dir,'draft.json')};
 const refused=await native.err('module.read.finish',publish);
 assert.equal(refused.message,'navigation references must have been viewed');
 await json(join(job.work_dir,'observations.json'),{file_sha256:sourceSha,read_pages:[1,2],full_pages:[1,2],review_pages:[]});
 assert.equal((await native.ok('module.read.finish',publish)).state,'preparing','the same citation publishes only after its original page is observed');
});

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
 assert.deepEqual(Object.keys(author.tool.parameters.properties),[]);
 assert.equal(Check(author.tool.parameters,{guidance:{summary:'A different object'}}),false);
 assert.equal(Check(author.tool.parameters,{guidance}),false);
 assert.equal(Check(author.tool.parameters,{guidance:{...guidance,guide:'Source meeting person'}}),false);
 assert.equal(Check(author.tool.parameters,{guidance:{needs_choice:true}}),false);
});

for(const written of [false,true])test(`a malformed ${written?'written':'inline'} guidance submission is corrected in the same Pi process`,async t=>{
 const {tool,see,dir}=await setup(t);see();
 const malformed={summary:'Public premise.',questions_to_resolve:[],source_limits:'Keep secrets private.'};
 if(written)await json(join(dir,'guidance.json'),malformed);
 let requests=0;const model={id:'fixture',provider:'fixture',api:'openai-completions'};
 const agent=new Agent({initialState:{model,tools:[tool]},streamFn(){
  const stream=createAssistantMessageEventStream(),first=requests++===0;
  if(!first)writeFileSync(join(dir,'guidance.json'),JSON.stringify(guidance));
  const message={role:'assistant',model:'fixture',provider:'fixture',api:'openai-completions',timestamp:Date.now(),
   usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'toolUse',
   content:[{type:'toolCall',id:`guidance-${requests}`,name:'submit_reading',arguments:first?(written?{}:{draft,guidance:malformed}):{}}]};
  queueMicrotask(()=>{stream.push({type:'done',reason:'toolUse',message});stream.end();});return stream;
 }});
 await agent.prompt('Save the character guidance artifacts.');
 assert.equal(requests,2,'only the corrected submission terminates the actual Pi tool loop');
 const results=agent.state.messages.filter(message=>message.role==='toolResult');
 assert.equal(results[0].isError,true);
 if(written)for(const field of ['opening','advice','scene','guide','handoff'])assert.match(results[0].content[0].text,new RegExp(field));
 else assert.match(results[0].content[0].text,/no arguments|additional properties/);
 if(written)assert.match(results[0].content[0].text,/string.*empty|empty.*string/);
 assert.equal(results[1].isError,false);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'guidance.json'),'utf8')),guidance);
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
 await assert.rejects(submitSaved(tool,dir,'bad',{draft:{},guidance}),/reading_failed/);
 await assert.rejects(submitSaved(tool,dir,'unseen',{draft,guidance}),/View original physical pages/);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'draft.json'),'utf8')),draft);
 see();assert.equal((await tool.execute('fixed',{})).terminate,true);
 await assert.rejects(tool.execute('cancel',{},AbortSignal.abort()),/cancelled/);
});

test('a contact-sheet overview cannot satisfy source-reference evidence',async t=>{
	const {tool,overview,dir}=await setup(t);
	overview();
	await assert.rejects(submitSaved(tool,dir,'overview-only',{draft,guidance}),/View original physical pages/);
});

test('public guidance uses the same submission and requires its own original-page evidence',async t=>{
 const {tool,see,dir}=await setup(t,false,'guidance',{public_progress_required:true});
 const fields=Object.fromEntries(['era','starting_place','public_premise','creation_advice'].map(field=>[field,{status:'value',text:'Public '+field,source_refs:[{page:2}]}]));
 see([1]);
 await assert.rejects(submitSaved(tool,dir,'missing-fields',{draft,guidance}),/four public fields/);
 await assert.rejects(submitSaved(tool,dir,'unseen-public-source',{draft,guidance,public_fields:fields}),/View original physical pages.*2/);
 see([2]);assert.equal((await submitSaved(tool,dir,'public-source-read',{guidance,public_fields:fields})).terminate,true);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'public-fields.json'),'utf8')),fields);
});

test('a required source gap stays retained and returns to retrieval instead of terminating the reader',async t=>{
 const {tool,see,dir}=await setup(t,false,'detail');
 const previous=process.env.PI_COC_READER_SOURCE;process.env.PI_COC_READER_SOURCE=JSON.stringify({file_sha256:'a'.repeat(64)});
 t.after(()=>{if(previous===undefined)delete process.env.PI_COC_READER_SOURCE;else process.env.PI_COC_READER_SOURCE=previous;});
 const need={kind:'source_read',focus:'Dock',question:'Who is the third participant?',reason:'Their identity changes the current interaction.',trigger:'Before the current scene is ready.',source_refs:[{page:1}]};
 const candidate={...draft,ready_nodes:['scene-dock'],source_needs:[need]};
 const pending=await submitSaved(tool,dir,'required-gap',{draft:candidate});
 assert.equal(pending.terminate,undefined);assert.equal(pending.details.kind,'source_need_batch');
 const retained=JSON.parse(await readFile(join(dir,'pending-source-needs.json'),'utf8'));
 assert.equal(retained.needs[0].question,need.question);
 see();assert.equal((await submitSaved(tool,dir,'candidate-repaired',{draft:{...candidate,source_needs:[]}})).terminate,true);
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
 await assert.rejects(submitSaved(tool,dir,'premature',{draft,guidance}),/View original physical pages/);
 await writeFile(log,JSON.stringify({delivery:'succeeded',host_pages:[page]})+'\n');
 assert.equal((await submitSaved(tool,dir,'delivered',{draft,guidance})).terminate,true);
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
 await assert.rejects(submitSaved(tool,dir,'too-broad',{draft:{...opening,ready_nodes:['scene-dock','scene-warehouse']}}),/exactly the selected first scene/);
 assert.equal((await submitSaved(tool,dir,'first-batch',{draft:opening})).terminate,true);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'draft.json'),'utf8')).ready_nodes,['scene-dock']);
});

test('detail submission checks its scoped delta without imposing the first-opening batch rule',async t=>{
 const {tool,see,dir}=await setup(t,false,'detail',{focus:'Dock and warehouse',question:'Prepare these two adjoining rooms.'});
 const detail={...draft,nodes:[...draft.nodes,{node_id:'scene-warehouse',node_kind:'scene',name:'Warehouse',source_refs:[{page:1}],properties:{}}],ready_nodes:['scene-dock','scene-warehouse']};
 await assert.rejects(submitSaved(tool,dir,'unseen',{draft:detail}),/View original physical pages/);
 see();assert.equal((await submitSaved(tool,dir,'detail',{draft:detail})).terminate,true);
});

test('first-interaction opening requires the sourced encounter after its entry and rejects deferred current participants',async t=>{
 const {tool,see,dir}=await setup(t,false,'opening',{focus:'Dock',opening_scope:'first_interaction'});
 const encounter={node_id:'scene-warehouse',node_kind:'scene',name:'Warehouse',source_refs:[{page:2}],properties:{}};
 const npc={node_id:'npc-witness',node_kind:'npc',name:'Witness',source_refs:[{page:2}],properties:{}};
 const current={...draft,nodes:[...draft.nodes,encounter,npc],interaction_scene:'scene-warehouse',ready_nodes:['scene-dock','scene-warehouse'],
  claims:[{subject_id:'scene-dock',predicate:'route-to',object:{node_id:'scene-warehouse'},truth_status:'authored-fact',source_refs:[{page:2}]},
   {subject_id:'npc-witness',predicate:'present-in',object:{node_id:'scene-warehouse'},truth_status:'authored-fact',source_refs:[{page:2}]}]};
 see([1,2]);
 await assert.rejects(submitSaved(tool,dir,'missing-current-person',{draft:current}),/first interaction depends on/);
 const ready={...current,ready_nodes:[...current.ready_nodes,'npc-witness']};
 await assert.rejects(submitSaved(tool,dir,'missing-progression',{draft:{...ready,claims:ready.claims.slice(1)}}),/source-authored route or progression/);
 assert.equal((await submitSaved(tool,dir,'complete-first-interaction',{draft:ready})).terminate,true);
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
 await assert.rejects(submitSaved(tool,dir,'mismatch',{draft:batch}),/preserve the selected opening/);
 for(const name of ['dock','scene-dock','Dock — an expanded title']){await focus(name);assert.equal((await submitSaved(tool,dir,'matched',{draft:batch})).terminate,true);}
 batch.nodes[0].properties={...batch.nodes[0].properties,runtime_projection:{record:{scene_id:'selected-dock'}}};
 await focus('selected-dock');assert.equal((await submitSaved(tool,dir,'handle',{draft:batch})).terminate,true);
});


test('the first scene cannot be submitted while its present NPC still requires detail reading',async t=>{
 const {tool,see,dir}=await setup(t,false,'opening');see();
 const batch={...draft,nodes:[...draft.nodes,{node_id:'npc-witness',node_kind:'npc',name:'Witness',source_refs:[{page:1}],properties:{}}],
  claims:[{subject_id:'npc-witness',predicate:'present-in',object:{node_id:'scene-dock'},truth_status:'authored-fact',source_refs:[{page:1}]}],ready_nodes:['scene-dock']};
 await assert.rejects(submitSaved(tool,dir,'incomplete',{draft:batch}),/first interaction depends on/);
 batch.ready_nodes.push('npc-witness');assert.equal((await submitSaved(tool,dir,'ready',{draft:batch})).terminate,true);
});

test('large graph author submission is file-only and refuses inline data before touching artifacts',async t=>{
 const {tool,see,dir}=await setup(t);see();const before=await readFile(join(dir,'draft.json'));
 assert.equal(Check(tool.parameters,{draft,guidance}),false);
 await assert.rejects(tool.execute('inline-not-a-file',{draft,guidance}),/saved|file|arguments/i);
 assert.deepEqual(await readFile(join(dir,'draft.json')),before);
 assert.equal((await tool.execute('saved-artifacts',{})).terminate,true);
});
