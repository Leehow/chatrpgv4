import { spawn } from "node:child_process";
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

function withoutAssistantText<T>(message: T): T {
  const assistant = assistantContentMessage(message);
  if (!assistant) return message;
  return {
    ...(message as object),
    content: assistant.content.filter((part) => part.type !== "text"),
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
// then rendered normally; a tool-bearing final message keeps only non-text
// parts so its framing never enters the transcript or later model context.
export class OpeningTerminalContinuationGate {
  private readonly states = new Map<string, "awaiting" | "projected" | "published">();
  private readonly pending = new Map<string, {
    promise: Promise<boolean>;
    resolve: (shouldWake: boolean) => void;
  }>();
  private agentActive = false;

  trackOpeningDispatch(dispatchKey: string): void {
    if (dispatchKey) this.states.set(dispatchKey, "awaiting");
  }

  markAgentStart(): void {
    this.agentActive = true;
  }

  markOpeningProjected(): void {
    for (const [key, state] of this.states) {
      if (state === "awaiting") this.states.set(key, "projected");
    }
  }

  markVisibleAssistantFinal(): void {
    for (const [key, state] of this.states) {
      if (state === "projected") this.states.set(key, "published");
    }
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
    for (const decision of this.pending.values()) decision.resolve(false);
    this.pending.clear();
    this.states.clear();
  }
}

export function registerPlayerTranscriptGate(
  pi: ExtensionAPI,
  onVisibleAssistantFinal?: () => void,
): void {
  pi.on("message_start", (event) => {
    hideUnsettledAssistantText(event.message);
  });
  pi.on("message_update", (event) => {
    hideUnsettledAssistantText(event.message);
  });
  pi.on("message_end", (event) => {
    const assistant = assistantContentMessage(event.message);
    if (!assistant) return;
    if (!assistant.content.some((part) => part.type === "toolCall")) {
      if (assistant.content.some((part) => part.type === "text")) {
        onVisibleAssistantFinal?.();
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
          };
          // Pinned Pi queues followUp while streaming and uses triggerTurn when
          // idle. display:false keeps this one-shot liveness notice out of TUI.
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

// Toolbox results may carry a background_takeover whose next_host_action asks
// the KP to call coc_dispatch_source_work. Fulfillment must not depend on KP
// discipline, so the host submits that exact task itself, fire-and-forget.
async function autoDispatchCoordinator(deps: AutoDispatchDeps, toolName: string, value: unknown): Promise<void> {
  if (toolName !== "coc_invoke") return;
  const task = findAutoDispatchTask(value);
  if (!task) return;
  if (!deps.isCurrent()) {
    deps.audit({ status: "session_closed", failure_class: "session_closed" });
    return;
  }
  try { if (!(await deps.enabled())) return; }
  catch {
    deps.audit(deps.isCurrent()
      ? { status: "capability_check_failed", failure_class: "capability_check_failed" }
      : { status: "session_closed", failure_class: "session_closed" });
    return;
  }
  if (!deps.isCurrent()) {
    deps.audit({ status: "session_closed", failure_class: "session_closed" });
    return;
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
    deps.audit({ status: "validation_failed", failure_class: "coordinator_task_invalid" });
    return;
  }
  const active = deps.activeManager();
  if (active?.state(key)) return;
  const launch = deps.launchContext();
  if (!launch) {
    deps.audit({ status: "launch_context_unavailable", dispatch_key: key, failure_class: "launch_context_unavailable" });
    return;
  }
  if (workspaceRoot !== resolve(launch.cwd)) {
    deps.audit({ status: "workspace_drift", dispatch_key: key, failure_class: "workspace_drift" });
    return;
  }
  if (!deps.isCurrent()) {
    deps.audit({ status: "session_closed", dispatch_key: key, failure_class: "session_closed" });
    return;
  }
  try {
    deps.audit(await deps.manager().submit(exactTask, launch));
  } catch {
    deps.audit({ status: "submit_failed", dispatch_key: key, failure_class: "coordinator_submit_failed" });
  }
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
    (exactTask, launch, launchSignal) => spawnPiChild({
      role: "coordinator", task: exactTask,
      ...launch, signal: launchSignal,
    }),
    (receipt) => publishCoordinatorTerminal(
      pi,
      receipt,
      ownedContinuedDispatches,
      (dispatchKey) => openingContinuationGate.decideWake(dispatchKey),
    ),
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
        if (dispatchKey) openingContinuationGate.trackOpeningDispatch(dispatchKey);
      }
      const envelope = objectOrNull(value);
      const data = objectOrNull(envelope?.data);
      const operation = String(params.operation);
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
    () => openingContinuationGate.markVisibleAssistantFinal(),
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
