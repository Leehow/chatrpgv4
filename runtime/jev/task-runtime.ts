/** One bounded host task loop. Domains own semantics; operations own settlement. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, validatePlanSubmission, type DecisionBatch, type DecisionResult, type IntentBinding,
  type Json, type ObservationPacket, type OperationProposal, type PlanSubmission, type ReadSet,
  type SourceRef, type TaskContext, type TaskResult } from './contracts.ts';
import { TaskLease, type TaskCheckpoint, type TaskClock, type TaskLeaseOptions } from './task-context.ts';
import type { DecisionPort } from './decision-port.ts';
import type { OperationIdentity, OperationJournal } from '../../extensions/kernel/canonical-operation-dispatcher.ts';
import { assertTaskRecord } from './task-record.ts';

export type TaskPhase = 'planning' | 'deciding' | 'waiting' | 'composing' | 'auditing' | 'committing' | 'delivering' | 'terminal';
export interface TaskView {
  intent: IntentBinding;
  plan: PlanSubmission;
  context: TaskContext;
  observations: Array<{ key: string; proposal: OperationProposal; packet: ObservationPacket }>;
  decisions: Array<{ key: string; batch: DecisionBatch; result: DecisionResult }>;
  remainingNeeds: string[];
  replans: number;
}
export type TaskStep =
  | { kind: 'decision'; key: string; batch: Omit<DecisionBatch, 'id' | 'scope' | 'readSet'> }
  | { kind: 'decisions'; batches: Array<{ key: string; batch: Omit<DecisionBatch, 'id' | 'scope' | 'readSet'> }> }
  | { kind: 'operation'; key: string; operation: string; args: Record<string, Json>; capability: string; basis: SourceRef[]; bindings?: OperationProposal['bindings'] }
  | { kind: 'finish'; status: 'complete' | 'partial' | 'unresolved' | 'needs_player' | 'failed'; remainingNeeds: string[]; coverage?: TaskResult['coverage'] }
  | { kind: 'wait'; remainingNeeds: string[] }
  | { kind: 'handoff'; verbs: Array<'resolve' | 'apply'>; remainingNeeds: string[] }
  | { kind: 'replan'; remainingNeeds: string[] };
export interface TaskDomain {
  id: string;
  version: string;
  capabilities: string[];
  /** Standalone owner artifacts have no player-facing writer phase. */
  completion?: 'artifact';
  /** Pure host policy over actual observations. Returned operations are not model code. */
  next(view: TaskView): TaskStep;
}
export interface TaskRecord {
  version: 1;
  revision: number;
  domain: { id: string; version: string };
  intent: IntentBinding;
  checkpoint: TaskCheckpoint;
  phase: TaskPhase;
  status: 'active' | 'waiting' | 'ready' | 'closed';
  plan?: PlanSubmission;
  observations: TaskView['observations'];
  decisions: TaskView['decisions'];
  remainingNeeds: string[];
  replans: number;
  steps: number;
  pending?: { key: string; proposal: OperationProposal };
  identities: Record<string, OperationIdentity>;
  result?: TaskResult;
  reason?: string;
}
export interface TaskStore {
  load(id: string): Promise<TaskRecord | undefined>;
  list?(): Promise<TaskRecord[]>;
  /** Atomic replacement of one task's coordination record. */
  save(record: TaskRecord): Promise<void>;
}
export interface TaskOperations {
  validate(task: TaskContext, intent: IntentBinding): Promise<ReadSet>;
  dispatch(proposal: OperationProposal, lease: TaskLease, journal: OperationJournal): Promise<ObservationPacket>;
  /** Read-only canonical call-status lookup. A cancelled lease never regains operation authority. */
  reconcile?(proposal: OperationProposal, identity: OperationIdentity, context: TaskContext): Promise<
    { status: 'settled'; packet: ObservationPacket } | { status: 'absent' }>;
}
interface Entry { record: TaskRecord; lease: TaskLease; running: boolean; saveTail: Promise<void>; fenced?: boolean }
const READY_PHASES: TaskPhase[] = ['composing', 'auditing', 'committing', 'delivering'];
const BACKGROUND_READS = ['look', 'recall', 'lookup.module', 'lookup.rule', 'lookup.catalog', 'lookup.source.answer'];
function durableDecisionInput(value: unknown): void {
  try {
    if (isDeepStrictEqual(value, JSON.parse(JSON.stringify(value)))) return;
  } catch { /* Invalid domain data must not poison the persisted task record. */ }
  throw new ContractError('invalid_decision_input');
}
function backgroundOperation(context: TaskContext, domain: string, step: Extract<TaskStep, {kind: 'operation'}>): boolean {
  if (['resolve', 'apply', 'narrate', 'ask'].includes(step.operation)) return false;
  if (BACKGROUND_READS.includes(step.capability)) return true;
  return context.owner === 'memory' && domain === 'memory-write' && step.capability === 'memory.write'
    && ['memory.job', 'memory.submit'].includes(step.operation);
}

export class TaskRuntime {
  readonly #entries = new Map<string, Entry>();
  readonly #domains = new Map<string, TaskDomain>();
  readonly #options: { decision: DecisionPort; store: TaskStore; operations: TaskOperations; clock?: TaskClock; maxSteps?: number };
  #foreground?: string;
  #closed = false;
  constructor(options: { decision: DecisionPort; store: TaskStore; operations: TaskOperations; domains: TaskDomain[]; clock?: TaskClock; maxSteps?: number }) {
    if (options.maxSteps !== undefined && (!Number.isSafeInteger(options.maxSteps) || options.maxSteps < 1 || options.maxSteps > 256))
      throw new ContractError('invalid_task_step_limit');
    this.#options = options;
    for (const domain of options.domains) {
      if (!domain.id || !domain.version || this.#domains.has(domain.id)) throw new ContractError('invalid_task_domain');
      this.#domains.set(domain.id, domain);
    }
  }
  async begin(options: { lease: TaskLeaseOptions; intent: IntentBinding; domain: string; parentId?: string }): Promise<string> {
    if (this.#closed) throw new ContractError('task_runtime_closed');
    const domain = this.#domains.get(options.domain);
    if (!domain) throw new ContractError('unknown_task_domain');
    const parent = options.parentId ? this.#entry(options.parentId) : undefined;
    if (parent && !isDeepStrictEqual(parent.record.intent, options.intent)) throw new ContractError('child_intent_escalation');
    if (!parent && options.lease.kind !== 'committed_memory') await this.cancelForeground('new_player_input');
    const lease = new TaskLease({ ...options.lease, clock: options.lease.clock ?? this.#options.clock }, parent?.lease);
    const context = lease.context;
    if (context.capabilities.some(value => !domain.capabilities.includes(value))
      || !isDeepStrictEqual(context.scope, options.intent.scope)) {
      lease.close(); throw new ContractError('task_intent_scope_mismatch');
    }
    const record: TaskRecord = { version: 1, revision: 0, domain: { id: domain.id, version: domain.version },
      intent: structuredClone(options.intent), checkpoint: lease.checkpoint('planning', [], context.goal), phase: 'planning', status: 'active',
      observations: [], decisions: [], remainingNeeds: [], replans: 0, steps: 0, identities: {} };
    const entry: Entry = { record, lease, running: false, saveTail: Promise.resolve() };
    this.#entries.set(context.id, entry);
    if (context.kind === 'foreground') this.#foreground = context.id;
    try { await this.#save(entry); } catch (error) { lease.cancel('task_storage_unavailable'); throw error; }
    return context.id;
  }
  snapshot(id: string): TaskRecord { return structuredClone(this.#entry(id).record); }
  result(id: string): TaskResult | undefined { return structuredClone(this.#entry(id).record.result); }
  lease(id: string): TaskLease { return this.#entry(id).lease; }
  async persistBudget(id: string): Promise<void> {
    // A child request also spends every ancestor's budget; recovery must retain all charges.
    for (let entry: Entry | undefined = this.#entry(id); entry;) {
      await this.#save(entry);
      const parentId: string | undefined = entry.lease.context.parentId;
      entry = parentId ? this.#entry(parentId) : undefined;
    }
  }
  /** Bind an actual Keeper public tool call after a structured domain handoff. */
  async beginIncumbent(id: string, verb: string, args: Record<string, Json>): Promise<{proposal: OperationProposal; task: TaskLease; journal: OperationJournal}> {
    const entry = this.#entry(id), record = entry.record;
    if (entry.running || record.pending || record.status !== 'ready' || !['composing', 'auditing'].includes(record.phase)
      || !record.result?.handoff?.verbs.includes(verb as 'resolve' | 'apply')) throw new ContractError('incumbent_handoff_unavailable');
    await this.#validate(entry);
    record.phase = 'composing';
    const proposal: OperationProposal = {id: randomUUID(), taskId: id, operation: verb, capability: verb,
      args: structuredClone(args), scope: entry.lease.context.scope, readSet: entry.lease.context.readSet, basis: []};
    record.pending = {key: `incumbent-${record.observations.length}`, proposal};
    await this.#save(entry);
    return {proposal: structuredClone(proposal), task: entry.lease, journal: this.#journal(entry)};
  }
  async completeIncumbent(id: string, packet: ObservationPacket): Promise<void> {
    const entry = this.#entry(id), record = entry.record, pending = record.pending;
    if (!pending || pending.proposal.id !== packet.operationId || !record.result?.handoff) throw new ContractError('incumbent_result_mismatch');
    if (packet.diagnostics?.some(value => value.code === 'settlement_unknown')) {
      delete record.result.handoff;
      await this.#finish(entry, 'pending', ['Reconcile the original incumbent operation settlement.']);
      return;
    }
    record.observations.push({...pending, packet: structuredClone(packet)}); delete record.pending;
    record.result.receipts = [...new Set([...record.result.receipts, ...packet.receipts])];
    if (['cancelled', 'stale'].includes(packet.status)) {
      delete record.result.handoff;
      await this.#finish(entry, packet.status as 'cancelled' | 'stale', []);
    } else await this.#save(entry);
  }
  async observeDirectRead(id: string, proposal: OperationProposal, packet: ObservationPacket): Promise<void> {
    const entry = this.#entry(id);
    if (entry.record.status === 'closed' || entry.lease.signal.aborted) return;
    if (proposal.taskId !== id || packet.operationId !== proposal.id || !['look', 'recall', 'lookup'].includes(proposal.operation))
      throw new ContractError('invalid_direct_read');
    entry.record.observations.push({key: `direct-read-${entry.record.observations.length + 1}`, proposal: structuredClone(proposal), packet: structuredClone(packet)});
    await this.#save(entry);
  }
  async submit(id: string, submission: unknown): Promise<TaskResult> {
    const entry = this.#entry(id);
    if (entry.running || entry.record.phase !== 'planning' || entry.record.status === 'closed') throw new ContractError('task_not_planning');
    entry.lease.assertActive();
    const domain = this.#domain(entry);
    const plan = validatePlanSubmission(submission, entry.lease.context.capabilities.filter(value => domain.capabilities.includes(value)));
    if (entry.record.replans && isDeepStrictEqual(plan, entry.record.plan))
      return this.#finish(entry, 'unresolved', ['The revised plan contains no new evidence requirement or corrected approach.']);
    entry.record.plan = plan;
    entry.record.phase = 'deciding'; entry.record.status = 'active'; delete entry.record.result;
    await this.#save(entry);
    return this.#run(entry);
  }
  async directDraft(id: string): Promise<TaskResult> {
    const entry = this.#entry(id);
    if (entry.running || entry.record.phase !== 'planning' || entry.lease.context.kind !== 'foreground') throw new ContractError('task_not_planning');
    await this.#validate(entry);
    return this.#finish(entry, 'complete', []);
  }
  async markDelivery(id: string, phase: 'auditing' | 'committing' | 'delivering'): Promise<void> {
    const entry = this.#entry(id);
    if (entry.record.status !== 'ready' || entry.lease.context.kind !== 'foreground' || !READY_PHASES.includes(entry.record.phase))
      throw new ContractError('task_not_deliverable');
    const from = entry.record.phase;
    if (!(phase === 'auditing' && ['composing', 'auditing', 'committing'].includes(from)
      || phase === 'committing' && ['auditing', 'committing'].includes(from))) throw new ContractError('invalid_delivery_transition');
    await this.#validate(entry);
    entry.record.phase = phase; await this.#save(entry);
  }
  async finishDelivery(id: string, evidence: { campaign: string; turn: number } & (
    { kind: 'narrate'; commit: string } | { kind: 'ask'; pendingChoice: string })): Promise<void> {
    const entry = this.#entry(id);
    if (entry.record.status === 'closed') return;
    if (entry.record.status !== 'ready' || entry.lease.context.kind !== 'foreground' || entry.record.phase !== 'committing'
      || !evidence || evidence.campaign !== entry.record.intent.scope.campaign || evidence.turn !== entry.record.intent.turn
      || (evidence.kind === 'narrate' ? !evidence.commit : evidence.kind === 'ask' ? !evidence.pendingChoice : true))
      throw new ContractError('task_not_deliverable');
    // The caller observes the canonical accepted delivery, not merely generated prose.
    entry.record.phase = 'delivering'; const deliverySave = this.#save(entry);
    entry.record.phase = 'terminal'; entry.record.status = 'closed'; entry.record.reason = 'delivered';
    const terminalSave = this.#save(entry);
    await deliverySave; await terminalSave; entry.lease.close();
  }
  async cancelForeground(reason = 'task_cancelled'): Promise<void> {
    const entry = this.#foreground ? this.#entries.get(this.#foreground) : undefined;
    this.#foreground = undefined;
    if (entry && entry.record.status !== 'closed') await this.#cancel(entry, reason);
  }
  async shutdown(): Promise<void> {
    this.#closed = true;
    const entries = [...this.#entries.values()].filter(entry => entry.record.status !== 'closed');
    // Abort synchronously before any storage wait. Independent memory backlog is retained.
    for (const entry of entries) { entry.fenced = true; entry.lease.cancel('session_shutdown'); }
    await Promise.all(entries.map(entry => this.#cancel(entry, 'session_shutdown')));
  }
  async resume(id: string, options: { authorize(record: TaskRecord): boolean; currentReadSet: ReadSet; signal?: AbortSignal }): Promise<TaskResult> {
    if (this.#closed || this.#entries.get(id)?.running) throw new ContractError('task_runtime_unavailable');
    const saved = await this.#options.store.load(id);
    assertTaskRecord(saved);
    if (!saved || saved.version !== 1 || saved.checkpoint?.context?.id !== id || saved.status === 'closed'
      || !Array.isArray(saved.observations) || !Array.isArray(saved.decisions) || !Number.isSafeInteger(saved.steps)
      || saved.steps < 0 || !Number.isSafeInteger(saved.replans) || saved.replans < 0 || !saved.identities
      || typeof options.authorize !== 'function' || options.authorize(structuredClone(saved)) !== true)
      throw new ContractError('task_resume_not_authorized');
    const domain = this.#domains.get(saved.domain.id);
    if (!domain || domain.version !== saved.domain.version) throw new ContractError('task_domain_changed');
    const parent = saved.checkpoint.context.parentId ? this.#entry(saved.checkpoint.context.parentId) : undefined;
    const lease = TaskLease.resume(saved.checkpoint, { currentReadSet: options.currentReadSet, clock: this.#options.clock,
      signal: options.signal, parent: parent?.lease, authorizeResume: () => true });
    const entry: Entry = { record: structuredClone(saved), lease, running: false, saveTail: Promise.resolve() };
    try { await this.#validate(entry); } catch (error) { lease.close(); throw error; }
    if (lease.context.kind === 'foreground' && this.#foreground !== id) await this.cancelForeground('task_resumed');
    this.#entries.get(id)?.lease.close();
    this.#entries.set(id, entry);
    if (lease.context.kind === 'foreground') this.#foreground = id;
    if (saved.status === 'ready' && saved.result) return structuredClone(saved.result);
    entry.record.status = 'active'; entry.record.phase = saved.plan ? 'deciding' : 'planning';
    if (!saved.plan) return this.#finish(entry, 'unresolved', ['The original task has no accepted plan.']);
    return this.#run(entry);
  }
  async reconcileCancelled(id: string, options: { authorize(record: TaskRecord): boolean }): Promise<TaskResult> {
    const saved = await this.#options.store.load(id);
    assertTaskRecord(saved);
    if (saved.status !== 'closed' || saved.result?.status !== 'cancelled' || !saved.pending
      || typeof options.authorize !== 'function' || !options.authorize(structuredClone(saved))) throw new ContractError('task_reconciliation_not_authorized');
    const identity = saved.identities[saved.pending.proposal.id];
    if (!identity?.request || !this.#options.operations.reconcile) throw new ContractError('task_reconciliation_unavailable');
    const recovered = await this.#options.operations.reconcile(structuredClone(saved.pending.proposal), structuredClone(identity), structuredClone(saved.checkpoint.context));
    if (recovered.status === 'settled') {
      if (recovered.packet.operationId !== saved.pending.proposal.id || recovered.packet.status !== 'succeeded') throw new ContractError('operation_result_mismatch');
      saved.observations.push({ ...saved.pending, packet: structuredClone(recovered.packet) });
      saved.result.receipts = [...new Set([...saved.result.receipts, ...recovered.packet.receipts])];
      saved.result.refs.push(...recovered.packet.refs);
      saved.checkpoint.settledReceipts = [...saved.result.receipts];
    } else if (recovered.status === 'absent') {
      saved.observations.push({ ...saved.pending, packet: { operationId: saved.pending.proposal.id, status: 'cancelled',
        result: { code: 'reconciled_absent' }, refs: [], receipts: [], readSet: saved.pending.proposal.readSet,
        coverage: { used: [], omitted: [], unknown: [] } } });
    } else throw new ContractError('operation_recovery_invalid');
    delete saved.pending; saved.revision++;
    saved.remainingNeeds = []; saved.result.remainingNeeds = []; saved.result.coverage.unknown = [];
    await this.#options.store.save(saved);
    const retained = this.#entries.get(id);
    if (retained && !retained.running) retained.record = structuredClone(saved);
    return structuredClone(saved.result);
  }
  #entry(id: string): Entry {
    const entry = this.#entries.get(id);
    if (!entry) throw new ContractError('unknown_task');
    return entry;
  }
  #domain(entry: Entry): TaskDomain {
    const domain = this.#domains.get(entry.record.domain.id);
    if (!domain || domain.version !== entry.record.domain.version) throw new ContractError('task_domain_changed');
    return domain;
  }
  async #validate(entry: Entry): Promise<void> {
    entry.lease.assertActive();
    if (entry.record.status === 'closed') throw new ContractError('task_revoked');
    const current = await this.#options.operations.validate(entry.lease.context, structuredClone(entry.record.intent));
    entry.lease.assertActive();
    if (entry.lease.revalidate(current).status !== 'current') throw new ContractError('task_read_set_stale');
  }
  #view(entry: Entry): TaskView {
    return structuredClone({ intent: entry.record.intent, plan: entry.record.plan!, context: entry.lease.context,
      observations: entry.record.observations, decisions: entry.record.decisions,
      remainingNeeds: entry.record.remainingNeeds, replans: entry.record.replans });
  }
  async #save(entry: Entry, unknownDecisionUsage = false): Promise<void> {
    const record = entry.record;
    // A terminal cancellation still preserves the most recent budget and actual receipts.
    const receipts = [...new Set([...record.checkpoint.settledReceipts, ...record.observations.flatMap(value => value.packet.receipts)])];
    const remainingGoal = record.remainingNeeds.join('\n') || record.plan?.goal || entry.lease.context.goal;
    record.checkpoint = entry.lease.signal.aborted
      ? entry.lease.snapshotCheckpoint(record.phase, receipts, remainingGoal)
      : entry.lease.checkpoint(record.phase, receipts, remainingGoal);
    const snapshot = structuredClone(record); snapshot.revision = ++record.revision;
    if (unknownDecisionUsage) {
      snapshot.checkpoint.context.budget.remainingInputTokens = 0;
      snapshot.checkpoint.context.budget.remainingOutputTokens = 0;
      snapshot.checkpoint.context.budget.remainingCostUsd = 0;
    }
    const write = entry.saveTail.then(() => this.#options.store.save(snapshot));
    entry.saveTail = write;
    try { await write; } catch (error) { entry.lease.cancel('task_storage_unavailable'); throw error; }
  }
  #journal(entry: Entry): OperationJournal {
    return {
      load: async id => structuredClone(entry.record.identities[id]),
      save: async identity => {
        if (identity.taskId !== entry.lease.context.id) throw new ContractError('operation_task_mismatch');
        entry.record.identities[identity.operationId] = structuredClone(identity);
        await this.#save(entry);
      },
    };
  }
  async #finish(entry: Entry, status: TaskResult['status'], needs: string[], coverage?: TaskResult['coverage'], handoff?: TaskResult['handoff']): Promise<TaskResult> {
    const record = entry.record;
    // Queue/kernel shutdown may abort its signal before this adapter receives session_shutdown.
    // An immutable committed source remains pending for owner-authorized rebase in either order.
    if (status === 'cancelled' && entry.lease.context.kind === 'committed_memory') {
      status = 'pending';
      if (!needs.length) needs = ['Resume committed memory work from its original source.'];
    }
    const gathered = (kind: keyof TaskResult['coverage']) => [...new Set(record.observations.flatMap(value => value.packet.coverage[kind]))];
    const result: TaskResult = { taskId: entry.lease.context.id, status, scope: entry.lease.context.scope,
      refs: record.observations.flatMap(value => value.packet.refs), receipts: [...new Set(record.observations.flatMap(value => value.packet.receipts))],
      coverage: coverage ?? { used: gathered('used'), omitted: gathered('omitted'), unknown: [...new Set([...gathered('unknown'), ...needs])] }, remainingNeeds: [...needs], ...(handoff ? {handoff} : {}) };
    record.result = result; record.remainingNeeds = [...needs];
    if (status === 'pending') { record.phase = 'waiting'; record.status = 'waiting'; }
    else if (status === 'cancelled' || status === 'stale' || entry.lease.context.kind !== 'foreground' || this.#domain(entry).completion === 'artifact') { record.phase = 'terminal'; record.status = 'closed'; }
    else { record.phase = 'composing'; record.status = 'ready'; }
    await this.#save(entry);
    if (record.status === 'closed') entry.lease.close();
    return structuredClone(result);
  }
  async #cancel(entry: Entry, reason: string): Promise<void> {
    entry.lease.cancel(reason); entry.record.reason = reason;
    if (entry.lease.context.kind === 'committed_memory' && reason === 'session_shutdown') {
      // Rebase and authorize this independently owned job on restart; no old foreground consent.
      await this.#finish(entry, 'pending', entry.record.remainingNeeds.length ? entry.record.remainingNeeds : ['Resume committed memory work.']);
    } else await this.#finish(entry, 'cancelled', []);
  }
  async #run(entry: Entry): Promise<TaskResult> {
    if (entry.running) throw new ContractError('task_already_running');
    entry.running = true;
    try {
      while (entry.record.steps < (this.#options.maxSteps ?? 32)) {
        await this.#validate(entry);
        const record = entry.record;
        const step: TaskStep = record.pending
          ? { kind: 'operation', key: record.pending.key, ...record.pending.proposal }
          : this.#domain(entry).next(this.#view(entry));
        if (step.kind === 'finish') return this.#finish(entry, step.status, step.remainingNeeds, step.coverage);
        if (step.kind === 'wait') return this.#finish(entry, 'pending', step.remainingNeeds);
        if (step.kind === 'handoff') {
          if (entry.lease.context.kind !== 'foreground' || record.pending || !step.verbs.length || step.verbs.length > 2
            || new Set(step.verbs).size !== step.verbs.length
            || step.verbs.some(verb => !['resolve', 'apply'].includes(verb) || !record.plan!.capabilities.includes(verb))
            || record.observations.some(row => ['resolve', 'apply'].includes(row.proposal.operation)))
            return this.#finish(entry, 'partial', ['The existing action owner cannot take over after a typed mutation attempt.']);
          return this.#finish(entry, 'unresolved', step.remainingNeeds, undefined, {verbs: [...step.verbs]});
        }
        if (step.kind === 'replan') {
          if (record.replans >= 2) return this.#finish(entry, 'unresolved', step.remainingNeeds);
          record.replans++; record.phase = 'planning'; record.remainingNeeds = [...step.remainingNeeds];
          await this.#save(entry);
          return { taskId: entry.lease.context.id, status: 'partial', scope: entry.lease.context.scope,
            refs: record.observations.flatMap(value => value.packet.refs), receipts: record.checkpoint.settledReceipts,
            coverage: { used: [], omitted: [], unknown: step.remainingNeeds }, remainingNeeds: step.remainingNeeds };
        }
        if (step.kind === 'decisions') {
          if (!step.batches.length || step.batches.length > 16 || record.steps + step.batches.length > (this.#options.maxSteps ?? 32))
            return this.#finish(entry, 'partial', ['The independent decision group exceeds the remaining step allowance.']);
          const keys = step.batches.map(item => item.key);
          if (new Set(keys).size !== keys.length || keys.some(key => !key || record.decisions.some(item => item.key === key)))
            throw new ContractError('duplicate_decision_step');
          // Every request is frozen before dispatch; none can consume another request's answer.
          const batches = step.batches.map(item => ({ key: item.key, batch: { ...structuredClone(item.batch), id: randomUUID(),
            scope: entry.lease.context.scope, readSet: entry.lease.context.readSet } }));
          for (const item of batches) durableDecisionInput(item.batch);
          record.steps += batches.length;
          for (const _ of batches) entry.lease.nextStep();
          await this.#save(entry, true); await this.#validate(entry);
          const settled = await Promise.allSettled(batches.map(item => this.#options.decision.decide(item.batch, entry.lease)));
          if (entry.lease.signal.aborted) return entry.record.result ? structuredClone(entry.record.result) : this.#finish(entry, 'cancelled', []);
          const results = batches.map((item, index) => {
            const outcome = settled[index];
            const result: DecisionResult = outcome.status === 'fulfilled' ? outcome.value : { batchId: item.batch.id,
              status: 'unavailable', answers: {}, issues: [], failure: { code: 'service_error', retryable: false },
              coverage: { required: item.batch.questions.map(question => question.key), answered: [], unknown: item.batch.questions.map(question => question.key) } };
            return { ...item, result };
          });
          if (entry.fenced) return structuredClone(entry.record.result!);
          assertTaskRecord({...record, decisions: [...record.decisions, ...results]});
          record.decisions.push(...results); await this.#save(entry);
          continue;
        }
        if (!step.key || (step.kind === 'operation' ? record.observations : record.decisions).some(row => row.key === step.key))
          return this.#finish(entry, 'unresolved', ['The domain repeated a completed step without new evidence.']);
        record.steps++;
        if (step.kind === 'decision') {
          entry.lease.nextStep();
          const batch: DecisionBatch = { ...structuredClone(step.batch), id: randomUUID(), scope: entry.lease.context.scope, readSet: entry.lease.context.readSet };
          durableDecisionInput(batch);
          await this.#save(entry, true);
          await this.#validate(entry);
          const result = await this.#options.decision.decide(batch, entry.lease);
          if (entry.lease.signal.aborted) return entry.record.result ? structuredClone(entry.record.result) : this.#finish(entry, 'cancelled', []);
          if (entry.fenced) return structuredClone(entry.record.result!);
          assertTaskRecord({...record, decisions: [...record.decisions, {key: step.key, batch, result}]});
          record.decisions.push({ key: step.key, batch, result });
          await this.#save(entry);
          // Domain policy maps missing/adverse answers; transport success never means goal success.
          continue;
        }
        if (!entry.lease.context.capabilities.includes(step.capability) || !record.plan!.capabilities.includes(step.capability) || ['narrate', 'ask'].includes(step.operation)
          || entry.lease.context.kind === 'committed_memory' && !backgroundOperation(entry.lease.context, record.domain.id, step))
          throw new ContractError('task_operation_out_of_scope');
        if (record.replans && ['resolve', 'apply'].includes(step.operation) && record.observations.some(row =>
          row.proposal.operation === step.operation && row.packet.status === 'refused' && isDeepStrictEqual(row.proposal.args, step.args)))
          return this.#finish(entry, 'unresolved', ['The revised plan repeated the same refused effect arguments without correcting them.']);
        if (!record.pending) record.pending = { key: step.key, proposal: { id: randomUUID(), taskId: entry.lease.context.id,
          operation: step.operation, args: structuredClone(step.args), capability: step.capability, basis: structuredClone(step.basis),
          ...(step.bindings ? {bindings:structuredClone(step.bindings)} : {}),
          scope: entry.lease.context.scope, readSet: entry.lease.context.readSet } };
        await this.#save(entry);
        await this.#validate(entry);
        const proposal = structuredClone(record.pending.proposal);
        const packet = await this.#options.operations.dispatch(proposal, entry.lease, this.#journal(entry));
        if (entry.fenced) return structuredClone(entry.record.result!);
        if (packet.operationId !== proposal.id) throw new ContractError('operation_result_mismatch');
        if (packet.diagnostics?.some(value => value.code === 'settlement_unknown')) {
          // Retain the exact proposal and prepared request for reconciliation, never mint another ID.
          return this.#finish(entry, entry.lease.signal.aborted ? 'cancelled' : 'pending', ['Reconcile the original operation settlement.']);
        }
        record.observations.push({ key: step.key, proposal, packet: structuredClone(packet) }); delete record.pending;
        await this.#save(entry);
        if (entry.lease.signal.aborted) return this.#finish(entry,
          record.reason === 'session_shutdown' && entry.lease.context.kind === 'committed_memory' ? 'pending' : 'cancelled', record.remainingNeeds);
      }
      return this.#finish(entry, 'unresolved', ['The task reached its bounded step limit.']);
    } catch (error) {
      if (entry.fenced) return structuredClone(entry.record.result!);
      const code = error instanceof ContractError ? error.code : 'task_failed';
      if (entry.lease.signal.aborted) {
        if (entry.record.status === 'waiting' && entry.record.reason === 'session_shutdown') return structuredClone(entry.record.result!);
        return this.#finish(entry, 'cancelled', []);
      }
      return this.#finish(entry, code.endsWith('_stale') ? 'stale' : 'failed', [code]);
    } finally { entry.running = false; }
  }
}
