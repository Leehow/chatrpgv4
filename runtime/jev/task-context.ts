/** Scoped task lifetime and hierarchical budget reservations. No operation or storage authority. */
import { randomUUID } from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import { ContractError, isPlainRecord, type TaskContext, type TaskBudget, type ReadSet } from './contracts.ts';
import { advanceReadSet, compareReadSet, advanceSourceReadSet, assertSourcePublicationAdvance, type SourcePublicationExpectation, type SourcePublicationAdvance, type ReceiptAdvance } from './read-set.ts';
import { assertSourceRef } from './source-ref.ts';

export interface TaskClock { now(): number; schedule(callback: () => void, delayMs: number): () => void }
const realClock: TaskClock = { now: Date.now, schedule(callback, delay) {
  const timer = setTimeout(callback, delay); timer.unref(); return () => clearTimeout(timer);
} };
export interface BudgetSpend { inputTokens: number; outputTokens: number; costUsd: number; actions: number }
const BUDGET_FIELDS = { inputTokens: 'remainingInputTokens', outputTokens: 'remainingOutputTokens', costUsd: 'remainingCostUsd', actions: 'remainingActions' } as const;
const SPEND_KEYS = Object.keys(BUDGET_FIELDS) as Array<keyof BudgetSpend>;
const ZERO: BudgetSpend = { inputTokens: 0, outputTokens: 0, costUsd: 0, actions: 0 };
export interface TaskLeaseOptions {
  owner: string;
  goal: string;
  scope: TaskContext['scope'];
  capabilities: string[];
  budget: TaskBudget;
  readSet: ReadSet;
  kind?: 'foreground' | 'committed_memory';
  origin?: TaskContext['origin'];
  clock?: TaskClock;
  signal?: AbortSignal;
}
export interface TaskCheckpoint {
  version: 1;
  context: TaskContext;
  phase: string;
  settledReceipts: string[];
  remainingGoal: string;
  sourceAdvances?:SourcePublicationAdvance[];
}

function validSpend(spend: BudgetSpend): void {
  if (!isPlainRecord(spend) || Object.keys(spend).some(key => !SPEND_KEYS.includes(key as keyof BudgetSpend))) throw new ContractError('invalid_budget_spend');
  for (const key of SPEND_KEYS) if (!Number.isFinite(spend[key]) || spend[key] < 0 || key !== 'costUsd' && !Number.isSafeInteger(spend[key]))
    throw new ContractError('invalid_budget_spend');
}
function validBudget(budget: TaskBudget): void {
  if (!isPlainRecord(budget) || Object.keys(budget).some(key => !['deadlineAt', ...Object.values(BUDGET_FIELDS)].includes(key))
    || !Number.isFinite(budget.deadlineAt)) throw new ContractError('invalid_task_deadline');
  validSpend(Object.fromEntries(SPEND_KEYS.map(key => [key, budget[BUDGET_FIELDS[key]]])) as unknown as BudgetSpend);
}
function sameScope(left: TaskContext['scope'], right: TaskContext['scope']): boolean {
  return left.owner === right.owner && left.campaign === right.campaign && left.worldline === right.worldline
    && left.loop === right.loop && left.audience === right.audience;
}
function validScope(scope: TaskContext['scope']): boolean {
  return isPlainRecord(scope) && Object.keys(scope).every(key => ['owner', 'campaign', 'worldline', 'loop', 'audience'].includes(key))
    && typeof scope.owner === 'string' && !!scope.owner && ['keeper', 'player', 'system'].includes(scope.audience)
    && [scope.campaign, scope.worldline].every(value => value === undefined || typeof value === 'string' && !!value)
    && (scope.loop === undefined || Number.isSafeInteger(scope.loop) && scope.loop >= 0);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && Object.keys(value).length === value.length
    && value.every(item => typeof item === 'string' && item.length > 0);
}

export class TaskLease {
  readonly #controller = new AbortController();
  readonly #clock: TaskClock;
  readonly #parent?: TaskLease;
  readonly #context: TaskContext;
  #clearDeadline = () => {};
  readonly #detach: Array<() => void> = [];
  #step = 0;
  readonly #rootSequence: { value: number };
  #receiptAdvances = new Set<string>();
  #sourceAdvances = new Map<string,SourcePublicationAdvance>();
  #held: BudgetSpend = {...ZERO};
  readonly #budgetChanges: {waiters: Set<() => void>};

  constructor(options: TaskLeaseOptions, parent?: TaskLease) {
    if (!isPlainRecord(options) || Object.keys(options).some(key => !['owner', 'goal', 'scope', 'capabilities', 'budget', 'readSet', 'kind', 'origin', 'clock', 'signal'].includes(key)))
      throw new ContractError('invalid_task_context');
    validBudget(options.budget);
    compareReadSet(options.readSet, options.readSet);
    if (typeof options.owner !== 'string' || !options.owner || typeof options.goal !== 'string' || !options.goal || !validScope(options.scope)
      || !Array.isArray(options.capabilities) || Object.keys(options.capabilities).length !== options.capabilities.length
      || options.capabilities.some(capability => typeof capability !== 'string' || !capability)
      || new Set(options.capabilities).size !== options.capabilities.length)
      throw new ContractError('invalid_task_context');
    this.#parent = parent;
    this.#budgetChanges = parent ? parent.#budgetChanges : {waiters: new Set()};
    this.#rootSequence = parent ? parent.#rootSequence : { value: 0 };
    this.#clock = (parent ? parent.#clock : undefined) ?? options.clock ?? realClock;
    if (parent) {
      parent.assertActive();
      if (options.kind === 'committed_memory') throw new ContractError('memory_job_requires_separate_root');
      if (!sameScope(options.scope, parent.#context.scope)) throw new ContractError('child_scope_escalation');
      if (options.capabilities.some(capability => !parent.#context.capabilities.includes(capability))) throw new ContractError('child_capability_escalation');
    }
    if (options.kind === 'committed_memory' && !options.origin) throw new ContractError('memory_job_origin_required');
    if (options.origin) {
      if (!isPlainRecord(options.origin) || Object.keys(options.origin).some(key => !['turn', 'sourceRefs'].includes(key))
        || !Number.isSafeInteger(options.origin.turn) || options.origin.turn < 0 || !Array.isArray(options.origin.sourceRefs)
        || !options.origin.sourceRefs.length || Object.keys(options.origin.sourceRefs).length !== options.origin.sourceRefs.length)
        throw new ContractError('memory_job_origin_required');
      for (const ref of options.origin.sourceRefs) {
        assertSourceRef(ref);
        if (!sameScope(ref.scope, options.scope)) throw new ContractError('memory_job_origin_scope_mismatch');
      }
    }
    const budget = structuredClone(options.budget);
    if (parent) {
      budget.deadlineAt = Math.min(budget.deadlineAt, parent.#context.budget.deadlineAt);
      for (const field of Object.values(BUDGET_FIELDS)) budget[field] = Math.min(budget[field], parent.#context.budget[field]);
    }
    const id = randomUUID();
    this.#context = { id, rootId: parent ? parent.#context.rootId : id, ...(parent ? { parentId: parent.#context.id } : {}),
      owner: options.owner, goal: options.goal, scope: structuredClone(options.scope), capabilities: [...options.capabilities],
      readSet: structuredClone(options.readSet), budget, kind: parent ? 'child' : options.kind ?? 'foreground', checkpointRefs: [], step: 0, rootStep: this.#rootSequence.value,
      ...(options.origin ? { origin: structuredClone(options.origin) } : {}) };
    for (const signal of [parent?.signal, options.signal]) if (signal) {
      const cancel = () => this.cancel(signal.reason instanceof ContractError ? signal.reason.code : 'parent_cancelled');
      if (signal.aborted) cancel();
      else { signal.addEventListener('abort', cancel, { once: true }); this.#detach.push(() => signal.removeEventListener('abort', cancel)); }
    }
    if (!this.signal.aborted) {
      if (this.#clock.now() >= budget.deadlineAt) this.cancel('task_deadline');
      else {
        const tick = () => {
          if (this.#clock.now() >= budget.deadlineAt) this.cancel('task_deadline');
          else this.#clearDeadline = this.#clock.schedule(tick, Math.min(2_147_483_647, budget.deadlineAt - this.#clock.now()));
        };
        tick();
      }
    }
  }

  get signal(): AbortSignal { return this.#controller.signal; }
  get context(): TaskContext { return structuredClone({ ...this.#context, step: this.#step, rootStep: this.#rootSequence.value }); }
  /** Rebind only after the owning runtime validates the latest intent and scope; not replay consent. */
  static resume(checkpoint: TaskCheckpoint, options: {
    currentReadSet: ReadSet; clock?: TaskClock; signal?: AbortSignal; parent?: TaskLease;
    /** The owning runtime checks durable revocation/current intent; the checkpoint is not a permit. */
    authorizeResume(checkpoint: TaskCheckpoint): boolean;
  }): TaskLease {
    const context = checkpoint?.context;
    if (!isPlainRecord(checkpoint) || Object.keys(checkpoint).some(key => !['version', 'context', 'phase', 'settledReceipts', 'remainingGoal', 'sourceAdvances'].includes(key))
      || checkpoint.version !== 1 || typeof checkpoint.phase !== 'string' || !checkpoint.phase
      || typeof checkpoint.remainingGoal !== 'string' || !isPlainRecord(context)
      || Object.keys(context).some(key => !['id', 'parentId', 'rootId', 'owner', 'kind', 'goal', 'scope', 'capabilities', 'readSet', 'budget', 'checkpointRefs', 'step', 'rootStep', 'origin'].includes(key))
      || !strings(context.checkpointRefs) || typeof context.id !== 'string' || !context.id
      || typeof context.rootId !== 'string' || !context.rootId || !Number.isSafeInteger(context.step) || context.step < 0
      || !Number.isSafeInteger(context.rootStep) || context.rootStep < context.step
      || !['foreground', 'child', 'committed_memory'].includes(context.kind)
      || !strings(checkpoint.settledReceipts))
      throw new ContractError('invalid_task_checkpoint');
    if (context.kind === 'child' && (!options.parent || context.parentId !== options.parent.#context.id || context.rootId !== options.parent.#context.rootId)
      || context.kind !== 'child' && (options.parent || context.parentId || context.rootId !== context.id))
      throw new ContractError('checkpoint_parent_mismatch');
    if (compareReadSet(context.readSet, options.currentReadSet).status !== 'current') throw new ContractError('stale_task_checkpoint');
    if (typeof options.authorizeResume !== 'function' || options.authorizeResume(structuredClone(checkpoint)) !== true)
      throw new ContractError('checkpoint_resume_not_authorized');
    const lease = new TaskLease({ owner: context.owner, goal: context.goal, scope: context.scope, capabilities: context.capabilities,
      budget: context.budget, readSet: context.readSet, origin: context.origin,
      kind: context.kind === 'committed_memory' ? 'committed_memory' : 'foreground', clock: options.clock, signal: options.signal }, options.parent);
    lease.#context.id = context.id;
    lease.#context.rootId = context.rootId;
    lease.#context.checkpointRefs = [...context.checkpointRefs];
    lease.#step = context.step;
    lease.#rootSequence.value = Math.max(lease.#rootSequence.value, context.rootStep);
    lease.#receiptAdvances = new Set(checkpoint.settledReceipts);
    if(checkpoint.sourceAdvances!==undefined) {
      if(!Array.isArray(checkpoint.sourceAdvances)) throw new ContractError('invalid_task_checkpoint');
      for(const advance of checkpoint.sourceAdvances) {assertSourcePublicationAdvance(advance);if(advance.rootId!==context.rootId||!sameScope(advance.scope,context.scope)||lease.#sourceAdvances.has(advance.publicationId))throw new ContractError('invalid_task_checkpoint');lease.#sourceAdvances.set(advance.publicationId,structuredClone(advance));}
    }
    lease.assertActive();
    return lease;
  }
  assertActive(): void {
    if (this.#clock.now() >= this.#context.budget.deadlineAt) this.cancel('task_deadline');
    this.signal.throwIfAborted();
  }
  cancel(reason = 'task_cancelled'): void {
    if (this.signal.aborted) return;
    this.#clearDeadline();
    for (const detach of this.#detach.splice(0)) detach();
    this.#controller.abort(new ContractError(reason));
  }
  close(): void { this.cancel('task_closed'); }
  child(options: Pick<TaskLeaseOptions, 'owner' | 'goal' | 'budget' | 'capabilities'>): TaskLease {
    return new TaskLease({ ...options, scope: this.#context.scope, readSet: this.#context.readSet }, this);
  }

  reserve(spend: BudgetSpend, options: {waitable?: boolean} = {}): { settle(actual?: Partial<BudgetSpend>): void; release(): void } {
    validSpend(spend);
    const reserved = structuredClone(spend), chain: TaskLease[] = [];
    for (let task: TaskLease | undefined = this; task; task = task.#parent) chain.push(task);
    for (const task of chain) {
      task.assertActive();
      if (SPEND_KEYS.some(key => reserved[key] > task.#context.budget[BUDGET_FIELDS[key]])) throw new ContractError('task_budget_exhausted');
    }
    for (const task of chain) for (const key of SPEND_KEYS) {
      task.#context.budget[BUDGET_FIELDS[key]] -= reserved[key];
      if (options.waitable !== false) task.#held[key] += reserved[key];
    }
    let settled = false;
    const settle = (actual: Partial<BudgetSpend> = {}) => {
      if (settled) throw new ContractError('reservation_already_settled');
      if (!isPlainRecord(actual)) throw new ContractError('invalid_budget_spend');
      const used = { ...reserved, ...actual };
      validSpend(used);
      settled = true;
      const overrun = SPEND_KEYS.some(key => used[key] > reserved[key]);
      for (const task of chain) for (const key of SPEND_KEYS) {
        task.#context.budget[BUDGET_FIELDS[key]] += reserved[key] - used[key];
        if (options.waitable !== false) task.#held[key] -= reserved[key];
      }
      for (const wake of [...this.#budgetChanges.waiters]) wake();
      // Negative remaining budget is honest debt after an actual provider overrun, never permission.
      if (overrun) { chain.at(-1)!.cancel('task_budget_overrun'); throw new ContractError('task_budget_overrun'); }
    };
    return { settle, release: () => settle(ZERO) };
  }

  /** Wait for existing reservations to settle; never borrow beyond any ancestor's ceiling. */
  async reserveQueued(spend: BudgetSpend, signal?: AbortSignal): Promise<ReturnType<TaskLease['reserve']>> {
    validSpend(spend);
    const requested = structuredClone(spend);
    const cancellation = signal ? AbortSignal.any([this.signal, signal]) : this.signal;
    for (;;) {
      cancellation.throwIfAborted();
      this.assertActive();
      try { return this.reserve(requested); }
      catch (error) {
        if (!(error instanceof ContractError) || error.code !== 'task_budget_exhausted') throw error;
        for (let task: TaskLease | undefined = this; task; task = task.#parent) {
          if (SPEND_KEYS.some(key => requested[key] > task.#context.budget[BUDGET_FIELDS[key]] + task.#held[key])) throw error;
        }
      }
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { this.#budgetChanges.waiters.delete(wake); cancellation.removeEventListener('abort', abort); };
        const wake = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(cancellation.reason ?? new ContractError('task_cancelled')); };
        this.#budgetChanges.waiters.add(wake);
        cancellation.addEventListener('abort', abort, {once: true});
        if (cancellation.aborted) abort();
      });
    }
  }

  nextStep(): { rootId: string; taskId: string; step: number; rootStep: number } {
    this.assertActive();
    if (this.#step >= Number.MAX_SAFE_INTEGER || this.#rootSequence.value >= Number.MAX_SAFE_INTEGER) throw new ContractError('task_sequence_exhausted');
    this.#step++; this.#rootSequence.value++;
    return { rootId: this.#context.rootId, taskId: this.#context.id, step: this.#step, rootStep: this.#rootSequence.value };
  }
  revalidate(current: ReadSet): ReturnType<typeof compareReadSet> {
    this.assertActive(); return compareReadSet(this.#context.readSet, current);
  }
  advance(receipt: ReceiptAdvance): void {
    const updates: Array<{ task: TaskLease; readSet: ReadSet }> = [];
    for (let task: TaskLease | undefined = this; task; task = task.#parent) {
      task.assertActive();
      if (task.#receiptAdvances.has(receipt.receiptId)) throw new ContractError('receipt_advance_replayed');
      updates.push({ task, readSet: advanceReadSet(task.#context.readSet, receipt) });
    }
    // Advance only the performing branch and ancestors. Sibling observations must revalidate.
    for (const { task, readSet } of updates) { task.#context.readSet = readSet; task.#receiptAdvances.add(receipt.receiptId); }
  }
  /** Source publication advances only its performing branch; it is never a world receipt. */
  advanceSource(advance:SourcePublicationAdvance,expected:SourcePublicationExpectation):void {
    assertSourcePublicationAdvance(advance);
    if(expected.taskId!==this.#context.id||expected.rootId!==this.#context.rootId||!sameScope(expected.scope,this.#context.scope))
      throw new ContractError('source_preparation_task_mismatch');
    const updates:Array<{task:TaskLease;readSet:ReadSet}>=[];
    for(let task:TaskLease|undefined=this;task;task=task.#parent) {
      task.assertActive();const prior=task.#sourceAdvances.get(advance.publicationId);
      if(prior) {
        if(!isDeepStrictEqual(prior,advance)||!sameScope(expected.scope,task.#context.scope))throw new ContractError('source_publication_replay_mismatch');
        // Verify every authority field even for a byte-identical replay.
        advanceSourceReadSet([{kind:'source',resource:advance.campaign,revision:advance.from}],advance,expected);
        if(task.#context.readSet.find(value=>value.kind==='source'&&value.resource===advance.campaign)?.revision!==advance.to)throw new ContractError('stale_source_publication_advance');
        continue;
      }
      updates.push({task,readSet:advanceSourceReadSet(task.#context.readSet,advance,expected)});
    }
    for(const {task,readSet} of updates) {task.#context.readSet=readSet;task.#sourceAdvances.set(advance.publicationId,structuredClone(advance));}
  }
  checkpoint(phase: string, settledReceipts: string[], remainingGoal: string): TaskCheckpoint {
    this.assertActive();
    return this.snapshotCheckpoint(phase, settledReceipts, remainingGoal);
  }
  /** Read-only persistence after cancellation; this grants no authority to resume work. */
  snapshotCheckpoint(phase: string, settledReceipts: string[], remainingGoal: string): TaskCheckpoint {
    if (typeof phase !== 'string' || !phase || typeof remainingGoal !== 'string' || !strings(settledReceipts))
      throw new ContractError('invalid_task_checkpoint');
    return { version: 1, context: this.context, phase, settledReceipts: [...new Set([...this.#receiptAdvances, ...settledReceipts])], remainingGoal,...(this.#sourceAdvances.size?{sourceAdvances:[...this.#sourceAdvances.values()].map(value=>structuredClone(value))}:{}) };
  }
}
