/**
 * Typed person-name resolution (contract §11.5.6, SL-62). A person named in a write or check names nobody the graph
 * or the turn's carried text resolves; before `unknown_entity` stands, the scene's known people (present, addressee
 * rows, the module's people of this scene -- in practice §135.31's `present` reduction) are asked, one fan-out row
 * each: is the named person the same as this one, allowing for a variant spelling, transliteration or rendering.
 * Each row is judged on its own margin (`rowClears`, `route-compile.ts`'s SL-52 rule), never a flat gate and never a
 * pick-one. Exactly one row clearing `yes` is a resolution; zero or more than one leaves the name unresolved and the
 * caller's own `unknown_entity` refusal stands.
 *
 * Authority boundary: nothing here mints a person, changes a graph record, or picks among several plausible
 * identities. It reads a closed, host-issued set of the scene's own known people; no name list, regex or language
 * rule decides anything.
 */
import {createHash} from 'node:crypto';
import type {DecisionPort} from './decision-port.ts';
import {JEV_MODEL, packDecisionBatch, PackingError} from './question-packing.ts';
import type {DecisionBatch, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding} from './contracts.ts';
import type {TaskLease} from './task-context.ts';
import {NO, rowClears, YES} from './route-compile.ts';

export const PERSON_RESOLUTION_FAMILY = 'person-name-resolution';
export const PERSON_RESOLUTION_VERSION = '1';
export const PERSON_RESOLUTION_MODEL = JEV_MODEL;
/** Candidate rows one question sends; a scene with more known people than this asks about none (unresolved). */
export const PERSON_RESOLUTION_MAX_CANDIDATES = 12;
const UNCLEAR = 'unclear';
const NAME_UTF16 = 80;

/** One of the scene's known people: `handle` is what the retried call's own name/who field is rewritten to. */
export interface PersonResolutionCandidate {handle: string; names: string[]}
export interface PersonResolutionInput {campaign: string; turn: number; name: string; candidates: PersonResolutionCandidate[]}

export type PersonResolutionResult =
  | {status: 'resolved'; handle: string; confidence: number; calls: number}
  | {status: 'unresolved'; reason: string; calls: number};

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function clip(value: string, limit: number): string { return value.length <= limit ? value : value.slice(0, limit); }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
/** The alias of a candidate's own row (the option key Jev answers with), matching the `ask` fan-out's shape. */
const alias = (index: number): string => `person_${index + 1}`;

export function personResolutionBindings(input: PersonResolutionInput): {scope: ScopeBinding; readSet: ReadSet} {
  const scope: ScopeBinding = {owner: PERSON_RESOLUTION_FAMILY, campaign: input.campaign, audience: 'keeper'};
  return {scope, readSet: [
    {kind: 'draft', resource: `turn:${input.turn}:person-resolution:${input.name}`, revision: digest(input)},
    {kind: 'family', resource: PERSON_RESOLUTION_FAMILY, revision: PERSON_RESOLUTION_VERSION},
    {kind: 'model', resource: `${PERSON_RESOLUTION_FAMILY}:jev`, revision: PERSON_RESOLUTION_MODEL},
  ]};
}

const ROW = {
  instructions: 'Judge this one listed person on their own: is the named person the same person as this one, allowing for a variant '
    + 'spelling, transliteration or rendering of the same name -- never a different person who merely resembles them? Other rows may '
    + 'also be candidates; judge only this one. Choose unclear when the input does not tell.',
  criteria: {[YES]: 'The named person is this person.', [NO]: 'The named person is not this person.',
    [UNCLEAR]: 'The input does not tell whether the named person is this person.'},
} as const;

function names(candidate: PersonResolutionCandidate): string[] {
  return [...new Set(candidate.names.filter(nonempty).map(value => clip(value.trim(), NAME_UTF16)))];
}

/** The one batch this family sends for a name: one state, one independent yes/no/unclear row per known person. */
export function personResolutionBatch(input: PersonResolutionInput, bindings = personResolutionBindings(input)): DecisionBatch {
  const state = {
    name: clip(input.name.trim(), NAME_UTF16),
    candidates: input.candidates.map((candidate, index) => ({alias: alias(index), names: names(candidate)})),
  } as unknown as Json;
  const questions: DecisionQuestion[] = input.candidates.map((_, index) => ({
    key: alias(index), target: `candidates[${index}]`, type: 'choice',
    instructions: `The player named "${clip(input.name.trim(), NAME_UTF16)}". ${ROW.instructions}`,
    criteria: {...ROW.criteria},
  }));
  return {id: `person-resolution:${input.turn}:${digest(input).slice(0, 16)}`, model: PERSON_RESOLUTION_MODEL,
    family: PERSON_RESOLUTION_FAMILY, familyVersion: PERSON_RESOLUTION_VERSION, scope: bindings.scope,
    readSet: bindings.readSet, state, questions};
}

/**
 * Read a complete result into one resolution. Exactly one row clearing `yes` (its own margin, `rowClears`) is a
 * resolution; zero clearing is `no_row_cleared`, more than one is `ambiguous` -- both leave the name unresolved.
 */
export function interpretPersonResolution(input: PersonResolutionInput, result: DecisionResult):
  {status: 'resolved'; handle: string; confidence: number} | {status: 'unresolved'; reason: string} {
  if (result.status !== 'complete') return {status: 'unresolved', reason: result.failure?.code ?? `decision_${result.status}`};
  const cleared: Array<{index: number; confidence: number}> = [];
  for (let index = 0; index < input.candidates.length; index++) {
    const answer = result.answers[alias(index)];
    if (answer?.status !== 'answered' || answer.type !== 'choice') return {status: 'unresolved', reason: 'invalid_typed_answer'};
    if (answer.choice === YES && rowClears(answer.choice, answer.confidence, answer.probabilities))
      cleared.push({index, confidence: answer.confidence ?? 0});
  }
  if (cleared.length !== 1) return {status: 'unresolved', reason: cleared.length ? 'ambiguous' : 'no_row_cleared'};
  return {status: 'resolved', handle: input.candidates[cleared[0].index].handle, confidence: cleared[0].confidence};
}

/** One typed round for one name. Never throws; every non-resolution is an explicit unresolved reason. */
export async function resolvePersonName(input: PersonResolutionInput, decision: DecisionPort, lease: TaskLease): Promise<PersonResolutionResult> {
  let calls = 0;
  const fallback = (reason: string): PersonResolutionResult => ({status: 'unresolved', reason, calls});
  try {
    if (!input.name.trim()) return fallback('no_name');
    if (!input.candidates.length) return fallback('no_candidates');
    if (input.candidates.length > PERSON_RESOLUTION_MAX_CANDIDATES) return fallback('too_many_candidates');
    const bindings = personResolutionBindings(input), context = lease.context;
    if (digest(context.scope) !== digest(bindings.scope) || digest(context.readSet) !== digest(bindings.readSet))
      return fallback('attempt_binding_mismatch');
    const batch = personResolutionBatch(input, bindings);
    try { packDecisionBatch(batch); }
    catch (error) { return fallback(error instanceof PackingError ? error.failure : 'schema_error'); }
    const result = await decision.decide(batch, lease); calls++;
    const read = interpretPersonResolution(input, result);
    if (read.status === 'unresolved') return {...read, calls};
    return {...read, calls};
  } catch { return fallback('person_resolution_owner_error'); }
}
