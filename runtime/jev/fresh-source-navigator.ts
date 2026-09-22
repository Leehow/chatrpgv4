/** Optional setup navigation through the shared task/operation owners. Never publishes source material. */
import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createCanonicalOperationDispatcher} from '../../extensions/kernel/canonical-operation-dispatcher.ts';
import {nativeSourceCatalog, type NativeTextBundle} from './native-source-catalog.ts';
import {ContractError, isPlainRecord, type IntentBinding, type Json, type ObservationPacket, type ReadSet} from './contracts.ts';
import {createDecisionAdapter} from './decision-adapter.ts';
import {readJevApiKey} from '../../extensions/jev/agent/config.js';
import type {DecisionPort} from './decision-port.ts';
import {createFreshSourceNavigationDomain, materializeNavigation, FRESH_SOURCE_NAVIGATION_CAPABILITY, FRESH_SOURCE_ROLES, FRESH_SOURCE_NAVIGATION_VERSION,
    type FreshSourceNavigationArtifact} from './fresh-source-navigation-domain.ts';
import {JEV_MODEL} from './question-packing.ts';
import {issueSourceRef} from './source-ref.ts';
import {TaskRuntime, type TaskRecord, type TaskView} from './task-runtime.ts';
import {createTaskStore} from './task-store.ts';

export interface FreshSourceNavigationRequest {
    moduleId: string;
    jobId: string;
    source: {path: string; file_sha256: string; page_count: number};
}
export type FreshSourceNavigator = (request: FreshSourceNavigationRequest, signal: AbortSignal,
    record?: (event: Record<string, unknown>) => void) => Promise<FreshSourceNavigationArtifact | undefined>;
interface Options {
    runtime: {home: string; signal: AbortSignal;
        sourceInfo(source: {pdf: string; cache: string}, signal?: AbortSignal): Promise<{file_sha256: string; page_count: number}>;
        sourceText(source: {pdf: string; pages: number[]; expected_file_sha256: string}, signal?: AbortSignal): Promise<NativeTextBundle>};
    call(method: string, params: Record<string, unknown>): Promise<Record<string, any>>;
    env: Readonly<NodeJS.ProcessEnv>;
    record?(value: Record<string, unknown>): void;
    decision?: DecisionPort;
    deadlineMs?: number;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function writeCache(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, JSON.stringify(value) + '\n', {encoding: 'utf8', mode: 0o600, flag: 'wx'});
        await rename(temporary, path);
    } finally { await unlink(temporary).catch(() => undefined); }
}
function view(record: TaskRecord): TaskView {
    return {intent: record.intent, plan: record.plan!, context: record.checkpoint.context, observations: record.observations,
        decisions: record.decisions, remainingNeeds: record.remainingNeeds, replans: record.replans};
}
function artifactValid(value: any, revision: string, pageCount: number): value is FreshSourceNavigationArtifact {
    if (!isPlainRecord(value) || Object.keys(value).sort().join(',') !== 'coverage,extraction_version,hints,navigation_only,page_count,source_revision,version'
        || value.version !== 1 || value.navigation_only !== true || value.source_revision !== revision || value.page_count !== pageCount
        || typeof value.extraction_version !== 'string' || !value.extraction_version || !Array.isArray(value.hints) || !isPlainRecord(value.coverage)
        || Object.keys(value.coverage).sort().join(',') !== 'classified_pages,empty_pages,error_pages,omitted_pages,uncertain_pages') return false;
    const page = (n: any) => Number.isSafeInteger(n) && n >= 1 && n <= pageCount;
    const seen = new Set<number>();
    for (const pages of Object.values(value.coverage)) {
        if (!Array.isArray(pages) || pages.some(n => !page(n) || seen.has(n))) return false;
        for (const n of pages) { if (seen.has(n)) return false; seen.add(n); }
    }
    if (seen.size !== pageCount) return false;
    const hints = new Set<number>();
    for (const hint of value.hints) {
        if (!isPlainRecord(hint) || Object.keys(hint).sort().join(',') !== 'page,pdf_label,roles' || !page(hint.page) || hints.has(Number(hint.page))
            || hint.pdf_label !== null && typeof hint.pdf_label !== 'string' || !Array.isArray(hint.roles)
            || new Set(hint.roles).size !== hint.roles.length || hint.roles.some(role => !FRESH_SOURCE_ROLES.includes(role as any))) return false;
        hints.add(Number(hint.page));
    }
    const text = [...value.coverage.classified_pages as number[], ...value.coverage.uncertain_pages as number[]];
    return hints.size === text.length && text.every(n => hints.has(n));
}

export function createFreshSourceNavigator(options: Options): FreshSourceNavigator | undefined {
    if (options.env.PI_COC_TASK_RUNTIME !== '1' || options.env.PI_COC_JEV_SOURCE !== '1'
        || !options.decision && !readJevApiKey(options.env)) return undefined;
    return async (request, signal, recordEvent) => {
        const note = (event: Record<string, unknown>) => {
            try { (recordEvent ?? options.record)?.({lane: 'reading', event: 'typed_navigation', module_id: request.moduleId, job_id: request.jobId, ...event}); } catch { /* Advisory telemetry. */ }
        };
        const caller = AbortSignal.any([signal, options.runtime.signal]);
        const check = () => { caller.throwIfAborted(); };
        let tasks: TaskRuntime | undefined;
        const gateway = createCanonicalOperationDispatcher();
        try {
            check();
            const initial = await options.call('module.source.snapshot', {module_id: request.moduleId});
            const binding = {module_id: initial.module_id, pdf: initial.pdf, file_sha256: initial.file_sha256,
                page_count: initial.page_count, revision: initial.revision};
            if (binding.module_id !== request.moduleId || binding.file_sha256 !== request.source.file_sha256
                || binding.page_count !== request.source.page_count || resolve(binding.pdf) !== resolve(request.source.path))
                throw new ContractError('navigation_source_stale');
            const revalidate = async () => {
                check();
                const current = await options.call('module.source.snapshot', {module_id: request.moduleId});
                if (current.revision !== binding.revision || current.file_sha256 !== binding.file_sha256 || current.pdf !== binding.pdf
                    || current.page_count !== binding.page_count) throw new ContractError('navigation_source_stale');
            };
            const sourceBytes = await options.runtime.sourceInfo({pdf: binding.pdf, cache: options.runtime.home}, caller);
            if (sourceBytes.file_sha256 !== binding.file_sha256 || sourceBytes.page_count !== binding.page_count) throw new ContractError('navigation_source_stale');
            const scope = {owner: `source:${request.moduleId}`, audience: 'keeper' as const};
            const privateRoot = join(options.runtime.home, '.coc', 'task-runtime', 'source-navigation', digest([request.moduleId, request.jobId, binding.revision, FRESH_SOURCE_NAVIGATION_VERSION, JEV_MODEL]));
            const cachePaths = [join(privateRoot, 'navigation.json')];
            for (const path of cachePaths) {
                let cached: any;
                try { cached = JSON.parse(await readFile(path, 'utf8')); } catch { continue; }
                if (cached?.family !== 'fresh-source-navigation' || cached.familyVersion !== FRESH_SOURCE_NAVIGATION_VERSION || cached.model !== JEV_MODEL
                    || cached.sourceSha !== binding.file_sha256 || cached.digest !== digest(cached.artifact)
                    || !artifactValid(cached.artifact, binding.revision, binding.page_count)) continue;
                const currentText = await options.runtime.sourceText({pdf: binding.pdf, pages: [1], expected_file_sha256: binding.file_sha256}, caller);
                const probe = nativeSourceCatalog(scope, currentText, binding.file_sha256);
                const probedPages = [...probe.coverage.textPages, ...probe.coverage.emptyPages, ...probe.coverage.errorPages];
                if (probe.extractionVersion !== cached.artifact.extraction_version || probe.pageCount !== binding.page_count
                    || probedPages.length !== 1 || probedPages[0] !== 1) continue;
                await revalidate(); note({status: 'cached', coverage: cached.artifact.coverage}); return cached.artifact;
            }
            const description = 'Locate authored opening, background, entities and reference material in the bound original source.';
            const rawInput = issueSourceRef({scope, resource: `source-request:${request.jobId}`, revision: digest(description), sourceType: 'record', text: description},
                {kind: 'utf16', start: 0, end: description.length});
            const intent: IntentBinding = {id: randomUUID(), rawInput, scope, turn: 0, inputRevision: rawInput.revision, limits: ['navigation_only']};
            const readSet: ReadSet = [{kind: 'source', resource: request.moduleId, revision: binding.revision},
                {kind: 'model', resource: 'decision', revision: JEV_MODEL}, {kind: 'family', resource: 'fresh-source-navigation', revision: FRESH_SOURCE_NAVIGATION_VERSION}];
            const decision = options.decision ?? createDecisionAdapter({env: options.env,
                retryPolicies: {'fresh-source-navigation': {maxRetries: 1, backoffInitialMs: 100, backoffMaxMs: 1000, attemptTimeoutMs: 10_000}},
                trace: event => note({kind: 'decision', trace: event})});
            const packet = (proposal: any, result: unknown): ObservationPacket => ({operationId: proposal.id, status: 'succeeded',
                result: result as Json, refs: [], receipts: [], readSet: proposal.readSet, coverage: {used: [], omitted: [], unknown: []}});
            for (const operation of ['navigation.binding', 'navigation.text', 'navigation.finish']) gateway.registerOwned(operation, {
                capability: FRESH_SOURCE_NAVIGATION_CAPABILITY, kind: 'read',
                validate(args) {
                    if (operation !== 'navigation.text') { if (Object.keys(args).length) throw new ContractError('invalid_navigation_arguments'); return args; }
                    if (Object.keys(args).join(',') !== 'pages' || !Array.isArray(args.pages) || !args.pages.length || args.pages.length > 16
                        || new Set(args.pages).size !== args.pages.length || args.pages.some(page => !Number.isSafeInteger(page) || Number(page) < 1 || Number(page) > binding.page_count))
                        throw new ContractError('invalid_navigation_pages');
                    return args;
                },
                async execute(proposal, context) {
                    if (operation === 'navigation.binding') return packet(proposal, binding);
                    if (operation === 'navigation.text') return packet(proposal, await options.runtime.sourceText({pdf: binding.pdf,
                        pages: proposal.args.pages as number[], expected_file_sha256: binding.file_sha256}, context.task.signal));
                    const artifact = materializeNavigation(view(tasks!.snapshot(proposal.taskId)));
                    if (!artifact || !artifactValid(artifact, binding.revision, binding.page_count)) throw new ContractError('invalid_navigation_artifact');
                    return packet(proposal, artifact);
                },
            });
            tasks = new TaskRuntime({decision, store: createTaskStore(join(privateRoot, 'tasks')), domains: [createFreshSourceNavigationDomain()], maxSteps: 256,
                operations: {validate: async () => {await revalidate(); return readSet;},
                    dispatch: (proposal, task, journal) => gateway.dispatch(proposal, {task, journal,
                        validateCurrent: revalidate, recover: async () => {throw new ContractError('navigation_has_no_world_settlement');}, trace: event => note({kind: 'operation', ...event})})}});
            const id = await tasks.begin({domain: 'fresh-source-navigation', intent, lease: {owner: 'source-navigation', scope, goal: description,
                capabilities: [FRESH_SOURCE_NAVIGATION_CAPABILITY], readSet, signal: caller,
                budget: {deadlineAt: Date.now() + (options.deadlineMs ?? 180_000), remainingInputTokens: 5_000_000,
                    remainingOutputTokens: 1_000_000, remainingCostUsd: 1, remainingActions: 512}}});
            const result = await tasks.submit(id, {goal: description, subgoals: ['Classify native text throughout the source.'],
                constraints: ['Navigation only; never create source facts, visual proof, nodes, readiness or executable parameters.'],
                evidenceRequired: ['Original bound native text and explicit unread or uncertain coverage.'],
                completion: ['Every page is classified or explicitly empty, failed, uncertain or omitted.'],
                capabilities: [FRESH_SOURCE_NAVIGATION_CAPABILITY], replanWhen: [], returnWhen: ['Coverage or the bounded navigation budget is exhausted.']});
            await revalidate();
            const record = tasks.snapshot(id), artifact = materializeNavigation(view(record));
            if (!artifact || !artifactValid(artifact, binding.revision, binding.page_count)) { note({status: result.status, available: false}); return undefined; }
            await writeCache(join(privateRoot, 'navigation.json'), {family: 'fresh-source-navigation', familyVersion: FRESH_SOURCE_NAVIGATION_VERSION, model: JEV_MODEL,
                sourceSha: binding.file_sha256, digest: digest(artifact), artifact});
            note({status: result.status, available: true, coverage: artifact.coverage, batches: record.decisions.length,
                questions: record.decisions.reduce((total, value) => total + value.batch.questions.length, 0)});
            return artifact;
        } catch (error) {
            note({status: 'unavailable', reason: error instanceof ContractError ? error.code : caller.aborted ? 'cancelled' : 'navigation_unavailable'});
            return undefined;
        } finally { await tasks?.shutdown().catch(() => undefined); }
    };
}
