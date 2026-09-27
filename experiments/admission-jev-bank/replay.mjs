#!/usr/bin/env node
// Replay the admission bank through the typed family (contract §32.10). Usage:
//   node experiments/admission-jev-bank/replay.mjs --bank <bank.jsonl> --out <dir> --port live|echo|shape
//     [--per-class N] [--seed S] [--concurrency C] [--design v1|v2] [--revision 2a.1|2a.2|2a.3] [--extra <bank.jsonl>] [--skip-unlabelled] [--ablation]
// --design v1 (default): the product's §32.10 family. v2: SL-97's role-first family (admission-roles.ts), offline only;
//   --revision picks its question set (default the module's current one).
// --extra     : every case of another bank appended to the sample (deduplicated by id), e.g. the newest gate's table.
// --skip-unlabelled : cases whose lane gave no verdict at all (unavailable) are not replayed; they measure no agreement.
// --ablation  : v2 only; adds the collapsed single-choice question per line (same request, no extra call).
// Every typed row keeps each line's admit probability mass, so thresholds and label collapsing are re-applied offline.
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
import {ROLES_DEFAULT_REVISION, ROLES_MAX_LINES, ROLES_REVISIONS, revisionFamilies, rolesBatches, rolesBindings, runAdmissionRoles} from './admission-roles.ts';

const ADMIT = new Set(['authorized', 'entailed', 'not_player_action']);
const LANE_ONLY = new Set(['cash']);
export const THRESHOLDS = [0, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];

export function parseArgs(argv) {
  const out = {perClass: 0, seed: 1, concurrency: 4, design: 'v1', revision: ROLES_DEFAULT_REVISION, extra: [], skipUnlabelled: false, ablation: false};
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (flag === '--skip-unlabelled') { out.skipUnlabelled = true; index--; continue; }
    if (flag === '--ablation') { out.ablation = true; index--; continue; }
    if (flag === '--bank') out.bank = value; else if (flag === '--out') out.out = value; else if (flag === '--port') out.port = value;
    else if (flag === '--per-class') out.perClass = Number(value); else if (flag === '--seed') out.seed = Number(value);
    else if (flag === '--concurrency') out.concurrency = Number(value); else if (flag === '--design') out.design = value;
    else if (flag === '--revision') out.revision = value;
    else if (flag === '--extra') out.extra.push(value); else throw new Error(`unknown argument ${flag}`);
  }
  if (!out.bank || !out.out || !['live', 'echo', 'shape'].includes(out.port)) throw new Error('--bank, --out and --port live|echo|shape are required');
  if (!['v1', 'v2'].includes(out.design)) throw new Error('--design is v1 or v2');
  if (out.ablation && out.design !== 'v2') throw new Error('--ablation needs --design v2');
  if (!ROLES_REVISIONS.includes(out.revision)) throw new Error(`--revision is one of ${ROLES_REVISIONS.join(', ')}`);
  return out;
}

/** The sample, then every extra case not already in it, in order; optionally without the cases no lane verdict labels. */
export function assemble(sampled, extras, skipUnlabelled) {
  const seen = new Set(sampled.map(value => value.id));
  const all = [...sampled, ...extras.filter(value => !seen.has(value.id) && seen.add(value.id))];
  return skipUnlabelled ? all.filter(value => value.lane.verdict) : all;
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

function lease(input, deadlineMs = 15_000, design = 'v1', revision = ROLES_DEFAULT_REVISION) {
  const bindings = design === 'v2' ? rolesBindings(input, revision) : admissionJevBindings(input);
  return new TaskLease({owner: 'action-admission', goal: 'Offline replay of one retained admission review', scope: bindings.scope,
    capabilities: ['decision'], readSet: bindings.readSet,
    budget: {deadlineAt: Date.now() + deadlineMs, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 0.04, remainingActions: 8}});
}

/** A port wrapper that keeps every result it passes on, so a row can carry the raw distributions. */
export function recording(port) {
  const results = [];
  return {results, port: {async decide(batch, owned) { const result = await port.decide(batch, owned); results.push(result); return result; }}};
}

const V1_ADMIT = ['authorized', 'entailed', 'not_player_action'];
/** v1's per-line admit mass: the admitting verdicts' probabilities summed (label collapsing, re-applied offline). */
export function v1LineAdmitMass(results, lines) {
  const answers = Object.assign({}, ...results.map(result => result.answers ?? {}));
  return Array.from({length: lines}, (_, index) => {
    const probabilities = answers[`verdict_${index}`]?.probabilities;
    return probabilities ? Math.round(V1_ADMIT.reduce((total, key) => total + (probabilities[key] ?? 0), 0) * 10_000) / 10_000 : null;
  });
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

/**
 * v2's controlled echo port: each line answers the lane's own verdict through the role questions, at full probability:
 * an admitting lane verdict picks an admitting option of every family, a refusing one a refusing option.
 */
function echoRolesPort(laneVerdict, revision) {
  const admit = ['authorized', 'entailed', 'not_player_action'].includes(laneVerdict);
  const families = Object.fromEntries(revisionFamilies(revision).map(family => [family.name, family]));
  const pickFor = (name, options) => {
    if (name === 'role') return laneVerdict === 'not_player_action' ? 'world_response' : 'investigator_act';
    if (name === 'choice') return {authorized: 'chosen', entailed: 'routine_step', uncertain: 'unclear'}[laneVerdict] ?? (admit ? 'chosen' : 'keeper_choice');
    const family = families[name];
    if (!family) return name === 'single' ? 'unclear' : 'none';
    return admit ? family.admitting[0] : options.find(option => !family.admitting.includes(option) && option !== 'unclear');
  };
  const one = (options, chosen) => ({status: 'answered', type: 'choice', choice: chosen, confidence: 1,
    probabilities: Object.fromEntries(options.map(option => [option, option === chosen ? 1 : 0]))});
  return {async decide(batch) {
    const answers = Object.fromEntries(batch.questions.map(question => {
      const options = Object.keys(question.criteria);
      return [question.key, one(options, pickFor(question.key.split('_')[0], options))];
    }));
    const keys = batch.questions.map(question => question.key);
    return {batchId: batch.id, status: 'complete', answers, issues: [], coverage: {required: keys, answered: keys, unknown: []}, attempts: 1};
  }};
}

function v2Line(line) {
  return {verdict: line.verdict, p_admit: line.pAdmit, confidence: line.confidence, ...line.answers,
    missing: line.missing, ...(line.basis ? {basis: line.basis} : {}), ...(line.singleAdmit !== undefined ? {single_admit: line.singleAdmit} : {})};
}

export async function replayOne(value, port, adapter, design = 'v1', ablation = false, revision = ROLES_DEFAULT_REVISION) {
  const input = value.input, base = {id: value.id, lane: value.lane.verdict, lane_model: value.lane.model, lane_ms: value.lane.ms, verb: value.verb,
    source: value.source.kind === 'session' ? 'session' : value.source.run.startsWith('pb-') ? 'persona-bench' : 'table',
    ...(design === 'v2' ? {design, revision, kinds: input.proposal.map(line => /^resolve\b/.test(line) ? 'resolve' : (/^apply ([a-z_]+):/.exec(line) ?? [])[1] ?? 'unknown')} : {})};
  if ((value.kinds ?? []).some(kind => LANE_ONLY.has(kind))) return {...base, route: 'lane_only', reason: 'numeric_commitment'};
  if (input.proposal.length > (design === 'v2' ? ROLES_MAX_LINES : ADMISSION_JEV_MAX_LINES)) return {...base, route: 'fallback', reason: 'too_many_lines'};
  let estimates;
  try {
    estimates = (design === 'v2' ? rolesBatches(input, undefined, {ablation, revision}) : admissionJevBatches(input)).batches.map(batch => packDecisionBatch(batch).estimate);
  } catch (error) { return {...base, route: 'fallback', reason: error.failure ?? 'schema_error'}; }
  const sized = {...base, bytes: Math.max(...estimates.map(estimate => estimate.totalUpperBound)), batches: estimates.length,
    questions: input.proposal.length * (design === 'v2' ? revisionFamilies(revision).length + 3 + (ablation ? 1 : 0) : 3), lines: input.proposal.length};
  if (port === 'shape') return {...sized, route: 'typed'};
  if (port === 'echo' && !value.lane.verdict) return {...sized, route: 'unlabelled'};
  const owned = lease(input, 15_000, design, revision);
  const kept = recording(port === 'echo' ? (design === 'v2' ? echoRolesPort(value.lane.verdict, revision) : echoPort(value.lane.verdict)) : adapter);
  try {
    if (design === 'v2') {
      const result = await runAdmissionRoles(input, kept.port, owned, {minConfidence: 0, ablation, revision});
      return result.status === 'decided'
        ? {...sized, route: 'typed', jev: result.verdict, admit: result.admit, confidence: result.confidence,
          line_verdicts: result.lines.map(line => line.verdict), line_confidences: result.lines.map(line => line.confidence),
          line_admit_p: result.lines.map(line => line.pAdmit), lines_v2: result.lines.map(v2Line),
          jev_ms: result.elapsedMs, jev_calls: result.calls, input_tokens: result.usage.inputTokens}
        : {...sized, route: 'fallback', reason: result.reason, jev_ms: result.elapsedMs, jev_calls: result.calls};
    }
    const result = await runAdmissionJev(input, kept.port, owned, {minConfidence: 0});
    return result.status === 'decided'
      ? {...sized, route: 'typed', jev: result.verdict, confidence: result.confidence, line_verdicts: result.lines.map(line => line.verdict),
        line_confidences: result.lines.map(line => line.confidence), line_admit_p: v1LineAdmitMass(kept.results, input.proposal.length),
        jev_ms: result.elapsedMs, jev_calls: result.calls, input_tokens: result.usage.inputTokens}
      : {...sized, route: 'fallback', reason: result.reason, jev_ms: result.elapsedMs, jev_calls: result.calls};
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
  const read = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const cases = assemble(sample(read(options.bank), options.perClass, options.seed), options.extra.flatMap(read), options.skipUnlabelled);
  let adapter, attempts = 0;
  if (options.port === 'live') {
    if (!readJevApiKey(process.env)) { process.stderr.write('live replay needs the Jev credential (EXT_JEV_APIKEY or TYPESAFE_API_KEY); nothing was run\n'); process.exit(2); }
    adapter = createDecisionAdapter({env: process.env, maxConcurrency: Math.min(16, options.concurrency),
      trace: event => { if (event.kind === 'attempt') attempts++; }});
  }
  const rows = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.max(1, options.concurrency)}, async () => {
    for (;;) { const index = next++; if (index >= cases.length) return; rows[index] = await replayOne(cases[index], options.port, adapter, options.design, options.ablation, options.revision); }
  }));
  const summary = {port: options.port, design: options.design, ...(options.design === 'v2' ? {revision: options.revision} : {}), ablation: options.ablation, per_class: options.perClass, seed: options.seed,
    extra: options.extra, skip_unlabelled: options.skipUnlabelled, ...(options.port === 'live' ? {live_http_attempts: attempts} : {}), ...summarize(rows),
    note: options.port === 'live' ? 'agreement is with the retained lane verdict, not with ground truth'
      : 'no model judged these cases: this run measures packing and routing only, never agreement'};
  const stem = `replay-${options.port}${options.design === 'v1' ? '' : `-${options.design}-${options.revision}`}`;
  mkdirSync(options.out, {recursive: true});
  writeFileSync(join(options.out, `${stem}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  writeFileSync(join(options.out, `${stem}-summary.json`), JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
