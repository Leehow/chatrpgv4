import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  asObject,
  CoordinatorDispatchManager,
  exactKeys,
  loadSecrets,
  MAX_BYTES,
  McpJsonlClient,
  nonEmpty,
  rejectSecretDisclosure,
  safeEnv,
  spawnPiChild,
  validateCoordinatorTask,
  type ChildRun,
  type JsonObject,
  type PrivateLaunchContext,
} from "../lib/runtime.ts";
import { compactToolRenderers } from "../lib/tool-render.ts";
import { registerCocHud } from "../lib/hud.ts";
import { registerCocWelcome } from "../lib/welcome.ts";

const emptySchema = { type: "object", properties: {}, additionalProperties: false } as const;
const OCR_TIMEOUT_MS = 15 * 60 * 1000;
const discoverSchema = { type: "object", properties: { operation: { type: "string" }, domain: { type: "string" } }, additionalProperties: false } as const;
const invokeSchema = {
  type: "object",
  properties: { operation: { type: "string", minLength: 1 }, root: { type: "string" }, campaign: { type: "string" }, arguments: { type: "object", additionalProperties: true } },
  required: ["operation"], additionalProperties: false,
} as const;
const dispatchSchema = { type: "object", properties: { task: { type: "object", additionalProperties: true } }, required: ["task"], additionalProperties: false } as const;
const PRIVATE_LEASE_OPERATIONS = new Set([
  "progressive.renew_host_work_leases",
  "progressive.release_host_work_leases",
]);
const ocrSchema = {
  type: "object",
  properties: {
    operation: { type: "string", enum: ["status", "fast", "enhance", "export"] },
    source_path: { type: "string" }, corpus_path: { type: "string" },
    pages: { type: "array", maxItems: 48, items: { type: "integer", minimum: 0 } },
    output_path: { type: "string" }, quality: { type: "string", enum: ["best", "fast", "detail"] },
  },
  required: ["operation"], additionalProperties: false,
} as const;

function result(value: JsonObject) { return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value }; }
type AssistantContentPart = { type: string; [key: string]: unknown };
type AssistantContentMessage = { role: "assistant"; content: AssistantContentPart[] };

function assistantContentMessage(value: unknown): AssistantContentMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as { role?: unknown; content?: unknown };
  if (message.role !== "assistant" || !Array.isArray(message.content)) return null;
  if (message.content.some((part) => !part || typeof part !== "object" || typeof (part as { type?: unknown }).type !== "string")) return null;
  return message as AssistantContentMessage;
}

function visibleAssistantText(message: AssistantContentMessage): string | null {
  const texts = message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string);
  return texts.length > 0 ? texts.join("") : null;
}

function canonicalJsonValueSha256(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("canonical JSON value is not serializable");
  }
  return `sha256:${createHash("sha256").update(encoded, "utf8").digest("hex")}`;
}

function withoutAssistantText<T>(message: T): T {
  const assistant = assistantContentMessage(message);
  if (!assistant) return message;
  return {
    ...(message as object),
    content: assistant.content.filter((part) => part.type !== "text"),
  } as T;
}

function withExactAssistantText<T>(message: T, exactText: string): T {
  const assistant = assistantContentMessage(message);
  if (!assistant) return message;
  let inserted = false;
  const content: AssistantContentPart[] = [];
  for (const part of assistant.content) {
    if (part.type !== "text") {
      content.push(part);
      continue;
    }
    if (inserted) continue;
    content.push({ type: "text", text: exactText });
    inserted = true;
  }
  if (!inserted) content.push({ type: "text", text: exactText });
  return {
    ...(message as object),
    content,
  } as T;
}

function hideUnsettledAssistantText(message: unknown): void {
  const assistant = assistantContentMessage(message);
  if (!assistant) return;
  assistant.content = assistant.content.filter((part) => part.type !== "text");
}

// Pi emits extensions before TUI listeners. Streaming events contain shallow
// message copies, so hiding their text delays it at the player boundary without
// altering the provider's accumulated response. A tool-free final message is
// rendered normally unless a same-epoch finalizer receipt exact-replaces it;
// a tool-bearing final message keeps only non-text parts so its framing never
// enters the transcript or later model context.
type VisibleAssistantDisposition =
  | "operational_wait"
  | "independent"
  | "projected_opening"
  | "terminal_blocker";
type VisibleAssistantFinalDecision =
  | boolean
  | { replacementText: string };
type QueuedVisibleAssistantDisposition = {
  disposition: VisibleAssistantDisposition;
  dispatchKey?: string;
};

export class OpeningTerminalContinuationGate {
  private readonly states = new Map<string, "awaiting" | "projected" | "published">();
  private readonly dispatchClasses = new Map<
    string,
    "blocking_opening" | "nonblocking_background"
  >();
  private readonly pending = new Map<string, {
    promise: Promise<boolean>;
    resolve: (shouldWake: boolean) => void;
  }>();
  private readonly synchronousOpeningWaits = new Set<string>();
  private agentActive = false;
  private queuedVisibleDispositions: QueuedVisibleAssistantDisposition[] = [];
  private playerTurnEpoch = 0;
  private finalizedOutput: {
    epoch: number;
    renderedText: string;
    renderedSha256: string;
    delivered: boolean;
  } | null = null;
  private nonblockingContinuation: {
    epoch: number;
    dispatchKey: string;
    renderedSha256: string;
  } | null = null;

  trackOpeningDispatch(dispatchKey: string): void {
    if (dispatchKey) {
      this.states.set(dispatchKey, "awaiting");
      // The key comes from the structured opening_bootstrap takeover packet,
      // so later terminal continuations can distinguish this blocking opening
      // from an unrelated background coordinator completion.
      this.dispatchClasses.set(dispatchKey, "blocking_opening");
    }
  }

  beginSynchronousOpeningWait(dispatchKey: string): void {
    this.trackOpeningDispatch(dispatchKey);
    if (dispatchKey) {
      this.synchronousOpeningWaits.add(dispatchKey);
      this.queueVisibleAssistantDisposition("operational_wait", dispatchKey);
    }
  }

  endSynchronousOpeningWait(dispatchKey: string): void {
    this.synchronousOpeningWaits.delete(dispatchKey);
  }

  cancelSynchronousOpeningWait(dispatchKey: string): void {
    this.synchronousOpeningWaits.delete(dispatchKey);
    if (this.states.get(dispatchKey) === "awaiting") {
      // "published" is the consumed terminal-wake marker. A late child
      // terminal sees it and cannot create a new provider turn.
      this.states.set(dispatchKey, "published");
    }
    this.queuedVisibleDispositions = this.queuedVisibleDispositions.filter(
      (queued) => !(
        queued.dispatchKey === dispatchKey
        && (
          queued.disposition === "operational_wait"
          || queued.disposition === "terminal_blocker"
        )
      ),
    );
  }

  markSynchronousOpeningTerminalConsumed(dispatchKey: string): void {
    if (this.states.get(dispatchKey) === "awaiting") {
      this.states.set(dispatchKey, "published");
    }
  }

  queueVisibleAssistantDisposition(
    disposition: VisibleAssistantDisposition,
    dispatchKey?: string,
  ): void {
    const queued = { disposition, dispatchKey };
    if (disposition === "operational_wait") {
      this.queuedVisibleDispositions.push(queued);
    } else {
      this.queuedVisibleDispositions.unshift(queued);
    }
  }

  markAgentStart(): void {
    this.agentActive = true;
  }

  markOpeningProjected(dispatchKey?: string): void {
    for (const [key, state] of this.states) {
      if (
        state === "awaiting"
        && (dispatchKey === undefined || key === dispatchKey)
      ) {
        this.states.set(key, "projected");
      }
    }
    this.queuedVisibleDispositions = this.queuedVisibleDispositions.filter(
      (queued) => !(
        queued.disposition === "operational_wait"
        && (
          dispatchKey === undefined
          || queued.dispatchKey === dispatchKey
        )
      ),
    );
    this.queueVisibleAssistantDisposition("projected_opening", dispatchKey);
  }

  markIndependentVisibleOutput(): void {
    if ([...this.states.values()].some((state) => state === "awaiting")) {
      this.queueVisibleAssistantDisposition("independent");
    }
  }

  markTerminalBlocker(dispatchKey?: string): void {
    // A structured blocking terminal is always player-visible. It may arrive
    // after an unrelated nonblocking wake was queued, so revoke that narrow
    // suppression token instead of globally hiding later assistant output.
    this.nonblockingContinuation = null;
    if ([...this.states].some(([key, state]) => (
      state === "awaiting"
      && (dispatchKey === undefined || key === dispatchKey)
    ))) {
      this.queuedVisibleDispositions = this.queuedVisibleDispositions.filter(
        (queued) => !(
          queued.disposition === "operational_wait"
          && (
            dispatchKey === undefined
            || queued.dispatchKey === dispatchKey
          )
        ),
      );
      if (!this.queuedVisibleDispositions.some((queued) => (
        queued.disposition === "terminal_blocker"
        && (
          dispatchKey === undefined
          || queued.dispatchKey === dispatchKey
        )
      ))) {
        this.queueVisibleAssistantDisposition(
          "terminal_blocker",
          dispatchKey,
        );
      }
    }
  }

  markFinalizedOutputReady(
    renderedText: string,
    renderedSha256: string,
  ): boolean {
    if (
      !renderedText
      || renderedSha256 !== canonicalJsonValueSha256(renderedText)
    ) {
      return false;
    }
    this.finalizedOutput = {
      epoch: this.playerTurnEpoch,
      renderedText,
      renderedSha256,
      delivered: false,
    };
    return true;
  }

  markExternalUserInput(): void {
    this.playerTurnEpoch += 1;
    this.finalizedOutput = null;
    this.nonblockingContinuation = null;
  }

  coordinatorContinuationContext(
    dispatchKey: string,
    terminalStatus: string,
  ): JsonObject {
    const dispatchClass = this.dispatchClasses.get(dispatchKey)
      ?? "nonblocking_background";
    const finalized = this.finalizedOutput;
    // Terminal publication may race ahead of the exact assistant message_end.
    // Carry the armed provenance into Pi's queued followUp now; the consumer
    // below still refuses to arm suppression until that exact output has
    // actually been delivered in the same user epoch.
    if (
      dispatchClass === "nonblocking_background"
      && terminalStatus === "fulfilled"
      && finalized !== null
      && finalized.epoch === this.playerTurnEpoch
    ) {
      return {
        continuation_class: "nonblocking_background_after_finalized_output",
        dispatch_class: dispatchClass,
        player_turn_epoch: finalized.epoch,
        finalized_rendered_sha256: finalized.renderedSha256,
        dispatch_key: dispatchKey,
      };
    }
    return {
      continuation_class: dispatchClass,
      dispatch_class: dispatchClass,
      player_turn_epoch: this.playerTurnEpoch,
      dispatch_key: dispatchKey,
    };
  }

  observeMessageStart(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const value = message as {
      role?: unknown;
      customType?: unknown;
      details?: unknown;
    };
    if (value.role === "user") {
      this.markExternalUserInput();
      return;
    }
    if (
      value.role !== "custom"
      || value.customType
        !== "coc-source-coordinator-terminal-continuation"
      || !value.details
      || typeof value.details !== "object"
      || Array.isArray(value.details)
    ) {
      return;
    }
    const details = value.details as JsonObject;
    const finalized = this.finalizedOutput;
    if (
      details.continuation_class
        !== "nonblocking_background_after_finalized_output"
      || details.dispatch_class !== "nonblocking_background"
      || !Number.isInteger(details.player_turn_epoch)
      || details.player_turn_epoch !== this.playerTurnEpoch
      || typeof details.dispatch_key !== "string"
      || !details.dispatch_key
      || typeof details.finalized_rendered_sha256 !== "string"
      || finalized?.delivered !== true
      || finalized.epoch !== this.playerTurnEpoch
      || finalized.renderedSha256 !== details.finalized_rendered_sha256
    ) {
      return;
    }
    this.nonblockingContinuation = {
      epoch: this.playerTurnEpoch,
      dispatchKey: details.dispatch_key,
      renderedSha256: finalized.renderedSha256,
    };
  }

  acceptVisibleAssistantFinal(
    visibleText: string,
  ): VisibleAssistantFinalDecision {
    // Only the transcript gate's confirmed tool-free assistant final reaches
    // this method. Streaming starts/updates and tool-bearing finals cannot
    // consume host provenance.
    const disposition = this.queuedVisibleDispositions.shift()?.disposition;
    if (disposition === "projected_opening") {
      for (const [key, state] of this.states) {
        if (state === "projected") this.states.set(key, "published");
      }
    }
    if (disposition !== undefined) {
      this.nonblockingContinuation = null;
    }
    const finalized = this.finalizedOutput;
    const visibleSha256 = canonicalJsonValueSha256(visibleText);
    if (
      finalized?.delivered === false
      && finalized.epoch === this.playerTurnEpoch
    ) {
      finalized.delivered = true;
      if (
        finalized.renderedText === visibleText
        && finalized.renderedSha256 === visibleSha256
      ) {
        return true;
      }
      return { replacementText: finalized.renderedText };
    }
    if (disposition === "operational_wait") {
      return false;
    }
    if (
      disposition === undefined
      && finalized?.delivered === true
      && finalized.epoch === this.playerTurnEpoch
    ) {
      // Once the same-epoch finalizer receipt has been delivered, no
      // tool-free model chatter may create a second player output. A new real
      // user message clears the receipt; explicit host dispositions such as a
      // blocking opening failure remain independently visible.
      this.nonblockingContinuation = null;
      return false;
    }
    const continuation = this.nonblockingContinuation;
    if (
      disposition === undefined
      && continuation?.epoch === this.playerTurnEpoch
      && finalized?.delivered === true
      && finalized.epoch === this.playerTurnEpoch
      && finalized.renderedSha256 === continuation.renderedSha256
    ) {
      this.nonblockingContinuation = null;
      return false;
    }
    return true;
  }

  markAgentEnd(): void {
    this.agentActive = false;
    for (const [key, decision] of this.pending) {
      decision.resolve(this.states.get(key) !== "published");
      this.pending.delete(key);
      this.states.delete(key);
    }
  }

  decideWake(dispatchKey: string): boolean | Promise<boolean> {
    // A blocking opening whose original coc_invoke call is still waiting owns
    // the provider continuation. Publishing its durable terminal receipt must
    // never create a competing hidden follow-up turn.
    if (this.synchronousOpeningWaits.has(dispatchKey)) return false;
    const state = this.states.get(dispatchKey);
    if (state === "published") {
      this.states.delete(dispatchKey);
      return false;
    }
    if (
      (state !== "awaiting" && state !== "projected")
      || !this.agentActive
    ) {
      this.states.delete(dispatchKey);
      return true;
    }
    const existing = this.pending.get(dispatchKey);
    if (existing) return existing.promise;
    let resolveDecision!: (shouldWake: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      resolveDecision = resolve;
    });
    this.pending.set(dispatchKey, { promise, resolve: resolveDecision });
    return promise;
  }

  reset(): void {
    this.agentActive = false;
    this.queuedVisibleDispositions = [];
    this.playerTurnEpoch = 0;
    this.finalizedOutput = null;
    this.nonblockingContinuation = null;
    for (const decision of this.pending.values()) decision.resolve(false);
    this.pending.clear();
    this.synchronousOpeningWaits.clear();
    this.states.clear();
    this.dispatchClasses.clear();
  }
}

export function registerPlayerTranscriptGate(
  pi: ExtensionAPI,
  onVisibleAssistantFinal?: (
    visibleText: string,
  ) => VisibleAssistantFinalDecision | void,
  onMessageStart?: (message: unknown) => void,
): void {
  pi.on("message_start", (event) => {
    onMessageStart?.(event.message);
    hideUnsettledAssistantText(event.message);
  });
  pi.on("message_update", (event) => {
    hideUnsettledAssistantText(event.message);
  });
  pi.on("message_end", (event) => {
    const assistant = assistantContentMessage(event.message);
    if (!assistant) return;
    if (!assistant.content.some((part) => part.type === "toolCall")) {
      const visibleText = visibleAssistantText(assistant);
      if (visibleText !== null) {
        const decision = onVisibleAssistantFinal?.(visibleText);
        if (decision === false) {
          return { message: withoutAssistantText(event.message) };
        }
        if (
          decision
          && typeof decision === "object"
          && typeof decision.replacementText === "string"
        ) {
          return {
            message: withExactAssistantText(
              event.message,
              decision.replacementText,
            ),
          };
        }
      }
      return;
    }
    return { message: withoutAssistantText(event.message) };
  });
}

export async function publishCoordinatorTerminal(
  pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage">,
  receipt: JsonObject,
  continuedDispatches: Set<string>,
  decideWake: (dispatchKey: string) => boolean | Promise<boolean> = () => true,
  continuationContext?: (
    dispatchKey: string,
    terminalStatus: string,
  ) => JsonObject,
): Promise<JsonObject> {
  let appendStatus = "delivered";
  try { pi.appendEntry("coc-source-coordinator-terminal", receipt); }
  catch { appendStatus = "failed"; }
  const dispatchKey = typeof receipt.packet_id === "string" ? receipt.packet_id.trim() : "";
  const terminalStatus = typeof receipt.status === "string" ? receipt.status.trim() : "";
  let continuationStatus = "failed";
  if (dispatchKey && terminalStatus) {
    if (continuedDispatches.has(dispatchKey)) continuationStatus = "deduplicated";
    else {
      const context = continuationContext?.(dispatchKey, terminalStatus);
      const structuredNonblocking = (
        context?.dispatch_class === "nonblocking_background"
        && (
          context?.continuation_class === "nonblocking_background"
          || context?.continuation_class
            === "nonblocking_background_after_finalized_output"
        )
      );
      const structuredBlockingOpening = (
        context?.dispatch_class === "blocking_opening"
        && context?.continuation_class === "blocking_opening"
      );
      if (!structuredBlockingOpening) {
        continuedDispatches.add(dispatchKey);
        continuationStatus = structuredNonblocking
          ? "suppressed_nonblocking"
          : "suppressed_unclassified";
      } else {
        const shouldWake = await decideWake(dispatchKey);
        if (continuedDispatches.has(dispatchKey)) continuationStatus = "deduplicated";
        else if (!shouldWake) {
          continuedDispatches.add(dispatchKey);
          continuationStatus = "suppressed_consumed";
        }
        else {
          try {
            const failureClass = typeof receipt.failure_class === "string"
              ? receipt.failure_class.trim()
              : null;
            const notice = {
              dispatch_key: dispatchKey,
              status: terminalStatus,
              terminal: true,
              failure_class: failureClass,
              automatic_retry_remaining: false,
              ...(context ?? {}),
            };
            // Only a structured blocking opening creates a model turn.
            // Ordinary background and unclassified terminals remain durable
            // audit entries for the next natural turn.
            pi.sendMessage({
              customType: "coc-source-coordinator-terminal-continuation",
              content: JSON.stringify(notice),
              display: false,
              details: notice,
            }, { triggerTurn: true, deliverAs: "followUp" });
            continuedDispatches.add(dispatchKey);
            continuationStatus = "delivered";
          } catch { continuationStatus = "failed"; }
        }
      }
    }
  }
  const status = appendStatus === "delivered" && continuationStatus !== "failed"
    ? "delivered"
    : appendStatus === "failed" && continuationStatus === "failed" ? "failed" : "partial";
  return {
    status,
    append_entry: appendStatus,
    hidden_continuation: continuationStatus,
    player_transcript: "suppressed",
    ...(appendStatus === "failed" ? { append_failure_class: "append_entry_failed" } : {}),
    ...(continuationStatus === "failed" ? { continuation_failure_class: "hidden_continuation_failed" } : {}),
  };
}
function absolute(value: unknown, label: string) {
  const path = nonEmpty(value, label);
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  return resolve(path);
}

async function piCoordinatorEnabled(): Promise<boolean> {
  const document = asObject(JSON.parse(await readFile(fileURLToPath(new URL("../../references/host-capabilities.json", import.meta.url)), "utf8")), "host capabilities");
  return asObject(document.pi, "Pi capabilities").coc_source_coordinator_v1 === true;
}

function objectOrNull(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function findAutoDispatchTask(value: unknown): JsonObject | null {
  const envelope = objectOrNull(value);
  if (envelope?.ok !== true) return null;
  const data = objectOrNull(envelope?.data);
  const sourceWork = objectOrNull(data?.source_work);
  const progressive = objectOrNull(data?.progressive);
  const sceneContext = objectOrNull(data?.scene_context);
  const resumeProgressive = objectOrNull(sceneContext?.progressive);
  const candidates = [
    // progressive.opening_bootstrap nests its production takeover one level
    // below source_work; no other producer may claim this named path.
    {
      takeover: objectOrNull(sourceWork?.background_takeover),
      allowed: envelope.tool === "progressive.opening_bootstrap",
    },
    { takeover: objectOrNull(data?.background_takeover), allowed: true },
    { takeover: objectOrNull(progressive?.background_takeover), allowed: true },
    { takeover: objectOrNull(resumeProgressive?.background_takeover), allowed: true },
  ];
  // Multiple named takeover paths are contamination, even when they repeat an
  // otherwise valid task. Validation and dispatch-key dedupe remain downstream.
  const present = candidates.filter((candidate) => candidate.takeover !== null);
  if (present.length !== 1 || !present[0].allowed) return null;
  const action = objectOrNull(present[0].takeover?.next_host_action);
  const task = objectOrNull(action?.task);
  return action?.action === "invoke_coc_dispatch_source_work"
    && task?.contract_id === "coc.pi-source-coordinator-task.v1"
    ? task
    : null;
}

interface AutoDispatchDeps {
  enabled(): Promise<boolean>;
  isCurrent(): boolean;
  activeManager(): CoordinatorDispatchManager | null;
  manager(): CoordinatorDispatchManager;
  launchContext(): PrivateLaunchContext | null;
  audit(entry: JsonObject): void;
}

interface AutoDispatchOptions {
  waitForTerminal?: boolean;
  signal?: AbortSignal;
}

// Toolbox results may carry a background_takeover whose next_host_action asks
// the KP to call coc_dispatch_source_work. Fulfillment must not depend on KP
// discipline, so the host submits that exact task itself. Ordinary source
// deepening remains fire-and-forget; only the exact blocking opening path asks
// this owner to await its durable terminal state.
async function autoDispatchCoordinator(
  deps: AutoDispatchDeps,
  toolName: string,
  value: unknown,
  options: AutoDispatchOptions = {},
): Promise<JsonObject | null> {
  if (toolName !== "coc_invoke") return null;
  const task = findAutoDispatchTask(value);
  if (!task) return null;
  const boundedFailure = (entry: JsonObject): JsonObject => {
    deps.audit(entry);
    return entry;
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
      if (options.waitForTerminal) return boundedFailure(unavailable);
      return null;
    }
  }
  catch {
    return boundedFailure(deps.isCurrent()
      ? { status: "capability_check_failed", failure_class: "capability_check_failed" }
      : { status: "session_closed", failure_class: "session_closed" });
  }
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
  if (active?.state(key)) {
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
  const ownedManager = deps.manager();
  let submitted: JsonObject;
  try {
    submitted = await ownedManager.submit(
      exactTask,
      launch,
      options.signal,
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

function blockingOpeningProjectionCall(
  originalParams: JsonObject,
  bootstrapValue: unknown,
): JsonObject {
  const envelope = asObject(bootstrapValue, "opening bootstrap result");
  const data = asObject(envelope.data, "opening bootstrap data");
  const start = asObject(data.start_location, "opening start_location");
  const pages = data.opening_pdf_indices;
  if (
    !Array.isArray(pages)
    || pages.length === 0
    || pages.some((page) => !Number.isInteger(page) || (page as number) < 0)
  ) {
    throw new Error("opening bootstrap returned invalid opening_pdf_indices");
  }
  return {
    operation: "progressive.project_opening",
    ...(typeof originalParams.root === "string"
      ? { root: originalParams.root }
      : {}),
    ...(typeof originalParams.campaign === "string"
      ? { campaign: originalParams.campaign }
      : {}),
    arguments: {
      asset_root_id: nonEmpty(data.asset_root_id, "opening asset_root_id"),
      source_file_sha256: nonEmpty(
        data.source_file_sha256,
        "opening source_file_sha256",
      ),
      start_location_id: nonEmpty(
        start.location_id,
        "opening start_location.location_id",
      ),
      opening_pdf_indices: [...pages],
    },
  };
}

function resolvedBlockingOpeningEnvelope(
  bootstrapValue: unknown,
  terminalState: JsonObject,
  projectionValue: unknown,
): JsonObject {
  const bootstrap = asObject(bootstrapValue, "opening bootstrap result");
  const bootstrapData = asObject(
    bootstrap.data,
    "opening bootstrap data",
  );
  const sourceWork = objectOrNull(bootstrapData.source_work) ?? {};
  const {
    background_takeover: _consumedTakeover,
    ...terminalSourceWork
  } = sourceWork;
  const projection = asObject(projectionValue, "opening projection result");
  const projectionData = asObject(
    projection.data,
    "opening projection data",
  );
  return {
    ...bootstrap,
    data: {
      ...bootstrapData,
      status: projectionData.status,
      source_dependency_terminal: true,
      source_work: {
        ...terminalSourceWork,
        status: "fulfilled",
        terminal: true,
      },
      coordinator_terminal: terminalState,
      opening_projection: projectionData,
    },
  };
}

function failedBlockingOpeningEnvelope(
  terminalState: JsonObject,
  code = "opening_source_terminal_failure",
): JsonObject {
  return {
    ok: false,
    tool: "progressive.opening_bootstrap",
    error: {
      code,
      message: "blocking opening source dependency did not produce a current projection",
    },
    data: {
      status: "terminal_failure",
      source_dependency_terminal: true,
      projection_ready: false,
      activation_allowed: false,
      coordinator_terminal: terminalState,
    },
  };
}

async function runOcr(params: JsonObject, signal?: AbortSignal): Promise<JsonObject> {
  exactKeys(params, ["operation", "source_path", "corpus_path", "pages", "output_path", "quality"], "OCR request");
  const operation = nonEmpty(params.operation, "operation");
  if (!["status", "fast", "enhance", "export"].includes(operation)) throw new Error("unsupported OCR operation");
  const configured = process.env.COC_PROGRESSIVE_OCR_COMMAND;
  if (!configured || !isAbsolute(configured)) throw new Error("COC_PROGRESSIVE_OCR_COMMAND must be an absolute executable or script");
  const pages = params.pages ?? [];
  if (!Array.isArray(pages) || pages.length > 48 || pages.some((value) => !Number.isInteger(value) || (value as number) < 0) || new Set(pages).size !== pages.length) throw new Error("pages must be unique non-negative indices");
  let command = configured;
  const args: string[] = [];
  if (configured.endsWith(".py")) { command = process.env.COC_PROGRESSIVE_OCR_PYTHON || "python"; args.push(configured); }
  args.push(operation);
  if (operation === "fast") args.push(absolute(params.source_path, "source_path"), "--corpus", absolute(params.corpus_path, "corpus_path"));
  else args.push(absolute(params.corpus_path, "corpus_path"));
  if ((operation === "enhance" || operation === "export") && pages.length) args.push("--pages", pages.join(","));
  if (operation === "export") args.push("--quality", typeof params.quality === "string" ? params.quality : "best", "--output", absolute(params.output_path, "output_path"));
  const envFile = process.env.COC_KEEPER_ENV_FILE || join(homedir(), ".config", "coc-keeper", "secrets.env");
  const secrets = await loadSecrets(envFile);
  if (!secrets.BAIDUOCR_TOKEN && !["status", "export"].includes(operation)) throw new Error("OCR credential BAIDUOCR_TOKEN is not configured");
  const child = spawn(command, args, { cwd: process.cwd(), shell: false, stdio: ["ignore", "pipe", "pipe"], env: safeEnv(secrets) });
  let stdout = "";
  let stderrBytes = 0;
  const code = await new Promise<number | null>((resolveClose, rejectClose) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { child.kill("SIGTERM"); } catch { /* already closed */ }
      rejectClose(error);
    };
    const abort = () => fail(new Error(`OCR ${operation} aborted`));
    timer = setTimeout(
      () => fail(new Error(`OCR ${operation} timed out; child output redacted`)),
      OCR_TIMEOUT_MS,
    );
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > MAX_BYTES) fail(new Error(`OCR ${operation} failed; child output redacted`));
    });
    child.stderr.on("data", (chunk) => {
      if (settled) return;
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_BYTES) fail(new Error(`OCR ${operation} failed; child output redacted`));
    });
    child.once("error", fail);
    child.once("close", (closeCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveClose(closeCode);
    });
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
  if (code !== 0) throw new Error(`OCR ${operation} failed; child output redacted`);
  let parsed: JsonObject;
  try { parsed = asObject(JSON.parse(stdout.trim()), "OCR result"); }
  catch { throw new Error("OCR command must return one strict JSON object"); }
  rejectSecretDisclosure(parsed, secrets);
  if (params.source_path && parsed.source && typeof parsed.source === "object") {
    const returned = (parsed.source as JsonObject).path;
    if (returned && resolve(String(returned)) !== resolve(String(params.source_path))) throw new Error("OCR source identity drift");
  }
  return parsed;
}

interface MainExtensionOverrides {
  coordinatorEnabled?: () => Promise<boolean>;
  createClient?: (ctx: ExtensionContext) => McpJsonlClient;
  createManager?: () => CoordinatorDispatchManager;
  launchCoordinator?: (
    task: JsonObject,
    context: PrivateLaunchContext,
    signal?: AbortSignal,
  ) => ChildRun;
}

export default function mainExtension(pi: ExtensionAPI, overrides: MainExtensionOverrides = {}) {
  let mcp: McpJsonlClient | null = null;
  let manager: CoordinatorDispatchManager | null = null;
  let sessionEpoch = 0;
  let sessionClosing = true;
  let continuedCoordinatorDispatches = new Set<string>();
  const openingContinuationGate = new OpeningTerminalContinuationGate();
  const isCurrent = (epoch: number) => !sessionClosing && epoch === sessionEpoch;
  const sessionClosed = (dispatchKey?: string): JsonObject => ({
    status: "session_closed",
    failure_class: "session_closed",
    ...(dispatchKey ? { dispatch_key: dispatchKey } : {}),
  });
  const client = (ctx: ExtensionContext) => mcp ??= (
    overrides.createClient?.(ctx)
    ?? new McpJsonlClient(ctx.cwd, ctx.sessionManager.getSessionId(), ctx.mode === "tui")
  );
  const coordinatorManager = (epoch: number) => {
    if (!isCurrent(epoch)) throw new Error("Pi source coordinator session is closed");
    const ownedContinuedDispatches = continuedCoordinatorDispatches;
    return manager ??= overrides.createManager?.() ?? new CoordinatorDispatchManager(
    (exactTask, launch, launchSignal) => (
      overrides.launchCoordinator?.(exactTask, launch, launchSignal)
      ?? spawnPiChild({
        role: "coordinator", task: exactTask,
        ...launch, signal: launchSignal,
      })
    ),
    (receipt) => {
      const dispatchKey = typeof receipt.packet_id === "string"
        ? receipt.packet_id.trim()
        : "";
      const terminalStatus = typeof receipt.status === "string"
        ? receipt.status.trim()
        : "";
      const continuationContext = (
        openingContinuationGate.coordinatorContinuationContext(
          dispatchKey,
          terminalStatus,
        )
      );
      if (
        continuationContext.dispatch_class === "blocking_opening"
        && receipt.status !== "fulfilled"
      ) {
        openingContinuationGate.markTerminalBlocker(dispatchKey);
      }
      return publishCoordinatorTerminal(
        pi,
        receipt,
        ownedContinuedDispatches,
        (dispatchKey) => openingContinuationGate.decideWake(dispatchKey),
        () => continuationContext,
      );
    },
    (observation) => {
      try { pi.appendEntry("coc-source-coordinator-lifecycle", observation); }
      catch { /* lifecycle audit is best effort */ }
    },
  );
  };
  const autoDispatchDeps = (ctx: ExtensionContext, epoch: number): AutoDispatchDeps => ({
    enabled: overrides.coordinatorEnabled ?? piCoordinatorEnabled,
    isCurrent: () => isCurrent(epoch),
    activeManager: () => manager,
    manager: () => coordinatorManager(epoch),
    launchContext: () => {
      const model = ctx.model;
      if (!model) return null;
      try {
        return {
          cwd: ctx.cwd,
          provider: nonEmpty(model.provider, "model.provider"),
          modelId: nonEmpty(model.id, "model.id"),
          thinking: pi.getThinkingLevel(),
        };
      } catch { return null; }
    },
    audit: (entry) => { try { pi.appendEntry("coc-source-coordinator-auto-dispatch", entry); } catch { /* audit is best effort */ } },
  });
  const gateway = (name: string) => async (_id: string, params: JsonObject, signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) => {
    const epoch = sessionEpoch;
    if (name === "coc_invoke" && PRIVATE_LEASE_OPERATIONS.has(String(params.operation))) {
      try {
        pi.appendEntry("coc-source-coordinator-private-boundary", {
          status: "rejected",
          failure_class: "private_lifecycle_operation",
        });
      } catch { /* private boundary audit is best effort */ }
      throw new Error("canonical operation is reserved for the private source coordinator lifecycle");
    }
    const value = await client(ctx).callTool(name, params, signal);
    if (name === "coc_invoke") {
      if (String(params.operation) === "progressive.opening_bootstrap") {
        const task = findAutoDispatchTask(value);
        const packet = task ? objectOrNull(task.packet) : null;
        const dispatchKey = typeof packet?.packet_id === "string"
          ? packet.packet_id.trim()
          : "";
        const bootstrapEnvelope = objectOrNull(value);
        const bootstrapData = objectOrNull(bootstrapEnvelope?.data);
        const bootstrapSourceWork = objectOrNull(
          bootstrapData?.source_work,
        );
        const bootstrapSourceStatus = String(
          bootstrapSourceWork?.status ?? bootstrapData?.status ?? "",
        );
        if (
          !dispatchKey
          && objectOrNull(bootstrapSourceWork?.background_takeover)
        ) {
          const contractViolation = {
            status: "contract_violation",
            failure_class: "coordinator_task_invalid",
          };
          try {
            pi.appendEntry(
              "coc-source-coordinator-auto-dispatch",
              contractViolation,
            );
          } catch { /* audit is best effort */ }
          throw new Error(
            "canonical opening bootstrap returned a malformed coordinator task",
          );
        }
        if (
          !dispatchKey
          && (
            bootstrapSourceStatus === "queued"
            || bootstrapSourceStatus === "coalesced"
          )
        ) {
          const contractViolation = {
            status: "contract_violation",
            failure_class: "opening_coordinator_task_missing",
            source_status: bootstrapSourceStatus,
          };
          try {
            pi.appendEntry(
              "coc-source-coordinator-auto-dispatch",
              contractViolation,
            );
          } catch { /* audit is best effort */ }
          throw new Error(
            "canonical opening bootstrap returned unresolved source work "
            + "without an exact coordinator task",
          );
        }
        if (dispatchKey) {
          openingContinuationGate.beginSynchronousOpeningWait(dispatchKey);
          let terminalState: JsonObject | null = null;
          try {
            terminalState = await autoDispatchCoordinator(
              autoDispatchDeps(ctx, epoch),
              name,
              value,
              { waitForTerminal: true, signal },
            );
          } catch {
            if (signal?.aborted) {
              openingContinuationGate.cancelSynchronousOpeningWait(
                dispatchKey,
              );
              return result(failedBlockingOpeningEnvelope(
                {
                  status: "terminal_failure",
                  failure_class: "coordinator_wait_cancelled",
                  dispatch_key: dispatchKey,
                },
                "opening_source_wait_cancelled",
              ));
            }
            openingContinuationGate.cancelSynchronousOpeningWait(dispatchKey);
            return result(failedBlockingOpeningEnvelope(
              {
                status: "terminal_failure",
                failure_class: "coordinator_terminal_wait_failed",
                dispatch_key: dispatchKey,
              },
              "opening_source_terminal_wait_failed",
            ));
          }
          if (signal?.aborted) {
            openingContinuationGate.cancelSynchronousOpeningWait(
              dispatchKey,
            );
            return result(failedBlockingOpeningEnvelope(
              {
                status: "terminal_failure",
                failure_class: "coordinator_wait_cancelled",
                dispatch_key: dispatchKey,
              },
              "opening_source_wait_cancelled",
            ));
          }
          openingContinuationGate.endSynchronousOpeningWait(dispatchKey);
          const terminalReceipt = objectOrNull(
            terminalState?.terminal_receipt,
          );
          const terminalNotification = objectOrNull(
            terminalState?.notification,
          );
          if (
            terminalState?.status === "completed"
            && terminalReceipt?.status === "fulfilled"
            && terminalNotification?.status === "delivered"
            && isCurrent(epoch)
          ) {
            try {
              const projectionValue = await client(ctx).callTool(
                "coc_invoke",
                blockingOpeningProjectionCall(params, value),
                signal,
              );
              const projectionEnvelope = objectOrNull(projectionValue);
              const projectionData = objectOrNull(projectionEnvelope?.data);
              if (
                projectionEnvelope?.ok === true
                && (
                  projectionData?.status === "complete"
                  || projectionData?.status === "current"
                )
              ) {
                openingContinuationGate.markOpeningProjected(dispatchKey);
                return result(resolvedBlockingOpeningEnvelope(
                  value,
                  terminalState,
                  projectionValue,
                ));
              }
            } catch {
              if (signal?.aborted) {
                openingContinuationGate.cancelSynchronousOpeningWait(
                  dispatchKey,
                );
                return result(failedBlockingOpeningEnvelope(
                  {
                    status: "terminal_failure",
                    failure_class: "opening_projection_cancelled",
                    dispatch_key: dispatchKey,
                  },
                  "opening_projection_cancelled",
                ));
              }
              // The source terminal remains durable, but no projection or
              // invented opening is released when canonical projection fails.
            }
            openingContinuationGate.markTerminalBlocker(dispatchKey);
            openingContinuationGate.markSynchronousOpeningTerminalConsumed(
              dispatchKey,
            );
            return result(failedBlockingOpeningEnvelope(
              terminalState,
              "opening_projection_not_current",
            ));
          }
          openingContinuationGate.markTerminalBlocker(dispatchKey);
          openingContinuationGate.markSynchronousOpeningTerminalConsumed(
            dispatchKey,
          );
          return result(failedBlockingOpeningEnvelope(
            terminalState ?? {
              status: "terminal_failure",
              failure_class: "coordinator_terminal_missing",
            },
          ));
        }
      }
      const envelope = objectOrNull(value);
      const data = objectOrNull(envelope?.data);
      const operation = String(params.operation);
      if (
        operation === "turn.finalize"
        && envelope?.ok === true
        && typeof data?.rendered_text === "string"
        && data.rendered_text.length > 0
        && typeof data?.rendered_sha256 === "string"
      ) {
        openingContinuationGate.markFinalizedOutputReady(
          data.rendered_text,
          data.rendered_sha256,
        );
      }
      if (
        envelope?.ok === true
        && (operation.startsWith("setup.") || operation.startsWith("character."))
      ) {
        openingContinuationGate.markIndependentVisibleOutput();
      }
      const projectedOpening = (
        operation === "progressive.project_opening"
        && envelope?.ok === true
        && (data?.status === "complete" || data?.status === "current")
      ) || (
        operation === "state.move_scene"
        && envelope?.ok === true
        && objectOrNull(params.arguments)?.defer_initial_progressive_on_enter === true
      );
      if (projectedOpening) openingContinuationGate.markOpeningProjected();
      void autoDispatchCoordinator(autoDispatchDeps(ctx, epoch), name, value).catch(() => {});
    }
    return result(value);
  };
  pi.registerTool({
    name: "coc_capabilities", label: "COC capabilities",
    description: "Return canonical COC host capabilities.", parameters: emptySchema,
    execute: gateway("coc_capabilities"),
    ...compactToolRenderers("coc_capabilities"),
  });
  pi.registerTool({
    name: "coc_discover", label: "COC discover",
    description: "Discover canonical COC operations.", parameters: discoverSchema,
    execute: gateway("coc_discover"),
    ...compactToolRenderers("coc_discover"),
  });
  pi.registerTool({
    name: "coc_invoke", label: "COC invoke",
    description: "Invoke one exact canonical COC operation.", parameters: invokeSchema,
    execute: gateway("coc_invoke"),
    ...compactToolRenderers("coc_invoke"),
  });
  pi.registerTool({
    name: "coc_dispatch_source_work", label: "COC source dispatch",
    description: "Submit one exact repository-produced Pi source coordinator task.", parameters: dispatchSchema,
    ...compactToolRenderers("coc_dispatch_source_work"),
    async execute(_id: string, params: JsonObject, signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) {
      const epoch = sessionEpoch;
      if (!isCurrent(epoch)) return result(sessionClosed());
      exactKeys(params, ["task"], "dispatch request");
      let enabled: boolean;
      try { enabled = await (overrides.coordinatorEnabled ?? piCoordinatorEnabled)(); }
      catch (error) {
        if (!isCurrent(epoch)) return result(sessionClosed());
        throw error;
      }
      if (!enabled) throw new Error("Pi source coordinator is unavailable pending a real isolated lifecycle probe");
      if (!isCurrent(epoch)) return result(sessionClosed());
      const task = validateCoordinatorTask(params.task);
      const packet = asObject(task.packet, "coordinator packet");
      const key = nonEmpty(packet.packet_id, "packet_id");
      if (resolve(nonEmpty(packet.workspace_root, "workspace_root")) !== resolve(ctx.cwd)) throw new Error("coordinator workspace drift");
      const model = ctx.model;
      if (!model) throw new Error("active parent model is unavailable");
      if (!isCurrent(epoch)) return result(sessionClosed(key));
      const submitted = await coordinatorManager(epoch).submit(task, {
        cwd: ctx.cwd,
        provider: nonEmpty(model.provider, "model.provider"),
        modelId: nonEmpty(model.id, "model.id"),
        thinking: pi.getThinkingLevel(),
      }, signal);
      try { pi.appendEntry("coc-source-coordinator-dispatch", submitted); }
      catch { /* dispatch audit is best effort */ }
      return result(submitted);
    },
  });
  pi.registerTool({
    name: "coc_progressive_ocr", label: "Progressive OCR",
    description: "Run configured external Progressive OCR status/fast/enhance/export.", parameters: ocrSchema,
    ...compactToolRenderers("coc_progressive_ocr"),
    async execute(_id: string, params: JsonObject, signal: AbortSignal | undefined) { return result(await runOcr(params, signal)); },
  });
  // Game table HUD replaces the coding-agent token/path footer in TUI sessions.
  registerCocHud(pi, (ctx) => client(ctx));
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "coc-agent");
  registerCocWelcome(pi, (ctx) => client(ctx), agentDir);
  registerPlayerTranscriptGate(
    pi,
    (visibleText) => (
      openingContinuationGate.acceptVisibleAssistantFinal(visibleText)
    ),
    (message) => openingContinuationGate.observeMessageStart(message),
  );
  pi.on("agent_start", () => {
    openingContinuationGate.markAgentStart();
  });
  pi.on("agent_end", () => {
    openingContinuationGate.markAgentEnd();
  });
  const kpActiveTools = [
    "coc_capabilities",
    "coc_discover",
    "coc_invoke",
    "coc_progressive_ocr",
  ];
  pi.on("session_start", () => {
    sessionEpoch += 1;
    sessionClosing = false;
    openingContinuationGate.reset();
    continuedCoordinatorDispatches = new Set<string>();
    // The host owns exact nested coordinator-task dispatch. Keep the
    // fail-closed tool registered for the private manager boundary and probes,
    // but never expose it to the KP model.
    pi.setActiveTools(kpActiveTools);
  });
  pi.on("session_shutdown", async () => {
    sessionClosing = true;
    sessionEpoch += 1;
    openingContinuationGate.reset();
    const ownedManager = manager;
    const ownedMcp = mcp;
    manager = null;
    mcp = null;
    await ownedManager?.shutdown();
    await ownedMcp?.close();
  });
}

export const __test = { piCoordinatorEnabled, runOcr, findAutoDispatchTask, autoDispatchCoordinator };
