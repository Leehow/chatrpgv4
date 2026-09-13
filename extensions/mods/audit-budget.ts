/** Retained per-turn review accounting; this never changes campaign gameplay state. */
import {mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {AUDIT_LIMITS} from '../../kernel-ts/mods/audit-result.ts';
import {KernelError} from '../kernel/client.ts';

export const reviewUnavailable = (cause: string) => new KernelError({code: 'needs',
    message: 'Continuity review is paused; no draft was approved',
    fix: 'Preserve settled actions and await explicit player input before another review attempt. Do not rewrite or repeat the audit automatically.',
    details: {reason: 'continuity_review_unavailable', cause}});
function atomic(path: string, value: unknown) {
    const temp = `${path}.${randomUUID()}.tmp`, fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, path);
}
type Reservation = {requests: number; ms: number; started_at: number};
export class AuditBudget {
    private readonly file: string;
    private fd?: number;
    private state: any;
    readonly limits: typeof AUDIT_LIMITS;
    constructor(scope: string, inputToken?: string, limits = AUDIT_LIMITS) {
        this.limits = limits;
        mkdirSync(scope, {recursive: true}); this.file = join(scope, 'review-budget.json');
        try {
            this.fd = openSync(join(scope, 'review.lock'), 'a+', 0o600);
            try { createRequire(import.meta.url)('fs-ext').flockSync(this.fd, 'exnb'); }
            catch (error) {
                if (['EAGAIN', 'EWOULDBLOCK'].includes((error as NodeJS.ErrnoException).code ?? '')) throw reviewUnavailable('Another review owns this turn');
                throw error;
            }
            try { this.state = JSON.parse(readFileSync(this.file, 'utf8')); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            if (!this.state) this.state = this.fresh(inputToken);
            if (this.state.version !== 1 || !Array.isArray(this.state.previous) ||
                !['requests', 'ms', 'rewrites', 'artifact_repairs'].every(k => Number.isFinite(this.state[k]) && this.state[k] >= 0))
                throw reviewUnavailable('Retained review accounting is invalid');
            if (this.state.active) { this.state.blocked = 'An interrupted review retains its reserved allowance'; this.save(); }
            if (this.state.blocked && inputToken && inputToken !== this.state.input_token) {
                const {previous, ...last} = this.state;
                this.state = {...this.fresh(inputToken), previous: [...previous, last]}; this.save();
            }
            if (this.state.blocked) throw reviewUnavailable(this.state.blocked);
        } catch (error) { this.close(); throw error; }
    }
    private fresh(inputToken?: string) { return {version: 1, input_token: inputToken ?? null, requests: 0, ms: 0, rewrites: 0, artifact_repairs: 0, reviewed_jobs: {}, previous: [], blocked: null}; }
    private save() { atomic(this.file, this.state); }
    start(preparationMs = 0): {max_requests: number; max_artifact_repairs: number; timeoutMs: number} {
        const requests = Math.min(this.limits.per_review, this.limits.max_requests - this.state.requests);
        this.state.ms += Math.max(0, preparationMs);
        // One review reserves one review's worth, never the whole remaining allowance: otherwise the first
        // review eats the budget and the repair `max_rewrites` permits is unaffordable (§37.9).
        const ms = Math.min(this.limits.per_review_ms, this.limits.time_ms - this.state.ms);
        if (requests <= 0 || ms <= 0) this.fail('The shared review allowance is exhausted');
        this.state.active = {requests, ms, started_at: Date.now()} satisfies Reservation;
        // Charge ahead: a crashed host cannot silently refund a partly consumed session.
        this.state.requests += requests; this.state.ms += ms; this.save();
        return {max_requests: requests, max_artifact_repairs: Math.max(0, this.limits.max_artifact_repairs - this.state.artifact_repairs), timeoutMs: ms};
    }
    finish(requests: number, artifactRepairs: number) {
        const active: Reservation | undefined = this.state.active;
        if (!active) return;
        const used = Math.max(0, Date.now() - active.started_at);
        this.state.requests += Math.max(0, requests) - active.requests;
        this.state.ms += used - active.ms;
        this.state.artifact_repairs += Math.max(0, artifactRepairs);
        delete this.state.active; this.save();
        if (requests > active.requests) this.fail('The private review exceeded its reserved model-call allowance');
        if (this.state.requests > this.limits.max_requests || this.state.ms > this.limits.time_ms || this.state.artifact_repairs > this.limits.max_artifact_repairs)
            this.fail('The shared review allowance is exhausted');
    }
    verdict(job: string, verdict: string) {
        if (verdict === 'unavailable') this.fail('The reviewer could not establish a reliable continuity verdict');
        if (verdict === 'revise') {
            if (this.state.reviewed_jobs[job] === 'revise') this.fail('The same rejected draft was submitted without new evidence');
            if (this.state.rewrites >= this.limits.max_rewrites) this.fail('The bounded Keeper repair did not resolve the review');
            this.state.rewrites++;
        }
        this.state.reviewed_jobs[job] = verdict; this.save();
    }
    fail(cause: string): never { this.state.blocked = cause; this.save(); throw reviewUnavailable(cause); }
    close() {
        if (this.fd === undefined) return;
        closeSync(this.fd); this.fd = undefined;
    }
}
