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
import {array, normalize, row, string, type Row} from '../read/values.js';
import {obligationNodes, openGuards, sceneObligations} from '../read/obligations.js';
import {unstatedDamage} from '../read/stated.js';
import {activeMods} from '../read/mods.js';
import {destinationView, grantingCues, guardedWay, unlockGuard} from '../read/destination-rows.js';

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
        // §135.30.9.2 (SL-52 stage 2): a clue row carries the book's cues for it here -- the affordances of this scene that grant it.
        for (const clue of cluesHere(graph,campaign.world,scene)) if (clue.discovered!==true) {
            const node=graph.find(clue.name,['clue']), cues=node&&scene?grantingCues(scene,string(node.node_id)):[];
            add({kind:'clue',clue:clue.name},{kind:'clue',...clue,...(cues.length?{cues}:{}),authority:'authored_candidate_not_discovered'},guards.clues.get(string(node?.node_id)));
        }
        for(const id of graph.sceneNpcIds(scene)){
            const node=graph.nodes.get(id),handle=node?graph.handle(node):'';
            if(!node||!handle||Object.hasOwn(row(campaign.world.npc_presence),handle))continue;
            const names=new Set([node.name,...array(node.aliases)].filter(value=>typeof value==='string').map(normalize));
            if(Object.keys(row(campaign.world.npc_presence)).some(existing=>{const known=graph.actor(existing);return known&&[known.name,...array(known.aliases)].some(value=>typeof value==='string'&&names.has(normalize(value)));}))continue;
            add({kind:'npc',name:handle,to:graph.handle(scene)},{kind:'source_presence',name:graph.displayName(node),scene:graph.displayName(scene),
                actor:graph.entityView(node),scene_context:scene.summary??'',authority:'authored_initial_presence_not_a_new_arrival'},guards.people.get(id));
        }
        const destinations=new Set<string>();
        // §135.30.4: a move row says what the place is, and an unmet unlock names what opens it (the book's own data).
        const conditions=new Map(graph.sceneExits(scene).map(exit=>[string(exit.to),exit.when]));
        const referenceIds=new Set(array(row(module.meta.reading).materials).filter(material=>material.reference_only===true).flatMap(material=>array(material.node_ids)));
        const referenced=graph.kind('scene').filter(node=>(row(node.properties).source_reference_anchor===true||referenceIds.has(node.node_id))&&node.node_id!==scene.node_id)
            .map(node=>({to:graph.handle(node),display_name:graph.displayName(node),material:module.material?.(node.node_id),source_identity:true}));
        for (const exit of [...array(where.exits),...array(where.back),...referenced]) {
            if (typeof exit.to!=='string' || destinations.has(exit.to)) continue;
            destinations.add(exit.to);
            const node=graph.find(exit.to,['scene']),unlock=exit.unlock_when;
            const destination=node?destinationView(graph,campaign.world,node,string(exit.display_name||exit.to)):{};
            // §135.30.6 (SL-40): an unmet unlock also says the place and the way to it from here exist.
            const guarded=unlock&&unlock.met===false?{unlock_when:{...unlock,...unlockGuard(graph,campaign.world,conditions.get(exit.to)),...guardedWay(graph,campaign.world,scene)}}:{};
            add({kind:'move',to:exit.to},{kind:'move',...exit,...guarded,...(Object.keys(destination).length?{destination}:{}),...(exit.source_identity?{source_context:node?.summary??''}:{}),authority:'available_route_not_player_choice'},
                guards.exits.get(string(node?.node_id)));
        }
        // Complete and untruncated, bound to the same revision; absent when the scene states none (§134.10).
        const obligations=obligationNodes(graph,scene).length?sceneObligations(graph,campaign.world,scene,{
            receipts:[...(await campaign.files('turns')).flatMap(record=>array(record.receipts)),...array(campaign.turn.receipts)],
            modChecks:(await activeMods(context,campaign.world)).flatMap(mod=>array(mod.contributes.checks).map(check=>({mod:string(mod.id),check})))}):[];
        // Contract §138.10: the harm a stated step this turn reached leaves unstated; absent when there is none.
        const unstated=unstatedDamage(graph,array(campaign.turn.receipts));
        const session=new SessionView(campaign,graph,campaign.party,campaign.world);
        const promises=await fulfillmentPromiseNavigation(context,campaign);
        return {version:1,candidates,...promises,...(obligations.length?{obligations}:{}),...(unstated.length?{unstated_damage:unstated}:{}),
            revision:jsonDigest({source:module.generation,candidates,promises,...(obligations.length?{obligations}:{}),...(unstated.length?{unstated_damage:unstated}:{})}),
            world_revision:taskWorldRevision(campaign.world,campaign.party,campaign.turn.receipts,campaign.turn.pending_choice),
            context:{scene:graph.displayName(scene),pending_choice:session.pendingChoice()||campaign.turn.pending_choice||null,
                session:session.activeSession(),present:npcsPresent(graph,campaign.world,scene).map(node=>graph.displayName(node)),
                // §135.2: the handouts already handed over, as world state, so no reader offers one again by its words.
                handouts_shown:array(campaign.world.handouts_shown).filter(value=>typeof value==='string'),
                current_receipts:array(campaign.turn.receipts).map(receipt=>Object.fromEntries(
                    ['kind','actor_label','skill','level','passed','outcome','clue','to','from','quantity','delta','currency','before','after']
                        .filter(key=>Object.hasOwn(receipt,key)).map(key=>[key,receipt[key]]))),
                coverage:{effect_families:['clue','move','source_presence'],other_families:'Use the incumbent owner; no quantity, amount, profile or novel definition is inferred.'}}};
    }};
}
