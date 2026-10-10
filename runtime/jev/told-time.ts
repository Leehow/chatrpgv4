/**
 * Contract §216.1: how much in-world time a delivered text told the investigators spending.
 *
 * After a delivery whose turn charged no time, the host asks Jev, in one request, two things about the text the player just
 * read: which row of the rules' time-cost table (the road rows left out: a journey is its move's) the activity the text
 * tells is, or `none` (a Choice `told_cost`, each criterion the row's own name, range and `covers`, as §138.8's question
 * writes it), and which delivered sentence tells the longest part of it (a Choice `sentence` over the text split by
 * §190.2's splitter). The state is the delivered sentences and nothing else: not the clock, not the receipts, not the
 * player's words (Jev does not compare times, §145.2).
 *
 * Nothing here reads the prose for meaning: Jev answers, the bars are data, and the kernel checks what is owed
 * (`table.owe`), and rolls the band when the clerk lands it.
 *
 * Pure: the extension owns the kernel read, the lease, the deadline, the `table.owe` call and the telemetry row.
 */
import type { DecisionAnswer, DecisionBatch, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding } from './contracts.ts';
import type { DecisionPort } from './decision-port.ts';
import type { TaskLease } from './task-context.ts';
import type { ToldTimeBudget } from './host-budgets.ts';
import { JEV_MODEL, packDecisionBatch, PackingError } from './question-packing.ts';
import { clip, digest16 as digest } from './text.ts';
import { toldSentences } from './told-position.ts';
import { ROUTE_TIME_BANDS, timeCriterion, type TimeBandRow } from './band-shadow-domain.ts';

export const TOLD_TIME_FAMILY = 'told-time';
export const TOLD_TIME_VERSION = '1';
/** How many delivered sentences the read offers: time may be told anywhere in the text, as a clue may (§201.1). */
export const TOLD_TIME_SENTENCES_MAX = 48;
/** The delivered sentences this read offers (`toldSentences` with this read's own bound). */
export const toldTimeSentences = (text: string): { sentences: string[]; total: number } => toldSentences(text, TOLD_TIME_SENTENCES_MAX);

export interface ToldTimeInput {
  campaign: string;
  turn: number;
  /** The time-cost rows an act can take (`table.owe.options`' `time_bands`); road rows are dropped here as well. */
  bands: TimeBandRow[];
  /** The delivered sentences offered, in order. */
  sentences: string[];
}
export interface ToldTimeUsage { inputTokens: number; outputTokens: number; costUsd: number }
export interface ToldTimeAnswered {
  status: 'answered';
  /** The leading row, or null when it is `none`. */
  chosen: string | null;
  confidence: number;
  distribution: Record<string, number>;
  sentence: { key: string; text: string; confidence: number; distribution: Record<string, number> } | null;
  elapsedMs: number;
  usage: ToldTimeUsage;
}
export interface ToldTimeFailed { status: 'failed'; reason: string; elapsedMs: number; usage: ToldTimeUsage }
export type ToldTimeResult = ToldTimeAnswered | ToldTimeFailed;

const sentenceKey = (index: number): string => `s${index + 1}`;
/** The rows the question offers: an act's rows, never a road's (§138.9). */
export const actRows = (bands: readonly TimeBandRow[]): TimeBandRow[] => bands.filter(row => !ROUTE_TIME_BANDS.includes(row.handle));

export function toldTimeBindings(input: ToldTimeInput): { scope: ScopeBinding; readSet: ReadSet } {
  const scope: ScopeBinding = { owner: TOLD_TIME_FAMILY, campaign: input.campaign, audience: 'keeper' };
  return { scope, readSet: [
    { kind: 'draft', resource: `turn:${input.turn}:told-time`, revision: digest(input) },
    { kind: 'family', resource: TOLD_TIME_FAMILY, revision: TOLD_TIME_VERSION },
    { kind: 'model', resource: `${TOLD_TIME_FAMILY}:jev`, revision: JEV_MODEL },
  ] };
}

/** What both questions read: the delivered sentences in order, and nothing else. */
export function toldTimeState(input: ToldTimeInput): Json {
  return { told: Object.fromEntries(input.sentences.map((sentence, index) => [sentenceKey(index), clip(sentence, 600)])) };
}

const READS = '`told` is what the Keeper has just told the player, sentence by sentence in order.';

/** The `told_cost` Choice (`none` first, then the act rows) and the `sentence` Choice, in one batch. */
export function toldTimeQuestions(input: ToldTimeInput): DecisionQuestion[] {
  const costs: Record<string, string> = {
    none: 'No in-world activity beyond a moment is told happening now, or none of the acts below fits what is told.',
    ...Object.fromEntries(actRows(input.bands).map(row => [row.handle, timeCriterion(row)])),
  };
  const sentences: Record<string, string> = Object.fromEntries(input.sentences.map((sentence, index) =>
    [sentenceKey(index), `\`told.${sentenceKey(index)}\`: ${clip(sentence, 160)}`]));
  return [
    { key: 'told_cost', target: 'the in-world activity the delivered text tells the investigators carrying out, as a cost in time', type: 'choice',
      instructions: `${READS} Which option is the activity the investigators carry out in what \`told\` tells happening now, judged by its kind and its `
        + 'extent: how much ground it covers, how many things it goes through, how long it goes on? Each option is an act of a given extent with the '
        + 'time it takes at the table. Count only what the text tells them doing now. A journey between places does not count (the move carries its '
        + 'time); neither do memories, plans, what someone says about another time, nor description of a place they only look at. An option of the '
        + 'same kind but a larger or a smaller extent does not fit. Choose none when the text tells no activity beyond a moment, or none that fits.',
      criteria: costs },
    { key: 'sentence', target: 'the delivered sentence that tells the longest part of that activity', type: 'choice',
      instructions: `${READS} Which one sentence of \`told\` tells the investigators carrying out the longest part of the activity the text tells them `
        + 'doing now? When no single sentence tells all of it, choose the one that tells the most of it.',
      criteria: sentences },
  ];
}

/** A Choice's leading key among `keys` (its own pick when the distribution ties) and its distribution, or null. */
function leading(answer: DecisionAnswer | undefined, keys: string[]): { top: string; probabilities: Record<string, number>; confidence: number } | null {
  if (!answer || answer.status !== 'answered' || answer.type !== 'choice' || !keys.length) return null;
  const probabilities = answer.probabilities ?? { [answer.choice]: 1 };
  let top = keys.includes(answer.choice) ? answer.choice : keys[0]!;
  for (const key of keys) if ((probabilities[key] ?? 0) > (probabilities[top] ?? 0)) top = key;
  return { top, probabilities, confidence: typeof answer.confidence === 'number' && Number.isFinite(answer.confidence) ? answer.confidence : 0 };
}

/** Ask the two questions for one delivery. Never throws: every non-answer is a `failed` result with its reason. */
export async function runToldTime(input: ToldTimeInput, decision: DecisionPort, lease: TaskLease): Promise<ToldTimeResult> {
  const began = Date.now(), usage: ToldTimeUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const failed = (reason: string): ToldTimeFailed => ({ status: 'failed', reason, elapsedMs: Date.now() - began, usage });
  if (!actRows(input.bands).length) return failed('no_bands');
  if (!input.sentences.length) return failed('no_text');
  const bindings = toldTimeBindings(input), state = toldTimeState(input), questions = toldTimeQuestions(input);
  const batch: DecisionBatch = { id: `told-time:${input.turn}:${digest(state)}`, model: JEV_MODEL, family: TOLD_TIME_FAMILY,
    familyVersion: TOLD_TIME_VERSION, scope: bindings.scope, readSet: bindings.readSet, state, questions };
  try {
    packDecisionBatch(batch);
    const result: DecisionResult = await decision.decide(batch, lease);
    usage.inputTokens += result.usage?.inputTokens ?? 0;
    usage.outputTokens += result.usage?.outputTokens ?? 0;
    usage.costUsd += result.usage?.costUsd ?? 0;
    const costKeys = Object.keys(questions[0]!.criteria as Record<string, string>);
    const cost = leading(result.answers.told_cost, costKeys);
    if (!cost) return failed(result.failure?.code ?? 'cost_unanswered');
    const sentenceKeys = input.sentences.map((_, index) => sentenceKey(index));
    const told = leading(result.answers.sentence, sentenceKeys);
    return { status: 'answered', chosen: cost.top === 'none' ? null : cost.top, confidence: cost.confidence,
      distribution: Object.fromEntries(costKeys.map(key => [key, cost.probabilities[key] ?? 0])),
      sentence: told ? { key: told.top, text: input.sentences[Number(told.top.slice(1)) - 1]!, confidence: told.confidence,
        distribution: Object.fromEntries(sentenceKeys.map(key => [key, told.probabilities[key] ?? 0])) } : null,
      elapsedMs: Date.now() - began, usage };
  } catch (error) {
    return failed(error instanceof PackingError ? error.failure : 'told_time_owner_error');
  }
}

export type ToldTimeDecision = { decision: 'owe'; band: string; quote: string } | { decision: 'stay'; why: string };

/**
 * What the bars give (§216.1): owe when the leading row is not `none`, its confidence clears `costMin`, the row's `default`
 * minutes reach `minDefaultMinutes`, and the sentence's confidence clears `sentenceMin`; otherwise stay with the first bar
 * missed. A row with no `default` is judged by its `min`.
 */
export function toldTimeDecision(result: ToldTimeResult, budget: Pick<ToldTimeBudget, 'costMin' | 'sentenceMin' | 'minDefaultMinutes'>,
  bands: readonly TimeBandRow[]): ToldTimeDecision {
  if (result.status !== 'answered') return { decision: 'stay', why: result.reason };
  if (result.chosen === null) return { decision: 'stay', why: 'none' };
  if (result.confidence < budget.costMin) return { decision: 'stay', why: 'low_cost' };
  const row = bands.find(entry => entry.handle === result.chosen);
  if (!row || (row.default ?? row.min) < budget.minDefaultMinutes) return { decision: 'stay', why: 'under_floor' };
  if (!result.sentence) return { decision: 'stay', why: 'sentence_unanswered' };
  if (result.sentence.confidence < budget.sentenceMin) return { decision: 'stay', why: 'low_sentence' };
  return { decision: 'owe', band: row.handle, quote: result.sentence.text };
}
