/** The existing apply-ending guard and staged receipt; final commit stays with apply. */
import type { CampaignWritePort, DomainEvent } from '../transactions.js';
import { RpcError } from '../errors.js';
import { clone, integer, number, row, truth, values, type Row } from '../read/values.js';
import { capsuleForCampaignEnding, pendingSettlements } from './state.js';
export interface EndingStage {
    campaign: CampaignWritePort;
    world: Row;
    turn: Row;
    callId: string;
    ordinal: number;
    mint(base: string): string;
}
export async function stageEnding(context: EndingStage, effect: Row): Promise<{
    receipt: Row;
    event: DomainEvent;
}> {
    const scope = effect.scope;
    if (!['chapter', 'campaign'].includes(scope))
        throw new RpcError('needs', 'choose whether this ends a chapter or the entire campaign', {
            fix: 'set ending.scope to chapter to keep playing, or campaign only for a final campaign conclusion',
            details: {
                reason: 'ending_scope_required',
                options: ['chapter', 'campaign']
            },
        });
    const previous = row(context.world.ending);
    const correcting = (await context.campaign.readCampaign()).status === 'completed';
    const preserve = scope === 'chapter' && (correcting || previous.scope === 'chapter' && !truth(previous.continued));
    let settled = values(context.turn.calls).some(call => ['development:end-session', 'development:settle-ending'].includes(row(call.result).decision) && row(row(call.result).outcome).kind === 'development');
    if (preserve && integer(previous.turn))
        settled = await capsuleForCampaignEnding(context.campaign, number(previous.turn)) !== null;
    if (!settled || (await pendingSettlements(context.campaign)).length)
        throw new RpcError('needs', "settle the chapter's rewards and investigator development before ending the campaign", {
            fix: 'read the source conclusion/rewards with lookup kind=secret scope=module, whose endings say what this book awards and what it asks for first; resolve development:end-session with the source-authored scenario_san_reward_expr when the source declares one, and without it when the source declares none -- an omitted reward settles the ending with no scenario award, a figure you chose does not exist; or development:settle-ending if a settlement is pending; then retry apply ending',
            details: {
                reason: 'ending_settlement_required'
            },
        });
    if (typeof effect.summary !== 'string' || !effect.summary.trim())
        throw new RpcError('invalid_params', 'params.summary must be a non-empty string');
    context.world.ending = preserve ? {
        ...clone(previous),
        scope
    } : {
        summary: effect.summary,
        turn: number(context.turn.turn),
        scope
    };
    if (correcting)
        context.world.ending.reclassified_turn = number(context.turn.turn);
    const receipt = {
        id: context.mint(`session:${scope}-end-t${context.turn.turn}-c${context.ordinal}`),
        kind: 'session',
        family: scope,
        transition: 'end',
        outcome: 'completed',
        summary: context.world.ending.summary,
        call_id: context.callId,
        reclassified: correcting,
        ending_turn: context.world.ending.turn
    };
    return {
        receipt,
        event: {
            type: 'session-changed',
            data: {
                family: scope,
                transition: 'ending',
                ...context.world.ending
            },
            receipt: receipt.id
        }
    };
}
