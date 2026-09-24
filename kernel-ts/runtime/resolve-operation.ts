/** Read-only preparation for the bounded ordinary-check task; settlement stays in table.resolve. */
import type {KernelContext} from '../context.js';
import type {HandlerGroup} from '../handlers.js';
import {RpcError} from '../errors.js';
import {jsonDigest} from '../json.js';
import {CampaignSnapshot, loadCampaignModule} from '../read/campaign.js';
import {SessionView} from '../read/session-view.js';
import {RuleObservations, semanticName} from '../read/rule-facts.js';
import {taskWorldRevision} from '../read/context.js';
import {RuleTables} from '../rules/tables.js';
import {CHARACTERISTICS, SkillResolver} from '../rules/skills.js';
import {RuleGraph} from '../rules/graph.js';
import {array, row, string, number, type Row} from '../read/values.js';
import {npcsPresent} from '../read/capsule.js';
import {npcProfileOf} from '../resolve/context.js';
import {incapacitatedBy} from '../healing/conditions.js';
import {weaponOptions} from '../combat/profiles.js';
import type {ModuleGraph} from '../read/module-graph.js';

/**
 * The first blow (contract §135.30.2, SL-19): outside a fight, the investigator's attack as the combat engine would take
 * it -- the people present it can fight (a stat block, the book's or a pinned archetype's, and not incapacitated) under the
 * identity `capsule.present` gives them, and the investigator's own weapons. One investigator only (the actor a resolve
 * without `actor` defaults to); no target, no row. A read: the kernel still opens the fight on the resolve.
 */
function firstBlow(graph: ModuleGraph, world: Row, party: Row[], session: Row | null): Row | null {
    if (session && (session.kind === 'combat' || session.kind === 'chase') || party.length !== 1) return null;
    const scene = graph.scene(world.active_scene);
    if (!scene) return null;
    const targets = npcsPresent(graph, world, scene).filter(node => {
        const handle = graph.handle(node);
        return npcProfileOf(graph, world, handle) !== null && !incapacitatedBy(row(row(world.npc_resources)[handle]).conditions).length;
    }).map(node => graph.displayName(node));
    return targets.length ? {decision: 'combat:attack', intent: 'combat', actor: string(party[0].name), targets, weapons: weaponOptions(party[0])} : null;
}

export function ordinaryResolveHandlers(context: KernelContext): HandlerGroup {
    return {'table.resolve.options': async params => {
        if (Object.keys(params).some(key => key !== 'campaign')) throw new RpcError('invalid_params', 'Ordinary resolve options accept only the bound campaign');
        const campaign = await CampaignSnapshot.open(context, params.campaign);
        if (campaign.meta.status !== 'active' || !['open', 'acting'].includes(campaign.turn.state))
            throw new RpcError('campaign_not_ready', 'Ordinary resolve options require the current open player turn');
        await campaign.preload('view');
        const module = await loadCampaignModule(context, string(campaign.meta.module_id), campaign.world, campaign.id);
        const sessions = new SessionView(campaign, module.graph, campaign.party, campaign.world);
        const rules = new RuleGraph(await RuleObservations.load(context)), tables = new RuleTables(context), profiles: Row[] = [];
        for (const sheet of campaign.party) {
            const resolver = await SkillResolver.create(tables, sheet);
            for (const skill of resolver.canonicalNames()) {
                let value: number | null = null;
                try { const target = resolver.targetValue(skill); if (Number.isSafeInteger(target) && target >= 0 && target <= 100) value = target; } catch { /* Missing profile values stay unknown. */ }
                // §135.28.1 (SL-40): whether the sheet holds the row -- a skill the sheet lists (whatever its value) or a
                // characteristic -- as against a catalog skill the sheet does not list, whose value is its base chance.
                const held = Object.hasOwn(resolver.sheetSkills, skill) || Object.hasOwn(CHARACTERISTICS, skill);
                profiles.push({alias: `profile:${profiles.length}`, actor: sheet.name, skill,
                    availability: value === null ? 'unknown' : 'bound', value, held});
            }
        }
        const decisions = rules.decisionNodes().map(node => ({name: semanticName(node.node_id), family: rules.familyOf(node.node_id),
            description: node.name ?? null, capability: rules.capabilityOf(node.node_id)}));
        return {version: 1, profiles, decisions, revision: jsonDigest({profiles, graph: rules.graphGeneration}),
            world_revision: taskWorldRevision(campaign.world, campaign.party, campaign.turn.receipts, campaign.turn.pending_choice),
            context: {_binding:{campaign:campaign.id,worldline:string(campaign.meta.active_worldline||'main'),
                    loop:number(row(row(campaign.meta.worldlines)[string(campaign.meta.active_worldline||'main')]).loop),turn:campaign.turn.turn},
                scene: module.graph.displayName(module.graph.scene(campaign.world.active_scene)),
                pending_choice: sessions.pendingChoice() || campaign.turn.pending_choice || null,
                session: sessions.activeSession(), first_blow: firstBlow(module.graph, campaign.world, campaign.party, sessions.activeSession()), conditions: campaign.party.map(sheet => ({actor: sheet.name, conditions: array(sheet.conditions)})),
                current_receipts: array(campaign.turn.receipts).map(receipt => ({kind: receipt.kind, actor: receipt.actor_label ?? null,
                    skill: receipt.skill ?? null, outcome: receipt.outcome ?? null})),
                declared_action: row(campaign.turn.player_input).text ?? campaign.turn.player_text ?? null}};
    }};
}
