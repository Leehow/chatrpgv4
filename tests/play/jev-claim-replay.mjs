#!/usr/bin/env node
/**
 * Contract §186.6 (RC-06 of docs/specs/reading-cost-tickets.md): replay one frozen split (`tests/play/jev-claim-splits.mjs`)
 * through the product's own claim check -- eligibility (`claimCandidates`, the shared `claimSupportIneligibility` with the
 * task's classification fields), statements (`claimFields`), batching, questions and gate (`runClaimSupport`) -- through
 * the real decision adapter (`jev-1.13.0`), and grid (S, C) over the answers.
 *
 * Each round is one candidate as the product saw it: the round's draft, one unit per record the shipped check asked
 * (`/coverage` never), the task's known nodes and classification fields (the shipped graph contract's when the task has
 * none, as the host does), the cited pages' native text. The budget's page clip, record bound and page cap are the
 * shipped data's; S and C are not used here: every statement's two Nouls are kept and the grid is computed afterwards.
 *
 * Scoring (unique records, as the split builder keys them): a unique strict negative counts as cleared at (S, C) if any
 * of its instances clears; a unique supported record only if every instance clears. Records the redesign makes
 * ineligible stay in the population and count as not cleared (they go to vision). Contested-only and unreviewed records
 * are never scored. The chosen point (§186.6) is the one with zero cleared strict negatives that clears the most
 * supported records (ties: higher S, then lower C).
 *
 * The held-out split is read once (§186.6): it needs `--heldout-once`. Every replay goes to a fresh output directory. The Jev key comes from `EXT_JEV_APIKEY` or the App vault and is never printed or written.
 *
 * Usage: node tests/play/jev-claim-replay.mjs --split .tmp/rc06/tuning.json --out .tmp/rc06/tuning-run
 *        [--manifest .tmp/rc06/manifest.json] [--concurrency 4] [--dry-run] [--heldout-once]
 *        node tests/play/jev-claim-replay.mjs --split <same> --out <existing replay> --regrid   (no Jev call)
 *        node tests/play/jev-claim-replay.mjs --split <same> --out <existing replay> --score S,C
 *          [--relabel <adjudication.json> --packets <judge index.json>]   (one point, raw and adjudicated labels; no Jev call)
 */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {appendFile, mkdir, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {claimBatches, claimCandidates, claimClassifier, claimCleared, claimSupportBindings, readClaimSupportBudget, runClaimSupport,
  CLAIM_SUPPORT_FAMILY, CLAIM_SUPPORT_VERSION} from '../../runtime/jev/source-claim-support.ts';
import {readVaultSecret} from '../../experiments/single-loop-routing/vault.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const S_GRID = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.98, 0.99];
const C_GRID = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1];
const SCORED = new Set(['supported', 'strict_negative']);
/** A unique record's label, as the split builder keys it: strict negative over contested-only over supported. */
const RANK = {strict_negative: 3, contested_only: 2, supported: 1};

function args(argv) {
  const out = {concurrency: 4, dryRun: false, heldoutOnce: false, regrid: false};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--split') out.split = resolve(argv[++i]);
    else if (flag === '--out') out.out = resolve(argv[++i]);
    else if (flag === '--manifest') out.manifest = resolve(argv[++i]);
    else if (flag === '--concurrency') out.concurrency = Math.max(1, Math.min(4, Number(argv[++i]) || 4));
    else if (flag === '--dry-run') out.dryRun = true;
    else if (flag === '--heldout-once') out.heldoutOnce = true;
    else if (flag === '--regrid') out.regrid = true;
    else if (flag === '--score') out.score = argv[++i].split(',').map(Number);
    else if (flag === '--relabel') out.relabel = resolve(argv[++i]);
    else if (flag === '--packets') out.packets = resolve(argv[++i]);
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!out.split || !out.out) throw new Error('name --split and --out');
  if (out.score && (out.score.length !== 2 || out.score.some(value => !Number.isFinite(value) || value < 0 || value > 1))) throw new Error('--score takes S,C');
  if (out.relabel && !out.packets) throw new Error('--relabel needs the --packets index that numbers its packets');
  out.manifest ??= join(dirname(out.split), 'manifest.json');
  return out;
}
const sha = value => createHash('sha256').update(value).digest('hex');

async function pool(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => { while (next < items.length) { const index = next++; await work(items[index], index); } }));
}

/** Every (S, C) over unique records; see the header for the scoring rules. */
export function grid(rows) {
  const unique = new Map();
  for (const row of rows) {
    if (!RANK[row.label]) continue;
    const entry = unique.get(row.key) ?? {key: row.key, label: row.label, type: row.type, readings: []};
    if (RANK[row.label] > RANK[entry.label]) entry.label = row.label;
    entry.readings.push(row.answers && row.status === 'answered' ? row.answers : null);
    unique.set(row.key, entry);
  }
  const entries = [...unique.values()].filter(entry => SCORED.has(entry.label));
  const clears = (answers, s, c) => answers !== null && answers.length > 0 && answers.every(([, supported, contradicted]) => claimCleared(supported, contradicted, {supportedMin: s, contradictedMax: c}));
  const points = [];
  for (const s of S_GRID) for (const c of C_GRID) {
    const point = {S: s, C: c, supported: 0, cleared_supported: 0, negatives: 0, cleared_negatives: 0, by_type: {}, cleared_negative_keys: []};
    for (const entry of entries) {
      const type = point.by_type[entry.type] ??= {supported: 0, cleared_supported: 0, negatives: 0, cleared_negatives: 0};
      if (entry.label === 'supported') {
        const cleared = entry.readings.every(reading => clears(reading, s, c));
        point.supported++; type.supported++;
        if (cleared) { point.cleared_supported++; type.cleared_supported++; }
      } else {
        const cleared = entry.readings.some(reading => clears(reading, s, c));
        point.negatives++; type.negatives++;
        if (cleared) { point.cleared_negatives++; type.cleared_negatives++; point.cleared_negative_keys.push(entry.key); }
      }
    }
    point.cleared_supported_share = point.supported ? point.cleared_supported / point.supported : 0;
    point.cleared_negative_rate = point.negatives ? point.cleared_negatives / point.negatives : 0;
    point.bar = point.cleared_negatives <= 1 && point.cleared_negative_rate <= 0.01 && point.cleared_supported_share >= 0.5;
    points.push(point);
  }
  const chosen = points.filter(point => point.cleared_negatives === 0)
    .sort((a, b) => b.cleared_supported - a.cleared_supported || b.S - a.S || a.C - b.C)[0];
  return {points, chosen, unique: [...unique.values()]};
}

/**
 * One pre-registered point, scored on unique records with the split's labels and, optionally, adjudicated labels:
 * `relabel` is the set of unique keys two judges both found stated (§186.6), which become `supported`. Supported clears
 * only if every instance clears; a strict negative or a contested-only record counts as cleared if any instance does.
 */
export function scorePoint(rows, S, C, relabel = new Set()) {
  const unique = new Map();
  for (const row of rows) {
    if (!RANK[row.label]) continue;
    const entry = unique.get(row.key) ?? {key: row.key, label: row.label, type: row.type, readings: []};
    if (RANK[row.label] > RANK[entry.label]) entry.label = row.label;
    entry.readings.push(row.answers && row.status === 'answered' ? row.answers : null);
    unique.set(row.key, entry);
  }
  const clears = answers => answers !== null && answers.length > 0 && answers.every(([, supported, contradicted]) => claimCleared(supported, contradicted, {supportedMin: S, contradictedMax: C}));
  const out = {S, C, relabeled: 0, by_label: {}, by_type: {}, cleared_keys: {supported: [], strict_negative: [], contested_only: []}};
  for (const entry of unique.values()) {
    const label = relabel.has(entry.key) ? 'supported' : entry.label;
    if (relabel.has(entry.key)) out.relabeled++;
    const cleared = label === 'supported' ? entry.readings.every(clears) : entry.readings.some(clears);
    for (const bucket of [out.by_label[label] ??= {total: 0, cleared: 0}, (out.by_type[entry.type] ??= {})[label] ??= {total: 0, cleared: 0}]) {
      bucket.total++;
      if (cleared) bucket.cleared++;
    }
    if (cleared) out.cleared_keys[label].push(entry.key);
  }
  for (const label of Object.keys(out.cleared_keys)) out.cleared_keys[label].sort();
  const supported = out.by_label.supported ?? {total: 0, cleared: 0}, negative = out.by_label.strict_negative ?? {total: 0, cleared: 0};
  out.cleared_supported_share = supported.total ? supported.cleared / supported.total : 0;
  out.cleared_negative_rate = negative.total ? negative.cleared / negative.total : 0;
  // §151.3.1: cleared strict negatives <= 1 and <= 1 % of strict negatives, cleared share of supported >= 50 %.
  out.bar = negative.cleared <= 1 && out.cleared_negative_rate <= 0.01 && out.cleared_supported_share >= 0.5;
  return out;
}

/** The unique keys of the judged packets both judges found stated, through the packet index's instances. */
function relabelKeys(rows, adjudication, index) {
  const byInstance = new Map(rows.map(row => [`${row.round}#${row.root}`, row.key]));
  const packets = new Map(index.packets.map(packet => [packet.packet, packet]));
  const keys = new Set();
  for (const {packet: number} of adjudication.relabel_supported) {
    const packet = packets.get(number);
    if (!packet) throw new Error(`packet ${number} is not in the index`);
    const found = new Set(packet.instances.map(instance => byInstance.get(`${instance.round}#${instance.root}`)));
    if (found.size !== 1 || found.has(undefined)) throw new Error(`packet ${number} does not name one unique record of this replay`);
    keys.add([...found][0]);
  }
  return keys;
}

/** The grid, the chosen point and `grid.md` from a replay's `records.jsonl`, written into its `summary.json`. */
async function writeGrid(out, rows, summary) {
  const {points, chosen, unique} = grid(rows);
  const labels = {};
  for (const entry of unique) labels[`${entry.type}:${entry.label}`] = (labels[`${entry.type}:${entry.label}`] ?? 0) + 1;
  summary.unique = labels;
  summary.grid = points.map(({cleared_negative_keys: _keys, ...point}) => point);
  summary.chosen = chosen ? (({cleared_negative_keys: _keys, ...point}) => point)(chosen) : null;
  const lines = ['| S | C | cleared supported | share | claims | nodes | cleared strict negatives | rate | bar |', '|---|---|---|---|---|---|---|---|---|'];
  for (const point of points) {
    const type = name => point.by_type[name] ? `${point.by_type[name].cleared_supported}/${point.by_type[name].supported} (neg ${point.by_type[name].cleared_negatives}/${point.by_type[name].negatives})` : '-';
    lines.push(`| ${point.S} | ${point.C} | ${point.cleared_supported}/${point.supported} | ${(100 * point.cleared_supported_share).toFixed(1)}% | ${type('claim')} | ${type('node')} | ${point.cleared_negatives}/${point.negatives} | ${(100 * point.cleared_negative_rate).toFixed(2)}% | ${point.bar ? 'met' : ''} |`);
  }
  await writeFile(join(out, 'grid.md'), lines.join('\n') + '\n');
  await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options.score) {
    // Score an existing replay at one pre-registered point, without asking Jev again.
    const rows = readFileSync(join(options.out, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    const [S, C] = options.score;
    const report = {records_sha256: sha(readFileSync(join(options.out, 'records.jsonl'))), raw: scorePoint(rows, S, C)};
    if (options.relabel) {
      const adjudication = JSON.parse(readFileSync(options.relabel, 'utf8')), index = JSON.parse(readFileSync(options.packets, 'utf8'));
      const keys = relabelKeys(rows, adjudication, index);
      report.adjudication = {file: options.relabel, sha256: sha(readFileSync(options.relabel)), index: options.packets, index_sha256: sha(readFileSync(options.packets)),
        relabeled_packets: adjudication.relabel_supported.map(item => item.packet), relabeled_keys: [...keys].sort()};
      report.adjudicated = scorePoint(rows, S, C, keys);
    }
    await writeFile(join(options.out, `score-${S}-${C}.json`), JSON.stringify(report, null, 2) + '\n');
    const brief = value => value && (({cleared_keys: _keys, ...rest}) => rest)(value);
    process.stdout.write(JSON.stringify({raw: brief(report.raw), adjudicated: brief(report.adjudicated)}, null, 2) + '\n');
    return;
  }
  if (options.regrid) {
    // Recompute the grid of an existing replay without asking Jev again.
    const rows = readFileSync(join(options.out, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    const summary = JSON.parse(readFileSync(join(options.out, 'summary.json'), 'utf8'));
    await writeGrid(options.out, rows, summary);
    process.stdout.write(JSON.stringify({out: options.out, unique: summary.unique, chosen: summary.chosen}, null, 2) + '\n');
    return;
  }
  const text = readFileSync(options.split, 'utf8'), split = JSON.parse(text);
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
  if (manifest.split_files?.[basename(options.split)] !== sha(text)) throw new Error('the split file is not the one the manifest froze');
  if (split.split === 'heldout' && !options.heldoutOnce) throw new Error('the held-out split is read once (§186.6): pass --heldout-once when that read is due');
  if (existsSync(join(options.out, 'records.jsonl'))) throw new Error('this output directory already holds a replay; a split is replayed into a fresh directory (the held-out split once)');
  await mkdir(options.out, {recursive: true});
  const budget = await readClaimSupportBudget(join(REPO, 'content'));
  if (!budget) throw new Error('the shipped host-budgets.json has no readable source_claim_support block');
  const declared = JSON.parse(readFileSync(join(REPO, 'content', 'modules', 'module-graph-contract-v3.json'), 'utf8')).classification_fields?.node;
  const apiKey = process.env.EXT_JEV_APIKEY?.trim() || readVaultSecret('EXT_JEV_APIKEY');
  if (!apiKey && !options.dryRun) throw new Error('no Jev key: set EXT_JEV_APIKEY or install the App vault');
  const adapter = options.dryRun ? undefined : createDecisionAdapter({apiKey, maxConcurrency: options.concurrency,
    retryPolicies: {[CLAIM_SUPPORT_FAMILY]: {maxRetries: 5, backoffInitialMs: 1000, backoffMaxMs: 20000, retryNetwork: true, retryTimeout: true, attemptTimeoutMs: 30000}}});
  const records = join(options.out, 'records.jsonl');
  const usage = {inputTokens: 0, costUsd: 0, calls: 0, requests: 0}, failures = {}, ineligible = {};
  let asked = 0, statements = 0, questions = 0, stateBytes = 0, planned = 0, done = 0, fallbackRounds = 0;
  const began = Date.now();
  await pool(split.rounds, options.concurrency, async round => {
    const pages = new Map(Object.entries(round.pages).map(([page, value]) => [Number(page), {page: Number(page), text: value.text, text_sha256: value.text_sha256}]));
    const hasText = page => (pages.get(page)?.text ?? '').trim() !== '';
    if (!Array.isArray(round.task?.vocabulary?.classification_fields?.node)) fallbackRounds++;
    const classifies = claimClassifier(round.task, declared);
    // Why each record is or is not asked, record by record (the same function the candidate's request uses below).
    const why = new Map(round.records.map(record => {
      const one = claimCandidates(round.draft, [record.paths], round.task, hasText, budget.recordMaxBytes, classifies);
      return [record.root, one.candidates.length ? null : Object.keys(one.ineligible)[0] ?? 'not_asked'];
    }));
    const {candidates} = claimCandidates(round.draft, round.records.map(record => record.paths), round.task, hasText, budget.recordMaxBytes, classifies);
    const input = {module: 'calibration', job: sha(round.id).slice(0, 16), sourceSha256: round.source_sha256, extractionVersion: round.extraction_version,
      candidates, pages, budget};
    const {batches} = claimBatches(input);
    planned += batches.length;
    for (const {batch} of batches) { stateBytes += Buffer.byteLength(JSON.stringify(batch.state)); questions += batch.questions.length; }
    asked += candidates.length; statements += candidates.reduce((sum, candidate) => sum + candidate.fields.length, 0);
    let verdicts = new Map();
    if (!options.dryRun && candidates.length) {
      const bindings = claimSupportBindings(input);
      const lease = new TaskLease({owner: CLAIM_SUPPORT_FAMILY, goal: 'Calibrate the claim-support check', scope: bindings.scope, capabilities: ['decision'], readSet: bindings.readSet,
        budget: {deadlineAt: Date.now() + 900_000, remainingInputTokens: 50_000_000, remainingOutputTokens: 5_000_000, remainingCostUsd: 5, remainingActions: 10_000}});
      let result;
      try { result = await runClaimSupport(input, adapter, lease); } finally { lease.close(); }
      usage.inputTokens += result.usage.inputTokens; usage.costUsd += result.usage.costUsd; usage.calls += result.calls; usage.requests += result.requests;
      verdicts = new Map(result.verdicts.map(verdict => [verdict.root, verdict]));
    }
    const lines = round.records.map(record => {
      const reason = why.get(record.root), verdict = verdicts.get(record.root);
      if (reason) ineligible[`${reason}:${record.label}`] = (ineligible[`${reason}:${record.label}`] ?? 0) + 1;
      if (verdict && verdict.status !== 'answered') failures[verdict.reason ?? 'no_answer'] = (failures[verdict.reason ?? 'no_answer'] ?? 0) + 1;
      return JSON.stringify({round: round.id, origin: round.origin, root: record.root, type: record.root.startsWith('/claims/') ? 'claim' : 'node',
        kind: record.root.startsWith('/nodes/') ? (round.draft.nodes?.[Number(record.root.split('/')[2])]?.node_kind ?? null) : null,
        label: record.label, key: record.key,
        status: reason ? 'ineligible' : options.dryRun ? 'dry_run' : verdict?.status ?? 'unanswered', ...(reason ? {reason} : verdict?.reason ? {reason: verdict.reason} : {}),
        ...(verdict ? {supported: verdict.supported ?? null, contradicted: verdict.contradicted ?? null, fields: verdict.fields.length,
          answers: verdict.answers.map(answer => [answer.field, answer.supported ?? null, answer.contradicted ?? null])} : {})});
    });
    if (lines.length) await appendFile(records, lines.join('\n') + '\n');
    done++;
    if (done % 25 === 0) process.stderr.write(`rounds ${done}/${split.rounds.length}, records ${asked}, statements ${statements}, $${usage.costUsd.toFixed(4)}, ${Math.round((Date.now() - began) / 1000)} s\n`);
  });
  const rows = readFileSync(records, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const summary = {split: split.split, split_sha256: sha(text), manifest_sha256: sha(readFileSync(options.manifest)), family_version: CLAIM_SUPPORT_VERSION,
    budget: {page_text_max_bytes: budget.pageTextMaxBytes, record_max_bytes: budget.recordMaxBytes, max_pages_per_request: budget.maxPagesPerRequest},
    rounds: split.rounds.length, classification_fallback_rounds: fallbackRounds, records: rows.length, asked, statements, questions, requests_planned: planned, state_bytes: stateBytes,
    ineligible, failures, usage, elapsed_s: Math.round((Date.now() - began) / 1000), dry_run: options.dryRun};
  if (!options.dryRun) await writeGrid(options.out, rows, summary);
  else await writeFile(join(options.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(JSON.stringify({out: options.out, ...Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'grid'))}, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
