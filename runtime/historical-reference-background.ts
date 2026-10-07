/** Optional scoped preparation. Foreground callers never await the research result. */
import {createHash} from 'node:crypto';
import type {HistoryInput, HistoryResult} from './historical-reference.ts';
import {isPlainRecord} from './jev/value-contracts.ts';

export const HISTORY_BACKGROUND_LIMITS = Object.freeze({deadlineMs: 20000, concurrency: 2, retained: 64});
export interface HistoryPreparation {state: 'pending' | 'ready' | 'empty' | 'unavailable'; purpose: string}
type Job = {state: HistoryPreparation['state']; controller: AbortController; done: Promise<void>};

export class HistoricalReferenceBackground {
  readonly #jobs = new Map<string, Job>();
  readonly #record: (row: Record<string, unknown>) => void;
  #closed = false;
  constructor(record: (row: Record<string, unknown>) => void) {
    this.#record = row => {try {record(row);} catch { /* Telemetry never owns preparation. */ }};
  }
  key(input: HistoryInput): string {
    const context = isPlainRecord(input.context) ? input.context : undefined;
    const where = context && isPlainRecord(context.where) ? context.where : undefined;
    // The scene's trail, affordances and handouts change each turn; they cannot hide an existing preparation.
    const basis = context ? {period: context.period ?? null, region: context.region ?? null, scenario: context.scenario ?? null,
      scene: where?.scene ?? context.scene ?? null} : input.context;
    return createHash('sha256').update(JSON.stringify([input.scope.campaign ?? input.scope.owner,
      input.scope.worldline, input.scope.loop, input.query, input.objective ?? '', basis, input.reference_queries ?? null])).digest('hex');
  }
  status(input: HistoryInput): HistoryPreparation | undefined {
    const job = this.#jobs.get(this.key(input));
    return job ? {state: job.state, purpose: input.query} : undefined;
  }
  start(input: HistoryInput, work: (signal: AbortSignal) => Promise<HistoryResult>): HistoryPreparation {
    const prior = this.status(input);
    if (prior) return prior;
    if (this.#closed || [...this.#jobs.values()].filter(job => job.state === 'pending').length >= HISTORY_BACKGROUND_LIMITS.concurrency)
      return {state: 'unavailable', purpose: input.query};
    const controller = new AbortController(), began = performance.now();
    const job: Job = {state: 'pending', controller, done: Promise.resolve()};
    this.#jobs.set(this.key(input), job);
    const timer = setTimeout(() => controller.abort(), HISTORY_BACKGROUND_LIMITS.deadlineMs);
    timer.unref?.();
    const row = {lane: 'historical-reference', event: 'background', campaign: input.scope.campaign ?? null,
      worldline: input.scope.worldline ?? null, loop: input.scope.loop ?? null, turn: input.turn, query: input.query};
    this.#record({...row, phase: 'started'});
    job.done = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      const result = await work(controller.signal);
      job.state = result.status;
      this.#record({...row, phase: 'returned', status: result.status, reason: result.reason,
        materials: result.materials.length, ms: performance.now() - began});
    }).catch(() => {
      job.state = 'unavailable';
      this.#record({...row, phase: 'returned', status: 'unavailable', reason: controller.signal.aborted ? 'cancelled' : 'provider_unavailable', ms: performance.now() - began});
    }).finally(() => {
      clearTimeout(timer);
      if (job.state === 'pending') job.state = 'unavailable';
      while (this.#jobs.size > HISTORY_BACKGROUND_LIMITS.retained) {
        const terminal = [...this.#jobs].find(([, value]) => value.state !== 'pending');
        if (!terminal) break;
        this.#jobs.delete(terminal[0]);
      }
    });
    return {state: 'pending', purpose: input.query};
  }
  async dispose(): Promise<void> {
    this.#closed = true;
    for (const job of this.#jobs.values()) if (job.state === 'pending') job.controller.abort();
    await Promise.allSettled([...this.#jobs.values()].map(job => job.done));
  }
}
