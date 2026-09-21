/** Read-only ordinary effect catalog. The existing apply transaction remains the sole effect owner. */
import type {KernelContext} from '../context.js';
import type {HandlerGroup} from '../handlers.js';
import {RpcError} from '../errors.js';
import {jsonDigest} from '../json.js';
import {CampaignSnapshot, loadCampaignModule} from '../read/campaign.js';
import {whereSection, cluesHere, npcsPresent} from '../read/capsule.js';
import {SessionView} from '../read/session-view.js';
import {taskWorldRevision} from '../read/context.js';
import {fulfillmentHandlers, fulfillmentPromiseNavigation} from './fulfillment-options.js';
import {array, string, type Row} from '../read/values.js';

export function ordinaryApplyHandlers(context: KernelContext): HandlerGroup {
    return {...fulfillmentHandlers(context), 'table.apply.options': async params => {
        if (Object.keys(params).some(key=>key!=='campaign')) throw new RpcError('invalid_params','Ordinary apply options accept only the bound campaign');
        const campaign=await CampaignSnapshot.open(context,params.campaign);
        if (campaign.meta.status!=='active' || !['open','acting'].includes(campaign.turn.state))
            throw new RpcError('campaign_not_ready','Ordinary apply options require the current open player turn');
        await campaign.preload('view');
        const module=await loadCampaignModule(context,string(campaign.meta.module_id),campaign.world,campaign.id), graph=module.graph;
        const scene=graph.scene(campaign.world.active_scene), where=whereSection(graph,campaign.world,scene,module.material), candidates: Row[]=[];
        const add=(effect:Row,description:Row)=>candidates.push({alias:`effect:${candidates.length}`,effect,description});
        for (const clue of cluesHere(graph,campaign.world,scene)) if (clue.discovered!==true)
            add({kind:'clue',clue:clue.name},{kind:'clue',...clue,authority:'authored_candidate_not_discovered'});
        const destinations=new Set<string>();
        for (const exit of [...array(where.exits),...array(where.back)]) {
            if (typeof exit.to!=='string' || destinations.has(exit.to)) continue;
            destinations.add(exit.to);
            add({kind:'move',to:exit.to},{kind:'move',...exit,authority:'available_route_not_player_choice'});
        }
        const session=new SessionView(campaign,graph,campaign.party,campaign.world);
        const promises=await fulfillmentPromiseNavigation(context,campaign);
        return {version:1,candidates,...promises,revision:jsonDigest({source:module.generation,candidates,promises}),
            world_revision:taskWorldRevision(campaign.world,campaign.party,campaign.turn.receipts,campaign.turn.pending_choice),
            context:{scene:graph.displayName(scene),pending_choice:session.pendingChoice()||campaign.turn.pending_choice||null,
                session:session.activeSession(),present:npcsPresent(graph,campaign.world,scene).map(node=>graph.displayName(node)),
                current_receipts:array(campaign.turn.receipts).map(receipt=>Object.fromEntries(
                    ['kind','actor_label','skill','level','passed','outcome','clue','to','from','quantity','delta','currency','before','after']
                        .filter(key=>Object.hasOwn(receipt,key)).map(key=>[key,receipt[key]]))),
                coverage:{effect_families:['clue','move'],other_families:'Use the incumbent owner; no quantity, amount, profile or novel definition is inferred.'}}};
    }};
}
