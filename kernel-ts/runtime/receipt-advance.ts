/** Bind a typed operation's accepted receipts to its actual world revision change. */
import {RpcError} from '../errors.js';
import type {TurnTransaction} from '../transactions.js';
import {worldRevision, taskWorldRevision} from '../read/context.js';
import {array, row, number, string, type Row} from '../read/values.js';

export async function trackResolveReceipts(transaction: TurnTransaction, enabled: unknown, callId: string): Promise<void> {
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new RpcError('invalid_params', '_task_read_set must be boolean');
    if (enabled !== true) return;
    const {campaign, turn} = transaction, party = await campaign.party() as Row[];
    const before = worldRevision(transaction.world, party, turn.receipts, turn.pending_choice);
    const taskBefore = taskWorldRevision(transaction.world, party, turn.receipts, turn.pending_choice);
    const commitResolve = transaction.commitResolve.bind(transaction);
    transaction.commitResolve = async commit => {
        if (commit.receipts.length) {
            const meta = await campaign.readCampaign(), worldline = string(meta.active_worldline || 'main');
            const world = await campaign.readWorld(), afterParty = await campaign.party() as Row[];
            const receipts = [...array(turn.receipts), ...commit.receipts];
            commit.result._task_advance = {campaign:campaign.id, turn:number(turn.turn), worldline,
                loop:number(row(row(meta.worldlines)[worldline]).loop), operationId:callId,
                receiptIds:commit.receipts.map(receipt=>receipt.id), before,
                after:worldRevision(world, afterParty, receipts, turn.pending_choice), task_before:taskBefore,
                task_after:taskWorldRevision(world, afterParty, receipts, turn.pending_choice)};
        }
        await commitResolve(commit);
    };
}
