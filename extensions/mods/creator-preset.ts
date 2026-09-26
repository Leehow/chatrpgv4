/**
 * Contract §138.7 (BR-03): the host names the weapon preset a definition or usage job copies.
 *
 * The kernel offers the rows of the `weapons` band table for a job that takes a preset (`mods.job` with
 * `offer_preset: true` answers `preset_offer` and mints nothing); the host asks Jev the two-level weapon band
 * question of §138.6 over those rows, from the thing's name and description, and mints the job with the profile when
 * the answer clears the gate (`PI_COC_BAND_MIN_CONFIDENCE`), or with no preset otherwise. Below the gate, on `none`,
 * with Jev unavailable or unconfigured, the job is the one it always was. This file is the glue between the offer,
 * the question and the telemetry rows; it holds no kernel client and no Pi types.
 */
import {askBand} from '../kernel/band-recovery.ts';
import type {BandResult, WeaponProfile} from '../../runtime/jev/band-recovery-domain.ts';
import type {TaskProviderBudget} from '../../runtime/jev/provider-budget.ts';

export interface PresetOffer {
  field: 'weapon';
  table: string;
  for: 'define' | 'usage';
  turn: number;
  declaration: string;
  thing: {name: string; why?: string; description?: string};
  options: string[];
  close: string[];
  profiles: WeaponProfile[];
}
/** The host's answer to an offer: the preset to mint with, or why there is none. */
export interface PresetDecision {preset?: {weapon: string; confidence: number}; result?: BandResult; reason: string}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];

/** The kernel's `preset_offer`, when the answer to `mods.job` is one; anything malformed is no offer. */
export function presetOfferOf(job: unknown): PresetOffer | undefined {
  const offer = (job as {preset_offer?: Record<string, any>} | null)?.preset_offer;
  if (!offer || typeof offer !== 'object' || offer.field !== 'weapon' || !['define', 'usage'].includes(offer.for)) return undefined;
  const thing = offer.thing as Record<string, unknown> | undefined, options = strings(offer.options);
  if (!thing || typeof thing.name !== 'string' || !thing.name.trim() || !options.length || !Array.isArray(offer.profiles)) return undefined;
  const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;
  return {field: 'weapon', table: typeof offer.table === 'string' ? offer.table : 'weapons', for: offer.for, turn: Number.isInteger(offer.turn) ? offer.turn : 0,
    declaration: typeof offer.declaration === 'string' ? offer.declaration : '',
    thing: {name: thing.name, ...(text(thing.why) ? {why: text(thing.why)} : {}), ...(text(thing.description) ? {description: text(thing.description)} : {})},
    options, close: strings(offer.close), profiles: offer.profiles as WeaponProfile[]};
}

/** Ask the band question for an offer. Never throws: a failed question is no preset, with its reason. */
export async function choosePreset(offer: PresetOffer, ask: {env: NodeJS.ProcessEnv; campaign: string; signal?: AbortSignal; parent?: TaskProviderBudget}): Promise<PresetDecision> {
  try {
    const result = await askBand({env: ask.env, campaign: ask.campaign, turn: offer.turn, declaration: offer.declaration,
      ...(ask.signal ? {signal: ask.signal} : {}), ...(ask.parent ? {parent: ask.parent} : {})},
      {field: 'weapon', thing: offer.thing, options: offer.options, close: offer.close, profiles: offer.profiles});
    if (!result) return {reason: 'unconfigured'};
    if (result.status !== 'decided') return {result, reason: result.reason};
    return {preset: {weapon: result.band, confidence: result.confidence}, result, reason: 'decided'};
  } catch {
    return {reason: 'band_owner_error'};
  }
}

/**
 * The rows one offer leaves: the §135.28 bind row (`clerk: "creator_preset"`) whenever a question was asked, and one
 * `band-recovery` row always, both naming the job the answer was minted into. No bind row for a question never asked.
 */
export function presetRows(offer: PresetOffer, decision: PresetDecision, job?: string): Record<string, unknown>[] {
  const common = {for: offer.for, name: offer.thing.name, table: offer.table, ...(job ? {job} : {})};
  const result = decision.result;
  if (!result) return [{lane: 'band-recovery', ok: false, reason: decision.reason, ...common}];
  const bindings = [{name: 'weapon', path: 'banded', value: result.status === 'decided' ? result.band : null, table: offer.table,
    ...(result.status !== 'decided' && result.band ? {band: result.band} : {}), confidence: result.confidence ?? null, distribution: result.distribution ?? null,
    ...(result.status === 'decided' && result.family ? {family: result.family} : {})}];
  const cost = {jev_calls: result.calls, jev_ms: result.elapsedMs};
  if (result.status !== 'decided') return [
    {lane: 'run', event: 'bind', clerk: 'creator_preset', outcome: 'keeper', cause: result.reason, bindings, ...cost, ...common},
    {lane: 'band-recovery', ok: false, reason: result.reason, ...(result.confidence === undefined ? {} : {confidence: result.confidence}), ...cost, ...common},
  ];
  return [
    {lane: 'run', event: 'bind', clerk: 'creator_preset', status: 'succeeded', bindings, ...cost, ...common},
    {lane: 'band-recovery', ok: true, reason: 'decided', band: result.band, confidence: result.confidence, ...cost, ...common},
  ];
}
