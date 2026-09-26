/**
 * Contract §138.6 (BR-02): the host pins a tier or a profile on the kernel's own `needs` refusal.
 *
 * Two kernel refusals name a band table's rows in `details.needs.options`: `needs {field: "archetype"}` (a check
 * against a person the book gave no numbers) and `needs {field: "weapon"}` (an item whose `weapon` is not a rulebook
 * profile). When such a refusal comes back, the host asks Jev the band question (`runtime/jev/band-recovery-domain.ts`);
 * above the table's gate it writes the pin as its own operation with a minted call id (archetype) or corrects the
 * one field of the Keeper's own effect (weapon, model-origin calls only: a tracked clerk request may not change), and
 * the refused call is retried once. Below the gate, on a spent budget or with Jev unavailable, the Keeper sees the
 * original refusal unchanged. This file is the glue: needs detection, the gates, the state the questions read, the
 * Keeper's note; it holds no Pi types and no kernel client, so it is unit-testable.
 *
 * `askBand` is also the one place the shadow lane asks its questions (§138.8, BR-04): the band of the Keeper's own
 * `time` or `damage` after it landed, under its own family and lease, recorded and never executed.
 */
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {preparationBudget} from '../../runtime/jev/preparation-budget.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import type {Json} from '../../runtime/jev/contracts.ts';
import {composeSentence} from '../../runtime/jev/composed-arguments.ts';
import {BAND_DEFAULT_MIN_CONFIDENCE, BAND_RECOVERY_FAMILY, bindingsFor, runArchetypeBand, runWeaponBand,
  type ArchetypeBandInput, type BandField, type BandResult, type WeaponBandInput, type WeaponProfile} from '../../runtime/jev/band-recovery-domain.ts';
import type {TaskProviderBudget} from '../../runtime/jev/provider-budget.ts';
import {BAND_SHADOW_FAMILY, runBandShadow, shadowBindings, type DamageBandRow, type ShadowInput, type ShadowResult,
  type TimeBandRow} from '../../runtime/jev/band-shadow-domain.ts';
import {readJevApiKey} from '../jev/agent/config.js';

export const BAND_TABLES: Readonly<Record<BandField, string>> = Object.freeze({archetype: 'npc-stat-archetypes', weapon: 'weapons'});
const DEFAULT_BAND_JEV_TIMEOUT_MS = 4_000;

/** Cap on one band recovery's Jev time, `PI_COC_BAND_JEV_TIMEOUT_MS`; its expiry leaves the refusal as it was. */
export function bandJevTimeoutMs(env: NodeJS.ProcessEnv): number {
  const value = Number(env.PI_COC_BAND_JEV_TIMEOUT_MS?.trim() || NaN);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BAND_JEV_TIMEOUT_MS;
}
/** The gate a band answer must clear, `PI_COC_BAND_MIN_CONFIDENCE` in (0, 1]; a placeholder per table until calibrated. */
export function bandMinConfidence(env: NodeJS.ProcessEnv, field: BandField): number {
  const value = Number(env.PI_COC_BAND_MIN_CONFIDENCE?.trim() || NaN);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : BAND_DEFAULT_MIN_CONFIDENCE[field];
}

export interface BandNeeds {field: BandField; options: string[]; close: string[]; index?: number; profiles?: WeaponProfile[]}
/** The kernel refused with `needs` for a band field: the rows it offered, and for an apply the effect's index. */
export function bandNeeds(error: unknown): BandNeeds | undefined {
  const row = error as {code?: unknown; details?: Record<string, unknown>} | null;
  if (!row || row.code !== 'needs' || !row.details || typeof row.details !== 'object') return undefined;
  const needs = row.details.needs as Record<string, unknown> | undefined;
  if (!needs || typeof needs !== 'object') return undefined;
  const field = needs.field;
  if (field !== 'archetype' && field !== 'weapon') return undefined;
  const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
  const options = strings(needs.options);
  if (!options.length) return undefined;
  const index = Number.isInteger(row.details.index) ? Number(row.details.index) : undefined;
  const profiles = field === 'weapon' ? weaponProfilesOf({records: needs.profiles}) : [];
  return {field, options, close: strings(needs.close), ...(index === undefined ? {} : {index}), ...(profiles.length ? {profiles} : {})};
}

const DOSSIER_KEYS = ['name', 'role', 'occupation', 'summary', 'description', 'appearance', 'agenda', 'wants', 'fears', 'hides', 'secret', 'voice', 'personality', 'toward_party', 'stance', 'knows', 'ties', 'history'] as const;
const clip = (value: string, max: number): string => Array.from(value).length <= max ? value : Array.from(value).slice(0, max - 3).join('') + '...';
/** The fields of the kernel's NPC view a tier is judged by, clipped; internal handles and ids are not among them. */
export function dossierOf(view: unknown): Json {
  const out: Record<string, Json> = {};
  if (!view || typeof view !== 'object') return out;
  const row = view as Record<string, unknown>;
  for (const key of DOSSIER_KEYS) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) out[key] = clip(value, 600);
    else if (Array.isArray(value)) {
      const items = value.map(item => typeof item === 'string' ? item : item && typeof item === 'object' && typeof (item as Record<string, unknown>).text === 'string'
        ? String((item as Record<string, unknown>).text) : item && typeof item === 'object' && typeof (item as Record<string, unknown>).summary === 'string' ? String((item as Record<string, unknown>).summary) : '')
        .filter(Boolean).slice(0, 8).map(item => clip(item, 200));
      if (items.length) out[key] = items;
    }
    else if (value && typeof value === 'object') {
      const inner = value as Record<string, unknown>;
      const text = typeof inner.description === 'string' ? inner.description : typeof inner.summary === 'string' ? inner.summary : typeof inner.text === 'string' ? inner.text : undefined;
      if (text) out[key] = clip(text, 600);
    }
  }
  return out;
}

/** The catalog's weapon records as the profile question reads them. */
export function weaponProfilesOf(catalog: unknown): WeaponProfile[] {
  const rows = catalog && typeof catalog === 'object' ? (catalog as Record<string, unknown>).records ?? (catalog as Record<string, unknown>).entities : undefined;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): WeaponProfile[] => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>, summary = (record.summary ?? {}) as Record<string, unknown>, params = (record.params ?? {}) as Record<string, unknown>;
    const id = typeof record.entity_id === 'string' ? record.entity_id : typeof record.id === 'string' ? record.id : undefined;
    const skill = typeof record.skill === 'string' ? record.skill : typeof summary.skill === 'string' ? summary.skill : typeof params.skill === 'string' ? params.skill : undefined;
    if (!id || !skill) return [];
    const damage = typeof record.damage === 'string' ? record.damage : typeof summary.damage_die === 'string' ? summary.damage_die : typeof params.damage_die === 'string' ? params.damage_die : null;
    const range = typeof record.range === 'number' ? record.range : typeof params.base_range_yards === 'number' ? params.base_range_yards : null;
    return [{id, name: typeof record.name === 'string' && record.name ? record.name : id, skill, damage, range}];
  });
}

/** The pin's `why`, composed by code from the answer and the player's words (§135.28: never a model's sentence). */
export function pinWhy(name: string, band: string, confidence: number, declaration: string): string {
  return composeSentence(`The declared action needs ${name}'s numbers; the host read them as ${band} from who they are (band, confidence ${confidence.toFixed(2)})`, declaration);
}

/** What the Keeper is told on the retried result (system language, Keeper-only). */
export function recoveryNote(field: BandField, name: string, band: string, confidence: number, pinCallId?: string): string {
  return field === 'archetype'
    ? `The host pinned ${name}'s stat block as ${band} before this call ran (band ${BAND_TABLES.archetype}, confidence ${confidence.toFixed(2)}, apply npc under call ${pinCallId ?? '?'}); this result is the retried call. To rule otherwise, settle it with your own apply npc.`
    : `The host read ${name} as the rulebook profile ${band} (band ${BAND_TABLES.weapon}, confidence ${confidence.toFixed(2)}) and this call ran with it. To rule otherwise, send the profile you mean.`;
}

export interface BandAsk {
  env: NodeJS.ProcessEnv;
  campaign: string;
  turn: number;
  declaration: string;
  signal?: AbortSignal;
  /** The provider budget the refused call runs under, when it has one: the band question is charged inside it. */
  parent?: TaskProviderBudget;
}

/** A recovery question (§138.6): the band a refused call needs. */
export type RecoveryQuestion =
  {field: 'archetype'; person: {name: string; dossier: Json}; options: string[]} |
  {field: 'weapon'; thing: {name: string; why?: string; description?: string}; options: string[]; close: string[]; profiles: WeaponProfile[]};
/**
 * A shadow question (§138.8): the band of one effect of a landed model-origin call, asked from the declaration and
 * what settled before the call. The Keeper's number is not part of it: it never reaches the question.
 */
export type ShadowQuestion = {callId: string; index: number; settled: string[]} &
  ({field: 'time'; rows: TimeBandRow[]} | {field: 'damage'; rows: DamageBandRow[]});

/**
 * Ask the band question under its own lease and budget. `undefined` when Jev is not configured (no key): the refusal
 * stands and no row says anything about a question that was never asked. A recovery question answers a `BandResult`,
 * a shadow question a `ShadowResult` (its `kind` names it).
 */
export function askBand(ask: BandAsk, question: RecoveryQuestion): Promise<BandResult | undefined>;
export function askBand(ask: BandAsk, question: ShadowQuestion): Promise<ShadowResult | undefined>;
export async function askBand(ask: BandAsk, question: RecoveryQuestion | ShadowQuestion): Promise<BandResult | ShadowResult | undefined> {
  if (!readJevApiKey(ask.env)) return undefined;
  const began = Date.now(), deadlineAt = Math.min(began + bandJevTimeoutMs(ask.env), ask.parent?.deadlineAt ?? Infinity);
  const outer = ask.signal ?? new AbortController().signal;
  const signal = ask.parent ? AbortSignal.any([outer, ask.parent.signal]) : outer;
  const shadow = question.field === 'time' || question.field === 'damage';
  const family = shadow ? BAND_SHADOW_FAMILY : BAND_RECOVERY_FAMILY;
  const goal = shadow ? `Name the ${question.field} band of the Keeper's landed effect, for the record only` : `Name the ${question.field} band the refused call needs`;
  // One input object serves the lease and the batches: the adapter refuses a batch bound differently from its lease.
  const input: ArchetypeBandInput | WeaponBandInput | ShadowInput = question.field === 'archetype'
    ? {campaign: ask.campaign, turn: ask.turn, declaration: ask.declaration, person: question.person, options: question.options}
    : question.field === 'weapon'
      ? {campaign: ask.campaign, turn: ask.turn, declaration: ask.declaration, thing: question.thing, options: question.options, close: question.close, profiles: question.profiles}
      : {campaign: ask.campaign, turn: ask.turn, declaration: ask.declaration, callId: question.callId, index: question.index, settled: question.settled,
        ...(question.field === 'time' ? {kind: 'time' as const, rows: question.rows} : {kind: 'damage' as const, rows: question.rows})};
  const bindings = shadow ? shadowBindings(input as ShadowInput) : bindingsFor(question.field as BandField, input as ArchetypeBandInput | WeaponBandInput);
  let lease: TaskLease | undefined, accounting: ReturnType<typeof preparationBudget> | undefined;
  try {
    accounting = preparationBudget({
      decision: createDecisionAdapter({env: ask.env, maxConcurrency: 2, retryPolicies: {[family]: {maxRetries: 0, backoffInitialMs: 100, backoffMaxMs: 1_000}}}),
      campaign: ask.campaign, deadlineAt, signal, ...(ask.parent ? {parent: ask.parent} : {}),
      owner: family, goal,
    });
    lease = new TaskLease({owner: family, goal,
      scope: bindings.scope, capabilities: ['decision'], readSet: bindings.readSet, signal,
      budget: {deadlineAt, remainingInputTokens: 100_000, remainingOutputTokens: 10_000, remainingCostUsd: 0.01, remainingActions: 3}});
    if (shadow) return await runBandShadow(input as ShadowInput, accounting.decision, lease);
    const minConfidence = bandMinConfidence(ask.env, question.field as BandField);
    return input.hasOwnProperty('person')
      ? await runArchetypeBand(input as ArchetypeBandInput, accounting.decision, lease, {minConfidence})
      : await runWeaponBand(input as WeaponBandInput, accounting.decision, lease, {minConfidence});
  } catch {
    const usage = {inputTokens: 0, outputTokens: 0, costUsd: 0};
    return shadow
      ? {status: 'failed', kind: question.field as 'time' | 'damage', reason: 'shadow_owner_error', calls: 0, elapsedMs: Date.now() - began, usage}
      : {status: 'fallback', field: question.field as BandField, reason: 'band_owner_error', calls: 0, elapsedMs: Date.now() - began, usage};
  } finally {
    lease?.close();
    accounting?.close();
  }
}
