/** Closed chase data vocabulary and source-defined location/vehicle rules. */
import type { PythonRandom } from '../random.js';
import type { RuleTables } from '../rules/tables.js';
import { isJsonObject } from '../json.js';
import { array, clone, entries, number, repr, row, string, truth, type Row } from '../read/values.js';
import { valueError } from '../resolve/arithmetic.js';
import { VALID_CONDITIONS } from '../combat/engine.js';
export const DEFAULT_GAP = 2;
export const DEFAULT_LOCATION_COUNT = 8;
export const CHASE_SCHEMA_VERSION = 4;
export const SAVE_PATHS = ['save/chase.json'];
export const CLOCK_SAVE_PATHS = SAVE_PATHS;
export const LEVELS: Row = {
    fumble: 0,
    failure: 1,
    regular: 2,
    hard: 3,
    extreme: 4,
    critical: 5
};
export const CHASE_OUTCOMES = [null, 'escaped', 'captured', 'concluded'];
export const CHASE_CONDITIONS = VALID_CONDITIONS;
export const rebaseClock = (state: Row, _delta: number): Row => clone(state);
export const get = (value: Row, key: string, fallback: any): any => Object.hasOwn(value, key) ? value[key] : fallback;
export const int = (value: any): number => Math.trunc(number(value));
export const or = (...values: any[]): any => values.find(truth) ?? values.at(-1);
export interface ChaseSavePort {
    readSave(name: string): Promise<any>;
    writeSave(name: string, value: Row): Promise<void>;
}
/** This engine's amount grammar intentionally retains its existing constant fallback. */
export function rollChaseDice(expression: any, rng: PythonRandom): number {
    const match = /^(\d+)D(\d+)(?:([+-])(\d+))?$/i.exec(string(expression).trim());
    if (!match) {
        if (expression == null || typeof expression === 'string' && !/^[+-]?\d+(?:_\d+)*$/.test(expression.trim()))
            return 0;
        const value = typeof expression === 'string' ? Number(expression.replaceAll('_', '')) : number(expression);
        return Number.isFinite(value) ? Math.trunc(value) : 0;
    }
    let total = 0;
    for (let i = 0; i < Number(match[1]); i++)
        total += rng.randint(1, Number(match[2]));
    if (match[3] === '+')
        total += Number(match[4]);
    else if (match[3] === '-')
        total -= Number(match[4]);
    return total;
}
export function normalizeLocation(input: Row | string, index = 0): Row {
    const raw = typeof input === 'string' ? {
        label: input
    } : input;
    const location: Row = {
        index,
        label: get(raw, 'label', `loc${index}`),
        hazard: raw.hazard ?? null,
        barrier: raw.barrier ?? null
    };
    for (const key of ['kind', 'route_id', 'notes'])
        if (Object.hasOwn(raw, key))
            location[key] = raw[key];
    if (location.barrier != null) {
        const barrier = clone(location.barrier);
        if (!Object.hasOwn(barrier, 'hp_max') && Object.hasOwn(barrier, 'hp'))
            barrier.hp_max = barrier.hp;
        location.barrier = barrier;
    }
    return location;
}
export function generateLocationChain(count = DEFAULT_LOCATION_COUNT, escapeAtEnd = true): Row[] {
    return Array.from({
        length: Math.max(1, count)
    }, (_, index) => normalizeLocation({
        label: index === 0 ? 'start' : escapeAtEnd && index === count - 1 ? 'escape' : `loc${index}`,
        hazard: null,
        barrier: null
    }, index));
}
export async function loadChaseRules(tables: RuleTables): Promise<Row> {
    return await tables.exists('chase') ? row(await tables.load('chase')) : {};
}
export function vehicleStats(rules: Row, vehicle: string): Row {
    let needle = vehicle.trim().toLowerCase();
    needle = get(row(row(rules.vehicles).aliases), needle, needle);
    for (const [key, entry] of entries(row(rules.vehicles).entries))
        if (key.toLowerCase() === needle)
            return {
                vehicle: key,
                ...clone(entry)
            };
    const error = new Error(repr(`unknown vehicle: ${repr(vehicle)}`));
    error.name = 'KeyError';
    throw error;
}
export function vehicleCollision(rules: Row, severity: string, rng: PythonRandom): Row {
    const block = row(rules.vehicular_collisions);
    const tiers = row(block.tiers);
    const resolved = Object.hasOwn(tiers, severity) ? severity : get(block, 'default_severity', 'moderate');
    const tier = row(tiers[resolved]);
    return {
        severity: resolved,
        build_damage: rollChaseDice(get(tier, 'build_damage', '0'), rng),
        passenger_damage: rollChaseDice(get(tier, 'passenger_damage', '0'), rng),
        description: get(tier, 'description', ''),
        rule_ref: 'core.chase.vehicular_collisions'
    };
}
export function participantFromCombatSpec(spec: Row, side: string, position: number): Row {
    return {
        actor_id: spec.actor_id,
        side,
        mov: int(get(spec, 'mov', 8)),
        dex: int(spec.dex),
        con: int(spec.con),
        hp: int(spec.hp_current),
        fight: int(spec.combat_skill),
        dodge: int(spec.dodge_skill),
        build: int(spec.build),
        current_position: position,
        conditions: array(spec.conditions).filter(value => CHASE_CONDITIONS.has(value))
    };
}
export function normalizeParticipantConditions(participant: Row): void {
    const conditions = [...array(participant.conditions)];
    if (int(get(participant, 'hp', 0)) <= 0 && !conditions.includes('unconscious'))
        conditions.push('unconscious');
    participant.conditions = conditions;
}
/** The engine's full read-only outlook, including its existing literal ending cues. */
export function chaseOutlook(snapshot: Row | null): Row | null {
    if (!isJsonObject(snapshot) || !truth(snapshot))
        return null;
    const chain = array(snapshot.location_chain);
    const participants = array(snapshot.participants).filter(isJsonObject);
    const last = chain.length - 1;
    const ahead = (participant: Row) => Math.max(0, last - int(or(participant.position, 0)));
    const quarries = participants.filter(p => p.side === 'quarry');
    const pursuers = participants.filter(p => p.side === 'pursuer');
    const live = quarries.filter(p => !truth(p.escaped) && !truth(p.captured));
    const rounds = array(snapshot.rounds);
    const order = rounds.length && isJsonObject(rounds.at(-1)) ? rounds.at(-1)!.dex_order : [];
    const cursor = int(or(snapshot.initiative_cursor, 0));
    const onTurn = Array.isArray(order) && cursor >= 0 && cursor < order.length ? string(order[cursor]) : null;
    const byId = new Map(participants.map(p => [string(p.actor_id), p]));
    const actor = byId.get(onTurn || '');
    let following: Row | null = null;
    if (actor) {
        const step = int(or(actor.position, 0)) + 1;
        following = step >= 0 && step < chain.length ? chain[step] : null;
    }
    const feature = following === null ? 'end_of_track' : isJsonObject(following.barrier) && int(or(following.barrier.hp, 0)) > 0 ? 'barrier' : isJsonObject(following.hazard) ? 'hazard' : 'clear';
    const gaps = (participant: Row): number[] => live.map(quarry => int(or(quarry.position, 0)) - int(or(participant.position, 0)));
    const nearest = (positions: number[]): number | null => positions.length ? positions.reduce((best, value) => Math.abs(value) < Math.abs(best) ? value : best) : null;
    const endings: string[] = [];
    for (const quarry of quarries) {
        const name = string(quarry.actor_id);
        if (truth(quarry.escaped))
            endings.push(`${name} has escaped -- settle chase:end`);
        else if (truth(quarry.captured))
            endings.push(`${name} has been caught -- settle chase:end`);
        else if (ahead(quarry) === 0)
            endings.push(`${name} is on the last location of the track; its next advance runs clear of the chase and ends it`);
        else
            endings.push(`${name} is ${ahead(quarry)} location(s) from the end of the track, and running past it is an escape`);
    }
    for (const pursuer of pursuers) {
        const name = string(pursuer.actor_id);
        const gap = nearest(gaps(pursuer));
        if (gap === null)
            continue;
        endings.push(gap > 0 ? `${name} is ${gap} location(s) behind the quarry` : `${name} has closed to the quarry's own location; catching it is a chase conflict, which needs a combat defence receipt`);
    }
    if (!chain.some(location => isJsonObject(location) && (truth(location.barrier) || truth(location.hazard))))
        endings.push("no location in this chase's track carries a barrier or a hazard, so chase:barrier and chase:hazard cannot become available on it");
    return {
        chain_length: chain.length,
        on_turn: onTurn,
        next_feature: feature,
        quarries: quarries.map(p => ({
            actor_id: p.actor_id ?? null,
            position: p.position ?? null,
            locations_ahead: ahead(p),
            escaped: truth(p.escaped),
            captured: truth(p.captured)
        })),
        pursuers: pursuers.map(p => ({
            actor_id: p.actor_id ?? null,
            position: p.position ?? null,
            locations_behind_quarry: nearest(gaps(p))
        })),
        ends_when: endings
    };
}
