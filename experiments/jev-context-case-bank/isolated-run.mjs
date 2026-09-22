// Opt-in real API comparison. Frozen inputs; optional selectors run only after a missing gate.
import fs from 'node:fs/promises';
import {readJevApiKey} from '../../extensions/jev/agent/config.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDataset,validateBindings} from './bank.mjs';
import {MODEL,mapConcurrent} from '../jev-wide-preflight/core.mjs';
import {sha,validateLiveResponse} from './live-core.mjs';
import {prepareStages,needsSelection,gradePolicy,isolatedSchedule,isolatedSummary} from './isolated-core.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here,'../..');
const opts = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (!['--describe','--repeat','--concurrency','--out'].includes(k)) throw new Error(`Unknown option ${k}`);
  opts[k] = k === '--describe' ? true : process.argv[++i];
  if (opts[k] === undefined) throw new Error(`Missing ${k}`);
}
const repeats = Number(opts['--repeat'] ?? 2), concurrency = Number(opts['--concurrency'] ?? 4);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Concurrency must be 1-4');
const datasets = [], datasetHashes = {};
for (const name of ['builtin','pdf']) {
  const bytes = await fs.readFile(path.join(here,`${name}.json`)), data = JSON.parse(bytes);
  validateDataset(data); validateBindings(data,root);
  datasets.push(data); datasetHashes[data.id] = sha(bytes);
}
const tasks = isolatedSchedule(datasets,repeats).map((t,index) => {
  const data = datasets.find(d => d.id === t.dataset_id), stages = prepareStages(data,t.case_id,t.arm_id);
  return {...t,number:String(index + 1).padStart(3,'0'),data,stages};
});
const packets = tasks.flatMap(t => (t.policy === 'mixed' ? ['mixed'] : ['gate','selection']).map(stage => {
  const prepared = t.stages[stage], serialized = JSON.stringify(prepared.request), bytes = Buffer.byteLength(serialized);
  if (bytes > 30_000) throw new Error('Request exceeds frozen byte bound');
  return {id:`${t.number}-${stage}`,stage,optional:stage === 'selection',prepared,bytes,hash:sha(serialized)};
}));
const codeSources = {'bank.mjs':'bank.mjs','live-core.mjs':'live-core.mjs',
  'isolated-core.mjs':'isolated-core.mjs','isolated-run.mjs':'isolated-run.mjs',
  'wide-core.mjs':'../jev-wide-preflight/core.mjs','wide-incremental-core.mjs':'../jev-wide-preflight/incremental-core.mjs'};
const code = {};
for (const [name,source] of Object.entries(codeSources)) code[name] = await fs.readFile(path.join(here,source));
const inventory = tasks.map(({data,stages,...t}) => t);
const manifest = {version:1,experiment:'isolated-existing-context-gate',model:MODEL,repeats,concurrency,
  dataset_hashes:datasetHashes,code_sources:codeSources,
  code_hashes:Object.fromEntries(Object.entries(code).map(([f,b]) => [f,sha(b)])),
  inventory,packets:packets.map(({prepared,...p}) => p),
  provider_calls_minimum:tasks.length,provider_calls_maximum:packets.length,
  policy:'Mixed baseline is unchanged all-subset joint. Isolated gate removes candidate field, selection question and candidate-availability policy sentence; other current state and questions unchanged. If content=complete, host selects nothing regardless of source_support. If missing, selection-only request uses the unchanged existing+candidate state and exhaustive subset menu. No exact prefilter, confidence threshold, source override or gold routing.',
  control:'Mixed-host-stop is a deterministic alternative decision over the SAME mixed response: content=complete forces an empty selection. It sends no extra API request. Keep raw mixed prediction and host-derived decision separate.',
  causal_limit:'A policy-bundle comparison, not a single-variable proof of candidate contamination. Both question scope and state projection change.',
  order:'Repeat two reverses both arm order and actual policy order; payloads do not depend on repeat.',
  limits:'11 existing selection arms when using the frozen bank; not the full eight-family cohort, full-book retrieval or a live game. Source-unit containment is not downstream answer correctness. No post-selection gate recheck.',
  price_basis:{input_usd_per_million:.042,scope:'Previously checked input-only estimate, not a bill.'},
  evaluation_labels_sent:false,production_modified:false,live_play:false,node:process.version};
if (opts['--describe']) {console.log(JSON.stringify({...manifest,provider_calls:0},null,2));process.exit(0);}
const key = readJevApiKey();
if (!key) throw new Error('Shared Jev credentials must be mounted; no request sent');
const out = path.resolve(opts['--out'] ?? path.join(root,'.pi/prototypes/jev-isolated-gate/runs'));
await fs.mkdir(out,{recursive:true});
const dir = await fs.mkdtemp(path.join(out,`${new Date().toISOString().replaceAll(':','-')}-comparison-`));
const save = (name,value) => fs.writeFile(path.join(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
await save('manifest.json',{...manifest,started_at:new Date().toISOString()});
await save('evaluation-only-datasets.json',datasets);
for (const [file,bytes] of Object.entries(code)) await fs.writeFile(path.join(dir,`executed-${file}`),bytes,{flag:'wx'});
for (const p of packets) {
  await save(`request-${p.id}.json`,p.prepared.request);
  await save(`evaluation-only-binding-${p.id}.json`,p.prepared.binding);
}
let stopped = false;
const attempts = [], actual = [], started = performance.now();
async function call(number,stage) {
  if (stopped) return null;
  const p = packets.find(p => p.id === `${number}-${stage}`);
  await save(`attempt-${p.id}.json`,{id:p.id,request_sha256:p.hash,started_at:new Date().toISOString(),phase:'dispatch_started'});
  attempts.push(p.id);
  const began = performance.now();
  let r;
  try {
    const response = await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify(p.prepared.request),signal:AbortSignal.timeout(30_000)});
    const text = (await response.text()).replaceAll(key,'[redacted]');
    r = {ok:response.ok,status:response.status};
    if (response.ok) {
      try {
        r.body = JSON.parse(text);
        r.protocol_error = validateLiveResponse(p.prepared.request,r.body);
        if (!r.protocol_error && r.body.model !== MODEL) r.protocol_error = 'model_mismatch';
        if (r.protocol_error) r.ok = false;
      } catch {r.ok = false;r.protocol_error = 'invalid_json';r.error_body = text.slice(0,4096);}
    } else r.error_body = text.slice(0,4096);
  } catch (error) {r = {ok:false,error:error.name};}
  r.ms = Math.round(performance.now()-began);
  await save(`response-${p.id}.json`,r);
  actual.push({id:p.id,...r});
  if (!r.ok) stopped = true;
  return r;
}
function usage(responses) {
  return Object.fromEntries(['input_tokens','output_tokens'].map(k => [k,
    responses.length && responses.every(r => Number.isSafeInteger(r.body?.usage?.[k]) && r.body.usage[k] >= 0)
      ? responses.reduce((n,r) => n+r.body.usage[k],0) : null]));
}
const records = (await mapConcurrent(tasks,concurrency,async t => {
  if (stopped) return [];
  const wallStart = performance.now(), first = await call(t.number,t.policy === 'mixed' ? 'mixed' : 'gate');
  if (!first) return [];
  const responses = [first];
  let second = null, selectionRequired = false;
  if (t.policy === 'isolated' && first.ok) {
    selectionRequired = needsSelection(t.stages.gate,first.body);
    if (selectionRequired) {
      second = await call(t.number,'selection');
      if (second) responses.push(second);
    }
  }
  const ok = first.ok && (!selectionRequired || Boolean(second?.ok));
  const {data,stages,...meta} = t;
  const common = {...meta,ok,provider_calls:responses.length,usage:usage(responses),
    ms:responses.reduce((n,r) => n+r.ms,0),policy_wall_ms:Math.round(performance.now()-wallStart),
    stage_ids:[`${t.number}-${t.policy === 'mixed' ? 'mixed' : 'gate'}`,...(second ? [`${t.number}-selection`] : [])],
    selection_required:selectionRequired,selection_not_attempted_after_stop:selectionRequired && !second};
  const policies = t.policy === 'mixed' ? ['mixed','mixed-host-stop'] : ['isolated'];
  const rows = policies.map(policy => ({...common,policy,derived_from_mixed:policy === 'mixed-host-stop',
    grade:ok ? gradePolicy(data,t.case_id,t.arm_id,policy,stages,first.body,second?.body) : null}));
  await save(`record-${t.number}.json`,rows);
  console.log(JSON.stringify(rows.map(r => ({task:t.number,case:r.case_id,arm:r.arm_id,repeat:r.repeat,policy:r.policy,
    ok:r.ok,calls:r.provider_calls,all_correct:r.grade?.all_correct ?? null,selection_exact:r.grade?.selection_exact ?? null}))));
  return rows;
})).flat();
await save('records.json',records);
await save('summary.json',isolatedSummary(records,inventory));
await save('execution.json',{attempted_calls:attempts.length,completed_calls:actual.length,usage:usage(actual),
  wall_ms:Math.round(performance.now()-started),stopped,completed_policy_tasks:records.filter(r => !r.derived_from_mixed).length,
  planned_policy_tasks:tasks.length,unattempted_packet_ids:packets.filter(p => !attempts.includes(p.id)).map(p => p.id),
  warning:'Unattempted selectors can be intentional host skips. Prewritten packet files do not prove a call. Attempts without responses have unknown outcome and cost.'});
await save('completion.json',{complete:!stopped && records.filter(r => !r.derived_from_mixed).length === tasks.length,completed_at:new Date().toISOString()});
console.log(JSON.stringify({run_directory:dir,attempted_calls:attempts.length,stopped,comparison:isolatedSummary(records,inventory)}));
if (stopped) process.exitCode = 1;
