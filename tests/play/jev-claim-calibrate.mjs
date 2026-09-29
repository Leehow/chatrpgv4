#!/usr/bin/env node
/**
 * Contract §150.3.1 (ticket 03 of docs/specs/jev-decides-llm-writes.md): the offline calibration of the Jev claim-support
 * check against the retained vision reviewer verdicts of one or more homes.
 *
 * What it replays: every retained verify round (`.../verify-<n>/unit-<n>/attempt-<id>/{review.json,draft.json,task.json}`
 * under a home's `.pi/` and `.coc/`) of a fact review (never guidance or source answers). A round's units share one
 * candidate; the tool rebuilds the round's units from the retained unit tasks, asks the product's own check
 * (`runtime/jev/source-claim-support.ts`: eligibility, statement, batches, the two Nouls) through the real decision
 * adapter against the cited pages' native text of the bound source, and pairs each asked record with the verdicts the
 * vision reviewers gave its paths in that round. Only eligible records are asked (§150.3: text claims or nodes in a fact
 * unit, no image source or map region, no region citation, every cited page with native text).
 *
 * Labels: a record is `negative` when any vision verdict on an overlapping path in that round is `unsupported`,
 * `contradicted` or `unclear`; `supported` when every such verdict is `supported`; `contested` (a classification dispute)
 * is reported and left out of the bar. Duplicates -- the same statement on the same page texts of the same source, asked
 * again in another round or home -- are merged into one unique claim: negative if any instance was negative; a unique
 * negative counts as cleared at (S, C) if any of its readings clears (conservative for precision), a unique supported
 * claim only if every reading clears (conservative for coverage).
 *
 * Output (`--out`, default `.pi/jev-claim-calibration-<timestamp>/` in this checkout): `records.jsonl` (one row per asked
 * record instance), `summary.json` (counts, the grid, the bar outcome), `grid.md`. Native text comes from the source
 * driver's `native-navigation-v2.json` beside a module's page cache when it matches this checkout's extraction version,
 * else from `sourceText` on the module's PDF; either way it is cached under the output directory. The retained homes are
 * only read.
 *
 * Live Jev calls are the point (cheap: $0.042/M input tokens). The key is read from the App's encrypted vault the way
 * `tests/play/npc-act-probe.mjs` reads it, or `EXT_JEV_APIKEY`; it is never printed or written.
 *
 * Usage: node tests/play/jev-claim-calibrate.mjs --home <checkout-or-home> [--home ...] [--out <dir>] [--concurrency 8]
 *        [--limit <rounds>] [--dry-run]
 */
import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {mkdir, readFile, writeFile, appendFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {claimBatches, claimCandidates, claimSupportBindings, citedPages, readClaimSupportBudget, runClaimSupport, CLAIM_SUPPORT_FAMILY} from '../../runtime/jev/source-claim-support.ts';
import {pathsOverlap} from '../../kernel-ts/modules/claim-support.ts';
import {sourceText, sourceTextVersion} from '../../extensions/module/source.ts';
import {readVaultSecret} from '../../experiments/single-loop-routing/vault.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NEGATIVE = new Set(['unsupported', 'contradicted', 'unclear']);
const S_GRID = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.98, 0.99];
const C_GRID = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1];

function args(argv) {
  const out = {homes: [], concurrency: 8, dryRun: false};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--home') out.homes.push(resolve(argv[++i]));
    else if (flag === '--out') out.out = resolve(argv[++i]);
    else if (flag === '--concurrency') out.concurrency = Math.max(1, Math.min(8, Number(argv[++i]) || 8));
    else if (flag === '--limit') out.limit = Number(argv[++i]);
    else if (flag === '--dry-run') out.dryRun = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!out.homes.length) throw new Error('name at least one --home');
  out.out ??= join(REPO, '.pi', `jev-claim-calibration-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  return out;
}
const sha = value => createHash('sha256').update(value).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));

/** Every retained unit attempt with its three files, under a home's `.pi` and `.coc` (symbolic links are not followed). */
function unitAttempts(home) {
  const found = [];
  const walk = dir => {
    let entries;
    try { entries = readdirSync(dir, {withFileTypes: true}); } catch { return; }
    const names = new Set(entries.map(entry => entry.name));
    if (/\/verify-\d+\/unit-\d+\/attempt-[^/]+$/.test(dir) && names.has('review.json') && names.has('draft.json') && names.has('task.json')) found.push(dir);
    for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== 'node_modules') walk(join(dir, entry.name));
  };
  for (const root of ['.pi', '.coc']) walk(join(home, root));
  return found;
}

/** The module directory a work path belongs to, its source PDF and digest. */
const modules = new Map();
function moduleOf(attempt) {
  const at = attempt.lastIndexOf('/work/');
  if (at < 0) return undefined;
  const dir = attempt.slice(0, at);
  if (modules.has(dir)) return modules.get(dir);
  let value;
  try {
    const meta = json(join(dir, 'module.json')), document = meta.source_document ?? {};
    const pdf = typeof document.path === 'string' ? resolve(dir, document.path) : undefined;
    const fileSha = document.file_sha256 ?? meta.file_sha256 ?? (pdf && existsSync(pdf) ? sha(readFileSync(pdf)) : undefined);
    value = fileSha ? {dir, pdf: pdf && existsSync(pdf) ? pdf : undefined, fileSha, pageCount: meta.page_count ?? document.page_count} : undefined;
  } catch { value = undefined; }
  modules.set(dir, value);
  return value;
}

/** Native text of one source, from a matching navigation cache of any of its module directories, else extracted. */
class NativeText {
  constructor(out) { this.out = out; this.sources = new Map(); }
  async pages(module, pages) {
    let source = this.sources.get(module.fileSha);
    if (!source) {
      source = {pdfs: new Set(), text: new Map()};
      const cached = join(this.out, 'native', `${module.fileSha}.json`);
      if (existsSync(cached)) for (const row of json(cached).pages) source.text.set(row.page, row);
      this.sources.set(module.fileSha, source);
    }
    if (module.pdf) source.pdfs.add(module.pdf);
    if (!source.navigation) {
      source.navigation = true;
      const nav = join(module.dir, 'cache', 'native-navigation-v2.json');
      if (existsSync(nav)) {
        const saved = json(nav);
        if (saved.file_sha256 === module.fileSha && saved.extraction_version === sourceTextVersion)
          for (const row of saved.pages) if (!source.text.has(row.page)) source.text.set(row.page, {page: row.page, text: row.text ?? '', text_sha256: sha(Buffer.from(row.text ?? '', 'utf8'))});
        else source.navigation = false;
      } else source.navigation = false;
    }
    // One extraction per source at a time: rounds of the same book run concurrently.
    const previous = source.lock ?? Promise.resolve();
    let release;
    source.lock = new Promise(done => { release = done; });
    await previous;
    try { await this.extract(module, source, pages); } finally { release(); }
    return new Map(pages.map(page => [page, source.text.get(page)]));
  }
  async extract(module, source, pages) {
    const missing = pages.filter(page => !source.text.has(page));
    if (missing.length) {
      const pdf = [...source.pdfs][0];
      if (!pdf) throw new Error(`no PDF for source ${module.fileSha}`);
      for (let first = 0; first < missing.length; first += 32) {
        const bundle = await sourceText(pdf, {pages: missing.slice(first, first + 32), expected_file_sha256: module.fileSha});
        for (const row of bundle.snapshots) source.text.set(row.page, {page: row.page, text: row.text, text_sha256: row.text_sha256});
        for (const error of bundle.errors) source.text.set(error.page, {page: error.page, text: '', text_sha256: sha('')});
      }
      await mkdir(join(this.out, 'native'), {recursive: true});
      await writeFile(join(this.out, 'native', `${module.fileSha}.json`), JSON.stringify({file_sha256: module.fileSha, extraction_version: sourceTextVersion, pages: [...source.text.values()]}));
    }
  }
}

/** The retained verify rounds: one candidate each, its units rebuilt from the unit tasks, its vision verdicts. */
function rounds(homes) {
  const byRound = new Map();
  for (const home of homes) for (const attempt of unitAttempts(home)) {
    const unitDir = dirname(attempt), roundDir = dirname(unitDir);
    let draftBytes, task, review;
    try { draftBytes = readFileSync(join(attempt, 'draft.json')); task = json(join(attempt, 'task.json')); review = json(join(attempt, 'review.json')); }
    catch { continue; }
    const key = `${roundDir}#${sha(draftBytes)}`;
    const round = byRound.get(key) ?? {key, roundDir, draftBytes, draft: JSON.parse(draftBytes.toString()), units: new Map(), reviews: [], task, purpose: task.purpose, policy: task.review_policy ?? null};
    if (Array.isArray(task.required_review)) round.units.set(unitDir, task.required_review);
    round.reviews.push(review);
    byRound.set(key, round);
  }
  return [...byRound.values()];
}

function labelOf(round, paths) {
  const words = [];
  for (const review of round.reviews) for (const row of Array.isArray(review?.checked) ? review.checked : []) {
    if (!row || typeof row !== 'object') continue;
    const rowPaths = Array.isArray(row.paths) ? row.paths : [row.path];
    if (rowPaths.some(path => typeof path === 'string' && paths.some(own => pathsOverlap(own, path)))) words.push(String(row.verdict));
  }
  const label = !words.length ? 'unlabeled' : words.some(word => NEGATIVE.has(word)) ? 'negative' : words.every(word => word === 'supported') ? 'supported' : 'contested';
  const reasons = [];
  for (const review of round.reviews) for (const row of Array.isArray(review?.checked) ? review.checked : [])
    if (row && NEGATIVE.has(row.verdict) && (Array.isArray(row.paths) ? row.paths : [row.path]).some(path => typeof path === 'string' && paths.some(own => pathsOverlap(own, path))))
      reasons.push(String(row.reason ?? '').slice(0, 400));
  return {label, words, reasons};
}

async function pool(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => { while (next < items.length) { const index = next++; await work(items[index], index); } }));
}

function grid(unique) {
  const supported = unique.filter(row => row.label === 'supported'), negative = unique.filter(row => row.label === 'negative');
  const cleared = (row, s, c, mode) => mode(row.readings, reading => reading.supported >= s && reading.contradicted <= c);
  const points = [];
  for (const s of S_GRID) for (const c of C_GRID) {
    const clearedSupported = supported.filter(row => cleared(row, s, c, (list, f) => list.every(f))).length;
    const clearedNegative = negative.filter(row => cleared(row, s, c, (list, f) => list.some(f)));
    const point = {S: s, C: c, supported: supported.length, cleared_supported: clearedSupported, cleared_supported_share: supported.length ? clearedSupported / supported.length : 0,
      negatives: negative.length, cleared_negatives: clearedNegative.length, cleared_negative_rate: negative.length ? clearedNegative.length / negative.length : 0,
      cleared_negative_keys: clearedNegative.map(row => row.key)};
    point.bar = point.cleared_negatives <= 1 && point.cleared_negative_rate <= 0.01 && point.cleared_supported_share >= 0.5;
    points.push(point);
  }
  return points;
}

async function main() {
  const options = args(process.argv.slice(2));
  await mkdir(options.out, {recursive: true});
  const budget = await readClaimSupportBudget(join(REPO, 'content'));
  if (!budget) throw new Error('the shipped host-budgets.json has no readable source_claim_support block');
  const all = rounds(options.homes);
  const skipped = {non_fact_purpose: 0, no_units: 0, no_module: 0, duplicate_round: 0};
  const seenRounds = new Set();
  const fact = [];
  for (const round of all) {
    if (!['detail', 'opening', 'skeleton'].includes(round.purpose)) { skipped.non_fact_purpose++; continue; }
    if (!round.units.size) { skipped.no_units++; continue; }
    const module = moduleOf(round.roundDir);
    if (!module) { skipped.no_module++; continue; }
    const units = [...round.units.values()].map(paths => [...paths]);
    const identity = sha(JSON.stringify([module.fileSha, round.draftBytes.toString(), units.map(unit => [...unit].sort()).sort()]));
    // The same candidate and units retained twice (a copied home) is one round; its verdicts are merged into the first.
    if (seenRounds.has(identity)) { skipped.duplicate_round++; fact.find(row => row.identity === identity)?.round.reviews.push(...round.reviews); continue; }
    seenRounds.add(identity);
    fact.push({round, module, units, identity});
  }
  const selected = options.limit ? fact.slice(0, options.limit) : fact;
  const native = new NativeText(options.out);
  const apiKey = process.env.EXT_JEV_APIKEY?.trim() || readVaultSecret('EXT_JEV_APIKEY');
  if (!apiKey && !options.dryRun) throw new Error('no Jev key: set EXT_JEV_APIKEY or install the App vault');
  const adapter = options.dryRun ? undefined : createDecisionAdapter({apiKey, maxConcurrency: options.concurrency,
    retryPolicies: {[CLAIM_SUPPORT_FAMILY]: {maxRetries: 3, backoffInitialMs: 500, backoffMaxMs: 8000, retryNetwork: true, retryTimeout: true, attemptTimeoutMs: 30000}}});
  const records = join(options.out, 'records.jsonl');
  const ineligible = {}, usage = {inputTokens: 0, costUsd: 0, calls: 0, requests: 0}, failures = {};
  let asked = 0, estimate = 0, done = 0;
  await pool(selected, options.concurrency, async ({round, module, units}) => {
    const pages = citedPages(round.draft, units);
    let text;
    try { text = await native.pages(module, pages); }
    catch (error) { failures.native_text = (failures.native_text ?? 0) + 1; return; }
    const {candidates, ineligible: why} = claimCandidates(round.draft, units, round.task, page => (text.get(page)?.text ?? '').trim() !== '', budget.recordMaxBytes);
    for (const [reason, count] of Object.entries(why)) ineligible[reason] = (ineligible[reason] ?? 0) + count;
    if (!candidates.length) return;
    const input = {module: 'calibration', job: round.key.slice(-16), sourceSha256: module.fileSha, extractionVersion: sourceTextVersion, candidates,
      pages: new Map([...text].filter(([, value]) => value).map(([page, value]) => [page, value])), budget};
    const {batches} = claimBatches(input);
    estimate += batches.reduce((sum, {batch}) => sum + Buffer.byteLength(JSON.stringify(batch.state)) + Buffer.byteLength(JSON.stringify(batch.questions)), 0);
    asked += candidates.length;
    if (options.dryRun) return;
    const bindings = claimSupportBindings(input);
    const lease = new TaskLease({owner: CLAIM_SUPPORT_FAMILY, goal: 'Calibrate the claim-support check', scope: bindings.scope, capabilities: ['decision'], readSet: bindings.readSet,
      budget: {deadlineAt: Date.now() + 300_000, remainingInputTokens: 50_000_000, remainingOutputTokens: 5_000_000, remainingCostUsd: 5, remainingActions: 10_000}});
    let result;
    try { result = await runClaimSupport(input, adapter, lease); } finally { lease.close(); }
    usage.inputTokens += result.usage.inputTokens; usage.costUsd += result.usage.costUsd; usage.calls += result.calls; usage.requests += result.requests;
    const lines = result.verdicts.map(verdict => {
      if (verdict.status !== 'answered') failures[verdict.reason ?? 'no_answer'] = (failures[verdict.reason ?? 'no_answer'] ?? 0) + 1;
      const {label, words, reasons} = labelOf(round, verdict.paths);
      const pageDigests = verdict.pages.map(page => text.get(page)?.text_sha256 ?? '');
      return JSON.stringify({round: round.key.split('#')[0], purpose: round.purpose, policy: round.policy, source: module.fileSha, root: verdict.root, paths: verdict.paths, pages: verdict.pages,
        key: sha(JSON.stringify([module.fileSha, verdict.statement, verdict.pages, pageDigests])), statement: verdict.statement,
        status: verdict.status, supported: verdict.supported ?? null, contradicted: verdict.contradicted ?? null, label, words, ...(reasons.length ? {reasons} : {})});
    });
    if (lines.length) await appendFile(records, lines.join('\n') + '\n');
    done++;
    if (done % 25 === 0) process.stderr.write(`rounds ${done}/${selected.length}, records ${asked}, $${usage.costUsd.toFixed(4)}\n`);
  });
  const summary = {generated_at: new Date().toISOString(), homes: options.homes, extraction_version: sourceTextVersion,
    budget: {page_text_max_bytes: budget.pageTextMaxBytes, record_max_bytes: budget.recordMaxBytes, max_pages_per_request: budget.maxPagesPerRequest},
    rounds: {retained: all.length, fact: fact.length, asked: selected.length, skipped}, records_asked: asked, ineligible,
    state_bytes_estimate: estimate, dry_run: options.dryRun};
  if (!options.dryRun) {
    const rows = existsSync(records) ? readFileSync(records, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    const answered = rows.filter(row => row.status === 'answered' && ['supported', 'negative'].includes(row.label));
    const unique = new Map();
    for (const row of answered) {
      const entry = unique.get(row.key) ?? {key: row.key, label: row.label, readings: [], example: row};
      if (row.label === 'negative') entry.label = 'negative';
      entry.readings.push({supported: row.supported, contradicted: row.contradicted});
      unique.set(row.key, entry);
    }
    const points = grid([...unique.values()]);
    const passing = points.filter(point => point.bar).sort((a, b) => b.cleared_supported_share - a.cleared_supported_share || b.S - a.S || a.C - b.C);
    const labels = {};
    for (const row of rows) labels[`${row.status}:${row.label}`] = (labels[`${row.status}:${row.label}`] ?? 0) + 1;
    summary.usage = usage; summary.failures = failures; summary.instances = {rows: rows.length, labels};
    summary.unique = {claims: unique.size, supported: [...unique.values()].filter(row => row.label === 'supported').length, negative: [...unique.values()].filter(row => row.label === 'negative').length};
    summary.grid = points.map(({cleared_negative_keys: _keys, ...point}) => point);
    summary.bar = passing.length ? {met: true, chosen: (({cleared_negative_keys: _keys, ...point}) => point)(passing[0])} : {met: false};
    const chosen = passing[0] ?? points.filter(point => point.cleared_negatives <= 1 && point.cleared_negative_rate <= 0.01).sort((a, b) => b.cleared_supported_share - a.cleared_supported_share)[0];
    if (chosen) summary.cleared_negatives_at_best = [...unique.values()].filter(row => chosen.cleared_negative_keys.includes(row.key))
      .map(row => ({statement: row.example.statement, pages: row.example.pages, readings: row.readings, reasons: row.example.reasons}));
    // The negatives the strictest-precision reading would still clear, for inspection whether or not the bar passes.
    const lines = ['| S | C | cleared supported | share | cleared negatives | rate | bar |', '|---|---|---|---|---|---|---|'];
    for (const point of points) lines.push(`| ${point.S} | ${point.C} | ${point.cleared_supported}/${point.supported} | ${(100 * point.cleared_supported_share).toFixed(1)}% | ${point.cleared_negatives}/${point.negatives} | ${(100 * point.cleared_negative_rate).toFixed(2)}% | ${point.bar ? 'met' : ''} |`);
    await writeFile(join(options.out, 'grid.md'), lines.join('\n') + '\n');
  }
  await writeFile(join(options.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(JSON.stringify({out: options.out, records_asked: asked, bar: summary.bar ?? null, usage: summary.usage ?? null, unique: summary.unique ?? null}, null, 2) + '\n');
}

await main();
