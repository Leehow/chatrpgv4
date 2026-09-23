// Opt-in prospective validation. Every policy uses the same single Jev response.
import fs from 'node:fs/promises';
import {readJevApiKey} from '../../extensions/jev/agent/config.js';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {validateDataset,validateBindings} from './bank.mjs';
import {MODEL,mapConcurrent} from '../jev-wide-preflight/core.mjs';
import {sha,validateLiveResponse} from './live-core.mjs';
import {prepareUnseen,scoreUnseen,unseenSchedule,unseenSummary,UNSEEN_POLICIES,dispatchAfterIntent,readResponseText} from './unseen-core.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here,'../..');
const opts = {};
for (let i=2;i<process.argv.length;i++) {
  const k=process.argv[i];
  if (!['--describe','--repeat','--concurrency','--audit','--out'].includes(k)) throw new Error(`Unknown option ${k}`);
  opts[k]=k==='--describe' ? true : process.argv[++i];
  if (opts[k]===undefined) throw new Error(`Missing ${k}`);
}
const repeats=Number(opts['--repeat']??2), concurrency=Number(opts['--concurrency']??4);
if (!Number.isInteger(concurrency)||concurrency<1||concurrency>4) throw new Error('Concurrency must be 1-4');
const datasets=[],datasetBytes={},bindings={};
for (const file of ['unseen-eye.json','unseen-train.json','unseen-bast.json']) {
  const bytes=await fs.readFile(path.join(here,file)), data=JSON.parse(bytes);
  assert.match(data.id,/^[a-z0-9-]+$/);
  validateDataset(data); bindings[data.id]=validateBindings(data,root);
  assert(!datasetBytes[data.id],'Duplicate dataset');
  datasets.push(data);datasetBytes[data.id]=bytes;
}
const tasks=unseenSchedule(datasets,repeats).map((t,i)=>{
  const data=datasets.find(d=>d.id===t.dataset_id), stages=prepareUnseen(data,t.case_id,t.arm_id);
  const request=stages.mixed.request, serialized=JSON.stringify(request), bytes=Buffer.byteLength(serialized);
  if (bytes>30_000) throw new Error('Frozen request byte bound exceeded');
  return {...t,number:String(i+1).padStart(3,'0'),data,stages,request,bytes,hash:sha(serialized)};
});
const codeSources={'bank.mjs':'bank.mjs','live-core.mjs':'live-core.mjs','isolated-core.mjs':'isolated-core.mjs',
  'isolated-analysis.mjs':'isolated-analysis.mjs','unseen-core.mjs':'unseen-core.mjs','unseen-run.mjs':'unseen-run.mjs',
  'wide-core.mjs':'../jev-wide-preflight/core.mjs','wide-incremental-core.mjs':'../jev-wide-preflight/incremental-core.mjs'};
const code={};for (const [name,source]of Object.entries(codeSources))code[name]=await fs.readFile(path.join(here,source));
const hashes=Object.fromEntries(Object.entries(datasetBytes).map(([id,bytes])=>[id,sha(bytes)]));
const auditPath=path.resolve(opts['--audit']??path.join(root,'.pi/prototypes/jev-unseen-validation/preflight.json'));
let audit=null;
try {audit=JSON.parse(await fs.readFile(auditPath));}catch(e){if(!opts['--describe']||e.code!=='ENOENT')throw e;}
if (audit) {
  assert.equal(audit.approved,true,'Independent preflight must pass before API calls');
  assert.deepEqual(audit.dataset_hashes,hashes,'Dataset changed after preflight');
  for (const d of datasets) for (const id of bindings[d.id].visual_review_required)
    assert(audit.visual_sources_reviewed?.[d.id]?.includes(id),`Visual quote not reviewed: ${id}`);
}
const manifest={version:1,experiment:'prospective-unissued-masks-cases',model:MODEL,repeats,concurrency,
  dataset_hashes:hashes,bindings,code_sources:codeSources,code_hashes:Object.fromEntries(Object.entries(code).map(([n,b])=>[n,sha(b)])),
  policies:UNSEEN_POLICIES,provider_calls_planned:tasks.length,provider_call_budget:48,request_byte_bound:30_000,
  policy:'Unchanged all-subset joint request once per input. Score raw; same-response host-stop; same-response host-stop plus zero-original-source absence floor. No confidence tuning, semantic deduplication, candidate prefilter, second model call or post-response gold edits.',
  semantics:'Absence of source_excerpt can deny complete original-source support; presence cannot prove semantic coverage. Host stopping can lose necessary evidence if the model falsely says complete: lost_coverage_vs_raw is reported.',
  order:'Repeat two reverses input order; all payloads are prepared before the first call and repeat does not alter text.',
  exposure:'New project-unissued questions selected from previously inspected Masks designs. Not an unseen-book or model-training claim. Fixed pools, not retrieval or live game.',
  audit_path:auditPath,audit_sha256:audit?sha(JSON.stringify(audit)):null,
  evaluation_labels_sent:false,production_changed:false,live_play:false,node:process.version,
  inventory:tasks.map(({data,stages,request,...t})=>t)};
if (opts['--describe']) {console.log(JSON.stringify({...manifest,provider_calls:0,preflight_ready:Boolean(audit)},null,2));process.exit(0);}
assert(audit,'Preflight audit is required');
const key=readJevApiKey();if(!key)throw new Error('Shared Jev credentials must be mounted; no request sent');
const out=path.resolve(opts['--out']??path.join(root,'.pi/prototypes/jev-unseen-validation/runs'));
await fs.mkdir(out,{recursive:true});
const dir=await fs.mkdtemp(path.join(out,`${new Date().toISOString().replaceAll(':','-')}-validation-`));
const save=(name,v)=>fs.writeFile(path.join(dir,name),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
await save('manifest.json',{...manifest,started_at:new Date().toISOString()});await save('preflight.json',audit);
for(const[id,bytes]of Object.entries(datasetBytes))await fs.writeFile(path.join(dir,`evaluation-only-${id}.json`),bytes,{flag:'wx'});
for(const[file,bytes]of Object.entries(code))await fs.writeFile(path.join(dir,`executed-${file}`),bytes,{flag:'wx'});
for(const t of tasks){await save(`request-${t.number}.json`,t.request);await save(`evaluation-only-binding-${t.number}.json`,t.stages.mixed.binding);}
let stopped=false;const attempts=[],started=performance.now();
const records=(await mapConcurrent(tasks,concurrency,async t=>{
  const r=await dispatchAfterIntent({isStopped:()=>stopped,
    writeIntent:()=>save(`attempt-${t.number}.json`,{number:t.number,request_sha256:t.hash,started_at:new Date().toISOString(),phase:'dispatch_preparing'}),
    cancelled:()=>save(`cancelled-${t.number}.json`,{number:t.number,phase:'cancelled_before_fetch',reason:'Another request failed while intent was being recorded.'}),
    send:async()=>{
    attempts.push(t.number);const began=performance.now();let r;
    try{
    const response=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify(t.request),signal:AbortSignal.timeout(30_000)});
    const text=(await readResponseText(response,()=>{stopped=true;})).replaceAll(key,'[redacted]');r={ok:response.ok,status:response.status};
    if(response.ok){try{r.body=JSON.parse(text);r.protocol_error=validateLiveResponse(t.request,r.body);
      if(!r.protocol_error&&r.body.model!==MODEL)r.protocol_error='model_mismatch';if(r.protocol_error)r.ok=false;
    }catch{r.ok=false;r.protocol_error='invalid_json';r.error_body=text.slice(0,4096);}}
    else r.error_body=text.slice(0,4096);
    }catch(error){r={ok:false,error:error.name};}
    r.ms=Math.round(performance.now()-began);
    if(!r.ok)stopped=true;
    return r;
  }});
  if(!r)return [];
  await save(`response-${t.number}.json`,r);
  const grades=r.ok?scoreUnseen(t.data,t.case_id,t.arm_id,t.stages,r.body):null;
  const rows=UNSEEN_POLICIES.map(policy=>({dataset_id:t.dataset_id,case_id:t.case_id,arm_id:t.arm_id,repeat:t.repeat,
    request_number:Number(t.number),policy,ok:r.ok,ms:r.ms,status:r.status??null,usage:r.body?.usage??null,
    grade:grades?grades[policy]:null,derived_from_same_response:policy!=='raw'}));
  await save(`record-${t.number}.json`,rows);
  console.log(JSON.stringify({request:Number(t.number),case:t.case_id,arm:t.arm_id,repeat:t.repeat,ok:r.ok,ms:r.ms,
    policies:rows.map(x=>({policy:x.policy,all_correct:x.grade?.all_correct??null,selection_exact:x.grade?.selection_exact??null}))}));
  return rows;
})).flat();
await save('records.json',records);const summary=unseenSummary(records,tasks.length);
await save('summary.json',summary);
await save('execution.json',{attempted_requests:attempts.length,completed_responses:records.filter(r=>r.policy==='raw').length,
  wall_ms:Math.round(performance.now()-started),stopped,
  warning:'Policy rows share responses. Unavailable responses are not semantic failures or zero-cost successes. Preparing attempts with cancellation markers never fetched; attempts without a response or cancellation have unknown outcome.'});
await save('completion.json',{complete:!stopped&&attempts.length===tasks.length,completed_at:new Date().toISOString()});
console.log(JSON.stringify({run_directory:dir,stopped,summary}));if(stopped)process.exitCode=1;
