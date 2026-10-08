/**
 * Contract §201.1: which of the book's clues a delivered text gave the investigators.
 *
 * After a delivery the host asks Jev, about the text the player just read, one Noul per clue in play (`table.owe.options`'s
 * `clues`: the delivered scene's, then the scenes the party left that turn, then the trail's): does the text give the
 * investigators what this clue states. A clue whose `given` clears the bar is asked once more, in a second request, which
 * delivered sentence gives it (a Choice over the text split at Unicode sentence terminators, `toldSentences`). The same
 * Noul is asked of each clue the delivered turn landed, so the read can count a landed clue the text did not give
 * (`landed_untold`, §201.4); that count is never acted on.
 *
 * Nothing here reads the prose for meaning: Jev answers, the bars are data, and the kernel checks what is owed
 * (`table.owe`). Clues reach Jev by alias (`c0`, `l0`), never by handle.
 *
 * Pure: the extension owns the kernel reads, the lease, the deadline, the `table.owe` calls and the telemetry row.
 */
import type { DecisionAnswer, DecisionBatch, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding } from './contracts.ts';
import type { DecisionPort } from './decision-port.ts';
import type { TaskLease } from './task-context.ts';
import type { ToldClueBudget } from './host-budgets.ts';
import { JEV_MODEL, packDecisionBatch, PackingError } from './question-packing.ts';
import { clip, digest16 as digest } from './text.ts';
import { toldSentences } from './told-position.ts';

export const TOLD_CLUE_FAMILY = 'told-clue';
export const TOLD_CLUE_VERSION = '1';
/**
 * How many delivered sentences the read offers: twice the told position's 24. A position is told last, so §190.2 keeps the
 * last sentences; a clue may be given anywhere in the text, so this read keeps more of it (the last ones when it is longer).
 */
export const TOLD_CLUE_SENTENCES_MAX = 48;
/** The delivered sentences this read offers (`toldSentences` with this read's own bound). */
export const toldClueSentences = (text: string): { sentences: string[]; total: number } => toldSentences(text, TOLD_CLUE_SENTENCES_MAX);

/** One clue as `table.owe.options` lists it. */
export interface ToldClueCandidate {
  name: string;
  summary: string;
  scene: string;
  source: string;
  delivery_kind: string;
  /** §201.2: the book's check for finding it, when the book names its skill (the kernel's `clueCheck`). */
  check?: { skill: string; difficulty?: string };
}
/** One clue the delivered turn landed, as `table.owe.options` lists it (`clue_receipts`). */
export interface ToldClueLanded { clue: string; summary: string; owed?: string }
export interface ToldClueInput {
  campaign: string;
  turn: number;
  /** The clues in play that the ledger lacks. */
  candidates: ToldClueCandidate[];
  /** The clues the delivered turn landed (an owed landing excluded: an earlier delivery told it). */
  landed: ToldClueLanded[];
  /** The delivered sentences offered, in order (`toldSentences`). */
  sentences: string[];
}
export interface ToldClueUsage { inputTokens: number; outputTokens: number; costUsd: number }
export interface ToldClueSentence { key: string; text: string; confidence: number; distribution: Record<string, number> }
export interface ToldClueAnswered {
  status: 'answered';
  /** Each candidate's `given` Noul, by clue handle, or null when it went unanswered. */
  given: Record<string, number | null>;
  /** Each landed clue's `given` Noul, by clue handle, or null when it went unanswered. */
  landedGiven: Record<string, number | null>;
  /** The sentence the second request put first for each clue it asked about. */
  sentences: Record<string, ToldClueSentence>;
  /** Whether the second request was sent, and why it failed when it did. */
  sentenceRequest: 'none' | 'answered' | string;
  elapsedMs: number;
  usage: ToldClueUsage;
}
export interface ToldClueFailed { status: 'failed'; reason: string; elapsedMs: number; usage: ToldClueUsage }
export type ToldClueResult = ToldClueAnswered | ToldClueFailed;

const candidateAlias = (index: number): string => `c${index}`;
const landedAlias = (index: number): string => `l${index}`;
const sentenceKey = (index: number): string => `s${index + 1}`;

export function toldClueBindings(input: ToldClueInput): { scope: ScopeBinding; readSet: ReadSet } {
  const scope: ScopeBinding = { owner: TOLD_CLUE_FAMILY, campaign: input.campaign, audience: 'keeper' };
  return { scope, readSet: [
    { kind: 'draft', resource: `turn:${input.turn}:told-clue`, revision: digest(input) },
    { kind: 'family', resource: TOLD_CLUE_FAMILY, revision: TOLD_CLUE_VERSION },
    { kind: 'model', resource: `${TOLD_CLUE_FAMILY}:jev`, revision: JEV_MODEL },
  ] };
}

/** What every question reads: the delivered sentences in order, and the clues by alias in the book's own words. */
export function toldClueState(input: ToldClueInput): Json {
  return {
    told: Object.fromEntries(input.sentences.map((sentence, index) => [sentenceKey(index), clip(sentence, 600)])),
    clues: Object.fromEntries([
      ...input.candidates.map((candidate, index) => [candidateAlias(index), { states: clip(candidate.summary, 300) }]),
      ...input.landed.map((landed, index) => [landedAlias(index), { states: clip(landed.summary, 300) }]),
    ]),
  };
}

const READS = '`told` is what the Keeper has just told the player, sentence by sentence in order. Each entry of `clues` is one fact of the '
  + 'story, in the book\'s own words, that the investigators may come to learn.';

/** The `given` Noul of one clue alias: one condition, phrased so a high answer means yes. */
function givenQuestion(alias: string): DecisionQuestion {
  return { key: `given_${alias}`, target: `whether the delivered text gives the investigators the fact \`clues.${alias}\``, type: 'noul',
    instructions: `${READS} Does \`told\` give the investigators the fact \`clues.${alias}.states\` -- the text has them read, see, hear, find `
      + 'or be told what it states, in substance, in any words or language? Judge only this one fact.',
    criteria: {
      true: { what: `The text tells the investigators what \`clues.${alias}.states\` says: its substance reaches them, in any words or language.` },
      false: { not_for: 'Only naming the place, person, document or object the fact is about; a search that finds nothing or finds something '
        + 'else; a plan to look; a hint that something is there; or a different fact about the same thing that leaves out what this one states.' },
    } };
}

/** First request: one `given` Noul per candidate and per landed clue. */
export function toldClueQuestions(input: ToldClueInput): DecisionQuestion[] {
  return [...input.candidates.map((_, index) => givenQuestion(candidateAlias(index))),
    ...input.landed.map((_, index) => givenQuestion(landedAlias(index)))];
}

/** Second request: for each candidate index the first cleared, the sentence of `told` that gives it. */
export function toldClueSentenceQuestions(input: ToldClueInput, indices: number[]): DecisionQuestion[] {
  const sentences: Record<string, string> = Object.fromEntries(input.sentences.map((sentence, index) =>
    [sentenceKey(index), `\`told.${sentenceKey(index)}\`: ${clip(sentence, 160)}`]));
  return indices.map(index => ({ key: `sentence_${candidateAlias(index)}`, target: `the delivered sentence that gives the fact \`clues.${candidateAlias(index)}\``,
    type: 'choice' as const,
    instructions: `${READS} Which one sentence of \`told\` gives the investigators the fact \`clues.${candidateAlias(index)}.states\`? When no `
      + 'single sentence says all of it, choose the one that says the most of it.',
    criteria: sentences }));
}

function noul(answer: DecisionAnswer | undefined): number | null {
  return answer?.status === 'answered' && answer.type === 'noul' && Number.isFinite(answer.noul) ? answer.noul : null;
}
/** A Choice's leading key among `keys` (its own pick when the distribution ties) and its distribution, or null. */
function leading(answer: DecisionAnswer | undefined, keys: string[]): { top: string; probabilities: Record<string, number>; confidence: number } | null {
  if (!answer || answer.status !== 'answered' || answer.type !== 'choice' || !keys.length) return null;
  const probabilities = answer.probabilities ?? { [answer.choice]: 1 };
  let top = keys.includes(answer.choice) ? answer.choice : keys[0]!;
  for (const key of keys) if ((probabilities[key] ?? 0) > (probabilities[top] ?? 0)) top = key;
  return { top, probabilities, confidence: typeof answer.confidence === 'number' && Number.isFinite(answer.confidence) ? answer.confidence : 0 };
}

/**
 * Ask about one delivery: the `given` Nouls, then -- only for the candidates whose `given` clears `givenMin` -- one sentence
 * Choice each, in a second request. Never throws: every non-answer is a `failed` result with its reason; a second request
 * that fails leaves the first's answers standing (its clues are then not owed).
 */
export async function runToldClue(input: ToldClueInput, decision: DecisionPort, lease: TaskLease, givenMin: number): Promise<ToldClueResult> {
  const began = Date.now(), usage: ToldClueUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const failed = (reason: string): ToldClueFailed => ({ status: 'failed', reason, elapsedMs: Date.now() - began, usage });
  if (!input.candidates.length && !input.landed.length) return failed('no_candidates');
  if (!input.sentences.length) return failed('no_text');
  const bindings = toldClueBindings(input), state = toldClueState(input);
  const spend = (result: DecisionResult) => {
    usage.inputTokens += result.usage?.inputTokens ?? 0;
    usage.outputTokens += result.usage?.outputTokens ?? 0;
    usage.costUsd += result.usage?.costUsd ?? 0;
  };
  try {
    const first: DecisionBatch = { id: `told-clue:${input.turn}:${digest(state)}`, model: JEV_MODEL, family: TOLD_CLUE_FAMILY,
      familyVersion: TOLD_CLUE_VERSION, scope: bindings.scope, readSet: bindings.readSet, state, questions: toldClueQuestions(input) };
    packDecisionBatch(first);
    const answered = await decision.decide(first, lease);
    spend(answered);
    const given = Object.fromEntries(input.candidates.map((candidate, index) => [candidate.name, noul(answered.answers[`given_${candidateAlias(index)}`])]));
    const landedGiven = Object.fromEntries(input.landed.map((landed, index) => [landed.clue, noul(answered.answers[`given_${landedAlias(index)}`])]));
    if (![...Object.values(given), ...Object.values(landedGiven)].some(value => value !== null)) return failed(answered.failure?.code ?? 'no_answer');
    const cleared = input.candidates.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) => (given[candidate.name] ?? 0) >= givenMin)
      .map(({ index }) => index);
    const sentences: Record<string, ToldClueSentence> = {};
    let sentenceRequest: string = 'none';
    if (cleared.length) {
      const second: DecisionBatch = { id: `told-clue-sentence:${input.turn}:${digest([state, cleared])}`, model: JEV_MODEL, family: TOLD_CLUE_FAMILY,
        familyVersion: TOLD_CLUE_VERSION, scope: bindings.scope, readSet: bindings.readSet, state, questions: toldClueSentenceQuestions(input, cleared) };
      try {
        packDecisionBatch(second);
        const chosen = await decision.decide(second, lease);
        spend(chosen);
        const keys = input.sentences.map((_, index) => sentenceKey(index));
        for (const index of cleared) {
          const told = leading(chosen.answers[`sentence_${candidateAlias(index)}`], keys);
          if (told) sentences[input.candidates[index]!.name] = { key: told.top, text: input.sentences[Number(told.top.slice(1)) - 1]!, confidence: told.confidence,
            distribution: Object.fromEntries(keys.map(key => [key, told.probabilities[key] ?? 0])) };
        }
        sentenceRequest = Object.keys(sentences).length ? 'answered' : chosen.failure?.code ?? 'no_answer';
      } catch (error) {
        sentenceRequest = error instanceof PackingError ? error.failure : 'told_clue_owner_error';
      }
    }
    return { status: 'answered', given, landedGiven, sentences, sentenceRequest, elapsedMs: Date.now() - began, usage };
  } catch (error) {
    return failed(error instanceof PackingError ? error.failure : 'told_clue_owner_error');
  }
}

export interface ToldClueDecisions {
  /** The clues to owe, each with the delivered sentence that gives it. */
  owe: Array<{ clue: string; quote: string }>;
  /** The clues not owed, with the first bar each missed. */
  stay: Array<{ clue: string; why: string }>;
  /** Landed clues whose `given` is at or under `untoldMax`: counted, never acted on. */
  landedUntold: string[];
}

/**
 * What the bars give (§201.1): owe a candidate when its `given` clears `givenMin` and its sentence's confidence clears
 * `sentenceMin`; otherwise stay with the first bar missed. A landed clue whose `given` is at or under `untoldMax` is counted.
 */
export function toldClueDecisions(result: ToldClueResult, budget: Pick<ToldClueBudget, 'givenMin' | 'sentenceMin' | 'untoldMax'>,
  input: Pick<ToldClueInput, 'candidates' | 'landed'>): ToldClueDecisions {
  if (result.status !== 'answered')
    return { owe: [], stay: input.candidates.map(candidate => ({ clue: candidate.name, why: result.reason })), landedUntold: [] };
  const owe: ToldClueDecisions['owe'] = [], stay: ToldClueDecisions['stay'] = [];
  for (const candidate of input.candidates) {
    const given = result.given[candidate.name] ?? null, sentence = result.sentences[candidate.name];
    if (given === null) stay.push({ clue: candidate.name, why: 'given_unanswered' });
    else if (given < budget.givenMin) stay.push({ clue: candidate.name, why: 'not_given' });
    else if (!sentence) stay.push({ clue: candidate.name, why: 'sentence_unanswered' });
    else if (sentence.confidence < budget.sentenceMin) stay.push({ clue: candidate.name, why: 'low_sentence' });
    else owe.push({ clue: candidate.name, quote: sentence.text });
  }
  const landedUntold = input.landed.filter(landed => { const given = result.landedGiven[landed.clue]; return given !== null && given !== undefined && given <= budget.untoldMax; })
    .map(landed => landed.clue);
  return { owe, stay, landedUntold };
}
