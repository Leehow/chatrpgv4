/** Uses the existing host task runner; proposals never execute player actions. */
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { HostRuntime } from '../../runtime/host.ts';
import { KernelError, isKernelError } from './client.ts';
import { readerInput } from '../module/reader.ts';
import { fastLaneChoice } from '../lanes/subsession.ts';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

/**
 * How long a `prepare` holds the Keeper's turn for its own job (§135.11 addendum, SL-23): the budget inside the turn.
 *
 * It was 12 000 ms, and it bought nothing it was paid for. Every retained `prepare` that started a job (seven, across the
 * gate and playtest tables up to 2026-09-24) came back `pending` or `reviewing` after 12.1-12.6 s; none came back
 * `ready`. The long gate's turn 19 is the shape: the creator took 12 s and the independent reviewer 22 s, so the job was
 * ready 35 s after it started -- and the turn had already paid 12.2 s of its 60 s for a status it then had to wait on
 * anyway. A creator and a reviewer, each a tool-using child on a fast model, cannot finish inside any wait a turn can
 * afford; the result reaches the table through the host's wait notice and the next turn's status. What the short wait
 * still catches is a job that ends at once (a task that cannot start fails in well under a second), so its result is
 * read in the same call. `PI_COC_ADAPTATION_WAIT_MS` still overrides it.
 */
const FOREGROUND_WAIT_MS = 2_000;
const TASK_TIMEOUT_MS = 30_000;
const TASK_MAX_REQUESTS = 6;

type Call = (method: string, params: Record<string, any>) => Promise<any>;

/**
 * What an adaptation creator or reviewer runs on (contract §37.10.1): `PI_COC_ADAPTATION_MODEL`, then
 * the fast-model setting, then the table's own model; its effort is the setting's or the lane's own
 * level, never the table's. Both tasks run under a 30 s cap and six model calls while the player sits
 * on a preparation wait, and nothing either writes is the Keeper's prose -- the reviewed proposal is
 * campaign data the Keeper then plays from -- so it is a lane that has to be quick. Read each time a
 * task starts, so a change under a running table reaches the next creator or reviewer.
 */
export function adaptationModel(ctx: ExtensionContext | undefined): {name?: string; thinking: string} {
    const table = ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
    const chosen = fastLaneChoice(ctx, 'PI_COC_ADAPTATION_MODEL', table);
    return {...(chosen.model ? {name: chosen.model} : {}), thinking: chosen.thinking};
}
/** The foreground wait a `prepare` of a new job spends in the turn, read per call. */
export function adaptationWaitMs(): number {
    const configured = Number(process.env.PI_COC_ADAPTATION_WAIT_MS);
    return process.env.PI_COC_ADAPTATION_WAIT_MS?.trim() && Number.isFinite(configured) && configured >= 0 ? configured : FOREGROUND_WAIT_MS;
}
export function adaptationService(runtime: HostRuntime, call: Call, model: () => {name?: string; thinking?: any}) {
    const tasks = new Map<string, {campaign: string; name: string; run: Promise<void>; controller: AbortController}>();
    async function waitFor(task: {run: Promise<void>; controller: AbortController}, signal?: AbortSignal) {
        const wait = adaptationWaitMs();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stop: (() => void) | undefined;
        try {
            await Promise.race([task.run, new Promise<void>(resolve => {timer = setTimeout(resolve, wait);}),
                new Promise<void>(resolve => {stop = () => {task.controller.abort(); resolve();}; if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, {once: true});})]);
        } finally { if (timer) clearTimeout(timer); if (stop) signal?.removeEventListener('abort', stop); }
    }
    async function run(payload: Record<string, any>, first: any, controller: AbortController) {
        let task = first;
        try {
            while (task) {
                for (let pass = 1; pass <= 2; pass++) {
                    const selected = model();
                    const focus = JSON.parse(await readFile(join(task.cwd, 'focus.json'), 'utf8'));
                    const inline = readerInput(focus);
                    const supplied = inline.startsWith('Read task.json') ? 'Read focus.json first; it is the bounded host-owned input.' : inline;
                    await writeFile(join(task.cwd, `run-model-${pass}.json`), JSON.stringify({model: selected.name, thinking: selected.thinking, role: task.role}));
                    const outcome = await runtime.runTask({kind: 'reader', request: {cwd: task.cwd, systemPrompt: task.system_prompt,
                        model: selected.name, thinking: selected.thinking, tools: 'read,write,edit,bash',
                        timeoutMs: TASK_TIMEOUT_MS, maxRequests: TASK_MAX_REQUESTS, adaptation: {role: task.role},
                        eventLog: join(task.cwd, `events-${pass}.jsonl`),
                        brief: 'Use the focused input already below. Review also reads candidate.json. Do not enumerate files or inspect raw schemas. Read a named full file only when focus.json identifies a specific evidence gap. Use the supplied node for a necessary large JSON lookup, never Python. Do not read repository/build code, event/model logs, search the filesystem, or look for PDFs. The host owns deterministic validation; do not run coc-read-check. Submit the result object with submit_adaptation; do not write result.json directly or output the JSON as prose. Stop within six model calls.' +
                            (pass > 1 ? ' Read feedback.json: correct only the reported deterministic schema/reference problem while preserving valid source-grounded choices. This is the only repair attempt.' : '') +
                            `\n${supplied}`}}, controller.signal);
                    if (!outcome.ok) throw new Error(`Adaptation ${task.role} task failed (${outcome.code ?? 'interrupted'})`);
                    try {
                        const result = await call(task.role === 'create' ? 'adaptation.draft' : 'adaptation.review', {...payload, key: task.key, attempt: task.attempt});
                        task = result.task; break;
                    } catch (error) {
                        if (task.role !== 'create' || pass !== 1 || !isKernelError(error) || !['invalid_params', 'unknown_entity'].includes(error.code)) throw error;
                        const rejected = await readFile(join(task.cwd, 'result.json')).catch(() => null);
                        if (rejected) await writeFile(join(task.cwd, 'rejected-result-1.json'), rejected, {flag: 'wx'});
                        await writeFile(join(task.cwd, 'feedback.json'), JSON.stringify({code: error.code, message: error.message, fix: error.fix, details: error.details}));
                    }
                }
            }
        } catch (error) {
            await call('adaptation.fail', {...payload, key: first.key, attempt: first.attempt, error: error instanceof Error ? error.message : String(error)}).catch(() => undefined);
        }
    }
    const close = () => { for (const task of tasks.values()) task.controller.abort(); };
    runtime.signal.addEventListener('abort', close, {once: true});
    return {close, async lookup(payload: Record<string, any>, signal?: AbortSignal) {
        const action = payload.action ?? 'status';
        if (!['prepare', 'status', 'cancel'].includes(action)) throw new KernelError({code: 'invalid_params', message: 'Adaptation action must be prepare, status or cancel'});
        if (action === 'cancel') {
            const result = await call('adaptation.cancel', payload);
            for (const task of tasks.values()) if (task.campaign === payload.campaign && task.name === result.name) task.controller.abort();
            return result;
        }
        if (action === 'status') return pendingStatus(await call('adaptation.status', payload));
        const prepared = await call('adaptation.prepare', payload);
        if (prepared.task) {
            const key = JSON.stringify([payload.campaign, prepared.name, prepared.task.key, prepared.task.attempt]);
            if (payload.retry) for (const [prior, task] of tasks) if (prior !== key && task.campaign === payload.campaign && task.name === prepared.name) task.controller.abort();
            if (!tasks.has(key)) {
                const controller = new AbortController();
                const pending = run(payload, prepared.task, controller).finally(() => tasks.delete(key));
                tasks.set(key, {campaign: payload.campaign, name: prepared.name, run: pending, controller});
            }
            const task = tasks.get(key)!;
            await waitFor(task, signal);
        }
        return pendingStatus(await call('adaptation.status', payload));
    }};
}

function pendingStatus(result: Record<string, any>): Record<string, any> {
    if (['pending', 'reviewing'].includes(result.status)) {
        // "inspect the same proposal by name" named no call, and the Keeper of campaign game-ef7545c5
        // answered it with `lookup kind=module` instead. The verb is spelled out here for the same
        // reason the gate's wait instruction spells it out: a Keeper executes what it reads.
        // §47. This string is read by a model that executes what it reads, so it says what the
        // Keeper *does* and never what the Keeper *says to the player*. The old second sentence read
        // "Use narrate only to tell the player that preparation is pending and end the turn", and on
        // campaign game-1c0faba5 turn 3 the Keeper did exactly that: in its own voice, as fiction, to
        // explain a refusal (`action_not_authorized`) that had nothing to do with preparation, quoting
        // a status read 20 seconds earlier. Host state reaches the player from the host, out of
        // fiction, re-read at the moment it is sent.
        result.service_status = 'The retained preparation is still running in the background. No fictional event or player action has happened. Do not poll it again in this turn.'
            + ' The host tells the player about this preparation itself, out of fiction and beside the delivery, so close the turn with narrate on what the player actually said'
            + ' and keep the preparation, the wait and the destination out of the fiction.'
            + ` After new player input, the only call that reports on it is lookup kind=adaptation action=status name=${JSON.stringify(result.name ?? '')}.`;
        result.retry_after_ms = 2000;
    }
    return result;
}
