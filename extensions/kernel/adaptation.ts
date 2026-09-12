/** Uses the existing host task runner; proposals never execute player actions. */
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { HostRuntime } from '../../runtime/host.ts';
import { KernelError, isKernelError } from './client.ts';

type Call = (method: string, params: Record<string, any>) => Promise<any>;
export function adaptationService(runtime: HostRuntime, call: Call, model: () => {name: string; thinking?: any}) {
    const tasks = new Map<string, {campaign: string; name: string; run: Promise<void>; controller: AbortController}>();
    async function waitFor(task: {run: Promise<void>; controller: AbortController}, signal?: AbortSignal) {
        const configured = Number(process.env.PI_COC_ADAPTATION_WAIT_MS);
        const wait = Number.isFinite(configured) && configured >= 0 ? configured : 120000;
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
                    await writeFile(join(task.cwd, `run-model-${pass}.json`), JSON.stringify({model: selected.name, thinking: selected.thinking, role: task.role}));
                    const outcome = await runtime.runTask({kind: 'reader', request: {cwd: task.cwd, systemPrompt: task.system_prompt,
                        model: selected.name, thinking: selected.thinking, tools: 'read,write,edit,bash',
                        eventLog: join(task.cwd, `events-${pass}.jsonl`),
                        brief: 'Read request.json and the named inputs needed for the task. Review also reads candidate.json. Use the supplied node for large JSON, never Python. Do not read repository/build code, event/model logs, search the filesystem, or look for PDFs. The host owns deterministic validation; do not run coc-read-check. Write result.json using tools, preserve inputs, and stop.' +
                            (pass > 1 ? ' Read feedback.json: correct only the reported deterministic schema/reference problem while preserving valid source-grounded choices. This is the only repair attempt.' : '')}}, controller.signal);
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
        if (action === 'status') {
            const result = await call('adaptation.status', payload);
            const active = [...tasks.values()].findLast(task => task.campaign === payload.campaign && task.name === result.name);
            if (active && ['pending', 'reviewing'].includes(result.status)) await waitFor(active, signal);
            return call('adaptation.status', payload);
        }
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
        const result = await call('adaptation.status', payload);
        if (['pending', 'reviewing'].includes(result.status)) result.service_status = 'The retained preparation is still running. No fictional event or player action has happened. Inspect the same proposal by name; a changed campaign requires fresh preparation.';
        return result;
    }};
}
