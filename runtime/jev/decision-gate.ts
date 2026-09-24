/**
 * The gates a Jev choice answer passes before the policy acts on it (contract §135.2; unchanged by §135.30): the
 * reported confidence meets the gate, or the answer's probability leads the runner-up by a clear margin. Shared by the
 * route question, the closed binds and the compile, so the three cannot drift apart. Pure.
 */
import type {DecisionResult} from './contracts.ts';

/** Margin gate parameters; every run records the raw distribution so they can be re-read. */
export const MARGIN_MIN = 0.35, MARGIN_RATIO = 1.8;

/** The chosen option's probability and the runner-up's, when the answer's distribution puts the choice first. */
export function leadOf(result: DecisionResult | undefined, key: string, choice: string): {top: number; second: number} | undefined {
  const value = result?.answers?.[key];
  const probabilities = value?.status === 'answered' && value.type === 'choice' ? value.probabilities : undefined;
  if (!probabilities) return undefined;
  const sorted = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  if (sorted[0]?.[0] !== choice) return undefined;
  return {top: sorted[0][1], second: sorted[1]?.[1] ?? 0};
}

/** A choice question's answer, when it has one. */
export function answerOf(result: DecisionResult | undefined, key: string): {choice?: string; confidence?: number; probabilities?: Record<string, number>} {
  const value = result?.answers?.[key];
  return value?.status === 'answered' && value.type === 'choice' ? {choice: value.choice, confidence: value.confidence, probabilities: value.probabilities} : {};
}

/** An answer clears when its reported confidence meets the gate or its probability leads by a clear margin. */
export function clears(result: DecisionResult | undefined, key: string, choice: string, confidence: number | undefined, gate: number): boolean {
  if (confidence === undefined || confidence >= gate) return true;
  const lead = leadOf(result, key, choice);
  return lead !== undefined && lead.top >= MARGIN_MIN && lead.top >= MARGIN_RATIO * lead.second;
}
