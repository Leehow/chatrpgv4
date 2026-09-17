/** Action routing, card selection and the existing action-to-slot contract. */
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { RESOLVER_NAMES } from '../capabilities.js';
import { actor as findActor } from '../read/handlers.js';
import { SessionView, active, boutActive, defenseOptions } from '../read/session-view.js';
import { semanticName } from '../read/rule-facts.js';
import { array, entries, equal, integer, kebab, normalize, normalizeText, number, repr, row, string, truth, type Row } from '../read/values.js';
import { RuleGraph } from '../rules/graph.js';
import { CHARACTERISTICS, SkillResolver } from '../rules/skills.js';
import { noAvailableDecision, selectAvailableDecision, throwPlanningFailure } from '../rules/planning.js';
import { campaignEffectiveOptionalRules, disabledDecisionGates, OptionalRuleError } from '../rules/options.js';
import { APPROACH_BY_SKILL, SOCIAL_APPROACH_SKILLS } from './arithmetic.js';
import { SettleContext, latestCheckReceipt, recordSkillTicks } from './context.js';
import { BASIC_DECISIONS, COMBINED, LUCK, LUCK_ROLL, OBSERVE, OPPOSED, ORDINARY, PUSH, REALIZE, SOCIAL, psychologyBinding, psychologyRealizeBinding, socialBinding } from './bindings.js';
import { settleBasic, settleFamily } from './settlement.js';
import { familyBinding, type FixedFamilies } from './families.js';
import {parseSanLoss} from '../sanity/expression.js';
import {knownSpells,readMagicState} from '../magic/state.js';
import {magicLearningSources} from '../magic/facts.js';
import {presentOpponents} from '../chase/bindings.js';
import { shapeSettlement, tagNpcReceipts } from './projection.js';
/**
 * The decisions whose roll carries `action.modifiers.bonus_dice` / `penalty_dice` (§95).
 *
 * The keeper's declaration used to be validated at the entry and then quietly dropped by every
 * decision outside the ordinary check, so a fight, a contest or a combined check rolled plain while
 * the tool reported success -- nine tables and 280 roll receipts produced not one keeper-declared
 * die, and all 17 `modifiers` the keepers did send carried nothing but `difficulty`. A
 * declared modifier now either reaches the dice or the call is refused by name; a family that
 * learns to carry it is added here, and nothing is ever dropped in silence again.
 */
const MODIFIER_CARRIERS = new Set([ORDINARY, COMBINED, OPPOSED, LUCK_ROLL,
    'decision:coc7:combat:attack', 'decision:coc7:combat:defend', 'decision:coc7:combat:maneuver']);
/** What to do instead, per decision that cannot carry the declaration. Never a bare "remove it". */
const MODIFIER_INSTEAD: Readonly<Record<string, string>> = Object.freeze({
    [PUSH]: 'a pushed roll keeps the dice of the check it pushes; resolve the push without action.modifiers',
});
const COMBAT_DEFEND = 'decision:coc7:combat:defend';
const SANITY_CHECK = 'decision:coc7:sanity:check';
const BOUT = ['decision:coc7:sanity:bout-tick', 'decision:coc7:sanity:bout-end'];
export const fullDecisionRef = (name: string): string => name.trim().startsWith('decision:') ? name.trim() : `decision:coc7:${name.trim()}`;
export function unsupportedDecision(runtime: RuleGraph, ref: string): never {
    const family = runtime.familyOf(ref);
    const name = semanticName(ref);
    const capability = runtime.capabilityOf(ref);
    throw new RpcError('not_implemented', `the ${family} family (${name}) has no executor in this TypeScript kernel yet`, {
        details: {
            family,
            decision: name,
            capability
        }
    });
}
export function unsupportedValue(field: string, value: any, supported: any[], message?: string): never {
    throw new RpcError('invalid_params', message || `unsupported ${field} ${repr(value)}`, {
        fix: `use one of details.options: ${supported.map(string).join(', ')}`,
        details: {
            field,
            options: supported
        }
    });
}
export function validateExtras(action: Row): void {
    if (action.push != null && typeof action.push !== 'boolean')
        throw new RpcError('invalid_params', 'action.push must be a boolean');
    if (action.luck != null && (!integer(action.luck) || number(action.luck) <= 0))
        throw new RpcError('invalid_params', 'action.luck must be a positive integer');
    if (truth(action.push) && action.luck != null)
        throw new RpcError('invalid_params', 'push or spend Luck, but not both', {
            fix: 'send either push: true or luck: <points>'
        });
    for (const key of ['spell', 'weapon', 'target', 'decision', 'actor', 'ending', 'outcome', 'san_loss', 'scenario_san_reward_expr', 'trigger'])
        if (action[key] != null && (typeof action[key] !== 'string' || !action[key].trim()))
            throw new RpcError('invalid_params', `action.${key} must be a non-empty string`);
    if (action.interrupted != null && typeof action.interrupted !== 'boolean')
        throw new RpcError('invalid_params', 'action.interrupted must be a boolean');
    if (action.defense != null && !['dodge', 'fight_back', 'none'].includes(action.defense))
        unsupportedValue('action.defense', action.defense, ['dodge', 'fight_back', 'none']);
    if (action.san_loss != null && !parseSanLoss(action.san_loss))
        throw new RpcError('invalid_params', 'action.san_loss must read <success>/<failure>, e.g. 0/1D6 or 1/1D8');
    if (action.involuntary != null && !(typeof action.involuntary === 'string' || isJsonObject(action.involuntary) && typeof action.involuntary.kind === 'string'))
        throw new RpcError('invalid_params', 'action.involuntary must be a kind (string) or {kind, summary}');
    if (action.motive != null && (!isJsonObject(action.motive) || !['support', 'neutral', 'oppose'].includes(string(action.motive.direction)) || ![0, 1, 2].some(n => equal(n, Object.hasOwn(action.motive, 'intensity') ? action.motive.intensity : 0))))
        throw new RpcError('invalid_params', 'action.motive must be {direction: support|neutral|oppose, intensity: 0|1|2}');
    if (action.skills != null && (!Array.isArray(action.skills) || action.skills.some((value: any) => typeof value !== 'string' || !value.trim())))
        throw new RpcError('invalid_params', 'action.skills must be a list of skill names');
    if (action.mode != null && !['any', 'all'].includes(action.mode))
        unsupportedValue('action.mode', action.mode, ['any', 'all']);
}
export function resolveActor(party: Row[], graph: SettleContext['graph'], sessions: SessionView, action: Row): {
    actor: Row;
    actingId: string;
    npcInSession: boolean;
} {
    const name = action.actor;
    const target = party.find(sheet => [normalize(string(sheet.id)), normalize(string(sheet.name))].includes(normalize(string(action.target || ''))));
    const investigator = typeof name === 'string' ? party.find(sheet => [normalize(string(sheet.id)), normalize(string(sheet.name))].includes(normalize(name))) : null;
    const node = typeof name === 'string' && !investigator ? graph.find(name, ['npc']) : null;
    if (node) {
        const handle = graph.handle(node);
        const session = active(sessions.combat) ? sessions.combat : active(sessions.chase) ? sessions.chase : null;
        const participants = array(session?.participants).filter(isJsonObject).map(value => string(value.actor_id));
        const inSession = session !== null && participants.includes(handle);
        if (inSession) {
            const pending = row(session.pending_attack);
            for (const candidate of [...(truth(pending) ? [pending.target_actor_id, pending.actor_id] : []), ...participants]) {
                const sheet = party.find(value => [normalize(string(value.id)), normalize(string(value.name))].includes(normalize(string(candidate))));
                if (sheet)
                    return {
                        actor: sheet,
                        actingId: handle,
                        npcInSession: true
                    };
            }
        }
        return {
            actor: target || findActor(party),
            actingId: handle,
            npcInSession: inSession
        };
    }
    const actor = findActor(party, name);
    return {
        actor,
        actingId: string(actor.id),
        npcInSession: false
    };
}
export function actionSkills(action: Row, resolver: SkillResolver): string[] {
    const explicit = action.skill;
    if (explicit != null) {
        if (typeof explicit !== 'string' || !explicit.trim())
            throw new RpcError('invalid_params', 'action.skill must be a non-empty string');
        const found = resolver.resolveExplicit(explicit);
        if (!found)
            throw new RpcError('needs', `unknown skill or characteristic ${repr(explicit)}`, {
                fix: 'set action.skill to one of details.needs.options',
                details: {needs: {field: 'skill', options: resolver.optionsFor(explicit)}}
            });
        return [found];
    }
    const matches = resolver.findInText(typeof action.method === 'string' ? action.method : '');
    return matches.length ? matches : resolver.findInText(typeof action.goal === 'string' ? action.goal : '');
}
export class ResolvePipeline {
    readonly intent: string;
    readonly goal: string;
    readonly method: string;
    readonly stakesText: string;
    readonly sessions: SessionView;
    constructor(readonly context: SettleContext, readonly resolver: SkillResolver, readonly modifiers: [
        number,
        number,
        string
    ], readonly npcInSession = false, readonly families: FixedFamilies = {}) {
        const action = context.action;
        this.intent = string(action.intent);
        this.goal = typeof action.goal === 'string' ? action.goal : '';
        this.method = typeof action.method === 'string' ? action.method : '';
        this.stakesText = typeof action.stakes === 'string' ? action.stakes : '';
        this.sessions = context.sessions();
        context.declaredModifiers = modifiers;
    }
    get action(): Row { return this.context.action; }
    skillMatches(): string[] {
        return actionSkills(this.action, this.resolver);
    }
    oneSkill(): string {
        const matches = this.skillMatches();
        if (matches.length === 1)
            return matches[0];
        throw new RpcError('needs', matches.length ? 'several skills named in method/goal; pick one' : 'no skill or characteristic found in method/goal', {
            fix: 'set action.skill to one of details.needs.options',
            details: {
                needs: {
                    field: 'skill',
                    options: this.resolver.optionsFor(`${this.method} ${this.goal}`, matches)
                }
            }
        });
    }
    npcTarget(): Row | null {
        if (!truth(this.action.target) || this.context.sheetById(this.action.target))
            return null;
        const node = this.context.graph.find(this.action.target, ['npc']);
        if (!node)
            return null;
        const handle = this.context.graph.handle(node);
        if (row(this.context.world.npc_presence)[handle] !== this.context.world.active_scene) {
            const candidates = entries(this.context.world.npc_presence).flatMap(([name, at]) => {
                const present = this.context.graph.find(name, ['npc']);
                return at === this.context.world.active_scene && present ? [{
                        name,
                        kind: 'npc',
                        display_name: this.context.graph.displayName(present)
                    }] : [];
            });
            throw new RpcError('unknown_entity', `${this.context.graph.displayName(node)} is not in the current scene`, {
                fix: 'target one of details.candidates, or move first',
                details: {
                    query: this.action.target,
                    candidates
                }
            });
        }
        return node;
    }
    private async withSanityOffer(refs: string[]): Promise<string[]> {
        const text = normalizeText(this.stakesText);
        const terms = ['san', 'sanity'];
        try {
            const labels = row(row(await this.context.tables.load('derived-attributes')).sanity).localized_labels;
            for (const [, value] of entries(labels))
                if (typeof value === 'string' && value.trim())
                    terms.push(normalizeText(value));
        }
        catch { /* Match the existing closed-label fallback. */ }
        return this.action.san_loss != null || text && terms.some(term => term && text.includes(term)) ? [...refs, SANITY_CHECK] : refs;
    }
    async route(npc: Row | null): Promise<string[]> {
        const action = this.action;
        if (truth(action.push))
            return [PUSH];
        if (action.luck != null)
            return [LUCK];
        if (action.decision != null) {
            const ref = fullDecisionRef(string(action.decision));
            const nodes = this.context.observations.nodes;
            if (nodes.get(ref)?.node_kind !== 'decision')
                throw new RpcError('invalid_params', `unknown decision ${repr(action.decision)}`, {
                    fix: 'use one of details.candidates',
                    details: {
                        candidates: [...nodes.values()].filter(node => node.node_kind === 'decision').map(node => semanticName(node.node_id)).sort()
                    }
                });
            return [ref];
        }
        let matches: string[] = [];
        try {
            matches = this.skillMatches();
        }
        catch (error) {
            if (!(error instanceof RpcError))
                throw error;
        }
        if (active(this.sessions.combat) && isJsonObject(this.sessions.combat?.pending_attack))
            return [COMBAT_DEFEND];
        if (action.defense != null && !(truth(action.target) && truth(action.object ?? action.weapon)))
            return [COMBAT_DEFEND];
        if (active(this.sessions.chase))
            return [`decision:coc7:chase:${this.sessions.chasePendingKind(this.sessions.chase!) || 'move'}`];
        if ([...this.sessions.sanity.values()].some(boutActive))
            return [...BOUT];
        if (this.intent === 'cast') {
            if(!truth(action.spell))throw new RpcError('needs',"casting needs the spell's name",{fix:'set action.spell',details:{needs:{field:'spell',options:knownSpells(await readMagicState(this.context,this.context.actorId),this.context.clockMinutes)}}});
            return ['decision:coc7:magic:cast-spell'];
        }
        if (this.intent === 'combat' || this.npcInSession)
            return this.withSanityOffer(['decision:coc7:combat:attack']);
        if (this.intent === 'flee')
            return [active(this.sessions.combat) ? 'decision:coc7:combat:flee' : 'decision:coc7:chase:start'];
        if (this.intent === 'move')
            return this.withSanityOffer(matches.length ? [ORDINARY] : []);
        if (this.intent === 'montage')
            return [];
        if (this.intent === 'social')
            return this.withSanityOffer(!npc ? [ORDINARY] : matches.includes('Psychology') ? [SOCIAL, OBSERVE] : [SOCIAL]);
        const healing = matches.find(skill => ['First Aid', 'Medicine'].includes(skill));
        if (healing)
            return [...this.context.observations.nodes.values()].filter(node => node.node_kind === 'decision' && row(node.properties).family_id === 'healing' && string(node.node_id).includes(healing === 'First Aid' ? 'first-aid' : 'medicine')).map(node => string(node.node_id));
        if (truth(action.spell))
            return ['decision:coc7:magic:learn-spell'];
        if (npc)
            return this.withSanityOffer(matches.includes('Psychology') ? [OBSERVE] : matches.length || truth(action.skill) ? [ORDINARY] : [ORDINARY, OBSERVE]);
        return this.withSanityOffer([ORDINARY]);
    }
    private restrict(candidates: string[]): string[] {
        let allowed: Set<string> | null = null;
        let message = '';
        let details: Row = {};
        const combat = this.sessions.combat;
        if (active(combat) && isJsonObject(combat?.pending_attack)) {
            const pending = combat!.pending_attack;
            const defender = string(pending.target_actor_id);
            const options = defenseOptions(pending);
            const investigator = this.sessions.isInvestigator(defender);
            const who = investigator ? 'the player' : 'the keeper';
            allowed = new Set([COMBAT_DEFEND]);
            message = `an attack by ${pending.actor_id} on ${defender} awaits ${who}'s defense`;
            details = {
                session: 'combat',
                required: 'combat:defend',
                actor: defender,
                options,
                fix: investigator ? `ask the player (ask.binds the pending defense), then resolve with actor: ${defender} and defense: one of ${repr(options)}` : `resolve with actor: ${defender} and defense: one of ${repr(options)}`
            };
        }
        else if (active(this.sessions.chase)) {
            const kind = this.sessions.chasePendingKind(this.sessions.chase!);
            allowed = new Set([...this.context.observations.nodes.values()].filter(node => node.node_kind === 'decision' && row(node.properties).family_id === 'chase').map(node => string(node.node_id)));
            message = 'a chase is underway; only chase decisions may resolve';
            details = {
                session: 'chase',
                required: `chase:${kind}`,
                turn_of: this.sessions.chaseTurnOf(this.sessions.chase!),
                fix: `resolve decision chase:${kind} (see session.actions), acting as session.turn_of`
            };
        }
        else {
            for (const [id, snapshot] of this.sessions.sanity)
                if (boutActive(snapshot)) {
                    allowed = new Set(BOUT);
                    message = `${id} is in a bout of madness; only bout decisions may resolve`;
                    details = {
                        session: 'sanity_bout',
                        required: 'sanity:bout-tick',
                        actor: id,
                        fix: 'resolve decision sanity:bout-tick to advance the bout, or sanity:bout-end to end it'
                    };
                    break;
                }
        }
        if (!allowed)
            return candidates;
        const admitted = candidates.filter(ref => allowed!.has(ref));
        const explicit = this.action.decision != null || this.action.defense != null;
        const implicit = details.session === 'chase' && ['flee', 'move', 'combat'].includes(this.intent);
        if (!admitted.length || !(explicit || implicit))
            throw new RpcError('turn_state', message, {
                fix: string(details.fix),
                details
            });
        return admitted;
    }
    private stakes(): Row {
        const goal = this.goal || this.method || this.intent;
        return {
            on_success: goal,
            on_failure: this.stakesText || `the attempt fails: ${goal}`
        };
    }
    async slots(ref: string, npc: Row | null): Promise<[
        Row,
        Row
    ]> {
        const context = this.context;
        const action = this.action;
        const extras: Row = {};
        if ([ORDINARY, LUCK_ROLL].includes(ref)) {
            const skill = this.oneSkill();
            const [bonus, penalty, difficulty] = this.modifiers;
            const semantic: Row = {
                difficulty,
                goal: this.goal || this.method || this.intent,
                stakes: this.stakes(),
                difficulty_basis: truth(row(action.modifiers).difficulty) ? 'explicit' : 'keeper'
            };
            semantic[Object.hasOwn(CHARACTERISTICS, skill) ? 'characteristic' : 'skill'] = skill;
            if (bonus)
                semantic.bonus = bonus;
            if (penalty)
                semantic.penalty = penalty;
            return [semantic, extras];
        }
        if (ref === COMBINED) {
            const names = truth(action.skills) ? action.skills : this.skillMatches();
            const canonical: string[] = [];
            for (const name of array(names)) {
                const found = typeof name === 'string' ? this.resolver.resolveExplicit(name) : null;
                if (!found)
                    throw new RpcError('needs', `unknown skill ${repr(name)} in action.skills`, {
                        details: {
                            needs: {
                                field: 'skills',
                                options: this.resolver.optionsFor(string(name))
                            }
                        }
                    });
                canonical.push(found);
            }
            if (canonical.length < 2)
                throw new RpcError('needs', 'a combined check needs two or more skills', {
                    fix: 'list them in action.skills',
                    details: {
                        needs: {
                            field: 'skills',
                            options: this.resolver.optionsFor(`${this.method} ${this.goal}`)
                        }
                    }
                });
            // No `bonus`/`penalty` here: a combined check declares neither as a semantic slot, and
            // the plan refuses an input it does not declare. The keeper's dice reach the executor
            // from the checked declaration instead (`executorArgs`, §95).
            return [{
                    combined_target_refs: canonical.map(skill => `${Object.hasOwn(CHARACTERISTICS, skill) ? 'characteristic' : 'skill'}:${kebab(skill)}`),
                    combined_mode: string(action.mode || 'any'),
                    difficulty: this.modifiers[2],
                    goal: this.goal || this.method || this.intent,
                    stakes: this.stakes()
                }, extras];
        }
        if (ref === OPPOSED) {
            if (!npc)
                throw new RpcError('needs', 'an opposed check needs a present NPC as action.target', {
                    details: {
                        needs: {
                            field: 'target',
                            options: context.presentNpcNames()
                        }
                    }
                });
            const skill = this.oneSkill();
            const handle = context.graph.handle(npc);
            const profile = context.npcProfile(handle) || {};
            const kind = Object.hasOwn(row(profile.skills), skill) ? 'skill' : Object.hasOwn(row(profile.characteristics), skill) ? 'characteristic' : null;
            if (!kind)
                throw new RpcError('needs', `${context.graph.displayName(npc)} has no authored value for ${skill}`, {
                    fix: 'pick a skill from details.needs.options or resolve an ordinary check instead',
                    details: {
                        needs: {
                            field: 'skill',
                            options: context.npcSkillLabels(`npc:${handle}`)
                        }
                    }
                });
            return [{
                    actor_check_ref: `${Object.hasOwn(CHARACTERISTICS, skill) ? 'characteristic' : 'skill'}:${kebab(skill)}`,
                    opponent_check_ref: `npc:${handle}:${kind}:${kebab(skill)}`
                }, extras];
        }
        if (ref === SOCIAL) {
            if (!npc)
                throw new RpcError('needs', 'social adjudication needs a present NPC as action.target', {
                    details: {
                        needs: {
                            field: 'target',
                            options: context.presentNpcNames()
                        }
                    }
                });
            const matches = this.skillMatches().filter(skill => Object.hasOwn(APPROACH_BY_SKILL, skill));
            if (matches.length !== 1)
                throw new RpcError('needs', 'the social approach is not clear from method', {
                    fix: 'set action.skill to Charm, Fast Talk, Intimidate or Persuade',
                    details: {
                        needs: {
                            field: 'skill',
                            options: Object.values(SOCIAL_APPROACH_SKILLS)
                        }
                    }
                });
            const handle = context.graph.handle(npc);
            const motive = row(action.motive);
            const semantic: Row = {
                described_action: this.method || this.goal,
                goal: this.goal || this.method,
                target_ref: `social-target:${handle}`,
                commitment_ref: `commitment:${handle}-t${context.turnNumber}`,
                approach: APPROACH_BY_SKILL[matches[0]],
                motive_direction: motive.direction ?? 'neutral',
                motive_intensity: motive.intensity ?? 0,
                feasibility: 'roll',
                supporting_action: {
                    description: '',
                    level: 0,
                    provenance: ''
                }
            };
            if (typeof action.support === 'string' && action.support.trim()) {
                const clue = context.graph.find(action.support, ['clue']);
                const discovered = new Set(array(context.world.discovered_clues));
                if (!clue || !discovered.has(context.graph.handle(clue)))
                    throw new RpcError('needs', 'action.support must name a discovered clue', {
                        details: {
                            needs: {
                                field: 'support',
                                options: [...discovered].sort()
                            }
                        }
                    });
                semantic.supporting_action = {
                    description: action.support,
                    level: 1,
                    provenance: 'discovered clue',
                    source_ref: `clue:${context.graph.handle(clue)}`
                };
            }
            extras._host_social_binding = socialBinding(context, npc, matches[0]);
            return [semantic, extras];
        }
        if (ref === OBSERVE) {
            if (!npc)
                throw new RpcError('needs', 'a Psychology observation needs a present NPC as action.target', {
                    details: {
                        needs: {
                            field: 'target',
                            options: context.presentNpcNames()
                        }
                    }
                });
            const question = this.goal || this.method;
            extras._host_psychology_binding = psychologyBinding(context, npc, question);
            return [{
                    question,
                    target_ref: `psychology-target:${context.graph.handle(npc)}`
                }, extras];
        }
        if (ref === REALIZE) {
            if (!npc)
                throw new RpcError('needs', 'realizing an observation needs the observed NPC as action.target', {
                    details: {
                        needs: {
                            field: 'target',
                            options: context.presentNpcNames()
                        }
                    }
                });
            const binding = await psychologyRealizeBinding(context, npc);
            if (!binding)
                throw new RpcError('turn_state', `no Psychology observation of ${context.graph.displayName(npc)} is settled yet`, {
                    fix: 'observe first: decision psychology:observe-concealed'
                });
            extras._host_psychology_binding = binding;
            const behavior = this.method || this.goal;
            if (!behavior)
                throw new RpcError('needs', 'the realization needs the player-visible behavior', {
                    details: {
                        needs: {
                            field: 'method',
                            options: []
                        }
                    }
                });
            return [{
                    external_behavior: behavior
                }, extras];
        }
        if (ref === PUSH) {
            if (!this.stakesText)
                throw new RpcError('needs', 'a pushed roll needs the announced consequence of failing it', {
                    fix: 'put the consequence in action.stakes',
                    details: {
                        needs: {
                            field: 'stakes',
                            options: []
                        }
                    }
                });
            if (!this.method)
                throw new RpcError('needs', 'a pushed roll needs the changed method', {
                    fix: 'describe the new approach in action.method',
                    details: {
                        needs: {
                            field: 'method',
                            options: []
                        }
                    }
                });
            return [{
                    method_changed: this.method,
                    failure_consequence: this.stakesText,
                    player_confirmed_risk: true
                }, extras];
        }
        if (ref === LUCK)
            return [{
                    points: action.luck
                }, extras];
        return [{}, extras];
    }
    private async noCandidates(candidates: string[], withheld: Row[], source: [
        string,
        Row
    ] | null): Promise<never> {
        const unmet=Object.fromEntries(withheld.map(value=>[value.decision_ref,array(value.unmet)]));
        if(candidates.length===1&&candidates[0]==='decision:coc7:magic:cast-spell')throw new RpcError('needs',`${repr(this.action.spell)} is not a spell this investigator knows`,{fix:'set action.spell to a known spell (details.needs.options), or learn it first',details:{needs:{field:'spell',options:knownSpells(await readMagicState(this.context,this.context.actorId),this.context.clockMinutes)},unmet}});
        if(candidates.length===1&&candidates[0]==='decision:coc7:magic:learn-spell')throw new RpcError('needs',`no authored source teaches ${repr(this.action.spell)} here`,{fix:'target a tome, teacher or entity that carries the spell (details.needs.options)',details:{needs:{field:'target',options:Object.keys(magicLearningSources(this.context)).sort()},unmet}});
        if(candidates.length===1&&candidates[0]==='decision:coc7:chase:start'){
            const present=presentOpponents(this.context);throw new RpcError('needs','a chase needs a pursuer with a stat block present in the scene',{fix:'establish the pursuer here first (an NPC whose module record carries mechanics.profile), or narrate the flight without dice',details:{needs:{field:'target',options:present.filter(([, ,profile])=>truth(profile)).map(([name])=>name).sort()},present:present.map(([name])=>name).sort(),unmet}});
        }
        if (truth(this.action.push) || this.action.luck != null) {
            const unmet = Object.fromEntries(withheld.map(value => [value.decision_ref, array(value.unmet)]));
            const what = truth(this.action.push) ? 'push' : 'spend Luck on';
            if (!source)
                throw new RpcError('needs', `there is no check of this investigator to ${what}`, {
                    fix: 'resolve a check first; push or Luck bind to the last failed check',
                    details: {
                        needs: {
                            field: 'intent',
                            options: ['investigate', 'social']
                        },
                        unmet
                    }
                });
            const check = source[1];
            const reason = truth(check.pushed) ? 'the last check was already pushed' : `the last check ${string(check.outcome)}: only an ordinary failure can be continued`;
            throw new RpcError('turn_state', `cannot ${what} the last check: ${reason}`, {
                fix: 'let the result stand and narrate its consequence',
                details: {
                    source_receipt: source[0],
                    outcome: check.outcome ?? null,
                    unmet
                }
            });
        }
        return noAvailableDecision(this.intent, candidates, withheld);
    }
    async run(beforeExecute: () => Promise<void>): Promise<Row> {
        const context = this.context;
        const npc = this.npcTarget();
        const candidates = this.restrict(await this.route(npc));
        if (!candidates.length)
            return {
                kind: 'none',
                note: this.intent === 'move' ? `intent ${this.intent}: nothing to roll; a scene change is apply's business (effects: move)` : `intent ${this.intent}: nothing to roll; narrate the outcome directly`
            };
        await context.prepareFacts();
        let gates: Row;
        try {
            gates = disabledDecisionGates(context.observations.packageManifest, await campaignEffectiveOptionalRules(context.snapshot, context.observations.packageManifest));
        }
        catch (error) {
            if (error instanceof OptionalRuleError)
                throw new RpcError('campaign_not_ready', error.message);
            throw error;
        }
        let effectiveIntent = this.action.defense != null || this.npcInSession ? 'combat' : this.intent;
        if(active(this.sessions.chase)&&this.intent==='flee')effectiveIntent=candidates.length===1&&candidates[0]==='decision:coc7:chase:attack'?'combat':'move';
        const runtimeFor=(intent:string)=>new RuleGraph(context.observations, {
            campaignId: context.campaignId,
            facts: () => context.facts(intent),
            resolverIndex: Object.fromEntries(RESOLVER_NAMES.map(name => [name, {}])),
            optionalRules: () => gates,
            augmentFacts: (selected, facts) => context.augmentFacts(selected, facts),
            grantContext: () => ({
                player_turn_epoch: context.turnNumber,
                stage: 'acting'
            })
        });
        const runtime=runtimeFor(effectiveIntent);
        const source = latestCheckReceipt(context);
        const question: Row = {
            kind: 'procedure',
            semantic_inputs: context.provisionalSemantic(typeof this.action.target==='string'?this.action.target:null)
        };
        if (source)
            Object.assign(question, {
                _host_source_receipt_id: source[0],
                _host_source_receipt: source[1],
                _host_source_decision_id: source[0]
            });
        const cards: Row[] = [];
        const withheld: Row[] = [];
        for (const family of [...new Set(candidates.map(ref => runtime.familyOf(ref)))].sort()) {
            const answer = runtime.context({
                ...question,
                family
            });
            cards.push(...array(answer.cards).filter(card => candidates.includes(card.decision_ref) && card.answers_declared_intent !== false));
            withheld.push(...array(answer.withheld).filter(value => candidates.includes(value.decision_ref)));
        }
        if (!cards.length) {
            if (candidates.every(ref => !BASIC_DECISIONS.has(ref) && !familyBinding(this.families, ref, runtime.capabilityOf(ref))))
                unsupportedDecision(runtime, candidates[0]);
            await this.noCandidates(candidates, withheld, source);
        }
        const director = row(row(context.turn.capsule).director);
        const selectedCard = selectAvailableDecision(cards, candidates, {
            explicit: this.action.decision != null || truth(this.action.push) || this.action.luck != null,
            intent: this.intent,
            withheld,
            director: {
                beat: director.beat ?? null,
                grounded: array(director.grounded_by).map(string).filter(name => !name.startsWith('effect:') && !name.startsWith('rule:')).map(fullDecisionRef)
            }
        });
        const chosen = selectedCard.card;
        const ref = string(chosen.decision_ref);
        const family = familyBinding(this.families, ref, runtime.capabilityOf(ref));
        if (!BASIC_DECISIONS.has(ref) && !family)
            unsupportedDecision(runtime, ref);
        const [declaredBonus, declaredPenalty] = this.modifiers;
        if ((declaredBonus || declaredPenalty) && !MODIFIER_CARRIERS.has(ref))
            throw new RpcError('invalid_params', `${semanticName(ref)} does not roll with bonus or penalty dice`, {
                fix: MODIFIER_INSTEAD[ref] ?? `resolve this action without action.modifiers.bonus_dice and action.modifiers.penalty_dice; ${semanticName(ref)} settles on its own terms. Everything else in the action stays as it is`,
                details: {
                    decision: semanticName(ref),
                    declared: {
                        bonus_dice: declaredBonus,
                        penalty_dice: declaredPenalty
                    }
                }
            });
        const bound = family ? await family.slots(ref, context, {npc, investigator: context.sheetById(this.action.target)}) : null;
        const [semantic, extras] = bound ? [bound.semantic, bound.extras] : await this.slots(ref, npc);
        const selected: Row = {
            decision_ref: ref,
            semantic_inputs: semantic,
            ...extras
        };
        if (source)
            Object.assign(selected, {
                _host_source_receipt_id: source[0],
                _host_source_receipt: source[1]
            });
        const grant = runtime.latestGrantCovering(ref);
        const envelope = family ? await settleFamily(context, runtime, selected, grant, family, beforeExecute)
            : await settleBasic(context, runtime, selected, grant, beforeExecute);
        if (envelope.status !== 'settled')
            throwPlanningFailure(envelope, chosen);
        await recordSkillTicks(context);
        const shaped = shapeSettlement(context, runtime, chosen, envelope, family?.outcome(context, ref, row(envelope.settlement.result)));
        tagNpcReceipts(context, chosen.family, npc, shaped.outcome);
        if (selectedCard.decision_source)
            shaped.decision_source = selectedCard.decision_source;
        if(ref==='decision:coc7:combat:flee'&&shaped.outcome.combat_outcome==='fled'){
            const ready=!active(context.sessions().chase)&&context.party().length>0&&presentOpponents(context).some(([, ,profile])=>truth(profile));
            if(!ready)shaped.continuations.push({decision:'chase:start',executed:false,when:'no pursuer with a stat block is present; the flight ends the fight'});
            else{
                const nextRuntime=runtimeFor('flee'),nextRef='decision:coc7:chase:start';
                const card=array(nextRuntime.context({kind:'procedure',semantic_inputs:{},family:'chase'}).cards).find(card=>card.decision_ref===nextRef);
                if(card){
                    const binding=familyBinding(this.families,nextRef,nextRuntime.capabilityOf(nextRef));
                    if(!binding)unsupportedDecision(nextRuntime,nextRef);
                    const slots=await binding.slots(nextRef,context,{npc:null,investigator:null}),choice={decision_ref:nextRef,semantic_inputs:slots.semantic,...slots.extras};
                    const next=await settleFamily(context,nextRuntime,choice,nextRuntime.latestGrantCovering(nextRef),binding,beforeExecute);
                    if(next.status!=='settled')throwPlanningFailure(next,card);
                    const result=row(row(next.settlement).result);
                    shaped.continuations=shaped.continuations.filter((entry:Row)=>entry.decision!=='chase:start');
                    shaped.continuations.push({decision:'chase:start',executed:true,when:card.label??null,outcome:binding.outcome(context,nextRef,result)});
                    shaped.session=result.session??null;shaped.pending_choice=result.pending_choice??null;shaped.outcome.continued='chase:start';
                    for(const rule of array(next.rule_refs))if(!shaped.rule_refs.includes(rule))shaped.rule_refs.push(string(rule));
                    shaped.effects=[...context.effects];shaped.receipts=context.receipts;
                }
            }
        }
        return shaped;
    }
}
