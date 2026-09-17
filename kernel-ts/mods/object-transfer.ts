/** Shared receipt/event shape for accepted physical object transfers. */
import type {DomainEvent} from '../transactions.js';
import {placeLabel} from '../read/capsule.js';
import {clone, row, string, type Row} from '../read/values.js';

/**
 * What to call an object's owner on a card (§76).
 *
 * An owner row is an identity: `objectOwner` mints it from the graph and `moveObject` stores it and
 * compares a later `from` against it, so its `name` stays the authored one and is never renamed
 * underneath a stored instance. A label is not an identity, and a place's label lives on the world:
 * `world.scene_labels` is what this table calls the place, written the moment the Keeper named it.
 * So the label is resolved here, where the receipt is minted, exactly as `apply move` resolves
 * `from_label`/`to_label` -- the two producers now read the same record for the same handle.
 *
 * A person carries their own name (an investigator sheet, an NPC on the graph) and there is no
 * per-table record to prefer, so for them this is `owner.name` and nothing more.
 */
export const ownerLabel = (world: Row, owner: Row): string =>
    row(owner).kind === 'scene' ? placeLabel(world, string(row(owner).id), string(row(owner).name)) : string(row(owner).name);

export function objectTransferReceipt(input: {world: Row; id: string; callId: string; name: string; owner: Row; source: Row | null; quantity: any; item: Row; definition: Row; why?: any}): {receipt: Row; event: DomainEvent} {
    const receipt: Row = {id: input.id, kind: 'item', name: input.name, label: input.name, subject: input.owner.id, subject_label: ownerLabel(input.world, input.owner),
        quantity: input.quantity, instance: input.item.id, from: input.source ? ownerLabel(input.world, input.source) : null,
        weapon: row(input.definition).category === 'weapon' ? input.item.id : null, call_id: input.callId, why: input.why ?? null, state: clone(input.item.state)};
    return {receipt, event: {type: 'item-transferred', data: {name: input.name, to: input.owner.name, from: input.source?.name ?? null}}};
}
