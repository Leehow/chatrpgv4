/** Existing Mod checks and object actions before ordinary RuleGraph settlement. */
import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { isJsonObject, jsonDigest, orderedObject } from '../json.js';
import { CampaignSnapshot } from '../read/campaign.js';
import { npcsPresent } from '../read/capsule.js';
import { SessionView } from '../read/session-view.js';
import { findNamedObject } from '../read/mods.js';
import { enrichActorRefusal } from '../read/handlers.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { array, clone, entries, equal, integer, normalize, repr, row, string, truth, values, type Row } from '../read/values.js';
import type { SettleContext } from '../resolve/context.js';
import type { CheckArithmetic } from '../resolve/arithmetic.js';
import type { PythonRandom } from '../random.js';
import type { CampaignWritePort } from '../transactions.js';
import { nowIso } from '../write/store.js';
import { objectOwner } from './stage.js';
import { castNpc, repairItem, useItem } from './effects.js';
import type { ModRuntime } from './runtime.js';

export interface ModResolveInput {
    readonly campaign: CampaignWritePort;
    readonly graph: ModuleGraph;
    readonly world: Row;
    readonly turn: Row;
    readonly action: Row;
    readonly callId: string;
    settlement(actorName?: any): Promise<SettleContext>;
}
export interface ModResolveResult { result: Row; receipts: Row[]; }
const field = (value: Row, key: string, fallback: any): any => Object.hasOwn(value, key) ? value[key] : fallback;
export const checkPair = (decision: string, actor: string, target: string): string => jsonDigest([decision, actor, target]);
export function recordedCheck(world: Row, pair: string): Row | null {
    const rows = values(row(row(world.mods).state)).filter(state => isJsonObject(state) && Object.hasOwn(row(state.checks), pair)).map(state => state.checks[pair]);
    return rows.reduce<Row | null>((old, current) => old === null || current.turn < old.turn ? current : old, null);
}
export async function requireChoiceSettled(kernel: KernelContext, input: ModResolveInput): Promise<void> {
    const snapshot = new CampaignSnapshot(kernel, input.campaign.id);
    snapshot.world = input.world; snapshot.turn = input.turn; await snapshot.preload('view');
    const pending = new SessionView(snapshot, input.graph, snapshot.party, input.world).pendingChoice() || input.turn.pending_choice;
    if (truth(pending)) throw new RpcError('turn_state', 'Settle the existing choice before a Mod action', {
        fix: "use the pending choice's ordinary rule action first", details: {pending_choice: pending}});
}
async function legacyImpression(kernel: KernelContext, directory: string, graph: ModuleGraph, actor: Row, target: Row, recipe: Row): Promise<Row | null> {
    const legacy = recipe.legacy;
    if (legacy.format !== 'npc-first-impression') throw new RpcError('invalid_params', 'Unknown legacy check format');
    const pathText = string(field(legacy, 'file', '')), parts = pathText.split('/').filter(part => part && part !== '.');
    if (isAbsolute(pathText) || parts.includes('..') || !parts.length || parts[0] !== 'save') throw new RpcError('invalid_params', 'Legacy check source must be a campaign save path');
    const path = join(directory, ...parts);
    if (!await kernel.snapshots.pathExists(path)) return null;
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || stat.size > 16000000) throw new RpcError('invalid_params', 'Invalid legacy check document');
    const document = row(await kernel.snapshots.readJson(path)), targetNames = new Set([target.node_id, graph.handle(target), graph.displayName(target)].map(normalize));
    for (const raw of values(document.receipts)) {
        if (raw.investigator_id !== actor.id || !targetNames.has(normalize(string(raw.npc_id)))) continue;
        const schema = raw.schema_version, expected = 'sha256:' + jsonDigest(Object.fromEntries(entries(raw).filter(([key]) => key !== 'integrity_digest')));
        if (!equal(schema, 1) && !equal(schema, 2) || raw.integrity_digest !== expected)
            throw new RpcError('campaign_not_ready', 'The existing first-impression receipt failed integrity validation; it will not be rerolled');
        const outcome: Row = {kind: 'check', legacy: true, status: 'recorded', impression: {reaction: field(raw, 'reaction_tier', raw.disposition ?? null), disposition: raw.disposition ?? null},
            actor: actor.name, target_npc: graph.displayName(target)};
        if (equal(schema, 2)) Object.assign(outcome, {roll: row(raw.roll_record).roll ?? null, target: raw.governing_value ?? null, level: raw.achieved_level ?? null, passed: raw.passed ?? null});
        const result = {outcome, decision: recipe.name, family: 'mod', receipts: [], effects: [], continuations: [], rule_refs: [raw.rule_ref ?? null],
            note: 'An existing first impression was retained. Do not reroll or disclose legacy hidden dice.'};
        return {turn: -1, actor: actor.id, target: target.node_id, result, receipt: {id: raw.receipt_id ?? null, kind: 'legacy-impression', visibility: 'keeper'}};
    }
    return null;
}
/**
 * The pair's earlier result (§26): the one recorded in the state, else one adopted from the legacy file the check declares.
 * An adopted result is written into the state here, so it is read from there next time. `adopted` says whether the world changed.
 */
export async function priorCheck(kernel: KernelContext, directory: string, graph: ModuleGraph, world: Row, modId: string, recipe: Row, actor: Row, target: Row):
    Promise<{prior: Row | null; adopted: boolean}> {
    const pair = checkPair(recipe.name, actor.id, target.node_id), recorded = recordedCheck(world, pair);
    if (recorded || !truth(recipe.legacy)) return {prior: recorded, adopted: false};
    const legacy = await legacyImpression(kernel, directory, graph, actor, target, recipe);
    if (!legacy) return {prior: null, adopted: false};
    checkState(world, modId)[pair] = legacy;
    return {prior: legacy, adopted: true};
}
function checkState(world: Row, modId: string): Row {
    const namespaces = world.mods.state;
    if (!Object.hasOwn(namespaces, modId)) namespaces[modId] = {};
    if (!Object.hasOwn(namespaces[modId], 'checks')) namespaces[modId].checks = {};
    return namespaces[modId].checks;
}
/**
 * One roll of a contributed actor-target check, recorded under its pair (§26). `resolve` calls it for a check it is asked
 * to settle; `presenceRolls` (§178.3) for a `presence` check the people's meeting owes. The world is changed, not written.
 */
export function rollModCheck(args: {world: Row; graph: ModuleGraph; modId: string; recipe: Row; actor: Row; target: Row; turn: number;
    receiptId: string; callId: string; arithmetic: CheckArithmetic; rng: PythonRandom; extra?: Row; orientedFrom?: Row | null}): {receipt: Row; result: Row} {
    const {world, graph, modId, recipe, actor, target, orientedFrom = null} = args;
    const choices: Array<[number, string]> = [];
    for (const spec of recipe.values) {
        const dot = spec.path.indexOf('.'), group = spec.path.slice(0, dot), key = spec.path.slice(dot + 1), value = row(actor[group])[key];
        if (!integer(value) || value < 0 || value > 100) throw new RpcError('invalid_params', `Actor has no valid ${spec.label} value`);
        choices.push([Number(value), spec.label]);
    }
    const [value, label] = choices.reduce((best, current) => current[0] > best[0] ? current : best), check = args.arithmetic.check(value, recipe.difficulty, 0, 0, args.rng);
    const impression = clone(recipe.results[check.level]);
    const receipt: Row = {id: args.receiptId, kind: 'roll', call_id: args.callId, roll_kind: 'mod_check', family: 'mod', mod: modId, decision: recipe.name,
        actor: actor.id, actor_label: actor.name, npc: graph.handle(target), skill: label, target: value, roll: check.roll, level: check.level, difficulty: recipe.difficulty,
        check, visibility: 'public', at: nowIso(), passed: check.passed, threshold: check.threshold, actor_is_investigator: true, impression,
        ...(orientedFrom ? {oriented_from: orientedFrom} : {}), ...(args.extra ?? {})};
    const result = {receipt: receipt.id, receipts: [receipt.id], decision: recipe.name, family: 'mod', outcome: {kind: 'check', ...check, skill: label,
        actor: actor.name, target_npc: graph.displayName(target), impression, attribute_snapshot: orderedObject(choices.map(([value, label]) => [label, value])),
        ...(orientedFrom ? {oriented_from: orientedFrom} : {})},
        effects: [], continuations: [], rule_refs: field(recipe, 'rule_refs', []),
        note: "Realize this impression through the NPC's actual manner and opportunity/friction, preserving their motives and boundaries."};
    checkState(world, modId)[checkPair(recipe.name, actor.id, target.node_id)] = {turn: args.turn, actor: actor.id, target: target.node_id, receipt, result};
    return {receipt, result};
}
export async function resolveBeforeMain(kernel: KernelContext, runtime: ModRuntime, input: ModResolveInput): Promise<ModResolveResult | null> {
    const {campaign, graph, world, turn, action, callId} = input;
    if (action.intent === 'cast' && truth(action.actor)) {
        const definition = findNamedObject(row(row(world.objects).definitions), string(action.spell || ''));
        const owner = await objectOwner(campaign, graph, world, action.actor);
        if (owner.kind === 'npc' && definition?.category === 'spell') {
            await requireChoiceSettled(kernel, input);
            const context = await input.settlement(), outcome = await castNpc(context, owner.name, definition);
            return {result: {outcome, decision: 'magic:cast-spell', effects: context.effects, continuations: [], rule_refs: [], family: 'magic', receipts: context.receipts.map(receipt => receipt.id)}, receipts: context.receipts};
        }
    }
    if (action.decision === 'objects:use' || action.decision === 'objects:repair') {
        await requireChoiceSettled(kernel, input);
        const owner = truth(action.actor) ? await objectOwner(campaign, graph, world, action.actor) : null;
        const context = await input.settlement(!owner || owner.kind === 'investigator' ? action.actor : undefined);
        if (owner?.kind === 'npc') context.actorId = owner.id;
        const operation = action.decision === 'objects:repair' ? repairItem : useItem, outcome = await operation(context, string(action.object || ''));
        return {result: {outcome, decision: action.decision, effects: context.effects, continuations: [], rule_refs: [], family: 'objects', receipts: context.receipts.map(receipt => receipt.id)}, receipts: context.receipts};
    }
    const found = (await runtime.decisions(world)).get(action.decision);
    if (!found) return null;
    await requireChoiceSettled(kernel, input);
    const [modId, recipe] = found;
    // SL-71 (§11.5.9 addendum, gate #11's t0/t19): this family's roles are fixed by the rules -- the
    // investigator rolls, the NPC is the target -- so a Keeper who names the NPC `actor` and the
    // investigator `target` (a first impression written as "Steven Knott's impression of Thomas
    // Hayes") has the right pair in the wrong order, not an unknown one. `input.settlement(name)`
    // only ever accepts an investigator; when the named `actor` is not one, try the named `target` as
    // the true actor before refusing, and only take the swap when it is real: the target really is an
    // investigator and the named "actor" really is a person the table knows. The receipt then carries
    // `oriented_from` so the Keeper sees the correction; a target that is also not an investigator, or
    // an "actor" the graph does not know either, is exactly the refusal it always was, now naming both
    // kinds of candidate.
    let targetName: any = action.target, orientedFrom: Row | null = null, context: SettleContext;
    try {
        context = await input.settlement(action.actor);
    }
    catch (error) {
        if (!(error instanceof RpcError) || error.code !== 'unknown_entity') throw error;
        if (targetName == null) throw enrichActorRefusal(error, action.actor, graph);
        let swapped: SettleContext;
        try {
            swapped = await input.settlement(targetName);
        }
        catch {
            throw enrichActorRefusal(error, action.actor, graph);
        }
        // §180.3: the named "actor" must be a person -- a first impression is never made on a creature.
        if (!graph.find(string(action.actor), ['npc'])) throw enrichActorRefusal(error, action.actor, graph);
        context = swapped;
        orientedFrom = {actor: action.actor, target: targetName};
        targetName = action.actor;
    }
    const actor = context.actor, target = graph.npc(targetName);
    // A refusal the Keeper can act on (§1). Without the `fix` and the list it was one sentence with
    // no next step and no `details`, so the class facet was the empty string too: three first
    // impressions for three different people, issued in one message before any of them answered,
    // collapsed into one refusal class and shut `resolve` for the turn. On an imported module the
    // people are staged in the very turn they are met, so that was every first contact in the book.
    // §180.3: the people of this meeting, never a creature present (`details.present` is the Keeper's list to roll against).
    const scene = graph.scene(world.active_scene), present = npcsPresent(graph, world, scene).filter(node => graph.isPerson(node));
    if (!present.some(node => node.node_id === target.node_id))
        throw new RpcError('not_here', `${graph.displayName(target)} is not in ${graph.displayName(scene)}, so there is no meeting to leave an impression`, {
            fix: `stage them first with apply {kind: "npc", name: ${repr(graph.displayName(target))}, to: "here", why: "<what puts them in this room>"}, then resolve this impression; or roll against one of details.present`,
            details: {field: 'target', npc: graph.handle(target), scene: graph.handle(scene), present: present.map(node => graph.displayName(node)).sort()}
        });
    const {prior, adopted} = await priorCheck(kernel, campaign.directory, graph, world, modId, recipe, actor, target);
    if (adopted) await campaign.writeWorld(world);
    if (prior) {
        const orphan = equal(prior.turn, turn.turn) && !array(turn.receipts).some(receipt => receipt.id === prior!.receipt.id);
        return {result: {...prior.result, reused: true}, receipts: orphan ? [prior.receipt] : []};
    }
    const {receipt, result} = rollModCheck({world, graph, modId, recipe, actor, target, turn: turn.turn, receiptId: `roll:mod-${modId}-${callId}`, callId,
        arithmetic: context.arithmetic, rng: context.rng, orientedFrom});
    await campaign.writeWorld(world);
    return {result, receipts: [receipt]};
}
