/** Accepted object weapon usability and ammunition mirrored by combat and chase. */
import { RpcError } from '../errors.js';
import { entries, normalize, row, truth, values, type Row } from '../read/values.js';
export function usableWeapon(world: Row, name: string, ownerId: string): Row | null {
    const instances = row(row(world.objects).instances);
    let item = typeof name === 'string' && Object.hasOwn(instances, name) ? instances[name] : null;
    if (!item) {
        const key = normalize(name), matches = values(instances).filter(value => normalize(value.name) === key);
        if (matches.length > 1)
            throw new RpcError('unknown_entity', 'Object name is ambiguous', { details: { candidates: matches.map(value => value.name) } });
        item = matches[0] ?? null;
    }
    if (truth(item)) {
        if (item.owner.id !== ownerId)
            throw new RpcError('needs', 'The acting person does not carry this object; take it from its current owner/container first');
        if (['jammed', 'broken'].includes(item.state.condition))
            throw new RpcError('needs', 'This weapon is not usable in its current condition', {
                fix: 'resolve objects:repair with the instance name in object and the appropriate repair skill',
            });
    }
    return item;
}
export function syncAmmo(world: Row, participants: Row[], jammed: ReadonlySet<string> = new Set()): void {
    const instances = row(row(world.objects).instances);
    for (const participant of participants)
        for (const [handle, ammo] of entries(participant._ammo)) {
            const item = instances[handle];
            if (truth(item) && item.owner.id === participant.actor_id) {
                item.state.ammo = ammo;
                if (jammed.has(`${participant.actor_id}:${handle}`))
                    item.state.condition = 'jammed';
            }
        }
}
