/** Public Pi binding for the shared task runtime. The initial opening keeps its existing owner. */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentSession, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { operationCapability, type HostOperationContext, type OwnedOperation } from '../../extensions/kernel/canonical-operation-dispatcher.ts';
import { ContractError, PlanSubmissionSchema, type IntentBinding, type Json, type ObservationPacket, type OperationProposal, type ReadSet, type TaskBudget, type TaskContext } from './contracts.ts';
import type { DecisionPort } from './decision-port.ts';
import { TaskRuntime, type TaskStore } from './task-runtime.ts';
import { createTaskStore } from './task-store.ts';
import { createTableEvidenceDomain } from './table-evidence-domain.ts';
import { issueSourceRef } from './source-ref.ts';
import type { TaskLease } from './task-context.ts';
import { compareReadSet } from './read-set.ts';
import { createNativeSourceDomain, SOURCE_CONSULT_CAPABILITY } from './native-source-domain.ts';
import { registerSourceOperations } from './source-owner-operations.ts';
import type { NativeTextBundle } from './native-source-catalog.ts';
import { createMemoryWriteDomain } from './memory-write-domain.ts';
import { memoryReadSet, registerMemoryOperations, type MemoryBinding } from './memory-owner-operations.ts';
import {createMemoryReadDomain, MEMORY_READ_POLICY_VERSION} from './memory-read-domain.ts';
import {registerMemoryReadOperations, presentMemoryEvidence} from './memory-read-owner.ts';
import {ORDINARY_RESOLVE_VERSION} from './ordinary-resolve-domain.ts';
import {ORDINARY_APPLY_VERSION} from './ordinary-apply-domain.ts';
import {FULFILLMENT_POLICY_VERSION} from './fulfillment-domain.ts';
import {createTaskProviderBudget, type TaskProviderBudget} from './provider-budget.ts';
import {boundedPlanPresentation, reserveWriterBudget} from './writer-budget.ts';

interface Bridge { campaign: string; runtime: { home: string; signal: AbortSignal;
  sourceInfo?(source: {pdf: string; cache: string}, signal?: AbortSignal): Promise<{file_sha256: string; page_count: number}>;
  sourceText?(source: {pdf: string; pages: number[]; expected_file_sha256: string}, signal?: AbortSignal): Promise<NativeTextBundle>;
}; call(method: string, params: Record<string, unknown>): Promise<Record<string, any>> }
interface Capsule { campaign: string; turn: number; epoch: string; capsule: Json; context: Record<string, unknown> }
interface Dispatcher { dispatch(proposal: OperationProposal, context: HostOperationContext): Promise<ObservationPacket>;
  registerOwned?(name: string, definition: OwnedOperation): () => void;
  bindReadScope?(id: string, proposal: OperationProposal, context: HostOperationContext): Promise<() => void>;
  bindIncumbentScope?(id: string, proposal: OperationProposal, context: HostOperationContext): Promise<(result: Record<string, unknown>, isError: boolean) => Promise<ObservationPacket>>;
}
interface Attempt { id: string; input: string; intent: IntentBinding; capsule: Capsule }
const PROTOCOL = '\nPrivate bounded table-evidence protocol: You remain the Keeper. For an input already answerable from current authorized context, write the ordinary narrate/ask directly. Otherwise submit a bounded semantic plan with submit_plan_packet, requesting look and/or recall. The host owns the dependent evidence loop and returns real observations, missing coverage, and any genuine decision boundary. Do not execute look/recall yourself during this role. Only narrate/ask may deliver the result through the ordinary guards. Source cards are navigation, historical statements are attributed conversation evidence, and Keeper-only information is not public knowledge. This opt-in read-only domain cannot settle world changes; preserve that limit instead of narrating an unexecuted action. Do not expose private plans or host identity. Missing evidence alone is not a reason to invent a player decision.';
const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
/** Total attempt ceiling, distinct from the incumbent two-minute inactivity watchdog. */
export const DEFAULT_TASK_DEADLINE_MS=15*60_000;
export function taskDeadlineMs(value?:string):number {
  if(value===undefined||!value.trim())return DEFAULT_TASK_DEADLINE_MS;
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<1||parsed>60*60_000)throw new ContractError('invalid_task_deadline');
  return parsed;
}

export function createTaskHostAdapter(getSession: () => AgentSession, decision: DecisionPort, options: { deadlineMs?: number; store?: TaskStore; sourceEnabled?: boolean; memoryEnabled?: boolean; memoryReadEnabled?: boolean; resolveEnabled?: boolean; applyEnabled?: boolean } = {}) {
  const planCapabilities=['look','recall','lookup.module','lookup.rule','lookup.catalog',
    ...(options.sourceEnabled?[SOURCE_CONSULT_CAPABILITY]:[]),...(options.resolveEnabled?['resolve']:[]),...(options.applyEnabled?['apply']:[])];
  const planParameters={...PlanSubmissionSchema,properties:{...PlanSubmissionSchema.properties,
    capabilities:{...PlanSubmissionSchema.properties.capabilities,items:{...PlanSubmissionSchema.properties.capabilities.items,enum:planCapabilities}}}};
  let pi: ExtensionAPI, bridge: Bridge | undefined, dispatcher: Dispatcher | undefined, capsule: Capsule | undefined;
  let runtime: TaskRuntime | undefined, attempt: Attempt | undefined, pending: string | undefined, closed = false;
  let model: { provider: string; id: string } | undefined;
  let moduleId: string | undefined, reading: {ensure(module: string, params: Record<string, unknown>, signal?: AbortSignal, options?: {providerBudget?: TaskProviderBudget}): Promise<Record<string, any>>} | undefined;
  let releaseSource = () => {};
  let releaseMemory = () => {};
  let releaseMemoryRead = () => {};
  let releaseResolve = () => {};
  let releaseApply = () => {};
  let releaseFulfillment = () => {};
  const memoryBindings = new Map<string, MemoryBinding>();
  const attemptedMemoryTurns = new Set<number>();
  const directReads = new Map<string, {proposal: OperationProposal; release(): void; source?: Pick<ObservationPacket, 'refs' | 'coverage'>}>();
  const incumbentCalls = new Map<string, {taskId: string; complete(result: Record<string, unknown>, isError: boolean): Promise<ObservationPacket>}>();
  const executing = new Set<string>();
  const keeperReservations: Array<{ taskId: string; reservation: ReturnType<TaskLease['reserve']> }> = [];
  const providerBudgets = new Map<string, TaskProviderBudget>();
  let lastKeeperPayloadBytes = 0, lastKeeperAssistantBytes = 0;
  const writerReservations = new Map<string, ReturnType<typeof reserveWriterBudget>>();
  const trace = (data: Record<string, unknown>) => pi.appendEntry('coc-task-runtime', { at: Date.now(), taskId: attempt?.id, ...data });
  const providerBudget = (id: string) => {
    if (!runtime) throw new ContractError('task_host_not_ready');
    let port = providerBudgets.get(id);
    if (!port) { port = createTaskProviderBudget(runtime.lease(id), {record: trace, changed: () => runtime!.persistBudget(id)}); providerBudgets.set(id, port); }
    return port;
  };
  const releaseWriter = (id: string) => {
    const held = writerReservations.get(id);
    if (held) { writerReservations.delete(id); held.reservation.release(); }
  };
  const holdWriter = async (id: string) => {
    if (writerReservations.has(id) || !runtime) return;
    const model = getSession().model;
    if (!model) throw new ContractError('keeper_model_required');
    const held = reserveWriterBudget(runtime.lease(id), model, lastKeeperPayloadBytes, lastKeeperAssistantBytes);
    writerReservations.set(id, held); await runtime.persistBudget(id);
    trace({kind: 'writer-budget-held', reserved: held.spend});
  };
  const currentModel = () => getSession().model?.provider === model?.provider && getSession().model?.id === model?.id;
  const keeper = (message?: { provider?: unknown; model?: unknown }) => {
    const actual = message ?? getSession().messages.findLast(value => value.role === 'assistant') as AssistantMessage | undefined;
    if (!currentModel() || actual?.provider !== model?.provider || actual?.model !== model?.id) throw new ContractError('keeper_model_changed');
  };
  const readSet = (context: Record<string, unknown>, intent: IntentBinding): ReadSet => {
    if (context.campaign !== intent.scope.campaign || context.worldline !== intent.scope.worldline || context.loop !== intent.scope.loop
      || context.turn !== intent.turn || typeof context.source_revision !== 'string' || typeof context.world_revision !== 'string')
      throw new ContractError('task_scope_stale');
    return [
      { kind: 'world', resource: bridge!.campaign, revision: typeof context.task_world_revision === 'string' ? context.task_world_revision : context.world_revision },
      { kind: 'source', resource: bridge!.campaign, revision: typeof context.task_source_revision === 'string' ? context.task_source_revision : context.source_revision },
      { kind: 'draft', resource: intent.rawInput.resource, revision: intent.inputRevision },
      { kind: 'model', resource: 'keeper', revision: `${model!.provider}/${model!.id}` },
      { kind: 'family', resource: 'table-evidence', revision: options.applyEnabled ? '4' : options.resolveEnabled ? '3' : '2' },
      ...(options.memoryReadEnabled ? [{kind:'family' as const,resource:'memory-read',revision:MEMORY_READ_POLICY_VERSION}] : []),
      ...(options.resolveEnabled ? [{kind:'family' as const,resource:'ordinary-resolve',revision:ORDINARY_RESOLVE_VERSION}] : []),
      ...(options.applyEnabled ? [{kind:'family' as const,resource:'ordinary-apply',revision:ORDINARY_APPLY_VERSION},
        {kind:'family' as const,resource:'promise-fulfillment',revision:FULFILLMENT_POLICY_VERSION}] : []),
      ...(options.sourceEnabled ? [{kind:'family' as const,resource:'source-consultation',revision:'1'}] : []),
    ];
  };
  const validate = async (task: TaskContext, intent: IntentBinding): Promise<ReadSet> => {
    if (task.kind === 'committed_memory') {
      const bound = memoryBindings.get(task.id);
      if (closed || !bridge || task.owner !== 'memory' || !bound || bound.intent.id !== intent.id
        || task.scope.campaign !== bridge.campaign) throw new ContractError('memory_owner_stale');
      const source = await bridge.call('memory.source', {campaign: bridge.campaign, turn: bound.packet.turn});
      if (closed || source.origin?.revision !== bound.packet.origin.revision || digest(source.origin.scope) !== digest(task.scope))
        throw new ContractError('memory_source_stale');
      return memoryReadSet(bound.packet);
    }
    if (closed || !bridge || !currentModel() || attempt?.id !== task.rootId || attempt.intent.id !== intent.id)
      throw new ContractError('task_session_stale');
    const bound = bridge;
    const live = await bound.call('table.capsule', { campaign: bound.campaign });
    if (closed || bridge !== bound || attempt?.id !== task.rootId) throw new ContractError('task_session_stale');
    const current = readSet(live._context ?? {}, intent);
    const compared = compareReadSet(task.readSet, current);
    if (compared.status === 'stale') trace({ kind: 'stale-read-set', changes: compared.changed });
    return current;
  };
  const ensureRuntime = () => {
    if (runtime) return runtime;
    if (closed || !bridge || !dispatcher) throw new ContractError('task_host_not_ready');
    runtime = new TaskRuntime({decision, ...(options.memoryReadEnabled || options.applyEnabled || options.resolveEnabled || options.sourceEnabled ? {maxSteps: 256} : {}),
      store: options.store ?? createTaskStore(join(bridge.runtime.home, '.coc', 'task-runtime', digest(bridge.campaign), digest(getSession().sessionId))),
      domains: [createTableEvidenceDomain({rawInput: () => attempt?.input ?? '', capsule: () => attempt?.capsule.capsule ?? null, memoryReadEnabled: options.memoryReadEnabled, resolveEnabled: options.resolveEnabled, applyEnabled: options.applyEnabled}),
        createNativeSourceDomain(), createMemoryWriteDomain(), createMemoryReadDomain()],
      operations: {validate, async dispatch(proposal, task, journal) {
        if (!dispatcher || !bridge) throw new ContractError('task_host_not_ready');
        const gateway = dispatcher, boundBridge = bridge;
        const intent = task.context.kind === 'committed_memory' ? memoryBindings.get(task.context.id)?.intent : attempt?.intent;
        if (!intent) throw new ContractError('task_owner_stale');
        executing.add(proposal.id);
        try { const packet = await gateway.dispatch(proposal, {session: getSession(), task, journal,
          validateCurrent: async () => {
            const revisions = await validate(task.context, intent);
            if (task.revalidate(revisions).status !== 'current') throw new ContractError('task_read_set_stale');
            if (gateway !== dispatcher) throw new ContractError('operation_session_stale');
          },
          recover: async identity => {
            if (task.context.kind === 'committed_memory') throw new ContractError('memory_uses_kernel_step_replay');
            if (!identity.request) {
              const current = await boundBridge.call('table.capsule', {campaign: boundBridge.campaign});
              readSet(current._context ?? {}, intent);
              return {status: 'absent', activeTurn: Number(current._context.turn)};
            }
            const result = await boundBridge.call('table.call_status', {campaign: boundBridge.campaign, call_id: identity.callId,
              request: identity.request, scope: {worldline: task.context.scope.worldline, loop: task.context.scope.loop}});
            if (result.status === 'settled') return {status: 'settled', result: result.result as Record<string, Json>};
            if (result.status !== 'absent') throw new ContractError('operation_recovery_invalid');
            return {status: 'absent', activeTurn: result.active_turn as number};
          }, persist: () => runtime!.persistBudget(task.context.id), providerTrace: trace, trace: data => trace({kind: 'operation', ...data}),
        });
          // A recovered canonical reply did not run the ordinary success hook. Reconcile its real receipt revision too.
          const advance = (packet.result as Record<string, any> | null)?._task_advance;
          if (packet.status==='succeeded' && ['resolve','apply'].includes(proposal.operation) && packet.receipts.length && advance
            && advance.campaign===intent.scope.campaign && advance.turn===intent.turn && advance.worldline===intent.scope.worldline && advance.loop===intent.scope.loop) {
            const binding = task.context.readSet.find(value=>value.kind==='world' && value.resource===advance.campaign);
            const core = typeof attempt?.capsule.context.task_world_revision==='string', from=core?advance.task_before:advance.before, to=core?advance.task_after:advance.after;
            if (binding?.revision===from && from!==to) {
              try {
                task.advance({operationId:proposal.id,receiptId:packet.receipts[0],changes:[{kind:'world',resource:advance.campaign,from,to}]});
                await runtime!.persistBudget(task.context.id);
              } catch {
                packet.diagnostics=[...(packet.diagnostics??[]),{code:'bookkeeping_unavailable'}];
              }
            }
          }
          return packet;
        } finally { executing.delete(proposal.id); }
      }},
    });
    return runtime;
  };
  const extension = (api: ExtensionAPI) => {
    pi = api;
    const runMemory = async (request: {campaign: string; turn?: number}, signal?: AbortSignal) => {
      if (!options.memoryEnabled || closed || !bridge || !dispatcher?.registerOwned || request.campaign !== bridge.campaign || signal?.aborted)
        throw new ContractError('memory_owner_unavailable');
      const bound = bridge;
      const packet = await bound.call('memory.job', {campaign: bound.campaign, mode: 'referenced',
        ...(request.turn !== undefined ? {turn: request.turn} : {exclude_turns: [...attemptedMemoryTurns].slice(-128)})});
      if (!packet.job_id) return {status: 'no_job'};
      attemptedMemoryTurns.add(packet.turn);
      if (packet.protocol !== 'memory-reference-v1') return {status: 'legacy'};
      if (packet.status === 'done') return {status: 'complete', turn: packet.turn, candidates: 0};
      const refs = (packet.story_sources as Array<Record<string, any>>).map(value => value.ref);
      if (!refs.length) throw new ContractError('memory_origin_has_no_text');
      const scope = packet.origin.scope, rawInput = refs[0];
      const intent: IntentBinding = {id: randomUUID(), rawInput, scope, turn: packet.turn, inputRevision: rawInput.revision,
        limits: ['committed_memory_only'], goal: 'Organize exact committed conversation evidence.'};
      const shared = ensureRuntime();
      const id = await shared.begin({domain: 'memory-write', intent, lease: {owner: 'memory', kind: 'committed_memory',
        goal: intent.goal!, scope, capabilities: ['memory.write'], readSet: memoryReadSet(packet),
        origin: {turn: packet.turn, sourceRefs: refs}, signal: signal ?? bound.runtime.signal,
        budget: {deadlineAt: Date.now() + 180_000, remainingInputTokens: 1_000_000, remainingOutputTokens: 100_000,
          remainingCostUsd: 1, remainingActions: 128}}});
      memoryBindings.set(id, {packet: structuredClone(packet), intent});
      try {
        const result = await shared.submit(id, {goal: intent.goal!, subgoals: ['Classify and retain source occurrences with explicit relations.'],
          constraints: ['Never rewrite original statements or settle world effects.'], evidenceRequired: ['Canonical committed turn and issued prior occurrences.'],
          completion: ['Every source segment is resolved and required story assessment is recorded.'], capabilities: ['memory.write'],
          replanWhen: [], returnWhen: ['The source owner reports completion or explicit deferred work.']});
        const record = shared.snapshot(id), published = record.observations.filter(value => value.proposal.operation === 'memory.submit');
        trace({kind: 'memory-task-result', memoryTaskId: id, result, steps: record.steps});
        return {status: result.status, turn: packet.turn, job_id: packet.job_id,
          candidates: published.reduce((sum, value) => sum + Number((value.packet.result as any)?.candidates ?? 0), 0),
          remainingNeeds: result.remainingNeeds};
      } finally { memoryBindings.delete(id); }
    };
    if (options.memoryEnabled) pi.events.emit('coc:referenced-memory', runMemory);
    pi.events.on('coc:kernel-bridge', value => { bridge = (value as Bridge)?.call ? value as Bridge : undefined; });
    pi.events.on('coc:operation-dispatcher', value => { dispatcher = value as Dispatcher | undefined; });
    pi.events.on('coc:capsule', value => { capsule = value as Capsule; });
    pi.events.on('coc:table-open', value => { moduleId = (value as {open?: {campaign?: {module_id?: string}}})?.open?.campaign?.module_id; });
    pi.events.on('coc:reading-bridge', value => { reading = value as typeof reading; });
    pi.events.on('coc:task-receipt-advance', value => {
      const event = value as { campaign: string; turn: number; worldline: string; loop: number; operationId: string; receiptIds: string[]; before: string; after: string; task_before?: string; task_after?: string };
      if (!attempt || !runtime || closed || event?.campaign !== attempt.intent.scope.campaign || event.turn !== attempt.intent.turn
        || event.worldline !== attempt.intent.scope.worldline || event.loop !== attempt.intent.scope.loop || !event.receiptIds?.length) return;
      try {
        const taskBinding = typeof attempt.capsule.context.task_world_revision === 'string';
        runtime.lease(attempt.id).advance({ operationId: event.operationId, receiptId: event.receiptIds[0],
          changes: [{ kind: 'world', resource: event.campaign, from: taskBinding ? event.task_before : event.before, to: taskBinding ? event.task_after! : event.after }] });
        void runtime.persistBudget(attempt.id).catch(error => trace({ kind: 'bookkeeping-error', message: String(error) }));
        trace({ kind: 'owned-receipt-advance', ...event });
      } catch (error) { trace({ kind: 'bookkeeping-error', message: String(error) }); }
    });
    pi.events.on('coc:turn-committed', value => {
      const event = value as { campaign?: string; turn?: number; commit?: string };
      if (attempt && runtime && event.campaign === attempt.intent.scope.campaign && event.turn === attempt.intent.turn && event.commit) {
        const active = attempt;
        releaseWriter(active.id);
        void runtime.finishDelivery(active.id, { kind: 'narrate', campaign: event.campaign!, turn: event.turn!, commit: event.commit })
          .then(() => trace({ kind: 'delivered', commit: event.commit }), error => trace({ kind: 'bookkeeping-error', message: String(error) }));
      }
    });
    pi.on('session_start', () => {
      closed = false;
      const session = getSession();
      if (!session.model) throw new ContractError('keeper_model_required');
      model = { provider: session.model.provider, id: session.model.id };
      if (options.resolveEnabled && dispatcher?.registerOwned && bridge) {
        const bound = bridge;
        releaseResolve = dispatcher.registerOwned('resolve.options', {capability:'resolve',kind:'read',
          validate(args) {if (Object.keys(args).length) throw new ContractError('invalid_resolve_options'); return args;},
          async execute(proposal, context) {
            const result = await bound.call('table.resolve.options', {campaign: context.task.context.scope.campaign});
            return {operationId:proposal.id,status:'succeeded',result:result as Json,refs:[],receipts:[],readSet:proposal.readSet,coverage:{used:[],omitted:[],unknown:[]}};
          }});
      }
      if (options.applyEnabled && dispatcher?.registerOwned && bridge) {
        const bound = bridge, gateway=dispatcher;
        releaseApply = dispatcher.registerOwned('apply.options', {capability:'apply',kind:'read',
          validate(args) {if (Object.keys(args).length) throw new ContractError('invalid_apply_options'); return args;},
          async execute(proposal, context) {
            const result = await bound.call('table.apply.options', {campaign:context.task.context.scope.campaign});
            return {operationId:proposal.id,status:'succeeded',result:result as Json,refs:[],receipts:[],readSet:proposal.readSet,coverage:{used:[],omitted:[],unknown:[]}};
          }});
        const releases=['options','prepare'].map(action=>gateway.registerOwned!(`apply.fulfillment.${action}`,{capability:'apply',kind:'read',
          validate(args) {
            const keys=action==='options'?['promises']:['snapshot','selections'];
            if(Object.keys(args).some(key=>!keys.includes(key)))throw new ContractError('invalid_fulfillment_arguments');
            return args;
          },
          async execute(proposal,context) {
            let status:ObservationPacket['status']='succeeded',result:Record<string,any>;
            try{result=await bound.call(`table.fulfillment.${action}`,{campaign:context.task.context.scope.campaign,...proposal.args});}
            catch(error){const failure=error as {code?:string;details?:{reason?:string};message?:string};if(!failure.code)throw error;
              status='refused';result={code:failure.code,reason:failure.details?.reason??'fulfillment_unavailable',message:failure.message??'Fulfillment evidence is unavailable.'};}
            return {operationId:proposal.id,status,result:result as Json,refs:[],receipts:[],readSet:proposal.readSet,coverage:{used:[],omitted:[],unknown:[]}};
          }}));
        releaseFulfillment=()=>releases.forEach(release=>release());
      }
      if (options.memoryEnabled && dispatcher?.registerOwned && bridge) {
        const memoryBridge = bridge;
        releaseMemory = registerMemoryOperations({registerOwned: (name, owner) => dispatcher!.registerOwned!(name, owner),
          binding: task => {
            const value = memoryBindings.get(task.id);
            if (closed || task.kind !== 'committed_memory' || task.owner !== 'memory' || !value) throw new ContractError('memory_owner_stale');
            return value;
          }, call: (method, params) => memoryBridge.call(method, params)});
        pi.events.emit('coc:referenced-memory', runMemory);
      }
      if (options.memoryReadEnabled && dispatcher?.registerOwned && bridge) {
        const gateway = dispatcher, boundBridge = bridge;
        releaseMemoryRead = registerMemoryReadOperations({registerOwned: (name, owner) => gateway.registerOwned!(name, owner),
          runtime: ensureRuntime, call: (method, params) => boundBridge.call(method, params)});
        pi.events.emit('coc:typed-memory-search', async (request: {campaign: string; toolCallId: string; query: string; filters: Record<string, Json>}, signal?: AbortSignal) => {
          const active = attempt, shared = runtime;
          if (!active || !shared || request.campaign !== boundBridge.campaign || signal?.aborted) throw new ContractError('memory_query_scope_stale');
          const task = shared.lease(active.id), identities = new Map<string, import('../../extensions/kernel/canonical-operation-dispatcher.ts').OperationIdentity>();
          const proposal: OperationProposal = {id: randomUUID(), taskId: active.id, operation: 'memory.search', args: {query: request.query, filters: request.filters},
            capability: 'recall', scope: task.context.scope, readSet: task.context.readSet, basis: []};
          const cancel = () => {if (attempt === active) void shared.cancelForeground('memory_query_cancelled');};
          signal?.addEventListener('abort', cancel, {once: true});
          try {
            const packet = await gateway.dispatch(proposal, {session: getSession(), task,
              journal: {load: async id => identities.get(id), save: async identity => {identities.set(identity.operationId, structuredClone(identity));}},
              validateCurrent: async () => {const current = await validate(task.context, active.intent); if (task.revalidate(current).status !== 'current') throw new ContractError('task_read_set_stale');},
              recover: async () => {throw new ContractError('memory_query_has_no_world_settlement');}, trace: data => trace({kind: 'memory-query-operation', ...data})});
            if (packet.status !== 'succeeded') throw new ContractError('memory_query_unavailable');
            const direct = directReads.get(request.toolCallId);
            if (direct) direct.source = {refs: packet.refs, coverage: packet.coverage};
            return presentMemoryEvidence(packet.result) as Record<string, any>;
          } finally {signal?.removeEventListener('abort', cancel);}
        });
      }
      if (options.sourceEnabled && dispatcher?.registerOwned && bridge?.runtime.sourceInfo && bridge.runtime.sourceText && moduleId) {
        const gateway = dispatcher, sourceBridge = bridge, sourceModule = moduleId;
        releaseSource = registerSourceOperations({ registerOwned: (name, definition) => gateway.registerOwned!(name, definition),
          runtime: () => { if (!runtime) throw new ContractError('task_host_not_ready'); return runtime; }, moduleId: () => sourceModule,
          call: (method, params) => sourceBridge.call(method, params),
          sourceInfo: (pdf, signal) => sourceBridge.runtime.sourceInfo!({pdf, cache: sourceBridge.runtime.home}, signal),
          sourceText: (pdf, pages, expected, signal) => sourceBridge.runtime.sourceText!({pdf, pages, expected_file_sha256: expected}, signal),
          visual: (module, question, signal, taskId) => {
            if (!reading) throw new ContractError('source_reader_unavailable');
            return reading.ensure(module, {purpose: 'answer', campaign: sourceBridge.campaign, focus: 'Authored source consultation', question, foreground: true}, signal,
              {providerBudget: providerBudget(taskId)});
          },
        });
        pi.events.emit('coc:native-source-consult', async (request: {moduleId: string; campaign: string; toolCallId: string; question: string}, signal?: AbortSignal) => {
          const active = attempt;
          if (!runtime || !active || request.moduleId !== sourceModule || request.campaign !== sourceBridge.campaign || signal?.aborted)
            throw new ContractError('source_scope_stale');
          const task = runtime.lease(active.id), identities = new Map<string, import('../../extensions/kernel/canonical-operation-dispatcher.ts').OperationIdentity>();
          const proposal: OperationProposal = {id: randomUUID(), taskId: active.id, operation: 'source.consult', args: {question: request.question},
            capability: SOURCE_CONSULT_CAPABILITY, scope: task.context.scope, readSet: task.context.readSet, basis: []};
          const cancel = () => { if (attempt === active) void runtime!.cancelForeground('source_call_cancelled'); };
          signal?.addEventListener('abort', cancel, {once: true});
          let result: ObservationPacket;
          try { result = await gateway.dispatch(proposal, {session: getSession(), task,
            journal: {load: async id => identities.get(id), save: async identity => {identities.set(identity.operationId, structuredClone(identity));}},
            validateCurrent: async () => { const current = await validate(task.context, active.intent); if (task.revalidate(current).status !== 'current') throw new ContractError('task_read_set_stale'); },
            recover: async () => { throw new ContractError('source_consultation_has_no_world_settlement'); }, trace: data => trace({kind: 'source-operation', ...data}),
          }); } finally { signal?.removeEventListener('abort', cancel); }
          const direct = directReads.get(request.toolCallId);
          if (direct) direct.source = {refs: result.refs, coverage: result.coverage};
          if (result.status === 'cancelled' || result.status === 'stale') throw new ContractError('source_scope_stale');
          return result.result as Record<string, any>;
        });
      }
      pi.events.emit('coc:task-receipt-tracking', true);
      pi.events.emit('coc:task-provider-budget', () => attempt && runtime ? providerBudget(attempt.id) : undefined);
      pi.setActiveTools([...pi.getActiveTools(), 'submit_plan_packet']);
      pi.events.emit('coc:task-delivery-guard', async (message?: { provider?: unknown; model?: unknown }, phase: 'auditing' | 'committing' = 'auditing') => {
        keeper(message);
        const active = attempt;
        if (!active) return;
        if (closed || !runtime) throw new ContractError('task_session_stale');
        if (runtime.snapshot(active.id).phase === 'planning') await runtime.directDraft(active.id);
        await runtime.markDelivery(active.id, phase);
        if (attempt !== active || closed) throw new ContractError('task_session_stale');
      });
    });
    pi.events.on('coc:player-input-queued', value => {
      const event = value as { text?: unknown };
      if (typeof event?.text !== 'string' || !attempt || !runtime) return;
      pending = event.text;
      void runtime.cancelForeground('new_player_input').catch(error => trace({ kind: 'bookkeeping-error', message: String(error) }));
      void getSession().abort();
    });
    pi.on('model_select', async () => { await runtime?.cancelForeground('keeper_model_changed'); });
    pi.on('input', (event, ctx) => {
      if (event.source === 'extension') return;
      pending = event.text;
      if (runtime) void runtime.cancelForeground('new_player_input').catch(error => trace({ kind: 'bookkeeping-error', message: String(error) }));
      if (getSession().isStreaming) ctx.abort();
    });
    pi.on('before_agent_start', async event => {
      if (pending === undefined || event.prompt !== pending) return;
      if (closed || !bridge || !dispatcher || !capsule || capsule.campaign !== bridge.campaign) throw new ContractError('task_host_not_ready');
      const selectedModel = getSession().model;
      if (!selectedModel) throw new ContractError('keeper_model_required');
      model = { provider: selectedModel.provider, id: selectedModel.id };
      const input = pending; pending = undefined;
      if (attempt) releaseWriter(attempt.id);
      const bound = capsule;
      const scope = { owner: `session:${getSession().sessionId}`, campaign: bound.campaign, worldline: String(bound.context.worldline),
        loop: Number(bound.context.loop), audience: 'keeper' as const };
      const inputRevision = digest(input), intentId = randomUUID();
      const rawInput = issueSourceRef({ scope, resource: `turn:${bound.turn}:player`, revision: inputRevision, sourceType: 'turn', text: input },
        { kind: 'utf16', start: 0, end: input.length });
      const intent: IntentBinding = { id: intentId, rawInput, limits: [options.applyEnabled ? 'ordinary_mutations_only' : options.resolveEnabled ? 'ordinary_resolve_only' : 'read_only'], scope, turn: bound.turn, inputRevision };
      ensureRuntime();
      const budget: TaskBudget = { deadlineAt: Date.now() + (options.deadlineMs ?? DEFAULT_TASK_DEADLINE_MS), remainingInputTokens: options.memoryReadEnabled || options.applyEnabled || options.resolveEnabled || options.sourceEnabled ? 1_000_000 : 250_000,
        remainingOutputTokens: 150_000, remainingCostUsd: 10, remainingActions: options.memoryReadEnabled || options.applyEnabled || options.resolveEnabled || options.sourceEnabled ? 128 : 32 };
      const id = await runtime!.begin({ domain: 'table-evidence', intent, lease: { owner: 'keeper', goal: input || 'Respond to the current player input.', scope,
        capabilities: planCapabilities,
        budget, readSet: readSet(bound.context, intent), signal: bridge.runtime.signal } });
      attempt = { id, input, intent, capsule: structuredClone(bound) };
      runtime!.lease(id).signal.addEventListener('abort', () => {
        releaseWriter(id);
        if (attempt?.id === id && runtime?.snapshot(id).status !== 'closed') void getSession().abort();
      }, { once: true });
      pi.setActiveTools(['submit_plan_packet', 'look', 'recall', 'lookup', 'narrate', 'ask']);
      trace({ kind: 'planning', intent: intent.id, model });
      const protocol = options.resolveEnabled || options.applyEnabled ? PROTOCOL.replace('This opt-in read-only domain cannot settle world changes; preserve that limit instead of narrating an unexecuted action.',
        (options.resolveEnabled ? 'For a player-selected uncertain ordinary skill or characteristic action, submit a semantic plan requesting resolve. ' : '')
        + (options.applyEnabled ? 'For source-grounded ordinary world changes, request apply. A plan may request both: one ordinary check runs first, then an effect batch is selected from the actual result. ' : '')
        + 'The host uses actual current rule/profile/effect choices and the canonical admission and kernel path. Specialized rules, push, luck and defense remain with their incumbent owners; never narrate an unsupported action as settled.') : PROTOCOL;
      return { systemPrompt: event.systemPrompt + protocol + `\nEnabled plan capabilities for this table: ${JSON.stringify(planCapabilities)}. Request only these capabilities.`
        + '\nExact module/rule/catalog lookup may use the ordinary lookup tool directly with zero Jev decisions. '
        + (options.sourceEnabled ? 'For authored PDF consultation, use ordinary lookup source in answer mode or submit a plan requesting lookup.source.answer; both enter the same source task with native search and original-page fallback. Neither prepares playable material.' : '')
        + (options.memoryReadEnabled ? '\nFor semantic past-memory questions, ordinary recall what=memory with query enters the same bounded memory evidence task. Preserve report attribution and unknown coverage; it never settles rewards.' : '') };
    });
    pi.on('tool_call', async event => {
      if (!attempt || executing.has(event.toolCallId)) return;
      try { keeper(); runtime!.lease(attempt.id).assertActive(); }
      catch (error) { return { block: true, terminate: true, reason: String(error) }; }
      // The current writer is already funded; terminal delivery pays only its actual review work.
      if (['submit_plan_packet', 'lookup', 'look', 'recall', 'resolve', 'apply'].includes(event.toolName)) {
        try { await holdWriter(attempt.id); }
        catch (error) { return {block: true, reason: `The remaining task budget cannot cover this work and its writer: ${String(error)}`}; }
      }
      if (['resolve', 'apply'].includes(event.toolName) && runtime!.snapshot(attempt.id).result?.handoff?.verbs.includes(event.toolName as 'resolve' | 'apply')) {
        if (!dispatcher?.bindIncumbentScope || !bridge) return {block: true, reason: 'The incumbent operation binding is unavailable.'};
        const active = attempt, bound = bridge;
        const prepared = await runtime!.beginIncumbent(active.id, event.toolName, event.input as Record<string, Json>);
        try {
          const complete = await dispatcher.bindIncumbentScope(event.toolCallId, prepared.proposal, {
            session: getSession(), task: prepared.task, journal: prepared.journal,
            validateCurrent: async () => {
              const current = await validate(prepared.task.context, active.intent);
              if (prepared.task.revalidate(current).status !== 'current') throw new ContractError('task_read_set_stale');
            },
            recover: async identity => {
              if (!identity.request) return {status: 'absent', activeTurn: active.intent.turn};
              const result = await bound.call('table.call_status', {campaign: bound.campaign, call_id: identity.callId,
                request: identity.request, scope: {worldline: active.intent.scope.worldline, loop: active.intent.scope.loop}});
              if (result.status === 'settled') return {status: 'settled', result: result.result as Record<string, Json>};
              if (result.status !== 'absent') throw new ContractError('operation_recovery_invalid');
              return {status: 'absent', activeTurn: result.active_turn as number};
            },
            persist: () => runtime!.persistBudget(active.id),
            providerTrace: trace,
            trace: data => trace({kind: 'incumbent-operation', ...data}),
          });
          incumbentCalls.set(event.toolCallId, {taskId: active.id, complete});
          return;
        } catch (error) {
          await runtime!.completeIncumbent(active.id, {operationId: prepared.proposal.id, status: 'failed', result: null,
            refs: [], receipts: [], readSet: prepared.proposal.readSet, coverage: {used: [], omitted: [], unknown: ['Incumbent binding failed.']}});
          return {block: true, reason: String(error)};
        }
      }
      const directLookup = event.toolName === 'lookup' && (['module', 'rule', 'catalog'].includes(String(event.input.kind))
        || options.sourceEnabled && event.input.kind === 'source' && event.input.source_mode === 'answer');
      const directMemory = options.memoryReadEnabled && event.toolName === 'recall' && event.input.what === 'memory' && typeof event.input.query === 'string';
      const incumbentRead = !!runtime!.snapshot(attempt.id).result?.handoff && ['look', 'recall'].includes(event.toolName);
      if ((directLookup || directMemory || incumbentRead) && dispatcher?.bindReadScope) {
        const active = attempt, task = runtime!.lease(active.id);
        const proposal: OperationProposal = {id: randomUUID(), taskId: active.id, operation: event.toolName, args: structuredClone(event.input) as Record<string, Json>,
          capability: operationCapability(event.toolName, event.input), scope: task.context.scope, readSet: task.context.readSet, basis: []};
        const release = await dispatcher.bindReadScope(event.toolCallId, proposal, {session: getSession(), task,
          journal: {load: async () => undefined, save: async () => { throw new ContractError('direct_read_cannot_mutate'); }},
          validateCurrent: async () => { const current = await validate(task.context, active.intent); if (task.revalidate(current).status !== 'current') throw new ContractError('task_read_set_stale'); },
          recover: async () => { throw new ContractError('direct_read_cannot_mutate'); }, trace: data => trace({kind: 'direct-read', ...data})});
        directReads.set(event.toolCallId, {proposal, release}); await runtime!.persistBudget(active.id); return;
      }
      if (!['submit_plan_packet', 'narrate', 'ask'].includes(event.toolName)) return { block: true, reason: 'Submit a bounded plan; the current host task owns its reads.' };
    });
    pi.on('tool_result', async event => {
      const incumbent = incumbentCalls.get(event.toolCallId);
      if (incumbent && runtime) {
        incumbentCalls.delete(event.toolCallId);
        await runtime.completeIncumbent(incumbent.taskId, await incumbent.complete((event.details ?? {}) as Record<string, unknown>, !!event.isError));
      }
      const direct = directReads.get(event.toolCallId);
      if (direct && runtime) {
        direct.release(); directReads.delete(event.toolCallId);
        const data = JSON.parse(JSON.stringify(event.details ?? null)) as Json;
        await runtime.observeDirectRead(direct.proposal.taskId, direct.proposal, {operationId: direct.proposal.id,
          status: event.isError || (event.details as Record<string, unknown>)?.coc_error ? 'refused' : 'succeeded', result: data,
          refs: direct.source?.refs ?? [], receipts: [], readSet: direct.proposal.readSet, coverage: direct.source?.coverage ?? {used: [], omitted: [], unknown: []}});
      }
      if (!attempt || !runtime || event.isError || !['narrate', 'ask'].includes(event.toolName)) return;
      const details = event.details as Record<string, unknown> | undefined;
      if (details && !details.coc_error && event.toolName === 'ask' && runtime.snapshot(attempt.id).status === 'ready') {
        const choice = details.pending_choice as { name?: unknown } | undefined;
        if (typeof choice?.name === 'string') {
          releaseWriter(attempt.id);
          await runtime.finishDelivery(attempt.id, { kind: 'ask', campaign: attempt.intent.scope.campaign!, turn: attempt.intent.turn, pendingChoice: choice.name });
        }
      }
    });
    pi.on('before_provider_request', async (event, ctx) => {
      if (!attempt || !runtime) return;
      try {
        const activeModel = getSession().model!;
        if (!currentModel()) throw new ContractError('keeper_model_changed');
        const payload = event.payload as Record<string, unknown>;
        const inputTokens = Buffer.byteLength(JSON.stringify(event.payload), 'utf8');
        lastKeeperPayloadBytes = inputTokens;
        const ceiling = Math.min(Number(payload.max_output_tokens ?? payload.max_completion_tokens ?? payload.max_tokens ?? activeModel.maxTokens), 8192);
        if (!Number.isSafeInteger(ceiling) || Number(ceiling) < 1) throw new ContractError('keeper_output_bound_unavailable');
        const rates = [activeModel.cost, ...(activeModel.cost.tiers ?? [])];
        const inputRate = Math.max(...rates.flatMap(rate => [rate.input, rate.cacheRead, rate.cacheWrite]));
        const outputRate = Math.max(...rates.map(rate => rate.output));
        const costUsd = (inputTokens * inputRate + Number(ceiling) * outputRate) / 1_000_000;
        trace({ kind: 'keeper-reservation-request', inputTokens, outputTokens: ceiling, costUsd,
          remaining: runtime.lease(attempt.id).context.budget });
        releaseWriter(attempt.id);
        const reservation = runtime.lease(attempt.id).reserve({ inputTokens, outputTokens: Number(ceiling), costUsd, actions: 1 });
        keeperReservations.push({ taskId: attempt.id, reservation });
        await runtime.persistBudget(attempt.id);
        trace({ kind: 'keeper-reservation', inputTokens, outputTokens: ceiling, costUsd, estimate: 'utf8_payload_bytes_and_configured_output_ceiling' });
        const field = Object.hasOwn(payload, 'max_output_tokens') || ['openai-responses', 'azure-openai-responses', 'openai-codex-responses'].includes(activeModel.api)
          ? 'max_output_tokens' : Object.hasOwn(payload, 'max_completion_tokens') ? 'max_completion_tokens' : 'max_tokens';
        return { ...payload, [field]: ceiling };
      } catch (error) { ctx.abort(); throw error; }
    });
    pi.on('message_end', async (event, ctx) => {
      if (event.message.role !== 'assistant') return;
      lastKeeperAssistantBytes = Buffer.byteLength(JSON.stringify(event.message), 'utf8');
      try { keeper(event.message); } catch { ctx.abort(); return { message: { ...event.message, content: [] } }; }
      const reservations = keeperReservations.splice(0);
      for (const [index, charge] of reservations.entries()) {
        const usage = event.message.usage;
        try {
          if (index !== reservations.length - 1 || ['error', 'aborted'].includes(event.message.stopReason)) charge.reservation.settle();
          else charge.reservation.settle({ inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
            outputTokens: usage.output, costUsd: usage.cost.total, actions: 1 });
          await runtime!.persistBudget(charge.taskId);
        } catch (error) { ctx.abort(); trace({ kind: 'keeper-accounting-error', message: String(error) }); }
      }
      trace({ kind: 'keeper-usage', provider: event.message.provider, model: event.message.model, usage: event.message.usage });
    });
    pi.on('session_shutdown', async () => {
      closed = true;
      for (const id of writerReservations.keys()) releaseWriter(id);
      try { await runtime?.shutdown(); } finally {
        releaseSource(); releaseMemory(); releaseMemoryRead(); releaseResolve(); releaseApply(); releaseFulfillment(); for (const direct of directReads.values()) direct.release(); directReads.clear();
        pi.events.emit('coc:task-delivery-guard', undefined); executing.clear();
        pi.events.emit('coc:task-receipt-tracking', false);
        pi.events.emit('coc:task-provider-budget', undefined); providerBudgets.clear();
        pi.events.emit('coc:native-source-consult', undefined);
        pi.events.emit('coc:referenced-memory', undefined);
        pi.events.emit('coc:typed-memory-search', undefined);
      }
    });
    pi.registerTool({ name: 'submit_plan_packet', label: 'Private plan', parameters: planParameters, executionMode: 'sequential',
      description: 'Submit a bounded semantic plan. Available read capabilities are look, recall, lookup.module, lookup.rule and lookup.catalog, plus lookup.source.answer when enabled. '
        + (options.resolveEnabled ? 'The resolve capability settles one ordinary check through the actual guarded kernel. ' : '')
        + (options.applyEnabled ? 'The apply capability commits one atomic batch of current host-issued effects after all required bindings are known. ' : '')
        + 'The host chooses actual issued operations, iterates over observations and returns evidence. Do not provide IDs or executable arguments.',
      async execute(_id, params, signal) {
        const active = attempt;
        if (!runtime || !active) throw new ContractError('task_not_planning');
        const abort = () => { if (attempt === active) void runtime!.cancelForeground('role_cancelled'); };
        signal?.addEventListener('abort', abort, { once: true });
        try {
          if (signal?.aborted) abort();
          const result = await runtime.submit(active.id, params), record = runtime.snapshot(active.id);
          if (result.handoff) pi.setActiveTools(['look', 'recall', 'lookup', 'narrate', 'ask', ...result.handoff.verbs]);
          trace({ kind: 'task-result', result, steps: record.steps });
          const details = { ...result, observations: record.observations.map(value => value.packet),
            replan: record.phase === 'planning', settledReceipts: result.receipts };
          const presentation = { status: result.status, remainingNeeds: result.remainingNeeds, coverage: result.coverage,
            observations: record.observations.map(value => ({ operation: value.proposal.operation, status: value.packet.status,
              data: ['resolve.options','apply.options','apply.fulfillment.options','apply.fulfillment.prepare'].includes(value.proposal.operation) ? {status:value.packet.status, purpose:'Current canonical options and source bindings were checked for this bounded action.'}
                : value.packet.result && typeof value.packet.result==='object' && !Array.isArray(value.packet.result)
                ? Object.fromEntries(Object.entries(value.packet.result).filter(([key])=>key!=='_task_advance')) : value.packet.result })),
            replan: record.phase === 'planning', ...(result.handoff ? {handoff: {verbs: result.handoff.verbs,
              instruction: 'Continue this same declared goal through only these existing public tools. Previous effects and ordinary admission remain authoritative.'}} : {}) };
          return { content: [{ type: 'text', text: JSON.stringify(boundedPlanPresentation(presentation)) }], details,
            ...(['cancelled', 'stale'].includes(result.status) ? { terminate: true } : {}) };
        } finally { signal?.removeEventListener('abort', abort); }
      },
    });
  };
  return { extension, recordDecision: (data: unknown) => { if (pi) pi.appendEntry('coc-jev-decision', data); },
    status: () => ({ closed, task: attempt && runtime ? runtime.snapshot(attempt.id) : undefined }) };
}
