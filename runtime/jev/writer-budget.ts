/** Bound the next tool observation and reserve room for its ordinary Keeper response. */
import {providerSpend, type ProviderModel} from './provider-budget.ts';
import type {TaskLease} from './task-context.ts';

export const PLAN_RESULT_BYTES = 32 * 1024;
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

export function boundedPlanPresentation<T extends {status: string; remainingNeeds: string[]; coverage: {used: string[]; omitted: string[]; unknown: string[]}; observations: unknown[]}>(value: T): T {
  if (size(value) <= PLAN_RESULT_BYTES) return value;
  const result = structuredClone(value);
  result.observations = [];
  result.coverage = {used: [], omitted: ['Detailed task evidence remains in the owning task record; the writer packet is bounded.'], unknown: [...value.coverage.unknown]};
  if (size(result) > PLAN_RESULT_BYTES / 2) {
    result.remainingNeeds = ['The detailed outcome exceeds the writer packet. State the evidence limitation and do not claim an unsupported outcome.'];
    result.coverage.unknown = ['Detailed outcome omitted by the writer packet bound.'];
  }
  if (result.status === 'complete') result.status = 'partial';
  for (const row of value.observations) {
    result.observations.push(row);
    if (size(result) > PLAN_RESULT_BYTES) { result.observations.pop(); }
  }
  return result;
}

export function reserveWriterBudget(lease: TaskLease, model: ProviderModel, previousPayloadBytes: number, assistantBytes: number) {
  const spend = providerSpend({model, inputTokens: previousPayloadBytes + assistantBytes + PLAN_RESULT_BYTES + 16 * 1024,
    outputTokens: Math.min(model.maxTokens, 8192)});
  // Dependent calls must not queue waiting for a writer that can only run after they finish.
  return {spend, reservation: lease.reserve(spend, {waitable: false})};
}
