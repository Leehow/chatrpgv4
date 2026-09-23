/**
 * Contract §136.20–§136.21, §136.23 (RD-03): a `resolve` that names a stated shape with `action.rule`.
 *
 * The Keeper names a rule, a hazard (and which step with `action.step`), a tome or an object; the kernel binds
 * the check the book states through the same binder an obligation's check uses (`bindCheckStep`, §134.11), runs
 * the decision the check maps to (ordinary, opposed, Luck), and hands back what the level reached states --
 * bound, never applied (owner ruling Q1: the kernel rolls a hazard only when the Keeper names it, and the
 * consequence stays `apply … {stated}`, the Keeper's call). It writes nothing beyond the roll's own receipts; the
 * roll receipt carries `basis: {rule, step?, level}`. With `action.decision: sanity:check` it fills `san_loss`
 * from the node's stated sanity loss instead.
 *
 * A resolve without `action.rule` is exactly today's resolve: a stated shape never refuses the Keeper (spec P8).
 */
import { RpcError, type ErrorCode } from '../errors.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { activeScene } from '../read/obligations.js';
import { RULE_KINDS, levelEffects, statedCandidates, statedCheck, statedLevel } from '../read/stated.js';
import { array, integer, normalize, number, repr, row, string, truth, type Row } from '../read/values.js';
import type { RuleTables } from '../rules/tables.js';
import type { TurnTransaction } from '../transactions.js';
import { npcProfileOf } from './context.js';
import { bindCheckStep, type CheckOwner } from './obligation.js';

const NONE_INTENTS = new Set(['idle', 'meta', 'stuck', 'ambiguous']);
const ORDINARY = 'core-check:ordinary-check', OPPOSED = 'core-check:opposed-check', LUCK_ROLL = 'push-luck:luck-roll', SANITY = 'sanity:check';
const FAILED = new Set(['failure', 'fumble']);
const refuse = (code: ErrorCode, reason: string, message: string, extra: { fix?: string; details?: Row } = {}): never => {
    throw new RpcError(code, message, { ...(extra.fix ? { fix: extra.fix } : {}), details: { field: 'action.rule', reason, ...extra.details } });
};
const shortDecision = (value: any): string => string(value).trim().replace(/^decision:coc7:/, '');

/** A bound claim: the node, and for a roll the check and hazard step it rolls; for a sanity check the pair it filled. */
export interface RuleClaim {
    readonly handle: string;
    readonly node: Row;
    readonly check: Row | null;
    readonly step: number | null;
    readonly sanLoss?: string;
}

/** The rows the capsule's `where.rules` lists here that a `resolve` can name: those stating a check or a hazard. */
function hereCandidates(graph: ModuleGraph, world: Row): string[] {
    const scene = activeScene(graph, world);
    return scene ? graph.ruleNodes(scene).filter(node => statedCheck(graph, node, null)).map(node => graph.handle(node)) : [];
}

/**
 * Where the node may be named from (spec D6.3): linked from the active scene by `uses-rule`; a tome, object or
 * artifact also when it is among the scene's assets or a party sheet holds it (an equipment entry of its name).
 */
function ruleHere(graph: ModuleGraph, world: Row, party: Row[], node: Row): boolean {
    const scene = activeScene(graph, world);
    if (!scene) return false;
    if (graph.ruleNodes(scene).some(rule => rule.node_id === node.node_id)) return true;
    if (!['tome', 'object', 'artifact'].includes(string(node.node_kind))) return false;
    if (graph.sceneAssetNodes(scene).some(asset => asset.node_id === node.node_id)) return true;
    return party.some(sheet => array(sheet.equipment).some(item => typeof row(item).name === 'string' && graph.find(row(item).name, [string(node.node_kind)])?.node_id === node.node_id));
}

/** The decision a stated check maps to: the Luck roll for a lone Luck value, the opposed check for `opposed`, else the ordinary check. */
function mappedDecision(check: Row): string {
    const values = array(check.values).map(value => string(row(value).path));
    if (values.length === 1 && normalize(values[0]) === normalize('characteristics.Luck')) return LUCK_ROLL;
    return check.scope === 'opposed' ? OPPOSED : ORDINARY;
}

/**
 * Validate `action.rule` (and `action.step`) and bind the action it rolls. A push or a Luck spend only names the
 * rule; which roll it continues is checked by `continuedRule` once the actor is known.
 */
export async function bindRule(input: {
    tables: RuleTables; graph: ModuleGraph; world: Row; transaction: TurnTransaction; action: Row; intent: string;
}): Promise<{ claim: RuleClaim; action: Row }> {
    const { tables, graph, world, transaction, intent } = input;
    const action: Row = { ...input.action };
    delete action._stated_opposing;
    const found = typeof action.rule === 'string' && action.rule.trim() ? graph.find(action.rule.trim(), RULE_KINDS) : null;
    const node = found && Object.keys(graph.mechanicsOf(found)).length ? found : null;
    if (!node)
        refuse('unknown_entity', 'rule_unknown', `${repr(action.rule)} names no rule, hazard, tome or object of this module that states a mechanic`, {
            fix: 'name one of details.candidates (the capsule\'s where.rules rows with a mech line), or resolve without action.rule',
            details: { candidates: hereCandidates(graph, world) } });
    const handle = graph.handle(node!), party = await transaction.campaign.party() as Row[];
    if (!ruleHere(graph, world, party, node!))
        refuse('not_here', 'rule_not_here', `${handle} is not a rule of the scene the party is in`, {
            fix: 'resolve without action.rule, or move where the book states it first', details: { rule: handle, candidates: hereCandidates(graph, world) } });
    if (NONE_INTENTS.has(intent))
        refuse('invalid_params', 'rule_intent', `intent ${intent} rolls nothing, so it cannot roll ${handle}`, {
            fix: 'give the intent the check is for (investigate, move, social, ...), or leave action.rule out' });
    if (action.obligation != null)
        refuse('invalid_params', 'rule_decision', `one roll has one owner: ${handle} or the obligation ${repr(action.obligation)}, not both`, {
            fix: 'leave action.rule out to settle the obligation, or action.obligation out to roll the rule' });
    if (shortDecision(action.decision) === SANITY)
        return bindRuleSanity(graph, transaction, action, node!, handle);
    if (truth(action.push) || action.luck != null)
        return { claim: { handle, node: node!, check: null, step: null }, action };
    let step: number | null = null;
    if (action.step != null) {
        if (!integer(action.step) || number(action.step) < 0)
            refuse('invalid_params', 'rule_step', 'action.step is the index of a hazard step, 0 or more');
        step = number(action.step);
    }
    const stated = statedCheck(graph, node!, step);
    if (!stated) {
        const steps = array(row(graph.mechanicsOf(node!).hazard).steps).length;
        if (step !== null)
            refuse('invalid_params', 'rule_step', steps ? `${handle} states steps 0 to ${steps - 1}, not ${step}` : `${handle} states no hazard steps`, {
                fix: steps ? 'name one of its steps, or leave action.step out for the first' : 'leave action.step out', details: { rule: handle, steps } });
        refuse('invalid_params', 'rule_no_check', `${handle} states no check to roll`, {
            fix: 'resolve without action.rule; what it states is applied with apply stated, or with decision sanity:check for its sanity loss',
            details: { rule: handle, shapes: Object.keys(graph.mechanicsOf(node!)) } });
    }
    const { check } = stated!, decision = mappedDecision(check);
    if (action.decision != null && shortDecision(action.decision) !== decision)
        refuse('invalid_params', 'rule_decision', `${handle} rolls through ${decision}, not ${repr(action.decision)}`, {
            fix: 'leave action.decision out; the kernel runs the decision the stated check maps to' });
    const owner: CheckOwner = { field: 'action.rule', prefix: 'rule', handle };
    const bound = await bindCheckStep({ tables, graph, world, transaction, action, intent, check, owner, scene: activeScene(graph, world)! });
    bound.decision = decision;
    if (decision === OPPOSED)
        bound._stated_opposing = opposingValue(graph, world, bound, check, handle);
    return { claim: { handle, node: node!, check, step: stated!.step }, action: bound };
}

/** The opponent's stated value: the highest of `opposing.values` the opponent's profile carries. */
function opposingValue(graph: ModuleGraph, world: Row, bound: Row, check: Row, handle: string): string {
    const opponent = typeof bound.target === 'string' && bound.target.trim() ? graph.actor(bound.target) : null;
    if (!opponent)
        refuse('needs', 'rule_target', `${handle} is an opposed check; name the one who opposes it`, {
            fix: 'set action.target to a person present here (details.needs.options is empty when nobody is)', details: { needs: { field: 'target', options: [] } } });
    const profile = row(npcProfileOf(graph, world, graph.handle(opponent!)));
    let best: [string, number] | null = null;
    for (const value of array(row(check.opposing).values).map(row)) {
        const path = string(value.path), group = path.startsWith('characteristics.') ? 'characteristics' : 'skills', name = path.slice(path.indexOf('.') + 1);
        const hit = Object.entries(row(profile[group])).find(([key, rating]) => normalize(key) === normalize(name) && integer(rating));
        if (hit && (!best || number(hit[1]) > best[1])) best = [hit[0], number(hit[1])];
    }
    if (!best)
        refuse('invalid_params', 'rule_target', `${graph.displayName(opponent!)} carries none of the values ${handle} opposes with`, {
            fix: 'resolve without action.rule and choose the opposed skill yourself, or name another opponent',
            details: { opposing: array(row(check.opposing).values).map(value => string(row(value).path)) } });
    return best![0];
}

/** §136.23: `sanity:check` with `action.rule` takes its pair from the node's stated sanity loss. */
function bindRuleSanity(graph: ModuleGraph, transaction: TurnTransaction, action: Row, node: Row, handle: string): { claim: RuleClaim; action: Row } {
    if (action.san_loss != null)
        refuse('invalid_params', 'stated_conflict', `action.san_loss is your own amount and ${handle} states the book's; give one`, {
            fix: 'leave action.san_loss out to use the stated loss, or action.rule out to use your own', details: { fields: ['san_loss'] } });
    const candidates = statedCandidates(graph, [...array(transaction.turn.receipts)], node, 'sanity_loss');
    if (!candidates.length)
        refuse('invalid_params', 'stated_none', `${handle} states no sanity loss`, {
            fix: 'set action.san_loss yourself and leave action.rule out', details: { rule: handle } });
    if (candidates.length > 1)
        refuse('invalid_params', 'stated_ambiguous', `${handle} states more than one sanity loss here`, {
            fix: 'set action.san_loss to the one you mean (details.choices) and leave action.rule out', details: { choices: candidates } });
    const pair = candidates[0].san_loss;
    if (typeof pair !== 'string')
        refuse('invalid_params', 'stated_unstated', `${handle} leaves part of its sanity loss unstated; the amount is yours`, {
            fix: 'set action.san_loss yourself and leave action.rule out', details: { stated: candidates[0] } });
    return { claim: { handle, node, check: null, step: null, sanLoss: pair }, action: { ...action, san_loss: pair } };
}

/**
 * A push or a Luck spend continues the latest check receipt of the actor. When that receipt was rolled on a
 * stated rule, the continuation carries the same rule and step; an explicit `action.rule` must name the same one.
 */
export function continuedRule(graph: ModuleGraph, explicit: RuleClaim | null, source: Row | null): RuleClaim | null {
    const basis = row(source?.basis), inherited = typeof basis.rule === 'string' ? basis.rule : '';
    if (explicit && explicit.handle !== inherited)
        refuse('invalid_params', 'rule_decision', inherited ? `the check this continues was rolled on ${inherited}, not ${explicit.handle}` : `the check this continues was rolled on no stated rule, so it cannot roll ${explicit.handle}`, {
            fix: 'leave action.rule out of the push or Luck spend; it continues whatever the check it continues was rolled on' });
    if (!inherited) return null;
    const node = graph.find(inherited, RULE_KINDS), step = integer(basis.step) ? number(basis.step) : null;
    const stated = node ? statedCheck(graph, node, step) : null;
    return node && stated ? { handle: inherited, node, check: stated.check, step: stated.step } : null;
}

/**
 * §136.21: after the roll, what the level reached states goes on the result as `stated`, and the roll receipt
 * carries `basis`. Nothing is applied and nothing else is written.
 */
export function settleRule(input: { graph: ModuleGraph; claim: RuleClaim; outcome: Row; receipts: Row[]; result: Row; pushed: boolean; pushable: boolean }): void {
    const { graph, claim, receipts, result } = input, roll = receipts.find(receipt => receipt.kind === 'roll');
    if (claim.sanLoss !== undefined) {
        if (roll) roll.basis = { rule: claim.handle };
        result.stated = { rule: claim.handle, san_loss: claim.sanLoss };
        return;
    }
    const check = claim.check ?? {}, level = statedLevel(input.outcome), failed = FAILED.has(level);
    const stated = levelEffects(graph, check, level, input.pushed && failed), push = row(check.push);
    const at = claim.step !== null ? { step: claim.step } : {};
    if (roll) roll.basis = { rule: claim.handle, ...at, level, ...(input.pushed ? { pushed: true } : {}) };
    result.stated = { rule: claim.handle, ...at, level, effects: stated.effects,
        ...(stated.next_step !== null ? { next_step: stated.next_step } : {}),
        ...(stated.book !== null ? { book: stated.book } : {}),
        ...(input.pushable && failed && push.allowed === true ? { push: { allowed: true, ...(typeof push.book === 'string' ? { book: push.book } : {}) } } : {}) };
}
