/** One ephemeral craft attempt per input. Ordinary request material always has budget priority. */
import {createHash} from 'node:crypto';
import {object, requestSize, type Row} from './context-policy.ts';
import {CRAFT_REFERENCE_TYPE, CRAFT_INVALIDATION_TYPE, craftMode, prepareCraftReference, craftStillCurrent,
    type CraftSelector, type CraftRpc, type CraftPacket, type CraftPreparation} from './craft-reference.ts';

export interface CraftRequest {
    epoch: string; campaign: string; capsule: Row; binding: Row; messages: Row[]; budget: number;
    rpc: CraftRpc; signal: AbortSignal;
}
interface Attempt {epoch: string; controller: AbortController; result?: CraftPreparation; pending?: Promise<CraftPreparation>; issued: boolean; stale: boolean;
    deadlineAt?: number; withdrawalAt?: number; reported?: boolean}
const omitted = (reason: string): CraftPreparation => ({status: 'omitted', reason});
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
async function bounded<T>(work: Promise<T>, signal: AbortSignal, deadlineAt: number): Promise<T> {
    const left = deadlineAt - Date.now();
    if (left <= 0) throw new Error('craft_deadline');
    const combined = AbortSignal.any([signal, AbortSignal.timeout(left)]);
    combined.throwIfAborted();
    let abort = () => {};
    try {
        return await Promise.race([work, new Promise<never>((_, reject) => {
            abort = () => reject(combined.reason); combined.addEventListener('abort', abort, {once: true});
        })]);
    } finally {combined.removeEventListener('abort', abort);}
}
export class CraftReferenceRuntime {
    private attempt?: Attempt;
    private select: CraftSelector | undefined;
    private readonly record: (row: Row) => void;
    constructor(select: CraftSelector | undefined, record: (row: Row) => void) {this.select = select; this.record = record;}
    reset(): void {this.attempt?.controller.abort(); this.attempt = undefined;}
    hasAttempt(epoch: string): boolean {return this.attempt?.epoch === epoch;}
    setSelector(select: CraftSelector | undefined): void {this.select = select;}
    /** Only the current run owner supplies this result; session messages are never an adoption source. */
    adopt(epoch: string, result: CraftPreparation): void {
        if (this.attempt?.epoch === epoch) return;
        this.reset();
        const rebind = (message: Row): Row => ({...message, details: {...object(message.details),
            craft: {...object(object(message.details).craft), epoch}}});
        const bound = result.status === 'ready' ? {status: 'ready' as const, packet: {...result.packet,
            message: rebind(result.packet.message), ...(result.packet.withoutExample ? {withoutExample: {
                ...result.packet.withoutExample, message: rebind(result.packet.withoutExample.message)}} : {})}} : result;
        this.attempt = {epoch, controller: new AbortController(), result: bound, issued: false, stale: false};
    }
    async project(input: CraftRequest): Promise<{messages: Row[]; packet?: CraftPacket; active?: boolean}> {
        // Never trust a packet retained by a session, caller or previous request as a newly issued reference.
        const messages = input.messages.filter(message => message.role !== 'custom'
            || ![CRAFT_REFERENCE_TYPE, CRAFT_INVALIDATION_TYPE].includes(message.customType));
        if (input.signal.aborted) return {messages};
        const enabled = craftMode(input.capsule);
        if (!this.attempt || this.attempt.epoch !== input.epoch) {
            this.reset();
            this.attempt = {epoch: input.epoch, controller: new AbortController(), issued: false, stale: false};
        }
        const attempt = this.attempt;
        const scopeSignal = AbortSignal.any([input.signal, attempt.controller.signal]);
        const record = (event: string, extra: Row = {}) => this.record({lane: 'craft', event, epoch: input.epoch, turn: input.binding.turn, ...extra});
        const slack = Math.max(0, input.budget - requestSize(messages));
        if (!attempt.result && !attempt.pending) {
            if (!enabled || !this.select) attempt.result = omitted(enabled ? 'selector_unavailable' : 'disabled');
            else if (slack <= 0) attempt.result = omitted('request_budget');
            else {
                const deadlineAt = Date.now() + 1500;
                attempt.deadlineAt = deadlineAt;
                const signal = AbortSignal.any([scopeSignal, AbortSignal.timeout(1500)]);
                attempt.pending = bounded(prepareCraftReference({rpc: input.rpc, campaign: input.campaign, capsule: input.capsule,
                    binding: input.binding, epoch: input.epoch, selector: this.select, signal, deadlineAt,
                    maxBytes: Math.min(1800, Math.floor(slack))}), signal, deadlineAt)
                    .catch(() => omitted(scopeSignal.aborted ? 'cancelled' : 'deadline'))
                    .then(result => {attempt.result = result; return result;});
            }
            if (attempt.result?.status === 'omitted') {record('omitted', {reason: attempt.result.reason}); attempt.reported = true;}
        }
        const result = attempt.result ?? await attempt.pending!;
        if (scopeSignal.aborted || this.attempt !== attempt) {
            if (this.attempt === attempt) {
                record('omitted', {reason: 'cancelled'});
                if (!attempt.issued) {attempt.result = omitted('cancelled'); attempt.pending = undefined;}
            }
            return {messages};
        }
        if (result.status !== 'ready') {
            if (!attempt.reported) {record('omitted', {reason: result.reason}); attempt.reported = true;}
            attempt.pending = undefined;
            return {messages};
        }
        if (!attempt.reported) {
            record('selected', {card_id: result.packet.cardId, provider: result.packet.identity.provider,
                catalog_revision: result.packet.identity.catalog_revision});
            record('rendered', {bytes: result.packet.bytes});
            attempt.reported = true;
            attempt.pending = undefined;
        }
        let current = false;
        if (enabled && !attempt.stale) try {
            current = await bounded(craftStillCurrent(result.packet, input.rpc, input.campaign, scopeSignal), scopeSignal,
                attempt.issued ? Date.now() + 1500 : attempt.deadlineAt ?? Date.now() + 1500);
        } catch {current = false;}
        if (scopeSignal.aborted || this.attempt !== attempt) {
            if (this.attempt === attempt) {
                record('omitted', {reason: 'cancelled'});
                if (!attempt.issued) {attempt.result = omitted('cancelled'); attempt.pending = undefined;}
            }
            return {messages};
        }
        if (!current) attempt.stale = true;
        if (attempt.stale && !attempt.issued) {record('omitted', {reason: 'stale_reference'}); return {messages};}
        const capsuleIndex = messages.findIndex(message => message.role === 'custom' && message.customType === 'coc-capsule');
        if (capsuleIndex < 0) {record('omitted', {reason: 'capsule_unavailable'}); return {messages};}
        // Stable placement after the fixed start-of-turn capsule preserves the single-loop prefix.
        // If already seen advice expires, keep that historical prefix and append a narrow withdrawal.
        const outgoing = [...messages];
        outgoing.splice(capsuleIndex + 1, 0, result.packet.message);
        if (attempt.stale) {
            attempt.withdrawalAt ??= outgoing.length;
            outgoing.splice(Math.min(attempt.withdrawalAt, outgoing.length), 0, {role: 'custom', customType: CRAFT_INVALIDATION_TYPE, display: false, timestamp: 0,
                content: 'The optional craft reference earlier in this input is no longer current. Ignore it; use the ordinary Keeper guidance and current facts.',
                details: {coc_host: true, craft: {epoch: input.epoch, invalidated: true}}});
        }
        if (!attempt.issued && requestSize(outgoing) > input.budget && result.packet.withoutExample) {
            const {withoutExample, ...packet} = result.packet;
            result.packet = {...packet, ...withoutExample};
            outgoing[capsuleIndex + 1] = result.packet.message;
            record('rendered', {bytes: result.packet.bytes, example_omitted: true, reason: 'serialized_request_budget'});
        }
        if (requestSize(outgoing) > input.budget) {
            record('omitted', {reason: 'request_budget'});
            return {messages};
        }
        attempt.issued = true;
        record(attempt.stale ? 'invalidated' : 'projected', {card_id: result.packet.cardId,
            bytes: result.packet.bytes, content_digest: hash(String(result.packet.message.content))});
        return {messages: outgoing, packet: result.packet, active: !attempt.stale};
    }
}
