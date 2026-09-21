// Opt-in real Jev experiment. Writes immutable per-request evidence, never game state.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDataset, validateBindings} from './bank.mjs';
import {MODEL, mapConcurrent} from '../jev-wide-preflight/core.mjs';
import {sha, prepareRequest, validateLiveResponse, gradeResponse, schedule, summarize, pairedSummary} from './live-core.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const opts = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (!['--describe', '--probe', '--repeat', '--concurrency', '--out'].includes(key)) throw new Error(`Unknown option ${key}`);
  opts[key] = ['--describe', '--probe'].includes(key) ? true : process.argv[++i];
  if (opts[key] === undefined) throw new Error(`Missing ${key}`);
}
const repeats = Number(opts['--repeat'] ?? 2), concurrency = Number(opts['--concurrency'] ?? 4);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Concurrency must be 1-4');
const datasets = [], hashes = {};
for (const name of ['builtin', 'pdf']) {
  const bytes = await fs.readFile(path.join(here, `${name}.json`)), data = JSON.parse(bytes);
  validateDataset(data); validateBindings(data, root);
  datasets.push(data); hashes[data.id] = sha(bytes);
}
let tasks = schedule(datasets, repeats);
if (opts['--probe']) tasks = tasks.filter(t => t.case_id === 'beetle-joint-supplement' && t.arm_id === 'empty' && t.repeat === 1 && t.policy === 'joint-subsets');
const preparedTasks = tasks.map(task => {
  const data = datasets.find(d => d.id === task.dataset_id);
  const prepared = prepareRequest(data, task.case_id, task.arm_id, task.policy);
  const serialized = JSON.stringify(prepared.request), bytes = Buffer.byteLength(serialized);
  if (bytes > 30_000) throw new Error('Request exceeds frozen byte bound');
  return {task, data, prepared, bytes, request_sha256: sha(serialized)};
});
const manifest = {version: 1, experiment: 'eight-family-frozen-pool', model: MODEL, repeats, concurrency,
  probe: Boolean(opts['--probe']), dataset_hashes: hashes,
  bank_sha256: sha(await fs.readFile(path.join(here, 'bank.mjs'))),
  policy_sha256: sha(await fs.readFile(path.join(here, 'live-core.mjs'))),
  runner_sha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
  provider_calls_planned: tasks.length, request_byte_bound: 30_000, timeout_ms: 30_000,
  policy: 'All-subset joint Choice (up to six candidates, 64 combinations, no oracle menu pruning) versus independent adds_needed/redundant/unrelated/uncertain Choices over the same pool. All other questions are unchanged.',
  order: 'Repeat one uses dataset order and joint first; repeat two reverses arm order and uses independent first. Request text is unchanged across repeats.',
  evaluation_labels_sent: false, acceptance: false, live_play: false,
  limits: 'Frozen small-pool component diagnostics, not full-book retrieval, downstream reader accuracy, production or gameplay. Exact source-unit normalization is a host operation, not semantic model credit. Source provenance and factual completeness are separate axes.',
  price_basis: {input_usd_per_million: .042, source: 'https://docs.typesafe.ai/models', checked_at: '2026-09-21', scope: 'Input-only estimate from the previously checked rate; not a billing receipt or end-to-end saving.'},
  inventory: preparedTasks.map(({task, bytes, request_sha256}) => ({...task, request_bytes: bytes, request_sha256})),
};
if (opts['--describe']) {console.log(JSON.stringify({...manifest, provider_calls: 0}, null, 2)); process.exit(0);}
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error('TYPESAFE_API_KEY must be mounted; no request sent');
const out = path.resolve(opts['--out'] ?? path.join(root, '.pi/prototypes/jev-eight-family-live/runs'));
await fs.mkdir(out, {recursive: true});
const dir = await fs.mkdtemp(path.join(out, `${new Date().toISOString().replaceAll(':', '-')}-${opts['--probe'] ? 'menu-probe' : 'comparison'}-`));
const save = (name, value) => fs.writeFile(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
await save('manifest.json', {...manifest, started_at: new Date().toISOString()});
await save('evaluation-only-datasets.json', datasets);
for (const [file, field] of [['live-core.mjs', 'policy_sha256'], ['live-run.mjs', 'runner_sha256']]) {
  const code = await fs.readFile(path.join(here, file));
  if (sha(code) !== manifest[field]) throw new Error('Code changed during preparation');
  await fs.writeFile(path.join(dir, `executed-${file}`), code);
}
// Every payload is frozen before the first provider call.
for (let i = 0; i < preparedTasks.length; i++) {
  await save(`request-${String(i + 1).padStart(3, '0')}.json`, preparedTasks[i].prepared.request);
  await save(`evaluation-only-binding-${String(i + 1).padStart(3, '0')}.json`, preparedTasks[i].prepared.binding);
}
let stopped = false;
const started = performance.now();
const records = (await mapConcurrent(preparedTasks, concurrency, async (item, index) => {
  if (stopped) return null;
  const number = String(index + 1).padStart(3, '0');
  // This proves an attempt began, not that the provider received or billed it.
  // After interruption, an attempt without a response has an unknown outcome.
  await save(`attempt-${number}.json`, {request_number: index + 1, started_at: new Date().toISOString(),
    request_sha256: item.request_sha256, phase: 'dispatch_started'});
  const began = performance.now();
  let result;
  try {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {method: 'POST',
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(item.prepared.request), signal: AbortSignal.timeout(30_000)});
    const text = await response.text();
    result = {ok: response.ok, status: response.status, retry_after: response.headers.get('retry-after')};
    if (response.ok) {
      try {result.body = JSON.parse(text); result.protocol_error = validateLiveResponse(item.prepared.request, result.body); if (result.protocol_error) result.ok = false;}
      catch {result.ok = false; result.protocol_error = 'invalid_json'; result.error_body = text.replaceAll(key, '[redacted]').slice(0, 4096);}
    } else result.error_body = text.replaceAll(key, '[redacted]').slice(0, 4096);
  } catch (error) {result = {ok: false, error: error.name};}
  result.ms = Math.round(performance.now() - began);
  await save(`response-${number}.json`, result);
  if (!result.ok) stopped = true;
  const record = {...item.task, request_number: index + 1, request_bytes: item.bytes,
    ok: result.ok, status: result.status ?? null, ms: result.ms, protocol_error: result.protocol_error ?? null,
    transport_error: result.error ?? null, returned_model: result.body?.model ?? null,
    usage: result.body?.usage ?? null, grade: result.ok ? gradeResponse(item.data, item.task.case_id, item.task.arm_id, item.task.policy, item.prepared, result.body) : null};
  await save(`record-${number}.json`, record);
  console.log(JSON.stringify({request: index + 1, case: record.case_id, arm: record.arm_id, policy: record.policy,
    repeat: record.repeat, ok: record.ok, ms: record.ms, all_correct: record.grade?.all_correct ?? null,
    selection_exact: record.grade?.selection_exact ?? null}));
  return record;
})).filter(Boolean);
await save('records.json', records);
await save('summary.json', {policies: summarize(records), planned_requests: tasks.length, attempted_requests: records.length,
  wall_ms: Math.round(performance.now() - started), stopped_after_unavailable: stopped,
  not_attempted: tasks.length - records.length, model_semantic_pass_not_assumed: true,
  comparison: 'Unpaired totals above are not a head-to-head comparison; use paired-summary.json.'});
await save('paired-summary.json', pairedSummary(records, tasks));
await save('completion.json', {complete: !stopped && records.length === tasks.length, completed_at: new Date().toISOString()});
console.log(JSON.stringify({run_directory: dir, records: records.length, stopped, policies: summarize(records)}));
if (stopped) process.exitCode = 1;
