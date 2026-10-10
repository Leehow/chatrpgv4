/** One foreground allowance across source binding, retained original retrieval and fallback. */
import {wakeReaderSlots, type ReaderPriority} from './reader.ts';
import {HELD_SOURCE_ENTRIES, HELD_SOURCE_RAW_BYTES} from '../kernel/source-answers.ts';
type Row = Record<string, any>;
type Wait = {pending: boolean; reference?: Reference; key?: string};
type Reference = {controller: AbortController; waits: Set<Wait>; retained: boolean; blocking: boolean; task: Promise<Row | undefined>; value?: Row; bytes: number};
export interface SourceConsultation {
    campaign: string; moduleId: string; worldline?: string; loop?: number;
    focus: string; question: string; mode: 'answer' | 'prepare'; retry?: boolean;
    allowanceMs: number; signal?: AbortSignal;
    binding(signal: AbortSignal): Promise<string>;
    accepted?(signal: AbortSignal): Promise<Row | undefined>;
    reference(signal: AbortSignal, priority: ReaderPriority): Promise<Row | undefined>;
    fallback(signal: AbortSignal, options: {allowanceMs: number; foreground: boolean; blocking: boolean}): Promise<Row>;
}
export class SourceConsultations {
    private references = new Map<string, Reference>();
    private workflows = new Set<AbortController>();
    private closed = false;
    private readonly record: (row: Row) => void;
    private readonly now: () => number;
    private readonly timer: (callback: () => void, ms: number) => () => void;
    constructor(record: (row: Row) => void = () => {}, now = Date.now,
        timer = (callback: () => void, ms: number): (() => void) => {
            const id = setTimeout(callback, ms); return () => clearTimeout(id);
        }) {this.record = record; this.now = now; this.timer = timer;}

    async lookup(input: SourceConsultation): Promise<Row> {
        if (this.closed) throw Error('Source query owner is closed');
        input.signal?.throwIfAborted();
        const began = this.now(), deadline = began + input.allowanceMs, controller = new AbortController(), wait: Wait = {pending: false};
        this.workflows.add(controller);
        const note = (event: string, fields: Row = {}) => this.record({lane: 'source-consultation', event, campaign: input.campaign,
            module_id: input.moduleId, focus: input.focus, purpose: input.mode, ...fields});
        let publishPending: ((response?: Row) => void) | undefined;
        const settled = (async () => {
            const revision = await input.binding(controller.signal);
            controller.signal.throwIfAborted();
            if (typeof revision !== 'string' || !revision) throw Error('Source query binding is unavailable');
            if (input.mode === 'answer' && !input.retry && input.accepted) {
                const accepted = await input.accepted(controller.signal);
                controller.signal.throwIfAborted();
                if (accepted) {note('accepted_cache'); return accepted;}
            }
            const key = JSON.stringify([input.campaign, input.moduleId, input.worldline, input.loop, revision, input.mode, input.focus, input.question]);
            let reference = this.references.get(key);
            if (reference?.value && input.retry) reference = undefined;
            if (reference?.value) {
                note('result_cache');
                // Touch the bounded completed cache, without discarding a live owner.
                this.references.delete(key); this.references.set(key, reference);
            } else if (reference) note('reference_join');
            else {
                const owned: Reference = {controller: new AbortController(), waits: new Set(), retained: false,
                    blocking: input.mode === 'prepare', task: Promise.resolve(undefined), bytes: 0};
                reference = owned;
                this.references.set(key, owned);
                note('reference_start');
                owned.task = Promise.resolve().then(() => input.reference(owned.controller.signal,
                    () => owned.blocking || [...owned.waits].some(value => !value.pending) ? 'foreground' : 'background')).then(value => {
                    // Only checked original envelopes are reusable; generated answers keep the kernel's own memo.
                    if (value?.source_answer?.authority === 'original-source-excerpts' && !owned.controller.signal.aborted) {
                        const bytes = Buffer.byteLength(JSON.stringify(value));
                        if (bytes <= HELD_SOURCE_RAW_BYTES) { owned.value = structuredClone(value); owned.bytes = bytes; }
                    }
                    return value;
                }).finally(() => {
                    if (this.references.get(key) === owned && !owned.value && !owned.waits.size) this.references.delete(key);
                    this.trim();
                });
            }
            wait.reference = reference;
            wait.key = key;
            reference.waits.add(wait);
            if (wait.pending) reference.retained = true;
            const original = await new Promise<Row | undefined>((resolve, reject) => {
                    const aborted = () => reject(controller.signal.reason);
                    controller.signal.addEventListener('abort', aborted, {once: true});
                    reference!.task.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', aborted));
                    if (controller.signal.aborted) aborted();
            });
            controller.signal.throwIfAborted();
            if (original) { note('complete'); return structuredClone(original); }
            const elapsed = Math.max(0, this.now() - began), remaining = Math.max(0, input.allowanceMs - elapsed);
            note('fallback_start', {elapsed_ms: elapsed, remaining_ms: remaining});
            // Each caller joins the existing reading service; its waiter ownership and promotion remain authoritative.
            const response = await input.fallback(controller.signal, {allowanceMs: remaining,
                foreground: !wait.pending || input.mode === 'prepare', blocking: input.mode === 'prepare'});
            if (response.state === 'pending' && response.settled) publishPending?.(response);
            const result = response.state === 'pending' && response.settled ? await response.settled : response;
            note('complete'); return result;
        })();
        const finished = () => {
            this.workflows.delete(controller);
            const reference = wait.reference;
            if (!reference) return;
            reference.waits.delete(wait);
            if (controller.signal.aborted && !reference.waits.size && !reference.retained) reference.controller.abort();
            if (!reference.value && !reference.waits.size && this.references.get(wait.key!) === reference) this.references.delete(wait.key!);
        };
        settled.then(finished, finished);
        let cancelTimer: (() => void) | undefined, aborted: (() => void) | undefined;
        try {
            const pending = new Promise<Row>((resolve, reject) => {
                publishPending = response => {
                    if (wait.pending) return;
                    wait.pending = true;
                    if (wait.reference) wait.reference.retained = true;
                    wakeReaderSlots(); note('deadline_pending');
                    resolve({state: 'pending', read: {focus: input.focus, question: input.question}, index: [], ...response, settled});
                };
                cancelTimer = this.timer(() => publishPending?.(), Math.max(0, deadline - this.now()));
                aborted = () => {controller.abort(input.signal?.reason); reject(controller.signal.reason);};
                input.signal?.addEventListener('abort', aborted, {once: true});
                if (input.signal?.aborted) aborted();
            });
            return await Promise.race([settled, pending]);
        } finally {
            cancelTimer?.(); if (aborted) input.signal?.removeEventListener('abort', aborted);
        }
    }
    private trim(): void {
        let bytes = 0, count = 0;
        for (const [key, ref] of [...this.references].reverse()) if (ref.value) {
            if (count >= HELD_SOURCE_ENTRIES || bytes + ref.bytes > HELD_SOURCE_RAW_BYTES) this.references.delete(key);
            else {bytes += ref.bytes; count++;}
        }
    }
    close(): void {
        this.closed = true;
        for (const controller of this.workflows) controller.abort();
        for (const reference of this.references.values()) reference.controller.abort();
        this.references.clear();
    }
}
