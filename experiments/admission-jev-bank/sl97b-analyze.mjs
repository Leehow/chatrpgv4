#!/usr/bin/env node
// SL-97 phase 2a analysis: typed admission arms against the retained lane labels, and the lane's own disagreement floor.
// Reads stored replay rows only (no live call). Usage:
//   node experiments/admission-jev-bank/sl97b-analyze.mjs --bank <bank.jsonl> [--bank <bank.jsonl>]... --out <dir>
//     --arm <name>=<reading>:<replay.jsonl> [--arm ...] [--floor-root <repo root>] [--labels <id-to-verdict.json>]
// <reading> is how a row becomes an admit/refuse decision with a confidence:
//   max    : the row's own batch verdict and confidence (v1 as the product reads it: the top verdict of each line);
//   sum    : each line's admitting probability mass (line_admit_p), confidence |2p-1|, the batch the minimum over lines;
//   single : v2's ablation question (lines_v2[].single_admit), read as `sum`.
//   no_order, order_on_acts : exploratory re-readings of stored 2a.3 answers (no new call): 2a.3 without its `order`
//            term, or with `order` capping only the investigator's own acts. Post hoc; never the pre-registered reading.
// Agreement is with the retained lane label, which is not ground truth. `review_pending` is not a label (the lane gave no
// verdict); those cases are reported apart. Batch classes come from the closed effect kinds of the proposal lines.
// --labels (SL-97c): a JSON object {id: verdict} overriding every arm's stored `lane` ground truth with a freshly
// measured one (e.g. today's lane, run twice, combined by `sl97c-labels.mjs`). An id missing from the map is
// excluded from that run's analysis, never silently kept at its old label.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {revisionFamilies} from './admission-roles.ts';

export const THRESHOLDS = [0, 0.5, 0.6, 0.7, 0.8, 0.85, 0.87, 0.9, 0.95];
export const ADMIT = new Set(['authorized', 'entailed', 'not_player_action']);
export const REFUSE = new Set(['not_authorized', 'uncertain']);
export const LABELS = ['authorized', 'entailed', 'not_player_action', 'not_authorized', 'uncertain'];
export const CLASSES = ['time', 'move', 'clue', 'resolve', 'other'];

const readJsonl = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const round = (value, digits = 4) => value === null || value === undefined ? value : Math.round(value * 10 ** digits) / 10 ** digits;
export const quantile = (values, q) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; };
/** Wilson score interval bounds (95%) for k of n. */
export function wilsonUpper(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, denominator = 1 + z * z / n;
  return (p + z * z / (2 * n) + z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denominator;
}
export function wilsonLower(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, denominator = 1 + z * z / n;
  return Math.max(0, (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denominator);
}
/**
 * The false-admit share a class would show at its own natural refusal rate r: of its settled admits, the share the lane
 * refused, from the two class-conditional settle rates (independent of how the sample was stratified).
 */
export function naturalShare(r, settleGivenRefuse, settleGivenAdmit) {
  if (r === null || settleGivenRefuse === null || settleGivenAdmit === null) return null;
  const bad = r * settleGivenRefuse, good = (1 - r) * settleGivenAdmit;
  return bad + good > 0 ? bad / (bad + good) : null;
}

/** The closed effect kind of a host proposal line (`resolve (...)` or `apply <kind>: ...`). */
export const kindOf = line => /^resolve\b/.test(line) ? 'resolve' : (/^apply ([a-z_]+):/.exec(line) ?? [])[1] ?? 'unknown';
/** A batch's class from its closed kinds: what §32.11's fast path and §32.12.3's line clearing are keyed by. */
export function batchClass(lines) {
  const kinds = new Set(lines.map(kindOf));
  if (kinds.has('resolve')) return 'resolve';
  if ([...kinds].every(kind => kind === 'time')) return 'time';
  if (kinds.has('move') && [...kinds].every(kind => kind === 'move' || kind === 'time')) return 'move';
  if ((kinds.has('clue') || kinds.has('handout')) && [...kinds].every(kind => ['clue', 'handout', 'time'].includes(kind))) return 'clue';
  return 'other';
}

const binary = p => Math.abs(2 * p - 1);
const ADMITTING_2A3 = Object.fromEntries(revisionFamilies('2a.3').map(family => [family.name, family.admitting]));
/** An exploratory recombination of one stored 2a.3 line (same answers, a different host rule). */
export function recombine(line, variant) {
  const admit = name => (ADMITTING_2A3[name] ?? []).reduce((total, key) => total + (line[name]?.[key] ?? 0), 0);
  const role = line.role, total = role.investigator_act + role.world_response + role.time_passing;
  if (!(total > 0) || !line.order) return null;
  let act = Math.min(admit('choice'), admit('target'));
  if (variant === 'order_on_acts') act = Math.min(act, admit('order'));
  const mixed = (role.investigator_act * act + role.world_response * admit('result') + role.time_passing * admit('span')) / total;
  return Math.round(Math.min(mixed, admit('gate')) * 10_000) / 10_000;
}
/** One row read as an arm: {admit, confidence, label?} or null when the arm made no typed decision. */
export function readRow(row, reading) {
  if (row.route !== 'typed' || !row.jev) return null;
  if (reading === 'max') return {admit: ADMIT.has(row.jev), confidence: row.confidence, label: row.jev};
  const masses = reading === 'single' ? (row.lines_v2 ?? []).map(line => line.single_admit)
    : reading === 'no_order' || reading === 'order_on_acts' ? (row.lines_v2 ?? []).map(line => recombine(line, reading)) : row.line_admit_p;
  if (!Array.isArray(masses) || !masses.length || masses.some(value => typeof value !== 'number')) return null;
  const admit = masses.every(value => value >= 0.5);
  return {admit, confidence: round(Math.min(...masses.map(binary))), label: reading === 'sum' && row.design === 'v2' ? row.jev : null};
}

/** Lane-label weights that turn the stratified sample back into the bank's own label mix. */
export function mixWeights(sampleCounts, bankCounts) {
  const sampleTotal = Object.values(sampleCounts).reduce((a, b) => a + b, 0), bankTotal = LABELS.reduce((a, label) => a + (bankCounts[label] ?? 0), 0);
  return Object.fromEntries(LABELS.map(label => [label, sampleCounts[label] ? ((bankCounts[label] ?? 0) / bankTotal) / (sampleCounts[label] / sampleTotal) : 0]));
}

export function armTable(cases, weights, classRefusalRate = {}) {
  const labelled = cases.filter(value => LABELS.includes(value.lane));
  const typed = labelled.filter(value => value.read);
  const byThreshold = THRESHOLDS.map(threshold => {
    const decided = typed.filter(value => value.read.confidence >= threshold);
    const settled = decided.filter(value => value.read.admit);
    const falseAdmits = settled.filter(value => REFUSE.has(value.lane));
    const falseRefusals = decided.filter(value => !value.read.admit && ADMIT.has(value.lane));
    const weighted = rows => rows.reduce((total, value) => total + (weights[value.lane] ?? 0), 0);
    const perLabel = Object.fromEntries(LABELS.map(label => {
      const of = labelled.filter(value => value.lane === label), cls = decided.filter(value => value.lane === label);
      return [label, {of: of.length, decided: cls.length, same_admission: cls.filter(value => value.read.admit === ADMIT.has(label)).length,
        exact: cls.filter(value => value.read.label === label).length}];
    }));
    const perClass = Object.fromEntries(CLASSES.map(name => {
      const of = labelled.filter(value => value.cls === name), cls = decided.filter(value => value.cls === name), set = settled.filter(value => value.cls === name);
      const fa = set.filter(value => REFUSE.has(value.lane)).length;
      const refusals = of.filter(value => REFUSE.has(value.lane)).length, admits = of.length - refusals, trueAdmits = set.length - fa;
      const r = classRefusalRate[name] ?? null;
      const natural = {settle_given_refuse: refusals ? round(fa / refusals) : null, settle_given_admit: admits ? round(trueAdmits / admits) : null,
        false_admit_share_class_natural: round(naturalShare(r, refusals ? fa / refusals : null, admits ? trueAdmits / admits : null)),
        false_admit_share_class_natural_upper: round(naturalShare(r, wilsonUpper(fa, refusals), wilsonLower(trueAdmits, admits)))};
      return [name, {of: of.length, lane_refusals: refusals, ...natural, decided: cls.length,
        same_admission: cls.filter(value => value.read.admit === ADMIT.has(value.lane)).length, settled_admits: set.length, false_admits: fa,
        false_admit_share: set.length ? round(fa / set.length) : null, false_admit_share_bank_mix: weighted(set) ? round(weighted(set.filter(value => REFUSE.has(value.lane))) / weighted(set)) : null,
        false_admit_wilson_upper: round(wilsonUpper(fa, set.length))}];
    }));
    return {threshold, decided: decided.length, coverage: labelled.length ? round(decided.length / labelled.length) : 0,
      exact_agreement: decided.some(value => value.read.label) ? round(decided.filter(value => value.read.label === value.lane).length / decided.length) : null,
      admission_agreement: decided.length ? round(decided.filter(value => value.read.admit === ADMIT.has(value.lane)).length / decided.length) : null,
      false_admits: falseAdmits.length, false_refusals: falseRefusals.length, settled_admits: settled.length,
      settled_share: labelled.length ? round(settled.length / labelled.length) : 0,
      false_admit_share: settled.length ? round(falseAdmits.length / settled.length) : null,
      false_admit_share_bank_mix: weighted(settled) ? round(weighted(falseAdmits) / weighted(settled)) : null,
      false_admit_wilson_upper: round(wilsonUpper(falseAdmits.length, settled.length)),
      lane_refusals_admitted: round(falseAdmits.length / Math.max(1, labelled.filter(value => REFUSE.has(value.lane)).length)),
      per_label: perLabel, per_class: perClass};
  });
  const confidences = typed.map(value => value.read.confidence), ms = cases.filter(value => value.jev_ms !== undefined).map(value => value.jev_ms);
  return {labelled: labelled.length, typed: typed.length, pending: cases.filter(value => value.lane === 'review_pending').map(value => ({id: value.id,
    admit: value.read?.admit ?? null, confidence: value.read?.confidence ?? null, class: value.cls})),
  confidence: {p25: quantile(confidences, 0.25), median: quantile(confidences, 0.5), p75: quantile(confidences, 0.75), mean: round(confidences.reduce((a, b) => a + b, 0) / Math.max(1, confidences.length))},
  latency_ms: {p50: quantile(ms, 0.5), p90: quantile(ms, 0.9), max: ms.length ? Math.max(...ms) : null, n: ms.length}, by_threshold: byThreshold};
}

/**
 * The lane's own disagreement, from every retained re-run of the lane on the same case (SL-24, SL-30, SL-39):
 * same-model repeats and cross-model pairs. `false_admit_share` is the product-facing number: of the admits one lane
 * run would settle, the share another run of the lane refused (P(A refuses | B admits)).
 */
export function laneFloor(root) {
  const decision = verdict => ADMIT.has(verdict) ? true : REFUSE.has(verdict) ? false : null;
  const groups = []; // [{source, model, case, verdicts}]
  const add = (source, model, id, verdict) => {
    if (decision(verdict) === null) return;
    let group = groups.find(value => value.source === source && value.model === model && value.id === id);
    if (!group) groups.push(group = {source, model, id, verdicts: []});
    group.verdicts.push(verdict);
  };
  const files = {sl24: 'experiments/admission-jev-bank/results/sl24/longgate-lane-typed.jsonl', sl30: 'experiments/admission-jev-bank/results/sl30/longgates-line-level.jsonl',
    sl39alt: 'experiments/single-loop-routing/results/sl39-lane-alternatives/per-case.json', sl39lat: 'experiments/single-loop-routing/results/sl39-lane-latency/per-case.json'};
  const present = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, existsSync(join(root, path))]));
  if (present.sl24) for (const row of readJsonl(join(root, files.sl24))) if (row.lane?.ok) add('sl24', row.lane_model, row.id, row.lane.verdict);
  if (present.sl30) for (const row of readJsonl(join(root, files.sl30))) if (row.measure === 'lane_batch' && row.lane?.ok) add('sl30', row.lane_model, row.id, row.lane.verdict);
  if (present.sl39alt) for (const row of JSON.parse(readFileSync(join(root, files.sl39alt), 'utf8'))) if (row.ok) add('sl39-alternatives', row.candidate_model, row.id, row.verdict);
  if (present.sl39lat) for (const row of JSON.parse(readFileSync(join(root, files.sl39lat), 'utf8')))
    for (const [arm, runs] of Object.entries(row.runs ?? {})) for (const run of runs) if (run.ok) add(`sl39-latency:${arm}`, run.model, row.id ?? row.case ?? JSON.stringify(row).slice(0, 80), run.verdict);
  const count = pairs => {
    let n = 0, flips = 0, aRefBAdm = 0, bAdmits = 0, aRefuses = 0;
    for (const [a, b] of pairs) { n++; const da = decision(a), db = decision(b); flips += da !== db; aRefBAdm += !da && db; bAdmits += db; aRefuses += !da; }
    return {ordered_pairs: n, flip_rate: n ? round(flips / n) : null, false_admit_share: bAdmits ? round(aRefBAdm / bAdmits) : null,
      refusals_admitted_by_other: aRefuses ? round(aRefBAdm / aRefuses) : null, a_refuses_b_admits: aRefBAdm, b_admits: bAdmits, a_refuses: aRefuses};
  };
  const ordered = verdicts => verdicts.flatMap((a, i) => verdicts.flatMap((b, j) => i === j ? [] : [[a, b]]));
  const same = groups.flatMap(group => ordered(group.verdicts));
  const perModel = {};
  for (const group of groups) (perModel[`${group.source} ${group.model}`] ??= []).push(...ordered(group.verdicts));
  const cross = [];
  const alt = groups.filter(group => group.source === 'sl39-alternatives');
  for (const a of alt) for (const b of alt) if (a.id === b.id && a.model !== b.model) for (const va of a.verdicts) for (const vb of b.verdicts) cross.push([va, vb]);
  return {sources: present, same_model_repeat: count(same), per_source_model: Object.fromEntries(Object.entries(perModel).map(([key, pairs]) => [key, count(pairs)])),
    cross_model: count(cross)};
}

export function args(argv) {
  const out = {banks: [], arms: [], root: join(import.meta.dirname, '../..')};
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (flag === '--bank') out.banks.push(value); else if (flag === '--out') out.out = value; else if (flag === '--floor-root') out.root = value;
    else if (flag === '--labels') out.labels = value;
    else if (flag === '--arm') { const [name, rest] = value.split(/=(.*)/s); const [reading, path] = rest.split(/:(.*)/s); out.arms.push({name, reading, path}); }
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!out.banks.length || !out.out || !out.arms.length) throw new Error('--bank, --out and at least one --arm are required');
  return out;
}

function markdown(report) {
  const lines = [];
  const pct = value => value === null || value === undefined ? '-' : `${(100 * value).toFixed(1)}%`;
  lines.push(`# SL-97b analysis`, '', `Labels: lane verdicts in the replayed set (${JSON.stringify(report.sample_label_counts)}); bank mix used for reweighting: ${JSON.stringify(report.bank_label_counts)}.`, '');
  for (const [name, arm] of Object.entries(report.arms)) {
    lines.push(`## ${name}`, '', `typed ${arm.typed} of ${arm.labelled} labelled; confidence median ${arm.confidence.median} (p25 ${arm.confidence.p25}, p75 ${arm.confidence.p75}); latency p50 ${arm.latency_ms.p50} ms, p90 ${arm.latency_ms.p90} ms (n=${arm.latency_ms.n})`, '');
    lines.push('| T | decided | coverage | exact | admit/refuse | false admits | false refusals | settled admits | FA share (sample) | FA share (bank mix) | FA Wilson upper |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of arm.by_threshold) lines.push(`| ${row.threshold} | ${row.decided} | ${pct(row.coverage)} | ${pct(row.exact_agreement)} | ${pct(row.admission_agreement)} | ${row.false_admits} | ${row.false_refusals} | ${row.settled_admits} | ${pct(row.false_admit_share)} | ${pct(row.false_admit_share_bank_mix)} | ${pct(row.false_admit_wilson_upper)} |`);
    for (const [source, table] of Object.entries(arm.by_source ?? {})) {
      if (!table.labelled) continue;
      lines.push('', `Source ${source} only (${table.labelled} labelled): T -> settled admits / false admits / false refusals / admit-refuse agreement`, '');
      lines.push(`| ${THRESHOLDS.map(t => `T=${t}`).join(' | ')} |`, `| ${THRESHOLDS.map(() => '---').join(' | ')} |`);
      lines.push(`| ${table.by_threshold.map(row => `${row.settled_admits}/${row.false_admits}/${row.false_refusals}/${pct(row.admission_agreement)}`).join(' | ')} |`);
    }
    lines.push('', 'Per lane label at T=0 (same admission / exact, of decided):', '');
    const zero = arm.by_threshold[0];
    lines.push('| lane label | of | decided | same admission | exact |', '| --- | --- | --- | --- | --- |');
    for (const [label, row] of Object.entries(zero.per_label)) lines.push(`| ${label} | ${row.of} | ${row.decided} | ${row.same_admission} (${pct(row.decided ? row.same_admission / row.decided : null)}) | ${row.exact} |`);
    lines.push('', 'Per batch class, settled admits / false admits by threshold:', '');
    lines.push(`| class | of (lane refusals) | ${THRESHOLDS.map(t => `T=${t}`).join(' | ')} |`, `| --- | --- | ${THRESHOLDS.map(() => '---').join(' | ')} |`);
    for (const name of CLASSES) lines.push(`| ${name} | ${zero.per_class[name].of} (${zero.per_class[name].lane_refusals}) | ${arm.by_threshold.map(row => `${row.per_class[name].settled_admits}/${row.per_class[name].false_admits}`).join(' | ')} |`);
    lines.push('', 'Per batch class, false-admit share at the class\'s own bank refusal rate (upper bound from Wilson bounds on both settle rates):', '');
    lines.push(`| class | bank refusal rate | ${THRESHOLDS.map(t => `T=${t}`).join(' | ')} |`, `| --- | --- | ${THRESHOLDS.map(() => '---').join(' | ')} |`);
    for (const name of CLASSES) lines.push(`| ${name} | ${pct(report.class_refusal_rate_bank?.[name])} | ${arm.by_threshold.map(row => `${pct(row.per_class[name].false_admit_share_class_natural)} (<= ${pct(row.per_class[name].false_admit_share_class_natural_upper)})`).join(' | ')} |`);
    lines.push('');
  }
  const floor = report.lane_floor;
  lines.push('## Lane disagreement floor', '', '| pairs | ordered pairs | flip rate | FA share: P(A refuses given B admits) | P(B admits given A refuses) |', '| --- | --- | --- | --- | --- |');
  lines.push(`| same model, repeated | ${floor.same_model_repeat.ordered_pairs} | ${pct(floor.same_model_repeat.flip_rate)} | ${pct(floor.same_model_repeat.false_admit_share)} | ${pct(floor.same_model_repeat.refusals_admitted_by_other)} |`);
  for (const [key, row] of Object.entries(floor.per_source_model)) lines.push(`| ${key} | ${row.ordered_pairs} | ${pct(row.flip_rate)} | ${pct(row.false_admit_share)} | ${pct(row.refusals_admitted_by_other)} |`);
  lines.push(`| cross model (SL-39 alternatives) | ${floor.cross_model.ordered_pairs} | ${pct(floor.cross_model.flip_rate)} | ${pct(floor.cross_model.false_admit_share)} | ${pct(floor.cross_model.refusals_admitted_by_other)} |`, '');
  return lines.join('\n') + '\n';
}

async function main() {
  const options = args(process.argv.slice(2));
  // SL-97c: an id -> verdict map overriding the stored replay row's own `lane` field (its ground truth at the time
  // it was replayed) with a freshly measured one -- e.g. today's product lane, run twice, combined by one of two
  // rules (results/sl97c/sl97c-labels.mjs). An id absent from the map is excluded (its `lane` becomes `null`, not
  // in `LABELS`), never silently falls back to the stored label: a case the new measurement could not decide is
  // not ground truth either.
  const labels = options.labels ? new Map(Object.entries(JSON.parse(readFileSync(options.labels, 'utf8')))) : null;
  const bank = new Map();
  for (const path of options.banks) for (const value of readJsonl(path)) if (!bank.has(value.id)) bank.set(value.id, value);
  const bankCounts = {}, classCounts = {};
  for (const value of bank.values()) {
    if (value.lane.verdict) bankCounts[value.lane.verdict] = (bankCounts[value.lane.verdict] ?? 0) + 1;
    if (!LABELS.includes(value.lane.verdict) || (value.kinds ?? []).includes('cash')) continue;
    const cls = value.verb === 'resolve' ? 'resolve' : batchClass(value.input.proposal);
    classCounts[cls] ??= {refuse: 0, all: 0};
    classCounts[cls].all++; if (REFUSE.has(value.lane.verdict)) classCounts[cls].refuse++;
  }
  const classRefusalRate = Object.fromEntries(Object.entries(classCounts).map(([name, row]) => [name, round(row.refuse / row.all)]));
  const arms = {};
  let sampleCounts;
  for (const arm of options.arms) {
    const cases = readJsonl(arm.path).map(row => {
      const value = bank.get(row.id);
      return {id: row.id, lane: labels ? (labels.get(row.id) ?? null) : row.lane, source: row.source,
        cls: value ? (value.verb === 'resolve' ? 'resolve' : batchClass(value.input.proposal)) : 'other',
        read: readRow(row, arm.reading), jev_ms: row.route === 'typed' || row.route === 'fallback' ? row.jev_ms : undefined};
    }).filter(value => value.jev_ms !== undefined || value.read);
    const counts = {};
    for (const value of cases) if (LABELS.includes(value.lane)) counts[value.lane] = (counts[value.lane] ?? 0) + 1;
    sampleCounts ??= counts;
    const bySource = {};
    for (const source of ['persona-bench', 'table']) {
      const subset = cases.filter(value => (value.source === 'persona-bench') === (source === 'persona-bench'));
      const table = armTable(subset, mixWeights(counts, bankCounts), classRefusalRate);
      bySource[source] = {labelled: table.labelled, by_threshold: table.by_threshold.map(({per_label: _label, per_class: _class, ...row}) => row)};
    }
    arms[arm.name] = {reading: arm.reading, path: arm.path, ...armTable(cases, mixWeights(counts, bankCounts), classRefusalRate), by_source: bySource};
  }
  const report = {generated_at: new Date().toISOString(), thresholds: THRESHOLDS, bank_label_counts: bankCounts, sample_label_counts: sampleCounts,
    class_refusal_rate_bank: classRefusalRate,
    arms, lane_floor: laneFloor(options.root)};
  mkdirSync(options.out, {recursive: true});
  writeFileSync(join(options.out, 'analysis.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(options.out, 'analysis.md'), markdown(report));
  process.stdout.write(markdown(report));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
