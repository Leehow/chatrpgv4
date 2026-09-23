/**
 * Contract §134.11: a `resolve` that names a stated obligation, and the flag its passing check sets.
 *
 * The claim is validated against what the kernel issued (open, in the active scene, its next step a
 * check, the skill one of its approaches, the stated difficulty, the target present), then the Keeper's
 * action is bound to the ordinary check -- or to the Mod check that serves the step (§134.13) -- so push,
 * Luck and continuations behave exactly as on any check. A settling level writes the flag in the same
 * call; any other level hands the Keeper the book's line. The kernel applies no consequence and no cost.
 *
 * Settlement follows the operation that claims it: a resolve without `action.obligation` settles nothing,
 * and a push or a Luck spend continues the claim of the check receipt it continues, never a look-alike.
 */
import { RpcError, type ErrorCode } from '../errors.js';
import { orderedObject } from '../json.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { actor as selectActor } from '../read/handlers.js';
import { activeMods } from '../read/mods.js';
import { activeScene, nextStep, obligationByHandle, obligationNodes, obligationState, openGuards, servingModCheck, valueName, type ModCheck } from '../read/obligations.js';
import { array, entries, integer, normalize, number, repr, row, string, truth, type Row } from '../read/values.js';
import type { KernelContext } from '../context.js';
import type { RuleTables } from '../rules/tables.js';
import { SkillResolver } from '../rules/skills.js';
import type { DomainEvent, TurnTransaction } from '../transactions.js';
import { ORDINARY } from './bindings.js';

const NONE_INTENTS = new Set(['idle', 'meta', 'stuck', 'ambiguous']);
/** Who claims the roll: the action field it came in and the prefix of its refusal reasons (§134.11, §136.20). */
export interface CheckOwner {
    readonly field: string;
    readonly prefix: string;
    readonly handle: string;
}
const refuseFor = (field: string) => (code: ErrorCode, reason: string, message: string, extra: { fix?: string; details?: Row } = {}): never => {
    throw new RpcError(code, message, { ...(extra.fix ? { fix: extra.fix } : {}), details: { field, reason, ...extra.details } });
};
const refuse = refuseFor('action.obligation');

/** A bound claim: which obligation, its node, and (for a fresh check) the step it rolls. */
export interface ObligationClaim {
    readonly handle: string;
    readonly node: Row;
    readonly step: Row | null;
}
const obligationOf = (node: Row): Row => row(row(node.properties).obligation);

/**
 * Validate `action.obligation` and bind the action it will settle through. A push or a Luck spend only
 * names the obligation; which check it continues is checked by `continuedClaim` once the actor is known.
 */
export async function bindObligation(input: {
    kernel: KernelContext; tables: RuleTables; graph: ModuleGraph; world: Row; transaction: TurnTransaction; action: Row; intent: string;
}): Promise<{ claim: ObligationClaim; action: Row }> {
    const { kernel, tables, graph, world, transaction, action, intent } = input;
    const scene = activeScene(graph, world), here = obligationNodes(graph, scene).map(node => graph.handle(node));
    const node = obligationByHandle(graph, action.obligation);
    if (!node)
        refuse('unknown_entity', 'obligation_unknown', `${repr(action.obligation)} is no stated obligation of this module`, {
            fix: here.length ? 'name one of details.candidates, as the capsule and table.apply.options issue it' : 'this scene states no obligation; resolve without action.obligation',
            details: { candidates: here } });
    const handle = graph.handle(node!), ob = obligationOf(node!);
    if (!scene || ob.scene !== scene.node_id)
        refuse('not_here', 'obligation_not_here', `${handle} belongs to another scene than the one the party is in`, {
            fix: 'resolve without action.obligation, or move to its scene first', details: { obligation: handle, candidates: here } });
    if (NONE_INTENTS.has(intent))
        refuse('invalid_params', 'obligation_intent', `intent ${intent} rolls nothing, so it cannot settle ${handle}`, {
            fix: 'give the intent the check is for (social, investigate, ...), or leave action.obligation out' });
    const state = obligationState(graph, world, node!);
    if (state !== 'open')
        refuse('invalid_params', 'obligation_not_open', `${handle} is ${state}`, {
            fix: state === 'blocked' ? `it waits on ${graph.handle(graph.nodes.get(string(row(ob.trigger).obligation))!)}` : 'it needs no check now; apply flag false reopens it',
            details: { obligation: handle, state } });
    if (truth(action.push) || action.luck != null)
        return { claim: { handle, node: node!, step: null }, action };
    const step = nextStep(graph, world, node!);
    if (!step || step.kind !== 'check') {
        const person = step?.kind === 'meet' ? graph.nodes.get(string(step.npc)) : undefined;
        refuse('invalid_params', 'obligation_step', person ? `${handle} first asks the investigators to meet ${graph.displayName(person)}` : `${handle} states no check`, {
            fix: person ? `apply {kind: "person", who: ${repr(graph.displayName(person))}, name: "<what this table calls them>"} to put them on stage first, then resolve this check` : 'resolve without action.obligation',
            details: { obligation: handle, next: step?.kind ?? null } });
    }
    const check = step!, modChecks: ModCheck[] = (await activeMods(kernel, world)).flatMap(mod => array(mod.contributes.checks).map(value => ({ mod: string(mod.id), check: value })));
    const served = servingModCheck(check, modChecks);
    const ordinary = ['core-check:ordinary-check', ORDINARY];
    if (action.decision != null && !(served ? [served.check.name] : ordinary).includes(string(action.decision)))
        refuse('invalid_params', 'obligation_decision', `${handle} settles through ${served ? served.check.name : 'the ordinary check'}, not ${repr(action.decision)}`, {
            fix: 'leave action.decision out; the kernel binds the check the obligation states' });
    const owner: CheckOwner = { field: 'action.obligation', prefix: 'obligation', handle };
    const bound = await bindCheckStep({ tables, graph, world, transaction, action, intent, check, owner, scene: scene!, served: !!served });
    bound.decision = served ? served.check.name : 'core-check:ordinary-check';
    return { claim: { handle, node: node!, step: check }, action: bound };
}

/**
 * The binding a stated check step makes of the Keeper's action, shared by an obligation's check (§134.11) and a
 * rule's (§136.20): the step's target present in the scene (a different one named is refused), the stated
 * difficulty (the Keeper's own when it is unstated), and the skill -- the named approach for `approach`, the
 * actor's highest value among the approaches meeting their minimums for `maximum` (ties to the first declared, the
 * Mod path's own rule). A step a Mod check serves (§134.13) binds its target and difficulty only. Reasons are
 * `<prefix>_target`, `<prefix>_difficulty`, `<prefix>_skill`, `<prefix>_minimum`.
 */
export async function bindCheckStep(input: {
    tables: RuleTables; graph: ModuleGraph; world: Row; transaction: TurnTransaction; action: Row; intent: string;
    check: Row; owner: CheckOwner; scene: Row; served?: boolean;
}): Promise<Row> {
    const { tables, graph, world, transaction, action, intent, check, owner, scene } = input, handle = owner.handle;
    const deny = refuseFor(owner.field), reason = (name: string) => `${owner.prefix}_${name}`;
    // The target: the step's person, present in the active scene; a different one named is refused.
    let target: Row | null = null;
    if (typeof check.target === 'string' && graph.nodes.has(check.target)) {
        target = graph.nodes.get(check.target)!;
        if (row(world.npc_presence)[graph.handle(target)] !== graph.handle(scene))
            deny('not_here', reason('target'), `${graph.displayName(target)} is not in this scene, so ${handle} has no one to roll against`, {
                fix: `apply {kind: "npc", name: ${repr(graph.displayName(target))}, to: "here"} first, or leave ${owner.field} out` });
        if (typeof action.target === 'string' && action.target.trim() && graph.actor(action.target)?.node_id !== target.node_id)
            deny('invalid_params', reason('target'), `${handle} is a check against ${graph.displayName(target)}, not ${repr(action.target)}`, {
                fix: `leave action.target out or name the person the ${owner.prefix} states` });
    }
    const stated = check.difficulty_unstated === true ? null : string(check.difficulty);
    const declared = row(action.modifiers).difficulty;
    if (stated && declared != null && declared !== stated)
        deny('invalid_params', reason('difficulty'), `${handle} states a ${stated} check, not ${repr(declared)}`, {
            fix: `leave modifiers.difficulty out or say ${stated}; bonus and penalty dice are still yours` });
    const bound: Row = { ...action, ...(target ? { target: graph.displayName(target) } : {}) };
    if (input.served) {
        delete bound.skill;
        return bound;
    }
    if (check.approaches_unstated !== true) {
        const party = await transaction.campaign.party() as Row[], sheet = selectActor(party, action.actor);
        const resolver = await SkillResolver.create(tables, sheet);
        const approaches = array(check.values).map(value => {
            const name = valueName(row(value).path);
            return { name: resolver.resolveExplicit(name) ?? name, minimum: integer(row(value).minimum) ? number(row(value).minimum) : null };
        });
        const rating = (name: string): number => { try { return resolver.targetValue(name); } catch { return 0; } };
        let chosen: { name: string; minimum: number | null } | undefined;
        if (check.selection === 'approach') {
            if (typeof action.skill !== 'string' || !action.skill.trim())
                deny('needs', reason('skill'), `${handle} is won by one of ${approaches.map(value => value.name).join(', ')}; say which one the investigator takes`, {
                    fix: 'set action.skill to one of details.needs.options', details: { needs: { field: 'skill', options: approaches.map(value => value.name) } } });
            const named = resolver.resolveExplicit(action.skill) ?? action.skill;
            chosen = approaches.find(value => normalize(value.name) === normalize(named));
            if (!chosen)
                deny('invalid_params', reason('skill'), `${repr(action.skill)} is not one of the approaches ${handle} allows`, {
                    fix: `take one of ${approaches.map(value => value.name).join(', ')}, or leave ${owner.field} out to improvise another way`,
                    details: { options: approaches.map(value => value.name) } });
            if (chosen!.minimum != null && rating(chosen!.name) < chosen!.minimum)
                deny('invalid_params', reason('minimum'), `${chosen!.name} ${rating(chosen!.name)} is below the ${chosen!.minimum} ${handle} states`, {
                    fix: 'take another approach', details: { skill: chosen!.name, minimum: chosen!.minimum } });
        }
        else {
            // The higher value, ties to the first declared -- the Mod path's own rule (`mods/resolve.ts`).
            for (const value of approaches.filter(value => value.minimum == null || rating(value.name) >= value.minimum))
                if (!chosen || rating(value.name) > rating(chosen.name))
                    chosen = value;
            if (!chosen)
                deny('invalid_params', reason('minimum'), `no approach of ${handle} meets its stated minimum`, { fix: `leave ${owner.field} out to improvise another way` });
        }
        bound.skill = chosen!.name;
    }
    if (stated) {
        const modifiers: Row = { ...row(action.modifiers), difficulty: stated };
        // A social modifier needs its reason (§113); a difficulty the book states is its own.
        if (stated !== 'regular' && intent === 'social' && modifiers.reason == null)
            modifiers.reason = 'stated by the module';
        bound.modifiers = modifiers;
    }
    return bound;
}

/**
 * A push or a Luck spend continues the latest check receipt of the actor. When that receipt claimed an
 * obligation, the continuation carries the same claim; an explicit claim on it must name the same one.
 */
export function continuedClaim(graph: ModuleGraph, explicit: ObligationClaim | null, source: Row | null): ObligationClaim | null {
    const inherited = string(row(source?.obligation).handle || '');
    if (explicit && explicit.handle !== inherited)
        refuse('invalid_params', 'obligation_decision', inherited ? `the check this continues claimed ${inherited}, not ${explicit.handle}` : `the check this continues claimed no obligation, so it cannot settle ${explicit.handle}`, {
            fix: 'leave action.obligation out of the push or Luck spend; it continues whatever the check it continues claimed' });
    if (!inherited)
        return null;
    const node = obligationByHandle(graph, inherited);
    return node ? { handle: inherited, node, step: null } : null;
}

/** The check step whose result levels decide a claim: the bound one, or the obligation's own. */
function checkStep(claim: ObligationClaim): Row {
    return claim.step ?? array(obligationOf(claim.node).demand).map(row).find(step => step.kind === 'check') ?? {};
}

/**
 * §134.11: after the check settled, write the flag when its level settles (same call, before the commit),
 * annotate the roll receipt, and say what happened on the result. Returns the event to append.
 */
export async function settleClaim(input: {
    graph: ModuleGraph; transaction: TurnTransaction; claim: ObligationClaim; level: any; receipts: Row[]; result: Row; pushable: boolean;
}): Promise<DomainEvent | null> {
    const { transaction, claim, receipts, result } = input, step = checkStep(claim);
    const outcome = row(row(step.results)[string(input.level)]), settles = outcome.settles === true;
    const roll = receipts.find(receipt => receipt.kind === 'roll');
    if (roll)
        roll.obligation = { handle: claim.handle, settled: settles };
    if (!settles) {
        result.obligation = { handle: claim.handle, settled: false,
            ...(typeof outcome.book === 'string' ? { book: outcome.book } : {}),
            ...(input.pushable && row(step.push).allowed === true && typeof row(step.push).book === 'string' ? { push: row(step.push).book } : {}) };
        return null;
    }
    const flag = string(row(obligationOf(claim.node).settles).flag_id);
    const world = await transaction.campaign.readWorld(), flags = row(world.flags), previous = flags[flag] ?? null;
    world.flags = orderedObject([...entries(flags).filter(([key]) => key !== flag), [flag, true]]);
    await transaction.campaign.writeWorld(world);
    transaction.world.flags = world.flags;
    result.obligation = { handle: claim.handle, settled: true };
    return { type: 'flag-set', data: { name: flag, value: true, previous }, ...(roll ? { receipt: string(roll.id) } : {}) } as DomainEvent;
}

/** §134.11: a resolve with no claim whose target is a guarded person of an unsettled obligation, as information. */
export function crossedByTarget(graph: ModuleGraph, world: Row, target: any): string | null {
    if (typeof target !== 'string' || !target.trim())
        return null;
    const person = graph.find(target, ['npc']);
    return person ? openGuards(graph, world, activeScene(graph, world)).people.get(person.node_id) ?? null : null;
}
