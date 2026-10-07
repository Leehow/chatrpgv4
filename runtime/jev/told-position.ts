/**
 * Contract §190.2: where a delivered text leaves the investigators.
 *
 * After a delivery that landed no move, the host asks Jev, in one fanned-out request, three things about the text the
 * player just read: whether it ends with the investigators somewhere other than where the ledger stood them (a Noul
 * `moved`), which of the places the kernel enumerated (`table.owe.options`: the scene's exits, the trail, the place it
 * lies in, the table's places, the reading window's places) that is, or `none` (a Choice `place`), and which delivered
 * sentence tells it (a Choice `sentence` over the text split at Unicode sentence terminators, numbered by the host).
 *
 * The text is split structurally -- line breaks, then runs of `Sentence_Terminal` characters -- and no character is
 * listed and no language is named. Nothing here reads the prose for meaning: Jev answers, the bars are data, and the
 * kernel checks what is owed (`table.owe`).
 *
 * Pure: the extension owns the kernel reads, the lease, the deadline, the `table.owe` call and the telemetry row.
 */
import type { DecisionAnswer, DecisionBatch, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding } from './contracts.ts';
import type { DecisionPort } from './decision-port.ts';
import type { TaskLease } from './task-context.ts';
import type { ToldPositionBudget } from './host-budgets.ts';
import { JEV_MODEL, packDecisionBatch, PackingError } from './question-packing.ts';
import { clip, digest16 as digest } from './text.ts';

export const TOLD_POSITION_FAMILY = 'told-position';
export const TOLD_POSITION_VERSION = '1';
/** At most this many delivered sentences are offered to the `sentence` Choice (§190.2): the last ones, where the party ends up. */
export const TOLD_SENTENCES_MAX = 24;

/** Line breaks: a paragraph is a structural boundary before any sentence is looked for. */
const LINE = /\r\n|\r|\n|\p{Zl}|\p{Zp}/u;
/**
 * The end of a sentence: a run of Unicode `Sentence_Terminal` characters, the closing punctuation that follows it
 * (`Pe`, `Pf`, and a `Quotation_Mark` followed by white space or the end), and not a run followed at once by a decimal
 * digit or, after white space, by a lowercase letter (UAX #29 SB6 and SB8: a decimal point, an abbreviation).
 */
const END = /\p{Sentence_Terminal}+(?:[\p{Pe}\p{Pf}]|\p{Quotation_Mark}(?=\s|$))*(?!\p{Nd}|\s*\p{Ll})/gu;
/** A piece with no letter or digit (a rule of asterisks, an ellipsis alone) is not a sentence. */
const WORDED = /[\p{L}\p{N}]/u;

/**
 * The delivered text's sentences, each exactly as delivered (trimmed), and how many there were. Only the last
 * `max` are kept: where the investigators end up is told last.
 */
export function toldSentences(text: string, max = TOLD_SENTENCES_MAX): { sentences: string[]; total: number } {
  const all: string[] = [];
  const keep = (piece: string) => { const trimmed = piece.trim(); if (trimmed && WORDED.test(trimmed)) all.push(trimmed); };
  for (const line of text.split(LINE)) {
    let start = 0;
    for (const match of line.matchAll(END)) {
      const end = (match.index ?? 0) + match[0].length;
      keep(line.slice(start, end));
      start = end;
    }
    keep(line.slice(start));
  }
  return { sentences: all.slice(-max), total: all.length };
}

/** One place as `table.owe.options` lists it. */
export interface ToldCandidate { name: string; display_name?: string; aliases?: string[]; summary: string; source: string }
export interface ToldInput {
  campaign: string;
  turn: number;
  /** The scene the ledger held at delivery. */
  scene: { name: string; display_name?: string; summary: string };
  candidates: ToldCandidate[];
  /** The delivered sentences offered, in order (`toldSentences`). */
  sentences: string[];
}
export interface ToldUsage { inputTokens: number; outputTokens: number; costUsd: number }
export interface ToldAnswered {
  status: 'answered';
  /** The `moved` Noul, or null when it went unanswered. */
  moved: number | null;
  /** The place the Choice put first, or null for `none`. */
  chosen: string | null;
  /** The `place` Choice's confidence. */
  confidence: number;
  /** The `place` Choice's distribution over candidate handles and `none`. */
  distribution: Record<string, number>;
  /** The sentence the `sentence` Choice put first, or null when it went unanswered. */
  sentence: { key: string; text: string; confidence: number; distribution: Record<string, number> } | null;
  elapsedMs: number;
  usage: ToldUsage;
}
export interface ToldFailed { status: 'failed'; reason: string; elapsedMs: number; usage: ToldUsage }
export type ToldResult = ToldAnswered | ToldFailed;

/** The candidates' aliases on the wire (`c0`, `c1`, ...): handles are file names, and a key is not a name. */
const alias = (index: number): string => `c${index}`;
const sentenceKey = (index: number): string => `s${index + 1}`;
const placeName = (input: ToldInput): string => input.scene.display_name ?? input.scene.name;

export function toldBindings(input: ToldInput): { scope: ScopeBinding; readSet: ReadSet } {
  const scope: ScopeBinding = { owner: TOLD_POSITION_FAMILY, campaign: input.campaign, audience: 'keeper' };
  return { scope, readSet: [
    { kind: 'draft', resource: `turn:${input.turn}:told-position`, revision: digest(input) },
    { kind: 'family', resource: TOLD_POSITION_FAMILY, revision: TOLD_POSITION_VERSION },
    { kind: 'model', resource: `${TOLD_POSITION_FAMILY}:jev`, revision: JEV_MODEL },
  ] };
}

/** What every question reads: where the party stood, the places by alias, and the delivered sentences in order. */
export function toldState(input: ToldInput): Json {
  return {
    party_was_at: { name: placeName(input), summary: clip(input.scene.summary, 300) },
    places: Object.fromEntries(input.candidates.map((candidate, index) => [alias(index), {
      name: candidate.display_name ?? candidate.name, ...(candidate.aliases?.length ? { also_called: candidate.aliases } : {}),
      summary: clip(candidate.summary, 160) }])),
    told: Object.fromEntries(input.sentences.map((sentence, index) => [sentenceKey(index), clip(sentence, 600)])),
  };
}

/** The `moved` Noul, the `place` Choice and the `sentence` Choice, in one batch. */
export function toldQuestions(input: ToldInput): DecisionQuestion[] {
  const here = placeName(input);
  const places: Record<string, string> = Object.fromEntries(input.candidates.map((candidate, index) =>
    [alias(index), `${candidate.display_name ?? candidate.name}: the place \`places.${alias(index)}\``]));
  places.none = `None of these places: at the end the investigators are still at ${here}, or somewhere that is none of these places.`;
  const sentences: Record<string, string> = Object.fromEntries(input.sentences.map((sentence, index) =>
    [sentenceKey(index), `\`told.${sentenceKey(index)}\`: ${clip(sentence, 160)}`]));
  const reads = '`told` is what the Keeper has just told the player, sentence by sentence in order; `party_was_at` is where the investigators stood when it began.';
  return [
    { key: 'moved', target: `whether the delivered text ends with the investigators somewhere other than ${here}`, type: 'noul',
      instructions: `${reads} At the end of \`told\`, are the investigators somewhere other than ${here} -- the text has them go to, arrive at or be in another place -- rather than still there? A place they only plan to go to, remember, look at, talk about or imagine does not count, and neither does a place someone else goes to without them.` },
    { key: 'place', target: 'the place the delivered text leaves the investigators at', type: 'choice',
      instructions: `${reads} \`places\` are other places the story knows. At the end of \`told\`, which of these places are the investigators at? Judge by what the text says happens to them, not by a word a name shares. Choose none when they are still at ${here} or end somewhere that is none of these places.`,
      criteria: places },
    { key: 'sentence', target: 'the delivered sentence that tells where the investigators end up', type: 'choice',
      instructions: `${reads} Which one sentence of \`told\` tells where the investigators are at the end -- that they arrive at, reach or are in the place where the text leaves them? When no sentence says it outright, choose the one that shows it most directly.`,
      criteria: sentences },
  ];
}

function noul(answer: DecisionAnswer | undefined): number | null {
  return answer?.status === 'answered' && answer.type === 'noul' && Number.isFinite(answer.noul) ? answer.noul : null;
}
/** A Choice's leading key among `keys` (its own pick when the distribution ties) and its distribution, or null. */
function leading(answer: DecisionAnswer | undefined, keys: string[]): { top: string; probabilities: Record<string, number>; confidence: number } | null {
  if (!answer || answer.status !== 'answered' || answer.type !== 'choice') return null;
  const probabilities = answer.probabilities ?? { [answer.choice]: 1 };
  let top = keys.includes(answer.choice) ? answer.choice : keys[keys.length - 1]!;
  for (const key of keys) if ((probabilities[key] ?? 0) > (probabilities[top] ?? 0)) top = key;
  return { top, probabilities, confidence: typeof answer.confidence === 'number' && Number.isFinite(answer.confidence) ? answer.confidence : 0 };
}

/** Ask the three questions for one delivery. Never throws: every non-answer is a `failed` result with its reason. */
export async function runToldPosition(input: ToldInput, decision: DecisionPort, lease: TaskLease): Promise<ToldResult> {
  const began = Date.now(), usage: ToldUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const failed = (reason: string): ToldFailed => ({ status: 'failed', reason, elapsedMs: Date.now() - began, usage });
  if (!input.candidates.length) return failed('no_candidates');
  if (!input.sentences.length) return failed('no_text');
  const bindings = toldBindings(input), state = toldState(input);
  const batch: DecisionBatch = { id: `told-position:${input.turn}:${digest(state)}`, model: JEV_MODEL, family: TOLD_POSITION_FAMILY,
    familyVersion: TOLD_POSITION_VERSION, scope: bindings.scope, readSet: bindings.readSet, state, questions: toldQuestions(input) };
  try {
    packDecisionBatch(batch);
    const result: DecisionResult = await decision.decide(batch, lease);
    usage.inputTokens += result.usage?.inputTokens ?? 0;
    usage.outputTokens += result.usage?.outputTokens ?? 0;
    usage.costUsd += result.usage?.costUsd ?? 0;
    const placeKeys = [...input.candidates.map((_, index) => alias(index)), 'none'];
    const place = leading(result.answers.place, placeKeys);
    if (!place) return failed(result.failure?.code ?? 'no_answer');
    const handle = (key: string): string => key === 'none' ? 'none' : input.candidates[Number(key.slice(1))]!.name;
    const sentenceKeys = input.sentences.map((_, index) => sentenceKey(index));
    const told = leading(result.answers.sentence, sentenceKeys);
    return { status: 'answered', moved: noul(result.answers.moved), chosen: place.top === 'none' ? null : handle(place.top), confidence: place.confidence,
      distribution: Object.fromEntries(placeKeys.map(key => [handle(key), place.probabilities[key] ?? 0])),
      sentence: told ? { key: told.top, text: input.sentences[Number(told.top.slice(1)) - 1]!, confidence: told.confidence,
        distribution: Object.fromEntries(sentenceKeys.map(key => [key, told.probabilities[key] ?? 0])) } : null,
      elapsedMs: Date.now() - began, usage };
  } catch (error) {
    return failed(error instanceof PackingError ? error.failure : 'told_position_owner_error');
  }
}

export type ToldDecision = { decision: 'owe'; handle: string; quote: string } | { decision: 'stay'; why: string };

/**
 * What the bars give (§190.2): owe when `moved` clears `movedMin`, the chosen place is not `none` and not the scene the
 * party stood in, the place's confidence clears `placeMin`, and the sentence's confidence clears `sentenceMin`; otherwise
 * stay, with the first bar that was not cleared.
 */
export function toldDecision(result: ToldResult, budget: Pick<ToldPositionBudget, 'movedMin' | 'placeMin' | 'sentenceMin'>, activeScene: string): ToldDecision {
  if (result.status !== 'answered') return { decision: 'stay', why: result.reason };
  if (result.moved === null) return { decision: 'stay', why: 'moved_unanswered' };
  if (result.moved < budget.movedMin) return { decision: 'stay', why: 'not_moved' };
  if (result.chosen === null) return { decision: 'stay', why: 'none' };
  if (result.chosen === activeScene) return { decision: 'stay', why: 'same_scene' };
  if (result.confidence < budget.placeMin) return { decision: 'stay', why: 'low_place' };
  if (!result.sentence) return { decision: 'stay', why: 'sentence_unanswered' };
  if (result.sentence.confidence < budget.sentenceMin) return { decision: 'stay', why: 'low_sentence' };
  return { decision: 'owe', handle: result.chosen, quote: result.sentence.text };
}
