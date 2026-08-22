import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  asObject,
  canonicalReadinessCampaignId,
  collectLeafExecution,
  MAX_PENDING_COORDINATOR_QUEUES,
  MAX_RESULTS_PER_LEAF,
  McpJsonlClient,
  nonEmpty,
  parseStrictCoordinatorResultWithDiagnostics,
  readPrivateHandshake,
  runCoordinatorLifecycle,
  spawnPiChild,
  validateCoordinatorTask,
  validatePiSourcePackRepairDiagnostic,
  withPiPrivateRepairDiagnostics,
  type ChildRun,
  type JsonObject,
  type PiCurrentSceneProjection,
  type PiReadinessLayer,
  type PiReadinessStatus,
  type PiScenePriorityCandidate,
  type PiSemanticReadiness,
  type PiSourcePackRepairDiagnostic,
  type PrivateLaunchContext,
} from "../lib/runtime.ts";

const parameters = { type: "object", properties: {}, additionalProperties: false } as const;

function objectOrNull(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function smallStringOrNull(value: unknown, maxLength = 128): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

/**
 * The only accepted canonical source-work projection paths. Keeping this
 * extractor beside the Pi coordinator makes source dispatch ownership local to
 * this module instead of duplicating projection knowledge in the main host.
 */
function findAutoDispatchTakeover(value: unknown): JsonObject | null {
  const envelope = objectOrNull(value);
  if (envelope?.ok !== true) return null;
  const data = objectOrNull(envelope.data);
  const sourceWork = objectOrNull(data?.source_work);
  const progressive = objectOrNull(data?.progressive);
  const sceneContext = objectOrNull(data?.scene_context);
  const resumeProgressive = objectOrNull(sceneContext?.progressive);
  const candidates = [
    {
      takeover: objectOrNull(sourceWork?.background_takeover),
      allowed: envelope.tool === "progressive.opening_bootstrap",
    },
    { takeover: objectOrNull(data?.background_takeover), allowed: true },
    { takeover: objectOrNull(progressive?.background_takeover), allowed: true },
    { takeover: objectOrNull(resumeProgressive?.background_takeover), allowed: true },
  ];
  const present = candidates.filter((candidate) => candidate.takeover !== null);
  if (present.length !== 1 || !present[0].allowed) return null;
  return present[0].takeover;
}

export function findAutoDispatchTask(value: unknown): JsonObject | null {
  const takeover = findAutoDispatchTakeover(value);
  const action = objectOrNull(takeover?.next_host_action);
  const task = objectOrNull(action?.task);
  return action?.action === "invoke_coc_dispatch_source_work"
    && task?.contract_id === "coc.pi-source-coordinator-task.v1"
    ? task
    : null;
}

export interface PiCoordinatorAutoDispatchDeps {
  enabled(): Promise<boolean>;
  isCurrent(): boolean;
  activeManager(): CoordinatorDispatchManager | null;
  manager(): CoordinatorDispatchManager;
  launchContext(): PrivateLaunchContext | null;
  audit(entry: JsonObject): void;
}

export interface PiCoordinatorAutoDispatchOptions {
  waitForTerminal?: boolean;
  signal?: AbortSignal;
  submissionOwner?: () => boolean;
  onSubmissionOwnershipLost?: () => void;
  exactTask?: JsonObject;
  priority?: "background" | "scene";
}

export function coordinatorDispatchNullReason(
  state: unknown,
  dispatchKey: string,
): JsonObject {
  const current = objectOrNull(state);
  if (current === null) {
    return {
      status: "capability_unavailable",
      failure_class: "coordinator_capability_unavailable",
      ...(dispatchKey ? { dispatch_key: dispatchKey } : {}),
    };
  }
  const receipt = objectOrNull(current.terminal_receipt);
  if (receipt === null) {
    return {
      status: "dispatch_already_active",
      failure_class: "coordinator_dispatch_already_active",
      dispatch_key: dispatchKey,
      coordinator_status: String(current.status ?? ""),
    };
  }
  const diagnostics = Array.isArray(receipt.diagnostics)
    ? receipt.diagnostics
    : [];
  const codes = [...new Set(diagnostics.flatMap((entry) => {
    const code = objectOrNull(entry)?.code;
    return typeof code === "string" && code.trim().length > 0 ? [code] : [];
  }))];
  const failureClass = typeof receipt.failure_class === "string"
    && receipt.failure_class.trim().length > 0
    ? receipt.failure_class
    : "coordinator_terminal_failure";
  return {
    status: "coordinator_terminal",
    failure_class: failureClass,
    dispatch_key: dispatchKey,
    coordinator_status: String(receipt.status ?? ""),
    ...(codes.length > 0 ? { diagnostic_codes: codes } : {}),
  };
}

/**
 * Submit the one exact canonical task through the one bounded
 * CoordinatorDispatchManager. This is shared by ordinary background work and
 * current-scene priority; it never creates a second queue.
 */
export async function autoDispatchCoordinator(
  deps: PiCoordinatorAutoDispatchDeps,
  toolName: string,
  value: unknown,
  options: PiCoordinatorAutoDispatchOptions = {},
): Promise<JsonObject | null> {
  if (toolName !== "coc_invoke") return null;
  const task = options.exactTask ?? findAutoDispatchTask(value);
  if (!task) return null;
  const boundedFailure = (entry: JsonObject): JsonObject => {
    deps.audit(entry);
    return entry;
  };
  const submissionOwned = (dispatchKey?: string): JsonObject | null => {
    if (options.submissionOwner?.() !== false) return null;
    options.onSubmissionOwnershipLost?.();
    return boundedFailure({
      status: "ownership_lost",
      failure_class: "opening_dispatch_ownership_lost",
      ...(dispatchKey ? { dispatch_key: dispatchKey } : {}),
    });
  };
  if (!deps.isCurrent()) {
    return boundedFailure({
      status: "session_closed",
      failure_class: "session_closed",
    });
  }
  try {
    if (!(await deps.enabled())) {
      const unavailable = {
        status: "capability_unavailable",
        failure_class: "coordinator_capability_unavailable",
      };
      if (options.waitForTerminal || options.exactTask) {
        return boundedFailure(unavailable);
      }
      return null;
    }
  } catch {
    return boundedFailure(deps.isCurrent()
      ? { status: "capability_check_failed", failure_class: "capability_check_failed" }
      : { status: "session_closed", failure_class: "session_closed" });
  }
  const postCapabilityOwnership = submissionOwned();
  if (postCapabilityOwnership !== null) return postCapabilityOwnership;
  if (!deps.isCurrent()) {
    return boundedFailure({
      status: "session_closed",
      failure_class: "session_closed",
    });
  }
  let exactTask: JsonObject;
  let key: string;
  let workspaceRoot: string;
  try {
    exactTask = validateCoordinatorTask(task);
    const packet = asObject(exactTask.packet, "coordinator packet");
    key = nonEmpty(packet.packet_id, "packet_id");
    workspaceRoot = resolve(nonEmpty(packet.workspace_root, "workspace_root"));
  } catch {
    return boundedFailure({
      status: "validation_failed",
      failure_class: "coordinator_task_invalid",
    });
  }
  const active = deps.activeManager();
  const preExistingOwnership = submissionOwned(key);
  if (preExistingOwnership !== null) return preExistingOwnership;
  if (active?.state(key) && !options.exactTask) {
    return options.waitForTerminal
      ? await active.waitForTerminal(key, options.signal)
      : null;
  }
  const launch = deps.launchContext();
  if (!launch) {
    return boundedFailure({
      status: "launch_context_unavailable",
      dispatch_key: key,
      failure_class: "launch_context_unavailable",
    });
  }
  if (workspaceRoot !== resolve(launch.cwd)) {
    return boundedFailure({
      status: "workspace_drift",
      dispatch_key: key,
      failure_class: "workspace_drift",
    });
  }
  if (!deps.isCurrent()) {
    return boundedFailure({
      status: "session_closed",
      dispatch_key: key,
      failure_class: "session_closed",
    });
  }
  const preSubmitOwnership = submissionOwned(key);
  if (preSubmitOwnership !== null) return preSubmitOwnership;
  const ownedManager = deps.manager();
  const beforeManagerLaunch = options.submissionOwner
    ? () => submissionOwned(key) === null
    : undefined;
  let submitted: JsonObject;
  try {
    submitted = await ownedManager.submit(
      exactTask,
      launch,
      options.signal,
      beforeManagerLaunch,
      options.exactTask !== undefined,
      options.priority ?? "background",
    );
  } catch {
    const existing = ownedManager.state(key);
    if (options.waitForTerminal && existing) {
      return await ownedManager.waitForTerminal(key, options.signal);
    }
    return boundedFailure({
      status: "submit_failed",
      dispatch_key: key,
      failure_class: "coordinator_submit_failed",
    });
  }
  deps.audit(submitted);
  if (!options.waitForTerminal) return submitted;
  if (!ownedManager.state(key)) {
    return {
      ...submitted,
      failure_class: typeof submitted.failure_class === "string"
        ? submitted.failure_class
        : "coordinator_not_retained",
    };
  }
  return await ownedManager.waitForTerminal(key, options.signal);
}

export type CoordinatorDispatchPriority = "background" | "scene";

function coordinatorDispatchPriorityRank(
  priority: CoordinatorDispatchPriority,
): number {
  return priority === "scene" ? 1 : 0;
}

export type CoordinatorLifecycleObservation =
  | {
    status: "retrying";
    dispatch_key: string;
    completed_attempt: number;
    next_attempt: number;
    failure_class: "fulfill_rejected";
  }
  | {
    status: "completed";
    dispatch_key: string;
    terminal_receipt: JsonObject;
  }
  | {
    status: "terminal_failure";
    dispatch_key: string;
    failure_stage: "dispatch" | "activation" | "process" | "framing" | "shutdown";
    superseded_by?: string;
    failure_class:
      | "coordinator_superseded"
      | "coordinator_ownership_lost"
      | "coordinator_activation_failed"
      | "coordinator_process_failed"
      | "coordinator_result_invalid"
      | "coordinator_shutdown";
  };

export class CoordinatorDispatchManager {
  private active: { key: string; run: ChildRun } | null = null;
  private pending = new Map<string, {
    queueIdentity: string;
    key: string;
    task: JsonObject;
    context: PrivateLaunchContext;
    priority: CoordinatorDispatchPriority;
    signal?: AbortSignal;
    beforeLaunch?: () => boolean;
  }>();
  private closing = false;
  private states = new Map<string, {
    status: string;
    failure_stage?: string;
    failure_class?: string;
    superseded_by?: string;
    terminal_receipt?: JsonObject;
    notification?: JsonObject;
  }>();
  private terminalKeys = new Set<string>();
  private terminalWaiters = new Map<string, Set<{
    resolve: (state: JsonObject) => void;
    signal?: AbortSignal;
    abort?: () => void;
  }>>();
  private readonly launch: (task: JsonObject, context: PrivateLaunchContext, signal?: AbortSignal) => ChildRun;
  private readonly onTerminal?: (
    receipt: JsonObject,
    repairDiagnostics?: readonly PiSourcePackRepairDiagnostic[],
  ) => JsonObject | void | Promise<JsonObject | void>;
  private readonly onLifecycle?: (observation: CoordinatorLifecycleObservation) => void | Promise<void>;
  constructor(
    launch: (task: JsonObject, context: PrivateLaunchContext, signal?: AbortSignal) => ChildRun,
    onTerminal?: (
      receipt: JsonObject,
      repairDiagnostics?: readonly PiSourcePackRepairDiagnostic[],
    ) => JsonObject | void | Promise<JsonObject | void>,
    onLifecycle?: (observation: CoordinatorLifecycleObservation) => void | Promise<void>,
  ) {
    this.launch = launch;
    this.onTerminal = onTerminal;
    this.onLifecycle = onLifecycle;
  }
  private observeOnce(observation: CoordinatorLifecycleObservation): boolean {
    if (this.terminalKeys.has(observation.dispatch_key)) return false;
    this.terminalKeys.add(observation.dispatch_key);
    try {
      const pending = this.onLifecycle?.(observation);
      if (pending && typeof pending.then === "function") void pending.catch(() => {});
    } catch { /* lifecycle audit is best effort and never changes authority */ }
    return true;
  }
  private observeRetry(observation: Extract<
    CoordinatorLifecycleObservation,
    { status: "retrying" }
  >): void {
    try {
      const pending = this.onLifecycle?.(observation);
      if (pending && typeof pending.then === "function") void pending.catch(() => {});
    } catch { /* lifecycle audit is best effort and never changes authority */ }
  }
  private fail(
    key: string,
    failureStage: "dispatch" | "activation" | "process" | "framing" | "shutdown",
    failureClass: "coordinator_superseded" | "coordinator_ownership_lost" | "coordinator_activation_failed" | "coordinator_process_failed" | "coordinator_result_invalid" | "coordinator_shutdown",
    supersededBy?: string,
  ): boolean {
    const observation: CoordinatorLifecycleObservation = {
      status: "terminal_failure",
      dispatch_key: key,
      failure_stage: failureStage,
      failure_class: failureClass,
      ...(supersededBy ? { superseded_by: supersededBy } : {}),
    };
    if (!this.observeOnce(observation)) return false;
    this.states.set(key, observation);
    this.settleTerminalWaiters(key);
    return true;
  }
  private complete(key: string, receipt: JsonObject): boolean {
    const observation: CoordinatorLifecycleObservation = {
      status: "completed",
      dispatch_key: key,
      terminal_receipt: receipt,
    };
    if (!this.observeOnce(observation)) return false;
    this.states.set(key, {
      status: "completed",
      terminal_receipt: receipt,
      notification: { status: this.onTerminal ? "pending" : "not_configured" },
    });
    if (!this.onTerminal) this.settleTerminalWaiters(key);
    return true;
  }
  private previousReceipt(key: string, previous: {
    status: string;
    failure_stage?: string;
    failure_class?: string;
    superseded_by?: string;
    terminal_receipt?: JsonObject;
    notification?: JsonObject;
  }): JsonObject {
    return {
      status: previous.status,
      dispatch_key: key,
      ...(previous.failure_stage ? { failure_stage: previous.failure_stage } : {}),
      ...(previous.failure_class ? { failure_class: previous.failure_class } : {}),
      ...(previous.superseded_by ? { superseded_by: previous.superseded_by } : {}),
      ...(previous.terminal_receipt ? { terminal_receipt: previous.terminal_receipt } : {}),
      ...(previous.notification ? { notification: previous.notification } : {}),
    };
  }
  private terminalState(key: string): JsonObject | null {
    const state = this.states.get(key);
    if (!state) return null;
    if (state.status === "terminal_failure") {
      return this.previousReceipt(key, state);
    }
    if (
      state.status === "completed"
      && state.notification?.status !== "pending"
    ) {
      return this.previousReceipt(key, state);
    }
    return null;
  }
  private async publishTerminalNotification(
    key: string,
    receipt: JsonObject,
    repairDiagnostics: readonly PiSourcePackRepairDiagnostic[],
  ): Promise<JsonObject> {
    try {
      const delivered = await this.onTerminal?.(receipt, repairDiagnostics);
      const notification = delivered && typeof delivered === "object"
        ? asObject(delivered, "terminal notification result")
        : { status: "delivered" };
      this.states.set(key, {
        status: "completed",
        terminal_receipt: receipt,
        notification,
      });
    } catch {
      this.states.set(key, {
        status: "completed",
        terminal_receipt: receipt,
        notification: {
          status: "failed",
          failure_class: "notification_callback_failed",
        },
      });
    }
    this.settleTerminalWaiters(key);
    return this.previousReceipt(key, this.states.get(key)!);
  }
  private settleTerminalWaiters(key: string): void {
    const terminal = this.terminalState(key);
    if (!terminal) return;
    const waiters = this.terminalWaiters.get(key);
    if (!waiters) return;
    this.terminalWaiters.delete(key);
    for (const waiter of waiters) {
      if (waiter.signal && waiter.abort) {
        waiter.signal.removeEventListener("abort", waiter.abort);
      }
      waiter.resolve(terminal);
    }
  }
  private queuePending(
    task: JsonObject,
    key: string,
    context: PrivateLaunchContext,
    priority: CoordinatorDispatchPriority,
    signal?: AbortSignal,
    beforeLaunch?: () => boolean,
  ): JsonObject {
    const queueIdentity = this.queueIdentity(task, key);
    // Packets within one exact queue identity are wakeups whose fixed claim
    // operation re-reads that canonical queue. Cross-campaign/root/executor
    // wakeups stay in this one bounded manager queue; a current source-bound
    // scene may move ahead of ordinary background work, but never preempts an
    // already active child.
    const superseded = this.pending.get(queueIdentity);
    if (superseded) {
      if (
        coordinatorDispatchPriorityRank(superseded.priority)
        > coordinatorDispatchPriorityRank(priority)
      ) {
        this.fail(key, "dispatch", "coordinator_superseded", superseded.key);
        return this.previousReceipt(key, this.states.get(key)!);
      }
      this.fail(superseded.key, "dispatch", "coordinator_superseded", key);
    } else if (this.pending.size >= MAX_PENDING_COORDINATOR_QUEUES) {
      return {
        status: "pending_overflow",
        dispatch_key: key,
        role: "coordinator",
        failure_class: "pending_queue_capacity_reached",
        reemit_required: true,
        retry_after_active_terminal: true,
        pending_queue_count: this.pending.size,
      };
    }
    this.pending.set(queueIdentity, {
      queueIdentity,
      key,
      task,
      context,
      priority,
      signal,
      beforeLaunch,
    });
    this.states.set(key, { status: "pending" });
    return {
      status: "pending",
      dispatch_key: key,
      role: "coordinator",
      pending_queue_count: this.pending.size,
    };
  }
  private queueIdentity(task: JsonObject, key: string): string {
    const packet = asObject(task.packet, "coordinator packet");
    const claim = asObject(packet.claim_operation, "claim operation");
    const prefilled = asObject(claim.prefilled_arguments, "claim arguments");
    const assetRoot = typeof packet.asset_root_id === "string" && packet.asset_root_id.trim()
      ? packet.asset_root_id.trim()
      // Older component fixtures omit asset_root_id. Never coalesce those
      // incomplete identities across packet ids.
      : `packet:${key}`;
    return JSON.stringify([
      resolve(nonEmpty(packet.workspace_root, "workspace_root")),
      nonEmpty(packet.campaign_id, "campaign_id"),
      assetRoot,
      nonEmpty(prefilled.executor_id, "claim executor_id"),
    ]);
  }
  private async launchNow(
    task: JsonObject,
    key: string,
    context: PrivateLaunchContext,
    signal?: AbortSignal,
    attempt = 1,
    beforeLaunch?: () => boolean,
  ): Promise<JsonObject> {
    if (this.closing) throw new Error("Pi source coordinator manager is closing");
    if (signal?.aborted) {
      this.fail(key, "activation", "coordinator_activation_failed");
      throw new Error("Pi source coordinator dispatch aborted before activation");
    }
    if (beforeLaunch?.() === false) {
      this.fail(key, "dispatch", "coordinator_ownership_lost");
      throw new Error("Pi source coordinator dispatch ownership was superseded");
    }
    let run: ChildRun;
    try { run = this.launch(task, context, signal); }
    catch (error) {
      this.fail(key, "process", "coordinator_process_failed");
      throw error;
    }
    this.active = { key, run };
    this.states.set(key, { status: "activating" });
    try { await run.activation; }
    catch (error) {
      if (this.active?.key === key && this.active.run === run) this.active = null;
      this.fail(key, "activation", "coordinator_activation_failed");
      void this.drainPending();
      throw error;
    }
    this.states.set(key, { status: "submitted" });
    void run.completion.then(async (events) => {
      let receipt: JsonObject;
      let repairDiagnostics: PiSourcePackRepairDiagnostic[];
      try {
        const parsed = parseStrictCoordinatorResultWithDiagnostics(events, task);
        receipt = parsed.receipt;
        repairDiagnostics = parsed.repair_diagnostics;
      } catch {
        this.fail(key, "framing", "coordinator_result_invalid");
        return;
      }
      const packet = asObject(task.packet, "coordinator packet");
      const failurePolicy = packet.failure_policy && typeof packet.failure_policy === "object"
        ? packet.failure_policy as JsonObject
        : null;
      const automaticRetry = failurePolicy?.same_task_retry === true
        ? failurePolicy.automatic_retry as JsonObject
        : null;
      const maxAttempts = automaticRetry?.max_attempts;
      if (
        Number.isInteger(maxAttempts)
        && attempt < (maxAttempts as number)
        && receipt.status === automaticRetry?.require_status
        && receipt.failure_class === "fulfill_rejected"
        && (automaticRetry.retryable_failure_classes as unknown[])?.includes(
          receipt.failure_class,
        )
        && (
          automaticRetry.require_positive_claimed !== true
          || (receipt.claimed_packet_count as number) > 0
        )
        && (
          automaticRetry.require_zero_fulfilled !== true
          || receipt.fulfilled_result_count === 0
        )
      ) {
        const nextAttempt = attempt + 1;
        this.states.set(key, {
          status: "retrying",
          failure_class: "fulfill_rejected",
        });
        this.observeRetry({
          status: "retrying",
          dispatch_key: key,
          completed_attempt: attempt,
          next_attempt: nextAttempt,
          failure_class: "fulfill_rejected",
        });
        try {
          await this.launchNow(
            task,
            key,
            context,
            signal,
            nextAttempt,
            beforeLaunch,
          );
        } catch {
          if (!this.terminalKeys.has(key)) {
            this.fail(
              key,
              this.closing ? "shutdown" : "process",
              this.closing
                ? "coordinator_shutdown"
                : "coordinator_process_failed",
            );
          }
        }
        return;
      }
      if (!this.complete(key, receipt)) return;
      if (!this.onTerminal) return;
      await this.publishTerminalNotification(
        key,
        receipt,
        repairDiagnostics,
      );
    }, () => {
      this.fail(key, "process", "coordinator_process_failed");
    }).finally(() => {
      if (this.active?.key === key && this.active.run === run) this.active = null;
      void this.drainPending();
    });
    return { status: "submitted", dispatch_key: key, role: "coordinator" };
  }
  private async drainPending(): Promise<void> {
    if (this.closing || this.active || this.pending.size === 0) return;
    let pending: {
      queueIdentity: string;
      key: string;
      task: JsonObject;
      context: PrivateLaunchContext;
      priority: CoordinatorDispatchPriority;
      signal?: AbortSignal;
      beforeLaunch?: () => boolean;
    } | null = null;
    for (const candidate of this.pending.values()) {
      if (
        pending === null
        || coordinatorDispatchPriorityRank(candidate.priority)
          > coordinatorDispatchPriorityRank(pending.priority)
      ) pending = candidate;
    }
    if (pending === null) return;
    this.pending.delete(pending.queueIdentity);
    try {
      await this.launchNow(
        pending.task,
        pending.key,
        pending.context,
        pending.signal,
        1,
        pending.beforeLaunch,
      );
    }
    catch { /* launchNow records one bounded terminal failure */ }
  }
  async submit(
    taskValue: unknown,
    context: PrivateLaunchContext,
    signal?: AbortSignal,
    beforeLaunch?: () => boolean,
    retryTerminalFailure = false,
    priority: CoordinatorDispatchPriority = "background",
  ): Promise<JsonObject> {
    if (this.closing) throw new Error("Pi source coordinator manager is closing");
    const task = validateCoordinatorTask(taskValue);
    const packet = asObject(task.packet, "coordinator packet");
    const key = nonEmpty(packet.packet_id, "packet_id");
    const previous = this.states.get(key);
    if (previous) {
      if (previous.status === "terminal_failure" && retryTerminalFailure) {
        this.states.delete(key);
        this.terminalKeys.delete(key);
      } else {
        if (previous.status === "pending") {
          const pending = this.pending.get(this.queueIdentity(task, key));
          if (
            pending?.key === key
            && coordinatorDispatchPriorityRank(priority)
              > coordinatorDispatchPriorityRank(pending.priority)
          ) {
            pending.priority = priority;
            return {
              status: "pending",
              dispatch_key: key,
              role: "coordinator",
              pending_queue_count: this.pending.size,
            };
          }
        }
        return this.previousReceipt(key, previous);
      }
    }
    if (this.active) {
      return this.queuePending(
        task, key, context, priority, signal, beforeLaunch,
      );
    }
    return this.launchNow(task, key, context, signal, 1, beforeLaunch);
  }
  waitForTerminal(key: string, signal?: AbortSignal): Promise<JsonObject> {
    const terminal = this.terminalState(key);
    if (terminal) return Promise.resolve(terminal);
    if (signal?.aborted) {
      return Promise.reject(
        new Error("Pi source coordinator terminal wait aborted"),
      );
    }
    return new Promise<JsonObject>((resolveTerminal, rejectTerminal) => {
      const waiter: {
        resolve: (state: JsonObject) => void;
        signal?: AbortSignal;
        abort?: () => void;
      } = {
        resolve: resolveTerminal,
        signal,
      };
      if (signal) {
        waiter.abort = () => {
          const waiters = this.terminalWaiters.get(key);
          waiters?.delete(waiter);
          if (waiters?.size === 0) this.terminalWaiters.delete(key);
          rejectTerminal(
            new Error("Pi source coordinator terminal wait aborted"),
          );
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
      const waiters = this.terminalWaiters.get(key) ?? new Set();
      waiters.add(waiter);
      this.terminalWaiters.set(key, waiters);
      // A terminal transition may have raced between the first read and
      // waiter registration.
      this.settleTerminalWaiters(key);
    });
  }
  state(key: string) { return this.states.get(key); }
  activeCount() { return this.active ? 1 : 0; }
  pendingCount() { return this.pending.size; }
  async shutdown() {
    this.closing = true;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const pending of waiting) this.fail(pending.key, "shutdown", "coordinator_shutdown");
    const owned = this.active;
    if (!owned) return;
    try { await owned.run.terminate(); }
    finally {
      this.fail(owned.key, "shutdown", "coordinator_shutdown");
      if (this.active?.key === owned.key && this.active.run === owned.run) this.active = null;
    }
  }
}


function readinessLayer(
  status: PiReadinessStatus,
  reason: string,
): PiReadinessLayer {
  return { status, evidence_gap: status !== "ready", reason };
}

function emptyCurrentSceneProjection(): PiCurrentSceneProjection {
  return {
    ...readinessLayer("unknown", "no_canonical_scene_projection"),
    provenance: "unknown",
    source_backed: false,
  };
}

function emptySemanticReadiness(campaignId: string): PiSemanticReadiness {
  return {
    schema_version: 1,
    contract_id: "coc.pi-semantic-readiness.v1",
    campaign_id: campaignId,
    current_scene_id: null,
    page_parse: readinessLayer("unknown", "no_canonical_page_parse_status"),
    semantic_compile: readinessLayer("unknown", "no_canonical_semantic_compile_status"),
    current_scene_projection: emptyCurrentSceneProjection(),
  };
}

function canonicalReadinessData(value: unknown): JsonObject | null {
  const envelope = objectOrNull(value);
  if (envelope?.ok !== true) return null;
  return objectOrNull(envelope.data);
}

function readinessNodes(data: JsonObject): JsonObject[] {
  const nodes: JsonObject[] = [data];
  const progressive = objectOrNull(data.progressive);
  if (progressive !== null) nodes.push(progressive);
  const sceneContext = objectOrNull(data.scene_context);
  if (sceneContext !== null) {
    nodes.push(sceneContext);
    const nestedProgressive = objectOrNull(sceneContext.progressive);
    if (nestedProgressive !== null) nodes.push(nestedProgressive);
  }
  return nodes;
}

function firstOwnValue(
  nodes: JsonObject[],
  key: string,
): { found: boolean; value: unknown } {
  for (const node of nodes) {
    if (Object.hasOwn(node, key)) return { found: true, value: node[key] };
  }
  return { found: false, value: undefined };
}

function structuredStatus(value: unknown): string | null {
  return smallStringOrNull(value, 64)?.toLowerCase() ?? null;
}

function statusFromStructuredProgress(
  value: unknown,
  missingReason: string,
): PiReadinessLayer {
  const row = objectOrNull(value);
  if (row === null) return readinessLayer("missing", missingReason);
  if (row.complete === true || row.ready === true) {
    return readinessLayer("ready", "canonical_status_complete");
  }
  const status = structuredStatus(row.status ?? row.pass_status);
  if (["complete", "current", "ready", "fulfilled"].includes(status ?? "")) {
    return readinessLayer("ready", "canonical_status_complete");
  }
  if (["failed", "error", "cancelled", "terminal_failure"].includes(status ?? "")) {
    return readinessLayer("failed", "canonical_status_failed");
  }
  if ([
    "queued", "pending", "in_progress", "active", "awaiting_host_pack",
    "partial",
  ].includes(status ?? "")) {
    return readinessLayer("pending", "canonical_status_pending");
  }
  if (["missing", "unavailable"].includes(status ?? "")) {
    return readinessLayer("missing", missingReason);
  }
  return readinessLayer("unknown", "canonical_status_unrecognized");
}

function derivePageParseReadiness(nodes: JsonObject[]): PiReadinessLayer | null {
  const fullParse = firstOwnValue(nodes, "full_parse");
  return fullParse.found
    ? statusFromStructuredProgress(fullParse.value, "full_parse_missing")
    : null;
}

function hostWorkRows(nodes: JsonObject[]): JsonObject[] {
  const rows: JsonObject[] = [];
  for (const node of nodes) {
    const candidates = [node, objectOrNull(node.host_work)].filter(
      (candidate): candidate is JsonObject => candidate !== null,
    );
    for (const hostWork of candidates) {
      for (const field of ["requests", "ready_background_requests"]) {
        const values = hostWork[field];
        if (!Array.isArray(values)) continue;
        for (const value of values) {
          const row = objectOrNull(value);
          if (row !== null) rows.push(row);
        }
      }
    }
  }
  return rows;
}

function deriveSemanticCompileReadiness(
  nodes: JsonObject[],
): PiReadinessLayer | null {
  const explicit = firstOwnValue(nodes, "semantic_compile");
  if (explicit.found) {
    return statusFromStructuredProgress(explicit.value, "semantic_compile_missing");
  }
  const sectionIndex = firstOwnValue(nodes, "section_index");
  if (sectionIndex.found) {
    return statusFromStructuredProgress(sectionIndex.value, "section_index_missing");
  }
  const classifications = hostWorkRows(nodes).filter((row) => (
    row.kind === "classify_sections"
  ));
  if (classifications.length === 0) return null;
  if (classifications.some((row) => (
    row.status === "fulfilled" || row.dispatch_state === "fulfilled"
  ))) return readinessLayer("ready", "section_classification_fulfilled");
  if (classifications.some((row) => (
    row.retry_exhausted === true
    || ["failed", "cancelled", "terminal_failure"].includes(
      structuredStatus(row.status ?? row.dispatch_state) ?? "",
    )
  ))) return readinessLayer("failed", "section_classification_failed");
  return readinessLayer("pending", "section_classification_pending");
}

function provenanceToken(value: unknown): string | null {
  const direct = structuredStatus(value);
  if (direct !== null) return direct;
  const row = objectOrNull(value);
  return row === null ? null : structuredStatus(row.kind ?? row.origin ?? row.authority);
}

function sceneProjectionProvenance(
  scene: JsonObject | null,
  sourceMaterial: JsonObject | null,
): PiCurrentSceneProjection["provenance"] {
  const tokens = [
    provenanceToken(scene?.provenance),
    provenanceToken(scene?.origin),
    provenanceToken(sourceMaterial?.provenance),
    provenanceToken(sourceMaterial?.origin),
  ];
  if (tokens.some((token) => token === "improvised" || token === "kp_improvised")) {
    return "improvised";
  }
  if (tokens.some((token) => (
    token === "campaign_local"
    || token === "campaign_progressive_dig"
    || token === "campaign"
  ))) return "campaign_local";
  return sourceMaterial?.authority === "source_authored_context"
    ? "source_backed"
    : "unknown";
}

function missingCurrentSceneProjection(): PiCurrentSceneProjection {
  return {
    ...readinessLayer("missing", "scene_or_source_material_missing"),
    provenance: "unknown",
    source_backed: false,
  };
}

function deriveCurrentSceneProjection(
  nodes: JsonObject[],
): PiCurrentSceneProjection | null {
  let projectionNode: JsonObject | null = null;
  for (const node of nodes) {
    if (
      Object.hasOwn(node, "scene")
      || Object.hasOwn(node, "scene_identity")
      || Object.hasOwn(node, "source_material")
    ) {
      projectionNode = node;
      break;
    }
  }
  if (projectionNode === null) return null;
  const scene = objectOrNull(projectionNode.scene)
    ?? objectOrNull(projectionNode.scene_identity);
  const sourceMaterial = objectOrNull(projectionNode.source_material);
  const provenance = sceneProjectionProvenance(scene, sourceMaterial);
  const sourceBacked = provenance === "source_backed";
  if (scene === null || sourceMaterial === null) {
    return {
      ...missingCurrentSceneProjection(),
      provenance: scene === null ? "unknown" : provenance,
      source_backed: false,
    };
  }
  if (scene.evidence_gap === true || sourceMaterial.evidence_gap === true) {
    return {
      ...readinessLayer("evidence_gap", "scene_projection_evidence_gap"),
      provenance,
      source_backed: sourceBacked,
    };
  }
  if (sourceMaterial.keeper_only !== true) {
    return {
      ...readinessLayer("evidence_gap", "source_material_projection_invalid"),
      provenance,
      source_backed: sourceBacked,
    };
  }
  if (provenance === "unknown") {
    return {
      ...readinessLayer("evidence_gap", "scene_projection_provenance_unknown"),
      provenance,
      source_backed: false,
    };
  }
  return {
    ...readinessLayer("ready", "canonical_scene_projection_current"),
    provenance,
    source_backed: sourceBacked,
  };
}

function sceneIdFromNodes(nodes: JsonObject[]): string | null {
  for (const node of nodes) {
    const direct = smallStringOrNull(node.active_scene_id ?? node.to_scene_id);
    if (direct !== null) return direct;
    const scene = objectOrNull(node.scene) ?? objectOrNull(node.scene_identity);
    const sceneId = smallStringOrNull(scene?.scene_id);
    if (sceneId !== null) return sceneId;
  }
  return null;
}

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function sceneCarriesSourceMarker(
  scene: JsonObject | null,
  sourceMaterial: JsonObject | null,
): boolean {
  if (
    sourceMaterial?.authority === "source_authored_context"
    || nonEmptyArray(sourceMaterial?.source_refs)
    || nonEmptyArray(sourceMaterial?.contextual_mentions)
  ) return true;
  return scene !== null && (
    nonEmptyArray(scene.source_context_mentions)
    || nonEmptyArray(scene.source_refs)
    || nonEmptyArray(scene._archive_source_refs)
    || smallStringOrNull(scene.parse_state, 64) !== null
    || scene.evidence_gap === true
  );
}

function sceneSourceMarkerFromNodes(nodes: JsonObject[]): boolean {
  return nodes.some((node) => sceneCarriesSourceMarker(
    objectOrNull(node.scene) ?? objectOrNull(node.scene_identity),
    objectOrNull(node.source_material),
  ));
}

function progressiveAssetRootFromNodes(nodes: JsonObject[]): string | null {
  for (const node of nodes) {
    const progressive = objectOrNull(node.progressive);
    const value = smallStringOrNull(progressive?.asset_root_id ?? node.asset_root_id);
    if (value !== null) return value;
  }
  return null;
}

function movedSceneIsSourceBound(data: JsonObject): boolean {
  const scene = objectOrNull(data.scene);
  const progressive = objectOrNull(data.progressive);
  return scene !== null && (
    sceneCarriesSourceMarker(scene, null)
    || smallStringOrNull(progressive?.asset_root_id) !== null
  );
}

/** State is intentionally coordinator-owned; runtime contains only types and pure validators. */
export class PiSemanticReadinessSession {
  private readonly readinessByCampaign = new Map<string, PiSemanticReadiness>();
  private readonly repairDiagnosticsByCampaign = new Map<
    string,
    Map<string, PiSourcePackRepairDiagnostic>
  >();
  private readonly sourceBoundScenesByCampaign = new Map<string, Set<string>>();

  private sourceBoundScenes(campaignId: string): Set<string> {
    const known = this.sourceBoundScenesByCampaign.get(campaignId);
    if (known !== undefined) return known;
    const created = new Set<string>();
    this.sourceBoundScenesByCampaign.set(campaignId, created);
    return created;
  }

  private priorityCandidate(campaignId: string): PiScenePriorityCandidate | null {
    const readiness = this.readinessByCampaign.get(campaignId);
    const sceneId = readiness?.current_scene_id ?? null;
    const status = readiness?.current_scene_projection.status;
    if (
      sceneId === null
      || !this.sourceBoundScenes(campaignId).has(sceneId)
      || (status !== "missing" && status !== "evidence_gap")
    ) return null;
    return {
      campaign_id: campaignId,
      scene_id: sceneId,
      source_bound: true,
      current_scene_status: status,
    };
  }

  reset(): void {
    this.readinessByCampaign.clear();
    this.repairDiagnosticsByCampaign.clear();
    this.sourceBoundScenesByCampaign.clear();
  }

  observeCanonical(
    operation: string,
    campaignId: string | null,
    value: unknown,
  ): PiSemanticReadiness | null {
    if (campaignId === null) return null;
    const data = canonicalReadinessData(value);
    const isResume = operation === "session.resume";
    if (isResume) this.sourceBoundScenesByCampaign.delete(campaignId);
    if (data === null) {
      if (!isResume) return null;
      const cleared = emptySemanticReadiness(campaignId);
      this.readinessByCampaign.set(campaignId, cleared);
      return structuredClone(cleared);
    }
    const current = isResume
      ? emptySemanticReadiness(campaignId)
      : structuredClone(this.readinessByCampaign.get(campaignId)
        ?? emptySemanticReadiness(campaignId));
    const nodes = readinessNodes(data);
    const pageParse = derivePageParseReadiness(nodes);
    const semanticCompile = deriveSemanticCompileReadiness(nodes);
    const sceneProjection = deriveCurrentSceneProjection(nodes);
    const sceneId = sceneIdFromNodes(nodes);
    const expectsCurrentSceneProjection = operation === "scene.context"
      || (operation === "session.resume" && Object.hasOwn(data, "scene_context"));
    if (pageParse !== null) current.page_parse = pageParse;
    const retainRepairTerminal = (
      current.semantic_compile.reason === "section_classification_repair_terminal"
      && semanticCompile?.status === "pending"
    );
    if (semanticCompile !== null && !retainRepairTerminal) {
      current.semantic_compile = semanticCompile;
    }
    if (sceneProjection !== null) current.current_scene_projection = sceneProjection;
    else if (expectsCurrentSceneProjection) {
      current.current_scene_projection = missingCurrentSceneProjection();
    }
    if (sceneId !== null) {
      current.current_scene_id = sceneId;
      // A progressive root makes a missing campaign-local/improvised scene a
      // deliberate self-correction candidate; materialization still cannot
      // label it source-backed until canonical scene.context proves it.
      if (sceneSourceMarkerFromNodes(nodes) || progressiveAssetRootFromNodes(nodes) !== null) {
        this.sourceBoundScenes(campaignId).add(sceneId);
      } else if (
        current.current_scene_projection.provenance === "campaign_local"
        || current.current_scene_projection.provenance === "improvised"
      ) {
        this.sourceBoundScenes(campaignId).delete(sceneId);
      }
    }
    this.readinessByCampaign.set(campaignId, current);
    return structuredClone(current);
  }

  observeMoveScene(
    campaignId: string | null,
    value: unknown,
  ): PiScenePriorityCandidate | null {
    if (campaignId === null) return null;
    const data = canonicalReadinessData(value);
    if (data === null) return null;
    const sceneId = smallStringOrNull(data.to_scene_id);
    if (sceneId === null) return null;
    const current = structuredClone(
      this.readinessByCampaign.get(campaignId)
      ?? emptySemanticReadiness(campaignId),
    );
    current.current_scene_id = sceneId;
    if (movedSceneIsSourceBound(data)) {
      this.sourceBoundScenes(campaignId).add(sceneId);
      current.current_scene_projection = {
        ...readinessLayer("missing", "scene_move_requires_current_context"),
        provenance: "unknown",
        source_backed: false,
      };
    } else {
      this.sourceBoundScenes(campaignId).delete(sceneId);
      current.current_scene_projection = emptyCurrentSceneProjection();
    }
    this.readinessByCampaign.set(campaignId, current);
    return this.priorityCandidate(campaignId);
  }

  scenePriorityCandidate(campaignId: string): PiScenePriorityCandidate | null {
    return this.priorityCandidate(campaignId);
  }

  recordRepairDiagnostics(
    diagnostics: readonly PiSourcePackRepairDiagnostic[],
  ): void {
    for (const rawDiagnostic of diagnostics) {
      const diagnostic = validatePiSourcePackRepairDiagnostic(rawDiagnostic);
      if (!this.readinessByCampaign.has(diagnostic.campaign_id)) {
        this.readinessByCampaign.set(
          diagnostic.campaign_id,
          emptySemanticReadiness(diagnostic.campaign_id),
        );
      }
      const byKey = this.repairDiagnosticsByCampaign.get(diagnostic.campaign_id)
        ?? new Map<string, PiSourcePackRepairDiagnostic>();
      const key = [diagnostic.job_id, diagnostic.field_paths.join("|")].join("\u0000");
      const previous = byKey.get(key);
      const retained = {
        ...diagnostic,
        retry_terminal: diagnostic.retry_terminal || previous?.retry_terminal === true,
        retry_exhausted: diagnostic.retry_exhausted || previous?.retry_exhausted === true,
      };
      byKey.set(key, retained);
      if (retained.retry_terminal || retained.retry_exhausted) {
        const current = structuredClone(
          this.readinessByCampaign.get(diagnostic.campaign_id)
          ?? emptySemanticReadiness(diagnostic.campaign_id),
        );
        current.semantic_compile = readinessLayer(
          "failed",
          "section_classification_repair_terminal",
        );
        this.readinessByCampaign.set(diagnostic.campaign_id, current);
      }
      while (byKey.size > 16) {
        const oldest = byKey.keys().next().value;
        if (oldest === undefined) break;
        byKey.delete(oldest);
      }
      this.repairDiagnosticsByCampaign.set(diagnostic.campaign_id, byKey);
    }
  }

  snapshot(campaignId: string): PiSemanticReadiness | null {
    const value = this.readinessByCampaign.get(campaignId);
    return value === undefined ? null : structuredClone(value);
  }

  hiddenContext(
    campaignId: string,
    reason: (
      | "canonical_resume"
      | "repair_retry"
      | "scene_priority_waiting"
      | "scene_priority_ready"
      | "scene_priority_terminal"
    ),
  ): JsonObject | null {
    const readiness = this.snapshot(campaignId);
    if (readiness === null) return null;
    const diagnostics = [
      ...(this.repairDiagnosticsByCampaign.get(campaignId)?.values() ?? []),
    ].map((diagnostic) => structuredClone(diagnostic));
    return {
      schema_version: 1,
      contract_id: "coc.pi-semantic-readiness-context.v1",
      audience: "keeper_only",
      reason,
      readiness,
      ...(diagnostics.length ? { repair_diagnostics: diagnostics } : {}),
      instruction: (
        "This is Pi-host diagnostic context, never player-facing prose. "
        + "Readiness is advisory: do not treat it as a player-action gate or "
        + "as authority to invent missing source material."
      ),
    };
  }
}

const MATERIALIZE_MAX_ATTEMPTS = 2;

type ScenePriorityDispatchState = {
  checking: boolean;
  activePacketId: string | null;
  materializeAttempts: number;
  terminalPacketIds: Set<string>;
  completedPacketIds: Set<string>;
};

type ScenePriorityPacketBinding = {
  stateKey: string;
  campaignId: string;
  sceneId: string;
};

export type PiSemanticSupplyHost = {
  isCurrent(): boolean;
  coordinatorEnabled(): Promise<boolean>;
  launchContext(): PrivateLaunchContext | null;
  launchCoordinator(
    task: JsonObject,
    context: PrivateLaunchContext,
    signal?: AbortSignal,
  ): ChildRun;
  callCanonical(params: JsonObject, signal?: AbortSignal): Promise<unknown>;
  appendAudit(name: string, value: JsonObject): void;
  sendHidden(
    context: JsonObject,
    options: { triggerTurn: boolean; deliverAs?: "followUp" },
  ): void;
  projectTerminal(receipt: JsonObject): JsonObject | void | Promise<JsonObject | void>;
  createManager?(): CoordinatorDispatchManager;
};

/**
 * Pi host orchestration owner for source supply. It owns exactly one runtime
 * manager and all session-local semantic state; index.ts supplies only host IO
 * and player-safe terminal projection.
 */
export class PiSemanticSupplyCoordinator {
  private host: PiSemanticSupplyHost | null = null;
  private manager: CoordinatorDispatchManager | null = null;
  private readonly readiness = new PiSemanticReadinessSession();
  private scenePriorityStates = new Map<string, ScenePriorityDispatchState>();
  private scenePriorityPackets = new Map<string, ScenePriorityPacketBinding>();
  private scenePriorityRuns = new Set<Promise<unknown>>();
  private continuedDispatches = new Set<string>();

  start(host: PiSemanticSupplyHost): void {
    const priorManager = this.manager;
    this.host = host;
    this.manager = null;
    // A duplicate host start must not leave a prior session's child alive.
    // Its callbacks capture the prior host below, so cleanup cannot write
    // lifecycle state into this fresh session.
    if (priorManager !== null) void priorManager.shutdown().catch(() => {});
    this.readiness.reset();
    this.scenePriorityStates = new Map<string, ScenePriorityDispatchState>();
    this.scenePriorityPackets = new Map<string, ScenePriorityPacketBinding>();
    this.scenePriorityRuns = new Set<Promise<unknown>>();
    this.continuedDispatches = new Set<string>();
  }

  activeManager(): CoordinatorDispatchManager | null {
    return this.manager;
  }

  terminalDedupe(): Set<string> {
    return this.continuedDispatches;
  }

  readinessSnapshot(campaignId: string): PiSemanticReadiness | null {
    return this.readiness.snapshot(campaignId);
  }

  private requireHost(): PiSemanticSupplyHost {
    if (this.host === null) throw new Error("Pi semantic supply coordinator is not started");
    return this.host;
  }

  private audit(name: string, value: JsonObject): void {
    try { this.requireHost().appendAudit(name, value); }
    catch { /* audit is best effort */ }
  }

  private publishContext(
    campaignId: string,
    reason: (
      | "canonical_resume"
      | "repair_retry"
      | "scene_priority_waiting"
      | "scene_priority_ready"
      | "scene_priority_terminal"
    ),
    scenePriority?: JsonObject,
    triggerTurn = false,
  ): void {
    const base = this.readiness.hiddenContext(campaignId, reason);
    if (base === null) return;
    const context = {
      ...base,
      ...(scenePriority ? { scene_priority: scenePriority } : {}),
    };
    try {
      this.requireHost().sendHidden(
        context,
        triggerTurn
          ? { triggerTurn: true, deliverAs: "followUp" }
          : { triggerTurn: false },
      );
    } catch { /* hidden context is best effort */ }
  }

  private appendReadiness(campaignId: string): void {
    const readiness = this.readiness.snapshot(campaignId);
    if (readiness !== null) this.audit("coc-semantic-readiness", readiness);
  }

  private scenePriorityStateKey(candidate: PiScenePriorityCandidate): string {
    return `${candidate.campaign_id}\u0000${candidate.scene_id}`;
  }

  private scenePriorityState(candidate: PiScenePriorityCandidate): {
    key: string;
    state: ScenePriorityDispatchState;
  } {
    const key = this.scenePriorityStateKey(candidate);
    const existing = this.scenePriorityStates.get(key);
    if (existing !== undefined) return { key, state: existing };
    const state: ScenePriorityDispatchState = {
      checking: false,
      activePacketId: null,
      materializeAttempts: 0,
      terminalPacketIds: new Set<string>(),
      completedPacketIds: new Set<string>(),
    };
    this.scenePriorityStates.set(key, state);
    return { key, state };
  }

  private autoDispatchDeps(): PiCoordinatorAutoDispatchDeps {
    const host = this.requireHost();
    return {
      enabled: () => host.coordinatorEnabled(),
      isCurrent: () => host.isCurrent(),
      activeManager: () => this.manager,
      manager: () => this.ensureManager(),
      launchContext: () => host.launchContext(),
      audit: (entry) => {
        try { host.appendAudit("coc-source-coordinator-auto-dispatch", entry); }
        catch { /* stale-generation audit is best effort */ }
      },
    };
  }

  private ensureManager(): CoordinatorDispatchManager {
    if (this.manager !== null) return this.manager;
    const host = this.requireHost();
    this.manager = host.createManager?.() ?? new CoordinatorDispatchManager(
      (task, context, signal) => host.launchCoordinator(task, context, signal),
      async (receipt, repairDiagnostics = []) => {
        if (!host.isCurrent()) {
          return {
            status: "session_closed",
            failure_class: "session_closed",
            ...(typeof receipt.packet_id === "string" && receipt.packet_id.trim()
              ? { dispatch_key: receipt.packet_id.trim() }
              : {}),
          };
        }
        this.recordRepairDiagnostics(repairDiagnostics);
        await this.refreshScenePriorityAfterTerminal(receipt);
        return host.projectTerminal(receipt);
      },
      (observation) => {
        try {
          host.appendAudit(
            "coc-source-coordinator-lifecycle",
            observation as unknown as JsonObject,
          );
        } catch { /* lifecycle audit is best effort */ }
      },
    );
    return this.manager;
  }

  async autoDispatch(
    toolName: string,
    value: unknown,
    options: PiCoordinatorAutoDispatchOptions = {},
  ): Promise<JsonObject | null> {
    return autoDispatchCoordinator(this.autoDispatchDeps(), toolName, value, options);
  }

  async submitManual(taskValue: unknown, signal?: AbortSignal): Promise<JsonObject> {
    const host = this.requireHost();
    if (!host.isCurrent()) {
      return { status: "session_closed", failure_class: "session_closed" };
    }
    let enabled: boolean;
    enabled = await host.coordinatorEnabled();
    if (!enabled) {
      throw new Error("Pi source coordinator is unavailable pending a real isolated lifecycle probe");
    }
    if (!host.isCurrent()) {
      return { status: "session_closed", failure_class: "session_closed" };
    }
    const task = validateCoordinatorTask(taskValue);
    const packet = asObject(task.packet, "coordinator packet");
    const key = nonEmpty(packet.packet_id, "packet_id");
    const launch = host.launchContext();
    if (!launch) throw new Error("active parent model is unavailable");
    if (resolve(nonEmpty(packet.workspace_root, "workspace_root")) !== resolve(launch.cwd)) {
      throw new Error("coordinator workspace drift");
    }
    if (!host.isCurrent()) {
      return {
        status: "session_closed",
        failure_class: "session_closed",
        dispatch_key: key,
      };
    }
    const submitted = await this.ensureManager().submit(task, launch, signal);
    this.audit("coc-source-coordinator-dispatch", submitted);
    return submitted;
  }

  observeCanonical(
    operation: string,
    params: JsonObject,
    value: unknown,
  ): boolean {
    const campaignId = canonicalReadinessCampaignId(params, value);
    let readiness = this.readiness.observeCanonical(operation, campaignId, value);
    if (operation === "state.move_scene") {
      this.readiness.observeMoveScene(campaignId, value);
      readiness = campaignId === null ? null : this.readiness.snapshot(campaignId);
    }
    if (readiness !== null) this.appendReadiness(readiness.campaign_id);
    if (operation === "session.resume" && campaignId !== null) {
      this.publishContext(campaignId, "canonical_resume");
    }
    return this.scheduleScenePriority(operation, params, value);
  }

  private recordRepairDiagnostics(
    diagnostics: readonly PiSourcePackRepairDiagnostic[],
  ): void {
    if (diagnostics.length === 0) return;
    this.readiness.recordRepairDiagnostics(diagnostics);
    this.audit("coc-semantic-readiness-repair", {
      schema_version: 1,
      contract_id: "coc.pi-semantic-readiness-repair-audit.v1",
      diagnostics: diagnostics.map((diagnostic) => structuredClone(diagnostic)),
    });
    for (const campaignId of new Set(diagnostics.map((row) => row.campaign_id))) {
      this.appendReadiness(campaignId);
      this.publishContext(campaignId, "repair_retry");
    }
  }

  private scenePriorityUnavailableContext(
    candidate: PiScenePriorityCandidate,
  ): JsonObject {
    return {
      schema_version: 1,
      status: "source_unavailable",
      hard_gate: false,
      scene_id: candidate.scene_id,
      current_scene_status: candidate.current_scene_status,
      source_specific_facts: "unestablished_or_campaign_local_only",
      exact_source_dependency: {
        status: "unresolved",
        keeper_action: "do_not_assert_or_improvise_source_specific_facts",
        applies_when: "the current player action depends on an exact authored fact for this scene",
        continuation: "settle only source-independent parts; await scene_priority_ready, then use its canonical source cards before settling the dependent fact",
      },
      coordinator_priority: "scene",
    };
  }

  private markScenePriorityUnavailable(
    candidate: PiScenePriorityCandidate,
    state: ScenePriorityDispatchState,
    failureClass: string,
  ): void {
    state.checking = false;
    state.activePacketId = null;
    this.publishContext(candidate.campaign_id, "scene_priority_waiting", {
      ...this.scenePriorityUnavailableContext(candidate),
      failure_class: failureClass,
    });
  }

  private trackScenePriorityRun(run: Promise<unknown>): void {
    this.scenePriorityRuns.add(run);
    void run.catch(() => {}).finally(() => this.scenePriorityRuns.delete(run));
  }

  private scenePriorityHostWorkRows(value: unknown): Array<{
    row: JsonObject;
    ready: boolean;
  }> {
    const envelope = objectOrNull(value);
    if (envelope?.ok !== true) return [];
    const data = objectOrNull(envelope.data);
    const sceneContext = objectOrNull(data?.scene_context);
    const candidates = [
      data,
      objectOrNull(data?.host_work),
      objectOrNull(data?.progressive),
      sceneContext,
      objectOrNull(sceneContext?.host_work),
      objectOrNull(sceneContext?.progressive),
    ].filter((candidate): candidate is JsonObject => candidate !== null);
    const rows: Array<{ row: JsonObject; ready: boolean }> = [];
    for (const candidate of candidates) {
      for (const field of ["requests", "ready_background_requests"]) {
        const values = candidate[field];
        if (!Array.isArray(values)) continue;
        for (const value of values) {
          const row = objectOrNull(value);
          if (row === null) continue;
          rows.push({
            row,
            ready: field === "ready_background_requests"
              || row.dispatch_state === "ready"
              || row.status === "ready",
          });
        }
      }
    }
    return rows;
  }

  private hasReadySectionSemanticWork(value: unknown): boolean {
    return this.scenePriorityHostWorkRows(value).some(({ row, ready }) => (
      ready && row.kind === "classify_sections"
    ));
  }

  private scenePriorityTaskPacketId(
    task: JsonObject,
    campaignId: string,
  ): string | null {
    try {
      const exactTask = validateCoordinatorTask(task);
      const packet = asObject(exactTask.packet, "coordinator packet");
      return packet.campaign_id === campaignId
        ? nonEmpty(packet.packet_id, "packet_id")
        : null;
    } catch {
      return null;
    }
  }

  private async submitScenePriorityTask(
    candidate: PiScenePriorityCandidate,
    task: JsonObject,
    stateKey: string,
    state: ScenePriorityDispatchState,
    packetId: string,
  ): Promise<void> {
    const host = this.requireHost();
    if (!host.isCurrent()) return;
    state.checking = false;
    state.activePacketId = packetId;
    this.scenePriorityPackets.set(packetId, {
      stateKey,
      campaignId: candidate.campaign_id,
      sceneId: candidate.scene_id,
    });
    let submission: JsonObject | null = null;
    try {
      submission = await this.autoDispatch("coc_invoke", { ok: true }, {
        exactTask: task,
        priority: "scene",
      });
    } catch {
      this.markScenePriorityUnavailable(candidate, state, "scene_priority_submit_failed");
      return;
    }
    if (!host.isCurrent()) return;
    if (
      state.activePacketId !== packetId
      && (
        state.completedPacketIds.has(packetId)
        || state.terminalPacketIds.has(packetId)
      )
    ) return;
    const terminal = objectOrNull(submission?.terminal_receipt);
    if (terminal !== null) {
      await this.refreshScenePriorityAfterTerminal(terminal);
      return;
    }
    if (
      submission === null
      || !["submitted", "pending", "activating", "retrying"].includes(
        String(submission.status ?? ""),
      )
    ) {
      this.markScenePriorityUnavailable(
        candidate,
        state,
        typeof submission?.failure_class === "string"
          ? submission.failure_class
          : "scene_priority_submit_failed",
      );
    }
  }

  private async refreshScenePriorityStatus(
    candidate: PiScenePriorityCandidate,
    stateKey: string,
    state: ScenePriorityDispatchState,
  ): Promise<void> {
    const host = this.requireHost();
    const params: JsonObject = {
      operation: "progressive.status",
      root: host.launchContext()?.cwd ?? "",
      campaign: candidate.campaign_id,
      arguments: {},
    };
    if (!params.root) {
      this.markScenePriorityUnavailable(candidate, state, "scene_priority_status_failed");
      return;
    }
    try {
      const status = await host.callCanonical(params);
      if (!host.isCurrent()) return;
      if (
        canonicalReadinessCampaignId(params, status) !== candidate.campaign_id
        || objectOrNull(status)?.ok !== true
      ) throw new Error("scene priority status was not canonical");
      this.observeCanonical("progressive.status", params, status);
      const refreshed = this.readiness.scenePriorityCandidate(candidate.campaign_id);
      const task = findAutoDispatchTask(status);
      const packetId = task === null
        ? null
        : this.scenePriorityTaskPacketId(task, candidate.campaign_id);
      if (refreshed === null || refreshed.scene_id !== candidate.scene_id) {
        state.checking = false;
        return;
      }
      if (task === null || packetId === null || !this.hasReadySectionSemanticWork(status)) {
        await this.materializeAndBrief(refreshed, stateKey, state);
        return;
      }
      if (
        state.terminalPacketIds.has(packetId)
        || state.completedPacketIds.has(packetId)
      ) {
        state.checking = false;
        return;
      }
      await this.submitScenePriorityTask(refreshed, task, stateKey, state, packetId);
    } catch {
      if (host.isCurrent()) {
        this.markScenePriorityUnavailable(candidate, state, "scene_priority_status_failed");
      }
    }
  }

  private async materializeAndBrief(
    candidate: PiScenePriorityCandidate,
    stateKey: string,
    state: ScenePriorityDispatchState,
  ): Promise<void> {
    const host = this.requireHost();
    const root = host.launchContext()?.cwd ?? "";
    if (!root || !host.isCurrent()) {
      this.markScenePriorityUnavailable(candidate, state, "scene_priority_materialize_failed");
      return;
    }
    let retryScheduled = false;
    try {
      state.materializeAttempts += 1;
      const materializeParams: JsonObject = {
        operation: "progressive.on_enter_scene",
        root,
        campaign: candidate.campaign_id,
        arguments: {
          scene_id: candidate.scene_id,
          decision_id: `pi-scene-materialize:${candidate.scene_id}`,
        },
      };
      const materialized = await host.callCanonical(materializeParams);
      if (!host.isCurrent()) return;
      if (objectOrNull(materialized)?.ok !== true) {
        const code = smallStringOrNull(objectOrNull(materialized)?.error && objectOrNull(objectOrNull(materialized)?.error)?.code);
        if (code === "stale_scene_id") {
          state.terminalPacketIds.add(`materialize:${candidate.scene_id}`);
          this.publishContext(candidate.campaign_id, "scene_priority_terminal", {
            ...this.scenePriorityUnavailableContext(candidate), failure_class: code,
          }, true);
          return;
        }
        throw new Error("scene materialization was not canonical");
      }
      this.observeCanonical("progressive.on_enter_scene", materializeParams, materialized);
      const task = findAutoDispatchTask(materialized);
      const packetId = task === null ? null : this.scenePriorityTaskPacketId(task, candidate.campaign_id);
      if (task !== null && packetId !== null && !state.terminalPacketIds.has(packetId)
        && !state.completedPacketIds.has(packetId)) {
        await this.submitScenePriorityTask(candidate, task, stateKey, state, packetId);
        return;
      }
      const sceneParams: JsonObject = {
        operation: "scene.context", root, campaign: candidate.campaign_id, arguments: {},
      };
      const scene = await host.callCanonical(sceneParams);
      if (!host.isCurrent()) return;
      if (objectOrNull(scene)?.ok !== true) {
        throw new Error("scene re-read was not canonical");
      }
      this.observeCanonical("scene.context", sceneParams, scene);
      const ready = this.readiness.snapshot(candidate.campaign_id);
      if (ready?.current_scene_projection.status !== "ready") {
        state.terminalPacketIds.add(`materialize:${candidate.scene_id}`);
        this.publishContext(candidate.campaign_id, "scene_priority_terminal", {
          ...this.scenePriorityUnavailableContext(candidate),
          failure_class: "scene_materialization_incomplete",
        }, true);
        return;
      }
      const secretsParams: JsonObject = {
        operation: "secrets.briefing", root, campaign: candidate.campaign_id,
        arguments: { scope: "active_scene", scene_id: candidate.scene_id },
      };
      const secrets = await host.callCanonical(secretsParams);
      if (!host.isCurrent()) return;
      if (objectOrNull(secrets)?.ok !== true) {
        throw new Error("scene briefing was not canonical");
      }
      this.observeCanonical("secrets.briefing", secretsParams, secrets);
      this.appendReadiness(candidate.campaign_id);
      this.publishContext(candidate.campaign_id, "scene_priority_ready", {
        schema_version: 1,
        status: "semantic_supply_ready",
        hard_gate: false,
        scene_id: candidate.scene_id,
        source_cards: [
          { operation: "scene.context", data: objectOrNull(scene)?.data },
          { operation: "secrets.briefing", data: objectOrNull(secrets)?.data },
        ],
      }, true);
    } catch {
      if (!host.isCurrent()) return;
      if (state.materializeAttempts < MATERIALIZE_MAX_ATTEMPTS) {
        retryScheduled = true;
        this.trackScenePriorityRun(this.materializeAndBrief(candidate, stateKey, state));
        return;
      }
      state.terminalPacketIds.add(`materialize:${candidate.scene_id}`);
      this.publishContext(candidate.campaign_id, "scene_priority_terminal", {
        ...this.scenePriorityUnavailableContext(candidate),
        failure_class: "scene_priority_materialize_failed",
      }, true);
    } finally {
      if (!retryScheduled) {
        state.checking = false;
        state.activePacketId = null;
      }
    }
  }

  private scheduleScenePriority(
    operation: string,
    params: JsonObject,
    value: unknown,
  ): boolean {
    if (!["state.move_scene", "scene.context", "session.resume"].includes(operation)) {
      return false;
    }
    const campaignId = canonicalReadinessCampaignId(params, value);
    if (campaignId === null) return false;
    const candidate = this.readiness.scenePriorityCandidate(campaignId);
    if (candidate === null) return false;
    const { key: stateKey, state } = this.scenePriorityState(candidate);
    if (state.terminalPacketIds.has(`materialize:${candidate.scene_id}`)) return false;
    const task = findAutoDispatchTask(value);
    const packetId = task === null
      ? null
      : this.scenePriorityTaskPacketId(task, candidate.campaign_id);
    const readyTask = task !== null
      && packetId !== null
      && this.hasReadySectionSemanticWork(value);
    if (
      packetId !== null
      && (
        state.terminalPacketIds.has(packetId)
        || state.completedPacketIds.has(packetId)
      )
    ) return readyTask;
    if (state.checking || state.activePacketId !== null) return readyTask;
    state.checking = true;
    this.publishContext(
      candidate.campaign_id,
      "scene_priority_waiting",
      this.scenePriorityUnavailableContext(candidate),
    );
    if (readyTask && task !== null && packetId !== null) {
      this.trackScenePriorityRun(this.submitScenePriorityTask(
        candidate, task, stateKey, state, packetId,
      ));
      return true;
    }
    this.trackScenePriorityRun(this.refreshScenePriorityStatus(
      candidate, stateKey, state,
    ));
    return false;
  }

  private async refreshScenePriorityAfterTerminal(receipt: JsonObject): Promise<void> {
    const host = this.requireHost();
    const packetId = typeof receipt.packet_id === "string"
      ? receipt.packet_id.trim()
      : "";
    const binding = this.scenePriorityPackets.get(packetId);
    if (!packetId || binding === undefined || !host.isCurrent()) return;
    const state = this.scenePriorityStates.get(binding.stateKey);
    if (state === undefined) return;
    state.checking = false;
    state.activePacketId = null;
    if (receipt.status !== "fulfilled") {
      state.terminalPacketIds.add(packetId);
      this.publishContext(binding.campaignId, "scene_priority_terminal", {
        schema_version: 1,
        status: "source_unavailable",
        hard_gate: false,
        scene_id: binding.sceneId,
        source_specific_facts: "unestablished_or_campaign_local_only",
        terminal_status: String(receipt.status ?? "failed"),
        ...(typeof receipt.failure_class === "string"
          ? { failure_class: receipt.failure_class }
          : {}),
      }, true);
      return;
    }
    const params: JsonObject = {
      operation: "progressive.status",
      root: host.launchContext()?.cwd ?? "",
      campaign: binding.campaignId,
      arguments: {},
    };
    if (!params.root) {
      state.terminalPacketIds.add(packetId);
      this.publishContext(binding.campaignId, "scene_priority_terminal", {
        schema_version: 1,
        status: "source_unavailable",
        hard_gate: false,
        scene_id: binding.sceneId,
        source_specific_facts: "unestablished_or_campaign_local_only",
        failure_class: "scene_priority_refresh_failed",
      }, true);
      return;
    }
    try {
      const status = await host.callCanonical(params);
      if (!host.isCurrent()) return;
      if (
        canonicalReadinessCampaignId(params, status) !== binding.campaignId
        || objectOrNull(status)?.ok !== true
      ) throw new Error("scene priority readiness refresh was not canonical");
      this.observeCanonical("progressive.status", params, status);
      state.completedPacketIds.add(packetId);
      await this.materializeAndBrief({
        campaign_id: binding.campaignId,
        scene_id: binding.sceneId,
        source_bound: true,
        current_scene_status: "missing",
      }, binding.stateKey, state);
    } catch {
      state.terminalPacketIds.add(packetId);
      this.publishContext(binding.campaignId, "scene_priority_terminal", {
        schema_version: 1,
        status: "source_unavailable",
        hard_gate: false,
        scene_id: binding.sceneId,
        source_specific_facts: "unestablished_or_campaign_local_only",
        failure_class: "scene_priority_refresh_failed",
      }, true);
    }
  }

  async shutdown(): Promise<void> {
    this.readiness.reset();
    this.scenePriorityRuns.clear();
    this.scenePriorityPackets.clear();
    this.scenePriorityStates.clear();
    this.continuedDispatches.clear();
    const manager = this.manager;
    this.manager = null;
    this.host = null;
    await manager?.shutdown();
  }
}

function preparePrivateCoordinatorTask(): {
  handshake: JsonObject;
  task: JsonObject;
} {
  const handshake = readPrivateHandshake();
  return { handshake, task: validateCoordinatorTask(handshake.task) };
}

export default function coordinatorExtension(pi: ExtensionAPI) {
  const { task: coordinatorTask } = preparePrivateCoordinatorTask();
  let used = false;
  let mcp: McpJsonlClient | null = null;
  let lifecycleController: AbortController | null = null;
  let activeLifecycle: Promise<JsonObject> | null = null;
  const leaves = new Set<ReturnType<typeof spawnPiChild>>();
  pi.registerTool({
    name: "coc_run_source_coordinator",
    label: "Run exact COC source lifecycle",
    description: "Claim once, run the exact repository-produced Pi leaf tasks, and exact-fulfill once.",
    parameters,
    async execute(_id: string, _params: JsonObject, signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) {
      if (used) throw new Error("coordinator lifecycle tool is single-use");
      used = true;
      mcp = new McpJsonlClient(ctx.cwd, ctx.sessionManager.getSessionId());
      const model = ctx.model;
      if (!model) throw new Error("coordinator parent model is unavailable");
      lifecycleController = new AbortController();
      const repairDiagnostics = new Map<string, PiSourcePackRepairDiagnostic>();
      const abortLifecycle = () => lifecycleController?.abort(signal?.reason ?? "coordinator_interrupted");
      if (signal?.aborted) abortLifecycle();
      else signal?.addEventListener("abort", abortLifecycle, { once: true });
      activeLifecycle = runCoordinatorLifecycle(coordinatorTask, {
        signal: lifecycleController.signal,
        call: (name, args, callSignal) => mcp!.callTool(name, args, callSignal),
        spawnLeaf: async (task, leafSignal) => {
          const run = spawnPiChild({
            role: "leaf",
            task,
            cwd: ctx.cwd,
            provider: nonEmpty(model.provider, "model.provider"),
            modelId: nonEmpty(model.id, "model.id"),
            thinking: pi.getThinkingLevel(),
            signal: leafSignal,
          });
          return collectLeafExecution(run, leaves, task);
        },
        onLeaseLifecycle: (observation) => {
          try { pi.appendEntry("coc-source-coordinator-lease-lifecycle", observation); }
          catch { /* private lifecycle audit is best effort */ }
        },
        onSourcePackRepairDiagnostic: (diagnostic) => {
          const key = [diagnostic.job_id, diagnostic.field_paths.join("|")].join("\u0000");
          repairDiagnostics.set(key, diagnostic);
          try { pi.appendEntry("coc-source-coordinator-repair-diagnostic", diagnostic); }
          catch { /* private repair audit is best effort */ }
        },
      });
      try {
        const lifecycleResult = await activeLifecycle;
        const privateResult = withPiPrivateRepairDiagnostics(
          lifecycleResult,
          [...repairDiagnostics.values()],
        );
        return {
          content: [{ type: "text", text: JSON.stringify(privateResult) }],
          details: privateResult,
        };
      } finally {
        signal?.removeEventListener("abort", abortLifecycle);
        activeLifecycle = null;
        lifecycleController = null;
      }
    },
  });
  pi.on("session_start", () => pi.setActiveTools(["coc_run_source_coordinator"]));
  pi.on("session_shutdown", async () => {
    lifecycleController?.abort("session_shutdown");
    await Promise.allSettled([...leaves].map((run) => run.terminate()));
    leaves.clear();
    await Promise.allSettled(activeLifecycle ? [activeLifecycle] : []);
    await mcp?.close();
    mcp = null;
  });
}

export const __private_test = { preparePrivateCoordinatorTask };
