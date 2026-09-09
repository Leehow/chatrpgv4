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
import type { ModuleGraph } from '../read/module-graph.js';
import { array, clone, entries, equal, integer, normalize, row, string, truth, values, type Row } from '../read/values.js';
import type { SettleContext } from '../resolve/context.js';
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
async function legacyImpression(kernel: KernelContext, input: ModResolveInput, actor: Row, target: Row, recipe: Row): Promise<Row | null> {
    const legacy = recipe.legacy;
    if (legacy.format !== 'npc-first-impression') throw new RpcError('invalid_params', 'Unknown legacy check format');
    const pathText = string(field(legacy, 'file', '')), parts = pathText.split('/').filter(part => part && part !== '.');
    if (isAbsolute(pathText) || parts.includes('..') || !parts.length || parts[0] !== 'save') throw new RpcError('invalid_params', 'Legacy check source must be a campaign save path');
    const path = join(input.campaign.directory, ...parts);
    if (!await kernel.snapshots.pathExists(path)) return null;
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || stat.size > 16000000) throw new RpcError('invalid_params', 'Invalid legacy check document');
    const document = row(await kernel.snapshots.readJson(path)), targetNames = new Set([target.node_id, input.graph.handle(target), input.graph.displayName(target)].map(normalize));
    for (const raw of values(document.receipts)) {
        if (raw.investigator_id !== actor.id || !targetNames.has(normalize(string(raw.npc_id)))) continue;
        const schema = raw.schema_version, expected = 'sha256:' + jsonDigest(Object.fromEntries(entries(raw).filter(([key]) => key !== 'integrity_digest')));
        if (!equal(schema, 1) && !equal(schema, 2) || raw.integrity_digest !== expected)
            throw new RpcError('campaign_not_ready', 'The existing first-impression receipt failed integrity validation; it will not be rerolled');
        const outcome: Row = {kind: 'check', legacy: true, status: 'recorded', impression: {reaction: field(raw, 'reaction_tier', raw.disposition ?? null), disposition: raw.disposition ?? null},
            actor: actor.name, target_npc: input.graph.displayName(target)};
        if (equal(schema, 2)) Object.assign(outcome, {roll: row(raw.roll_record).roll ?? null, target: raw.governing_value ?? null, level: raw.achieved_level ?? null, passed: raw.passed ?? null});
        const result = {outcome, decision: recipe.name, family: 'mod', receipts: [], effects: [], continuations: [], rule_refs: [raw.rule_ref ?? null],
            note: 'An existing first impression was retained. Do not reroll or disclose legacy hidden dice.'};
        return {turn: -1, actor: actor.id, target: target.node_id, result, receipt: {id: raw.receipt_id ?? null, kind: 'legacy-impression', visibility: 'keeper'}};
    }
    return null;
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
    const [modId, recipe] = found, context = await input.settlement(action.actor), actor = context.actor, target = graph.npc(action.target);
    if (!npcsPresent(graph, world, graph.scene(world.active_scene)).some(node => node.node_id === target.node_id)) throw new RpcError('not_here', 'The first-impression target must be present');
    const pair = checkPair(recipe.name, actor.id, target.node_id), namespaces = world.mods.state;
    if (!Object.hasOwn(namespaces, modId)) namespaces[modId] = {};
    if (!Object.hasOwn(namespaces[modId], 'checks')) namespaces[modId].checks = {};
    const state = namespaces[modId].checks;
    let prior = recordedCheck(world, pair);
    if (!prior && truth(recipe.legacy)) {
        prior = await legacyImpression(kernel, input, actor, target, recipe);
        if (prior) { state[pair] = prior; await campaign.writeWorld(world); }
    }
    if (prior) {
        const orphan = equal(prior.turn, turn.turn) && !array(turn.receipts).some(receipt => receipt.id === prior!.receipt.id);
        return {result: {...prior.result, reused: true}, receipts: orphan ? [prior.receipt] : []};
    }
    const choices: Array<[number, string]> = [];
    for (const spec of recipe.values) {
        const dot = spec.path.indexOf('.'), group = spec.path.slice(0, dot), key = spec.path.slice(dot + 1), value = row(actor[group])[key];
        if (!integer(value) || value < 0 || value > 100) throw new RpcError('invalid_params', `Actor has no valid ${spec.label} value`);
        choices.push([Number(value), spec.label]);
    }
    const [value, label] = choices.reduce((best, current) => current[0] > best[0] ? current : best), check = context.arithmetic.check(value, recipe.difficulty, 0, 0, context.rng);
    const impression = clone(recipe.results[check.level]);
    const receipt: Row = {id: `roll:mod-${modId}-${callId}`, kind: 'roll', call_id: callId, roll_kind: 'mod_check', family: 'mod', mod: modId, decision: recipe.name,
        actor: actor.id, actor_label: actor.name, npc: graph.handle(target), skill: label, target: value, roll: check.roll, level: check.level, difficulty: recipe.difficulty,
        check, visibility: 'public', at: nowIso(), passed: check.passed, threshold: check.threshold, actor_is_investigator: true, impression};
    const result = {receipt: receipt.id, receipts: [receipt.id], decision: recipe.name, family: 'mod', outcome: {kind: 'check', ...check, skill: label,
        actor: actor.name, target_npc: graph.displayName(target), impression, attribute_snapshot: orderedObject(choices.map(([value, label]) => [label, value]))},
        effects: [], continuations: [], rule_refs: field(recipe, 'rule_refs', []),
        note: "Realize this impression through the NPC's actual manner and opportunity/friction, preserving their motives and boundaries."};
    state[pair] = {turn: turn.turn, actor: actor.id, target: target.node_id, receipt, result}; await campaign.writeWorld(world);
    return {result, receipts: [receipt]};
}
