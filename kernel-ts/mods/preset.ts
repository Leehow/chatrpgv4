/**
 * Contract §138.7 (BR-03 of docs/specs/band-then-roll.md): the weapon preset a definition or usage job copies.
 *
 * A weapon definition's numbers, and a usage's, were the creator child's own, with the whole weapons table handed
 * over as "evidence": two revolvers defined by two children fired differently. Now the host names one row of the
 * `weapons` band table before the job is minted (the two-level band question of §138.6), the kernel writes that row
 * into the packet as `request.preset`, projected onto the definition's parameter shape, and the creator copies it field
 * for field. A departure is the creator's to state, one field at a time, in the result's `deviations`; this module is
 * the deterministic gate that refuses a departure it did not state and a statement that departs from nothing. It
 * checks the accounting, never the content: a stated reason is not judged for truth.
 *
 * Pure: no I/O. `jobs.ts` offers, mints and accepts; `check.ts` runs the same gate for the child's repair round.
 */
import { RpcError } from '../errors.js';
import { isJsonObject, PythonFloat } from '../json.js';
import { clone, integer, normalize, number, row, string, type Row } from '../read/values.js';
import { parseUsesPerRound } from '../combat/catalog.js';
import { weaponBandOptions, weaponRowNamed, type WeaponBandProfile } from '../rules/bands.js';
import { definitionExpression } from './definition.js';

/** The capability a materializer declares to take a preset; a package without it is offered none and gated by nothing. */
export const WEAPON_PRESET_CAPABILITY = 'weapons.preset.v1';
/** The band table a preset is a row of (§138.2, `item.weapon`). */
export const PRESET_TABLE = 'weapons';
/** The weapon parameters a preset states, in the definition's own names. */
export const PRESET_FIELDS: readonly string[] = Object.freeze(['skill', 'damage', 'adds_damage_bonus', 'base_range_yards', 'uses_per_round', 'magazine', 'malfunction', 'impale']);
const MAX_REASON = 600;

const numeric = (value: unknown): boolean => typeof value === 'number' || typeof value === 'bigint' || value instanceof PythonFloat;
const within = (value: unknown, low: number, high: number): boolean => integer(value) && number(value) >= low && number(value) <= high;

/**
 * A weapons-table row projected onto the definition's parameter shape, the way the combat engine reads the row.
 * A field the row cannot state in that shape is left out -- an empty damage die, a `uses_per_round` of full auto only or
 * one use every few rounds (the definition holds a positive integer) -- and the creator decides it as before.
 */
export function presetParameters(entry: Row): Row {
    const out: Row = {};
    if (typeof entry.skill === 'string' && entry.skill.trim()) out.skill = entry.skill.trim();
    if (typeof entry.damage_die === 'string' && entry.damage_die.trim()) {
        try { out.damage = definitionExpression(entry.damage_die.trim(), 'damage'); }
        catch (error) { if (!(error instanceof RpcError)) throw error; }
    }
    if (typeof entry.adds_damage_bonus === 'boolean') out.adds_damage_bonus = entry.adds_damage_bonus;
    if (entry.base_range_yards == null) out.base_range_yards = null;
    else if (numeric(entry.base_range_yards) && number(entry.base_range_yards) >= 0 && number(entry.base_range_yards) <= 100000) out.base_range_yards = clone(entry.base_range_yards);
    const uses = parseUsesPerRound(entry.uses_per_round == null ? null : string(entry.uses_per_round));
    if (uses.rounds_per_use === 1 && within(uses.max_shots, 1, 100)) out.uses_per_round = uses.max_shots;
    if (entry.magazine == null) out.magazine = null;
    else if (within(entry.magazine, 1, 1000)) out.magazine = number(entry.magazine);
    if (entry.malfunction == null) out.malfunction = null;
    else if (within(entry.malfunction, 1, 100)) out.malfunction = number(entry.malfunction);
    if (typeof entry.impales === 'boolean') out.impale = entry.impales;
    return out;
}

/** What the host needs to ask the band question for a job before it is minted (§138.7 `preset_offer`). */
export function presetOffer(table: Row, era: string, thing: {name: string; description?: string; why?: string}):
    {options: string[]; close: string[]; profiles: WeaponBandProfile[]} {
    return weaponBandOptions(Object.entries(table), era, thing.name);
}

/** A definition's `template` that names a weapons row: the Keeper named its evidence, and no band question is asked. */
export function templateProfile(table: Row, template: unknown): Row | null {
    return typeof template === 'string' && template.trim() ? weaponRowNamed(Object.entries(table), template) : null;
}

/** The host's choice checked against the offered rows, as the packet's `request.preset`. */
export function presetBlock(table: Row, options: readonly string[], choice: unknown): Row {
    const refuse = (): never => { throw new RpcError('invalid_params', 'A job preset names one offered weapons profile and the confidence it was chosen with', {
        fix: 'send preset {weapon, confidence} with weapon one of details.options, or send no preset', details: {reason: 'preset_unknown', field: 'preset', options: [...options]}}); };
    if (!isJsonObject(choice) || Object.keys(choice).some(key => !['weapon', 'confidence'].includes(key))) return refuse();
    const id = choice.weapon, confidence = choice.confidence;
    if (typeof id !== 'string' || !options.includes(id) || !isJsonObject(table[id]) || !numeric(confidence) || !(number(confidence) >= 0 && number(confidence) <= 1)) return refuse();
    const entry = row(table[id]);
    return {table: PRESET_TABLE, id, name: string(entry.display_name || id), confidence: clone(confidence), parameters: presetParameters(entry), profile: clone(entry)};
}

/** The preset a retained or current packet carries, or null. */
export function presetOf(request: Row): Row | null {
    const preset = request.preset;
    return isJsonObject(preset) && typeof preset.id === 'string' && isJsonObject(preset.parameters) ? preset : null;
}

/** What an accepted definition's or usage's provenance records of its preset: the row and the answer, never the numbers again. */
export function presetStamp(preset: Row): Row {
    return {table: string(preset.table || PRESET_TABLE), id: string(preset.id), confidence: clone(preset.confidence ?? null)};
}

/**
 * `deviations` off a draft: the departures the creator stated, and the draft the ordinary validator reads (which
 * knows no such field). Only called for a packet that carries a preset; without one a `deviations` field is an unknown
 * definition field exactly as before.
 */
export function takeDeviations(raw: unknown): {draft: unknown; deviations: Row[]} {
    if (!isJsonObject(raw) || !Object.hasOwn(raw, 'deviations')) return {draft: raw, deviations: []};
    const {deviations, ...draft} = raw;
    const fields = new Set<string>();
    const shaped = Array.isArray(deviations) && deviations.length <= PRESET_FIELDS.length && deviations.every(item => {
        if (!isJsonObject(item) || Object.keys(item).length !== 2 || typeof item.field !== 'string' || !PRESET_FIELDS.includes(item.field)
            || fields.has(item.field) || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > MAX_REASON) return false;
        fields.add(item.field);
        return true;
    });
    if (!shaped) throw new RpcError('invalid_params', 'deviations must be a list of {field, reason}, at most one per weapon parameter of the preset', {
        fix: `name each departing field once, one of ${PRESET_FIELDS.join(', ')}, with the physical fact that contradicts the preset as its reason (at most ${MAX_REASON} characters)`,
        details: {reason: 'preset_deviation_shape', fields: [...PRESET_FIELDS]}});
    return {draft, deviations: (deviations as Row[]).map(item => ({field: item.field, reason: item.reason}))};
}

function same(field: string, value: unknown, stated: unknown): boolean {
    if (field === 'skill') return typeof value === 'string' && normalize(value) === normalize(stated);
    if (field === 'damage') return typeof value === 'string' && value.replace(/\s+/g, '').toUpperCase() === string(stated).toUpperCase();
    if (typeof stated === 'boolean') return value === stated;
    // `base_range_yards`, `magazine` and `malfunction` read absent as null, as the definition validator does.
    if (stated == null) return value == null;
    return numeric(value) && number(value) === number(stated);
}

/**
 * The gate: every weapon parameter the preset states and the draft departs from must be listed in `deviations`, and
 * every listed field must be one the preset states and the draft departs from. Findings in the order of the fields.
 */
export function presetFindings(parameters: Row, preset: Row, deviations: readonly Row[]): Row[] {
    const stated = row(preset.parameters), listed = new Set(deviations.map(item => string(item.field))), findings: Row[] = [];
    for (const field of PRESET_FIELDS) {
        if (!Object.hasOwn(stated, field)) continue;
        const departs = !same(field, parameters[field], stated[field]);
        if (departs && !listed.has(field)) findings.push({code: 'preset_deviation', field, preset: clone(stated[field]), value: clone(parameters[field] ?? null)});
        if (!departs && listed.has(field)) findings.push({code: 'preset_deviation_unfounded', field, preset: clone(stated[field]), value: clone(parameters[field] ?? null)});
    }
    for (const field of listed)
        if (!Object.hasOwn(stated, field)) findings.push({code: 'preset_deviation_unfounded', field, preset: null, value: clone(parameters[field] ?? null)});
    return findings;
}

/** Refuse a draft the gate found against, naming every field at once so one repair round can fix them all. */
export function refusePresetFindings(findings: readonly Row[], preset: Row): void {
    if (!findings.length) return;
    const departed = findings.filter(item => item.code === 'preset_deviation').map(item => string(item.field));
    const unfounded = findings.filter(item => item.code === 'preset_deviation_unfounded').map(item => string(item.field));
    const parts = [
        ...(departed.length ? [`weapon parameters depart from the preset ${string(preset.id)} without a stated contradiction: ${departed.join(', ')}`] : []),
        ...(unfounded.length ? [`deviations name parameters that do not depart from a value the preset states: ${unfounded.join(', ')}`] : []),
    ];
    throw new RpcError('invalid_params', parts.join('; '), {
        fix: 'copy each field named in details.findings from request.preset.parameters; keep a value that departs only where the description '
            + 'states a physical fact that contradicts the preset, and then list it in deviations as {field, reason}; remove a deviations entry whose field equals the preset',
        details: {reason: string(findings[0].code), preset: string(preset.id), findings: findings.map(item => clone(item))}});
}

/**
 * A draft checked against its packet's preset: `deviations` taken off, the draft validated by the ordinary validator,
 * then the gate over the validated parameters (a draft that is not even a valid definition is refused for that first).
 * Without a preset this is the ordinary validator, byte for byte.
 */
export async function gatePreset(raw: unknown, preset: Row | null, validate: (draft: unknown) => Row | Promise<Row>): Promise<{value: Row; deviations: Row[] | null}> {
    if (!preset) return {value: await validate(raw), deviations: null};
    const {draft, deviations} = takeDeviations(raw);
    const value = await validate(draft);
    // A draft that answered with the unsupported-capability refusal never reaches here: the validator threw it.
    refusePresetFindings(presetFindings(row(value.parameters), preset, deviations), preset);
    return {value, deviations};
}
