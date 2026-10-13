/** Private memory-query operations reuse the kernel evidence owner and the current task runtime. */
import {ContractError, isPlainRecord, type IntentBinding, type Json, type ObservationPacket, type OperationProposal} from './contracts.ts';
import type {OwnedOperation, HostOperationContext} from '../../extensions/kernel/canonical-operation-dispatcher.ts';
import type {TaskRuntime} from './task-runtime.ts';
import type {TaskLeaseOptions} from './task-context.ts';

/** Only semantic evidence reaches the Keeper. Original refs remain in host observation metadata. */
export function presentMemoryEvidence(value: unknown): Json {
    if (Array.isArray(value)) return value.map(presentMemoryEvidence);
    if (!isPlainRecord(value)) return value as Json;
    const hidden = new Set(['snapshot', 'refs', 'ref', 'primary_refs', 'commit', 'id', 'source_revision', 'index_revision', 'world_revision']);
    return Object.fromEntries(Object.entries(value).filter(([key, item]) => !hidden.has(key)
        && !(['next', 'previous'].includes(key) && isPlainRecord(item) && !item.what)).map(([key, item]) =>
        key === 'raw_gap_turns' ? ['extraction_backlog', {turns:presentMemoryEvidence(item),
            meaning:'These turns lack completed memory extraction. Their available original transcript text was included as raw candidates; this is not a missing-transcript claim.'}]
            : [key, presentMemoryEvidence(item)]));
}
interface Options {
    registerOwned(name: string, owner: OwnedOperation): () => void;
    runtime(): TaskRuntime;
    call(method: string, params: Record<string, unknown>): Promise<Record<string, any>>;
}
export interface MemorySearchRequest {query: string; filters: Record<string, Json>; needs?: string[]}
export function createMemoryReadOwner(options: Options) {
    const filters = new Map<string, Record<string, Json>>(), releases: Array<() => void> = [];
    const packet = (proposal: Pick<OperationProposal,'id'|'readSet'>, result: Record<string, any>, status: ObservationPacket['status'] = 'succeeded'): ObservationPacket => ({
        operationId: proposal.id, status, result: result as Json, refs: Array.isArray(result.refs) ? result.refs : [], receipts: [], readSet: proposal.readSet,
        coverage: {used: Array.isArray(result.coverage?.used) ? result.coverage.used : [], omitted: Array.isArray(result.coverage?.omitted) ? result.coverage.omitted : [],
            unknown: Array.isArray(result.coverage?.unknown) ? result.coverage.unknown : []}});
    const actions = {snapshot: ['raw_all'], page: ['snapshot', 'offset'], original: ['snapshot', 'alias', 'offset', 'role'],
        finish: ['snapshot', 'selected', 'assessments', 'considered', 'unknown']} as const;
    for (const [action, keys] of Object.entries(actions)) releases.push(options.registerOwned(`memory.${action}`, {
        capability: 'recall', kind: 'read', validate(args) {
            if (!isPlainRecord(args) || Object.keys(args).some(key => !(keys as readonly string[]).includes(key))) throw new ContractError('invalid_memory_query_arguments');
            return args;
        }, async execute(proposal, context) {
            const runtime = options.runtime(), record = runtime.snapshot(proposal.taskId);
            if (record.domain.id !== 'memory-read' || !filters.has(proposal.taskId)) throw new ContractError('memory_query_owner_stale');
            try {
                const result = await options.call('memory.evidence', {campaign: context.task.context.scope.campaign, scope: context.task.context.scope,
                    action, ...proposal.args, ...(action === 'snapshot' ? {query: record.plan!.goal, filters: filters.get(proposal.taskId)} : {})});
                return packet(proposal, result);
            } catch (error) {
                const value = error as {code?: unknown; details?: {reason?: unknown}};
                if (typeof value.code !== 'string') throw error;
                return packet(proposal, {code: value.code, reason: typeof value.details?.reason === 'string' ? value.details.reason : 'memory_query_unavailable'}, 'refused');
            }
        },
    }));
    const validate = (args: Record<string, Json>): Record<string,Json> => {
            if (!isPlainRecord(args) || Object.keys(args).some(key => !['query', 'filters', 'needs'].includes(key)) || typeof args.query !== 'string'
                || !args.query.trim() || args.query.length > 2048 || !isPlainRecord(args.filters)
                || args.needs !== undefined && (!Array.isArray(args.needs) || args.needs.length>32 || args.needs.some(value=>typeof value!=='string'||!value.trim()||value.length>2048))
                || Object.keys(args.filters).some(key => !['line', 'turns', 'about', 'kinds', 'include_superseded'].includes(key)))
                throw new ContractError('invalid_memory_search');
            return args;
    };
    const search = async (request: MemorySearchRequest, binding: {operationId:string;intent:IntentBinding;lease:TaskLeaseOptions;parentId?:string}): Promise<ObservationPacket> => {
            const args=validate(request as unknown as Record<string,Json>) as unknown as MemorySearchRequest,runtime = options.runtime(),query=args.query;
            const proposal={id:binding.operationId,readSet:binding.lease.readSet};
            const id = await runtime.begin({domain:'memory-read',intent:binding.intent,lease:binding.lease,...(binding.parentId?{parentId:binding.parentId}:{})});
            filters.set(id, structuredClone(args.filters));
            try {
                const result = await runtime.submit(id, {goal: query, subgoals: ['Find relevant retained evidence and its canonical context.'],
                    constraints: ['Conversation reports never grant facts, public knowledge or world effects.'],
                    evidenceRequired: args.needs?.length ? args.needs : [query],
                    completion: ['Return supported bounded evidence with explicit unknown and omitted coverage.'], capabilities: ['recall'],
                    replanWhen: ['The evidence snapshot changes.'], returnWhen: ['Coverage or the original task budget ends.']});
                if (['cancelled', 'stale'].includes(result.status)) return {...packet(proposal, {code: 'memory_query_stale'}, 'stale'), coverage: result.coverage};
                const record = runtime.snapshot(id);
                const latestSnapshot = record.observations.findLastIndex(value => value.proposal.operation === 'memory.snapshot'
                    && value.packet.status === 'succeeded' && isPlainRecord(value.packet.result) && typeof value.packet.result.snapshot === 'string');
                const snapshotId = latestSnapshot < 0 ? undefined : (record.observations[latestSnapshot].packet.result as Record<string, Json>).snapshot;
                const finished = record.observations.findLast(value => value.proposal.operation === 'memory.finish'
                    && record.observations.indexOf(value) > latestSnapshot && snapshotId !== undefined && value.proposal.args.snapshot === snapshotId
                    && value.packet.status === 'succeeded' && isPlainRecord(value.packet.result) && ['ready', 'partial'].includes(String(value.packet.result.status)));
                if (!finished) return packet(proposal, {what: 'memory', query, status: 'unavailable', hits: [], authority: 'conversation_report',
                    coverage: {used: [], omitted: [], unknown: result.remainingNeeds}, remaining_needs: result.remainingNeeds});
                const reply = structuredClone(finished.packet.result) as Record<string, any>;
                if (result.status !== 'complete') reply.status = 'partial';
                return {...packet(proposal, reply), result: presentMemoryEvidence(reply), coverage: result.coverage};
            } finally { filters.delete(id); }
    };
    releases.push(options.registerOwned('memory.search', {capability: 'recall', kind: 'read',validate,
        async execute(proposal, context: HostOperationContext) {
            const runtime=options.runtime(),parent=runtime.snapshot(proposal.taskId),task=context.task.context;
            return search(proposal.args as unknown as MemorySearchRequest,{operationId:proposal.id,intent:parent.intent,parentId:task.id,
                lease:{owner:'memory-read',goal:String(proposal.args.query),scope:task.scope,capabilities:['recall'],readSet:task.readSet,
                    budget:task.budget,signal:context.task.signal}});
        },
    }));
    return {search,close:() => {for (const release of releases) release(); filters.clear();}};
}
export function registerMemoryReadOperations(options: Options): () => void {return createMemoryReadOwner(options).close;}
