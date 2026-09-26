/**
 * The writer's half of contract §138: which intention of which person an effect or a roll is a result of, checked
 * before anything lands. An intention is named either by its reference (`intent_ref`, from the card, the offer or the
 * NPC advice) or by the line itself (`intends`, a new thing this person tries). Nothing here reads prose: a line is
 * its own identity, and a settled intention is found by that identity, never by what the words resemble.
 */
import {RpcError} from '../errors.js';
import type {KernelContext} from '../context.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {CampaignSnapshot} from '../read/campaign.js';
import {array, clone, number, row, string, type Row} from '../read/values.js';
import {INTENT_OUTCOMES, INTENT_TEXT_LIMIT, foldIntent, intentOf, intentOwner, intentRef, intentsOf, isSettled, openRows} from '../npc/intents.js';
import {responseBankFor} from '../npc/responses.js';

export interface IntentScope {
    readonly kernel: KernelContext;
    readonly campaign: {readonly id: string; readCampaign(): Promise<Row>};
    readonly graph: ModuleGraph;
    readonly world: Row;
    readonly turn: Row;
    staged?(): Row[];
}
export interface ResolvedIntent { ref: string; text: string; status: string | null; turn: number | null }

/** This person's ledger entry as it stands now: the committed ledger, then this turn's receipts, then this call's. */
export async function intentEntry(scope: IntentScope, node: Row): Promise<Row> {
    const snapshot = new CampaignSnapshot(scope.kernel, scope.campaign.id);
    const entry = clone(row(row(await snapshot.optional('npc-ledger.json'))[string(node.node_id)]));
    const handle = scope.graph.handle(node);
    for (const receipt of [...array(scope.turn.receipts), ...(scope.staged?.() ?? [])]) {
        const intent = row(row(receipt).intent);
        if (typeof intent.ref === 'string' && intent.npc === handle)
            foldIntent(entry, intent, number(scope.turn.turn), row(receipt).id);
    }
    return entry;
}
/** The rows of this person's current response bank, with references, that are still open. */
async function bankOptions(scope: IntentScope, node: Row, entry: Row): Promise<Row[]> {
    const meta = await scope.campaign.readCampaign(), worldline = string(meta.active_worldline || 'main');
    const loaded = {graph: scope.graph, world: scope.world, scope: {worldline, loop: number(row(row(meta.worldlines)[worldline]).loop)}};
    const snapshot = new CampaignSnapshot(scope.kernel, scope.campaign.id);
    try { return openRows(await responseBankFor(loaded, node, file => snapshot.optional(file)), scope.graph.handle(node), entry); }
    catch { return []; }
}
/** What a writer may name: this person's intentions under way, then the open rows of their response bank. */
export async function intentOptions(scope: IntentScope, node: Row, entry?: Row): Promise<Row[]> {
    const current = entry ?? await intentEntry(scope, node);
    const under = intentsOf(current).filter(item => !isSettled(item.status)).map(item => ({ref: item.ref, intent: item.text, status: item.status}));
    const known = new Set(under.map(item => item.ref));
    return [...under, ...(await bankOptions(scope, node, current)).filter(item => !known.has(item.ref)).map(item => ({ref: item.ref, intent: item.intent}))];
}

/**
 * Which intention `fields` names for this person. `field` is the effect path the refusal points at. The result carries
 * where the intention stands now (`status`, null when this is its first result).
 */
export async function resolveIntent(scope: IntentScope, node: Row, fields: {intends?: unknown; intent_ref?: unknown}, field: string): Promise<ResolvedIntent> {
    const handle = scope.graph.handle(node), who = scope.graph.displayName(node), entry = await intentEntry(scope, node);
    let text: string | null = null, ref: string | null = null;
    if (fields.intends != null) {
        if (typeof fields.intends !== 'string' || !fields.intends.trim() || Array.from(fields.intends.trim()).length > INTENT_TEXT_LIMIT || fields.intends.includes('{{'))
            throw new RpcError('invalid_params', `${field}.intends must be one line saying what ${who} is trying to do`, {
                fix: `write it in one Keeper-facing sentence of at most ${INTENT_TEXT_LIMIT} characters, no markers`, details: {field: `${field}.intends`}});
        text = fields.intends.trim();
        ref = intentRef(handle, text);
    }
    if (fields.intent_ref != null) {
        const owner = intentOwner(fields.intent_ref);
        if (owner === null)
            throw new RpcError('invalid_params', `${field}.intent_ref ${JSON.stringify(fields.intent_ref)} is not an intention reference`, {
                fix: 'copy a ref from details.options, from present[].history.intents or from the NPC advice; or write the new thing this person tries with intends',
                details: {field: `${field}.intent_ref`, options: await intentOptions(scope, node, entry)}});
        if (owner !== handle)
            throw new RpcError('invalid_params', `${field}.intent_ref belongs to ${owner}, not to ${who}`, {
                fix: `name ${who}'s own intention (details.options), or put the result on the effect about ${owner}`,
                details: {field: `${field}.intent_ref`, owner, options: await intentOptions(scope, node, entry)}});
        if (ref !== null && ref !== fields.intent_ref)
            throw new RpcError('invalid_params', `${field}.intends and ${field}.intent_ref name two different intentions`, {
                fix: 'give one of them: the ref of an intention already on the card, or the line of a new one', details: {field: `${field}.intent_ref`}});
        ref = fields.intent_ref as string;
        // Not `string()`: it renders an absent value as the word "None", which would pass for a line (string-helper trap).
        const known = intentOf(entry, ref)?.text, banked = (await bankOptions(scope, node, entry)).find(item => item.ref === ref)?.intent;
        text ??= typeof known === 'string' && known ? known : typeof banked === 'string' && banked ? banked : null;
        if (text === null)
            throw new RpcError('invalid_params', `${who} has no intention ${ref} on the card or in their prepared responses`, {
                fix: 'copy a ref from details.options, or write the new thing this person tries with intends',
                details: {field: `${field}.intent_ref`, reason: 'unknown_intent', options: await intentOptions(scope, node, entry)}});
    }
    if (ref === null || text === null)
        throw new RpcError('invalid_params', `${field} names no intention`, {fix: 'give intent_ref (an intention on the card) or intends (a new one)', details: {field}});
    const known = intentOf(entry, ref);
    return {ref, text, status: known ? string(known.status) : null, turn: known ? number(known.last_turn) : null};
}

/**
 * A settled intention is not tried again (the owner's ruling of 2026-09-26: what a person announces gets a result, and
 * the same thing is not done twice in a row). Refused with what is still open, so the next call has somewhere to go.
 */
export async function refuseSettled(scope: IntentScope, node: Row, resolved: ResolvedIntent, field: string): Promise<void> {
    if (!isSettled(resolved.status)) return;
    const who = scope.graph.displayName(node);
    throw new RpcError('invalid_params', `${who}'s intention "${resolved.text}" was settled (${resolved.status}) on turn ${resolved.turn}; a settled intention is not tried again`, {
        fix: `choose another of ${who}'s intentions in details.options, or write the new thing ${who} does now with intends -- given how that one ended`,
        details: {field, reason: 'intent_settled', ref: resolved.ref, status: resolved.status, turn: resolved.turn, options: await intentOptions(scope, node)}});
}

/** The `intent` a receipt carries (§138.2). */
export function intentStamp(handle: string, resolved: ResolvedIntent, outcome: string): Row {
    if (!INTENT_OUTCOMES.includes(outcome)) throw new Error(`unknown intent outcome ${outcome}`);
    return {ref: resolved.ref, npc: handle, text: resolved.text, outcome};
}
