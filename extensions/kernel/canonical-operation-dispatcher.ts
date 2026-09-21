/** Shared COC operation stages. Host proposals use the public extension runner, never fake Pi turns. */
import { createHash } from 'node:crypto';
import { validateToolArguments } from '@earendil-works/pi-ai';
import type { AgentToolUpdateCallback, AgentSession, ExtensionContext, ToolCallEvent, ToolCallEventResult, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { ContractError, isPlainRecord, type Json, type ObservationPacket, type OperationProposal } from '../../runtime/jev/contracts.ts';
import type { TaskLease } from '../../runtime/jev/task-context.ts';
import { awaitOrYield } from '../../runtime/jev/task-outcome.ts';
import { COC_TOOLS, type CocToolSpec } from './tools.ts';
import {runOwnedSourcePreparation} from '../../runtime/jev/source-preparation.ts';
import {createTaskProviderBudget, type TaskProviderBudget} from '../../runtime/jev/provider-budget.ts';

export interface KernelToolResult { content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown>; terminate?: boolean }
export interface OperationIdentity {
  operationId: string;
  taskId: string;
  signature: string;
  callId?: string;
  /** The exact payload is persisted before invoking a mutating kernel method. */
  request?: Record<string, Json>;
}
export interface OperationJournal {
  load(operationId: string): Promise<OperationIdentity | undefined>;
  save(identity: OperationIdentity): Promise<void>;
}
export interface HostOperationContext {
  session?: AgentSession;
  task: TaskLease;
  journal: OperationJournal;
  /** Checks latest intent, scope and relevant read set, including the mutation commit preconditions. */
  validateCurrent(proposal: OperationProposal, prepared?: { method: string; request: Record<string, unknown> }): Promise<void>;
  /** Host-only read over the existing canonical call record; it must not execute an operation. */
  recover(identity: OperationIdentity): Promise<{ status: 'settled'; result: Record<string, Json> } | { status: 'absent'; activeTurn: number }>;
  trace(event: { operationId: string; stage: string; recovered?: boolean }): void;
  onUpdate?: AgentToolUpdateCallback<unknown>;
  persist?(): Promise<void>;
  providerTrace?(event: Record<string, unknown>): void;
}
interface Stages {
  prepare(event: ToolCallEvent, context: ExtensionContext): Promise<ToolCallEventResult | undefined>;
  execute(spec: CocToolSpec, toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal,
    update?: AgentToolUpdateCallback<Record<string, unknown>>): Promise<KernelToolResult>;
  finalize(event: ToolResultEvent): Promise<Awaited<ReturnType<AgentSession['extensionRunner']['emitToolResult']>>>;
  preparedCallId(toolCallId: string): string | undefined;
}
interface Frame { proposal: OperationProposal; context: HostOperationContext; identity: OperationIdentity; round: string; providerBudget?: TaskProviderBudget }
export interface OwnedOperation {
  capability: string;
  kind: 'read' | 'publication';
  validate(args: Record<string, Json>): Record<string, Json>;
  /** Publication must use the owning kernel's idempotent job/step/lease protocol. */
  execute(proposal: OperationProposal, context: HostOperationContext): Promise<ObservationPacket>;
}

function validCallId(value: unknown): value is string {
  const parts = typeof value === 'string' ? /^t(\d+)-c(\d+)$/.exec(value) : null;
  return !!parts && Number.isSafeInteger(Number(parts[1])) && Number.isSafeInteger(Number(parts[2]));
}
function validateIdentity(value: unknown): asserts value is OperationIdentity {
  if (!isPlainRecord(value) || Object.keys(value).some(key => !['operationId', 'taskId', 'signature', 'callId', 'request'].includes(key))
    || ['operationId', 'taskId', 'signature'].some(key => typeof value[key] !== 'string' || !value[key])
    || Object.hasOwn(value, 'callId') && !validCallId(value.callId)
    || Object.hasOwn(value, 'request') && (!isPlainRecord(value.request) || !value.callId || value.request.call_id !== value.callId
      || typeof value.request.campaign !== 'string' || !value.request.campaign)) throw new ContractError('invalid_operation_identity');
}
function settledMutation(proposal: OperationProposal, result: KernelToolResult | undefined): boolean {
  return ['resolve', 'apply'].includes(proposal.operation) && !!result && !result.details.coc_error
    && (typeof result.details.receipt === 'string' || Array.isArray(result.details.receipts));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
}
function signature(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function closedSchema(value: any): any {
  if (Array.isArray(value)) return value.map(closedSchema);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, closedSchema(child)]));
  if (result.type === 'object' && result.properties) result.additionalProperties = false;
  return result;
}

/** Closed argument syntax determines capability; semantic relevance never grants it. */
export function operationCapability(name: string, args: Record<string, unknown>): string {
  if (name !== 'lookup') return name;
  if (args.kind === 'source') return args.source_mode === 'answer' ? 'lookup.source.answer' : 'source.prepare';
  if (args.kind === 'adaptation') return `adaptation.${args.action ?? 'status'}`;
  return `lookup.${args.kind}`;
}

export function createCanonicalOperationDispatcher(stages?: Stages) {
  const frames = new Map<string, Frame>();
  const pending = new Set<string>();
  const owners = new Map<string, OwnedOperation>();
  let tail: Promise<unknown> = Promise.resolve();
  const packet = (proposal: OperationProposal, status: ObservationPacket['status'], result: unknown): ObservationPacket => {
    const body = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    const receipts = [body.receipt, ...(Array.isArray(body.receipts) ? body.receipts : [])].filter((value): value is string => typeof value === 'string');
    return { operationId: proposal.id, status, result: JSON.parse(JSON.stringify(result ?? null)) as Json,
      refs: [], receipts: [...new Set(receipts)], readSet: structuredClone(proposal.readSet), coverage: { used: [], omitted: [], unknown: [] } };
  };
  const api = {
    prepare(...args: Parameters<Stages['prepare']>) {
      if (!stages) throw new ContractError('gameplay_owner_unavailable');
      return stages.prepare(...args);
    },
    execute(...args: Parameters<Stages['execute']>) {
      if (!stages) throw new ContractError('gameplay_owner_unavailable');
      return stages.execute(...args);
    },
    finalize(...args: Parameters<Stages['finalize']>) {
      if (!stages) throw new ContractError('gameplay_owner_unavailable');
      return stages.finalize(...args);
    },
    registerOwned(name: string, owner: OwnedOperation): () => void {
      if (!/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*$/.test(name) || owners.has(name) || !owner.capability
        || !['read', 'publication'].includes(owner.kind) || typeof owner.validate !== 'function' || typeof owner.execute !== 'function')
        throw new ContractError('invalid_owned_operation');
      const registered = Object.freeze({ ...owner }); owners.set(name, registered);
      return () => { if (owners.get(name) === registered) owners.delete(name); };
    },
    async bindReadScope(toolCallId: string, proposal: OperationProposal, context: HostOperationContext): Promise<() => void> {
      const capability = operationCapability(proposal.operation, proposal.args), task = context.task.context;
      if (!['look', 'recall', 'lookup.module', 'lookup.rule', 'lookup.catalog', 'lookup.secret', 'lookup.continuity', 'lookup.source.answer'].includes(capability)
        || proposal.taskId !== task.id || proposal.capability !== capability || !task.capabilities.includes(capability)
        || signature(proposal.scope) !== signature(task.scope) || frames.has(toolCallId)) throw new ContractError('operation_capability_out_of_scope');
      await context.validateCurrent(structuredClone(proposal)); context.task.assertActive();
      const reservation = context.task.reserve({inputTokens: 0, outputTokens: 0, costUsd: 0, actions: 1});
      reservation.settle(); const sequence = context.task.nextStep();
      const frame: Frame = {proposal: structuredClone(proposal), context,
        identity: {operationId: proposal.id, taskId: task.id, signature: signature(proposal)}, round: `task:${task.rootId}:${sequence.rootStep}`};
      frames.set(toolCallId, frame);
      return () => { if (frames.get(toolCallId) === frame) frames.delete(toolCallId); };
    },
    /** The real public tool hooks execute once; this only binds their incumbent operation ownership. */
    async bindIncumbentScope(toolCallId: string, proposal: OperationProposal, context: HostOperationContext) {
      const task = context.task.context;
      if (!stages || !['resolve', 'apply'].includes(proposal.operation) || proposal.capability !== proposal.operation
        || proposal.taskId !== task.id || !task.capabilities.includes(proposal.capability)
        || signature(proposal.scope) !== signature(task.scope) || frames.has(toolCallId))
        throw new ContractError('incumbent_operation_out_of_scope');
      await context.validateCurrent(proposal); context.task.assertActive();
      context.task.reserve({inputTokens: 0, outputTokens: 0, costUsd: 0, actions: 1}).settle();
      const sequence = context.task.nextStep();
      const frame: Frame = {proposal: structuredClone(proposal), context,
        identity: {operationId: proposal.id, taskId: task.id, signature: signature(proposal)},
        round: `task:${task.rootId}:${sequence.rootStep}`};
      frames.set(toolCallId, frame);
      try { await context.journal.save(frame.identity); }
      catch (error) { frames.delete(toolCallId); throw error; }
      return async (result: Record<string, unknown>, isError: boolean): Promise<ObservationPacket> => {
        try {
          if (!isError && !result.coc_error) return packet(proposal, 'succeeded', result);
          if (frame.identity.request) {
            try {
              const recovery = await context.recover(frame.identity);
              if (recovery.status === 'settled') return {...packet(proposal, 'succeeded', recovery.result), diagnostics: [{code: 'bookkeeping_unavailable'}]};
            } catch {
              return {...packet(proposal, 'pending', result), diagnostics: [{code: 'settlement_unknown'}]};
            }
          }
          return packet(proposal, context.task.signal.aborted ? 'cancelled' : 'refused', result);
        } finally { if (frames.get(toolCallId) === frame) frames.delete(toolCallId); }
      };
    },
    fixedCallId(toolCallId: string): string | undefined { return frames.get(toolCallId)?.identity.callId; },
    async bindKernelCallId(toolCallId: string, callId: unknown): Promise<void> {
      const frame = frames.get(toolCallId);
      if (!frame || !['resolve', 'apply'].includes(frame.proposal.operation)) return;
      if (!validCallId(callId) || frame.identity.callId && frame.identity.callId !== callId)
        throw new ContractError('operation_call_binding_mismatch');
      frame.identity.callId = callId;
      await frame.context.journal.save(structuredClone(frame.identity));
    },
    tracksMutation(toolCallId: string): boolean { return ['resolve', 'apply'].includes(frames.get(toolCallId)?.proposal.operation ?? ''); },
    providerBudget(toolCallId: string): TaskProviderBudget | undefined {
      const frame = frames.get(toolCallId);
      if (!frame) return undefined;
      return frame.providerBudget ??= createTaskProviderBudget(frame.context.task, {changed: frame.context.persist, record: frame.context.providerTrace});
    },
    attemptRound(toolCallId: string): string | undefined { return frames.get(toolCallId)?.round; },
    requireCapability(toolCallId: string, capability: string): void {
      const frame = frames.get(toolCallId);
      if (frame && !frame.context.task.context.capabilities.includes(capability)) throw new ContractError('operation_capability_out_of_scope');
    },
    async prepareSource(toolCallId: string, moduleId: string, failure: unknown,
      ensure: (params: Record<string, unknown>, signal: AbortSignal, providerBudget?: TaskProviderBudget) => Promise<Record<string, any>>): Promise<boolean> {
      const frame = frames.get(toolCallId);
      if (!frame) return false;
      if (!frame.identity.callId) throw new ContractError('source_preparation_binding_missing');
      await runOwnedSourcePreparation({task: frame.context.task, proposal: frame.proposal, callId: frame.identity.callId,
        moduleId, failure, ensure: (params, signal) => ensure(params, signal, api.providerBudget(toolCallId)), validateCurrent: () => frame.context.validateCurrent(frame.proposal),
        advanced: async () => { await frame.context.persist?.(); }});
      return true;
    },
    async beforeKernelInvoke(toolCallId: string, method: string, request: Record<string, unknown>): Promise<void> {
      const frame = frames.get(toolCallId);
      if (!frame) return;
      if (frame.proposal.bindings) {
        if (method!=='table.apply') throw new ContractError('operation_binding_out_of_scope');
        request._fulfillments=structuredClone(frame.proposal.bindings.fulfillments);
      }
      frame.context.task.assertActive();
      await frame.context.validateCurrent(structuredClone(frame.proposal), { method, request: structuredClone(request) });
      frame.context.task.assertActive();
      if (method !== 'table.resolve' && method !== 'table.apply') return;
      frame.identity.callId ??= stages?.preparedCallId(toolCallId);
      if (request.call_id !== frame.identity.callId) throw new ContractError('operation_call_binding_mismatch');
      const exact = JSON.parse(JSON.stringify(request)) as Record<string, Json>;
      if (frame.identity.request && signature(frame.identity.request) !== signature(exact)) throw new ContractError('operation_prepared_request_changed');
      frame.identity = { ...frame.identity, request: exact };
      await frame.context.journal.save(structuredClone(frame.identity));
      frame.context.task.assertActive();
      await frame.context.validateCurrent(structuredClone(frame.proposal), { method, request: structuredClone(request) });
      frame.context.task.assertActive();
    },
    async dispatch(proposal: OperationProposal, context: HostOperationContext): Promise<ObservationPacket> {
      if (!isPlainRecord(proposal) || typeof proposal.id !== 'string' || !proposal.id) throw new ContractError('invalid_operation_proposal');
      if (proposal.bindings !== undefined && (proposal.operation!=='apply' || !isPlainRecord(proposal.bindings)
        || Object.keys(proposal.bindings).some(key=>key!=='fulfillments') || !Array.isArray(proposal.bindings.fulfillments)
        || !proposal.bindings.fulfillments.length || proposal.bindings.fulfillments.length>8)) throw new ContractError('invalid_operation_binding');
      if (pending.has(proposal.id)) throw new ContractError('operation_already_running');
      const owner = owners.get(proposal.operation);
      if (owner) {
        pending.add(proposal.id);
        let invoked = false;
        try {
          const operation = structuredClone(proposal), task = context.task.context;
          const live = () => {
            context.task.assertActive();
            if (owners.get(operation.operation) !== owner) throw new ContractError('operation_owner_stale');
          };
          live();
          if (operation.taskId !== task.id || signature(operation.scope) !== signature(task.scope)
            || operation.capability !== owner.capability || !task.capabilities.includes(owner.capability)) throw new ContractError('operation_capability_out_of_scope');
          const args = owner.validate(structuredClone(operation.args));
          if (signature(args) !== signature(operation.args)) throw new ContractError('operation_arguments_changed');
          const fingerprint = signature(operation), retained = await context.journal.load(operation.id);
          if (retained) {
            validateIdentity(retained);
            if (retained.signature !== fingerprint || retained.taskId !== task.id || retained.operationId !== operation.id)
              throw new ContractError('operation_identity_conflict');
          }
          await context.validateCurrent(structuredClone(operation)); live();
          const reservation = context.task.reserve({ inputTokens: 0, outputTokens: 0, costUsd: 0, actions: 1 });
          reservation.settle(); context.task.nextStep();
          await context.journal.save(retained ?? { operationId: operation.id, taskId: task.id, signature: fingerprint });
          await context.validateCurrent(structuredClone(operation)); live();
          context.trace({ operationId: operation.id, stage: 'owner-execute' });
          invoked = true;
          const result = await owner.execute(structuredClone(operation), context);
          if (result.operationId !== operation.id) throw new ContractError('operation_result_mismatch');
          // The owner reports an already accepted publication as such, even if its waiter was cancelled.
          if (owner.kind === 'read') live();
          return structuredClone(result);
        } catch (error) {
          const code = error instanceof ContractError ? error.code : 'owned_operation_failed';
          return { ...packet(proposal, context.task.signal.aborted ? 'cancelled' : invoked && owner.kind === 'publication' ? 'pending' : 'failed', { code }),
            ...(invoked && owner.kind === 'publication' ? { diagnostics: [{code: 'settlement_unknown' as const}] } : {}) };
        } finally { pending.delete(proposal.id); }
      }
      pending.add(proposal.id);
      // Foreground operations share one order. Parallel read fan-out is an explicit future domain policy.
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      const waiting = await awaitOrYield(previous.catch(() => {}), context.task.signal);
      if (waiting.status === 'yielded') {
        // Preserve serialization while releasing the cancelled caller promptly.
        void previous.then(release, release);
        pending.delete(proposal.id);
        return packet(proposal, 'cancelled', { code: 'task_cancelled' });
      }
      let operation = proposal;
      let executed: KernelToolResult | undefined;
      try {
        operation = structuredClone(proposal);
        context.task.assertActive();
        const task = context.task.context;
        const capability = operationCapability(operation.operation, operation.args);
        if (operation.taskId !== task.id || signature(operation.scope) !== signature(task.scope)
          || operation.capability !== capability || !task.capabilities.includes(capability)) throw new ContractError('operation_capability_out_of_scope');
        if (operation.operation === 'narrate' || operation.operation === 'ask') throw new ContractError('delivery_requires_writer_message');
        const session = context.session;
        if (!session || !stages) throw new ContractError('gameplay_owner_unavailable');
        const reservation = context.task.reserve({ inputTokens: 0, outputTokens: 0, costUsd: 0, actions: 1 });
        reservation.settle();
        const step = context.task.nextStep();
        const spec = COC_TOOLS.find(tool => tool.name === operation.operation);
        if (!spec) throw new ContractError('unknown_operation');
        const runner = session.extensionRunner;
        const definition = runner.getToolDefinition(spec.name);
        if (!definition) throw new ContractError('operation_tool_unavailable');
        const live = () => {
          context.task.assertActive();
          if (context.session !== session || session.extensionRunner !== runner || runner.getToolDefinition(spec.name) !== definition) throw new ContractError('operation_session_stale');
        };
        const fingerprint = signature(operation);
        const retained = await context.journal.load(operation.id);
        if (retained !== undefined) validateIdentity(retained);
        if (retained && (retained.operationId !== operation.id || retained.taskId !== operation.taskId || retained.signature !== fingerprint))
          throw new ContractError('operation_identity_conflict');
        const frame: Frame = { proposal: operation, context, round: `task:${task.rootId}:${step.rootStep}`,
          identity: retained ?? { operationId: operation.id, taskId: operation.taskId, signature: fingerprint } };
        if (retained?.callId) {
          live();
          const recovered = await context.recover(structuredClone(retained));
          live();
          if (recovered.status === 'settled') {
            context.trace({ operationId: operation.id, stage: 'recovered', recovered: true });
            return packet(operation, 'succeeded', recovered.result);
          }
          const match = /^t(\d+)-c(\d+)$/.exec(retained.callId ?? '');
          if (!match || Number(match[1]) !== recovered.activeTurn) throw new ContractError('operation_turn_stale');
        }
        live();
        await context.validateCurrent(structuredClone(operation));
        live();
        const args = validateToolArguments({ name: spec.name, description: spec.description, parameters: closedSchema(spec.parameters) },
          { type: 'toolCall', id: operation.id, name: spec.name, arguments: structuredClone(operation.args) }) as Record<string, unknown>;
        frames.set(operation.id, frame);
        context.trace({ operationId: operation.id, stage: 'prepare' });
        const blocked = await runner.emitToolCall({ type: 'tool_call', toolCallId: operation.id, toolName: spec.name, input: args });
        live();
        if (blocked?.block) return packet(operation, 'refused', { reason: blocked.reason, terminate: blocked.terminate });
        if (spec.name === 'resolve' || spec.name === 'apply') {
          frame.identity.callId ??= stages.preparedCallId(operation.id);
          if (!frame.identity.callId) throw new ContractError('operation_call_binding_missing');
          await context.journal.save(structuredClone(frame.identity));
        }
        live();
        context.trace({ operationId: operation.id, stage: 'execute' });
        let result: KernelToolResult, isError = false;
        try { result = await definition.execute(operation.id, args, context.task.signal,
          context.onUpdate ? partial => { if (!context.task.signal.aborted && context.session === session && session.extensionRunner === runner) context.onUpdate!(partial); } : undefined,
          runner.createContext()) as KernelToolResult; }
        catch (error) { result = { content: [{ type: 'text', text: error instanceof Error ? error.message : 'Operation failed' }], details: {} }; isError = true; }
        executed = result;
        context.trace({ operationId: operation.id, stage: 'finalize' });
        let finalizationFailed = false;
        if (context.session === session && session.extensionRunner === runner) {
          try {
            const override = await runner.emitToolResult({ type: 'tool_result', toolName: spec.name, toolCallId: operation.id,
              input: args, content: result.content, details: result.details, isError });
            if (override) {
              result = { ...result, content: (override.content ?? result.content) as KernelToolResult['content'],
                details: (override.details ?? result.details) as Record<string, unknown> };
              isError = override.isError ?? isError;
            }
          } catch { finalizationFailed = true; }
        } else finalizationFailed = true;
        if (settledMutation(operation, executed)) return {
          ...packet(operation, 'succeeded', executed!.details),
          ...(finalizationFailed || isError || context.task.signal.aborted ? { diagnostics: [
            ...(finalizationFailed || isError ? [{ code: 'bookkeeping_unavailable' as const }] : []),
            ...(context.task.signal.aborted ? [{ code: 'owner_cancelled_after_settlement' as const }] : []),
          ] } : {}),
        };
        if (frame.identity.request && (isError || result.details.coc_error || finalizationFailed)) {
          try {
            live();
            const recovery = await context.recover(structuredClone(frame.identity));
            if (recovery.status === 'settled') return { ...packet(operation, 'succeeded', recovery.result), diagnostics: [{ code: 'bookkeeping_unavailable' }] };
          } catch {
            return { ...packet(operation, context.task.signal.aborted ? 'cancelled' : 'pending', result.details), diagnostics: [{ code: 'settlement_unknown' }] };
          }
        }
        return packet(operation, context.task.signal.aborted ? 'cancelled' : finalizationFailed ? 'failed' : isError || result.details.coc_error ? 'refused' : 'succeeded', result.details);
      } catch (error) {
        if (settledMutation(operation, executed)) return { ...packet(operation, 'succeeded', executed!.details), diagnostics: [{ code: 'bookkeeping_unavailable' }] };
        const code = error instanceof ContractError ? error.code : 'operation_failed';
        return packet(operation, context.task.signal.aborted ? 'cancelled' : code.endsWith('_stale') ? 'stale' : 'failed',
          { ...(executed?.details ?? {}), code, message: error instanceof Error ? error.message : 'Operation failed' });
      } finally { frames.delete(operation.id); pending.delete(operation.id); release(); }
    },
  };
  return api;
}
