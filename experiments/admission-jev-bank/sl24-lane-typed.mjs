// SL-24 measurement (contract §32.12.2): put recorded admission cases to the §32.2 lane AND the §32.10 typed family
// at the same moment, as the concurrent review does, and keep what each answered and when. The lane runs with a long cap
// (default 120 s) so the rounds the live table cut at 12 s are measured to their end; the typed family runs at minimum
// confidence 0, so thresholds can be re-applied to the stored answers. Cases run one at a time so the lane's latency is
// the provider's, not this script's concurrency.
//   node experiments/admission-jev-bank/sl24-lane-typed.mjs --bank <bank.jsonl> --out <out.jsonl> --auth <auth.json>
//     [--runs 3] [--cap 120000] [--lane-model opencode-go/deepseek-v4.1-flash] [--typed on|off] [--ids a,b]
//   node experiments/admission-jev-bank/sl24-lane-typed.mjs --bank <bank.jsonl> --out <out.jsonl> --lane off --filter late-cash [--concurrency 8]
//     (typed only, over the lane-labelled `apply` batches whose triggering kinds are all among the owner's bookkeeping kinds
//     -- move, clue, handout, time, cash -- and include cash: the part of the §32.12.2 late admission SL-10 never typed)
// The auth file holds the lane provider's credential (read by Pi's ModelRuntime, never printed). The Jev key is read
// from EXT_JEV_APIKEY or the App's vault.
import {appendFileSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
const ROOT = join(import.meta.dirname, '../..');
const argv = process.argv.slice(2), arg = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const bankPath = arg('--bank'), outPath = arg('--out'), authPath = arg('--auth');
const runs = Number(arg('--runs', '3')), cap = Number(arg('--cap', '120000')), laneModel = arg('--lane-model', 'opencode-go/deepseek-v4.1-flash');
const typedOn = arg('--typed', 'on') !== 'off', ids = arg('--ids') ? new Set(arg('--ids').split(',')) : undefined;
const laneOn = arg('--lane', 'on') !== 'off', filter = arg('--filter'), concurrency = Number(arg('--concurrency', '8'));
if (!bankPath || !outPath || (laneOn && !authPath)) throw new Error('--bank and --out are required, and --auth with the lane on');
const TRIGGER = new Set(['move', 'clue', 'time', 'cash', 'item', 'handout', 'map', 'object', 'usage']);
const LATE = new Set(['move', 'clue', 'handout', 'time', 'cash']);
const lateCash = value => {
  const triggering = (value.kinds ?? []).filter(kind => TRIGGER.has(kind));
  return value.verb === 'apply' && triggering.includes('cash') && triggering.every(kind => LATE.has(kind)) && !!value.lane?.verdict;
};

const {readVaultSecret} = await import(`${ROOT}/experiments/single-loop-routing/vault.mjs`);
process.env.EXT_JEV_APIKEY ||= readVaultSecret('EXT_JEV_APIKEY') ?? '';
if (typedOn && !process.env.EXT_JEV_APIKEY) throw new Error('no Jev key');
process.env.PI_COC_ADMISSION_MODEL = laneModel;
const {ModelRuntime, ModelRegistry} = await import(`${ROOT}/build/node_modules/@earendil-works/pi-coding-agent/dist/index.js`);
const {reviewAdmission} = await import(`${ROOT}/extensions/kernel/admission.ts`);
const {createDecisionAdapter} = await import(`${ROOT}/runtime/jev/decision-adapter.ts`);
const {TaskLease} = await import(`${ROOT}/runtime/jev/task-context.ts`);
const {admissionJevBindings, runAdmissionJev} = await import(`${ROOT}/runtime/jev/admission-domain.ts`);

const runtime = laneOn ? await ModelRuntime.create({authPath, modelsPath: null, modelsStorePath: join(dirname(authPath), 'models-store.json'), refreshOnCreate: false}) : undefined;
const registry = runtime ? new ModelRegistry(runtime) : undefined;
const adapter = typedOn ? createDecisionAdapter({env: process.env, maxConcurrency: 4}) : undefined;
const cases = readFileSync(bankPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(value => !ids || ids.has(value.id))
  .filter(value => filter !== 'late-cash' || lateCash(value));

async function typed(input) {
  if (!adapter) return null;
  const began = Date.now(), b = admissionJevBindings(input);
  const lease = new TaskLease({owner: 'action-admission', goal: 'SL-24 offline measurement', scope: b.scope, capabilities: ['decision'], readSet: b.readSet,
    budget: {deadlineAt: Date.now() + 20_000, remainingInputTokens: 200_000, remainingOutputTokens: 20_000, remainingCostUsd: 0.02, remainingActions: 4}});
  try {
    const result = await runAdmissionJev(input, adapter, lease, {minConfidence: 0});
    return {status: result.status, reason: result.reason ?? null, verdict: result.verdict ?? null, confidence: result.confidence ?? null,
      lines: (result.lines ?? []).map(line => ({verdict: line.verdict, confidence: line.confidence, missing: line.missing})), ms: Date.now() - began, calls: result.calls};
  } catch (error) { return {status: 'error', reason: String(error), ms: Date.now() - began}; } finally { lease.close(); }
}

async function lane(value, run) {
  const input = value.input;
  const ctx = {cwd: ROOT, model: undefined, modelRegistry: registry, sessionManager: {getSessionId: () => `sl24-measure-${value.id}-${run}`}};
  const proposal = {tool: value.verb, key: value.id, lines: input.proposal, kinds: value.kinds};
  const context = {turn: input.turn, playerText: input.playerText, ...(input.interruptedPlayerText ? {interruptedPlayerText: input.interruptedPlayerText} : {}),
    investigators: input.investigators, ...(input.scene ? {scene: input.scene} : {}), present: input.present ?? [], delivered: input.delivered ?? [],
    landed: input.landed ?? [], refused: input.refused ?? []};
  const outcome = await reviewAdmission({ctx, proposal, context, record: () => {}, timeoutMs: cap});
  return outcome.ok
    ? {ok: true, verdict: outcome.verdict.verdict, grounds: outcome.verdict.grounds, grounds_empty: !outcome.verdict.grounds?.trim(), missing: outcome.verdict.missing ?? null,
      ms: outcome.ms, first_byte_ms: outcome.meta?.first_byte_ms ?? null, timed_out: outcome.meta?.timed_out ?? false}
    : {ok: false, reason: outcome.reason, detail: outcome.detail, ms: outcome.ms, first_byte_ms: outcome.meta?.first_byte_ms ?? null};
}

writeFileSync(outPath, '');
if (!laneOn) {
  let next = 0;
  await Promise.all(Array.from({length: concurrency}, async () => { for (;;) { const index = next++; if (index >= cases.length) return; const value = cases[index];
    const row = {id: value.id, source: value.source?.kind === 'session' ? 'session' : String(value.source?.run ?? '').startsWith('pb-') ? 'persona-bench' : 'table',
      verb: value.verb, kinds: value.kinds, recorded: value.lane, lines: value.input.proposal, typed: await typed(value.input)};
    appendFileSync(outPath, JSON.stringify(row) + '\n'); if (index % 50 === 0) process.stderr.write(`${index}/${cases.length}\n`); } }));
  process.stderr.write('done\n');
  process.exit(0);
}
for (let run = 1; run <= runs; run++) for (const value of cases) {
  const [laneAnswer, typedAnswer] = await Promise.all([lane(value, run), typed(value.input)]);
  const row = {id: value.id, run, turn: value.turn, verb: value.verb, kinds: value.kinds, recorded: value.lane, lane_model: laneModel, cap_ms: cap, lane: laneAnswer, typed: typedAnswer};
  appendFileSync(outPath, JSON.stringify(row) + '\n');
  process.stderr.write(`${run} ${value.id} lane=${laneAnswer.ok ? laneAnswer.verdict : laneAnswer.reason} ${laneAnswer.ms}ms typed=${typedAnswer?.verdict ?? typedAnswer?.status ?? '-'} ${typedAnswer?.confidence ?? ''}\n`);
}
process.stderr.write('done\n');
