#!/usr/bin/env node
// SL-97 phase 2a's "next step": turn sl97c-relabel.mjs's raw output into (1) the measurement report the ticket
// asked for -- run-to-run agreement (the same-model floor under today's prompt), agreement with the old bank
// label per class, latency, failures -- and (2) label-override files sl97b-analyze.mjs's new `--labels` option
// reads, so phase 2a's stored typed answers can be re-scored against today's lane without any new Jev call.
//
// Only `measure: "lane_batch"` rows feed the label files: the stored typed answers are scored batch by batch
// (`sl97b-analyze.mjs`'s own `readRow`), so the ground truth they are compared to must be batch-level too.
// `lane_line` rows are reported (latency, failures) but do not enter a label file.
//
// Two runs give the batch two independent decisions (admit / refuse / unknown -- a review_timeout or a failed
// call decides nothing). The task's two label definitions:
//   both-refuse  : the case is "refused by today's lane" only when BOTH runs refused (so "admitted" needs just
//                  one run to admit). A case is excluded when neither rule can be decided (e.g. one run unknown
//                  and the other refused: we cannot tell whether the unknown run would also have refused).
//   either-refuse: the case is "refused by today's lane" when EITHER run refused (so "admitted" needs both runs
//                  to admit). Excluded the same way when undecidable.
//
//   node experiments/admission-jev-bank/sl97c-labels.mjs --relabel <relabel.jsonl> --out <dir>
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ADMIT, REFUSE, wilsonUpper} from './sl97b-analyze.mjs';

const argv = process.argv.slice(2), arg = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
const relabelPath = arg('--relabel'), outDir = arg('--out');
if (!relabelPath || !outDir) throw new Error('--relabel and --out are required');

const round = (value, digits = 4) => value === null || value === undefined ? value : Math.round(value * 10 ** digits) / 10 ** digits;
const pct = value => value === null || value === undefined ? '-' : `${(100 * value).toFixed(1)}%`;
const quantile = (values, q) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; };
const decision = verdict => ADMIT.has(verdict) ? 'admit' : REFUSE.has(verdict) ? 'refuse' : null;
const CLASSES = ['time', 'move', 'clue', 'resolve', 'other'];
function classOf(verb, kinds) {
  if (verb === 'resolve') return 'resolve';
  const ks = new Set(kinds ?? []);
  if ([...ks].every(k => k === 'time')) return 'time';
  if (ks.has('move') && [...ks].every(k => k === 'move' || k === 'time')) return 'move';
  if ((ks.has('clue') || ks.has('handout')) && [...ks].every(k => ['clue', 'handout', 'time'].includes(k))) return 'clue';
  return 'other';
}

const rows = readFileSync(relabelPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const byId = new Map();
for (const row of rows) {
  if (!byId.has(row.id)) byId.set(row.id, {id: row.id, sample: row.sample, verb: row.verb, kinds: row.kinds, recorded: row.recorded, batch: {}, lines: []});
  const entry = byId.get(row.id);
  if (row.measure === 'lane_batch') entry.batch[row.run] = row.lane;
  else entry.lines.push(row);
}
const cases = [...byId.values()].map(value => ({...value, cls: classOf(value.verb, value.kinds)}));

// --- Failures and latency, over every call (batch + line, both runs) -------------------------------------------
const allCalls = rows.map(row => ({...row.lane, measure: row.measure}));
const latency = calls => { const ms = calls.map(call => call.ms).filter(value => typeof value === 'number'); return {p50: quantile(ms, 0.5), p90: quantile(ms, 0.9), max: ms.length ? Math.max(...ms) : null, n: ms.length}; };
const failureReasons = {};
let reviewTimeouts = 0, over13s = 0;
for (const call of allCalls) {
  if (call.ok === false) failureReasons[call.reason] = (failureReasons[call.reason] ?? 0) + 1;
  else if (call.verdict === 'review_timeout') reviewTimeouts++;
  if (call.over_13s) over13s++;
}
const report = {
  generated_at: new Date().toISOString(),
  cases: cases.length,
  lane_calls: {total: allCalls.length, batch: allCalls.filter(call => call.measure === 'lane_batch').length, line: allCalls.filter(call => call.measure === 'lane_line').length},
  latency_ms: {all: latency(allCalls), batch_only: latency(allCalls.filter(call => call.measure === 'lane_batch'))},
  failures: {total: Object.values(failureReasons).reduce((a, b) => a + b, 0), by_reason: failureReasons, review_timeout: reviewTimeouts, over_13s_share: round(over13s / Math.max(1, allCalls.length))},
};

// --- Run-to-run agreement (batch level only): the same-model floor under today's prompt --------------------------
function runAgreement(subset) {
  const both = subset.filter(value => value.batch[1]?.ok && value.batch[2]?.ok && decision(value.batch[1].verdict) && decision(value.batch[2].verdict));
  const exact = both.filter(value => value.batch[1].verdict === value.batch[2].verdict).length;
  const sameAdmission = both.filter(value => decision(value.batch[1].verdict) === decision(value.batch[2].verdict)).length;
  const r1AdmitsR2Refuses = both.filter(value => decision(value.batch[1].verdict) === 'admit' && decision(value.batch[2].verdict) === 'refuse').length;
  const r2AdmitsR1Refuses = both.filter(value => decision(value.batch[2].verdict) === 'admit' && decision(value.batch[1].verdict) === 'refuse').length;
  const r1Admits = both.filter(value => decision(value.batch[1].verdict) === 'admit').length;
  const r2Admits = both.filter(value => decision(value.batch[2].verdict) === 'admit').length;
  return {pairs: both.length, exact_agreement: both.length ? round(exact / both.length) : null, admit_refuse_agreement: both.length ? round(sameAdmission / both.length) : null,
    flip_rate: both.length ? round(1 - sameAdmission / both.length) : null,
    of_run2_admits_run1_refused: r2Admits ? round(r2AdmitsR1Refuses / r2Admits) : null, of_run1_admits_run2_refused: r1Admits ? round(r1AdmitsR2Refuses / r1Admits) : null};
}
report.run_to_run_agreement = {overall: runAgreement(cases), by_sample: {main: runAgreement(cases.filter(v => v.sample === 'main')), holdout: runAgreement(cases.filter(v => v.sample === 'holdout'))},
  by_class: Object.fromEntries(CLASSES.map(cls => [cls, runAgreement(cases.filter(v => v.cls === cls))]))};

// --- Agreement with the old (historical) bank label, per class ---------------------------------------------------
function oldAgreement(subset, pick) {
  const withOld = subset.filter(value => REFUSE.has(value.recorded) || ADMIT.has(value.recorded));
  const decided = withOld.map(value => ({old: decision(value.recorded), today: pick(value)})).filter(value => value.today !== null);
  const same = decided.filter(value => value.old === value.today).length;
  const falseAdmits = decided.filter(value => value.today === 'admit' && value.old === 'refuse').length;
  return {of: withOld.length, decided: decided.length, admit_refuse_agreement: decided.length ? round(same / decided.length) : null,
    false_admits_vs_old_refusal: falseAdmits, false_admit_wilson_upper: round(wilsonUpper(falseAdmits, decided.filter(v => v.today === 'admit').length))};
}
const pickRun1 = value => value.batch[1]?.ok ? decision(value.batch[1].verdict) : null;
const pickRun2 = value => value.batch[2]?.ok ? decision(value.batch[2].verdict) : null;
const pickBothRefuse = value => combined(value, 'both-refuse')?.decision ?? null;
const pickEitherRefuse = value => combined(value, 'either-refuse')?.decision ?? null;
report.agreement_with_old_bank_label = {
  by_class: Object.fromEntries(CLASSES.map(cls => {
    const subset = cases.filter(v => v.cls === cls);
    return [cls, {run1: oldAgreement(subset, pickRun1), run2: oldAgreement(subset, pickRun2), both_refuse_def: oldAgreement(subset, pickBothRefuse), either_refuse_def: oldAgreement(subset, pickEitherRefuse)}];
  })),
  overall: {run1: oldAgreement(cases, pickRun1), run2: oldAgreement(cases, pickRun2), both_refuse_def: oldAgreement(cases, pickBothRefuse), either_refuse_def: oldAgreement(cases, pickEitherRefuse)},
};

// --- The two label definitions, batch level only ------------------------------------------------------------------
function combined(value, def) {
  const r1 = value.batch[1]?.ok ? decision(value.batch[1].verdict) : null;
  const r2 = value.batch[2]?.ok ? decision(value.batch[2].verdict) : null;
  if (def === 'both-refuse') {
    if (r1 === 'admit' || r2 === 'admit') return {decision: 'admit', verdict: r1 === 'admit' ? value.batch[1].verdict : value.batch[2].verdict};
    if (r1 === 'refuse' && r2 === 'refuse') return {decision: 'refuse', verdict: value.batch[1].verdict};
    return null; // one unknown, the other (if any) refused: cannot tell whether both refuse
  }
  // either-refuse
  if (r1 === 'refuse' || r2 === 'refuse') return {decision: 'refuse', verdict: r1 === 'refuse' ? value.batch[1].verdict : value.batch[2].verdict};
  if (r1 === 'admit' && r2 === 'admit') return {decision: 'admit', verdict: value.batch[1].verdict};
  return null; // one unknown, the other (if any) admitted: cannot tell whether either refuses
}
function labelMap(sample, def) {
  const out = {};
  for (const value of cases) { if (value.sample !== sample) continue; const result = combined(value, def); if (result) out[value.id] = result.verdict; }
  return out;
}

mkdirSync(outDir, {recursive: true});
writeFileSync(join(outDir, 'labels-main-both-refuse.json'), JSON.stringify(labelMap('main', 'both-refuse'), null, 2) + '\n');
writeFileSync(join(outDir, 'labels-main-either-refuse.json'), JSON.stringify(labelMap('main', 'either-refuse'), null, 2) + '\n');
writeFileSync(join(outDir, 'labels-holdout-both-refuse.json'), JSON.stringify(labelMap('holdout', 'both-refuse'), null, 2) + '\n');
writeFileSync(join(outDir, 'labels-holdout-either-refuse.json'), JSON.stringify(labelMap('holdout', 'either-refuse'), null, 2) + '\n');
for (const def of ['both-refuse', 'either-refuse']) {
  const main = labelMap('main', def), holdout = labelMap('holdout', def);
  report[`labelled_${def.replace('-', '_')}`] = {main: Object.keys(main).length, holdout: Object.keys(holdout).length};
}
writeFileSync(join(outDir, 'relabel-summary.json'), JSON.stringify(report, null, 2) + '\n');

const lines = [];
lines.push('# SL-97c relabel summary', '', `Generated ${report.generated_at}. ${report.cases} cases (390 main + 330 holdout), ${report.lane_calls.total} lane calls (${report.lane_calls.batch} batch, ${report.lane_calls.line} per-line).`, '');
lines.push('## Latency (ms)', '', '| | p50 | p90 | max | n |', '| --- | --- | --- | --- | --- |');
lines.push(`| all calls | ${report.latency_ms.all.p50} | ${report.latency_ms.all.p90} | ${report.latency_ms.all.max} | ${report.latency_ms.all.n} |`);
lines.push(`| batch calls only | ${report.latency_ms.batch_only.p50} | ${report.latency_ms.batch_only.p90} | ${report.latency_ms.batch_only.max} | ${report.latency_ms.batch_only.n} |`, '');
lines.push('## Failures', '', `Total ${report.failures.total} of ${report.lane_calls.total} calls; review_timeout verdicts ${report.failures.review_timeout}; over the product's 13s cap: ${pct(report.failures.over_13s_share)}.`, '');
lines.push('| reason | count |', '| --- | --- |');
for (const [reason, count] of Object.entries(report.failures.by_reason)) lines.push(`| ${reason} | ${count} |`);
lines.push('', '## Run-to-run agreement (batch level; the same-model floor under today\'s prompt)', '');
lines.push('| | pairs | exact | admit/refuse | flip rate | of run1 admits, run2 refused | of run2 admits, run1 refused |', '| --- | --- | --- | --- | --- | --- | --- |');
const rowFor = (name, table) => lines.push(`| ${name} | ${table.pairs} | ${pct(table.exact_agreement)} | ${pct(table.admit_refuse_agreement)} | ${pct(table.flip_rate)} | ${pct(table.of_run1_admits_run2_refused)} | ${pct(table.of_run2_admits_run1_refused)} |`);
rowFor('overall', report.run_to_run_agreement.overall);
rowFor('main', report.run_to_run_agreement.by_sample.main);
rowFor('holdout', report.run_to_run_agreement.by_sample.holdout);
for (const cls of CLASSES) rowFor(cls, report.run_to_run_agreement.by_class[cls]);
lines.push('', '## Agreement with the old bank label, per class', '');
lines.push('| class | of (old-labelled) | run1 admit/refuse | run2 admit/refuse | both-refuse def | either-refuse def |', '| --- | --- | --- | --- | --- | --- |');
for (const cls of CLASSES) { const row = report.agreement_with_old_bank_label.by_class[cls];
  lines.push(`| ${cls} | ${row.run1.of} | ${pct(row.run1.admit_refuse_agreement)} (n=${row.run1.decided}) | ${pct(row.run2.admit_refuse_agreement)} (n=${row.run2.decided}) | ${pct(row.both_refuse_def.admit_refuse_agreement)} (n=${row.both_refuse_def.decided}) | ${pct(row.either_refuse_def.admit_refuse_agreement)} (n=${row.either_refuse_def.decided}) |`); }
const overall = report.agreement_with_old_bank_label.overall;
lines.push(`| **overall** | ${overall.run1.of} | ${pct(overall.run1.admit_refuse_agreement)} (n=${overall.run1.decided}) | ${pct(overall.run2.admit_refuse_agreement)} (n=${overall.run2.decided}) | ${pct(overall.both_refuse_def.admit_refuse_agreement)} (n=${overall.both_refuse_def.decided}) | ${pct(overall.either_refuse_def.admit_refuse_agreement)} (n=${overall.either_refuse_def.decided}) |`, '');
lines.push('## Cases labelled for re-scoring (batch level)', '', '| definition | main | holdout |', '| --- | --- | --- |');
lines.push(`| both-refuse | ${report.labelled_both_refuse.main} | ${report.labelled_both_refuse.holdout} |`);
lines.push(`| either-refuse | ${report.labelled_either_refuse.main} | ${report.labelled_either_refuse.holdout} |`, '');
writeFileSync(join(outDir, 'relabel-summary.md'), lines.join('\n') + '\n');
process.stdout.write(lines.join('\n') + '\n');
