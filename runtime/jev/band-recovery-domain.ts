/**
 * Contract §138.6 (BR-02 of docs/specs/band-then-roll.md): the band questions the host asks Jev when the kernel
 * refuses a call with `needs {field}` for a field of the band registry -- the stat-block tier of a person the book
 * gave no numbers (`archetype`, `npc-stat-archetypes`) and the rulebook profile of a thing (`weapon`, `weapons`).
 *
 * Pure: builds DecisionBatches over the kernel's own options and reads their answers. The extension owns the kernel
 * reads that feed the state, the pin write, the retry and the telemetry. Jev names a row; it never writes a number
 * (the kernel rolls inside the tier; the profile carries its own dice).
 */
import {createHash} from 'node:crypto';
import type {DecisionBatch, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding} from './contracts.ts';
import type {DecisionPort} from './decision-port.ts';
import type {TaskLease} from './task-context.ts';
import {JEV_MODEL, packDecisionBatch, PackingError} from './question-packing.ts';

export const BAND_RECOVERY_FAMILY = 'band-recovery';
export const BAND_RECOVERY_VERSION = '1';
export type BandField = 'archetype' | 'weapon';
/** Placeholders until the bind rows exist (spec D4, Further Notes): low enough to measure, one per band table. */
export const BAND_DEFAULT_MIN_CONFIDENCE: Readonly<Record<BandField, number>> = Object.freeze({archetype: 0.5, weapon: 0.5});
/** How many skill families the profile question keeps from the first level (the skill's beam: 3 beats greedy). */
export const WEAPON_FAMILY_BEAM = 3;

/**
 * Descriptors of the kernel's closed tier enum, in the words of its own refusal (`kernel-ts/combat`): the options of
 * a closed bind, never read from prose. A tier the table adds later is offered under its id until it is described here.
 */
export const ARCHETYPE_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  ordinary_adult: 'An ordinary adult: someone who has never had to fight -- a clerk, a shopkeeper, a scholar, a landlord, a nurse.',
  capable_adult: 'A capable adult: someone fit or trained -- a sailor, a labourer, a soldier home from the war, a police constable, a hunter.',
  dangerous_actor: 'A dangerous actor: someone whose trade is violence -- a gangster, a hired thug, an enforcer, a professional killer.',
});

export interface ArchetypeBandInput {
  campaign: string;
  turn: number;
  /** The player's declaration of the turn: what needed this person's numbers. */
  declaration: string;
  /** The person as the kernel projects them (`table.look focus=npc`), already reduced to the fields a tier is judged by. */
  person: {name: string; dossier: Json};
  /** The kernel's own `details.needs.options`. */
  options: string[];
}
export interface WeaponProfile {id: string; name: string; skill: string; damage?: string | null; range?: number | null}
export interface WeaponBandInput {
  campaign: string;
  turn: number;
  declaration: string;
  /** The thing as the Keeper's call named it. */
  thing: {name: string; why?: string; description?: string};
  /** The kernel's era-filtered `details.needs.options` (profile ids) and its lexical `close` list. */
  options: string[];
  close?: string[];
  /** The rulebook profiles behind the options, from the catalog. */
  profiles: WeaponProfile[];
}
export interface BandUsage {inputTokens: number; outputTokens: number; costUsd: number}
export interface BandDecided {
  status: 'decided'; field: BandField; band: string; confidence: number; distribution: Record<string, number>;
  /** The weapon question's first level: the family it chose and that answer's confidence. */
  family?: {choice: string; confidence: number; distribution: Record<string, number>};
  calls: number; elapsedMs: number; usage: BandUsage;
}
export interface BandFallback {
  status: 'fallback'; field: BandField; reason: string; band?: string; confidence?: number; distribution?: Record<string, number>;
  calls: number; elapsedMs: number; usage: BandUsage;
}
export type BandResult = BandDecided | BandFallback;

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const clip = (value: string, max: number): string => Array.from(value).length <= max ? value : Array.from(value).slice(0, max - 3).join('') + '...';

/** The lease's and the batches' one binding for a question, from the whole input: the adapter refuses a batch whose scope or read set differs from its lease's. */
export function bindingsFor(field: BandField, input: ArchetypeBandInput | WeaponBandInput): {scope: ScopeBinding; readSet: ReadSet} {
  return bandBindings(field, input.campaign, input.turn, field === 'archetype' ? (input as ArchetypeBandInput).person.name : (input as WeaponBandInput).thing.name, input);
}
export function bandBindings(field: BandField, campaign: string, turn: number, name: string, input: unknown): {scope: ScopeBinding; readSet: ReadSet} {
  const scope: ScopeBinding = {owner: BAND_RECOVERY_FAMILY, campaign, audience: 'keeper'};
  return {scope, readSet: [
    {kind: 'draft', resource: `turn:${turn}:band:${field}:${name}`, revision: digest(input)},
    {kind: 'family', resource: BAND_RECOVERY_FAMILY, revision: BAND_RECOVERY_VERSION},
    {kind: 'model', resource: `${BAND_RECOVERY_FAMILY}:jev`, revision: JEV_MODEL},
  ]};
}

function batchOf(id: string, bindings: {scope: ScopeBinding; readSet: ReadSet}, state: Json, questions: DecisionQuestion[]): DecisionBatch {
  return {id, model: JEV_MODEL, family: BAND_RECOVERY_FAMILY, familyVersion: BAND_RECOVERY_VERSION, scope: bindings.scope, readSet: bindings.readSet, state, questions};
}

type Choice = {choice: string; confidence: number; distribution: Record<string, number>};
function choiceOf(result: DecisionResult, key: string): Choice | undefined {
  const answer = result.answers[key];
  if (!answer || answer.status !== 'answered' || answer.type !== 'choice') return undefined;
  const distribution = answer.probabilities ?? {[answer.choice]: 1};
  return {choice: answer.choice, confidence: typeof answer.confidence === 'number' ? answer.confidence : 0, distribution};
}

async function ask(decision: DecisionPort, lease: TaskLease, batch: DecisionBatch, usage: BandUsage): Promise<DecisionResult> {
  packDecisionBatch(batch);
  const result = await decision.decide(batch, lease);
  usage.inputTokens += result.usage?.inputTokens ?? 0;
  usage.outputTokens += result.usage?.outputTokens ?? 0;
  usage.costUsd += result.usage?.costUsd ?? 0;
  return result;
}

/**
 * One Choice over the kernel's tiers, from who the person is. `unknown` is the exit: a dossier that does not say
 * who they are settles nothing, and the Keeper keeps the choice (§135.28: below the gate the parameter is the Keeper's).
 */
export async function runArchetypeBand(input: ArchetypeBandInput, decision: DecisionPort, lease: TaskLease,
  options: {minConfidence: number}): Promise<BandResult> {
  const began = Date.now(), usage: BandUsage = {inputTokens: 0, outputTokens: 0, costUsd: 0};
  const fallback = (reason: string, extra: Partial<BandFallback> = {}): BandFallback =>
    ({status: 'fallback', field: 'archetype', reason, ...extra, calls: extra.calls ?? 0, elapsedMs: Date.now() - began, usage});
  if (!input.options.length) return fallback('no_options');
  const criteria: Record<string, string> = Object.fromEntries(input.options.map(tier => [tier, ARCHETYPE_DESCRIPTIONS[tier] ?? tier]));
  criteria.unknown = 'The dossier does not say who this person is well enough to place them: none of the tiers above clearly fits.';
  const state: Json = {declaration: clip(input.declaration, 600), person: {name: input.person.name, ...(typeof input.person.dossier === 'object' && input.person.dossier && !Array.isArray(input.person.dossier) ? input.person.dossier : {dossier: input.person.dossier})},
    needed_for: 'a check against this person that the rules settle on their numbers'};
  const bindings = bindingsFor('archetype', input);
  const batch = batchOf(`band:archetype:${input.turn}:${digest(state)}`, bindings, state, [{
    key: 'tier', target: `the stat-block tier of ${input.person.name}`, type: 'choice',
    instructions: 'Which stat-block tier fits this person, judged from who they are in the dossier (their trade, their body, their history), not from how hard the declared action is? A person who has never fought is ordinary whatever their standing; someone trained or hardened is capable; someone whose trade is violence is dangerous. Choose unknown when the dossier does not say.',
    criteria}]);
  try {
    const result = await ask(decision, lease, batch, usage);
    const answer = choiceOf(result, 'tier');
    if (!answer) return fallback(result.failure?.code ?? 'no_answer', {calls: 1});
    if (answer.choice === 'unknown' || !input.options.includes(answer.choice))
      return fallback('unknown', {band: answer.choice, confidence: answer.confidence, distribution: answer.distribution, calls: 1});
    if (answer.confidence < options.minConfidence)
      return fallback('low_confidence', {band: answer.choice, confidence: answer.confidence, distribution: answer.distribution, calls: 1});
    return {status: 'decided', field: 'archetype', band: answer.choice, confidence: answer.confidence, distribution: answer.distribution, calls: 1, elapsedMs: Date.now() - began, usage};
  } catch (error) {
    return fallback(error instanceof PackingError ? error.failure : 'band_owner_error');
  }
}

/**
 * Two levels (spec D2: skill family first, then the profiles of that family, beam 3), one request each. The final
 * profile is the best family-weighted profile; its confidence is the weakest of the two judgments, never their product
 * (the function_calling cookbook's rule). `none` at either level is the exit: the thing is no weapon anyone would
 * fight with, and the Keeper keeps the call.
 */
export async function runWeaponBand(input: WeaponBandInput, decision: DecisionPort, lease: TaskLease,
  options: {minConfidence: number}): Promise<BandResult> {
  const began = Date.now(), usage: BandUsage = {inputTokens: 0, outputTokens: 0, costUsd: 0};
  let calls = 0;
  const fallback = (reason: string, extra: Partial<BandFallback> = {}): BandFallback =>
    ({status: 'fallback', field: 'weapon', reason, ...extra, calls, elapsedMs: Date.now() - began, usage});
  const offered = new Set(input.options), profiles = input.profiles.filter(profile => offered.has(profile.id));
  if (!profiles.length) return fallback('no_profiles');
  const families = new Map<string, WeaponProfile[]>();
  for (const profile of profiles) families.set(profile.skill, [...(families.get(profile.skill) ?? []), profile]);
  const thing: Json = {name: input.thing.name, ...(input.thing.why ? {why: clip(input.thing.why, 300)} : {}), ...(input.thing.description ? {description: clip(input.thing.description, 600)} : {})};
  const state: Json = {declaration: clip(input.declaration, 600), thing, ...(input.close?.length ? {closest_by_name: input.close} : {})};
  const bindings = bindingsFor('weapon', input);
  const familyCriteria: Record<string, string> = Object.fromEntries([...families].map(([skill, members]) =>
    [skill, `${skill}: ${members.slice(0, 8).map(profile => profile.name).join(', ')}${members.length > 8 ? ', ...' : ''}`]));
  familyCriteria.none = 'This thing is not a weapon anyone would fight with; it takes no rulebook profile.';
  try {
    const first = await ask(decision, lease, batchOf(`band:weapon:family:${input.turn}:${digest(state)}`, bindings, state, [{
      key: 'family', target: `the weapon skill this thing is used with`, type: 'choice',
      instructions: 'Which rulebook weapon skill would this thing be used with, from what it is (its name, how it came to hand, its description)? Judge the object, not the fighter. Choose none for a thing nobody would fight with.',
      criteria: familyCriteria}]), usage);
    calls++;
    const family = choiceOf(first, 'family');
    if (!family) return fallback(first.failure?.code ?? 'no_answer');
    if (family.choice === 'none' || !families.has(family.choice))
      return fallback('none', {band: family.choice, confidence: family.confidence, distribution: family.distribution});
    const beam = Object.entries(family.distribution).filter(([skill]) => families.has(skill)).sort((a, b) => b[1] - a[1]).slice(0, WEAPON_FAMILY_BEAM).map(([skill]) => skill);
    if (!beam.includes(family.choice)) beam.unshift(family.choice);
    const questions: DecisionQuestion[] = beam.map((skill, index) => ({
      key: `profile_${index}`, target: `the ${skill} profile this thing hits like`, type: 'choice',
      instructions: `Among the rulebook's ${skill} weapons, which profile is this thing closest to in how it hurts and how it is used? Choose none when no profile of this skill fits.`,
      criteria: {...Object.fromEntries(families.get(skill)!.map(profile => [profile.id,
        `${profile.name}${profile.damage ? `: damage ${profile.damage}` : ''}${profile.range != null ? `, range ${profile.range} yards` : ''}`])),
        none: `No ${skill} profile fits this thing.`}}));
    const second = await ask(decision, lease, batchOf(`band:weapon:profile:${input.turn}:${digest(state)}`, bindings, state, questions), usage);
    calls++;
    let best: {id: string; score: number; confidence: number; distribution: Record<string, number>; family: string} | undefined;
    for (const [index, skill] of beam.entries()) {
      const answer = choiceOf(second, `profile_${index}`);
      // A profile of this family and of the kernel's options, or nothing: an answer outside the question is never pinned.
      if (!answer || answer.choice === 'none' || !families.get(skill)!.some(profile => profile.id === answer.choice)) continue;
      const score = (family.distribution[skill] ?? 0) * (answer.distribution[answer.choice] ?? answer.confidence);
      if (!best || score > best.score) best = {id: answer.choice, score, confidence: Math.min(family.confidence, answer.confidence), distribution: answer.distribution, family: skill};
    }
    if (!best) return fallback('none', {confidence: family.confidence, distribution: family.distribution});
    const familyRow = {choice: best.family, confidence: family.confidence, distribution: family.distribution};
    if (best.confidence < options.minConfidence)
      return fallback('low_confidence', {band: best.id, confidence: best.confidence, distribution: best.distribution});
    return {status: 'decided', field: 'weapon', band: best.id, confidence: best.confidence, distribution: best.distribution, family: familyRow, calls, elapsedMs: Date.now() - began, usage};
  } catch (error) {
    return fallback(error instanceof PackingError ? error.failure : 'band_owner_error');
  }
}
