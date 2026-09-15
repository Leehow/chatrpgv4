/** Shared receipt/event shape for accepted physical object transfers. */
import type {DomainEvent} from '../transactions.js';
import {clone, row, type Row} from '../read/values.js';

export function objectTransferReceipt(input: {id: string; callId: string; name: string; owner: Row; source: Row | null; quantity: any; item: Row; definition: Row; why?: any}): {receipt: Row; event: DomainEvent} {
    const receipt: Row = {id: input.id, kind: 'item', name: input.name, label: input.name, subject: input.owner.id, subject_label: input.owner.name,
        quantity: input.quantity, instance: input.item.id, from: input.source?.name ?? null,
        weapon: row(input.definition).category === 'weapon' ? input.item.id : null, call_id: input.callId, why: input.why ?? null, state: clone(input.item.state)};
    return {receipt, event: {type: 'item-transferred', data: {name: input.name, to: input.owner.name, from: receipt.from}}};
}
