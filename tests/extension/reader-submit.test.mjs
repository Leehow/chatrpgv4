import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Agent} from '@earendil-works/pi-agent-core';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import readerSubmit from '../../extensions/module/reader-submit.ts';
import {readerInput,readerCommand} from '../../extensions/module/reader.ts';

const draft={nodes:[{node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:[{page:1}],properties:{is_entrance:true}}],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:[]};
const guidance={opening:'At the dock, who are you?',advice:'Public source premise.',scene:'Dock',guide:'',handoff:'Continue the meeting.'};
const review={checked:[{paths:['/nodes/0'],source_refs:[{page:1}],verdict:'supported'}],missing:[],guidance:{approved:true,issues:[]}};
const json=(path,value)=>writeFile(path,JSON.stringify(value)+'\n');
async function setup(t,reviewing=false){
 const cwd=process.cwd(),dir=await mkdtemp(join(tmpdir(),'coc-submit-'));
 t.after(async()=>{process.chdir(cwd);await rm(dir,{recursive:true,force:true});});
 await json(join(dir,'task.json'),{purpose:'guidance',module_id:'book-1',source:{page_count:2},known_nodes:[],...(reviewing?{required_review:['/nodes/0']}: {})});
 await json(join(dir,'draft.json'),draft);await json(join(dir,'guidance.json'),guidance);
 process.chdir(dir);const handlers={};let tool;
 await readerSubmit({on(name,fn){handlers[name]=fn},registerTool(value){tool=value},async exec(file,args,options){
  try{return {...await promisify(execFile)(file,args,options),code:0}}catch(error){return {code:error.code,stdout:error.stdout,stderr:error.stderr}}}});
 const see=()=>handlers.context({messages:[{role:'toolResult',content:[{type:'image',data:'AA=='}],details:{kind:'source_pages',observations:[{page:1}]}}]});
 return {tool,see,dir};
}

test('small reader input is supplied up front while oversized input retains file access',()=>{
 assert.match(readerInput({task:{source:{bookmarks:[]}}}),/input_json/);
 assert.match(readerInput({task:'x'.repeat(50000)}),/^Read task.json/);
 const args=readerCommand('xai/grok-4.6','brief','low',true,true);
 assert.ok(args.includes('read,write,edit,bash,pdf,submit_reading'));
 assert.ok(args.some(arg=>arg.endsWith('/build/extensions/module/reader-submit.mjs')));
 assert.ok(!readerCommand(undefined,undefined,undefined,true).some(arg=>arg.endsWith('/reader-submit.mjs')));
});

test('failed draft and unseen source checks return to repair before a terminating submission',async t=>{
 const {tool,see,dir}=await setup(t);
 await assert.rejects(tool.execute('bad',{draft:{},guidance}),/reading_failed/);
 await assert.rejects(tool.execute('unseen',{draft,guidance}),/View original physical pages/);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'draft.json'),'utf8')),draft);
 see();assert.equal((await tool.execute('fixed',{})).terminate,true);
 await assert.rejects(tool.execute('cancel',{},AbortSignal.abort()),/cancelled/);
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
