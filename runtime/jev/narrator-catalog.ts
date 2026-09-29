/**
 * §150.5 (SL-79 behind a setting; `docs/specs/jev-decides-llm-writes.md` D-D, `docs/specs/jev-driven-steps.md` D5): the
 * narrator-only compose catalog. Pure: the setting (env over data), the step's catalog, the offered keys `propose` names,
 * the `propose` tool's declaration and the refusals the Keeper reads. `hybrid-engine.ts` wires them; the kernel extension
 * honours a refusal the engine announced for a model call (`coc:model-step`'s `refuse`).
 *
 * - `say` is not a tool: a person's spoken words are `{{say:Name}}…{{/say}}` spans inside `narrate`/`ask` text (§40), so
 *   the compose step's catalog is the two delivery verbs plus `propose`, and its note names the spans.
 * - The provider-visible tool loadout stays the session's (§150.5 implementation decision): a per-step loadout would
 *   re-declare about 67 KB of tool definitions into the transcript at every switch and move the request's tool prefix.
 *   The step's catalog is what it admits: a model call outside it is refused before it runs.
 */
import {Type} from 'typebox';
import type {Json} from './contracts.ts';
import {bindingOf, CLERK_AUTHORITY, type Candidate} from './step-policy.ts';

/** The narrator-only compose step's tool catalog. `say` rides inside `narrate`/`ask` text as spans (module comment). */
export const NARRATOR_CATALOG = ['narrate', 'ask', 'propose'] as const;
/** The Keeper verb that names an offered candidate key (never a handle). */
export const PROPOSE_VERB = 'propose';
/** The env switch; `on` and `off` are explicit, anything else (absent, empty, another word) leaves the data default. */
export const NARRATOR_ONLY_ENV = 'COC_NARRATOR_ONLY';

export interface NarratorOnlyBudgetShape {
  /** `narrator_only.enabled`: the data default when the env does not set the switch (shipped `false`). */
  enabled: boolean;
  /** `narrator_only.propose_per_turn`: how many `propose` requests one turn may queue (shipped 2). */
  proposePerTurn: number;
}
export interface NarratorOnlySetting {
  on: boolean;
  /** Where `on` came from: the env switch, or the host budget data's default. */
  source: 'env' | 'data';
  proposePerTurn: number;
}

/** §150.5: env over data. The env switch is a schedule switch over two words, not a classification of any text. */
export function narratorOnlySetting(env: Readonly<Record<string, string | undefined>>, budget: NarratorOnlyBudgetShape): NarratorOnlySetting {
  const raw = String(env[NARRATOR_ONLY_ENV] ?? '').trim();
  if (raw === 'on' || raw === 'off') return {on: raw === 'on', source: 'env', proposePerTurn: budget.proposePerTurn};
  return {on: budget.enabled, source: 'data', proposePerTurn: budget.proposePerTurn};
}

/** The catalog one model step admits: the narrowed catalog on a narrower compose, none (the session's whole loadout) otherwise. */
export interface StepCatalog {
  purpose: string;
  /** The narrowed catalog of a compose step, or `undefined` when the step keeps the whole loadout. */
  narrowed?: readonly string[];
  /** Whether `propose` is admitted on this step (a compose or an adjudicate step while the setting is on). */
  propose: boolean;
}
/**
 * Which catalog a model step gets. Narrowed: a compose step, with the setting on and a decision port (a Jev outage keeps
 * today's catalog, D2.7), unless the compose is the spent-decision-budget one (§135.25: the Keeper's own calls carry the
 * rest of that turn). `propose` is admitted on compose and adjudicate steps while the setting is on; a bind step is one
 * call of the verb the clerk chose (§135.4) and keeps exactly its catalog.
 */
export function stepCatalog(setting: Pick<NarratorOnlySetting, 'on'>, step: {purpose: string; reason: string}, jevAvailable: boolean): StepCatalog {
  if (!setting.on) return {purpose: step.purpose, propose: false};
  const narrowed = step.purpose === 'compose' && jevAvailable && step.reason !== 'jev_budget';
  return {purpose: step.purpose, ...(narrowed ? {narrowed: NARRATOR_CATALOG} : {}), propose: step.purpose === 'compose' || step.purpose === 'adjudicate'};
}

/**
 * The run's offered candidate set `propose` names (§135.32: "a typed `propose {key}` over the run's offered
 * candidates"): the candidates the latest read issued that the route offers (the policy's `candidates`, consumed ones
 * already out) and the consequence candidates the run built, that the clerk may run and the policy can settle without the
 * Keeper -- clerk authority, not a person's own act (the scan's), not forced (the kernel forces those anyway), and no open
 * parameter (an open one is the Keeper's own verb, §135.28). Already executed or proposed keys are out. A consequence
 * `clue_follow_up` whose clue an issued clue candidate already files is the same write and is not listed twice.
 */
export function offeredForPropose(issued: readonly Candidate[], consequences: readonly Candidate[], taken: ReadonlySet<string>): Candidate[] {
  const eligible = (candidate: Candidate) => !!candidate.clerk && (CLERK_AUTHORITY as readonly string[]).includes(candidate.clerk)
    && candidate.clerk !== 'npc_act' && candidate.forced !== true && bindingOf(candidate) !== 'open' && !taken.has(candidate.key);
  const out: Candidate[] = [];
  // The clues an issued candidate files, offered or already taken: the consequence twin is that same write either way.
  const clues = new Set(issued.filter(candidate => candidate.family === 'clue' && typeof candidate.bound.clue === 'string').map(candidate => String(candidate.bound.clue)));
  for (const candidate of issued) {
    if (!eligible(candidate) || out.some(value => value.key === candidate.key)) continue;
    out.push(candidate);
  }
  for (const candidate of consequences) {
    if (!eligible(candidate) || out.some(value => value.key === candidate.key)) continue;
    if (candidate.family === 'clue_follow_up' && typeof candidate.bound.clue === 'string' && clues.has(candidate.bound.clue)) continue;
    out.push(candidate);
  }
  return out;
}

/** The offered set as the Keeper reads it: the key it copies, the label and family it recognises. */
export function offeredView(offered: readonly Candidate[]): Array<{key: string; label: string; family: string}> {
  return offered.map(candidate => ({key: candidate.key, label: candidate.label, family: candidate.family}));
}
const keyList = (offered: readonly Candidate[]): string => offered.length ? offered.map(candidate => candidate.key).join(', ') : 'none';

/** A proposed candidate as the policy runs it: the Keeper's request on its basis; no Jev evidence it did not produce here. */
export function proposedCandidate(candidate: Candidate, at: {run: string; step: string}): Candidate {
  const basis = candidate.basis && typeof candidate.basis === 'object' && !Array.isArray(candidate.basis) ? candidate.basis as Record<string, Json> : {};
  // §32.12: a compile's or a consequence route's evidence admits a write it selected; a Keeper's proposal is reviewed as one.
  const {compile: _compile, consequence: _consequence, ...rest} = basis;
  return {...candidate, basis: {...rest, proposed: {by: 'keeper', run: at.run, step: at.step}}};
}

export type ProposeRefusal = {code: 'not_offered' | 'already_proposed' | 'turn_cap'; text: string};
/**
 * Whether a `propose {key}` is refused, and the sentence the Keeper reads. The key is compared exactly with the offered
 * keys (a closed set the host issued); a handle, a label or a description is not a key and is refused with the keys.
 */
export function proposeRefusal(input: {key: unknown; offered: readonly Candidate[]; proposed: ReadonlySet<string>; used: number; cap: number}): ProposeRefusal | undefined {
  const key = typeof input.key === 'string' ? input.key : '';
  if (input.used >= input.cap)
    return {code: 'turn_cap', text: `propose is limited to ${input.cap} per turn and this turn has used ${input.used}; nothing was carried out. Narrate what landed.`};
  if (key && input.proposed.has(key))
    return {code: 'already_proposed', text: `${key} was already proposed this turn; nothing more was carried out. Narrate what landed.`};
  if (!input.offered.some(candidate => candidate.key === key))
    return {code: 'not_offered', text: input.offered.length
      ? `propose takes one key from this step's offered list, copied exactly; ${JSON.stringify(key)} is not one of them, so nothing was carried out. Offered keys: ${keyList(input.offered)}.`
      : `This step offers no key, so nothing can be proposed and nothing was carried out. Narrate what landed.`};
  return undefined;
}

/** The refusal of a model call outside a narrowed compose step's catalog (announced to the kernel's tool gate). */
export function catalogRefusal(operation: string, offered: readonly Candidate[]): string {
  return `${operation} is not in this narrator-only compose step's catalog (narrate, ask, propose); nothing was executed. `
    + `Write the turn with narrate (or ask for a pending choice) from what landed and what the run carried, or call propose with one offered key. Offered keys: ${keyList(offered)}.`;
}
/** The refusal of a call written after an accepted `propose` in the same response: the proposed step has not run yet. */
export const PROPOSE_PENDING_REFUSAL = 'A step you proposed in this response has not run yet: the clerk carries it out before your next step, '
  + 'and its result comes on that step\'s note under clerk_did. Nothing else in this response was executed; write the turn then.';

/** The accepted `propose`'s tool result: queued, run by the clerk before the Keeper's next step. */
export function proposeQueuedText(candidate: Candidate): string {
  return `Queued: the clerk carries out ${candidate.key} (${candidate.label}) before your next step, through the same admission as its own steps. `
    + 'Its receipts or its refusal come on that step\'s note under clerk_did. Write nothing else in this response.';
}

/** The compose note's line on a narrowed step (Keeper-only, system language). */
export const NARRATOR_NOTE = 'Narrator-only step: this compose step\'s catalog is narrate, ask and propose. Write the turn with narrate, or ask for a '
  + 'pending choice; a person\'s spoken words go in {{say:Name}}...{{/say}} spans of that text. apply, resolve, look, lookup and recall are not '
  + 'in this step\'s catalog: the clerk settled what the run could settle (clerk_did), and what the run read is carried in this note. '
  + 'Narrate only what landed with a receipt. To have one more step carried out, call propose with one key from offered, copied exactly, '
  + 'alone in its response: the clerk runs it before your next step.';
/** The note's line on an adjudicate step while the setting is on: `propose` is there beside the ordinary verbs. */
export const PROPOSE_NOTE = 'propose runs one step from offered by its key, copied exactly, through the clerk\'s admission; it is blocking, '
  + 'so send it alone in its response: its result comes on your next step\'s note.';

/** The `propose` tool's declaration (registered by the engine only while the setting is on). */
export const PROPOSE_TOOL = Object.freeze({
  name: PROPOSE_VERB,
  label: 'Propose',
  description: 'Ask the clerk to carry out one more step the run offered, named by its key from the note\'s offered list, copied exactly '
    + '(never a handle, a label or a description). The clerk runs it before your next step, through the same admission as its own steps, '
    + 'and that step\'s note lists its receipts or its refusal under clerk_did. Blocking: send it alone in its response. A few per turn at most.',
  promptSnippet: 'Ask the clerk to carry out one offered step, by its key',
  parameters: Type.Object({key: Type.String({description: 'one key from the note\'s offered list, copied exactly'})}),
});
