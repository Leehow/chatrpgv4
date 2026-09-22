#!/usr/bin/env node
// Replay the admission bank through the typed family (contract §32.10). Usage:
//   node experiments/admission-jev-bank/replay.mjs --bank <bank.jsonl> --out <dir> --port live|echo|shape
//     [--per-class N] [--seed S] [--concurrency C]
// live  : the shared decision adapter against the pinned endpoint (needs the Jev credential).
// echo  : a controlled port answering each line with the lane's own verdict. It proves only that
//         the batch packs and that interpretation maps a verdict back to itself; it measures no agreement.
// shape : no decision at all; packing, routing and size statistics of every case.
// Live runs use minimum confidence 0 so every answer is kept; policy thresholds are applied
// afterwards over the stored confidences (no further calls), as in the TypeSafe RAG cookbook.
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {ADMISSION_JEV_MAX_LINES, admissionJevBatches, admissionJevBindings, runAdmissionJev} from '../../runtime/jev/admission-domain.ts';
import {readJevApiKey} from '../../extensions/jev/agent/config.js';

const ADMIT = new Set(['authorized', 'entailed', 'not_player_action']);
const LANE_ONLY = new Set(['cash']);
export const THRESHOLDS = [0, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];

export function parseArgs(argv) {
  const out = {perClass: 0, seed: 1, concurrency: 4};
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (flag === '--bank') out.bank = value; else if (flag === '--out') out.out = value; else if (flag === '--port') out.port = value;
    else if (flag === '--per-class') out.perClass = Number(value); else if (flag === '--seed') out.seed = Number(value);
    else if (flag === '--concurrency') out.concurrency = Number(value); else throw new Error(`unknown argument ${flag}`);
  }
  if (!out.bank || !out.out || !['live', 'echo', 'shape'].includes(out.port)) throw new Error('--bank, --out and --port live|echo|shape are required');
  return out;
}

/** Deterministic stratified sample: up to N labelled cases per lane verdict (0 = all). */
export function sample(cases, perClass, seed) {
  if (!perClass) return cases;
  let state = seed >>> 0 || 1;
  const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const groups = new Map();
  for (const value of cases) { const key = value.lane.verdict ?? 'unavailable'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(value); }
  return [...groups.values()].flatMap(group => group.map(value => [random(), value]).sort((a, b) => a[0] - b[0]).slice(0, perClass).map(([, value]) => value));
}

function lease(input, deadlineMs = 15_000) {
  const bindings = admissionJevBindings(input);
  return new TaskLease({owner: 'action-admission', goal: 'Offline replay of one retained admission review', scope: bindings.scope,
    capabilities: ['decision'], readSet: bindings.readSet,
    budget: {deadlineAt: Date.now() + deadlineMs, remainingInputTokens: 200_000, remainingOutputTokens: 20_000, remainingCostUsd: 0.02, remainingActions: 4}});
}

/** The controlled port for `echo`: each line answers the lane's verdict at full confidence. */
function echoPort(laneVerdict) {
  return {async decide(batch) {
    const answers = Object.fromEntries(batch.questions.map(question => [question.key, {status: 'answered', type: 'choice',
      choice: question.key.startsWith('verdict_') ? laneVerdict : 'none', confidence: 1}]));
    const keys = batch.questions.map(question => question.key);
    return {batchId: batch.id, status: 'complete', answers, issues: [], coverage: {required: keys, answered: keys, unknown: []}, attempts: 1};
  }};
}

async function replayOne(value, port, adapter) {
  const input = value.input, base = {id: value.id, lane: value.lane.verdict, lane_model: value.lane.model, lane_ms: value.lane.ms, verb: value.verb,
    source: value.source.kind === 'session' ? 'session' : value.source.run.startsWith('pb-') ? 'persona-bench' : 'table'};
  if ((value.kinds ?? []).some(kind => LANE_ONLY.has(kind))) return {...base, route: 'lane_only', reason: 'numeric_commitment'};
  if (input.proposal.length > ADMISSION_JEV_MAX_LINES) return {...base, route: 'fallback', reason: 'too_many_lines'};
  let estimates;
  try { estimates = admissionJevBatches(input).batches.map(batch => packDecisionBatch(batch).estimate); }
  catch (error) { return {...base, route: 'fallback', reason: error.failure ?? 'schema_error'}; }
  const sized = {...base, bytes: Math.max(...estimates.map(estimate => estimate.totalUpperBound)), batches: estimates.length,
    questions: input.proposal.length * 3, lines: input.proposal.length};
  if (port === 'shape') return {...sized, route: 'typed'};
  if (port === 'echo' && !value.lane.verdict) return {...sized, route: 'unlabelled'};
  const owned = lease(input);
  try {
    const result = await runAdmissionJev(input, port === 'echo' ? echoPort(value.lane.verdict) : adapter, owned, {minConfidence: 0});
    return result.status === 'decided'
      ? {...sized, route: 'typed', jev: result.verdict, confidence: result.confidence, line_verdicts: result.lines.map(line => line.verdict),
        line_confidences: result.lines.map(line => line.confidence), jev_ms: result.elapsedMs, input_tokens: result.usage.inputTokens}
      : {...sized, route: 'fallback', reason: result.reason, jev_ms: result.elapsedMs};
  } finally { owned.close(); }
}

const quantile = (values, q) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; };

/** Agreement against the lane at each threshold, computed from stored answers only. */
export function summarize(rows) {
  const labelled = rows.filter(row => row.lane);
  const typed = labelled.filter(row => row.route === 'typed' && row.jev);
  const byThreshold = THRESHOLDS.map(threshold => {
    const decided = typed.filter(row => row.confidence >= threshold);
    const agree = decided.filter(row => row.jev === row.lane).length;
    const admitAgree = decided.filter(row => ADMIT.has(row.jev) === ADMIT.has(row.lane)).length;
    const falseAdmit = decided.filter(row => ADMIT.has(row.jev) && !ADMIT.has(row.lane)).length;
    const falseRefuse = decided.filter(row => !ADMIT.has(row.jev) && ADMIT.has(row.lane)).length;
    const perClass = Object.fromEntries([...new Set(labelled.map(row => row.lane))].sort().map(verdict => {
      const cls = decided.filter(row => row.lane === verdict);
      return [verdict, {decided: cls.length, of: labelled.filter(row => row.lane === verdict).length,
        exact: cls.filter(row => row.jev === row.lane).length, same_admission: cls.filter(row => ADMIT.has(row.jev) === ADMIT.has(row.lane)).length}];
    }));
    return {threshold, decided: decided.length, coverage: labelled.length ? decided.length / labelled.length : 0,
      exact_agreement: decided.length ? agree / decided.length : null, admission_agreement: decided.length ? admitAgree / decided.length : null,
      false_admits: falseAdmit, false_refusals: falseRefuse, per_class: perClass};
  });
  const confusion = {};
  for (const row of typed) { confusion[row.lane] ??= {}; confusion[row.lane][row.jev] = (confusion[row.lane][row.jev] ?? 0) + 1; }
  const routes = rows.reduce((total, row) => { const key = row.route + (row.reason ? `:${row.reason}` : ''); total[key] = (total[key] ?? 0) + 1; return total; }, {});
  const bytes = rows.filter(row => row.bytes).map(row => row.bytes), jevMs = typed.map(row => row.jev_ms).filter(Number.isFinite),
    laneMs = labelled.map(row => row.lane_ms).filter(Number.isFinite);
  return {cases: rows.length, labelled: labelled.length, routes, confusion, by_threshold: byThreshold,
    packing_bytes: {p50: quantile(bytes, 0.5), p90: quantile(bytes, 0.9), max: bytes.length ? Math.max(...bytes) : null},
    jev_ms: {p50: quantile(jevMs, 0.5), p90: quantile(jevMs, 0.9), max: jevMs.length ? Math.max(...jevMs) : null},
    lane_ms_retained: {p50: quantile(laneMs, 0.5), p90: quantile(laneMs, 0.9), max: laneMs.length ? Math.max(...laneMs) : null}};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cases = sample(readFileSync(options.bank, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)), options.perClass, options.seed);
  let adapter;
  if (options.port === 'live') {
    if (!readJevApiKey(process.env)) { process.stderr.write('live replay needs the Jev credential (EXT_JEV_APIKEY or TYPESAFE_API_KEY); nothing was run\n'); process.exit(2); }
    adapter = createDecisionAdapter({env: process.env, maxConcurrency: Math.min(16, options.concurrency)});
  }
  const rows = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.max(1, options.concurrency)}, async () => {
    for (;;) { const index = next++; if (index >= cases.length) return; rows[index] = await replayOne(cases[index], options.port, adapter); }
  }));
  const summary = {port: options.port, per_class: options.perClass, seed: options.seed, ...summarize(rows),
    note: options.port === 'live' ? 'agreement is with the retained lane verdict, not with ground truth'
      : 'no model judged these cases: this run measures packing and routing only, never agreement'};
  mkdirSync(options.out, {recursive: true});
  writeFileSync(join(options.out, `replay-${options.port}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  writeFileSync(join(options.out, `replay-${options.port}-summary.json`), JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
