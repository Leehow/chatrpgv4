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
import {array, row, string, number, clone, values, type Row} from '../read/values.js';
import {projectSheet} from '../mods/projection.js';
import {npcsPresent} from '../read/capsule.js';
import {npcProfileOf} from '../resolve/context.js';
import {incapacitatedBy} from '../healing/conditions.js';
import {participantGaps, weaponOptions} from '../combat/profiles.js';
import {VALID_OUTCOMES} from '../combat/engine.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {checkCatalog} from './check-catalog.js';
import {committedOnLine, lastExchange} from '../read/exchange.js';

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
    const people = npcsPresent(graph, world, scene).filter(node => {
        const handle = graph.handle(node);
        return !incapacitatedBy(row(row(world.npc_resources)[handle]).conditions).length;
    });
    const targets = people.map(node => graph.displayName(node)), sheet = clone(party[0]);
    projectSheet(world, sheet);
    const ready = weaponOptions(sheet), owned = values(row(row(world.objects).instances)).filter(item => item.owner.id === sheet.id).map(item => string(item.name));
    const inventory = array(sheet.equipment).map(item => typeof item === 'string' ? item : string(row(item).name)).filter(Boolean);
    const weapons = [...new Set([...ready, ...owned, ...inventory])];
    // §180.6 (CK-F2 review follow-up): a target the fight cannot read -- no block, or one lacking any of STR, SIZ, DEX or
    // CON (a fight never reads MOV) -- is prepared first, and the row says which completion it takes: a person an
    // archetype, a creature a rules-catalog creature. Otherwise the chosen first attack would be refused at dispatch.
    const unready = people.filter(node => {
        const profile = npcProfileOf(graph, world, graph.handle(node));
        return profile === null || participantGaps(profile).length > 0;
    });
    return targets.length ? {decision: 'combat:attack', intent: 'combat', actor: string(sheet.name), targets, weapons,
        preparation: {targets: unready.map(node => graph.displayName(node)),
            completions: Object.fromEntries(unready.map(node => [graph.displayName(node), graph.isPerson(node) ? 'archetype' : 'creature'])),
            weapons: weapons.filter(name => !ready.includes(name))}} : null;
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
            description: node.name ?? null, capability: rules.capabilityOf(node.node_id),
            guidance: [...rules.nodes.values()].filter(rule => rule.node_kind === 'rule' && rules.familyOf(rule.node_id) === rules.familyOf(node.node_id))
                .map(rule => ({text: rule.name, source_refs: rules.sourceRefsFor([rule.node_id])}))}));
        campaign.records = await campaign.files('turns');
        const history = committedOnLine(campaign), publicText = typeof history.previous?.rendered_text === 'string' ? history.previous.rendered_text : '';
        const openingAttack = firstBlow(module.graph, campaign.world, campaign.party, sessions.activeSession());
        const phases = Object.fromEntries(rules.decisionNodes().map(node => [semanticName(node.node_id), string(row(row(node.properties).implementation).phase)]));
        const selection = await checkCatalog(campaign, module.graph, sessions, profiles, decisions, {phases, openingAttack, history: history.records, publicText});
        const activeSession = sessions.activeSession();
        return {version: 1, profiles, decisions, selection, revision: jsonDigest({profiles, graph: rules.graphGeneration, selection}),
            world_revision: taskWorldRevision(campaign.world, campaign.party, campaign.turn.receipts, campaign.turn.pending_choice),
            context: {_binding:{campaign:campaign.id,worldline:string(campaign.meta.active_worldline||'main'),
                    loop:number(row(row(campaign.meta.worldlines)[string(campaign.meta.active_worldline||'main')]).loop),turn:campaign.turn.turn},
                scene: module.graph.displayName(module.graph.scene(campaign.world.active_scene)),
                public_exchange: await lastExchange(campaign, module.graph),
                public_narration: {text: publicText.slice(-4000), truncated: publicText.length > 4000},
                pending_choice: sessions.pendingChoice() || campaign.turn.pending_choice || null,
                session: activeSession, first_blow: openingAttack, conditions: campaign.party.map(sheet => ({actor: sheet.name, conditions: array(sheet.conditions)})),
                ...(activeSession?.kind === 'combat' ? {combat_outcomes: [...VALID_OUTCOMES].filter(value => value !== null).sort()} : {}),
                current_receipts: array(campaign.turn.receipts).map(receipt => ({kind: receipt.kind, actor: receipt.actor_label ?? null,
                    scene_change: receipt.kind === 'move' && receipt.from !== receipt.to,
                    skill: receipt.skill ?? null, outcome: receipt.outcome ?? row(receipt.check).outcome ?? receipt.level ?? null,
                    goal: row(receipt.check).goal ?? null, passed: receipt.passed ?? row(receipt.check).passed ?? null,
                    decision: typeof row(receipt.check).decision === 'string' ? semanticName(row(receipt.check).decision) : null,
                    rule: row(receipt.basis).rule ?? null})),
                declared_action: row(campaign.turn.player_input).text ?? campaign.turn.player_text ?? null}};
    }};
}
