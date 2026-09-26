/**
 * Typed setup-name boundary check (contract §98 addendum 7 continuation, SL-68). SL-66 already trims a selected
 * `profile.name` range to its word boundary -- dropping leading/trailing punctuation and whitespace, a category
 * test that needs no judgement. What is left after that trim may still carry, at either end, a token that is
 * itself a word: the b11 setup fixture selected a name range that began one grapheme early, on a leading verb
 * meaning "called", because that verb is not punctuation, so the category trim kept it. Whether a boundary
 * token belongs to the name the player gave is an open semantic judgement (is this a name component, a verb, a
 * particle, a title?) that no character-class test or list of verbs can answer for every language, so it is
 * asked of Jev instead: one row per boundary in question, given the whole sentence and the candidate name,
 * judged independently.
 *
 * Authority boundary: this asks only whether one boundary token belongs to the name; it never picks, generates or
 * corrects a name, and a `no` answer only lets the caller (`setup-input-references.ts`) drop that one unit and
 * re-run its own punctuation/space trim. Every non-`no` outcome -- `yes`, `unclear`, an incomplete result, a
 * foreign lease or a throwing port -- is a named fallback that keeps the token, never a guess.
 */
import {createHash} from 'node:crypto';
import type {DecisionPort} from './decision-port.ts';
import {JEV_MODEL, packDecisionBatch, PackingError} from './question-packing.ts';
import type {DecisionBatch, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding} from './contracts.ts';
import type {TaskLease} from './task-context.ts';
import {NO, rowClears, YES} from './route-compile.ts';
import type {NameBoundaryCheckInput, NameBoundaryDecision} from './setup-input-references.ts';

export const NAME_BOUNDARY_FAMILY = 'setup-name-boundary';
export const NAME_BOUNDARY_VERSION = '1';
export const NAME_BOUNDARY_MODEL = JEV_MODEL;
const UNCLEAR = 'unclear';
const SENTENCE_CLIP = 400, NAME_CLIP = 80, TOKEN_CLIP = 40;

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function clip(value: string, limit: number): string { return value.length <= limit ? value : value.slice(0, limit); }

export function nameBoundaryBindings(campaign: string, epoch: string, input: NameBoundaryCheckInput): {scope: ScopeBinding; readSet: ReadSet} {
  const scope: ScopeBinding = {owner: NAME_BOUNDARY_FAMILY, campaign, audience: 'player'};
  return {scope, readSet: [
    {kind: 'draft', resource: `setup-input:${epoch}:name-boundary`, revision: digest(input)},
    {kind: 'family', resource: NAME_BOUNDARY_FAMILY, revision: NAME_BOUNDARY_VERSION},
    {kind: 'model', resource: `${NAME_BOUNDARY_FAMILY}:jev`, revision: NAME_BOUNDARY_MODEL},
  ]};
}

function rowInstructions(input: NameBoundaryCheckInput, token: string, side: 'leading' | 'trailing'): string {
  return `The player's own sentence is: "${clip(input.sentence, SENTENCE_CLIP)}". The candidate investigator name selected from `
    + `it is "${clip(input.name, NAME_CLIP)}". Judge only its ${side === 'leading' ? 'first' : 'last'} token, "${clip(token, TOKEN_CLIP)}": `
    + 'is that token itself part of the investigator\'s name, or is it a separate word the sentence puts beside the name (a verb, a '
    + 'particle, a title, or anything else that is not the name itself)? Choose unclear when the sentence does not tell.';
}
const CRITERIA = {[YES]: 'The token is part of the name.', [NO]: 'The token is not part of the name.', [UNCLEAR]: 'The sentence does not tell.'};

/** The one batch this family sends for a selection: one row for each boundary actually in question (never two
 * when only one end needs asking, never zero -- the caller does not call this when neither does). */
export function nameBoundaryBatch(campaign: string, epoch: string, input: NameBoundaryCheckInput,
    bindings = nameBoundaryBindings(campaign, epoch, input)): DecisionBatch {
  const state = {sentence: clip(input.sentence, SENTENCE_CLIP), name: clip(input.name, NAME_CLIP),
    ...(input.leading !== undefined ? {leading: clip(input.leading, TOKEN_CLIP)} : {}),
    ...(input.trailing !== undefined ? {trailing: clip(input.trailing, TOKEN_CLIP)} : {})} as unknown as Json;
  const questions: DecisionQuestion[] = [];
  if (input.leading !== undefined) questions.push({key: 'leading', target: 'leading', type: 'choice',
    instructions: rowInstructions(input, input.leading, 'leading'), criteria: {...CRITERIA}});
  if (input.trailing !== undefined) questions.push({key: 'trailing', target: 'trailing', type: 'choice',
    instructions: rowInstructions(input, input.trailing, 'trailing'), criteria: {...CRITERIA}});
  return {id: `name-boundary:${epoch}:${digest(input).slice(0, 16)}`, model: NAME_BOUNDARY_MODEL, family: NAME_BOUNDARY_FAMILY,
    familyVersion: NAME_BOUNDARY_VERSION, scope: bindings.scope, readSet: bindings.readSet, state, questions};
}

/** Read a complete result into a decision, per boundary asked. A row clearing `no` (its own margin, `rowClears`)
 * drops that token; anything else -- `yes`, `unclear`, an unanswered/invalid row, or an incomplete result -- keeps
 * it. A boundary never asked about (not in `input`) reads as kept, so the caller's own "nothing to ask" case never
 * needs a separate branch. */
export function interpretNameBoundary(input: NameBoundaryCheckInput, result: DecisionResult): NameBoundaryDecision {
  const keep = (side: 'leading' | 'trailing'): boolean => {
    if (input[side] === undefined) return true;
    if (result.status !== 'complete') return true;
    const answer = result.answers[side];
    if (!answer || answer.status !== 'answered' || answer.type !== 'choice') return true;
    if (answer.choice === NO && rowClears(answer.choice, answer.confidence, answer.probabilities)) return false;
    return true;
  };
  return {leading: keep('leading'), trailing: keep('trailing')};
}

/** One typed round for one selection's boundaries. Never throws; every non-drop outcome is the same fail-safe
 * "keep the token" default, exactly as an unresolved person-name candidate leaves the original word standing. */
export async function checkNameBoundary(campaign: string, epoch: string, input: NameBoundaryCheckInput,
    decision: DecisionPort, lease: TaskLease): Promise<NameBoundaryDecision> {
  const KEEP: NameBoundaryDecision = {leading: true, trailing: true};
  if (input.leading === undefined && input.trailing === undefined) return KEEP;
  try {
    const bindings = nameBoundaryBindings(campaign, epoch, input), context = lease.context;
    if (digest(context.scope) !== digest(bindings.scope) || digest(context.readSet) !== digest(bindings.readSet)) return KEEP;
    const batch = nameBoundaryBatch(campaign, epoch, input, bindings);
    try { packDecisionBatch(batch); } catch { return KEEP; }
    const result = await decision.decide(batch, lease);
    return interpretNameBoundary(input, result);
  } catch { return KEEP; }
}
