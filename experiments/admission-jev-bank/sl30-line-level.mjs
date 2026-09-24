// SL-30 measurement (contract §32.12.3): the long tables' Keeper `apply` batches, per line.
//   - `typed`: the §32.10 typed family on the whole batch (minimum confidence 0), so each line's verdict and confidence
//     can be read against the fast-path confidence (§32.11) and any other threshold afterwards;
//   - `lane_batch`: the §32.2 lane on the whole batch, as the table reviews it (cap 120 s, so a slow round is measured to
//     its end);
//   - `lane_line`: the lane on each line alone, with the same player-visible context: the per-kind latency and a per-line
//     label the batch verdict cannot give.
// Cases run through a small worker pool (`--concurrency`, default 3), one call per worker at a time.
//   node experiments/admission-jev-bank/sl30-line-level.mjs --bank <bank.jsonl> --out <out.jsonl> --auth <auth.json>
//     [--runs 3] [--line-runs 2] [--cap 120000] [--lane-model opencode-go/deepseek-v4.1-flash] [--concurrency 3] [--ids a,b]
// The auth file holds the lane provider's credential (read by Pi's ModelRuntime, never printed). The Jev key is read
// from EXT_JEV_APIKEY or the App's vault. Duplicate batches (the same turn's identical lines: a resend) are measured once.
import {appendFileSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
const ROOT = join(import.meta.dirname, '../..');
const argv = process.argv.slice(2), arg = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const bankPath = arg('--bank'), outPath = arg('--out'), authPath = arg('--auth');
const runs = Number(arg('--runs', '3')), lineRuns = Number(arg('--line-runs', '2')), cap = Number(arg('--cap', '120000'));
const laneModel = arg('--lane-model', 'opencode-go/deepseek-v4.1-flash'), concurrency = Number(arg('--concurrency', '3'));
const ids = arg('--ids') ? new Set(arg('--ids').split(',')) : undefined;
if (!bankPath || !outPath || !authPath) throw new Error('--bank, --out and --auth are required');

const {readVaultSecret} = await import(`${ROOT}/experiments/single-loop-routing/vault.mjs`);
process.env.EXT_JEV_APIKEY ||= readVaultSecret('EXT_JEV_APIKEY') ?? '';
if (!process.env.EXT_JEV_APIKEY) throw new Error('no Jev key');
process.env.PI_COC_ADMISSION_MODEL = laneModel;
const {ModelRuntime, ModelRegistry} = await import(`${ROOT}/build/node_modules/@earendil-works/pi-coding-agent/dist/index.js`);
const {reviewAdmission} = await import(`${ROOT}/extensions/kernel/admission.ts`);
const {createDecisionAdapter} = await import(`${ROOT}/runtime/jev/decision-adapter.ts`);
const {TaskLease} = await import(`${ROOT}/runtime/jev/task-context.ts`);
const {admissionJevBindings, runAdmissionJev} = await import(`${ROOT}/runtime/jev/admission-domain.ts`);

const runtime = await ModelRuntime.create({authPath, modelsPath: null, modelsStorePath: join(dirname(authPath), 'models-store.json'), refreshOnCreate: false});
const registry = new ModelRegistry(runtime);
const adapter = createDecisionAdapter({env: process.env, maxConcurrency: 4});
const seen = new Set();
const cases = readFileSync(bankPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  .filter(value => value.verb === 'apply' && (!ids || ids.has(value.id)))
  .filter(value => { const key = JSON.stringify([value.campaign, value.turn, value.input.proposal]); if (seen.has(key)) return false; seen.add(key); return true; });

async function typed(input) {
  const began = Date.now(), b = admissionJevBindings(input);
  const lease = new TaskLease({owner: 'action-admission', goal: 'SL-30 offline measurement', scope: b.scope, capabilities: ['decision'], readSet: b.readSet,
    budget: {deadlineAt: Date.now() + 20_000, remainingInputTokens: 200_000, remainingOutputTokens: 20_000, remainingCostUsd: 0.02, remainingActions: 4}});
  try {
    const result = await runAdmissionJev(input, adapter, lease, {minConfidence: 0});
    return {status: result.status, reason: result.reason ?? null, verdict: result.verdict ?? null, confidence: result.confidence ?? null,
      lines: (result.lines ?? []).map(line => ({verdict: line.verdict, confidence: line.confidence, missing: line.missing})), ms: Date.now() - began, calls: result.calls};
  } catch (error) { return {status: 'error', reason: String(error), ms: Date.now() - began}; } finally { lease.close(); }
}

async function lane(value, lines, kinds, tag) {
  const input = value.input;
  const ctx = {cwd: ROOT, model: undefined, modelRegistry: registry, sessionManager: {getSessionId: () => `sl30-measure-${value.id}-${tag}`}};
  const proposal = {tool: 'apply', key: `${value.id}:${tag}`, lines, kinds};
  const context = {turn: input.turn, playerText: input.playerText, ...(input.interruptedPlayerText ? {interruptedPlayerText: input.interruptedPlayerText} : {}),
    investigators: input.investigators, ...(input.scene ? {scene: input.scene} : {}), present: input.present ?? [], delivered: input.delivered ?? [],
    landed: input.landed ?? [], refused: input.refused ?? []};
  const outcome = await reviewAdmission({ctx, proposal, context, record: () => {}, timeoutMs: cap});
  return outcome.ok === true
    ? {ok: true, verdict: outcome.verdict.verdict, grounds: outcome.verdict.grounds, missing: outcome.verdict.missing ?? null,
      ms: outcome.ms, first_byte_ms: outcome.meta?.first_byte_ms ?? null, timed_out: outcome.meta?.timed_out ?? false}
    : {ok: false, reason: outcome.reason ?? 'late', detail: outcome.detail ?? null, ms: outcome.ms, first_byte_ms: outcome.meta?.first_byte_ms ?? null};
}

// The jobs, interleaved by run so a provider's slow minute does not fall on one case's every run.
const jobs = [];
for (let run = 1; run <= Math.max(runs, lineRuns); run++) for (const value of cases) {
  if (run <= runs) jobs.push({kind: 'typed', value, run}, {kind: 'lane_batch', value, run});
  if (run <= lineRuns) value.input.proposal.forEach((line, index) => jobs.push({kind: 'lane_line', value, run, index}));
}
writeFileSync(outPath, '');
let next = 0, done = 0;
await Promise.all(Array.from({length: concurrency}, async () => {
  for (;;) {
    const job = jobs[next++];
    if (!job) return;
    const {value, run} = job;
    const base = {id: value.id, campaign: value.campaign, turn: value.turn, run, kinds: value.kinds, recorded: value.lane, lane_model: laneModel, cap_ms: cap};
    const row = job.kind === 'typed' ? {...base, measure: 'typed', lines: value.input.proposal, typed: await typed(value.input)}
      : job.kind === 'lane_batch' ? {...base, measure: 'lane_batch', lane: await lane(value, value.input.proposal, value.kinds, `batch-${run}`)}
      : {...base, measure: 'lane_line', index: job.index, kind: value.kinds[job.index], line: value.input.proposal[job.index],
        lane: await lane(value, [value.input.proposal[job.index]], [value.kinds[job.index]], `line-${job.index}-${run}`)};
    appendFileSync(outPath, JSON.stringify(row) + '\n');
    done++;
    const answer = row.typed ? `typed ${row.typed.verdict ?? row.typed.status} ${row.typed.confidence ?? ''}` : `lane ${row.lane.ok ? row.lane.verdict : row.lane.reason} ${row.lane.ms}ms`;
    process.stderr.write(`${done}/${jobs.length} ${row.measure} ${value.id} r${run}${row.index !== undefined ? ` l${row.index}:${row.kind}` : ''} ${answer}\n`);
  }
}));
process.stderr.write('done\n');
