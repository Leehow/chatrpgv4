/** Real Pi transport with deterministic author/Jev replies; not live-play evidence. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import {openTable,waitFor} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const packet={job_id:'extract:test-camp:t1',turn:1,commit:'fixed',player_text:'I ask about the fee.',keeper_text:'The clerk says admission is free.',story_context:{threads:[{thread:'disappearance',supporting:[{statement:'An acquired clue.'}],contradicting:[]}]}};
test('native kernel upgrades only open legacy recovery and preserves its original record',{timeout:15000},async t=>{
 for(const done of [false,true]){
  const table=await openTable({realKernel:true,env:{PI_COC_MEMORY_BACKFILL:'0'},async prepareWorkspace(workspace){const seed=new RpcClient(workspace);try{
   await seed.ok('table.open',{campaign:'test-camp'});await seed.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The clerk waits beside the desk.'});
   const job=await seed.ok('memory.job',{campaign:'test-camp',turn:0});
   if(done)await seed.ok('memory.submit',{campaign:'test-camp',job_id:job.job_id,candidates:[]});
  }finally{await seed.close();}}});
  const client=new RpcClient(table.workspace);try{
   const result=await client.ok('memory.job',{campaign:'test-camp',turn:0,mode:'referenced',upgrade_open:true});
   const record=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/memory/jobs/extract:test-camp:t0.json'),'utf8'));
   if(done){assert.equal(result.protocol,undefined);assert.equal(result.job_id,null,'an accepted legacy job cannot start another author');assert.equal(record.status,'done');assert.equal(record.legacy_job,undefined);}
   else{assert.equal(result.protocol,'memory-reference-v1');assert.equal(record.legacy_job.status,'open');assert.equal(record.legacy_job.packet.keeper_text,'The clerk waits beside the desk.');}
  }finally{await client.close();await table.dispose();}
 }
});
test('native memory author does not repeat story judgment and pending judgment retains its draft',{timeout:10000},async t=>{
 const old=globalThis.fetch,key=process.env.EXT_JEV_APIKEY;process.env.EXT_JEV_APIKEY='fixture-key';
 t.after(()=>{globalThis.fetch=old;if(key===undefined)delete process.env.EXT_JEV_APIKEY;else process.env.EXT_JEV_APIKEY=key;});
 let typed=0,verdict='pending';globalThis.fetch=async(_url,options)=>{
  const body=JSON.parse(options.body);typed++;
  return new Response(JSON.stringify({model:body.model,answers:Object.fromEntries(Object.entries(body.questions).map(([id,q])=>{
   return[id,{type:'noul',noul:verdict==='pending'?.5:.01}];
  })),usage:{input_tokens:100,output_tokens:1}}),{status:200});
 };
 const prompts=[],submits=[],fails=[];
 const response=context=>{
  prompts.push(JSON.stringify(context));return fauxAssistantMessage('{"candidates":[]}');
 };
 const table=await openTable({env:{PI_COC_MEMORY_BACKFILL:'0'},laneResponses:{memory:[response,response]}});t.after(()=>table.dispose());
 table.emit('coc:kernel-bridge',{campaign:'test-camp',runtime:{sourceReferences:true},call:async(method,params)=>{
  if(method==='memory.job')return packet;if(method==='memory.submit')submits.push(params);if(method==='memory.fail')fails.push(params);return{};
 }});
 table.emit('coc:turn-committed',{campaign:'test-camp',turn:1});
 await waitFor(()=>table.telemetry().some(row=>row.lane==='memory'&&['pending_review','malformed_reply'].includes(row.event)));
 assert.equal(prompts.length,1);assert.equal(typed,1);
 assert.ok(!prompts[0].includes('Story assessment rules'));
 assert.ok(!prompts[0].includes('Keeper-only story context'));
 assert.deepEqual(submits,[]);assert.deepEqual(fails,[]);
 assert.ok(table.telemetry().some(row=>row.lane==='memory'&&row.event==='candidate_draft'&&row.reused===false));
 verdict='unclear';
 table.emit('coc:turn-committed',{campaign:'test-camp',turn:1,commit:'explicit-redispatch'});
 await waitFor(()=>submits.length===1);
 assert.equal(prompts.length,1,'exact job reloads its on-disk draft without a second author');
 assert.equal(typed,2);assert.deepEqual(submits[0].story,{status:'unclear',thread:null,frame:null,bridge_delivered:false,delivery_quote:null});
 assert.ok(table.telemetry().some(row=>row.event==='candidate_draft'&&row.reused===true));
 packet.keeper_text='The clerk supplies a different answer.';
 table.emit('coc:turn-committed',{campaign:'test-camp',turn:1,commit:'changed-source'});
 await waitFor(()=>submits.length===2);
 assert.equal(prompts.length,2,'changed source cannot reuse the earlier draft');
});

test('native paragraph jobs persist their own layout without reindexing an existing job',{timeout:15000},async t=>{
 const text='See Deeds 1187, p. 340 — 41.\n\nThe clerk waits beside the desk.';
 const table=await openTable({realKernel:true,env:{PI_COC_MEMORY_BACKFILL:'0'},async prepareWorkspace(workspace){const seed=new RpcClient(workspace);try{await seed.ok('table.open',{campaign:'test-camp'});await seed.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text});}finally{await seed.close();}}});t.after(()=>table.dispose());
 const client=new RpcClient(table.workspace);try{
  const legacy=await client.ok('memory.job',{campaign:'test-camp',turn:0,mode:'referenced'});
  const unchanged=await client.ok('memory.job',{campaign:'test-camp',turn:0,mode:'referenced',source_layout:'paragraph-v1'});
  assert.deepEqual(unchanged,legacy,'already issued sources keep their original indices and origin');
  await client.ok('table.open',{campaign:'test-camp'});await client.ok('table.player_input',{campaign:'test-camp',text:'I read the next page.'});await client.ok('table.narrate',{campaign:'test-camp',call_id:'t1-c1',text});
  const next=await client.ok('memory.job',{campaign:'test-camp',turn:1,mode:'referenced',source_layout:'paragraph-v1'});
  assert.equal(next.step.segments.filter(s=>s.role==='keeper').length,2);assert.ok(next.step.segments.find(s=>s.alias==='keeper:0').text.includes('p. 340 — 41.'));
  const result=await client.ok('memory.submit',{campaign:'test-camp',job_id:next.job_id,referenced:{step:next.step.key,decisions:next.step.segments.map((s,i)=>({source:s.alias,outcome:s.alias==='keeper:0'?'retain':'skip',...(s.alias==='keeper:0'?{annotations:[{kind:'world_event',subject:'world',privacy:'player_safe',state:'accurate'}]}:{})}))}});
  assert.equal(result.remaining,0);
  const record=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/memory/jobs/extract:test-camp:t1.json'),'utf8'));
  assert.equal(record.source_layout,'paragraph-v1');
  const reopened=await client.ok('memory.job',{campaign:'test-camp',turn:1,mode:'referenced'});assert.deepEqual(reopened.origin,next.origin);
 }finally{await client.close();}
});

test('referenced jobs refresh closure eligibility without changing issued targets or source indices',{timeout:15000},async t=>{
 const table=await openTable({realKernel:true,env:{PI_COC_MEMORY_BACKFILL:'0'}});t.after(()=>table.dispose());const client=new RpcClient(table.workspace),campaign='test-camp';
 const open=async(turn)=>{await client.ok('table.open',{campaign});if(turn)await client.ok('table.player_input',{campaign,text:'I wait for the clerk.'});await client.ok('table.narrate',{campaign,call_id:`t${turn}-c1`,text:'The clerk waits beside the desk.'});return client.ok('memory.job',{campaign,turn,mode:'referenced'});};
 const submit=(p,relations=[])=>client.ok('memory.submit',{campaign,job_id:p.job_id,referenced:{step:p.step.key,decisions:p.step.segments.map(s=>({source:s.alias,outcome:s.role==='keeper'?'retain':'skip',...(s.role==='keeper'?{annotations:[{kind:'world_event',subject:'world',privacy:'player_safe',state:'accurate',relations}]}:{})}))}});
 try{await submit(await open(0));const old=await open(1),later=await open(2);const alias=later.prior.find(p=>p.statement==='The clerk waits beside the desk.').alias;await submit(later,[{relation:'temporal_change',target:alias}]);
 const refreshed=await client.ok('memory.job',{campaign,turn:1,mode:'referenced'});assert.deepEqual(refreshed.step,old.step);assert.deepEqual(refreshed.origin,old.origin);assert.deepEqual(refreshed.prior.map(p=>[p.alias,p.statement,p.subject,p.kind]),old.prior.map(p=>[p.alias,p.statement,p.subject,p.kind]));assert.equal(old.prior[0].status,'candidate');assert.equal(refreshed.prior[0].status,'superseded');
 const error=await client.err('memory.submit',{campaign,job_id:refreshed.job_id,referenced:{step:refreshed.step.key,decisions:refreshed.step.segments.map(s=>({source:s.alias,outcome:s.role==='keeper'?'retain':'skip',...(s.role==='keeper'?{annotations:[{kind:'world_event',subject:'world',relations:[{relation:'temporal_change',target:refreshed.prior[0].alias}]}]}:{})}))}});assert.match(error.message,/already has a closing occurrence/);
 }finally{await client.close();}
});

test('a failed native backfill excludes its resolved job and remains explicitly redispatchable',{timeout:10000},async t=>{
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);globalThis.fetch=async(_url,options)=>{const b=JSON.parse(options.body);return new Response(JSON.stringify({model:b.model,answers:Object.fromEntries(Object.entries(b.questions).map(([key,q])=>[key,{type:'choice',choice:'no',confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='no'?1:0]))}]))}),{status:200});};
 const {committedTurnCatalog}=await import('../../runtime/jev/committed-turn-sources.ts');const catalog=committedTurnCatalog({scope:{owner:'memory-owner',campaign:'test-camp',worldline:'main',loop:0,audience:'keeper'},turn:7,commit:'a'.repeat(40),playerText:'',keeperText:'The clock ticks.'});
 const p={protocol:'memory-reference-v1',job_id:'extract:test-camp:t7',turn:7,commit:catalog.commit,status:'open',origin:{scope:catalog.snapshots[0].scope,revision:'r1'},step:{key:'step-7',sequence:0,total:1,remaining:1,segments:catalog.segments},known_entities:[],prior:[],prior_coverage:{total:0,included:0,omitted:0},story_sources:catalog.segments,story_complete:true};
 const table=await openTable({env:{PI_COC_MEMORY_BACKFILL:'5',EXT_JEV_APIKEY:'fixture-key'}});t.after(()=>table.dispose());const reads=[];let submissions=0;
 table.emit('coc:kernel-bridge',{campaign:'test-camp',runtime:{sourceReferences:true},call:async(method,params)=>{if(method==='memory.job'){reads.push(params);return params.turn===7||!params.exclude_turns?.includes(7)?p:{job_id:null};}if(method==='memory.submit'){submissions++;throw Error('This memory target already has a closing occurrence');}return{};}});
 await waitFor(()=>reads.some(r=>r.exclude_turns?.includes(7)));assert.equal(submissions,1);assert.ok(table.telemetry().some(r=>r.lane==='memory'&&r.turn===7&&r.job_id===p.job_id&&r.ok===false));
 table.emit('coc:turn-committed',{campaign:'test-camp',turn:7,commit:'explicit-retry'});await waitFor(()=>submissions===2);assert.equal(submissions,2);
});
