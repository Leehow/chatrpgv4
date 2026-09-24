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
import {obligationNodes, openGuards, sceneObligations} from '../read/obligations.js';
import {activeMods} from '../read/mods.js';
import {destinationView, guardedWay, unlockGuard} from '../read/destination-rows.js';

export function ordinaryApplyHandlers(context: KernelContext): HandlerGroup {
    return {...fulfillmentHandlers(context), 'table.apply.options': async params => {
        if (Object.keys(params).some(key=>key!=='campaign')) throw new RpcError('invalid_params','Ordinary apply options accept only the bound campaign');
        const campaign=await CampaignSnapshot.open(context,params.campaign);
        if (campaign.meta.status!=='active' || !['open','acting'].includes(campaign.turn.state))
            throw new RpcError('campaign_not_ready','Ordinary apply options require the current open player turn');
        await campaign.preload('view');
        const module=await loadCampaignModule(context,string(campaign.meta.module_id),campaign.world,campaign.id), graph=module.graph;
        const scene=graph.scene(campaign.world.active_scene), where=whereSection(graph,campaign.world,scene,module.material), candidates: Row[]=[];
        // Contract §134.10: a candidate an unsettled stated obligation guards keeps its row and names the guard.
        const guards=openGuards(graph,campaign.world,scene);
        const add=(effect:Row,description:Row,guard?:string)=>candidates.push({alias:`effect:${candidates.length}`,effect,description,...(guard?{guarded_by:guard}:{})});
        for (const clue of cluesHere(graph,campaign.world,scene)) if (clue.discovered!==true)
            add({kind:'clue',clue:clue.name},{kind:'clue',...clue,authority:'authored_candidate_not_discovered'},guards.clues.get(string(graph.find(clue.name,['clue'])?.node_id)));
        const destinations=new Set<string>();
        // §135.30.4: a move row says what the place is, and an unmet unlock names what opens it (the book's own data).
        const conditions=new Map(graph.sceneExits(scene).map(exit=>[string(exit.to),exit.when]));
        for (const exit of [...array(where.exits),...array(where.back)]) {
            if (typeof exit.to!=='string' || destinations.has(exit.to)) continue;
            destinations.add(exit.to);
            const node=graph.find(exit.to,['scene']),unlock=exit.unlock_when;
            const destination=node?destinationView(graph,campaign.world,node,string(exit.display_name||exit.to)):{};
            // §135.30.6 (SL-40): an unmet unlock also says the place and the way to it from here exist.
            const guarded=unlock&&unlock.met===false?{unlock_when:{...unlock,...unlockGuard(graph,campaign.world,conditions.get(exit.to)),...guardedWay(graph,campaign.world,scene)}}:{};
            add({kind:'move',to:exit.to},{kind:'move',...exit,...guarded,...(Object.keys(destination).length?{destination}:{}),authority:'available_route_not_player_choice'},
                guards.exits.get(string(node?.node_id)));
        }
        // Complete and untruncated, bound to the same revision; absent when the scene states none (§134.10).
        const obligations=obligationNodes(graph,scene).length?sceneObligations(graph,campaign.world,scene,{
            receipts:[...(await campaign.files('turns')).flatMap(record=>array(record.receipts)),...array(campaign.turn.receipts)],
            modChecks:(await activeMods(context,campaign.world)).flatMap(mod=>array(mod.contributes.checks).map(check=>({mod:string(mod.id),check})))}):[];
        const session=new SessionView(campaign,graph,campaign.party,campaign.world);
        const promises=await fulfillmentPromiseNavigation(context,campaign);
        return {version:1,candidates,...promises,...(obligations.length?{obligations}:{}),
            revision:jsonDigest({source:module.generation,candidates,promises,...(obligations.length?{obligations}:{})}),
            world_revision:taskWorldRevision(campaign.world,campaign.party,campaign.turn.receipts,campaign.turn.pending_choice),
            context:{scene:graph.displayName(scene),pending_choice:session.pendingChoice()||campaign.turn.pending_choice||null,
                session:session.activeSession(),present:npcsPresent(graph,campaign.world,scene).map(node=>graph.displayName(node)),
                // §135.2: the handouts already handed over, as world state, so no reader offers one again by its words.
                handouts_shown:array(campaign.world.handouts_shown).filter(value=>typeof value==='string'),
                current_receipts:array(campaign.turn.receipts).map(receipt=>Object.fromEntries(
                    ['kind','actor_label','skill','level','passed','outcome','clue','to','from','quantity','delta','currency','before','after']
                        .filter(key=>Object.hasOwn(receipt,key)).map(key=>[key,receipt[key]]))),
                coverage:{effect_families:['clue','move'],other_families:'Use the incumbent owner; no quantity, amount, profile or novel definition is inferred.'}}};
    }};
}
