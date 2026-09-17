/** Retained per-turn review accounting; this never changes campaign gameplay state. */
import {mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {AUDIT_LIMITS} from '../../kernel-ts/mods/audit-result.ts';
import {KernelError} from '../kernel/client.ts';

/**
 * Whether this pause is a *service* condition or a *verdict* one (contract §38.9), and whether any
 * reviewer ever reached a verdict about this draft (contract §91).
 *
 * Both end the player's input, and both are reported with the same `reason`, because the Keeper's
 * lawful response to either is identical: keep what settled and wait for the player. They are not the
 * same fact about the table. A review that ran, submitted, and refused the one bounded repair
 * `max_rewrites` permits is the guard working; a child killed at its cap having submitted nothing is
 * the lane being down. Only the second kind is an outage, and only outages may accumulate into
 * §38.5's streak — the escalation that tells the player another attempt is pointless and hands the
 * operator a lane-model fix.
 *
 * Retained evidence (H-MAIN `game-83177d61`, 2026-09-15): turn 42 ended on `The bounded Keeper repair
 * did not resolve the review` (`submitted: true`, 17.4 s) and turn 43 on `The private reviewer ended
 * without a checked submission` (`submitted: false`, killed at 40 014 ms). One design decision and one
 * dead stream were summed into `streak: 2`, and the table was declared down.
 *
 * `reviewed` is the third fact, and it is the one the *delivery* decision reads (§91). `service`
 * answers "is this an outage", which is the streak's question; `reviewed` answers "did a reviewer
 * reach a trusted verdict about this candidate", which is the only question that can justify holding
 * the Keeper's prose back. They are not the same cut: an exhausted shared allowance and a review that
 * outspent its own reservation are both `service: false` — neither is a lane being down — yet neither
 * is a reading of this draft either, so neither may refuse it. Only `verdict()` sets `reviewed: true`.
 */
export const reviewUnavailable = (cause: string, service = true, reviewed = false) => new KernelError({code: 'needs',
    message: 'Continuity review is paused; no draft was approved',
    fix: 'Preserve settled actions and await explicit player input before another review attempt. Do not rewrite or repeat the audit automatically.',
    details: {reason: 'continuity_review_unavailable', cause, service, reviewed}});
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
            if (this.state.active) { this.state.blocked = 'An interrupted review retains its reserved allowance'; this.state.blocked_service = true; this.state.blocked_reviewed = false; this.save(); }
            if (this.state.blocked && inputToken && inputToken !== this.state.input_token) {
                const {previous, ...last} = this.state;
                this.state = {...this.fresh(inputToken), previous: [...previous, last]}; this.save();
            }
            // The kind travels with the retained block: a later review of the same input must not
            // re-read a verdict end as a fresh outage, and must not lend a bookkeeping bound the
            // authority of a verdict it never had (§91).
            if (this.state.blocked) throw reviewUnavailable(this.state.blocked, this.state.blocked_service !== false, this.state.blocked_reviewed === true);
        } catch (error) { this.close(); throw error; }
    }
    private fresh(inputToken?: string) { return {version: 1, input_token: inputToken ?? null, requests: 0, ms: 0, rewrites: 0, artifact_repairs: 0, reviewed_jobs: {}, previous: [], blocked: null, blocked_service: null, blocked_reviewed: null}; }
    private save() { atomic(this.file, this.state); }
    /**
     * §73: the allowance measures **active review time** (§35.14), so nothing but a reviewer may spend it.
     *
     * This used to charge the host's own preparation — `Date.now()` since the `mods.job` call was issued —
     * to the shared `time_ms` before reserving anything. Preparation is not a review: it is the kernel
     * assembling evidence, and when the kernel stalls it is a failure, not a verdict. Retained live evidence
     * (H-SIDE t4 `game-1c0faba5`, turn 86, 2026-09-17): five `narrate` attempts died with
     * `kernel mods.job did not answer within 30000 ms`; the sixth was finally answered after ~55 s of
     * waiting, and that wait went in here. The reviewer then ran for 22.4 s inside its own reservation,
     * submitted, and `mods.accept` bound its report — and the retained accounting read
     * `ms: 81539` against `time_ms: 80000` with `reviewed_jobs: {}`. A review that passed was booked as an
     * exhausted allowance because of seconds no reviewer spent.
     */
    start(): {max_requests: number; max_artifact_repairs: number; timeoutMs: number} {
        const requests = Math.min(this.limits.per_review, this.limits.max_requests - this.state.requests);
        // One review reserves one review's worth, never the whole remaining allowance: otherwise the first
        // review eats the budget and the repair `max_rewrites` permits is unaffordable (§37.9).
        const ms = Math.min(this.limits.per_review_ms, this.limits.time_ms - this.state.ms);
        // §91: an exhausted allowance is a bound on what this table may still spend, not a reading of
        // this draft, so it is `reviewed: false` and never refuses a delivery on its own.
        if (requests <= 0 || ms <= 0) this.fail('The shared review allowance is exhausted', false, false);
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
        delete this.state.active;
        // A session that spent more model calls than it reserved broke the bound it was handed, so its
        // report is not trusted and the throw stands.
        if (requests > active.requests) { this.save(); this.fail('The private review exceeded its reserved model-call allowance', false, false); }
        // §73: an allowance bounds what may be *started*, not what has already been produced. Closing the
        // books on a review that ran inside its reservation may find the shared allowance spent; that is a
        // fact about the *next* review of this input, so it latches here and is raised by the constructor.
        // Throwing it from `finish()` discarded a report `mods.accept` had already bound one line earlier,
        // and skipped `verdict()` entirely — which is why turn 86's retained accounting carries an
        // exhausted block beside an empty `reviewed_jobs` and a job directory holding an accepted report.
        if (this.state.requests > this.limits.max_requests || this.state.ms > this.limits.time_ms || this.state.artifact_repairs > this.limits.max_artifact_repairs) {
            this.state.blocked = 'The shared review allowance is exhausted'; this.state.blocked_service = false; this.state.blocked_reviewed = false;
        }
        this.save();
    }
    verdict(job: string, verdict: string) {
        // Every branch here is the reviewer having reached a conclusion, or the allowance those
        // conclusions consumed: the lane answered. None of them is an outage.
        // §91: these three are the only ends a reviewer's own reading stands behind, so they are the
        // only ones that may hold the delivery back.
        if (verdict === 'unavailable') this.fail('The reviewer could not establish a reliable continuity verdict', false, true);
        if (verdict === 'revise') {
            if (this.state.reviewed_jobs[job] === 'revise') this.fail('The same rejected draft was submitted without new evidence', false, true);
            if (this.state.rewrites >= this.limits.max_rewrites) this.fail('The bounded Keeper repair did not resolve the review', false, true);
            this.state.rewrites++;
        }
        this.state.reviewed_jobs[job] = verdict; this.save();
    }
    fail(cause: string, service = true, reviewed = false): never {
        this.state.blocked = cause; this.state.blocked_service = service; this.state.blocked_reviewed = reviewed; this.save();
        throw reviewUnavailable(cause, service, reviewed);
    }
    close() {
        if (this.fd === undefined) return;
        closeSync(this.fd); this.fd = undefined;
    }
}
