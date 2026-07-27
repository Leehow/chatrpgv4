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
export function publishCoordinatorTerminal(pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage">, receipt: JsonObject): JsonObject {
  let appendStatus = "delivered";
  let sendStatus = "delivered";
  try { pi.appendEntry("coc-source-coordinator-terminal", receipt); }
  catch { appendStatus = "failed"; }
  try {
    pi.sendMessage({
      customType: "coc-source-coordinator-terminal",
      content: `COC source coordinator terminal receipt: ${JSON.stringify(receipt)}`,
      display: true,
      details: receipt,
    }, { triggerTurn: false, deliverAs: "nextTurn" });
  } catch { sendStatus = "failed"; }
  const status = appendStatus === "delivered" && sendStatus === "delivered"
    ? "delivered"
    : appendStatus === "failed" && sendStatus === "failed" ? "failed" : "partial";
  return {
    status,
    append_entry: appendStatus,
    next_turn_message: sendStatus,
    ...(appendStatus === "failed" ? { append_failure_class: "append_entry_failed" } : {}),
    ...(sendStatus === "failed" ? { send_failure_class: "next_turn_message_failed" } : {}),
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
  const takeover = objectOrNull(data?.background_takeover);
  const action = objectOrNull(takeover?.next_host_action);
  const task = objectOrNull(action?.task);
  if (action?.action !== "invoke_coc_dispatch_source_work"
    || task?.contract_id !== "coc.pi-source-coordinator-task.v1") return null;
  return task;
}

interface AutoDispatchDeps {
  enabled(): Promise<boolean>;
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
  try { if (!(await deps.enabled())) return; }
  catch {
    deps.audit({ status: "capability_check_failed", failure_class: "capability_check_failed" });
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
  if (active && (active.state(key) || active.activeCount() > 0)) return;
  const launch = deps.launchContext();
  if (!launch) {
    deps.audit({ status: "launch_context_unavailable", dispatch_key: key, failure_class: "launch_context_unavailable" });
    return;
  }
  if (workspaceRoot !== resolve(launch.cwd)) {
    deps.audit({ status: "workspace_drift", dispatch_key: key, failure_class: "workspace_drift" });
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

export default function mainExtension(pi: ExtensionAPI) {
  let mcp: McpJsonlClient | null = null;
  let manager: CoordinatorDispatchManager | null = null;
  const client = (ctx: ExtensionContext) => mcp ??= new McpJsonlClient(ctx.cwd, ctx.sessionManager.getSessionId(), ctx.mode === "tui");
  const coordinatorManager = () => manager ??= new CoordinatorDispatchManager(
    (exactTask, launch, launchSignal) => spawnPiChild({
      role: "coordinator", task: exactTask,
      ...launch, signal: launchSignal,
    }),
    (receipt) => publishCoordinatorTerminal(pi, receipt),
    (observation) => {
      try { pi.appendEntry("coc-source-coordinator-lifecycle", observation); }
      catch { /* lifecycle audit is best effort */ }
    },
  );
  const autoDispatchDeps = (ctx: ExtensionContext): AutoDispatchDeps => ({
    enabled: piCoordinatorEnabled,
    activeManager: () => manager,
    manager: coordinatorManager,
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
    const value = await client(ctx).callTool(name, params, signal);
    if (name === "coc_invoke") void autoDispatchCoordinator(autoDispatchDeps(ctx), name, value).catch(() => {});
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
      exactKeys(params, ["task"], "dispatch request");
      if (!(await piCoordinatorEnabled())) throw new Error("Pi source coordinator is unavailable pending a real isolated lifecycle probe");
      const task = validateCoordinatorTask(params.task);
      const packet = asObject(task.packet, "coordinator packet");
      if (resolve(nonEmpty(packet.workspace_root, "workspace_root")) !== resolve(ctx.cwd)) throw new Error("coordinator workspace drift");
      const model = ctx.model;
      if (!model) throw new Error("active parent model is unavailable");
      const submitted = await coordinatorManager().submit(task, {
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
  pi.on("session_start", () => pi.setActiveTools(["coc_capabilities", "coc_discover", "coc_invoke", "coc_dispatch_source_work", "coc_progressive_ocr"]));
  pi.on("session_shutdown", async () => { await manager?.shutdown(); manager = null; await mcp?.close(); mcp = null; });
}

export const __test = { piCoordinatorEnabled, runOcr, findAutoDispatchTask, autoDispatchCoordinator };
