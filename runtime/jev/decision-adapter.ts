/** Typed direct-fetch Jev adapter. No cache in this first slice; every accepted call is attempt-local. */
import { ContractError, bindDecisionAnswers, isPlainRecord, probabilityMassValid, type DecisionBatch, type DecisionResult } from './contracts.ts';
import type { DecisionPort } from './decision-port.ts';
import type { TaskLease } from './task-context.ts';
import { JEV_MODEL, PackingError, packDecisionBatch, type PackingEstimate } from './question-packing.ts';
import { readJevApiKey } from '../../extensions/jev/agent/config.js';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
/** Official Jev 1.13 listing checked 2026-09-20: $0.042/M input tokens; output tokens free. */
export const JEV_INPUT_USD_PER_MILLION = 0.042;

export interface RetryPolicy {
  maxRetries: number;
  backoffInitialMs: number;
  backoffMaxMs: number;
  attemptTimeoutMs?: number;
  retryNetwork?: boolean;
  retryTimeout?: boolean;
}
export interface AnswerSchemaDiagnostic {
  key: string;
  type: DecisionBatch['questions'][number]['type'];
  fieldNames: string[];
  expectedProbabilityCount: number;
  actualProbabilityCount: number;
  missingProbabilityKeyCount: number;
  extraProbabilityKeyCount: number;
  probabilitySum: number | null;
  probabilitySumValid: boolean | null;
  probabilityRangeValid: boolean;
  selectedChoiceIsIssued?: boolean;
  confidence?: number;
}
export type AdapterTrace =
  | { kind: 'packing'; batchId: string; estimate: PackingEstimate; cache: 'disabled' }
  /** SL-84: one row per completed round trip -- `status` on an actual HTTP response (2xx included), `code` when the
   * fetch itself never produced one (a network error or an attempt-timeout abort). `retryAfter` carries the raw
   * `retry-after` header text, only when a 429 response sent one. */
  | { kind: 'attempt'; batchId: string; attempt: number; family: string; ms: number; status?: number; code?: 'network_error' | 'timeout'; retryAfter?: string }
  | { kind: 'retry'; batchId: string; attempt: number; delayMs: number; reason: string }
  | { kind: 'answer_schema'; batchId: string; status: 'incomplete'; diagnostics: AnswerSchemaDiagnostic[] }
  | { kind: 'usage'; batchId: string; attempts: number; inputTokens: number; outputTokens: number;
      cost: { kind: 'listed_price_estimate'; usd: number; inputUsdPerMillion: number; unknownRetryBoundUsd: number } }
  | { kind: 'failure'; batchId: string; attempts: number; family: string; code: NonNullable<DecisionResult['failure']>['code'];
      /** SL-84: the same last-attempt status/code carried onto the batch's own DecisionResult.failure.status. */
      status?: number | string;
      cost: { kind: 'reserved_bound_actual_unknown'; usd: number } };

/**
 * SL-84 (contract §122 "Jev attempt/batch failure telemetry" addendum): turns adapter trace events into the
 * ticket's two telemetry rows. A successful attempt (an HTTP status in [200, 300)) and a successful batch write
 * nothing. No request or response content ever reaches `record`; only family, status/code, retry count and timing.
 */
export function jevFailureTelemetry(record: (row: Record<string, unknown>) => void): (event: AdapterTrace) => void {
  return event => {
    if (event.kind === 'attempt') {
      const failed = event.code !== undefined || (typeof event.status === 'number' && (event.status < 200 || event.status >= 300));
      if (!failed) return;
      record({ lane: 'jev', event: 'attempt_failed', family: event.family,
        ...(event.status !== undefined ? { status: event.status } : {}),
        ...(event.code !== undefined ? { code: event.code } : {}),
        retry: event.attempt - 1, ms: event.ms,
        ...(event.retryAfter !== undefined ? { retry_after: event.retryAfter } : {}) });
    } else if (event.kind === 'failure') {
      record({ lane: 'jev', event: 'batch_failed', family: event.family, code: event.code, attempts: event.attempts });
    }
  };
}
export interface DecisionAdapterOptions {
  env?: Readonly<NodeJS.ProcessEnv>;
  /** Explicit injection for isolated transport tests; production callers pass their captured env. */
  apiKey?: string;
  enabled?: boolean;
  fetcher?: typeof fetch;
  maxConcurrency?: number;
  retryPolicies?: Record<string, RetryPolicy>;
  trace?: (event: AdapterTrace) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

class Semaphore {
  readonly #limit: number;
  #active = 0;
  readonly #queue: Array<{ signal: AbortSignal; accept(release: () => void): void; reject(error: unknown): void }> = [];
  constructor(limit: number) { this.#limit = limit; }
  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.#active < this.#limit) { this.#active++; return () => this.release(); }
    return new Promise((accept, reject) => {
      const row = { signal, accept, reject };
      const abort = () => {
        const index = this.#queue.indexOf(row);
        if (index >= 0) this.#queue.splice(index, 1);
        reject(signal.reason ?? new Error('cancelled'));
      };
      signal.addEventListener('abort', abort, { once: true });
      row.accept = release => { signal.removeEventListener('abort', abort); accept(release); };
      this.#queue.push(row);
    });
  }
  private release(): void {
    for (;;) {
      const next = this.#queue.shift();
      if (!next) { this.#active--; return; }
      if (next.signal.aborted) continue;
      next.accept(() => this.release());
      return;
    }
  }
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('cancelled'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    timer.unref();
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('cancelled')); };
    function done() { signal.removeEventListener('abort', abort); resolve(); }
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function cancelResponseBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* transport cleanup is advisory */ }
}
function policy(value: RetryPolicy | undefined): RetryPolicy {
  const result = value ?? { maxRetries: 0, backoffInitialMs: 100, backoffMaxMs: 1_000 };
  if (!Number.isSafeInteger(result.maxRetries) || result.maxRetries < 0 || result.maxRetries > 5
    || !Number.isFinite(result.backoffInitialMs) || result.backoffInitialMs < 0
    || !Number.isFinite(result.backoffMaxMs) || result.backoffMaxMs < result.backoffInitialMs
    || result.attemptTimeoutMs !== undefined && (!Number.isFinite(result.attemptTimeoutMs) || result.attemptTimeoutMs <= 0))
    throw new ContractError('invalid_retry_policy');
  return result;
}
function required(batch: DecisionBatch): string[] { return Array.isArray(batch.questions) ? batch.questions.map(item => item?.key).filter(Boolean) : []; }
function unavailable(batch: DecisionBatch, code: NonNullable<DecisionResult['failure']>['code'], retryable: boolean, elapsedMs = 0, attempts = 0,
    status?: number | string): DecisionResult {
  const keys = required(batch);
  return { batchId: typeof batch?.id === 'string' ? batch.id : '', status: 'unavailable', answers: {},
    coverage: { required: keys, answered: [], unknown: keys }, issues: [], elapsedMs, attempts,
    failure: { code, retryable, ...(status !== undefined ? { status } : {}) } };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function same(value: unknown, expected: unknown): boolean {
  return JSON.stringify(canonical(value)) === JSON.stringify(canonical(expected));
}
function headers(response: Response, name: string): string | null {
  try { return response.headers?.get(name) ?? null; } catch { return null; }
}
function retryDelay(response: Response, fallback: number, now: number): number {
  const millisecondsValue = headers(response, 'retry-after-ms');
  if (millisecondsValue !== null && millisecondsValue.trim() !== '') {
    const milliseconds = Number(millisecondsValue);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
  }
  const value = headers(response, 'retry-after');
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return fallback;
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function strictEnvelope(raw: unknown): raw is { model: string; answers: Record<string, unknown>; usage: { input_tokens: number; output_tokens: number } } {
  return isPlainRecord(raw) && Object.keys(raw).length === 3 && Object.keys(raw).every(key => ['model', 'answers', 'usage'].includes(key))
    && raw.model === JEV_MODEL && isPlainRecord(raw.answers) && isPlainRecord(raw.usage)
    && Object.keys(raw.usage).length === 2 && Object.keys(raw.usage).every(key => ['input_tokens', 'output_tokens'].includes(key))
    && nonnegativeInteger(raw.usage.input_tokens) && nonnegativeInteger(raw.usage.output_tokens);
}
function vendorAnswer(question: DecisionBatch['questions'][number], value: unknown): boolean {
  if (!isPlainRecord(value) || value.type !== question.type) return false;
  if (question.type === 'choice') return Object.keys(value).length === 4
    && Object.keys(value).every(key => ['type', 'choice', 'confidence', 'probabilities'].includes(key))
    && typeof value.choice === 'string' && typeof value.confidence === 'number' && isPlainRecord(value.probabilities);
  if (question.type === 'noul') return Object.keys(value).length === 2
    && Object.keys(value).every(key => ['type', 'noul'].includes(key)) && typeof value.noul === 'number';
  return Object.keys(value).length === 5
    && Object.keys(value).every(key => ['type', 'score', 'confidence', 'legend', 'probabilities'].includes(key))
    && typeof value.score === 'number' && typeof value.confidence === 'number'
    && isPlainRecord(value.legend) && isPlainRecord(value.probabilities);
}
function normalizedAnswers(batch: DecisionBatch, raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).map(([key, answer]) => {
    const question = batch.questions.find(item => item.key === key);
    if (!question || !isPlainRecord(answer)) return [key, answer];
    return [key, { status: 'answered', ...answer, ...(!vendorAnswer(question, answer) ? { __vendor_invalid: true } : {}) }];
  }));
}
function answerSchemaDiagnostics(batch: DecisionBatch, raw: Record<string, unknown>): AnswerSchemaDiagnostic[] {
  return batch.questions.map(question => {
    const candidate = raw[question.key];
    const answer: Record<string, unknown> | undefined = isPlainRecord(candidate) ? candidate : undefined;
    const fieldNames = answer ? Object.keys(answer).sort() : [];
    const expectedKeys = question.type === 'choice' ? Object.keys(question.criteria)
      : question.type === 'score' ? question.criteria.map((_, index) => String(index)) : ['noul'];
    let actualKeys: string[] = [], values: unknown[] = [];
    if (question.type === 'noul') {
      if (answer && Object.hasOwn(answer, 'noul')) { actualKeys = ['noul']; values = [answer.noul]; }
    } else {
      const probabilities: Record<string, unknown> | undefined = answer && isPlainRecord(answer.probabilities) ? answer.probabilities : undefined;
      if (probabilities) {
        actualKeys = Object.keys(probabilities);
        values = actualKeys.map(key => probabilities[key]);
      }
    }
    const missingProbabilityKeyCount = expectedKeys.filter(key => !actualKeys.includes(key)).length;
    const extraProbabilityKeyCount = actualKeys.filter(key => !expectedKeys.includes(key)).length;
    const numeric = values.every(value => typeof value === 'number' && Number.isFinite(value));
    const probabilitySum = values.length && numeric ? (values as number[]).reduce((sum, value) => sum + value, 0) : null;
    const probabilityRangeValid = values.length === expectedKeys.length && numeric
      && (values as number[]).every(value => value >= 0 && value <= 1);
    const diagnostic: AnswerSchemaDiagnostic = {
      key: question.key,
      type: question.type,
      fieldNames,
      expectedProbabilityCount: expectedKeys.length,
      actualProbabilityCount: actualKeys.length,
      missingProbabilityKeyCount,
      extraProbabilityKeyCount,
      probabilitySum,
      probabilitySumValid: question.type === 'noul' ? null
        : numeric && probabilityMassValid(values as number[]),
      probabilityRangeValid,
    };
    if (question.type === 'choice') diagnostic.selectedChoiceIsIssued = !!answer
      && typeof answer.choice === 'string' && Object.hasOwn(question.criteria, answer.choice);
    if (answer && typeof answer.confidence === 'number' && Number.isFinite(answer.confidence)) diagnostic.confidence = answer.confidence;
    return diagnostic;
  });
}

export function createDecisionAdapter(options: DecisionAdapterOptions = {}): DecisionPort {
  const apiKey = options.apiKey === undefined ? readJevApiKey(options.env) : options.apiKey.trim();
  const enabled = options.enabled !== false;
  const fetcher = options.fetcher ?? fetch;
  const concurrency = options.maxConcurrency ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new ContractError('invalid_decision_concurrency');
  const semaphore = new Semaphore(concurrency);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const trace = (event: AdapterTrace): void => {
    try { options.trace?.(structuredClone(event)); } catch { /* telemetry cannot affect task authority or accounting */ }
  };
  return {
    async decide(batch, lease) {
      const began = now();
      if (!enabled) return unavailable(batch, 'disabled', false);
      if (!apiKey) return unavailable(batch, 'unconfigured', false);
      let packed;
      try {
        const context = lease.context;
        if (!same(batch.scope, context.scope) || !same(batch.readSet, context.readSet)) throw new PackingError('schema_error');
        packed = packDecisionBatch(batch);
      } catch (error) {
        const code = error instanceof PackingError ? error.failure : 'schema_error';
        return unavailable(batch, code, false, now() - began);
      }
      trace({ kind: 'packing', batchId: batch.id, estimate: packed.estimate, cache: 'disabled' });
      const retry = policy(options.retryPolicies?.[batch.family]);
      const maxAttempts = retry.maxRetries + 1;
      const inputBound = packed.estimate.totalUpperBound * maxAttempts;
      const outputPerAttemptBound = packed.estimate.responseUpperBound;
      const outputBound = outputPerAttemptBound * maxAttempts;
      const costBound = inputBound * JEV_INPUT_USD_PER_MILLION / 1_000_000;
      let releaseConcurrency: (() => void) | undefined;
      try {
        releaseConcurrency = await semaphore.acquire(lease.signal);
      } catch {
        return unavailable(batch, now() >= lease.context.budget.deadlineAt ? 'timeout' : 'cancelled', false, now() - began);
      }
      let reservation: Awaited<ReturnType<TaskLease['reserveQueued']>>;
      try {
        reservation = await lease.reserveQueued({ inputTokens: inputBound, outputTokens: outputBound, costUsd: costBound, actions: 1 });
      } catch {
        releaseConcurrency(); releaseConcurrency = undefined;
        const code = now() >= lease.context.budget.deadlineAt ? 'timeout' : lease.signal.aborted ? 'cancelled' : 'budget_exhausted';
        return unavailable(batch, code, false, now() - began);
      }
      let released = false;
      /** SL-84: the most recent attempt's HTTP status, or its network/timeout code when no response ever arrived. */
      let lastStatus: number | string | undefined;
      const settleUnknown = (code: NonNullable<DecisionResult['failure']>['code'], retryable: boolean, attempts: number) => {
        const unknownInput = packed.estimate.totalUpperBound * attempts;
        const unknownCost = unknownInput * JEV_INPUT_USD_PER_MILLION / 1_000_000;
        if (!released) {
          reservation.settle({ inputTokens: unknownInput, outputTokens: outputPerAttemptBound * attempts,
            costUsd: unknownCost, actions: 1 });
          released = true;
        }
        trace({ kind: 'failure', batchId: batch.id, attempts, family: batch.family, code, ...(lastStatus !== undefined ? { status: lastStatus } : {}),
          cost: { kind: 'reserved_bound_actual_unknown', usd: unknownCost } });
        return unavailable(batch, code, retryable, now() - began, attempts, lastStatus);
      };
      let attempted = 0;
      try {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try { lease.assertActive(); }
          catch { return settleUnknown(now() >= lease.context.budget.deadlineAt ? 'timeout' : 'cancelled', false, attempt - 1); }
          const remaining = lease.context.budget.deadlineAt - now();
          const attemptTimeout = Math.max(1, Math.min(remaining, retry.attemptTimeoutMs ?? remaining));
          const attemptSignal = AbortSignal.any([lease.signal, AbortSignal.timeout(attemptTimeout)]);
          const attemptBegan = now();
          let response: Response;
          try {
            attempted = attempt;
            response = await fetcher(JEV_ENDPOINT, { method: 'POST', redirect: 'error', signal: attemptSignal,
              headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(packed.request) });
          } catch (error) {
            if (lease.signal.aborted) return settleUnknown(now() >= lease.context.budget.deadlineAt ? 'timeout' : 'cancelled', false, attempt);
            const timedOut = attemptSignal.aborted;
            const networkError = error instanceof TypeError;
            // SL-84: a completed round trip never happened; the attempt row names the failure by code, not status.
            const attemptCode: 'timeout' | 'network_error' = timedOut ? 'timeout' : 'network_error';
            lastStatus = attemptCode;
            trace({ kind: 'attempt', batchId: batch.id, attempt, family: batch.family, code: attemptCode, ms: now() - attemptBegan });
            const allowed = timedOut ? retry.retryTimeout === true : networkError && retry.retryNetwork === true;
            if (!allowed || attempt >= maxAttempts) return settleUnknown(timedOut ? 'timeout' : 'service_error', allowed, attempt);
            const delay = Math.min(retry.backoffMaxMs, retry.backoffInitialMs * 2 ** (attempt - 1));
            if (delay >= lease.context.budget.deadlineAt - now()) return settleUnknown(timedOut ? 'timeout' : 'service_error', true, attempt);
            trace({ kind: 'retry', batchId: batch.id, attempt, delayMs: delay, reason: timedOut ? 'timeout' : 'network' });
            try { await sleep(delay, lease.signal); } catch { return settleUnknown('cancelled', false, attempt); }
            continue;
          }
          lastStatus = response.status;
          // SL-84: a 429's raw `retry-after` header, verbatim, only for the telemetry row -- `retryDelay` below computes
          // the actual wait separately and also honors `retry-after-ms`.
          const retryAfterHeader = response.status === 429 ? headers(response, 'retry-after') : null;
          trace({ kind: 'attempt', batchId: batch.id, attempt, family: batch.family, status: response.status, ms: now() - attemptBegan,
            ...(retryAfterHeader ? { retryAfter: retryAfterHeader } : {}) });
          if (response.status === 429 || response.status === 529) {
            await cancelResponseBody(response);
            if (attempt >= maxAttempts) return settleUnknown('rate_limited', true, attempt);
            const fallback = Math.min(retry.backoffMaxMs, retry.backoffInitialMs * 2 ** (attempt - 1));
            const delay = retryDelay(response, fallback, now());
            if (delay >= lease.context.budget.deadlineAt - now()) return settleUnknown('rate_limited', true, attempt);
            trace({ kind: 'retry', batchId: batch.id, attempt, delayMs: delay, reason: String(response.status) });
            try { await sleep(delay, lease.signal); } catch { return settleUnknown('cancelled', false, attempt); }
            continue;
          }
          if (!response.ok) {
            await cancelResponseBody(response);
            return settleUnknown(response.status === 422 ? 'schema_error' : 'service_error', false, attempt);
          }
          let raw: unknown;
          try { raw = await response.json(); } catch { return settleUnknown('schema_error', false, attempt); }
          try { attemptSignal.throwIfAborted(); lease.assertActive(); }
          catch { return settleUnknown(now() >= lease.context.budget.deadlineAt ? 'timeout' : 'cancelled', false, attempt); }
          if (!strictEnvelope(raw)) return settleUnknown('schema_error', false, attempt);
          const costUsd = raw.usage.input_tokens * JEV_INPUT_USD_PER_MILLION / 1_000_000;
          const priorUnknownInput = packed.estimate.totalUpperBound * (attempt - 1);
          const priorUnknownOutput = outputPerAttemptBound * (attempt - 1);
          const priorUnknownCost = priorUnknownInput * JEV_INPUT_USD_PER_MILLION / 1_000_000;
          try {
            reservation.settle({ inputTokens: raw.usage.input_tokens + priorUnknownInput,
              outputTokens: raw.usage.output_tokens + priorUnknownOutput, costUsd: costUsd + priorUnknownCost, actions: 1 });
            released = true;
          } catch {
            released = true;
            return unavailable(batch, 'budget_exhausted', false, now() - began, attempt);
          }
          trace({ kind: 'usage', batchId: batch.id, attempts: attempt, inputTokens: raw.usage.input_tokens,
            outputTokens: raw.usage.output_tokens, cost: { kind: 'listed_price_estimate', usd: costUsd,
              inputUsdPerMillion: JEV_INPUT_USD_PER_MILLION, unknownRetryBoundUsd: priorUnknownCost } });
          const result = bindDecisionAnswers(batch, normalizedAnswers(batch, raw.answers),
            { inputTokens: raw.usage.input_tokens, outputTokens: raw.usage.output_tokens, costUsd });
          if (result.status === 'incomplete') trace({ kind: 'answer_schema', batchId: batch.id, status: 'incomplete',
            diagnostics: answerSchemaDiagnostics(batch, raw.answers) });
          return { ...result, elapsedMs: now() - began, attempts: attempt,
            ...(result.status === 'complete' ? {} : { failure: { code: 'schema_error' as const, retryable: false } }) };
        }
        return settleUnknown('service_error', false, maxAttempts);
      } catch {
        return settleUnknown('service_error', false, attempted);
      } finally {
        releaseConcurrency?.();
        if (!released) { try { reservation.release(); } catch { /* the result already owns its accounting failure */ } }
      }
    },
  };
}
