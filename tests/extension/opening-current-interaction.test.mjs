/** Current interaction publication and restart use the real TypeScript JSONL boundary. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {kernel,RpcClient,importSource,CONTENT_DIR} from '../integration/support.ts';
import {checkReviewEvidence} from '../../extensions/module/reader-review.ts';

const refs=[{page:1}],save=(file,value)=>writeFile(file,JSON.stringify(value)+'\n');
const candidate=()=>({interaction_scene:'scene-counter',nodes:[
 {node_id:'scene-counter',node_kind:'scene',name:'Counter',summary:'A conversation at a counter.',source_refs:refs,properties:{is_entrance:true}},
 {node_id:'npc-clerk',node_kind:'npc',name:'Clerk',summary:'The clerk is ready to discuss the request.',source_refs:refs,properties:{agenda:'Understand the request.'}}
],claims:[{subject_id:'npc-clerk',predicate:'present-in',object:{node_id:'scene-counter'},truth_status:'authored-fact',source_refs:refs}],
 node_refs:[],coverage:{},dependencies:[],critical:[],source_needs:[],ready_nodes:['scene-counter','npc-clerk']});

async function opening(client,scope='first_interaction'){
 const source=join(client.workspace,'original.pdf'),bytes=Buffer.from('%PDF-1.7\nTransport-only opening fixture; not rendered or played.\n');await writeFile(source,bytes);
 const bound=await client.ok('module.source.bind',{source:{path:source,page_count:1,file_sha256:createHash('sha256').update(bytes).digest('hex')}}),mid=bound.module_id;
 await client.ok('module.read.request',{module_id:mid,purpose:'index'});
 const index=await client.ok('module.read.claim',{module_id:mid,owner:'opening-test'});
 await save(join(index.work_dir,'observations.json'),{file_sha256:index.source.file_sha256,read_pages:[1],full_pages:[1],review_pages:[]});
 await save(join(index.work_dir,'draft.json'),{title:'Current interaction fixture',language:'en',sections:[{name:'Counter',pages:[[1,1]],source_refs:refs}],map_candidates:[]});
 await client.ok('module.read.finish',{module_id:mid,job_id:index.job_id,lease:index.lease,outcome:'completed',draft_path:join(index.work_dir,'draft.json')});
 await client.ok('module.read.request',{module_id:mid,purpose:'opening',...(scope?{opening_scope:scope}:{})});
 const job=await client.ok('module.read.claim',{module_id:mid,owner:'opening-test'});
 return {mid,job};
}
async function artifacts(job,draft){
 await save(join(job.work_dir,'draft.json'),draft);
 await save(join(job.work_dir,'observations.json'),{file_sha256:job.source.file_sha256,read_pages:[1],full_pages:[1],review_pages:[1]});
 const api=await importSource('kernel-ts/check.ts');
 const checked=await api.checkSourceDraft(CONTENT_DIR,join(job.work_dir,'packet.json'),join(job.work_dir,'draft.json'));
 if(!checked.ok)return checked;
 const paths=[...new Set([...checked.required_review,'/coverage',...(draft.interaction_scene?['/interaction_scene']:[]),...(draft.source_needs?['/source_needs']:[])])];
 await save(join(job.work_dir,'review.json'),{checked:paths.map(path=>({path,verdict:'supported',source_refs:refs,reason:'Deterministic source-bound transport fixture.'})),missing:[]});
 return checked;
}
const finish=(mid,job)=>({module_id:mid,job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:join(job.work_dir,'draft.json'),review_path:join(job.work_dir,'review.json')});

test('a verified first interaction publishes without future navigation and remains ready after restart',async t=>{
 const client=await kernel(t),{mid,job}=await opening(client),draft=candidate();
 assert.equal((await artifacts(job,draft)).ok,true);
 const result=await client.ok('module.read.finish',finish(mid,job));assert.equal(result.opening_ready,true);
 const status=await client.ok('module.status',{module_id:mid});
 assert.equal(status.opening_ready,true);assert.equal(status.status,'installed');
 assert.equal(status.opening.interaction_scene,'scene-counter');assert.deepEqual(status.opening.missing,[]);
 const repeated=await client.ok('module.read.request',{module_id:mid,purpose:'opening',opening_scope:'first_interaction'});
 assert.equal(repeated.state,'ready','the default readiness consumer agrees with publication');
 const metadata=JSON.parse(await readFile(join(client.workspace,'.coc/modules',mid,'module.json'),'utf8'));
 assert.deepEqual(metadata.opening,metadata.prepared_openings['scene-counter']);
 assert.equal(draft.nodes[0].properties.is_final,undefined,'the fixture did not invent an ending');
 await client.ok('module.read.request',{module_id:mid,purpose:'detail',focus:'Counter',question:'A later sourced observation.'});
 const detail=await client.ok('module.read.claim',{module_id:mid,owner:'opening-test'});
 assert.ok(detail.job_id);const later={nodes:[structuredClone(draft.nodes[0])],
  claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-counter']};
 const checkedLater=await artifacts(detail,later);assert.equal(checkedLater.ok,true,JSON.stringify(checkedLater));await client.ok('module.read.finish',finish(mid,detail));
 assert.equal((await client.ok('module.status',{module_id:mid})).opening_ready,true,'a later detail does not reapply the legacy navigation requirement');
 await client.close();const restarted=new RpcClient(client.workspace);t.after(()=>restarted.close());
 assert.equal((await restarted.ok('module.status',{module_id:mid})).opening_ready,true);
 assert.equal((await restarted.ok('module.read.request',{module_id:mid,purpose:'opening',opening_scope:'first_interaction'})).state,'ready');
});

test('an opening outside first_interaction still requires its declared way on',async t=>{
 const client=await kernel(t),{mid,job}=await opening(client,''),draft=candidate();delete draft.interaction_scene;
 assert.equal((await artifacts(job,draft)).ok,true);
 const refusal=await client.err('module.read.finish',finish(mid,job));assert.equal(refusal.code,'invalid_params');assert.match(refusal.message,/way_on/);
});

test('current-interaction publication still refuses a declared dangling exit',async t=>{
 const client=await kernel(t),{mid,job}=await opening(client),draft=candidate();
 draft.nodes[0].properties.scene_edges=[{to:'Missing destination'}];assert.equal((await artifacts(job,draft)).ok,true);
 const refusal=await client.err('module.read.finish',finish(mid,job));assert.equal(refusal.code,'invalid_params');assert.match(refusal.message,/exit:/);
});

test('current-interaction publication retains the current NPC and entry-to-interaction checks',async t=>{
 const client=await kernel(t),{mid,job}=await opening(client),draft=candidate();draft.ready_nodes=['scene-counter'];
 assert.equal((await artifacts(job,draft)).ok,false);
 assert.match((await client.err('module.read.finish',finish(mid,job))).message,/first interaction depends on/);
 const disconnected=candidate();disconnected.nodes.push({node_id:'scene-contact',node_kind:'scene',name:'Contact',summary:'The actual first contact.',source_refs:refs,properties:{}});
 disconnected.interaction_scene='scene-contact';disconnected.ready_nodes.push('scene-contact');disconnected.claims[0].object.node_id='scene-contact';
 assert.equal((await artifacts(job,disconnected)).ok,false);
 assert.match((await client.err('module.read.finish',finish(mid,job))).message,/route or progression/);
 disconnected.claims.push({subject_id:'scene-counter',predicate:'play-precedes',object:{node_id:'scene-contact'},truth_status:'authored-fact',source_refs:refs});
 assert.equal((await artifacts(job,disconnected)).ok,true);assert.equal((await client.ok('module.read.finish',finish(mid,job))).opening_ready,true);
});

test('review omissions name exactly the assigned pointers not answered by the submitted review',()=>{
 const review={checked:[{paths:['/nodes/0'],verdict:'supported',source_refs:refs}],missing:[]};
 assert.throws(()=>checkReviewEvidence(review,['/nodes/0','/nodes/1/summary','/coverage'],new Set([1])),
  error=>{
   assert.ok(error.message.startsWith('review omitted assigned fields: ["/nodes/1/summary","/coverage"]. '));
   assert.match(error.message,/Add checked entries answering these exact rooted pointers in paths/);
   return true;
  });
});

test('the existing source retry appends an owned attempt and preserves the failed opening evidence',async t=>{
 const client=await kernel(t),{mid,job}=await opening(client),incomplete=candidate();incomplete.ready_nodes=['scene-counter'];
 await artifacts(job,incomplete);const oldFile=join(job.work_dir,'draft.json'),oldBytes=await readFile(oldFile);
 const refusal=await client.err('module.read.finish',finish(mid,job));
 await client.ok('module.read.finish',{module_id:mid,job_id:job.job_id,lease:job.lease,outcome:'failed',detail:refusal.message});
 const asked=await client.ok('module.read.request',{module_id:mid,purpose:'opening',opening_scope:'first_interaction',retry:true});
 assert.equal(asked.state,'queued');assert.notEqual(asked.job_id,job.job_id);
 const retried=await client.ok('module.read.claim',{module_id:mid,owner:'retry-owner'});assert.equal(retried.resume_from,job.work_dir);
 assert.equal((await artifacts(retried,candidate())).ok,true);assert.equal((await client.ok('module.read.finish',finish(mid,retried))).opening_ready,true);
 assert.deepEqual(await readFile(oldFile),oldBytes,'the original failed draft is not rewritten');
 const queue=JSON.parse(await readFile(join(client.workspace,'.coc/modules',mid,'deepen-queue.json'),'utf8'));
 assert.equal(queue.find(row=>row.job_id===job.job_id).state,'failed');assert.equal(queue.find(row=>row.job_id===retried.job_id).state,'completed');
});

test('a focused alternate interaction does not replace the unrelated default opening',async t=>{
 const client=await kernel(t),{mid,job}=await opening(client),draft=candidate();
 const alternate={node_id:'scene-alternate',node_kind:'scene',name:'Alternate contact',summary:'Another authored conversation.',source_refs:refs,properties:{}};
 draft.nodes.push(alternate);draft.claims.push({subject_id:'scene-counter',predicate:'alternative-to',object:{node_id:'scene-alternate'},truth_status:'authored-fact',source_refs:refs});
 assert.equal((await artifacts(job,draft)).ok,true);await client.ok('module.read.finish',finish(mid,job));
 await client.ok('module.read.request',{module_id:mid,purpose:'opening',focus:'Alternate contact',opening_scope:'first_interaction'});
 const other=await client.ok('module.read.claim',{module_id:mid,owner:'alternate-owner'});
 const delta={interaction_scene:'scene-alternate',nodes:[alternate],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],source_needs:[],ready_nodes:['scene-alternate']};
 assert.equal((await artifacts(other,delta)).ok,true);const accepted=await client.ok('module.read.finish',finish(mid,other));assert.equal(accepted.opening_ready,true);
 const status=await client.ok('module.status',{module_id:mid});assert.equal(status.opening.start_scene,'scene-counter');
 assert.equal((await client.ok('module.read.request',{module_id:mid,purpose:'opening',focus:'Alternate contact',opening_scope:'first_interaction'})).state,'ready');
 await client.ok('module.read.request',{module_id:mid,purpose:'detail',focus:'Alternate contact',question:'A declared onward route.'});
 const detail=await client.ok('module.read.claim',{module_id:mid,owner:'alternate-detail-owner'}),changed=structuredClone(alternate);changed.properties.scene_edges=[{to:'Missing destination'}];
 const changedDraft={nodes:[changed],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-alternate']};
 assert.equal((await artifacts(detail,changedDraft)).ok,true);await client.ok('module.read.finish',finish(mid,detail));
 const changedReadiness=await client.ok('module.read.request',{module_id:mid,purpose:'opening',focus:'Alternate contact',opening_scope:'first_interaction'});
 assert.equal(changedReadiness.state,'blocked','the focused consumer cannot reuse a stale prepared boolean');
 assert.ok(changedReadiness.missing.some(value=>value.startsWith('exit:')));
 assert.equal((await client.ok('module.status',{module_id:mid})).opening.start_scene,'scene-counter');
 await client.close();const restarted=new RpcClient(client.workspace);t.after(()=>restarted.close());
 assert.equal((await restarted.ok('module.read.request',{module_id:mid,purpose:'opening',focus:'Alternate contact',opening_scope:'first_interaction'})).state,'blocked');
});

test('a later declared dangling exit is not hidden by a prepared current-interaction snapshot',async t=>{
 const client=await kernel(t),{mid,job}=await opening(client),draft=candidate();await artifacts(job,draft);await client.ok('module.read.finish',finish(mid,job));
 await client.ok('module.read.request',{module_id:mid,purpose:'detail',focus:'Counter',question:'A declared onward route.'});
 const detail=await client.ok('module.read.claim',{module_id:mid,owner:'detail-owner'}),node=structuredClone(draft.nodes[0]);node.properties.scene_edges=[{to:'Missing destination'}];
 const delta={nodes:[node],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-counter']};
 assert.equal((await artifacts(detail,delta)).ok,true);await client.ok('module.read.finish',finish(mid,detail));
 const status=await client.ok('module.status',{module_id:mid});assert.equal(status.opening_ready,false);assert.ok(status.opening.missing.some(value=>value.startsWith('exit:')));
});
