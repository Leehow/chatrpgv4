/** One structural establishment rule shared by tool schema, host preflight and staged apply. */
export const MOVE_ESTABLISHMENT_DEPENDENCIES = {establish: ['via']};
export function moveEstablishmentRefusal(effects: unknown) {
    if (!Array.isArray(effects)) return;
    for (const [index, effect] of effects.entries()) {
        if (effect?.kind !== 'move' || effect.establish === undefined) continue;
        if (typeof effect.via === 'string' && effect.via.trim()) continue;
        return {code: 'invalid_params' as const, message: 'Establishing a destination requires via to describe the route',
            fix: 'Supply the route in via for this same destination, or remove establish when moving to an existing place. No effect in this batch landed.',
            details: {reason: 'move_route_missing', field: `effects[${index}].via`, recovery: 'repair_arguments'}};
    }
}
