/**
 * Contract §143.9: who cannot flee, and what the flight itself ends, read from the ruleset's combat table
 * (`combat.json` `flee`) and matched against a combat participant in one place.
 *
 * Two readers need the same answer: the engine's `resolveFlee`, which refuses a flight the list blocks, and the session
 * view, which does not issue `combat:flee` to that person. A second copy of the matching would let the view offer a
 * flight the engine then refuses. It is a leaf (the value helpers only) so the synchronous view can read it without
 * pulling the engine in.
 */
import { array, row, string, type Row } from '../read/values.js';

export interface FleeRules {
    /** The states that keep a person from fleeing (`flee_blocked_by`). */
    blockedBy: string[];
    /** The states the flight itself ends (`flee_clears`): a prone person stands up and then runs (Keeper Rulebook p.127). */
    clears: string[];
}

export const NO_FLEE_RULES: FleeRules = Object.freeze({ blockedBy: [], clears: [] }) as FleeRules;

/** The `flee` block of the ruleset's `combat.json`, read as the engine and the view both read it. */
export function fleeRules(combatTable: unknown): FleeRules {
    const flee = row(row(combatTable).flee);
    return { blockedBy: array(flee.flee_blocked_by).map(string), clears: array(flee.flee_clears).map(string) };
}

/** The listed states a participant carries: their conditions, then the names of their active effects, each once. */
export function fleeBlockers(participant: Row, rules: FleeRules): string[] {
    const carried = [...array(participant.conditions).map(string), ...array(participant.active_effects).map(effect => string(row(effect).effect))];
    return [...new Set(carried.filter(state => rules.blockedBy.includes(state)))];
}
