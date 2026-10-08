/**
 * Contract §138.8 (BR-04 of docs/specs/band-then-roll.md, decision D9): the shadow lane for the Keeper's own `time`
 * and `damage` numbers.
 *
 * After a model-origin `apply` lands a `time {minutes}` or a `damage {dice}` (no `stated`, no `band`), the host asks
 * Jev, in the background, the band question the clerk would ask for that effect, and writes one `lane: "band-shadow"`
 * row beside the Keeper's number: the band, its range, whether the Keeper's number fell inside it, the distribution
 * and the Jev time. It executes nothing, changes no receipt, no card and no prose, and never holds the turn. The rows
 * are the evidence the owner rules on (spec Further Notes) and the calibration of BR-06's gates.
 *
 * This file is the glue that holds no Pi types and no kernel client: which effects are asked about, the gate the
 * report reads, the row. The extension schedules it after the tool result exists and owns the kernel read of the rows.
 */
import {BAND_SHADOW_DEFAULT_GATE, type DamageBandRow, type ShadowKind, type ShadowResult, type TimeBandRow} from '../../runtime/jev/band-shadow-domain.ts';

export const SHADOW_TABLES: Readonly<Record<ShadowKind, string>> = Object.freeze({time: 'time-costs', damage: 'hazards'});

export interface ShadowTarget {index: number; kind: ShadowKind; keeperValue: number | string}

/**
 * The effects of a landed `apply` the shadow asks about: a `time` with the Keeper's own `minutes`, a `damage` with the
 * Keeper's own `dice`. Nothing for a host-origin call (a clerk's write carries its own bind row), nothing for a
 * `stated` or a `band` effect (the number is the book's or the kernel's roll, not the Keeper's).
 */
export function shadowTargets(tool: string, payload: Record<string, unknown>, hostOrigin: unknown): ShadowTarget[] {
  if (tool !== 'apply' || hostOrigin !== undefined || !Array.isArray(payload.effects)) return [];
  return (payload.effects as unknown[]).flatMap((value, index): ShadowTarget[] => {
    if (!value || typeof value !== 'object') return [];
    const effect = value as Record<string, unknown>;
    if (effect.stated != null || effect.band != null) return [];
    if (effect.kind === 'time' && typeof effect.minutes === 'number' && Number.isFinite(effect.minutes))
      return [{index, kind: 'time', keeperValue: effect.minutes}];
    if (effect.kind === 'damage' && typeof effect.dice === 'string' && effect.dice.trim())
      return [{index, kind: 'damage', keeperValue: effect.dice}];
    return [];
  });
}

/** The gate the report compares confidences with, `PI_COC_BAND_MIN_CONFIDENCE` in (0, 1]: recorded, never applied. */
export function bandShadowGate(env: NodeJS.ProcessEnv): number {
  const value = Number(env.PI_COC_BAND_MIN_CONFIDENCE?.trim() || NaN);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : BAND_SHADOW_DEFAULT_GATE;
}

/** Two dice expressions are the same when they read the same with case and spacing ignored (`1d6` is `1D6`). */
export function sameDice(left: string, right: string): boolean {
  return left.replace(/\s+/g, '').toUpperCase() === right.replace(/\s+/g, '').toUpperCase();
}

type BandRows = {kind: 'time'; rows: TimeBandRow[]} | {kind: 'damage'; rows: DamageBandRow[]};

/** The band's range as the row supplies it: `{min, max}` minutes for time, the rung's dice for damage. */
export function bandRange(rows: BandRows, band: string): {min: number; max: number} | string | null {
  if (rows.kind === 'time') {
    const row = rows.rows.find(item => item.handle === band);
    return row ? {min: row.min, max: row.max} : null;
  }
  return rows.rows.find(item => item.handle === band)?.dice ?? null;
}

/** Whether the Keeper's number fell inside the band: minutes within `[min, max]`; dice equal to the rung's. */
export function insideBand(target: ShadowTarget, range: {min: number; max: number} | string | null): boolean | null {
  if (range === null) return null;
  if (target.kind === 'time' && typeof range === 'object' && typeof target.keeperValue === 'number')
    return target.keeperValue >= range.min && target.keeperValue <= range.max;
  if (target.kind === 'damage' && typeof range === 'string' && typeof target.keeperValue === 'string')
    return sameDice(target.keeperValue, range);
  return null;
}

/**
 * The one `lane: "band-shadow"` row for an asked effect (§138.8). `ok` says whether Jev answered; a row whose argmax
 * is the `unknown` exit is answered with no band. Below-gate answers are written like every other: the report needs them.
 */
export function shadowRow(target: ShadowTarget, at: {turn: number; callId: string}, rows: BandRows, result: ShadowResult, gate: number): Record<string, unknown> {
  const common = {lane: 'band-shadow', turn: at.turn, call_id: at.callId, index: target.index, kind: target.kind,
    table: SHADOW_TABLES[target.kind], keeper_value: target.keeperValue};
  if (result.status !== 'answered')
    return {...common, ok: false, reason: result.reason, band: null, range: null, inside: null, confidence: null, distribution: null,
      gate, ms: result.elapsedMs, jev_calls: result.calls};
  const range = result.band === null ? null : bandRange(rows, result.band);
  return {...common, ok: true, ...(result.band === null ? {reason: 'unknown'} : {}), band: result.band, range, inside: insideBand(target, range),
    confidence: result.confidence, distribution: result.distribution, ...(result.score === undefined ? {} : {score: result.score}),
    gate, ms: result.elapsedMs, jev_calls: result.calls};
}

/**
 * The row of an effect the shadow could not ask about because the kernel could not list the rows: a failure, with its
 * reason and nothing else.
 */
export function unaskedRow(target: ShadowTarget, at: {turn: number; callId: string}, reason: string): Record<string, unknown> {
  return {lane: 'band-shadow', turn: at.turn, call_id: at.callId, index: target.index, kind: target.kind, ok: false, reason};
}

/**
 * The row of an effect the shadow deliberately did not ask about -- no Jev key (`unconfigured`), no player text
 * (`no_declaration`). Not a failure: the project's skip convention (`ok: true, skipped`, as the admission lane writes),
 * so a table without a key does not read as a failing lane in the kpi.
 */
export function skippedRow(target: ShadowTarget, at: {turn: number; callId: string}, skipped: string): Record<string, unknown> {
  return {lane: 'band-shadow', turn: at.turn, call_id: at.callId, index: target.index, kind: target.kind, ok: true, skipped};
}

/** The rows `rules.bands` answered, in the shape the question reads; anything malformed is dropped rather than guessed. */
export function readBandRows(kind: ShadowKind, answer: unknown): BandRows | undefined {
  const rows = answer && typeof answer === 'object' && Array.isArray((answer as Record<string, unknown>).rows) ? (answer as {rows: unknown[]}).rows : undefined;
  if (!rows) return undefined;
  if (kind === 'time') {
    const parsed = rows.flatMap((value): TimeBandRow[] => {
      const row = value as Record<string, unknown> | null;
      if (!row || typeof row.handle !== 'string' || !Number.isInteger(row.min) || !Number.isInteger(row.max)) return [];
      // §202.1: what act the row covers rides to the question; a blank one is left out, never invented.
      return [{handle: row.handle, min: Number(row.min), max: Number(row.max), ...(Number.isInteger(row.default) ? {default: Number(row.default)} : {}),
        ...(typeof row.covers === 'string' && row.covers.trim() ? {covers: row.covers.trim()} : {})}];
    });
    return parsed.length ? {kind, rows: parsed} : undefined;
  }
  const parsed = rows.flatMap((value): DamageBandRow[] => {
    const row = value as Record<string, unknown> | null;
    if (!row || typeof row.handle !== 'string' || typeof row.dice !== 'string' || !row.dice.trim()) return [];
    return [{handle: row.handle, dice: row.dice, ...(typeof row.note === 'string' && row.note.trim() ? {note: row.note} : {})}];
  });
  return parsed.length ? {kind, rows: parsed} : undefined;
}
