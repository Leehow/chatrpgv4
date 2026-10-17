/** Frozen expression publication keeps world authority while background source updates continue. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,openTurn,campaignDir,readJson,writeJson,createCampaign} from './support.ts';
import {join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,unlinkSync} from 'node:fs';
for(const author of ['keeper','isolated-expression','final-output'])for(const staleWorld of [false,true])test(`publication ${author}, stale world ${staleWorld}`,async t=>{
 const k=await kernel(t);await openTurn(k);
 const c=(await k.table('capsule'))._context,text='Knott waits beside the office desk.';
 const evidence={version:1,packet:'a'.repeat(64),binding:'b'.repeat(64),materials:[],required:[],coverage:[],author,artifact_text:text,
  context:{campaign:c.campaign,turn:c.turn,worldline:c.worldline,loop:c.loop,world_revision:staleWorld?'stale-world':c.task_world_revision,source_revision:'previous-consumed-source'}};
 const params={call_id:'t1-c1',text,_delivery_evidence:evidence};
 if(staleWorld||author==='final-output'){
  const failure=await k.err('table.narrate',{campaign:'c1',...params});
  assert.equal(failure.code,'revision_conflict');
  assert.equal(failure.details.reason,staleWorld?'publication_owner_changed':'publication_source_changed');
  if(staleWorld)assert.deepEqual(failure.details.mismatches,[{field:'world_revision',expected:'stale-world',actual:c.task_world_revision}]);
 }
 else assert.equal((await k.table('narrate',params)).rendered_text,text);
});

for (const change of ['none','clock','stream-text','stream-attempt','party','missing-job']) test(`legacy exposed reply requires an exact preparation witness: ${change}`,async t=>{
 const k=await kernel(t);await openTurn(k);
 const name='the waiting clerk';
 await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name,walk_on:true,to:'here'}]});
 const job=await k.ok('npc.job',{campaign:'c1',name}),c=(await k.table('capsule'))._context,text='The clerk listens beside the desk.';
 const packet='c'.repeat(64),attempt='legacy-attempt',evidence={version:1,packet,binding:'b'.repeat(64),materials:[],required:[],coverage:[],author:'isolated-expression',artifact_text:text,
  stream:{delivery_id:packet,attempt_id:attempt},context:{campaign:c.campaign,turn:c.turn,worldline:c.worldline,loop:c.loop,world_revision:c.task_world_revision,source_revision:c.task_source_revision}};
 const directory=join(k.workspace,'.coc','delivery-writes',packet);mkdirSync(directory,{recursive:true});
 writeJson(join(directory,'accepted.json'),{artifact:{version:1,text,coverage:[]},evidence});
 const frame={campaign:'c1',turn:1,worldline:c.worldline,loop:c.loop,delivery_id:packet,attempt_id:attempt,timestamp:Date.now()-10000};
 writeFileSync(join(directory,'delivery.jsonl'),[{...frame,event:'start',status:'streaming'},{...frame,event:'delta',delta:text},{...frame,event:'end',status:'publication_pending'}].map((row,index)=>JSON.stringify({...row,version:1,sequence:index+1})).join('\n')+'\n');
 await k.ok('npc.submit',{campaign:'c1',job_id:job.job_id,claim:job.claim,personality:{description:'Values careful listening and prefers evidence over a quick guess.'}});
 if(change==='clock'){const path=join(campaignDir(k.workspace),'world.json'),world=readJson(path);world.clock.minute+=1;writeJson(path,world);}
 if(change.startsWith('stream-')){
  const path=join(directory,'delivery.jsonl'),frames=readFileSync(path,'utf8').trim().split('\n').map(JSON.parse);
  if(change==='stream-text')frames[1].delta='Different public text.';else frames[1].attempt_id='another-attempt';
  writeFileSync(path,frames.map(JSON.stringify).join('\n')+'\n');
 }
 if(change==='party'){
  const directory=join(campaignDir(k.workspace),'party'),path=join(directory,readdirSync(directory).find(name=>name.endsWith('.json'))!);
  const sheet=readJson(path);sheet.name+=' changed';writeJson(path,sheet);
 }
 if(change==='missing-job')unlinkSync(join(campaignDir(k.workspace),'npc/jobs',job.job_id.slice(4)+'.json'));
 const params={campaign:'c1',call_id:'t1-c2',text,_delivery_evidence:{...evidence,input_text:text}};
 if(change!=='none')assert.equal((await k.err('table.narrate',params)).code,'revision_conflict');
 else {
  assert.equal((await k.ok('table.narrate',params)).rendered_text,text);
  assert.ok(Object.values(readJson(join(campaignDir(k.workspace),'world.json')).npc_character).some((entry:any)=>entry.personality?.description));
  assert.equal(readJson(join(directory,'accepted.json')).evidence.context.world_revision,c.task_world_revision);
 }
});

test('opening delivery freezes only after successful parameter checks',async t=>{
 const k=await kernel(t);await createCampaign(k);await k.table('open');
 const path=join(campaignDir(k.workspace),'turn.json');
 assert.equal((await k.tableErr('delivery.check',{speakers:[17]})).code,'invalid_params');
 assert.notEqual(readJson(path).delivery_frozen,true);
 await k.table('delivery.check');
 assert.equal(readJson(path).delivery_frozen,true);
 const before=(await k.table('capsule'))._context.task_world_revision;
 await k.ok('npc.job',{campaign:'c1',name:'Steven Knott'});
 assert.equal((await k.table('capsule'))._context.task_world_revision,before);
});

test('background personality cannot stale a frozen browser reply and is adopted next turn',async t=>{
 const k=await kernel(t);await openTurn(k);
 const name='the waiting clerk';
 await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name,walk_on:true,to:'here'}]});
 const job=await k.ok('npc.job',{campaign:'c1',name});
 await k.table('delivery.check');
 const c=(await k.table('capsule'))._context,text='The clerk waits beside the office desk.';
 const personality={description:'Values careful listening and prefers evidence over a quick guess.'};
 const prepared=await k.ok('npc.submit',{campaign:'c1',job_id:job.job_id,claim:job.claim,personality});
 assert.equal(prepared.deferred,true);
 assert.equal((await k.table('capsule'))._context.task_world_revision,c.task_world_revision);
 assert.equal((await k.ok('npc.submit',{campaign:'c1',job_id:job.job_id,claim:job.claim,personality})).replayed,true);
 assert.equal((await k.err('npc.submit',{campaign:'c1',job_id:job.job_id,claim:job.claim,personality:{description:'Different content.'}})).code,'idempotency_conflict');
 const evidence={version:1,packet:'a'.repeat(64),binding:'b'.repeat(64),materials:[],required:[],coverage:[],author:'isolated-expression',artifact_text:text,
  context:{campaign:c.campaign,turn:c.turn,worldline:c.worldline,loop:c.loop,world_revision:c.task_world_revision,source_revision:c.task_source_revision}};
 assert.equal((await k.table('narrate',{call_id:'t1-c2',text,_delivery_evidence:evidence})).rendered_text,text);
 await k.table('player_input',{text:'I ask the clerk to continue.'});
 const world=readJson(join(campaignDir(k.workspace),'world.json'));
 assert.ok(Object.values(world.npc_character).some((entry:any)=>entry.personality?.description===personality.description));
 assert.equal((await k.table('capsule')).present.find((person:any)=>person.name===name).personality.description,personality.description);
 assert.equal(readJson(join(campaignDir(k.workspace),'npc/jobs',job.job_id.slice(4)+'.json')).status,'done');
 const adopted=Object.values(world.npc_character).find((entry:any)=>entry.personality?.description===personality.description) as any;
 assert.equal(adopted.personality.accepted_turn,2);
 assert.notEqual((await k.ok('npc.submit',{campaign:'c1',job_id:job.job_id,claim:job.claim,personality})).deferred,true);
});
