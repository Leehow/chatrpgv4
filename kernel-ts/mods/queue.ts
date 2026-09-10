/** Registration the Keeper asked for and delivery did not wait on; pure marker reads and writes. */
import { isJsonObject, jsonDigest } from '../json.js';
import { normalize, row, string, truth, values, type Row } from '../read/values.js';

const key = (name: string, category: string): string => jsonDigest([normalize(name), category]);

/** Every mod's queue in one list; the reader never needs to know which package owns an entry. */
export function queuedRegistrations(world: Row): Row[] {
    return values(row(row(world.mods).state)).flatMap(state => isJsonObject(state) ? values(row(state.queued)) : []);
}

export function queuedDefinition(world: Row, name: any, category?: string): Row | null {
    if (typeof name !== 'string' || !name.trim()) return null;
    return queuedRegistrations(world).find(entry => normalize(string(entry.name)) === normalize(name)
        && (category === undefined || entry.category === category)) ?? null;
}

function bag(world: Row, mod: string): Row {
    const state = row(row(world.mods).state);
    if (!isJsonObject(state[mod])) state[mod] = {};
    const own = row(state[mod]);
    if (!isJsonObject(own.queued)) own.queued = {};
    return row(own.queued);
}

export function queueRegistration(world: Row, mod: string, entry: Row): void {
    bag(world, mod)[key(string(entry.name), string(entry.category))] = entry;
}

/**
 * The adopt arrives in a later call than its definition, so the row it claims is recorded then. The
 * whole effect is kept, not just the row name: it can carry a document seed, a quantity or a causal
 * why, and the resume replays it down the ordinary staging path rather than reimplementing adoption.
 */
export function queueAdoption(world: Row, name: string, category: string, effect: Row): boolean {
    const id = key(name, category);
    for (const state of values(row(row(world.mods).state))) {
        if (!isJsonObject(state)) continue;
        const own = row(state.queued), entry = own[id];
        if (!isJsonObject(entry)) continue;
        own[id] = {...entry, adopt: string(effect.adopt), owner: string(effect.to), object: effect};
        return true;
    }
    return false;
}

export function clearRegistration(world: Row, mod: string, name: string, category: string): void {
    delete bag(world, mod)[key(name, category)];
}

/**
 * An equipment row whose registration is already queued is accounted for, so it must not be offered
 * to the Keeper or demanded by the audit a second time. Only a claimed row is hidden: between the
 * define call and the adopt that names the row, the sheet still reads as unregistered, which is what
 * it is -- the definition's name is the Keeper's own wording and need not match the authored row.
 */
export function claimedEquipment(world: Row): Set<string> {
    return new Set(queuedRegistrations(world).filter(entry => truth(entry.adopt)).map(entry => normalize(string(entry.adopt))));
}
