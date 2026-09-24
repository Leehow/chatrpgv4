/** Optional writing advice. Only the host issues packets; examples never become campaign evidence. */
import {createHash} from 'node:crypto';
import {renderCraftReference} from '../../runtime/craft/reference.ts';
import {object, type Row} from './context-policy.ts';
export const CRAFT_REFERENCE_TYPE = 'coc-craft-reference';
export const CRAFT_INVALIDATION_TYPE = 'coc-craft-reference-invalidated';
export type CraftRpc = (method: string, params: Row) => Promise<unknown>;
export type CraftSelector = (input: {index: Row; capsule: Row; signal: AbortSignal; epoch: string; deadlineAt: number}) => Promise<string | null>;
export interface CraftPacket {identity: Row; cardId: string; message: Row; bytes: number;
    withoutExample?: {message: Row; bytes: number}}
export type CraftPreparation = {status: 'ready'; packet: CraftPacket} | {status: 'omitted'; reason: string};
export const craftMode = (capsule: Row): boolean => object(object(capsule.mods).craft_reference).mode === 'jev';
const identityOf = (value: Row): Row => ({provider: value.provider, catalog_revision: value.catalog_revision, binding: value.binding});
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function prepareCraftReference(input: {rpc: CraftRpc; capsule: Row; binding: Row; campaign: string; epoch: string;
    signal: AbortSignal; selector?: CraftSelector; maxBytes?: number; deadlineAt: number}): Promise<CraftPreparation> {
    if (!craftMode(input.capsule)) return {status: 'omitted', reason: 'disabled'};
    if (!input.selector) return {status: 'omitted', reason: 'selector_unavailable'};
    const check = () => {input.signal.throwIfAborted(); if (Date.now() >= input.deadlineAt) throw new Error('deadline');};
    try {
        check();
        const index = object(await input.rpc('mods.craft.read', {campaign: input.campaign, mode: 'index'}));
        check();
        if (index.status !== 'ready' || !Array.isArray(index.candidates)) return {status: 'omitted', reason: 'index_unavailable'};
        const currentBinding = object(index.binding);
        if (['campaign', 'worldline', 'loop', 'turn', 'source_revision', 'world_revision', 'npc_revision', 'memory_revision']
            .some(key => input.binding[key] === undefined || input.binding[key] !== currentBinding[key]))
            return {status: 'omitted', reason: 'context_changed'};
        const requestedProvider = object(object(input.capsule.mods).craft_reference).provider;
        if (object(requestedProvider).mod !== object(index.provider).mod || object(requestedProvider).version !== object(index.provider).version)
            return {status: 'omitted', reason: 'provider_changed'};
        const cardId = await input.selector({index, capsule: input.capsule, signal: input.signal, epoch: input.epoch, deadlineAt: input.deadlineAt});
        check();
        if (cardId === null || cardId === 'NONE') return {status: 'omitted', reason: 'none'};
        if (typeof cardId !== 'string' || !index.candidates.some(value => object(value).id === cardId))
            return {status: 'omitted', reason: 'choice_not_issued'};
        const identity = identityOf(index);
        const result = object(await input.rpc('mods.craft.read', {campaign: input.campaign, mode: 'card', card_id: cardId, expected: identity}));
        check();
        if (result.status !== 'ready' || digest(identityOf(result)) !== digest(identity)) return {status: 'omitted', reason: 'stale_reference'};
        const reference = renderCraftReference(result.card, String(result.catalog_revision), {maxBytes: Math.min(1800, input.maxBytes ?? 1800)});
        if (!reference) return {status: 'omitted', reason: 'reference_budget'};
        const message = (text: string): Row => ({
            role: 'custom', customType: CRAFT_REFERENCE_TYPE, content: text, display: false, timestamp: 0,
            details: {coc_host: true, craft: {epoch: input.epoch, ...identity, card_id: cardId, content_digest: digest(text)}},
        });
        const core = reference.exampleVariant ? renderCraftReference(result.card, String(result.catalog_revision),
            {maxBytes: 1800, includeExample: false}) : null;
        return {status: 'ready', packet: {identity, cardId, bytes: reference.bytes, message: message(reference.text),
            ...(core ? {withoutExample: {message: message(core.text), bytes: core.bytes}} : {})}};
    } catch {
        return {status: 'omitted', reason: input.signal.aborted ? 'cancelled' : Date.now() >= input.deadlineAt ? 'deadline' : 'reference_unavailable'};
    }
}

/** A run owner can abandon a slow read without waiting for its optional transport to finish. */
export async function prepareCraftWithinDeadline(input: Parameters<typeof prepareCraftReference>[0]): Promise<CraftPreparation> {
    const remaining = input.deadlineAt - Date.now();
    if (remaining <= 0) return {status: 'omitted', reason: 'deadline'};
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(remaining)]);
    let abort = () => {};
    try {
        signal.throwIfAborted();
        return await Promise.race([prepareCraftReference({...input, signal}), new Promise<never>((_, reject) => {
            abort = () => reject(signal.reason); signal.addEventListener('abort', abort, {once: true});
        })]);
    } catch {return {status: 'omitted', reason: input.signal.aborted ? 'cancelled' : 'deadline'};}
    finally {signal.removeEventListener('abort', abort);}
}

/** Revalidation reads only; failure never re-enters selection or grants a new request budget. */
export async function craftStillCurrent(packet: CraftPacket, rpc: CraftRpc, campaign: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    try {
        const current = object(await rpc('mods.craft.read', {campaign, mode: 'index', expected: packet.identity}));
        return !signal.aborted && current.status === 'ready' && digest(identityOf(current)) === digest(packet.identity);
    } catch {return false;}
}
