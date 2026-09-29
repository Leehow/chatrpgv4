/**
 * Contract §150.3 (ticket 03 of docs/specs/jev-decides-llm-writes.md): the reading service's Jev claim-support check.
 *
 * Asked once per verify round, before the vision reviewers run: which records of the candidate the cited pages' native
 * text states (`runtime/jev/source-claim-support.ts`). This file is the glue: the mode (env over data), the native text
 * of the cited pages, the lease and the one Jev adapter of the step, the evidence file the publication gate reads
 * (`claim-support.json`), the merge of Jev rows into `review.json` and the telemetry rows. It never refuses a record and
 * never fails a reading: anything it cannot do leaves every record with the vision reviewer.
 *
 * - `shadow` (shipped until §150.3.1's bar passes): ask, record the answers beside the vision verdicts, change nothing.
 * - `on`: the cleared records' paths are taken out of the vision units, and after the review one `reviewer: "jev"` row
 *   per cleared record is appended to `review.json`, except where a vision row did not support an overlapping path.
 * - `off`: no Jev call.
 */
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createDecisionAdapter, JEV_INPUT_USD_PER_MILLION} from '../../runtime/jev/decision-adapter.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {CLAIM_SUPPORT_FAMILY, citedPages, claimBatches, claimCandidates, claimSupportBindings, claimSupportMode, clipBytes, factRecords,
  readClaimSupportBudget, runClaimSupport, type ClaimSupportBudget, type ClaimSupportInput, type ClaimVerdict, type NativePage} from '../../runtime/jev/source-claim-support.ts';
import {CLAIM_SUPPORT_FILE, CLAIM_SUPPORT_PROTOCOL, JEV_REVIEWER, pathsOverlap} from '../../kernel-ts/modules/claim-support.ts';
import {readJevApiKey} from '../jev/agent/config.js';

type Row = Record<string, any>;
/** What `sourceText` returns for the bound document (`extensions/module/source.ts`), as far as this check reads it. */
export interface NativeTextBundle {
  file_sha256: string;
  extraction_version: string;
  snapshots: Array<{page: number; text: string; text_sha256: string}>;
  errors?: Array<{page: number}>;
}
export interface ClaimSupportRequest {
  /** The reading's work directory: `claim-support.json` is written here, a copy into `verify-<round>/`. */
  cwd: string;
  round: number;
  module: string;
  job: string;
  campaign?: string;
  source: {file_sha256: string};
  /** The task the reviewers read (`known_nodes` name a claim's nodes that the draft does not carry). */
  task: Row;
  draft: Row;
  /** The review units as `reviewCandidate` formed them. */
  units: string[][];
  /** The bound document's native text of up to 32 physical pages, pinned to `source.file_sha256`. */
  sourceText(pages: number[]): Promise<NativeTextBundle>;
  signal: AbortSignal;
  record(row: Row): void;
}
export interface ClaimSupportCheck {
  mode: 'on' | 'shadow';
  /** The paths the vision units no longer carry: every path of a cleared record in `on`, none in `shadow`. */
  skip: ReadonlySet<string>;
  /** After the vision review wrote `review.json`: merge the Jev rows (`on`) and record the pairing with the vision verdicts. */
  settle(reviewPath: string): Promise<void>;
}

/** One build request of the check may take one retry on a dropped connection; a timeout is final. */
const CLAIM_RETRY = {maxRetries: 1, backoffInitialMs: 200, backoffMaxMs: 1_000, retryNetwork: true, retryTimeout: false};
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

async function nativePages(request: ClaimSupportRequest, pages: number[]): Promise<{version: string; pages: Map<number, NativePage>}> {
  const native = new Map<number, NativePage>();
  let version = '';
  for (let first = 0; first < pages.length; first += 32) {
    const bundle = await request.sourceText(pages.slice(first, first + 32));
    if (bundle.file_sha256 !== request.source.file_sha256) throw new Error('native text is not of the bound source');
    if (version && bundle.extraction_version !== version) throw new Error('native text changed extraction version mid-check');
    version = bundle.extraction_version;
    for (const snapshot of bundle.snapshots)
      if (typeof snapshot.text === 'string' && sha(snapshot.text) === snapshot.text_sha256)
        native.set(snapshot.page, {page: snapshot.page, text: snapshot.text, text_sha256: snapshot.text_sha256});
  }
  return {version, pages: native};
}

/** The verdict words vision rows gave paths overlapping a record's paths (Jev rows excluded). */
function visionWords(review: Row, paths: string[]): string[] {
  const words: string[] = [];
  for (const row of Array.isArray(review.checked) ? review.checked : []) {
    if (!row || typeof row !== 'object' || row.reviewer === JEV_REVIEWER) continue;
    const rowPaths: unknown[] = Array.isArray(row.paths) ? row.paths : [row.path];
    if (rowPaths.some(path => typeof path === 'string' && paths.some(own => pathsOverlap(own, path)))) words.push(String(row.verdict));
  }
  return words;
}

/**
 * The reading service's step: `undefined` leaves every unit as it is (mode `off`, no key, no budget, nothing eligible,
 * native text unavailable, or an error of the step itself). `decision` is for tests; production builds its own adapter.
 */
export function createClaimSupport(deps: {env: NodeJS.ProcessEnv; contentRoot: string; decision?: DecisionPort}): (request: ClaimSupportRequest) => Promise<ClaimSupportCheck | undefined> {
  let budgetRead: Promise<ClaimSupportBudget | undefined> | undefined;
  return async request => {
    const began = Date.now();
    const budget = await (budgetRead ??= readClaimSupportBudget(deps.contentRoot));
    const {mode, source} = claimSupportMode(deps.env, budget);
    if (mode === 'off' || !budget) return undefined;
    const base: Row = {lane: 'reading', event: 'claim_support', phase: 'verify', family: CLAIM_SUPPORT_FAMILY, mode, mode_source: source, round: request.round};
    const skipped = (status: string, extra: Row = {}) => { request.record({...base, status, ...extra, ms: Date.now() - began}); return undefined; };
    try {
      if (!deps.decision && !readJevApiKey(deps.env)) return skipped('unconfigured');
      const records = factRecords(request.units), pages = citedPages(request.draft, request.units);
      if (!pages.length) return skipped('nothing_eligible', {records: records.size});
      let native: {version: string; pages: Map<number, NativePage>};
      try { native = await nativePages(request, pages); }
      catch { return skipped('native_text_unavailable', {records: records.size}); }
      const {candidates, ineligible} = claimCandidates(request.draft, request.units, request.task,
        page => (native.pages.get(page)?.text.trim() ?? '') !== '', budget.recordMaxBytes);
      if (!candidates.length) return skipped('nothing_eligible', {records: records.size, ineligible});
      const input: ClaimSupportInput = {module: request.module, ...(request.campaign ? {campaign: request.campaign} : {}), job: request.job,
        sourceSha256: request.source.file_sha256, extractionVersion: native.version, candidates, pages: native.pages, budget};
      // The lease covers every request of the check at its worst (each attempt of each batch at its packed upper bound).
      const attempts = CLAIM_RETRY.maxRetries + 1, bounds = claimBatches(input).batches.map(({batch}) => packDecisionBatch(batch).estimate);
      const inputTokens = bounds.reduce((sum, bound) => sum + bound.totalUpperBound, 0) * attempts;
      const outputTokens = bounds.reduce((sum, bound) => sum + bound.responseUpperBound, 0) * attempts;
      const bindings = claimSupportBindings(input);
      const lease = new TaskLease({owner: CLAIM_SUPPORT_FAMILY, goal: 'Check which drafted records the cited pages state', scope: bindings.scope,
        capabilities: ['decision'], readSet: bindings.readSet, signal: request.signal,
        budget: {deadlineAt: began + budget.timeoutMs, remainingInputTokens: Math.max(1, inputTokens), remainingOutputTokens: Math.max(1, outputTokens),
          remainingCostUsd: inputTokens * JEV_INPUT_USD_PER_MILLION / 1_000_000 + 0.001, remainingActions: Math.max(1, bounds.length * attempts)}});
      let result;
      try {
        const decision = deps.decision ?? createDecisionAdapter({env: deps.env, maxConcurrency: 4, retryPolicies: {[CLAIM_SUPPORT_FAMILY]: CLAIM_RETRY}});
        result = await runClaimSupport(input, decision, lease);
      } finally { lease.close(); }
      const asked = new Set(result.verdicts.flatMap(verdict => verdict.pages));
      const evidence: Row = {protocol: CLAIM_SUPPORT_PROTOCOL, source_sha256: request.source.file_sha256, extraction_version: native.version,
        mode, mode_source: source, gate: {supported_min: budget.supportedMin, contradicted_max: budget.contradictedMax},
        pages: [...asked].sort((a, b) => a - b).map(page => {
          const text = native.pages.get(page)!;
          return {page, text: text.text, text_sha256: text.text_sha256,
            ...(clipBytes(text.text, budget.pageTextMaxBytes).clipped ? {clipped_bytes: budget.pageTextMaxBytes} : {})};
        }),
        records: result.verdicts.map(verdict => ({root: verdict.root, paths: verdict.paths, pages: verdict.pages, statement: verdict.statement,
          status: verdict.status, cleared: verdict.cleared,
          ...(verdict.supported !== undefined || verdict.contradicted !== undefined
            ? {distribution: {...(verdict.supported !== undefined ? {supported: verdict.supported} : {}), ...(verdict.contradicted !== undefined ? {contradicted: verdict.contradicted} : {})}} : {}),
          ...(verdict.reason ? {reason: verdict.reason} : {})}))};
      const roundDir = join(request.cwd, `verify-${request.round}`);
      const write = async (value: Row) => {
        const text = JSON.stringify(value) + '\n';
        await writeFile(join(request.cwd, CLAIM_SUPPORT_FILE), text);
        await mkdir(roundDir, {recursive: true});
        await writeFile(join(roundDir, CLAIM_SUPPORT_FILE), text);
      };
      await write(evidence);
      const cleared = result.verdicts.filter(verdict => verdict.cleared);
      const skip = new Set(mode === 'on' ? cleared.flatMap(verdict => verdict.paths) : []);
      const answered = result.verdicts.filter(verdict => verdict.status === 'answered').length;
      const failures: Record<string, number> = {};
      for (const verdict of result.verdicts) if (verdict.status === 'unanswered') failures[verdict.reason ?? 'no_answer'] = (failures[verdict.reason ?? 'no_answer'] ?? 0) + 1;
      request.record({...base, status: answered ? 'answered' : 'unanswered', records: records.size, eligible: candidates.length, ineligible,
        asked: result.verdicts.length, answered, cleared: cleared.length, skipped_paths: skip.size, requests: result.requests, calls: result.calls,
        ms: Date.now() - began, jev_ms: result.elapsedMs, input_tokens: result.usage.inputTokens, cost_usd: result.usage.costUsd,
        clipped_pages: evidence.pages.filter((page: Row) => page.clipped_bytes !== undefined).length,
        ...(Object.keys(failures).length ? {unanswered: failures} : {})});
      return {mode, skip, async settle(reviewPath: string) {
        const review = JSON.parse(await readFile(reviewPath, 'utf8'));
        const paired: Row = {cleared_supported: 0, cleared_negative: 0, cleared_unreviewed: 0, uncleared_supported: 0, uncleared_negative: 0, uncleared_unreviewed: 0};
        const rows: Row[] = [];
        let overruled = 0;
        const records = evidence.records.map((row: Row, index: number) => {
          const verdict: ClaimVerdict = result.verdicts[index], words = visionWords(review, verdict.paths);
          const vision = !words.length ? 'unreviewed' : words.every(word => word === 'supported') ? 'supported' : 'negative';
          paired[`${verdict.cleared ? 'cleared' : 'uncleared'}_${vision}`]++;
          if (mode === 'on' && verdict.cleared) {
            if (vision === 'negative') overruled++;
            else rows.push({paths: verdict.paths, verdict: 'supported', reviewer: JEV_REVIEWER,
              source_refs: verdict.pages.map(page => ({page})),
              page_text_sha256: Object.fromEntries(verdict.pages.map(page => [String(page), native.pages.get(page)!.text_sha256])),
              extraction_version: native.version, distribution: {supported: verdict.supported, contradicted: verdict.contradicted},
              reason: 'Jev claim-support check: the cited pages\' native text states this record.'});
          }
          return {...row, vision, ...(words.length ? {vision_verdicts: words} : {})};
        });
        if (rows.length) {
          review.checked = [...(Array.isArray(review.checked) ? review.checked : []), ...rows];
          await writeFile(reviewPath, JSON.stringify(review) + '\n');
        }
        await write({...evidence, records});
        request.record({...base, event: 'claim_support_paired', ...paired, jev_rows: rows.length, overruled,
          agreement: round3((paired.cleared_supported + paired.uncleared_negative) / Math.max(1, paired.cleared_supported + paired.cleared_negative + paired.uncleared_supported + paired.uncleared_negative))});
      }};
    } catch (error) {
      return skipped('claim_owner_error', {detail: String(error instanceof Error ? error.message : error).slice(0, 200)});
    }
  };
}
