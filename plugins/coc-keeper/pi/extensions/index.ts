import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  asObject,
  CanonicalToolError,
  exactKeys,
  loadSecrets,
  MAX_BYTES,
  McpJsonlClient,
  nonEmpty,
  rejectSecretDisclosure,
  safeEnv,
  spawnPiChild,
  terminateTree,
  validateCoordinatorTask,
  type ChildRun,
  type JsonObject,
  type PrivateLaunchContext,
} from "../lib/runtime.ts";
import {
  autoDispatchCoordinator,
  CoordinatorDispatchManager,
  coordinatorDispatchNullReason,
  findAutoDispatchTask,
  PiSemanticSupplyCoordinator,
} from "./coordinator.ts";
import {
  buildMechanicalOutputGateEnvelope,
  detectMechanicalMarkers,
  MECHANICAL_OUTPUT_GATE_CUSTOM_TYPE,
  mechanicalMarkerClassesUncovered,
  type MechanicalMarker,
} from "../lib/mechanical-output-gate.ts";
import { compactToolRenderers } from "../lib/tool-render.ts";
import { decideSceneSupply } from "../lib/scene-supply.ts";
import {
  detectMapSupplyPageDirectory,
  mapVisualMessage,
  renderMapSupplyPages,
} from "../lib/map-supply.ts";
import {
  KEEPER_BRIEFING_CUSTOM_TYPE,
  keeperBriefingMessage,
  readKeeperBriefing,
  type KeeperBriefing,
} from "../lib/keeper-briefing.ts";
import { registerCocHud } from "../lib/hud.ts";
import { registerTurnTelemetry } from "../lib/turn-telemetry.ts";
import {
  registerCocWelcome,
  STARTUP_RESUME_CUSTOM_TYPE,
  startupResumeInstruction,
  tableOpenIntentFromEnv,
} from "../lib/welcome.ts";
import { isCanonicalCampaignId } from "../lib/campaign-id.mjs";
import {
  activeToolsForPhase,
  DOMAIN_TOOL_DESCRIPTIONS,
  DOMAIN_TOOL_LABELS,
  DOMAIN_TOOL_NAMES,
  domainToolSchema,
  evaluateExecuteAcl,
  inferPhaseFromEnvelope,
  inferPhaseFromError,
  isCanonicalInvokeSurface,
  type PlayPhase,
} from "../lib/domain-tools.ts";

const emptySchema = { type: "object", properties: {}, additionalProperties: false } as const;
const OCR_TIMEOUT_MS = 15 * 60 * 1000;
// The locator producer child runs under the adapter's 900s budget; this
// outer budget must stay above it with margin (same ratio as the opening
// review and full-parse lanes: 900s child inside a 20min outer budget). The
// child's wall time is dominated by model-API latency that has been observed
// from ~80s to well past 240s, so the old 5min/240s pair killed runs the
// outer budget would have accepted.
const SOURCE_SCOPE_LOCATOR_TIMEOUT_MS = 20 * 60 * 1000;
const OPENING_SOURCE_REVIEW_TIMEOUT_MS = 20 * 60 * 1000;
const RAW_PDF_BIND_BUNDLE_ERROR = (
  "host source bundle must be a directory (not a file) containing manifest.json"
);
const discoverSchema = { type: "object", properties: { operation: { type: "string" }, domain: { type: "string" } }, additionalProperties: false } as const;
const invokeSchema = {
  type: "object",
  properties: {
    operation: { type: "string", minLength: 1 },
    root: { type: "string" },
    campaign: { type: "string" },
    arguments: {
      anyOf: [
        { type: "object", additionalProperties: true },
        { type: "string" },
      ],
    },
  },
  required: ["operation"], additionalProperties: false,
} as const;
const dispatchSchema = { type: "object", properties: { task: { type: "object", additionalProperties: true } }, required: ["task"], additionalProperties: false } as const;
const PRIVATE_LEASE_OPERATIONS = new Set([
  "progressive.claim_host_work",
  "progressive.fulfill_host_work",
  "progressive.renew_host_work_leases",
  "progressive.release_host_work_leases",
]);
const OPENING_SETUP_CHARACTER_KINDS = new Set([
  "investigator.create",
  "campaign.link_investigator",
  "campaign.render_briefing",
  "investigator.render_card",
]);
// These setup handlers require an already-resolvable canonical campaign.
// campaign.create and complete-sheet investigator.create are intentionally
// pre-campaign; deterministic Quick Fire creation is route-bound below.
const EXISTING_CAMPAIGN_SETUP_KINDS = new Set([
  "actor.create",
  "campaign.link_investigator",
  "scenario.bind_pdf",
  "campaign.render_briefing",
  "investigator.render_card",
]);
const OWNED_OPENING_ROUTE_OPERATIONS = new Set([
  "progressive.prepare_opening",
  "progressive.opening_bootstrap",
]);
const mapSupplySchema = {
  type: "object",
  properties: {
    operation: { type: "string", enum: ["detect", "render", "present"] },
    pages_dir: { type: "string" },
    needs_ocr: { type: "array", maxItems: 256, items: { type: "integer", minimum: 0 } },
    asset_root_id: { type: "string" },
    source_pdf_path: { type: "string" },
    image_ref: { type: "string" },
    caption: { type: "string", maxLength: 400 },
  },
  required: ["operation"], additionalProperties: false,
} as const;
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

function isPlainJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizePiCocInvokeArguments(params: JsonObject): JsonObject {
  const supplied = params.arguments;
  if (supplied === undefined) return params;
  if (typeof supplied !== "string") {
    if (!isPlainJsonObject(supplied)) {
      throw new Error("coc_invoke arguments must be a plain object");
    }
    return params;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(supplied);
  } catch {
    throw new Error(
      "coc_invoke arguments JSON string must be valid JSON encoding a plain object",
    );
  }
  if (!isPlainJsonObject(parsed)) {
    throw new Error(
      "coc_invoke arguments JSON string must encode a plain object",
    );
  }
  return { ...params, arguments: parsed };
}
type AssistantContentPart = { type: string; [key: string]: unknown };
type AssistantContentMessage = { role: "assistant"; content: AssistantContentPart[] };

function exactKeysMatch(value: JsonObject, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length
    && actual.every((key, index) => key === required[index]);
}

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

type CanonicalSetupVisibleOutput = {
  campaignId: string;
  sourceKind: "scenario.bind_pdf" | "campaign.render_briefing";
  publicSetupSha256: string;
  text: string;
  textSha256: string;
};

const MAX_CANONICAL_SETUP_VISIBLE_BYTES = 64 * 1024;
const MODULE_INIT_DOCUMENT_KEYS = [
  "schema_version", "campaign_id", "secrecy", "source_binding",
  "l0_sha256", "l0", "created_at",
];
const MODULE_INIT_SOURCE_BINDING_KEYS = [
  "scenario_id", "source_id", "file_sha256", "bundle_sha256",
  "opening_review_generation", "review_receipt_sha256",
];
const MODULE_INIT_L0_REQUIRED_FIELDS = [
  "schema_version", "secrecy", "module_meta", "pregens",
  "opening_hooks", "chargen_deltas", "opening_handouts",
];
type ModuleInitPrivateReference =
  | { status: "not_required" }
  | { status: "candidate"; campaignId: string };
type ModuleInitPrivateContextResolution =
  | { status: "not_required" }
  | { status: "invalid"; campaignId: string }
  | { status: "ready"; context: CanonicalModuleInitPrivateContext };
type CanonicalModuleInitPrivateContext = {
  schema_version: 1;
  campaign_id: string;
  secrecy: "keeper_only";
  l0_sha256: string;
  l0: JsonObject;
  instruction: string;
};
const SAFE_CHARACTER_SETUP_PROMPT = (
  "建卡尚未完成。请按 coc-character 流程立即推进，不要再次向玩家索要职业、特征或技能确认："
  + "若本轮尚未取得当前战役的 setup.investigator_contract，则先调用它以获得 payload_schema；"
  + "若已取得当前 contract，则直接使用其 payload_schema、玩家已选择的预设与守秘 L0 资料调用 "
  + "setup.invoke（kind: investigator.create）创建调查员。不得猜测字段或预设数值；创建后继续按保留路由链接调查员。"
);

/**
 * Resolve exact player-safe briefing bytes only from a successful canonical
 * setup receipt. The setup digest binds the public source inputs; the exact
 * returned path binds the one file this host may release.
 */
export async function canonicalSetupVisibleOutput(
  workspaceRoot: string,
  params: JsonObject,
  value: unknown,
): Promise<CanonicalSetupVisibleOutput | null> {
  if (params.operation !== "setup.invoke") return null;
  const args = objectOrNull(params.arguments);
  const payload = objectOrNull(args?.payload);
  const kind = args?.kind;
  if (
    (kind !== "scenario.bind_pdf" && kind !== "campaign.render_briefing")
    || payload === null
    || typeof payload.campaign_id !== "string"
    || payload.campaign_id !== params.campaign
  ) {
    return null;
  }
  const envelope = objectOrNull(value);
  const data = objectOrNull(envelope?.data);
  const resultData = objectOrNull(data?.result);
  const briefing = kind === "scenario.bind_pdf"
    ? objectOrNull(resultData?.character_creation_briefing)
    : resultData;
  const briefingPath = typeof briefing?.briefing_path === "string"
    ? briefing.briefing_path.trim()
    : "";
  const publicSetupSha256 = typeof briefing?.public_setup_sha256 === "string"
    ? briefing.public_setup_sha256.trim()
    : "";
  if (
    envelope?.ok !== true
    || envelope.tool !== "setup.invoke"
    || data?.schema_version !== 1
    || data.status !== "PASS"
    || data.kind !== kind
    || resultData === null
    || resultData.campaign_id !== params.campaign
    || !briefingPath
    || isAbsolute(briefingPath)
    || !/^[0-9a-f]{64}$/.test(publicSetupSha256)
  ) {
    return null;
  }
  const root = resolve(workspaceRoot);
  const expectedRoot = resolve(
    root,
    ".coc",
    "campaigns",
    String(params.campaign),
    "assets",
    "character-creation",
  );
  const candidate = resolve(root, briefingPath);
  if (
    candidate === expectedRoot
    || !candidate.startsWith(`${expectedRoot}${sep}`)
  ) {
    return null;
  }
  let canonicalRoot: string;
  let canonicalCandidate: string;
  try {
    [canonicalRoot, canonicalCandidate] = await Promise.all([
      realpath(expectedRoot),
      realpath(candidate),
    ]);
  } catch {
    return null;
  }
  if (!canonicalCandidate.startsWith(`${canonicalRoot}${sep}`)) return null;
  let text: string;
  try {
    text = await readFile(canonicalCandidate, "utf8");
  } catch {
    return null;
  }
  if (
    !text
    || Buffer.byteLength(text, "utf8") > MAX_CANONICAL_SETUP_VISIBLE_BYTES
  ) {
    return null;
  }
  return {
    campaignId: String(params.campaign),
    sourceKind: kind,
    publicSetupSha256,
    text,
    textSha256: canonicalJsonValueSha256(text),
  };
}

function moduleInitPrivateReferenceForContract(
  params: JsonObject,
  value: unknown,
): ModuleInitPrivateReference {
  if (params.operation !== "setup.investigator_contract") {
    return { status: "not_required" };
  }
  const campaignId = typeof params.campaign === "string"
    ? params.campaign.trim()
    : "";
  const args = objectOrNull(params.arguments);
  const envelope = objectOrNull(value);
  const data = objectOrNull(envelope?.data);
  const contract = objectOrNull(data?.result);
  if (
    !campaignId
    || !isCanonicalCampaignId(campaignId)
    || args === null
    || !exactKeysMatch(args, ["campaign_id"])
    || args.campaign_id !== campaignId
    || envelope?.ok !== true
    || envelope.tool !== "setup.investigator_contract"
    || data?.schema_version !== 1
    || data.status !== "PASS"
    || data.kind !== "investigator.contract"
    || contract === null
  ) {
    return { status: "not_required" };
  }
  return { status: "candidate", campaignId };
}

async function readBoundedJsonObject(path: string): Promise<JsonObject | null> {
  let raw: string;
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > MAX_BYTES) return null;
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_BYTES) return null;
  try {
    return objectOrNull(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Resolve a keeper-only L0 only after the canonical investigator contract has
 * already passed its source-bound runtime gate. This is a Pi-host private
 * projection, never a player-visible setup result or a broad file read.
 */
async function resolveCanonicalModuleInitPrivateContext(
  workspaceRoot: string,
  params: JsonObject,
  value: unknown,
): Promise<ModuleInitPrivateContextResolution> {
  const reference = moduleInitPrivateReferenceForContract(params, value);
  if (reference.status !== "candidate") return { status: "not_required" };
  const root = resolve(workspaceRoot);
  if (params.root !== undefined) {
    if (typeof params.root !== "string" || !params.root.trim()) {
      return { status: "invalid", campaignId: reference.campaignId };
    }
    const requestedRoot = resolve(params.root);
    if (requestedRoot !== root) {
      try {
        const [canonicalRequestedRoot, canonicalWorkspaceRoot] = await Promise.all([
          realpath(requestedRoot),
          realpath(root),
        ]);
        if (canonicalRequestedRoot !== canonicalWorkspaceRoot) {
          return { status: "invalid", campaignId: reference.campaignId };
        }
      } catch {
        return { status: "invalid", campaignId: reference.campaignId };
      }
    }
  }
  const campaignRoot = resolve(
    root,
    ".coc",
    "campaigns",
    reference.campaignId,
  );
  const scenarioRoot = resolve(campaignRoot, "scenario");
  const scenarioPath = resolve(scenarioRoot, "scenario.json");
  let canonicalScenarioRoot: string;
  let canonicalScenarioPath: string;
  try {
    [canonicalScenarioRoot, canonicalScenarioPath] = await Promise.all([
      realpath(scenarioRoot),
      realpath(scenarioPath),
    ]);
  } catch {
    // Built-in/non-PDF campaigns have no source scenario and need no L0.
    return { status: "not_required" };
  }
  if (canonicalScenarioPath !== resolve(canonicalScenarioRoot, "scenario.json")) {
    return { status: "invalid", campaignId: reference.campaignId };
  }
  const scenario = await readBoundedJsonObject(canonicalScenarioPath);
  const source = objectOrNull(scenario?.source);
  const sourceBound = (
    typeof source?.source_id === "string"
    && source.source_id.trim().length > 0
    && typeof source?.bundle_sha256 === "string"
    && source.bundle_sha256.trim().length > 0
  );
  if (!sourceBound) return { status: "not_required" };

  const saveRoot = resolve(campaignRoot, "save");
  const documentPath = resolve(saveRoot, "module-init.json");
  let canonicalSaveRoot: string;
  let canonicalDocumentPath: string;
  try {
    [canonicalSaveRoot, canonicalDocumentPath] = await Promise.all([
      realpath(saveRoot),
      realpath(documentPath),
    ]);
  } catch {
    return { status: "invalid", campaignId: reference.campaignId };
  }
  if (canonicalDocumentPath !== resolve(canonicalSaveRoot, "module-init.json")) {
    return { status: "invalid", campaignId: reference.campaignId };
  }
  const document = await readBoundedJsonObject(canonicalDocumentPath);
  const sourceBinding = objectOrNull(document?.source_binding);
  const l0 = objectOrNull(document?.l0);
  if (
    document === null
    || !exactKeysMatch(document, MODULE_INIT_DOCUMENT_KEYS)
    || document.schema_version !== 1
    || document.campaign_id !== reference.campaignId
    || document.secrecy !== "keeper_only"
    || typeof document.l0_sha256 !== "string"
    || !/^sha256:[0-9a-f]{64}$/.test(document.l0_sha256)
    || typeof document.created_at !== "string"
    || !document.created_at.trim()
    || sourceBinding === null
    || !exactKeysMatch(sourceBinding, MODULE_INIT_SOURCE_BINDING_KEYS)
    || sourceBinding.scenario_id !== scenario?.scenario_id
    || sourceBinding.source_id !== source?.source_id
    || sourceBinding.file_sha256 !== source?.file_sha256
    || sourceBinding.bundle_sha256 !== source?.bundle_sha256
    || l0 === null
    || l0.schema_version !== 1
    || l0.secrecy !== "keeper_only"
    || !MODULE_INIT_L0_REQUIRED_FIELDS.every((field) => field in l0)
  ) {
    return { status: "invalid", campaignId: reference.campaignId };
  }
  return {
    status: "ready",
    context: {
      schema_version: 1,
      campaign_id: reference.campaignId,
      secrecy: "keeper_only",
      l0_sha256: document.l0_sha256,
      l0,
      instruction: (
        "这是已通过调查员构建门控的守秘人专用 L0 建卡包。"
        + "可据其协助建卡与开场准备；不得直接泄露守秘信息。"
      ),
    },
  };
}

export async function canonicalModuleInitPrivateContext(
  workspaceRoot: string,
  params: JsonObject,
  value: unknown,
): Promise<CanonicalModuleInitPrivateContext | null> {
  const resolved = await resolveCanonicalModuleInitPrivateContext(
    workspaceRoot,
    params,
    value,
  );
  return resolved.status === "ready" ? resolved.context : null;
}

function moduleInitPrivateProjectionFailure(campaignId: string): JsonObject {
  return {
    ok: false,
    tool: "setup.investigator_contract",
    error: {
      code: "module_init_private_projection_failed",
      message: (
        "The source-bound keeper-only coc-module-init L0 could not be "
        + "projected privately; retry setup.investigator_contract before "
        + "investigator.create. Do not guess pregens, chargen deltas, opening "
        + "hooks, or handouts."
      ),
    },
    warnings: [],
    hints: [
      `retry setup.investigator_contract for campaign ${campaignId} before `
      + "attempting investigator.create",
    ],
  };
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
  | {
      replacementText: string;
      triggerSetupContinuation?: boolean;
    };
type QueuedVisibleAssistantDisposition = {
  disposition: VisibleAssistantDisposition;
  dispatchKey?: string;
};
type OpeningSetupRoute = {
  schema_version: 1;
  status: "blocked";
  hard_gate: true;
  activation_allowed: false;
  phase: string;
  campaign_id: string;
  next_operation: JsonObject | null;
  allowed_actions?: JsonObject[];
  character_setup_policy?: (
    | "guided_quick_fire_no_source"
    | "kp_guided_era_adaptive_no_source"
  );
  character_setup_input_mode?: GuidedCharacterCreationInputMode;
  startup_resume_policy?: "source_materialization_wait_only";
  instruction: string;
};
type OpeningSetupTerminalBlocker = {
  visibleText: string;
  details: JsonObject;
};
type GuidedCharacterCreationInputMode = (
  | "guided_quick_fire"
  | "kp_guided_era_adaptive"
);
type OpeningGuidedCreateReceipt = {
  campaignId: string;
  investigatorId: string;
  generation: string;
  revision: number;
  invocationId: string;
  receiptSha256: string;
};
type OpeningSetupState = {
  route: OpeningSetupRoute;
  generation: string;
  generationSequence: number;
  revision: number;
  phase:
    | "selection"
    | "source_review"
    | "reviewed"
    | "bootstrap"
    | "submitting"
    | "materializing"
    | "retry"
    | "projection"
    | "ready"
    | "opening_evidence"
    | "contract_invalid";
  dispatchIdentity: string | null;
  characterSetupComplete: boolean;
  characterSetupInputMode: GuidedCharacterCreationInputMode | null;
  guidedCreateReceipts: Map<string, OpeningGuidedCreateReceipt>;
  projectionCard: JsonObject | null;
  activationCard: JsonObject | null;
  bootstrapRetryCard: JsonObject | null;
  continuationReleaseOwner: "route" | "terminal" | null;
  backgroundTerminalReceipt: JsonObject | null;
  bindBriefing: CanonicalSetupVisibleOutput | null;
};
type OpeningSetupAttempt = {
  invocationId: string;
  campaignId: string;
  generation: string | null;
  generationSequence: number | null;
  revision: number | null;
  operation: string;
  attemptClass:
    | "bind"
    | "route"
    | "character"
    | "probe";
  agentTurn: number;
  dispatchIdentity: string | null;
};
type OpeningSetupObservationDisposition = {
  accepted: boolean;
  dispatchAllowed: boolean;
  reason: string;
  modelProjection?: JsonObject;
};
type OpeningBackgroundSubmissionDisposition =
  | { status: "submitted" }
  | { status: "terminal"; receipt: JsonObject }
  | { status: "stale" };
type CurrentDependencyWait = {
  campaignId: string;
  jobId: string;
  dependencyRef: JsonObject;
  settlementGroupKey: string;
  dispatchKey: string | null;
  deliveryPending: boolean;
  deliveryRetryNeeded: boolean;
  terminalReceipt: JsonObject | null;
  terminalDelivered: boolean;
  projectionConfirmed: boolean;
};
type CurrentDependencySuppression = {
  epoch: number;
  campaignId: string;
  invocationId: string;
};
const MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN = 32;
const OPENING_START_LOCATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class OpeningTerminalContinuationGate {
  private readonly states = new Map<string, "awaiting" | "projected" | "published">();
  private readonly dispatchClasses = new Map<
    string,
    "blocking_opening" | "blocking_micro" | "nonblocking_background"
  >();
  private readonly pending = new Map<string, {
    promise: Promise<boolean>;
    resolve: (shouldWake: boolean) => void;
  }>();
  private readonly currentDependencyWaits = new Map<
    string,
    CurrentDependencyWait
  >();
  private readonly currentDependencyByDispatch = new Map<string, string>();
  private currentDependencySuppression: CurrentDependencySuppression | null = null;
  private currentVisibleCampaignId: string | null = null;
  private agentActive = false;
  private queuedVisibleDispositions: QueuedVisibleAssistantDisposition[] = [];
  private playerTurnEpoch = 0;
  private finalizedOutput: {
    epoch: number;
    renderedText: string;
    renderedSha256: string;
    delivered: boolean;
  } | null = null;
// Same-epoch authoritative receipt counts for the mechanical-output gate:
  // dice receipts are successful coc_invoke envelopes whose data carries a
  // non-empty roll_id; resource receipts are successful state.* writes; a
  // successful turn.finalize / evidence.table_opening covers both classes.
  private readonly epochMechanicalReceipts = new Map<
    number,
    { dice: number; resource: number }
  >();
  private pendingMechanicalOutputGateEnvelope: JsonObject | null = null;
  private nonblockingContinuation: {
    epoch: number;
    dispatchKey: string;
    renderedSha256: string;
  } | null = null;
  private readonly openingSetupStates = new Map<string, OpeningSetupState>();
  private readonly openingSetupAttempts = new Map<string, OpeningSetupAttempt>();
  private openingSetupGenerationSequence = 0;
  private readonly openingSetupLatestIssuedGeneration = new Map<string, number>();
  private readonly openingSetupRetiredGeneration = new Map<string, number>();
  private openingSetupAgentTurn = 0;
  private openingSetupTurnCampaignId: string | null = null;
  private openingSetupTurnCampaignAmbiguous = false;
  private openingSetupVisibleOutputAuthorization: {
    campaignId: string;
    generation: string;
    revision: number;
    agentTurn: number;
    invocationId: string;
    replacementText: string | null;
    replacementTextSha256: string | null;
    source: string;
  } | null = null;
  private readonly openingSetupContinuationQueued = new Set<string>();
  private readonly openingSetupTerminalBlockers = new Map<
    string,
    OpeningSetupTerminalBlocker
  >();
  private deliveredOpeningSetupTerminalBlocker: JsonObject | null = null;
  private openingSetupAudits: JsonObject[] = [];

  hasActiveOpeningSetup(): boolean {
    return this.openingSetupStates.size > 0 || this.pendingBindExists();
  }

  hasActiveOpeningSetupFor(campaignId: string): boolean {
    const id = campaignId.trim();
    if (!id) return this.hasActiveOpeningSetup();
    return this.openingSetupStates.has(id) || this.pendingBindExistsForCampaign(id);
  }

  private openingSetupStateForTranscript(): OpeningSetupState | null {
    if (this.openingSetupTurnCampaignAmbiguous) return null;
    if (this.openingSetupTurnCampaignId !== null) {
      return this.openingSetupStates.get(this.openingSetupTurnCampaignId)
        ?? null;
    }
    if (this.openingSetupStates.size !== 1) return null;
    return this.openingSetupStates.values().next().value ?? null;
  }

  private recordOpeningSetupAudit(entry: JsonObject): void {
    this.openingSetupAudits.push({
      schema_version: 1,
      ...entry,
    });
  }

  takeOpeningSetupAudits(): JsonObject[] {
    const audits = this.openingSetupAudits;
    this.openingSetupAudits = [];
    return audits;
  }

  private openingSetupAuthorizationMatches(
    state: OpeningSetupState,
  ): boolean {
    const authorization = this.openingSetupVisibleOutputAuthorization;
    return (
      authorization !== null
      && !this.openingSetupTurnCampaignAmbiguous
      && this.openingSetupTurnCampaignId === authorization.campaignId
      && authorization.campaignId === state.route.campaign_id
      && authorization.generation === state.generation
      && authorization.revision === state.revision
      && authorization.agentTurn === this.openingSetupAgentTurn
    );
  }

  private authorizeOpeningSetupVisibleOutput(
    state: OpeningSetupState,
    attempt: OpeningSetupAttempt,
    replacementText: string,
    source: string,
  ): void {
    if (
      !replacementText
      || attempt.agentTurn !== this.openingSetupAgentTurn
      || this.openingSetupTurnCampaignAmbiguous
      || this.openingSetupTurnCampaignId !== attempt.campaignId
    ) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "late_ambiguous_or_empty_setup_output",
        campaign_id: attempt.campaignId,
        invocation_id: attempt.invocationId,
        source,
      });
      return;
    }
    this.openingSetupVisibleOutputAuthorization = {
      campaignId: attempt.campaignId,
      generation: state.generation,
      revision: state.revision,
      agentTurn: attempt.agentTurn,
      invocationId: attempt.invocationId,
      replacementText,
      replacementTextSha256: canonicalJsonValueSha256(replacementText),
      source,
    };
  }

  private authorizeOpeningSetupConversationalOutput(
    state: OpeningSetupState,
    attempt: OpeningSetupAttempt,
    source: string,
  ): void {
    if (
      attempt.agentTurn !== this.openingSetupAgentTurn
      || this.openingSetupTurnCampaignAmbiguous
      || this.openingSetupTurnCampaignId !== attempt.campaignId
    ) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "late_or_ambiguous_conversational_setup_output",
        campaign_id: attempt.campaignId,
        invocation_id: attempt.invocationId,
        source,
      });
      return;
    }
    this.openingSetupVisibleOutputAuthorization = {
      campaignId: attempt.campaignId,
      generation: state.generation,
      revision: state.revision,
      agentTurn: attempt.agentTurn,
      invocationId: attempt.invocationId,
      replacementText: null,
      replacementTextSha256: null,
      source,
    };
  }

  private pendingBindExists(): boolean {
    return [...this.openingSetupAttempts.values()].some(
      (attempt) => attempt.attemptClass === "bind",
    );
  }

  private pendingBindExistsForCampaign(campaignId: string): boolean {
    return [...this.openingSetupAttempts.values()].some((attempt) => (
      attempt.attemptClass === "bind"
      && attempt.campaignId === campaignId
    ));
  }

  private pruneOpeningSetupCampaign(campaignId: string): void {
    if (this.openingSetupStates.has(campaignId)) return;
    if ([...this.openingSetupAttempts.values()].some(
      (attempt) => attempt.campaignId === campaignId,
    )) {
      return;
    }
    this.openingSetupLatestIssuedGeneration.delete(campaignId);
    this.openingSetupRetiredGeneration.delete(campaignId);
    this.openingSetupContinuationQueued.delete(campaignId);
    this.openingSetupTerminalBlockers.delete(campaignId);
  }

  private finalizeOpeningSetupAttempt(
    invocationId: string,
    releaseContinuation = true,
  ): OpeningSetupAttempt | null {
    const attempt = this.openingSetupAttempts.get(invocationId) ?? null;
    if (attempt === null) return null;
    this.openingSetupAttempts.delete(invocationId);
    if (releaseContinuation && attempt.attemptClass === "route") {
      this.openingSetupContinuationQueued.delete(attempt.campaignId);
    }
    this.pruneOpeningSetupCampaign(attempt.campaignId);
    return attempt;
  }

  private supersedeOpeningSetupRevisionAttempts(
    state: OpeningSetupState,
    exceptInvocationId: string,
  ): void {
    for (const attempt of [...this.openingSetupAttempts.values()]) {
      if (
        attempt.invocationId !== exceptInvocationId
        && attempt.campaignId === state.route.campaign_id
        && attempt.generation === state.generation
        && attempt.revision === state.revision
      ) {
        this.finalizeOpeningSetupAttempt(attempt.invocationId);
        this.recordOpeningSetupAudit({
          status: "ignored",
          reason: "superseded_attempt_revision",
          campaign_id: attempt.campaignId,
          invocation_id: attempt.invocationId,
          generation: attempt.generation,
          revision: attempt.revision,
        });
      }
    }
  }

  private quickFireLuckInvocation(params: JsonObject): boolean {
    const args = objectOrNull(params.arguments);
    return (
      args !== null
      && Object.keys(args).every((key) => (
        ["expression", "decision_id", "purpose", "reason"].includes(key)
      ))
      && ["expression", "decision_id", "purpose"].every((key) => (
        Object.keys(args).includes(key)
      ))
      && args.expression === "3D6"
      && args.purpose === "investigator_creation_luck"
      && (
        args.reason === undefined
        || args.reason === null
        || typeof args.reason === "string"
      )
      && typeof args.decision_id === "string"
      && args.decision_id.trim().length > 0
    );
  }

  private adaptiveCharacteristicRollInvocation(params: JsonObject): boolean {
    const args = objectOrNull(params.arguments);
    return (
      args !== null
      && Object.keys(args).every((key) => (
        ["expression", "decision_id", "reason"].includes(key)
      ))
      && ["expression", "decision_id"].every((key) => (
        Object.keys(args).includes(key)
      ))
      && (args.expression === "3D6" || args.expression === "2D6+6")
      && (args.reason === undefined || args.reason === null || typeof args.reason === "string")
      && typeof args.decision_id === "string"
      && args.decision_id.trim().length > 0
    );
  }

  private adaptiveCashSemanticMode(state: OpeningSetupState): boolean {
    return (
      state.characterSetupInputMode === "kp_guided_era_adaptive"
      || state.route.character_setup_input_mode === "kp_guided_era_adaptive"
      || state.route.character_setup_policy === "kp_guided_era_adaptive_no_source"
    );
  }

  private characterSetupAllowedActions(
    campaignId: string,
    includeSourceBriefing = true,
    inputMode: GuidedCharacterCreationInputMode | null = null,
  ): JsonObject[] {
    const actions: JsonObject[] = [
      {
        operation: "setup.adopt_source_facts",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        arguments_contract: "use the fully typed discovered operation schema",
        lifecycle_effect: "source facts only; not investigator completion",
      },
      {
        operation: "setup.investigator_contract",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        arguments: { campaign_id: campaignId },
      },
      {
        operation: "rules.roll_dice",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        exact_recipe: {
          expression: "3D6",
          purpose: "investigator_creation_luck",
          required: ["decision_id"],
          optional: ["reason"],
        },
      },
      {
        operation: "rules.cash_assets",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        required: ["credit_rating"],
        optional: ["period"],
        period_policy: (
          "omit to use the canonical campaign era; any explicit period must "
          + "equal setup.investigator_contract.result.campaign_binding.era"
        ),
      },
      {
        operation: "setup.invoke",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        kind: "investigator.create",
        contract_source: "setup.investigator_contract.result.payload_schema",
        required_creation_input_mode: (inputMode ?? "guided_quick_fire"),
      },
      {
        operation: "setup.invoke",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        kind: "campaign.link_investigator",
        required_payload_fields: ["campaign_id", "investigator_ids"],
        requires_current_opening_receipt: (
          `investigator.create:${inputMode ?? "guided_quick_fire"}`
        ),
      },
      {
        operation: "setup.invoke",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        kind: "investigator.render_card",
        required_payload_fields: ["campaign_id", "investigator_id"],
        optional_payload_fields: ["language", "html_mode"],
      },
    ];
    if (inputMode === "kp_guided_era_adaptive") {
      actions.splice(3, 0, {
        operation: "rules.roll_dice",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        exact_recipe: {
          expression: ["3D6", "2D6+6"],
          purpose: "omit for characteristic receipts; use the typed Luck action separately",
          required: ["decision_id"],
          optional: ["reason"],
        },
      }, {
        operation: "state.cash_semantic",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        required: ["record_id", "basis", "reason", "decision_id"],
        optional: ["investigator_id", "cash_description", "assets"],
        provenance: { kp_guided: true, cash_semantic: true },
        when: "rules.cash_assets reports no authoritative campaign-era table",
      });
    }
    if (includeSourceBriefing) {
      actions.splice(1, 0, {
        operation: "setup.invoke",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        kind: "campaign.render_briefing",
        payload: { campaign_id: campaignId },
      });
    }
    return actions;
  }

  // Single source of truth for investigator.create admission. The gate returns
  // these same tokens verbatim on rejection, so a refused KP is told which
  // field failed instead of being handed the route again. Field names and
  // schema-declared literals only — never payload values or source text.
  private investigatorCreatePayloadFailures(
    payload: JsonObject,
    route: OpeningSetupRoute,
    inputMode: GuidedCharacterCreationInputMode | null,
  ): string[] {
    const failures: string[] = [];
    const required = ["campaign_id", "investigator_id", "sheet", "creation"];
    for (const key of Object.keys(payload)) {
      if (!required.includes(key)) {
        failures.push(`payload.${key} is not an accepted field`);
      }
    }
    for (const key of required) {
      if (!Object.keys(payload).includes(key)) {
        failures.push(`payload.${key} is required`);
      }
    }
    if (payload.campaign_id !== route.campaign_id) {
      failures.push("payload.campaign_id must equal the current campaign id");
    }
    if (typeof payload.investigator_id !== "string") {
      failures.push("payload.investigator_id must be a string");
    }
    const creation = objectOrNull(payload.creation);
    const sheet = objectOrNull(payload.sheet);
    if (creation === null) failures.push("payload.creation must be an object");
    if (sheet === null) failures.push("payload.sheet must be an object");

    const luckReceipt = objectOrNull(creation?.luck_roll_receipt);
    if (luckReceipt === null) {
      failures.push(
        "creation.luck_roll_receipt must be an object with exactly "
        + "campaign_id, decision_id, and roll_id, quoting the roll_id returned "
        + "by the canonical rules.roll_dice Quick-Fire Luck receipt",
      );
    } else {
      if (!exactKeysMatch(luckReceipt, ["campaign_id", "decision_id", "roll_id"])) {
        failures.push(
          "creation.luck_roll_receipt must carry exactly campaign_id, "
          + "decision_id, and roll_id",
        );
      }
      if (luckReceipt.campaign_id !== route.campaign_id) {
        failures.push(
          "creation.luck_roll_receipt.campaign_id must equal the current "
          + "campaign id",
        );
      }
      if (
        typeof luckReceipt.decision_id !== "string"
        || luckReceipt.decision_id.trim().length === 0
      ) {
        failures.push(
          "creation.luck_roll_receipt.decision_id must be the non-empty "
          + "decision_id sent with the Quick-Fire Luck rules.roll_dice call",
        );
      }
      if (
        typeof luckReceipt.roll_id !== "string"
        || luckReceipt.roll_id.trim().length === 0
      ) {
        failures.push(
          "creation.luck_roll_receipt.roll_id must be the non-empty roll_id "
          + "field returned in that rules.roll_dice result",
        );
      }
    }
    if (!Number.isInteger(creation?.luck_roll_total)) {
      failures.push(
        "creation.luck_roll_total must be the integer total of that same roll",
      );
    }

    if (inputMode === "kp_guided_era_adaptive") {
      if (creation?.input_mode !== "kp_guided_era_adaptive") {
        failures.push('creation.input_mode must be "kp_guided_era_adaptive"');
      }
      if (creation?.era_adaptive !== true) {
        failures.push("creation.era_adaptive must be true");
      }
      if (creation?.kp_guided !== true) {
        failures.push("creation.kp_guided must be true");
      }
      if (typeof creation?.era !== "string") {
        failures.push("creation.era must be a string");
      }
      if (typeof creation?.method !== "string") {
        failures.push("creation.method must be a string");
      }
      if (sheet?.era_adaptive !== true) {
        failures.push("sheet.era_adaptive must be true");
      }
      if (sheet?.kp_guided !== true) {
        failures.push("sheet.kp_guided must be true");
      }
      if (sheet?.era !== creation?.era) {
        failures.push("sheet.era must equal creation.era");
      }
      if (objectOrNull(sheet?.occupation) === null) {
        failures.push("sheet.occupation must be an object");
      }
      if (objectOrNull(sheet?.skill_provenance) === null) {
        failures.push("sheet.skill_provenance must be an object");
      }
      return failures;
    }

    if (creation?.input_mode !== "guided_quick_fire") {
      failures.push('creation.input_mode must be "guided_quick_fire"');
    }
    if (creation?.method !== "quick_fire_array") {
      failures.push('creation.method must be "quick_fire_array"');
    }
    if (
      !Array.isArray(creation?.characteristic_assignment_order)
      || creation.characteristic_assignment_order.length !== 8
    ) {
      failures.push(
        "creation.characteristic_assignment_order must be an array of exactly "
        + "8 characteristic names",
      );
    }
    return failures;
  }

  // Rejection text for a create attempt the gate refused. Returns null when the
  // attempt is not an investigator.create the caller should explain, so the
  // caller falls back to the retained route.
  private openingInvestigatorCreateRejection(
    params: JsonObject,
    state: OpeningSetupState,
  ): string | null {
    if (state.characterSetupComplete) return null;
    if (!this.characterSetupAllowed(state)) return null;
    if (String(params.operation ?? "") !== "setup.invoke") return null;
    const args = objectOrNull(params.arguments);
    if (args === null || args.kind !== "investigator.create") return null;
    const route = state.route;
    const inputMode = state.characterSetupInputMode;
    const failures: string[] = [];
    if (params.campaign !== route.campaign_id) {
      failures.push("campaign must equal the current opening campaign id");
    }
    for (const key of Object.keys(args)) {
      if (key !== "kind" && key !== "payload") {
        failures.push(`arguments.${key} is not an accepted field`);
      }
    }
    const payload = objectOrNull(args.payload);
    if (payload === null) {
      failures.push("arguments.payload must be an object");
    } else {
      failures.push(
        ...this.investigatorCreatePayloadFailures(payload, route, inputMode),
      );
    }
    if (failures.length === 0) return null;
    // Failing fields first, retained route after: the KP needs the reason to
    // converge, and every gate rejection must still leave it holding the route.
    return (
      "setup.invoke investigator.create was refused because its payload does "
      + `not satisfy the ${inputMode ?? "guided_quick_fire"} branch the `
      + "contract selected for this campaign. Correct exactly these fields and "
      + `retry the same call: ${failures.join("; ")}. The complete accepted `
      + "shape is setup.investigator_contract.result.payload_schema, which the "
      + "current projection already returns whole for this branch; there is no "
      + "fuller schema to request. Retained route: "
      + JSON.stringify(route)
    );
  }

  private canonicalSetupInvokeForOpening(
    params: JsonObject,
    route: OpeningSetupRoute,
    inputMode: GuidedCharacterCreationInputMode | null = null,
  ): boolean {
    const args = objectOrNull(params.arguments);
    if (
      params.operation !== "setup.invoke"
      || params.campaign !== route.campaign_id
      || args === null
      || !exactKeysMatch(args, ["kind", "payload"])
      || typeof args.kind !== "string"
      || !OPENING_SETUP_CHARACTER_KINDS.has(args.kind)
    ) {
      return false;
    }
    const payload = objectOrNull(args.payload);
    if (payload === null) return false;
    if (args.kind === "investigator.create") {
      return this.investigatorCreatePayloadFailures(
        payload, route, inputMode,
      ).length === 0;
    }
    if (args.kind === "campaign.link_investigator") {
      const investigatorIds = payload.investigator_ids;
      return exactKeysMatch(
        payload,
        ["campaign_id", "investigator_ids"],
      )
        && payload.campaign_id === route.campaign_id
        && Array.isArray(investigatorIds)
        && investigatorIds.length > 0
        && investigatorIds.every((value) => (
          typeof value === "string" && value.trim().length > 0
        ))
        && new Set(investigatorIds).size === investigatorIds.length;
    }
    if (args.kind === "campaign.render_briefing") {
      const keys = Object.keys(payload);
      return (
        keys.every((key) => ["campaign_id", "language"].includes(key))
        && keys.includes("campaign_id")
        && payload.campaign_id === route.campaign_id
        && (
          payload.language === undefined
          || typeof payload.language === "string"
        )
      );
    }
    const keys = Object.keys(payload);
    return (
      keys.every((key) => (
        ["campaign_id", "investigator_id", "language", "html_mode"].includes(
          key,
        )
      ))
      && ["campaign_id", "investigator_id"].every((key) => keys.includes(key))
      && payload.campaign_id === route.campaign_id
      && typeof payload.investigator_id === "string"
    );
  }

  private linkMatchesCurrentGuidedCreates(
    params: JsonObject,
    state: OpeningSetupState,
  ): boolean {
    const args = objectOrNull(params.arguments);
    const payload = objectOrNull(args?.payload);
    const investigatorIds = payload?.investigator_ids;
    return (
      args?.kind === "campaign.link_investigator"
      && payload?.campaign_id === state.route.campaign_id
      && Array.isArray(investigatorIds)
      && investigatorIds.length > 0
      && investigatorIds.every((value) => {
        if (typeof value !== "string") return false;
        const receipt = state.guidedCreateReceipts.get(value);
        return (
          receipt !== undefined
          && receipt.campaignId === state.route.campaign_id
          && receipt.investigatorId === value
          && receipt.generation === state.generation
          && receipt.revision === state.revision
          && receipt.invocationId.length > 0
          && receipt.receiptSha256.startsWith("sha256:")
        );
      })
    );
  }

  private characterSetupAllowed(state: OpeningSetupState): boolean {
    return (
      state.route.startup_resume_policy !== "source_materialization_wait_only"
      && [
        "submitting",
        "materializing",
        "source_review",
        "reviewed",
        "retry",
        "projection",
        "ready",
      ].includes(state.phase)
    );
  }

  private openingSetupCharacterInvocation(
    params: JsonObject,
    state: OpeningSetupState,
  ): boolean {
    if (!this.characterSetupAllowed(state)) return false;
    const route = state.route;
    const operation = String(params.operation ?? "");
    if (params.campaign !== route.campaign_id) return false;
    if (state.characterSetupComplete) {
      const args = objectOrNull(params.arguments);
      return (
        operation === "setup.invoke"
        && args?.kind === "investigator.render_card"
        && this.canonicalSetupInvokeForOpening(
          params, route, state.characterSetupInputMode,
        )
      );
    }
    const setupArgs = objectOrNull(params.arguments);
    if (
      [
        "guided_quick_fire_no_source",
        "kp_guided_era_adaptive_no_source",
      ].includes(state.route.character_setup_policy ?? "")
      && operation === "setup.invoke"
      && setupArgs?.kind === "campaign.render_briefing"
    ) {
      return false;
    }
    if (
      operation === "setup.invoke"
      && setupArgs?.kind === "campaign.link_investigator"
    ) {
      return (
        this.canonicalSetupInvokeForOpening(
          params, route, state.characterSetupInputMode,
        )
        && this.linkMatchesCurrentGuidedCreates(params, state)
      );
    }
    if (operation === "setup.investigator_contract") {
      const args = objectOrNull(params.arguments);
      return args !== null
        && exactKeysMatch(args, ["campaign_id"])
        && args.campaign_id === route.campaign_id;
    }
    if (operation === "setup.adopt_source_facts") {
      const args = objectOrNull(params.arguments);
      return (
        args !== null
        && exactKeysMatch(args, ["campaign_id", "facts"])
        && args.campaign_id === route.campaign_id
        && objectOrNull(args.facts) !== null
      );
    }
    if (operation === "rules.cash_assets") {
      const args = objectOrNull(params.arguments);
      return (
        args !== null
        && Object.keys(args).every((key) => (
          ["credit_rating", "period"].includes(key)
        ))
        && Object.keys(args).includes("credit_rating")
        && Number.isInteger(args.credit_rating)
        && (
          args.period === undefined
          || typeof args.period === "string"
        )
      );
    }
    if (operation === "state.cash_semantic") {
      // Last era-adaptive consumer: admit whenever the adaptive route owns
      // character setup. Do not hard-gate on toolbox-owned shapes.
      return this.adaptiveCashSemanticMode(state);
    }
    return this.canonicalSetupInvokeForOpening(
      params, route, state.characterSetupInputMode,
    ) || (
      operation === "rules.roll_dice"
      && (
        this.quickFireLuckInvocation(params)
        || (
          state.characterSetupInputMode === "kp_guided_era_adaptive"
          && this.adaptiveCharacteristicRollInvocation(params)
        )
      )
    );
  }

  private exactCanonicalLinkReceipt(
    params: JsonObject,
    envelope: JsonObject | null,
  ): boolean {
    const args = objectOrNull(params.arguments);
    const payload = objectOrNull(args?.payload);
    const data = objectOrNull(envelope?.data);
    const result = objectOrNull(data?.result);
    const requestedIds = payload?.investigator_ids;
    const linkedIds = result?.investigator_ids;
    return (
      envelope?.ok === true
      && params.operation === "setup.invoke"
      && args?.kind === "campaign.link_investigator"
      && data?.schema_version === 1
      && data.status === "PASS"
      && data.kind === "campaign.link_investigator"
      && result !== null
      && exactKeysMatch(result, ["campaign_id", "investigator_ids"])
      && result.campaign_id === params.campaign
      && result.campaign_id === payload?.campaign_id
      && Array.isArray(requestedIds)
      && Array.isArray(linkedIds)
      && linkedIds.length === requestedIds.length
      && linkedIds.every((value, index) => value === requestedIds[index])
    );
  }

  private exactCanonicalCharacterSetupReceipt(
    operation: string,
    params: JsonObject,
    envelope: JsonObject | null,
    canonicalVisibleOutput: CanonicalSetupVisibleOutput | null,
  ): boolean {
    if (envelope?.ok !== true || envelope.tool !== operation) return false;
    const data = objectOrNull(envelope.data);
    const args = objectOrNull(params.arguments);
    if (data === null || args === null) return false;
    if (operation === "setup.investigator_contract") {
      const result = objectOrNull(data.result);
      return (
        data.schema_version === 1
        && data.status === "PASS"
        && data.kind === "investigator.contract"
        && result !== null
        && typeof result.ruleset_id === "string"
        && objectOrNull(result.payload_schema) !== null
      );
    }
    if (operation === "setup.adopt_source_facts") {
      const result = objectOrNull(data.result);
      const facts = objectOrNull(result?.facts);
      const unresolved = result?.unresolved_blocking_facts;
      const unblocked = result?.character_creation_unblocked;
      const moduleInitReady = result?.module_init_ready;
      const expectedBlocking = ["era", "place"].filter((name) => (
        objectOrNull(facts?.[name])?.status !== "source"
      ));
      return (
        data.schema_version === 1
        && data.status === "PASS"
        && data.kind === "campaign.adopt_source_facts"
        && result !== null
        && result.campaign_id === params.campaign
        && facts !== null
        && typeof unblocked === "boolean"
        && Array.isArray(unresolved)
        && unresolved.length === new Set(unresolved).size
        && unresolved.every((name) => (
          name === "era" || name === "place"
        ))
        && unresolved.length === expectedBlocking.length
        && unresolved.every((name, index) => name === expectedBlocking[index])
        && (
          moduleInitReady === undefined
            ? unblocked === (unresolved.length === 0)
            : typeof moduleInitReady === "boolean"
              && unblocked === (
                unresolved.length === 0 && moduleInitReady
              )
        )
      );
    }
    if (operation === "rules.roll_dice") {
      const rolls = data.rolls;
      return (
        args.expression === "3D6"
        && data.expression === args.expression
        && Array.isArray(rolls)
        && rolls.length === 3
        && rolls.every((roll) => (
          Number.isInteger(roll) && Number(roll) >= 1 && Number(roll) <= 6
        ))
        && Number.isInteger(data.total)
        && data.total === rolls.reduce(
          (sum, roll) => sum + Number(roll),
          0,
        )
        && typeof data.roll_id === "string"
        && data.roll_id.trim().length > 0
      );
    }
    if (operation !== "setup.invoke") return false;
    const kind = args.kind;
    const payload = objectOrNull(args.payload);
    const result = objectOrNull(data.result);
    if (
      typeof kind !== "string"
      || payload === null
      || data.schema_version !== 1
      || data.status !== "PASS"
      || data.kind !== kind
      || result === null
    ) {
      return false;
    }
    if (kind === "campaign.link_investigator") {
      return this.exactCanonicalLinkReceipt(params, envelope);
    }
    if (kind === "campaign.render_briefing") {
      return (
        canonicalVisibleOutput !== null
        && canonicalVisibleOutput.campaignId === params.campaign
        && canonicalVisibleOutput.sourceKind === kind
        && result.campaign_id === params.campaign
        && canonicalVisibleOutput.textSha256
          === canonicalJsonValueSha256(canonicalVisibleOutput.text)
      );
    }
    if (kind === "investigator.create") {
      return (
        typeof payload.investigator_id === "string"
        && result.investigator_id === payload.investigator_id
        && exactKeysMatch(result, ["investigator_id"])
      );
    }
    if (kind === "investigator.render_card") {
      return (
        result.campaign_id === params.campaign
        && result.investigator_id === payload.investigator_id
        && typeof result.markdown_path === "string"
      );
    }
    return false;
  }

  private canonicalCharacterSetupVisibleText(
    operation: string,
    params: JsonObject,
    envelope: JsonObject | null,
    canonicalVisibleOutput: CanonicalSetupVisibleOutput | null,
  ): string | null {
    if (
      !this.exactCanonicalCharacterSetupReceipt(
        operation,
        params,
        envelope,
        canonicalVisibleOutput,
      )
    ) {
      return null;
    }
    if (canonicalVisibleOutput !== null) {
      return canonicalVisibleOutput.text;
    }
    if (operation === "setup.investigator_contract") {
      return "请选择调查员的特征值生成方式，并继续确认职业与技能。";
    }
    if (operation === "setup.adopt_source_facts") {
      const result = objectOrNull(objectOrNull(envelope?.data)?.result);
      if (result?.character_creation_unblocked === true) {
        return "来源事实与建卡最小包已绑定并通过校验；现在可以读取调查员构建契约。";
      }
      if (result?.module_init_ready === false) {
        return "来源事实已记录，但建卡最小包 L0 尚未就绪；不要猜测预设卡、年代修正、开场钩子或手册。";
      }
      const unresolved = Array.isArray(result?.unresolved_blocking_facts)
        ? result.unresolved_blocking_facts
        : [];
      const labels = unresolved.map((name) => (
        name === "era" ? "年代（era）" : "地点（place）"
      ));
      return (
        `来源事实已记录，但 ${labels.join("、")} 仍未解决；`
        + "继续检查当前已绑定来源，暂不要调用调查员构建契约。"
      );
    }
    if (operation === "rules.roll_dice") {
      const data = objectOrNull(envelope?.data);
      const total = Number(data?.total);
      return `幸运骰结果为 ${total}，幸运值为 ${total * 5}。`;
    }
    const args = objectOrNull(params.arguments);
    if (args?.kind === "campaign.link_investigator") {
      return "调查员已正式加入战役。";
    }
    if (args?.kind === "investigator.create") {
      return "调查员资料已创建；请确认后加入战役。";
    }
    if (args?.kind === "investigator.render_card") {
      return "调查员角色卡已生成。";
    }
    return null;
  }

  private exactOpeningSetupRouteInvocation(
    route: OpeningSetupRoute,
    params: JsonObject,
  ): boolean {
    const card = route.next_operation;
    if (
      card === null
      || card.operation !== params.operation
      || params.campaign !== route.campaign_id
    ) {
      return false;
    }
    const args = objectOrNull(params.arguments);
    const prefilled = objectOrNull(card.prefilled_arguments);
    const missing = Array.isArray(card.missing_arguments)
      ? card.missing_arguments
      : null;
    if (
      args === null
      || prefilled === null
      || missing === null
      || missing.some((key) => typeof key !== "string" || !key)
    ) {
      return false;
    }
    const expectedKeys = [
      ...Object.keys(prefilled),
      ...(missing as string[]),
    ];
    if (!exactKeysMatch(args, expectedKeys)) return false;
    return Object.entries(prefilled).every(([key, value]) => (
      canonicalJsonValueSha256(args[key])
      === canonicalJsonValueSha256(value)
    ));
  }

  private openingEvidenceCard(): JsonObject {
    return {
      schema_version: 1,
      operation: "evidence.table_opening",
      invoke_via: "coc_invoke",
      prefilled_arguments: {},
      missing_arguments: [
        "text",
        "run_id",
        "presented_roll_ids",
        "decision_id",
      ],
      hard_gate: true,
      authority: "canonical_setup",
      reason: (
        "Record and return the exact source-backed pre-turn opening, including "
        + "the canonical current opening-time anchor."
      ),
    };
  }

  private exactOpeningActivationCard(value: unknown): JsonObject | null {
    const card = objectOrNull(value);
    const prefilled = objectOrNull(card?.prefilled_arguments);
    const missing = card?.missing_arguments;
    return (
      card !== null
      && card.operation === "state.move_scene"
      && card.invoke_via === "coc_invoke"
      && prefilled !== null
      && typeof prefilled.scene_id === "string"
      && prefilled.scene_id.length > 0
      && prefilled.defer_initial_progressive_on_enter === true
      && Array.isArray(missing)
      && missing.length === 1
      && missing[0] === "decision_id"
      && card.authority === "advisory"
      && card.hard_gate === false
    )
      ? structuredClone(card)
      : null;
  }

  private projectOpeningEvidenceRoute(
    envelope: JsonObject,
    route: OpeningSetupRoute,
  ): JsonObject {
    const projected = structuredClone(envelope);
    const projectedData = objectOrNull(projected.data);
    if (projectedData !== null) {
      delete projectedData.activation_operation;
      projectedData.activation_allowed = false;
      projectedData.next_operation = structuredClone(route.next_operation);
      projectedData.opening_gate = structuredClone(route);
    }
    return projected;
  }

  private projectOpeningActivation(
    envelope: JsonObject,
    activationCard: JsonObject | null,
  ): JsonObject {
    if (activationCard === null) return envelope;
    const projected = structuredClone(envelope);
    const projectedData = objectOrNull(projected.data);
    if (projectedData !== null) {
      projectedData.activation_operation = structuredClone(activationCard);
      projectedData.next_operation = structuredClone(activationCard);
    }
    return projected;
  }

  private armOpeningEvidenceRoute(state: OpeningSetupState): void {
    state.phase = "opening_evidence";
    state.route = {
      ...state.route,
      phase: "opening_table_evidence_required",
      next_operation: this.openingEvidenceCard(),
      allowed_actions: undefined,
      instruction: (
        "draft the source-backed opening without restating or reversing the "
        + "authoritative scene.context.time anchor; invoke this exact retained "
        + "evidence.table_opening card, then deliver only its returned data.text"
      ),
    };
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
  }

  private armOpeningSelectionRoute(state: OpeningSetupState): void {
    state.phase = "selection";
    state.route = {
      ...state.route,
      phase: "opening_selection",
      next_operation: {
        schema_version: 1,
        operation: "progressive.prepare_opening",
        invoke_via: "coc_invoke",
        prefilled_arguments: {},
        missing_arguments: [],
        hard_gate: true,
        authority: "canonical_setup",
        reason: (
          "Select the shortest sufficient reviewed source opening before play."
        ),
      },
      allowed_actions: undefined,
      instruction: (
        "the reviewed source is ready; invoke this exact retained "
        + "progressive.prepare_opening card before projection or narration"
      ),
    };
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
  }

  private retainReviewedSourceUntilCharacterLink(
    state: OpeningSetupState,
  ): void {
    state.phase = "reviewed";
    state.route = {
      ...state.route,
      phase: "opening_character_setup_required",
      next_operation: null,
      allowed_actions: this.characterSetupAllowedActions(
        state.route.campaign_id,
        true,
        state.characterSetupInputMode,
      ),
      instruction: (
        "opening source review is complete; finish the exact canonical "
        + "investigator link, then continue with opening preparation"
      ),
    };
    state.continuationReleaseOwner = null;
  }

  private retainOpeningProjectionUntilCharacterLink(
    state: OpeningSetupState,
  ): void {
    state.phase = "projection";
    state.route = {
      ...state.route,
      phase: "opening_character_setup_required",
      next_operation: null,
      allowed_actions: this.characterSetupAllowedActions(
        state.route.campaign_id,
        true,
        state.characterSetupInputMode,
      ),
      instruction: (
        "opening source work is fulfilled, but its projection card remains "
        + "private until the old setup order completes: render the public "
        + "briefing, create the investigator, then record the exact canonical "
        + "campaign.link_investigator receipt"
      ),
    };
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
  }

  private recoveredCurrentCharacterSetupRoute(
    campaignId: string,
    inputMode: GuidedCharacterCreationInputMode = "guided_quick_fire",
  ): OpeningSetupRoute {
    if (inputMode === "kp_guided_era_adaptive") {
      return {
        schema_version: 1,
        status: "blocked",
        hard_gate: true,
        activation_allowed: false,
        phase: "opening_character_setup_required",
        campaign_id: campaignId,
        next_operation: null,
        allowed_actions: this.characterSetupAllowedActions(
          campaignId, false, inputMode,
        ),
        character_setup_policy: "kp_guided_era_adaptive_no_source",
        character_setup_input_mode: inputMode,
        instruction: (
          "the source-bound opening is current but no investigator is linked; "
          + "complete only the retained KP-guided era-adaptive create and exact "
          + "campaign.link_investigator sequence before opening play"
        ),
      };
    }
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_character_setup_required",
      campaign_id: campaignId,
      next_operation: null,
      allowed_actions: this.characterSetupAllowedActions(campaignId, false),
      character_setup_policy: "guided_quick_fire_no_source",
      instruction: (
        "the source-bound opening is current but no investigator is linked; "
        + "complete only the retained guided Quick-Fire create and exact "
        + "campaign.link_investigator sequence before opening play"
      ),
    };
  }

  private safeRecoveredCharacterSetupProjection(
    campaignId: string,
    route: OpeningSetupRoute,
  ): JsonObject {
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: campaignId,
        mode: "opening_character_setup_required",
        opening_gate: route,
      },
      warnings: [],
      hints: [
        "follow only opening_gate.allowed_actions until the exact current "
        + "guided create and campaign.link_investigator receipts succeed",
      ],
    };
  }

  private recoveredSourceMaterializationRoute(
    campaignId: string,
    rearm: JsonObject | null = null,
    instruction = "",
  ): OpeningSetupRoute {
    if (rearm !== null) {
      // The lifecycle is not waiting, it is asking for an exact recovery call:
      // carry that card and do NOT set source_materialization_wait_only, which
      // would keep blocking the very operation that recovers the campaign.
      return {
        schema_version: 1,
        status: "blocked",
        hard_gate: true,
        activation_allowed: false,
        phase: "opening_source_materialization",
        campaign_id: campaignId,
        next_operation: structuredClone(rearm),
        instruction: (
          instruction.trim().length > 0
            ? instruction
            : "invoke this exact retained opening recovery card before any "
              + "other setup or play operation"
        ),
      };
    }
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_source_materialization",
      campaign_id: campaignId,
      next_operation: null,
      startup_resume_policy: "source_materialization_wait_only",
      instruction: (
        "the retained opening source lifecycle is still pending; wait for its "
        + "canonical host terminal event before any setup or play operation"
      ),
    };
  }

  projectGuidedCharacterContract(
    operation: string,
    params: JsonObject,
    value: unknown,
  ): unknown {
    if (operation !== "setup.investigator_contract") return value;
    const campaignId = typeof params.campaign === "string"
      ? params.campaign
      : "";
    const state = this.openingSetupStates.get(campaignId);
    if (
      state === undefined
      || state.characterSetupComplete
      || !this.characterSetupAllowed(state)
    ) {
      return value;
    }
    const projected = projectPiGuidedCharacterContract(value, campaignId);
    const contract = objectOrNull(objectOrNull(
      objectOrNull(projected)?.data,
    )?.result);
    const inputMode = contract?.applicable_input_mode;
    if (
      inputMode === "guided_quick_fire"
      || inputMode === "kp_guided_era_adaptive"
    ) {
      state.characterSetupInputMode = inputMode;
      state.route = {
        ...state.route,
        allowed_actions: this.characterSetupAllowedActions(
          state.route.campaign_id,
          true,
          inputMode,
        ),
      };
    }
    return projected;
  }

  private armOpeningProjectionRoute(state: OpeningSetupState): void {
    if (state.projectionCard === null) return;
    state.phase = "projection";
    state.route = {
      ...state.route,
      phase: "opening_projection_required",
      next_operation: state.projectionCard,
      allowed_actions: this.characterSetupAllowedActions(
        state.route.campaign_id,
      ).filter((action) => action.kind === "investigator.render_card"),
      instruction: (
        "character creation and the exact canonical investigator link are "
        + "current; invoke this exact retained projection card before live play"
      ),
    };
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
  }

  private exactTableOpeningReceipt(
    envelope: JsonObject | null,
  ): boolean {
    const data = objectOrNull(envelope?.data);
    return (
      envelope?.ok === true
      && envelope.tool === "evidence.table_opening"
      && data !== null
      && data.turn === 0
      && typeof data.text === "string"
      && data.text.length > 0
      && typeof data.text_sha256 === "string"
      && data.text_sha256 === canonicalJsonValueSha256(data.text)
      && objectOrNull(data.authoritative_time_anchor) !== null
    );
  }

  private routeFromGate(gate: JsonObject): OpeningSetupRoute | null {
    if (
      gate.hard_gate !== true
      || gate.activation_allowed !== false
      || typeof gate.phase !== "string"
      || typeof gate.campaign_id !== "string"
      || !gate.campaign_id
    ) {
      return null;
    }
    const nextOperation = gate.next_operation === null
      ? null
      : objectOrNull(gate.next_operation);
    if (gate.next_operation !== null && nextOperation === null) return null;
    const inputMode = (
      gate.character_setup_input_mode === "kp_guided_era_adaptive"
      || gate.character_setup_input_mode === "guided_quick_fire"
    )
      ? gate.character_setup_input_mode
      : gate.character_setup_policy === "kp_guided_era_adaptive"
        ? "kp_guided_era_adaptive"
        : null;
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: gate.phase,
      campaign_id: gate.campaign_id,
      next_operation: nextOperation,
      ...(inputMode === "kp_guided_era_adaptive"
        ? {
            character_setup_policy: "kp_guided_era_adaptive_no_source" as const,
            character_setup_input_mode: inputMode,
          }
        : {}),
      instruction: typeof gate.instruction === "string"
        ? gate.instruction
        : "invoke the exact retained canonical setup route",
    };
  }

  private exactCanonicalProjectionRefreshCard(
    card: JsonObject | null,
  ): boolean {
    if (
      card === null
      || card.operation !== "progressive.project_opening"
      || card.invoke_via !== "coc_invoke"
      || card.hard_gate !== true
      || card.authority !== "canonical_setup"
      || !Array.isArray(card.missing_arguments)
      || card.missing_arguments.length !== 0
    ) return false;
    const prefilled = objectOrNull(card.prefilled_arguments);
    if (prefilled === null) return false;
    const pages = prefilled.opening_pdf_indices;
    if (!exactKeysMatch(
      prefilled,
      pages === undefined
        ? ["asset_root_id", "source_file_sha256", "start_location_id"]
        : [
          "asset_root_id", "source_file_sha256", "start_location_id",
          "opening_pdf_indices",
        ],
    )) return false;
    return (
      typeof prefilled.asset_root_id === "string"
      && prefilled.asset_root_id.trim().length > 0
      && typeof prefilled.source_file_sha256 === "string"
      && prefilled.source_file_sha256.trim().length === 64
      && typeof prefilled.start_location_id === "string"
      && prefilled.start_location_id.trim().length > 0
      && (
        pages === undefined
        || (
          Array.isArray(pages)
          && pages.length > 0
          && pages.every((page) => (
            Number.isInteger(page) && Number(page) >= 0
          ))
          && new Set(pages).size === pages.length
        )
      )
    );
  }

  reconcileCanonicalOpeningRefresh(
    params: JsonObject,
    value: unknown,
    invocationId: string,
  ): boolean {
    const attempt = this.openingSetupAttempts.get(invocationId);
    const state = typeof params.campaign === "string"
      ? this.openingSetupStates.get(params.campaign)
      : undefined;
    const envelope = objectOrNull(value);
    const error = objectOrNull(envelope?.error);
    const gate = objectOrNull(error?.details);
    const route = gate === null ? null : this.routeFromGate(gate);
    const card = route?.next_operation ?? null;
    if (
      attempt === undefined
      || state === undefined
      || !this.attemptMatchesState(attempt, state)
      || attempt.attemptClass !== "route"
      || attempt.operation !== "evidence.table_opening"
      || state.phase !== "opening_evidence"
      || state.characterSetupComplete !== true
      || state.route.next_operation?.operation !== "evidence.table_opening"
      || params.operation !== attempt.operation
      || this.setupInvocationCampaignId(params) !== attempt.campaignId
      || envelope?.ok !== false
      || envelope.tool !== attempt.operation
      || error?.code !== "opening_setup_incomplete"
      || gate === null
      || gate.campaign_id !== attempt.campaignId
      || gate.source_lifecycle_status !== "complete"
      || route === null
      || route.phase !== "opening_source_materialization"
      || route.campaign_id !== attempt.campaignId
      || card === null
      || !this.exactCanonicalProjectionRefreshCard(card)
    ) return false;

    this.supersedeOpeningSetupRevisionAttempts(state, invocationId);
    this.finalizeOpeningSetupAttempt(invocationId);
    state.route = route;
    state.revision += 1;
    state.phase = "projection";
    state.projectionCard = structuredClone(card);
    state.activationCard = null;
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(attempt.campaignId);
    this.openingSetupVisibleOutputAuthorization = null;
    this.recordOpeningSetupAudit({
      status: "transitioned",
      transition: "canonical_opening_projection_refresh",
      campaign_id: attempt.campaignId,
      generation: state.generation,
      from_revision: attempt.revision,
      to_revision: state.revision,
      from_phase: "opening_evidence",
      to_phase: route.phase,
      invocation_id: invocationId,
    });
    return true;
  }

  private exactPrepareCard(card: JsonObject | null): boolean {
    return (
      card !== null
      && card.operation === "progressive.prepare_opening"
      && card.invoke_via === "coc_invoke"
      && card.hard_gate === true
      && card.authority === "canonical_setup"
      && objectOrNull(card.prefilled_arguments) !== null
      && exactKeysMatch(
        objectOrNull(card.prefilled_arguments)!,
        [],
      )
      && Array.isArray(card.missing_arguments)
      && card.missing_arguments.length === 0
    );
  }

  private validOpeningStartLocation(value: unknown): boolean {
    const location = objectOrNull(value);
    if (
      location === null
      || !exactKeysMatch(location, ["location_id", "title"])
      || typeof location.location_id !== "string"
      || typeof location.title !== "string"
    ) {
      return false;
    }
    const locationId = location.location_id;
    const title = location.title;
    const titleLength = Array.from(title).length;
    return (
      locationId === locationId.trim()
      && title === title.trim()
      && OPENING_START_LOCATION_ID.test(locationId)
      && titleLength >= 1
      && titleLength <= 240
    );
  }

  private validOpeningPdfIndices(value: unknown): boolean {
    if (
      !Array.isArray(value)
      || value.length < 1
      || value.length > 3
      || value.some((row) => !Number.isInteger(row) || row < 0)
      || new Set(value).size !== value.length
    ) {
      return false;
    }
    return value.every((row, index) => (
      index === 0 || row === value[index - 1] + 1
    ));
  }

  private exactBootstrapCard(card: JsonObject | null): boolean {
    if (
      card === null
      || card.operation !== "progressive.opening_bootstrap"
      || card.invoke_via !== "coc_invoke"
      || card.hard_gate !== true
      || card.authority !== "canonical_setup"
    ) {
      return false;
    }
    const prefilled = objectOrNull(card.prefilled_arguments);
    const missing = Array.isArray(card.missing_arguments)
      ? card.missing_arguments
      : null;
    if (
      prefilled === null
      || missing === null
      || missing.some((key) => (
        typeof key !== "string"
        || !["start_location", "opening_pdf_indices"].includes(key)
      ))
    ) {
      return false;
    }
    const combined = [...Object.keys(prefilled), ...(missing as string[])];
    if (
      combined.length === 2
      && new Set(combined).size === 2
      && combined.includes("start_location")
      && combined.includes("opening_pdf_indices")
    ) {
      return (
        (
          !Object.hasOwn(prefilled, "start_location")
          || this.validOpeningStartLocation(prefilled.start_location)
        )
        && (
          !Object.hasOwn(prefilled, "opening_pdf_indices")
          || this.validOpeningPdfIndices(prefilled.opening_pdf_indices)
        )
      );
    }
    return false;
  }

  private recoveryRoute(campaignId: string): OpeningSetupRoute {
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_source_contract_invalid",
      campaign_id: campaignId,
      next_operation: {
        schema_version: 1,
        operation: "progressive.prepare_opening",
        invoke_via: "coc_invoke",
        prefilled_arguments: {},
        missing_arguments: [],
        hard_gate: true,
        authority: "canonical_setup",
        reason: (
          "Revalidate the repaired source contract before selecting the "
          + "source-authored opening."
        ),
      },
      instruction: (
        "repair the persisted source contract, then invoke the exact retained "
        + "progressive.prepare_opening recovery card"
      ),
    };
  }

  private scenarioBindInvocation(params: JsonObject): boolean {
    const args = objectOrNull(params.arguments);
    return (
      params.operation === "setup.invoke"
      && args?.kind === "scenario.bind_pdf"
      && objectOrNull(args.payload) !== null
    );
  }

  private existingCampaignSetupError(params: JsonObject): string | null {
    if (params.operation !== "setup.invoke") return null;
    const args = objectOrNull(params.arguments);
    const payload = objectOrNull(args?.payload);
    const kind = typeof args?.kind === "string" ? args.kind : "";
    if (!EXISTING_CAMPAIGN_SETUP_KINDS.has(kind)) return null;
    const outerCampaign = typeof params.campaign === "string"
      ? params.campaign
      : "";
    const payloadCampaign = typeof payload?.campaign_id === "string"
      ? payload.campaign_id
      : "";
    if (
      outerCampaign.trim().length > 0
      && payloadCampaign.trim().length > 0
      && outerCampaign === payloadCampaign
    ) {
      return null;
    }
    const retained = payloadCampaign
      ? {
        operation: "setup.invoke",
        campaign: payloadCampaign,
        arguments: args,
      }
      : null;
    return (
      `${kind || "campaign-bound setup.invoke"} requires a non-empty top-level `
      + "campaign exactly equal to arguments.payload.campaign_id before "
      + "canonical execution; retry only this corrected call: "
      + JSON.stringify(retained)
    );
  }

  private setupInvocationCampaignId(params: JsonObject): string | null {
    if (typeof params.campaign === "string" && params.campaign.length > 0) {
      return params.campaign;
    }
    if (params.operation !== "setup.invoke") return null;
    const args = objectOrNull(params.arguments);
    if (args?.kind !== "campaign.create") return null;
    const payload = objectOrNull(args.payload);
    return (
      typeof payload?.campaign_id === "string"
      && payload.campaign_id.length > 0
    )
      ? payload.campaign_id
      : null;
  }

  private noteOpeningSetupTurnCampaign(campaignId: string): void {
    if (this.openingSetupTurnCampaignId === null) {
      this.openingSetupTurnCampaignId = campaignId;
      return;
    }
    if (this.openingSetupTurnCampaignId !== campaignId) {
      this.openingSetupTurnCampaignAmbiguous = true;
    }
  }

  private registerOpeningSetupAttempt(
    invocationId: string,
    params: JsonObject,
    attemptClass: OpeningSetupAttempt["attemptClass"],
    state: OpeningSetupState | null,
  ): void {
    const campaignId = this.setupInvocationCampaignId(params);
    if (campaignId === null) {
      throw new Error("opening setup attempt campaign identity is unavailable");
    }
    const generationSequence = state?.generationSequence
      ?? ++this.openingSetupGenerationSequence;
    const generation = state?.generation
      ?? `${campaignId}:${generationSequence}`;
    if (state === null && attemptClass === "bind") {
      this.openingSetupLatestIssuedGeneration.set(
        campaignId,
        generationSequence,
      );
    }
    this.noteOpeningSetupTurnCampaign(campaignId);
    this.openingSetupAttempts.set(invocationId, {
      invocationId,
      campaignId,
      generation,
      generationSequence,
      revision: state?.revision ?? null,
      operation: String(params.operation),
      attemptClass,
      agentTurn: this.openingSetupAgentTurn,
      dispatchIdentity: null,
    });
  }

  private resultCampaignMismatch(
    attempt: OpeningSetupAttempt,
    envelope: JsonObject | null,
    returnedGate: JsonObject | null,
  ): boolean {
    const data = objectOrNull(envelope?.data);
    const task = findAutoDispatchTask(envelope);
    const packet = task === null ? null : objectOrNull(task.packet);
    const explicit = [
      returnedGate?.campaign_id,
      data?.campaign_id,
      packet?.campaign_id,
    ].filter((value) => typeof value === "string");
    return explicit.some((value) => value !== attempt.campaignId);
  }

  private attemptMatchesState(
    attempt: OpeningSetupAttempt,
    state: OpeningSetupState | undefined,
  ): state is OpeningSetupState {
    return (
      state !== undefined
      && attempt.generation === state.generation
      && attempt.revision === state.revision
    );
  }

  private unboundAttemptIsFresh(attempt: OpeningSetupAttempt): boolean {
    const newerThanRetired = (
      attempt.generationSequence !== null
      && attempt.generationSequence > (
        this.openingSetupRetiredGeneration.get(attempt.campaignId) ?? 0
      )
    );
    if (!newerThanRetired) return false;
    if (attempt.attemptClass !== "bind") return true;
    return attempt.generationSequence === (
      this.openingSetupLatestIssuedGeneration.get(attempt.campaignId)
      ?? -1
    );
  }

  private initializeOpeningSetupState(
    campaignId: string,
    route: OpeningSetupRoute,
    phase: OpeningSetupState["phase"],
    attempt: OpeningSetupAttempt,
  ): OpeningSetupState {
    if (
      attempt.generation === null
      || attempt.generationSequence === null
    ) {
      throw new Error("opening setup generation identity is unavailable");
    }
    const state: OpeningSetupState = {
      route,
      generation: attempt.generation,
      generationSequence: attempt.generationSequence,
      revision: 1,
      phase,
      dispatchIdentity: null,
      characterSetupComplete: false,
      characterSetupInputMode: (
        route.character_setup_input_mode ?? null
      ),
      guidedCreateReceipts: new Map<string, OpeningGuidedCreateReceipt>(),
      projectionCard: null,
      activationCard: null,
      bootstrapRetryCard: null,
      continuationReleaseOwner: null,
      backgroundTerminalReceipt: null,
      bindBriefing: null,
    };
    this.openingSetupStates.set(campaignId, state);
    this.openingSetupContinuationQueued.delete(campaignId);
    return state;
  }

  private transitionContractInvalid(
    state: OpeningSetupState,
    attempt: OpeningSetupAttempt,
  ): OpeningSetupState {
    const next = {
      ...state,
      route: this.recoveryRoute(state.route.campaign_id),
      revision: state.revision + 1,
      phase: "contract_invalid" as const,
      dispatchIdentity: null,
      continuationReleaseOwner: null,
      backgroundTerminalReceipt: null,
      characterSetupInputMode: null,
      guidedCreateReceipts: new Map<string, OpeningGuidedCreateReceipt>(),
    };
    this.openingSetupStates.set(state.route.campaign_id, next);
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
    this.recordOpeningSetupAudit({
      status: "transitioned",
      transition: "source_contract_invalid",
      campaign_id: state.route.campaign_id,
      generation: state.generation,
      from_revision: attempt.revision,
      to_revision: next.revision,
      invocation_id: attempt.invocationId,
    });
    return next;
  }

  openingSetupToolError(
    name: string,
    params: JsonObject,
    invocationId = `direct:${this.openingSetupAttempts.size + 1}`,
  ): string | null {
    if (name === "coc_discover" || name === "coc_progressive_ocr") {
      const state = this.openingSetupStateForTranscript();
      if (
        state === null
        && this.openingSetupStates.size === 0
        && !this.pendingBindExists()
      ) {
        return null;
      }
      const route = state?.route ?? null;
      return (
        `${name} is unavailable while the Pi opening setup hard gate is active; `
        + `follow this exact retained route: ${JSON.stringify(route)}`
      );
    }
    if (!isCanonicalInvokeSurface(name)) return null;
    const setupOwnershipError = this.existingCampaignSetupError(params);
    if (setupOwnershipError !== null) return setupOwnershipError;
    const operation = String(params.operation ?? "");
    const campaignId = this.setupInvocationCampaignId(params);
    if (campaignId === null) {
      if (OWNED_OPENING_ROUTE_OPERATIONS.has(operation)) {
        return (
          `${operation} requires a top-level campaign and an owned exact Pi `
          + "opening route before canonical execution"
        );
      }
      if (this.openingSetupStates.size === 0) return null;
      return "campaign-bound Pi opening setup requires the exact campaign id";
    }
    if (this.openingSetupAttempts.has(invocationId)) {
      this.recordOpeningSetupAudit({
        status: "rejected",
        reason: "duplicate_invocation_identity",
        campaign_id: campaignId,
        invocation_id: invocationId,
      });
      return "Pi opening setup invocation identity was already admitted";
    }
    const campaignAttemptCount = [...this.openingSetupAttempts.values()]
      .filter((attempt) => attempt.campaignId === campaignId).length;
    if (campaignAttemptCount >= MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN) {
      this.recordOpeningSetupAudit({
        status: "rejected",
        reason: "campaign_attempt_limit",
        campaign_id: campaignId,
        attempt_limit: MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN,
      });
      return "Pi opening setup has too many concurrent campaign attempts";
    }
    const state = this.openingSetupStates.get(campaignId) ?? null;
    if (state === null) {
      if (OWNED_OPENING_ROUTE_OPERATIONS.has(operation)) {
        return (
          `${operation} has no owned Pi opening route for campaign `
          + `${campaignId}; invoke the corrected campaign-bound `
          + "scenario.bind_pdf call first and follow its exact retained "
          + "progressive.prepare_opening card"
        );
      }
      if (
        this.pendingBindExistsForCampaign(campaignId)
        && !this.scenarioBindInvocation(params)
      ) {
        return (
          "Pi opening setup is waiting for the newest admitted scenario bind "
          + `for campaign ${campaignId}`
        );
      }
      this.registerOpeningSetupAttempt(
        invocationId,
        params,
        this.scenarioBindInvocation(params) ? "bind" : "probe",
        null,
      );
      return null;
    }
    this.noteOpeningSetupTurnCampaign(campaignId);
    if (this.exactOpeningSetupRouteInvocation(state.route, params)) {
      if (
        state.phase === "projection"
        && !state.characterSetupComplete
      ) {
        return (
          "progressive.project_opening remains retained until the exact "
          + "canonical campaign.link_investigator receipt is current"
        );
      }
      this.registerOpeningSetupAttempt(invocationId, params, "route", state);
      this.openingSetupContinuationQueued.add(campaignId);
      return null;
    }
    if (this.openingSetupCharacterInvocation(params, state)) {
      this.registerOpeningSetupAttempt(
        invocationId,
        params,
        "character",
        state,
      );
      return null;
    }
    if (
      operation === "rules.roll_dice"
      && this.characterSetupAllowed(state)
    ) {
      if (state.characterSetupInputMode === "kp_guided_era_adaptive") {
        return (
          "rules.roll_dice for the active era-adaptive contract must use "
          + "3D6 or 2D6+6 with decision_id and optional reason (no purpose), "
          + "or the typed 3D6 investigator_creation_luck recipe for Luck"
        );
      }
      const args = objectOrNull(params.arguments);
      const decisionId = (
        typeof args?.decision_id === "string"
        && args.decision_id.trim().length > 0
      )
        ? args.decision_id
        : `quick-fire-luck-${campaignId}`;
      return (
        "rules.roll_dice is restricted to the exact Quick-Fire Luck creation "
        + "recipe while character creation overlaps opening parsing; retry "
        + "this retained call without changing its arguments: "
        + JSON.stringify({
          operation: "rules.roll_dice",
          campaign: campaignId,
          arguments: {
            expression: "3D6",
            decision_id: decisionId,
            purpose: "investigator_creation_luck",
            reason: "Quick-Fire investigator Luck",
          },
        })
      );
    }
    if (state.route.next_operation?.operation === params.operation) {
      this.openingSetupContinuationQueued.delete(campaignId);
    }
    const createRejection = this.openingInvestigatorCreateRejection(
      params, state,
    );
    if (createRejection !== null) return createRejection;
    return (
      `${String(params.operation || "coc_invoke")} is unavailable while the `
      + "Pi opening setup hard gate is active; follow this exact retained "
      + `route: ${JSON.stringify(state.route)}`
    );
  }

  observeOpeningSetupInvocation(
    operation: string,
    params: JsonObject,
    value: unknown,
    invocationId = "",
    canonicalVisibleOutput: CanonicalSetupVisibleOutput | null = null,
  ): OpeningSetupObservationDisposition {
    const attempt = this.openingSetupAttempts.get(invocationId);
    if (attempt === undefined) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "unowned_result",
        operation,
        invocation_id: invocationId,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "unowned_result",
      };
    }
    const envelope = objectOrNull(value);
    const data = objectOrNull(envelope?.data);
    const error = objectOrNull(envelope?.error);
    const details = objectOrNull(error?.details);
    const returnedGate = objectOrNull(data?.opening_gate)
      ?? (details?.hard_gate === true ? details : null);
    if (
      attempt.operation !== operation
      || this.setupInvocationCampaignId(params) !== attempt.campaignId
      || this.resultCampaignMismatch(attempt, envelope, returnedGate)
    ) {
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "invocation_or_campaign_mismatch",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "invocation_or_campaign_mismatch",
      };
    }

    if (attempt.attemptClass === "bind") {
      if (
        this.openingSetupStates.has(attempt.campaignId)
        || !this.unboundAttemptIsFresh(attempt)
      ) {
        this.finalizeOpeningSetupAttempt(invocationId);
        this.recordOpeningSetupAudit({
          status: "ignored",
          reason: "late_bind_outside_current_route_generation",
          campaign_id: attempt.campaignId,
          invocation_id: invocationId,
        });
        return {
          accepted: false,
          dispatchAllowed: false,
          reason: "late_bind_outside_current_route_generation",
        };
      }
      const route = returnedGate === null
        ? null
        : this.routeFromGate(returnedGate);
      if (
        envelope?.ok === true
        && route !== null
        && (
          (
            route.phase === "opening_selection"
            && this.exactPrepareCard(route.next_operation)
          )
          || (
            route.phase === "opening_source_review_required"
            && route.next_operation === null
          )
        )
      ) {
        const sourceReviewRequired = (
          route.phase === "opening_source_review_required"
        );
        if (sourceReviewRequired) {
          route.allowed_actions = this.characterSetupAllowedActions(
            attempt.campaignId,
          );
        }
        const initialized = this.initializeOpeningSetupState(
          attempt.campaignId,
          route,
          sourceReviewRequired ? "source_review" : "selection",
          attempt,
        );
        if (
          canonicalVisibleOutput?.campaignId === attempt.campaignId
          && canonicalVisibleOutput.sourceKind === "scenario.bind_pdf"
          && canonicalVisibleOutput.textSha256
            === canonicalJsonValueSha256(canonicalVisibleOutput.text)
        ) {
          initialized.bindBriefing = { ...canonicalVisibleOutput };
          this.authorizeOpeningSetupConversationalOutput(
            initialized,
            attempt,
            (
              `scenario.bind_pdf:${canonicalVisibleOutput.publicSetupSha256}`
            ),
          );
        }
        this.finalizeOpeningSetupAttempt(invocationId);
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: sourceReviewRequired
            ? "bind_opening_source_review_required"
            : "bind_opening_selection",
        };
      } else if (
        returnedGate?.phase === "opening_source_contract_invalid"
      ) {
        const invalid = this.initializeOpeningSetupState(
          attempt.campaignId,
          this.recoveryRoute(attempt.campaignId),
          "contract_invalid",
          attempt,
        );
        this.markOpeningSetupTerminalBlocker(
          envelope ?? failedBlockingOpeningEnvelope(
            {
              status: "terminal_failure",
              failure_class: "source_contract_invalid",
            },
            "opening_source_contract_invalid",
          ),
          undefined,
          attempt.campaignId,
          invalid,
        );
        this.finalizeOpeningSetupAttempt(invocationId);
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "bind_source_contract_invalid",
        };
      }
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "bind_result_invalid",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "bind_result_invalid",
      };
    }

    let state = this.openingSetupStates.get(attempt.campaignId);
    const preboundRoute = returnedGate === null
      ? null
      : this.routeFromGate(returnedGate);
    const exactProjectedResumeError = (
      envelope !== null
      && exactKeysMatch(envelope, ["ok", "tool", "error"])
      && envelope.ok === false
      && envelope.tool === "session.resume"
      && error !== null
      && exactKeysMatch(error, ["code", "details"])
      && error.code === "opening_setup_incomplete"
      && details === returnedGate
    );
    const canonicalPreboundProbe = (
      attempt.attemptClass === "probe"
      && this.unboundAttemptIsFresh(attempt)
      && preboundRoute !== null
      && preboundRoute.phase === "opening_selection"
      && this.exactPrepareCard(preboundRoute.next_operation)
      && (
        (
          operation === "session.resume"
          && envelope?.ok === false
          && envelope.tool === "session.resume"
          && error?.code === "opening_setup_incomplete"
          && details === returnedGate
        )
        || (
          operation === "setup.investigator_contract"
          && envelope?.ok === true
          && objectOrNull(data?.opening_gate) === returnedGate
        )
      )
    );
    const canonicalCharacterSetupInputMode = (
      returnedGate?.character_setup_policy === "kp_guided_era_adaptive"
      && returnedGate?.character_setup_input_mode === "kp_guided_era_adaptive"
    )
      ? "kp_guided_era_adaptive"
      : returnedGate?.character_setup_policy === "guided_quick_fire"
        ? "guided_quick_fire"
        : null;
    const canonicalCharacterSetupProbe = (
      attempt.attemptClass === "probe"
      && operation === "session.resume"
      && this.unboundAttemptIsFresh(attempt)
      && exactProjectedResumeError
      && returnedGate !== null
      && (
        (
          canonicalCharacterSetupInputMode === "guided_quick_fire"
          && exactKeysMatch(returnedGate, [
            "schema_version", "status", "hard_gate", "activation_allowed",
            "phase", "campaign_id", "character_setup_policy", "next_operation",
            "instruction",
          ])
        ) || (
          canonicalCharacterSetupInputMode === "kp_guided_era_adaptive"
          && exactKeysMatch(returnedGate, [
            "schema_version", "status", "hard_gate", "activation_allowed",
            "phase", "campaign_id", "character_setup_policy",
            "character_setup_input_mode", "next_operation", "instruction",
          ])
        )
      )
      && returnedGate.schema_version === 1
      && returnedGate.status === "blocked"
      && returnedGate.hard_gate === true
      && returnedGate.activation_allowed === false
      && returnedGate.phase === "opening_character_setup_required"
      && returnedGate.campaign_id === attempt.campaignId
      && returnedGate.next_operation === null
    );
    const canonicalMaterializationProbe = (
      attempt.attemptClass === "probe"
      && operation === "session.resume"
      && this.unboundAttemptIsFresh(attempt)
      && exactProjectedResumeError
      && returnedGate !== null
      && exactKeysMatch(
        returnedGate,
        returnedGate.source_lifecycle_status === "resolver_lost"
          ? [
            "schema_version",
            "status",
            "hard_gate",
            "activation_allowed",
            "phase",
            "campaign_id",
            "source_lifecycle_status",
            "retained_start_location_id",
            "next_operation",
            "instruction",
          ]
          : [
            "schema_version",
            "status",
            "hard_gate",
            "activation_allowed",
            "phase",
            "campaign_id",
            "source_lifecycle_status",
            "next_operation",
            "instruction",
          ],
      )
      && returnedGate.schema_version === 1
      && returnedGate.status === "blocked"
      && returnedGate.hard_gate === true
      && returnedGate.activation_allowed === false
      && returnedGate.phase === "opening_source_materialization"
      && returnedGate.campaign_id === attempt.campaignId
      && (
        // A live lifecycle waits; any other state carries a recovery card.
        returnedGate.source_lifecycle_status === "pending"
          ? returnedGate.next_operation === null
          : [
            "progressive.opening_bootstrap",
            "progressive.project_opening",
          ].includes(
            String(objectOrNull(returnedGate.next_operation)?.operation ?? ""),
          )
      )
    );
    const canonicalSourceReviewProbe = (
      attempt.attemptClass === "probe"
      && operation === "session.resume"
      && this.unboundAttemptIsFresh(attempt)
      && exactProjectedResumeError
      && returnedGate !== null
      && returnedGate.schema_version === 1
      && returnedGate.status === "blocked"
      && returnedGate.hard_gate === true
      && returnedGate.activation_allowed === false
      && returnedGate.phase === "opening_source_review_required"
      && returnedGate.campaign_id === attempt.campaignId
      && returnedGate.source_provenance
        === "selection_hint_only_not_provenance"
      && returnedGate.required_source_owner
        === "coc-opening-source-coordinator"
      && typeof returnedGate.character_setup_complete === "boolean"
      && returnedGate.next_operation === null
    );
    const recoveredFactsCard = objectOrNull(returnedGate?.next_operation);
    const recoveredFactsArguments = objectOrNull(
      recoveredFactsCard?.arguments,
    );
    const canonicalSourceFactsProbe = (
      attempt.attemptClass === "probe"
      && operation === "session.resume"
      && this.unboundAttemptIsFresh(attempt)
      && exactProjectedResumeError
      && returnedGate !== null
      && returnedGate.schema_version === 1
      && returnedGate.status === "blocked"
      && returnedGate.hard_gate === true
      && returnedGate.activation_allowed === false
      && returnedGate.phase === "opening_source_facts_adoption_required"
      && returnedGate.campaign_id === attempt.campaignId
      && recoveredFactsCard !== null
      && recoveredFactsCard.operation === "setup.adopt_source_facts"
      && recoveredFactsCard.invoke_via === "coc_invoke"
      && recoveredFactsCard.campaign === attempt.campaignId
      && recoveredFactsArguments !== null
      && exactKeysMatch(recoveredFactsArguments, ["campaign_id", "facts"])
      && recoveredFactsArguments.campaign_id === attempt.campaignId
      && validOpeningTransportFacts(recoveredFactsArguments.facts)
    );
    if (state === undefined && canonicalSourceFactsProbe) {
      const route = this.routeFromGate(returnedGate!);
      if (route === null) {
        this.finalizeOpeningSetupAttempt(invocationId);
        return {
          accepted: false,
          dispatchAllowed: false,
          reason: "opening_source_facts_gate_invalid",
        };
      }
      route.allowed_actions = [structuredClone(recoveredFactsCard!)];
      this.initializeOpeningSetupState(
        attempt.campaignId,
        route,
        "reviewed",
        attempt,
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "prebound_opening_source_facts_adoption_required",
      };
    }
    if (state === undefined && canonicalSourceReviewProbe) {
      const route = this.routeFromGate(returnedGate!);
      if (route === null) {
        this.finalizeOpeningSetupAttempt(invocationId);
        return {
          accepted: false,
          dispatchAllowed: false,
          reason: "opening_source_review_gate_invalid",
        };
      }
      route.allowed_actions = this.characterSetupAllowedActions(
        attempt.campaignId,
      );
      const initialized = this.initializeOpeningSetupState(
        attempt.campaignId,
        route,
        "source_review",
        attempt,
      );
      initialized.characterSetupComplete = (
        returnedGate!.character_setup_complete === true
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: "canonical_source_review_gate_rehydrated",
        campaign_id: attempt.campaignId,
        generation: attempt.generation,
        invocation_id: invocationId,
      });
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "prebound_opening_source_review_required",
      };
    }
    if (state === undefined && canonicalCharacterSetupProbe) {
      const route = this.recoveredCurrentCharacterSetupRoute(
        attempt.campaignId,
        canonicalCharacterSetupInputMode ?? "guided_quick_fire",
      );
      this.initializeOpeningSetupState(
        attempt.campaignId,
        route,
        "ready",
        attempt,
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: (
          `canonical_character_setup_${canonicalCharacterSetupInputMode}_gate_rehydrated`
        ),
        campaign_id: attempt.campaignId,
        generation: attempt.generation,
        invocation_id: invocationId,
      });
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "prebound_opening_character_setup",
        modelProjection: this.safeRecoveredCharacterSetupProjection(
          attempt.campaignId,
          route,
        ),
      };
    }
    if (state === undefined && canonicalMaterializationProbe) {
      const route = this.recoveredSourceMaterializationRoute(
        attempt.campaignId,
        returnedGate?.source_lifecycle_status === "pending"
          ? null
          : objectOrNull(returnedGate?.next_operation),
        String(returnedGate?.instruction ?? ""),
      );
      this.initializeOpeningSetupState(
        attempt.campaignId,
        route,
        "materializing",
        attempt,
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: "canonical_source_materialization_wait_rehydrated",
        campaign_id: attempt.campaignId,
        generation: attempt.generation,
        invocation_id: invocationId,
      });
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "prebound_opening_source_materialization",
      };
    }
    if (state === undefined && canonicalPreboundProbe) {
      this.initializeOpeningSetupState(
        attempt.campaignId,
        preboundRoute,
        "selection",
        attempt,
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: "prebound_opening_selection_hydrated",
        campaign_id: attempt.campaignId,
        generation: attempt.generation,
        invocation_id: invocationId,
      });
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "prebound_opening_selection",
      };
    }
    if (
      state === undefined
      && this.unboundAttemptIsFresh(attempt)
      && returnedGate?.phase === "opening_source_contract_invalid"
    ) {
      state = this.initializeOpeningSetupState(
        attempt.campaignId,
        this.recoveryRoute(attempt.campaignId),
        "contract_invalid",
        attempt,
      );
      this.markOpeningSetupTerminalBlocker(
        envelope ?? failedBlockingOpeningEnvelope(
          { status: "terminal_failure", failure_class: "source_contract_invalid" },
          "opening_source_contract_invalid",
        ),
        undefined,
        attempt.campaignId,
        state,
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "source_contract_invalid",
      };
    }
    if (state === undefined && attempt.attemptClass === "probe") {
      this.finalizeOpeningSetupAttempt(invocationId);
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "non_route_result",
      };
    }
    if (!this.attemptMatchesState(attempt, state)) {
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "stale_generation_or_revision",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
        attempt_generation: attempt.generation,
        attempt_revision: attempt.revision,
        current_generation: state?.generation,
        current_revision: state?.revision,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "stale_generation_or_revision",
      };
    }

    if (returnedGate?.phase === "opening_source_contract_invalid") {
      this.supersedeOpeningSetupRevisionAttempts(state, invocationId);
      this.finalizeOpeningSetupAttempt(invocationId);
      const invalid = this.transitionContractInvalid(state, attempt);
      this.markOpeningSetupTerminalBlocker(
        envelope ?? failedBlockingOpeningEnvelope(
          { status: "terminal_failure", failure_class: "source_contract_invalid" },
          "opening_source_contract_invalid",
        ),
        undefined,
        attempt.campaignId,
        invalid,
      );
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "source_contract_invalid",
      };
    }

    if (attempt.attemptClass === "character") {
      this.finalizeOpeningSetupAttempt(invocationId);
      const setupArgs = objectOrNull(params.arguments);
      const linkAttempt = (
        operation === "setup.invoke"
        && setupArgs?.kind === "campaign.link_investigator"
      );
      const createAttempt = (
        operation === "setup.invoke"
        && setupArgs?.kind === "investigator.create"
      );
      let canonicalVisibleText = this.canonicalCharacterSetupVisibleText(
        operation,
        params,
        envelope,
        canonicalVisibleOutput,
      );
      const retainedBindBriefing = (
        setupArgs?.kind === "campaign.render_briefing"
        && canonicalVisibleText !== null
        && state.bindBriefing !== null
        && state.bindBriefing.campaignId === attempt.campaignId
        && state.bindBriefing.textSha256
          === canonicalJsonValueSha256(state.bindBriefing.text)
      )
        ? state.bindBriefing
        : null;
      if (retainedBindBriefing !== null) {
        canonicalVisibleText = retainedBindBriefing.text;
        this.recordOpeningSetupAudit({
          status: "retained",
          reason: "bind_briefing_owns_setup_generation",
          campaign_id: attempt.campaignId,
          generation: state.generation,
          invocation_id: invocationId,
          ignored_public_setup_sha256:
            canonicalVisibleOutput?.publicSetupSha256,
          retained_public_setup_sha256:
            retainedBindBriefing.publicSetupSha256,
        });
      }
      const acceptedCharacterResult = canonicalVisibleText !== null;
      if (createAttempt && acceptedCharacterResult) {
        const payload = objectOrNull(setupArgs?.payload);
        const creation = objectOrNull(payload?.creation);
        const investigatorId = typeof payload?.investigator_id === "string"
          ? payload.investigator_id
          : "";
        const expectedInputMode = (
          state.characterSetupInputMode ?? "guided_quick_fire"
        );
        if (
          investigatorId
          && payload?.campaign_id === attempt.campaignId
          && creation?.input_mode === expectedInputMode
        ) {
          state.guidedCreateReceipts.set(investigatorId, {
            campaignId: attempt.campaignId,
            investigatorId,
            generation: state.generation,
            revision: state.revision,
            invocationId: attempt.invocationId,
            receiptSha256: canonicalJsonValueSha256({
              tool: envelope?.tool,
              data: envelope?.data,
            }),
          });
          this.recordOpeningSetupAudit({
            status: "retained",
            reason: `${expectedInputMode}_create_current`,
            campaign_id: attempt.campaignId,
            investigator_id: investigatorId,
            generation: state.generation,
            revision: state.revision,
            invocation_id: attempt.invocationId,
          });
        }
      }
      if (
        linkAttempt
        && acceptedCharacterResult
        && this.linkMatchesCurrentGuidedCreates(params, state)
      ) {
        state.characterSetupComplete = true;
        if (state.phase === "reviewed") {
          this.armOpeningSelectionRoute(state);
        } else if (state.phase === "ready") {
          this.armOpeningEvidenceRoute(state);
        } else if (
          state.phase === "projection"
          && state.backgroundTerminalReceipt?.status === "fulfilled"
        ) {
          this.armOpeningProjectionRoute(state);
        }
        this.recordOpeningSetupAudit({
          status: "transitioned",
          transition: "character_setup_complete",
          campaign_id: attempt.campaignId,
          generation: state.generation,
          revision: state.revision,
          invocation_id: invocationId,
        });
      }
      if (acceptedCharacterResult) {
        const source = (
          canonicalVisibleOutput === null
            ? `${operation}:${String(setupArgs?.kind ?? operation)}`
            : retainedBindBriefing !== null
              ? (
                `${retainedBindBriefing.sourceKind}:`
                + retainedBindBriefing.publicSetupSha256
              )
            : (
              `${canonicalVisibleOutput.sourceKind}:`
              + canonicalVisibleOutput.publicSetupSha256
            )
        );
        if (
          setupArgs?.kind === "campaign.render_briefing"
          && (
            canonicalVisibleOutput !== null
            || retainedBindBriefing !== null
          )
        ) {
          this.authorizeOpeningSetupConversationalOutput(
            state,
            attempt,
            source,
          );
        } else {
          this.authorizeOpeningSetupVisibleOutput(
            state,
            attempt,
            canonicalVisibleText,
            source,
          );
        }
      }
      return {
        accepted: acceptedCharacterResult,
        dispatchAllowed: false,
        reason: acceptedCharacterResult
          ? "character_setup_result"
          : "character_setup_failed",
      };
    }

    if (attempt.attemptClass !== "route") {
      this.finalizeOpeningSetupAttempt(invocationId);
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "non_route_result",
      };
    }
    if (operation === "evidence.table_opening") {
      this.finalizeOpeningSetupAttempt(invocationId);
      if (this.exactTableOpeningReceipt(envelope)) {
        const modelProjection = this.projectOpeningActivation(
          envelope!,
          state.activationCard,
        );
        this.clearOpeningSetupRoute(
          attempt.campaignId,
          state.generation,
        );
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "opening_table_evidence_current",
          modelProjection,
        };
      }
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "opening_table_evidence_invalid",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "opening_table_evidence_invalid",
      };
    }
    if (operation === "progressive.prepare_opening") {
      const nextCard = objectOrNull(data?.next_operation);
      if (envelope?.ok === true && this.exactBootstrapCard(nextCard)) {
        this.supersedeOpeningSetupRevisionAttempts(state, invocationId);
        this.finalizeOpeningSetupAttempt(invocationId);
        const next: OpeningSetupState = {
          ...state,
          route: {
            ...state.route,
            phase: "opening_bootstrap_required",
            next_operation: nextCard,
            instruction: (
              "invoke this exact retained canonical opening bootstrap card; "
              + "do not rediscover, run main-KP OCR, or narrate first"
            ),
          },
          revision: state.revision + 1,
          phase: "bootstrap",
          dispatchIdentity: null,
          projectionCard: null,
          activationCard: null,
          bootstrapRetryCard: null,
          continuationReleaseOwner: null,
          backgroundTerminalReceipt: null,
        };
        this.openingSetupStates.set(attempt.campaignId, next);
        this.openingSetupVisibleOutputAuthorization = null;
        this.recordOpeningSetupAudit({
          status: "transitioned",
          transition: state.phase === "contract_invalid"
            ? "source_contract_revalidated"
            : "opening_selection_accepted",
          campaign_id: attempt.campaignId,
          generation: state.generation,
          from_revision: state.revision,
          to_revision: next.revision,
          invocation_id: invocationId,
        });
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "opening_prepare_accepted",
        };
      }
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "opening_prepare_result_invalid",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
      });
      this.markOpeningSetupTerminalBlocker(
        envelope ?? failedBlockingOpeningEnvelope(
          { status: "terminal_failure", failure_class: "prepare_result_invalid" },
          "opening_prepare_failed",
        ),
        undefined,
        attempt.campaignId,
        state,
      );
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "opening_prepare_result_invalid",
      };
    }

    if (operation === "progressive.opening_bootstrap") {
      // Canonical already decided the bootstrap outcome. Pi must not re-judge
      // status labels (queued/coalesced/capability_status routing tags): when
      // the envelope carries an exact coordinator task, dispatch it; when it
      // is still queued without a task, keep waiting — never terminal-fail a
      // live materialization as opening_source_failure.
      const task = findAutoDispatchTask(value);
      const packet = task ? objectOrNull(task.packet) : null;
      const dispatchIdentity = typeof packet?.packet_id === "string"
        ? packet.packet_id.trim()
        : "";
      if (dispatchIdentity) {
        attempt.dispatchIdentity = dispatchIdentity;
        state.dispatchIdentity = dispatchIdentity;
        return {
          accepted: true,
          dispatchAllowed: true,
          reason: "opening_bootstrap_dispatch_accepted",
        };
      }
      if (
        envelope?.ok === true
        && (data?.status === "complete" || data?.status === "current")
      ) {
        this.finalizeOpeningSetupAttempt(invocationId);
        if (state.characterSetupComplete) {
          this.armOpeningEvidenceRoute(state);
        } else {
          state.phase = "ready";
          state.route = {
            ...state.route,
            phase: "opening_current_character_setup_required",
            next_operation: null,
            allowed_actions: this.characterSetupAllowedActions(
              state.route.campaign_id,
            ),
            instruction: (
              "opening source projection is current; complete the exact "
              + "canonical investigator link before any live play"
            ),
          };
          state.continuationReleaseOwner = null;
        }
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: state.characterSetupComplete
            ? "opening_bootstrap_current"
            : "opening_bootstrap_current_waiting_for_character",
        };
      }
      if (this.postReadyBootstrapNoopFailure(attempt, state, error)) {
        this.finalizeOpeningSetupAttempt(invocationId);
        this.recordOpeningSetupAudit({
          status: "ignored",
          reason: "post_ready_bootstrap_failure_ignored",
          campaign_id: attempt.campaignId,
          invocation_id: invocationId,
          error_code: error?.code,
        });
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "post_ready_bootstrap_noop",
        };
      }
      const sourceWork = objectOrNull(data?.source_work);
      const bootstrapStatus = String(
        sourceWork?.status ?? data?.status ?? "",
      );
      if (
        envelope?.ok === true
        && (bootstrapStatus === "queued" || bootstrapStatus === "coalesced")
      ) {
        // Live pending materialization. Do not mark a terminal blocker: the
        // host-work job is on disk and a later recoverability path (or a fixed
        // wire projection that restores the takeover) can still claim it.
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "opening_bootstrap_queued_awaiting_dispatch",
        };
      }
      this.finalizeOpeningSetupAttempt(invocationId);
      this.markOpeningSetupTerminalBlocker(
        envelope ?? failedBlockingOpeningEnvelope(
          { status: "terminal_failure", failure_class: "bootstrap_result_invalid" },
        ),
        undefined,
        attempt.campaignId,
        state,
      );
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "opening_bootstrap_result_invalid",
      };
    }
    if (operation === "progressive.project_opening") {
      this.finalizeOpeningSetupAttempt(invocationId);
      if (
        envelope?.ok === true
        && (data?.status === "complete" || data?.status === "current")
      ) {
        state.activationCard = this.exactOpeningActivationCard(
          data.activation_operation,
        );
        if (state.characterSetupComplete) {
          this.armOpeningEvidenceRoute(state);
        } else {
          state.phase = "ready";
          state.route = {
            ...state.route,
            phase: "opening_current_character_setup_required",
            next_operation: null,
            instruction: (
              "opening source projection is current; complete the exact "
              + "canonical investigator link before any live play"
            ),
          };
          state.continuationReleaseOwner = null;
        }
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: state.characterSetupComplete
            ? "opening_projection_current"
            : "opening_projection_current_waiting_for_character",
          ...(
            state.characterSetupComplete
              ? {
                  modelProjection: this.projectOpeningEvidenceRoute(
                    envelope,
                    state.route,
                  ),
                }
              : {}
          ),
        };
      }
      if (state.bootstrapRetryCard !== null) {
        this.restoreBackgroundRetryRoute(state);
      }
      this.markOpeningSetupTerminalBlocker(
        envelope ?? failedBlockingOpeningEnvelope(
          {
            status: "terminal_failure",
            failure_class: "opening_projection_not_current",
          },
          "opening_projection_not_current",
        ),
        state.dispatchIdentity ?? undefined,
        attempt.campaignId,
        state,
      );
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "opening_projection_not_current",
      };
    }
    this.finalizeOpeningSetupAttempt(invocationId);
    return {
      accepted: false,
      dispatchAllowed: false,
      reason: "route_operation_unhandled",
    };
  }

  private claimOpeningContinuationRelease(
    state: OpeningSetupState,
    owner: "route" | "terminal",
  ): boolean {
    if (state.continuationReleaseOwner !== null) return false;
    state.continuationReleaseOwner = owner;
    return true;
  }

  releaseOpeningSetupContinuation(
    route: OpeningSetupRoute,
    owner: "route" | "terminal",
  ): void {
    const state = this.openingSetupStates.get(route.campaign_id);
    if (
      state === undefined
      || state.route !== route
      || state.continuationReleaseOwner !== owner
    ) {
      return;
    }
    state.continuationReleaseOwner = null;
    if (owner === "route") {
      this.openingSetupContinuationQueued.delete(route.campaign_id);
    }
  }

  releaseOpeningTerminalContinuation(dispatchKey: string): void {
    const state = [...this.openingSetupStates.values()].find(
      (candidate) => candidate.dispatchIdentity === dispatchKey,
    );
    if (state !== undefined) {
      this.releaseOpeningSetupContinuation(state.route, "terminal");
    }
  }

  requiredOpeningSetupContinuation(): OpeningSetupRoute | null {
    const state = this.openingSetupStateForTranscript();
    if (
      state === null
      || state.route.next_operation === null
      || (
        state.phase === "projection"
        && !state.characterSetupComplete
      )
      || this.openingSetupContinuationQueued.has(state.route.campaign_id)
      || this.openingSetupAuthorizationMatches(state)
      || !this.claimOpeningContinuationRelease(state, "route")
    ) {
      return null;
    }
    this.openingSetupContinuationQueued.add(state.route.campaign_id);
    return state.route;
  }

  clearOpeningSetupRoute(
    campaignId?: string | null,
    generation?: string,
  ): void {
    if (campaignId) {
      const state = this.openingSetupStates.get(campaignId);
      if (state === undefined || (generation && state.generation !== generation)) {
        this.recordOpeningSetupAudit({
          status: "ignored",
          reason: "clear_generation_mismatch",
          campaign_id: campaignId,
          generation,
        });
        return;
      }
      this.openingSetupRetiredGeneration.set(
        campaignId,
        this.openingSetupLatestIssuedGeneration.get(campaignId)
          ?? state.generationSequence,
      );
      for (const attempt of [...this.openingSetupAttempts.values()]) {
        if (attempt.campaignId === campaignId) {
          this.finalizeOpeningSetupAttempt(attempt.invocationId);
        }
      }
      this.openingSetupStates.delete(campaignId);
      this.openingSetupContinuationQueued.delete(campaignId);
      this.openingSetupTerminalBlockers.delete(campaignId);
      if (
        this.openingSetupVisibleOutputAuthorization?.campaignId === campaignId
      ) {
        this.openingSetupVisibleOutputAuthorization = null;
      }
      this.pruneOpeningSetupCampaign(campaignId);
      return;
    }
    this.openingSetupStates.clear();
    this.openingSetupAttempts.clear();
    this.openingSetupLatestIssuedGeneration.clear();
    this.openingSetupRetiredGeneration.clear();
    this.openingSetupContinuationQueued.clear();
    this.openingSetupTerminalBlockers.clear();
    this.openingSetupVisibleOutputAuthorization = null;
    this.openingSetupTurnCampaignId = null;
    this.openingSetupTurnCampaignAmbiguous = false;
    this.deliveredOpeningSetupTerminalBlocker = null;
  }

  markOpeningSetupTerminalBlocker(
    envelope: JsonObject,
    dispatchKey?: string,
    campaignId?: string | null,
    expectedState?: OpeningSetupState,
  ): void {
    const state = campaignId
      ? this.openingSetupStates.get(campaignId)
      : this.openingSetupStateForTranscript();
    if (
      state === undefined
      || state === null
      || (
        expectedState !== undefined
        && (
          state.generation !== expectedState.generation
          || state.revision !== expectedState.revision
        )
      )
      || (
        dispatchKey
        && state.dispatchIdentity
        && state.dispatchIdentity !== dispatchKey
      )
    ) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "terminal_state_or_dispatch_mismatch",
        campaign_id: campaignId,
        dispatch_key: dispatchKey,
      });
      return;
    }
    const error = objectOrNull(envelope.error);
    const data = objectOrNull(envelope.data);
    const terminal = objectOrNull(data?.coordinator_terminal);
    const failureClass = typeof terminal?.failure_class === "string"
      ? terminal.failure_class
      : typeof error?.code === "string" ? error.code : "opening_source_failure";
    const blocker = {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_source_terminal_blocker",
      campaign_id: state.route.campaign_id,
      generation: state.generation,
      revision: state.revision,
      failure_class: failureClass,
      error_code: typeof error?.code === "string"
        ? error.code
        : "opening_source_terminal_failure",
      ...(dispatchKey ? { dispatch_key: dispatchKey } : {}),
      next_operation: state.route.next_operation,
      instruction: (
        "开场来源处理未完成，游戏尚未开始。保留当前来源证据，并仅按 "
        + "next_operation 的精确卡片重试或恢复；不要虚构开场。"
      ),
    };
    const cancelled = (
      blocker.error_code === "opening_source_wait_cancelled"
      || blocker.error_code === "opening_projection_cancelled"
      || blocker.failure_class === "coordinator_wait_cancelled"
    );
    this.openingSetupTerminalBlockers.set(state.route.campaign_id, {
      visibleText: cancelled
        ? (
          "开场资料解析已取消，游戏尚未开始。系统保留了当前进度；"
          + "你可以稍后重试原来的开场步骤，在资料就绪前不会自行编写剧情。"
        )
        : (
          "开场资料解析失败，游戏尚未开始。系统保留了当前进度；"
          + "你可以重试原来的开场步骤，在资料就绪前不会自行编写剧情。"
        ),
      details: blocker,
    });
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
    state.continuationReleaseOwner = null;
    this.openingSetupVisibleOutputAuthorization = null;
    if (!this.queuedVisibleDispositions.some((queued) => (
      queued.disposition === "terminal_blocker"
      && (dispatchKey === undefined || queued.dispatchKey === dispatchKey)
    ))) {
      this.queueVisibleAssistantDisposition("terminal_blocker", dispatchKey);
    }
  }

  private postReadyBootstrapNoopFailure(
    attempt: OpeningSetupAttempt,
    state: OpeningSetupState,
    error: JsonObject | null,
  ): boolean {
    return (
      attempt.operation === "progressive.opening_bootstrap"
      && state.phase === "ready"
      && (
        error?.code === "invalid_param"
        || error?.code === "opening_bootstrap_non_pristine"
      )
    );
  }

  markOpeningSetupRouteAttemptFailure(
    invocationId: string,
    params: JsonObject,
    envelope: JsonObject,
    dispatchKey?: string,
  ): void {
    const attempt = this.openingSetupAttempts.get(invocationId);
    const state = typeof params.campaign === "string"
      ? this.openingSetupStates.get(params.campaign)
      : undefined;
    const failureEnvelope = objectOrNull(envelope);
    const failureData = objectOrNull(failureEnvelope?.data);
    const failureError = objectOrNull(failureEnvelope?.error);
    const failureDetails = objectOrNull(failureError?.details);
    const returnedGate = objectOrNull(failureData?.opening_gate)
      ?? (failureDetails?.hard_gate === true ? failureDetails : null);
    const identityMatches = (
      attempt !== undefined
      && attempt.attemptClass === "route"
      && this.attemptMatchesState(attempt, state)
      && attempt.operation === params.operation
      && params.campaign === attempt.campaignId
      && !this.resultCampaignMismatch(
        attempt,
        failureEnvelope,
        returnedGate,
      )
      && (
        dispatchKey !== undefined
        ? attempt.dispatchIdentity === dispatchKey
        : true
      )
    );
    if (attempt !== undefined) {
      this.finalizeOpeningSetupAttempt(invocationId);
    }
    if (!identityMatches || attempt === undefined || state === undefined) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "failed_attempt_identity_mismatch",
        invocation_id: invocationId,
        dispatch_key: dispatchKey,
      });
      return;
    }
    if (this.postReadyBootstrapNoopFailure(attempt, state, failureError)) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "post_ready_bootstrap_failure_ignored",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
        dispatch_key: dispatchKey,
        error_code: failureError?.code,
      });
      return;
    }
    if (["submitting", "materializing", "projection"].includes(state.phase)) {
      this.restoreBackgroundRetryRoute(state);
    }
    this.markOpeningSetupTerminalBlocker(
      envelope,
      dispatchKey,
      attempt.campaignId,
      state,
    );
  }

  openingSetupDispatchOwned(
    invocationId: string,
    params: JsonObject,
    dispatchKey: string,
  ): boolean {
    const attempt = this.openingSetupAttempts.get(invocationId);
    const state = typeof params.campaign === "string"
      ? this.openingSetupStates.get(params.campaign)
      : undefined;
    return (
      attempt !== undefined
      && attempt.attemptClass === "route"
      && attempt.operation === "progressive.opening_bootstrap"
      && params.operation === attempt.operation
      && params.campaign === attempt.campaignId
      && this.attemptMatchesState(attempt, state)
      && attempt.dispatchIdentity === dispatchKey
      && state.dispatchIdentity === dispatchKey
    );
  }

  releaseOpeningSetupDispatchOwnership(
    invocationId: string,
    dispatchKey: string,
  ): void {
    const attempt = this.finalizeOpeningSetupAttempt(invocationId);
    this.recordOpeningSetupAudit({
      status: "ignored",
      reason: "opening_dispatch_ownership_lost",
      invocation_id: invocationId,
      campaign_id: attempt?.campaignId,
      generation: attempt?.generation,
      revision: attempt?.revision,
      dispatch_key: dispatchKey,
    });
  }

  beginOpeningBackground(
    invocationId: string,
    params: JsonObject,
    dispatchKey: string,
    projectionParams: JsonObject,
  ): boolean {
    const attempt = this.openingSetupAttempts.get(invocationId);
    const state = typeof params.campaign === "string"
      ? this.openingSetupStates.get(params.campaign)
      : undefined;
    const projectionArguments = objectOrNull(projectionParams.arguments);
    if (
      attempt === undefined
      || state === undefined
      || attempt.attemptClass !== "route"
      || attempt.operation !== "progressive.opening_bootstrap"
      || !this.attemptMatchesState(attempt, state)
      || attempt.dispatchIdentity !== dispatchKey
      || state.dispatchIdentity !== dispatchKey
      || projectionParams.operation !== "progressive.project_opening"
      || projectionParams.campaign !== attempt.campaignId
      || projectionArguments === null
    ) {
      return false;
    }
    state.phase = "submitting";
    state.continuationReleaseOwner = null;
    state.backgroundTerminalReceipt = null;
    state.activationCard = null;
    state.bootstrapRetryCard = state.route.next_operation;
    state.projectionCard = {
      operation: "progressive.project_opening",
      invoke_via: "coc_invoke",
      prefilled_arguments: projectionArguments,
      missing_arguments: [],
      hard_gate: true,
      authority: "canonical_setup",
    };
    state.route = {
      ...state.route,
      phase: "opening_source_materialization",
      next_operation: null,
      allowed_actions: this.characterSetupAllowedActions(
        state.route.campaign_id,
      ),
      instruction: (
        "opening source materialization is running in the background; "
        + "continue normal character creation, but do not enter live play"
      ),
    };
    this.trackOpeningDispatch(dispatchKey);
    this.recordOpeningSetupAudit({
      status: "transitioned",
      transition: "opening_background_started",
      campaign_id: attempt.campaignId,
      generation: state.generation,
      revision: state.revision,
      invocation_id: invocationId,
      dispatch_key: dispatchKey,
    });
    return true;
  }

  markOpeningBackgroundSubmitted(
    invocationId: string,
    params: JsonObject,
    dispatchKey: string,
  ): OpeningBackgroundSubmissionDisposition {
    const attempt = this.openingSetupAttempts.get(invocationId);
    const state = typeof params.campaign === "string"
      ? this.openingSetupStates.get(params.campaign)
      : undefined;
    if (
      attempt === undefined
      || state === undefined
      || attempt.attemptClass !== "route"
      || !this.attemptMatchesState(attempt, state)
      || attempt.dispatchIdentity !== dispatchKey
    ) {
      return { status: "stale" };
    }
    const terminalReceipt = state.backgroundTerminalReceipt;
    if (
      terminalReceipt !== null
      && terminalReceipt.packet_id === dispatchKey
      && ["projection", "retry"].includes(state.phase)
    ) {
      this.finalizeOpeningSetupAttempt(invocationId);
      return { status: "terminal", receipt: terminalReceipt };
    }
    if (
      state.dispatchIdentity !== dispatchKey
      || state.phase !== "submitting"
    ) {
      return { status: "stale" };
    }
    state.phase = "materializing";
    this.recordOpeningSetupAudit({
      status: "transitioned",
      transition: "opening_background_submitted",
      campaign_id: attempt.campaignId,
      generation: state.generation,
      revision: state.revision,
      invocation_id: invocationId,
      dispatch_key: dispatchKey,
    });
    return { status: "submitted" };
  }

  observeOpeningCoordinatorTerminal(receipt: JsonObject): void {
    const dispatchKey = typeof receipt.packet_id === "string"
      ? receipt.packet_id.trim()
      : "";
    if (!dispatchKey) return;
    const state = [...this.openingSetupStates.values()].find(
      (candidate) => candidate.dispatchIdentity === dispatchKey,
    );
    if (
      state === undefined
      || !["submitting", "materializing"].includes(state.phase)
    ) return;
    const attempt = [...this.openingSetupAttempts.values()].find(
      (candidate) => candidate.dispatchIdentity === dispatchKey,
    );
    state.backgroundTerminalReceipt = receipt;
    if (attempt !== undefined && state.phase !== "submitting") {
      this.finalizeOpeningSetupAttempt(attempt.invocationId);
    }
    if (
      receipt.status === "fulfilled"
      && state.projectionCard !== null
    ) {
      if (state.characterSetupComplete) {
        this.armOpeningProjectionRoute(state);
      } else {
        this.retainOpeningProjectionUntilCharacterLink(state);
      }
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: "opening_background_fulfilled",
        campaign_id: state.route.campaign_id,
        generation: state.generation,
        revision: state.revision,
        dispatch_key: dispatchKey,
      });
      return;
    }
    this.restoreBackgroundRetryRoute(state);
    this.markOpeningSetupTerminalBlocker(
      failedBlockingOpeningEnvelope(
        receipt,
        "opening_source_terminal_failure",
      ),
      dispatchKey,
      state.route.campaign_id,
      state,
    );
  }

  observeOpeningSourceReviewTransport(
    receipt: JsonObject,
  ): OpeningSetupRoute | null {
    const campaignId = String(receipt.campaign_id ?? "");
    const state = this.openingSetupStates.get(campaignId);
    if (state === undefined || state.phase !== "source_review") return null;
    if (receipt.status === "reviewed") {
      if (state.characterSetupComplete) {
        this.armOpeningSelectionRoute(state);
      } else {
        this.retainReviewedSourceUntilCharacterLink(state);
      }
      return structuredClone(state.route);
    }
    this.markOpeningSetupTerminalBlocker(
      failedBlockingOpeningEnvelope(
        receipt, "opening_source_review_terminal_failure",
      ),
      undefined, campaignId, state,
    );
    return null;
  }

  private restoreBackgroundRetryRoute(state: OpeningSetupState): void {
    state.phase = "retry";
    state.route = {
      ...state.route,
      phase: "opening_bootstrap_required",
      next_operation: state.bootstrapRetryCard,
      allowed_actions: this.characterSetupAllowedActions(
        state.route.campaign_id,
      ),
      instruction: (
        "opening background failed; preserve evidence and retry only this "
        + "exact retained bootstrap card"
      ),
    };
    state.dispatchIdentity = null;
    state.projectionCard = null;
    state.activationCard = null;
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
  }

  takeDeliveredOpeningSetupTerminalBlocker(): JsonObject | null {
    const details = this.deliveredOpeningSetupTerminalBlocker;
    this.deliveredOpeningSetupTerminalBlocker = null;
    return details;
  }

  trackOpeningDispatch(dispatchKey: string): void {
    if (dispatchKey) {
      this.states.set(dispatchKey, "awaiting");
      // The key comes from the structured opening_bootstrap takeover packet,
      // so later terminal continuations can distinguish this blocking opening
      // from an unrelated background coordinator completion.
      this.dispatchClasses.set(dispatchKey, "blocking_opening");
    }
  }

  private removeCurrentDependency(dependencyId: string): void {
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (wait?.dispatchKey) {
      this.currentDependencyByDispatch.delete(wait.dispatchKey);
      this.states.delete(wait.dispatchKey);
      this.dispatchClasses.delete(wait.dispatchKey);
    }
    this.currentDependencyWaits.delete(dependencyId);
    if (
      wait !== undefined
      && ![...this.currentDependencyWaits.values()].some(
        (candidate) => candidate.campaignId === wait.campaignId,
      )
      && this.currentDependencySuppression?.campaignId === wait.campaignId
    ) {
      this.currentDependencySuppression = null;
    }
  }

  private currentDependencySettlementGroupKey(
    campaignId: string,
    dependencyRef: JsonObject,
  ): string | null {
    const operation = typeof dependencyRef.operation === "string"
      ? dependencyRef.operation.trim()
      : "";
    const identity: Array<[string, string]> = [];
    for (
      const field of [
        "decision_id", "settlement_id", "source_scope_signature",
      ]
    ) {
      const value = typeof dependencyRef[field] === "string"
        ? dependencyRef[field].trim()
        : "";
      if (value) identity.push([field, value]);
    }
    if (!campaignId || !operation || identity.length !== 1) return null;
    return canonicalJsonValueSha256({
      campaign_id: campaignId,
      operation,
      settlement_identity: identity[0],
    });
  }

  observeCurrentDependencySnapshot(
    campaignId: string,
    waits: JsonObject[],
    snapshotScope: JsonObject | null = null,
  ): void {
    const retained = new Set<string>();
    const scopedDependencyRef = objectOrNull(
      snapshotScope?.dependency_ref,
    );
    const scopedSettlementGroupKey = scopedDependencyRef === null
      ? null
      : this.currentDependencySettlementGroupKey(
        campaignId,
        scopedDependencyRef,
      );
    for (const value of waits) {
      const waitCampaignId = typeof value.campaign_id === "string"
        ? value.campaign_id.trim()
        : "";
      const dependencyId = typeof value.dependency_id === "string"
        ? value.dependency_id.trim()
        : "";
      const jobId = typeof value.job_id === "string"
        ? value.job_id.trim()
        : "";
      const dependencyRef = objectOrNull(value.dependency_ref);
      const settlementGroupKey = dependencyRef === null
        ? null
        : this.currentDependencySettlementGroupKey(campaignId, dependencyRef);
      if (
        !campaignId
        || waitCampaignId !== campaignId
        || !dependencyId
        || !jobId
        || dependencyRef === null
        || settlementGroupKey === null
      ) continue;
      retained.add(dependencyId);
      const existing = this.currentDependencyWaits.get(dependencyId);
      if (existing?.jobId !== jobId && existing?.dispatchKey) {
        this.currentDependencyByDispatch.delete(existing.dispatchKey);
        this.states.delete(existing.dispatchKey);
        this.dispatchClasses.delete(existing.dispatchKey);
      }
      this.currentDependencyWaits.set(dependencyId, {
        campaignId,
        jobId,
        dependencyRef,
        settlementGroupKey,
        dispatchKey: existing?.jobId === jobId
          ? existing.dispatchKey
          : null,
        deliveryPending: existing?.jobId === jobId
          ? existing.deliveryPending
          : false,
        deliveryRetryNeeded: existing?.jobId === jobId
          ? existing.deliveryRetryNeeded
          : false,
        terminalReceipt: existing?.jobId === jobId
          ? existing.terminalReceipt
          : null,
        terminalDelivered: existing?.jobId === jobId
          ? existing.terminalDelivered
          : false,
        projectionConfirmed: existing?.jobId === jobId
          ? existing.projectionConfirmed
          : false,
      });
    }
    for (const [dependencyId, wait] of this.currentDependencyWaits) {
      if (
        wait.campaignId === campaignId
        && (
          scopedSettlementGroupKey === null
          || wait.settlementGroupKey === scopedSettlementGroupKey
        )
        && !retained.has(dependencyId)
        && !wait.deliveryPending
        && !wait.terminalDelivered
      ) {
        this.removeCurrentDependency(dependencyId);
      }
    }
  }

  currentDependencyDeliveryPending(
    dependencyId: string,
    jobId: string,
    dispatchKey: string,
  ): boolean {
    const wait = this.currentDependencyWaits.get(dependencyId);
    return (
      wait?.jobId === jobId
      && wait.dispatchKey === dispatchKey
      && wait.terminalReceipt !== null
      && (wait.deliveryPending || wait.terminalDelivered)
    );
  }

  prepareCurrentDependencyDispatch(
    dependencyId: string,
    jobId: string,
    dispatchKey: string,
  ): boolean {
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (
      wait === undefined
      || wait.jobId !== jobId
      || !dispatchKey
    ) return false;
    if (wait.dispatchKey && wait.dispatchKey !== dispatchKey) {
      this.currentDependencyByDispatch.delete(wait.dispatchKey);
      this.states.delete(wait.dispatchKey);
      this.dispatchClasses.delete(wait.dispatchKey);
      wait.deliveryPending = false;
      wait.deliveryRetryNeeded = false;
      wait.terminalReceipt = null;
      wait.terminalDelivered = false;
      wait.projectionConfirmed = false;
    }
    wait.dispatchKey = dispatchKey;
    this.currentDependencyByDispatch.set(dispatchKey, dependencyId);
    this.states.set(dispatchKey, "awaiting");
    this.dispatchClasses.set(dispatchKey, "blocking_micro");
    return true;
  }

  rollbackCurrentDependencySubmission(
    dependencyId: string,
    jobId: string,
    dispatchKey: string,
  ): void {
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (wait?.jobId !== jobId || wait.dispatchKey !== dispatchKey) return;
    wait.dispatchKey = null;
    wait.deliveryPending = false;
    wait.deliveryRetryNeeded = false;
    wait.terminalReceipt = null;
    wait.terminalDelivered = false;
    wait.projectionConfirmed = false;
    this.currentDependencyByDispatch.delete(dispatchKey);
    this.states.delete(dispatchKey);
    this.dispatchClasses.delete(dispatchKey);
  }

  commitCurrentDependencyDelivery(dispatchKey: string): void {
    const dependencyId = this.currentDependencyByDispatch.get(dispatchKey);
    if (dependencyId === undefined) return;
    this.removeCurrentDependency(dependencyId);
  }

  markCurrentDependencyTerminalDelivered(dispatchKey: string): void {
    const dependencyId = this.currentDependencyByDispatch.get(dispatchKey);
    if (dependencyId === undefined) return;
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (
      wait?.dispatchKey !== dispatchKey
      || wait.terminalReceipt?.status !== "fulfilled"
    ) return;
    wait.deliveryPending = false;
    wait.deliveryRetryNeeded = false;
    wait.terminalDelivered = true;
    this.states.set(dispatchKey, "published");
  }

  observeCurrentDependencyTerminalReceipt(
    dispatchKey: string,
    receipt: JsonObject,
  ): void {
    const dependencyId = this.currentDependencyByDispatch.get(dispatchKey);
    if (dependencyId === undefined || receipt.status !== "fulfilled") return;
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (wait?.dispatchKey !== dispatchKey) return;
    wait.terminalReceipt = receipt;
  }

  rollbackCurrentDependencyDelivery(dispatchKey: string): void {
    const dependencyId = this.currentDependencyByDispatch.get(dispatchKey);
    if (dependencyId === undefined) return;
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (wait?.dispatchKey !== dispatchKey || !wait.deliveryPending) return;
    wait.deliveryRetryNeeded = wait.terminalReceipt !== null;
    this.states.set(dispatchKey, "awaiting");
    this.dispatchClasses.set(dispatchKey, "blocking_micro");
  }

  takeCurrentDependencyDeliveryRetries(): Array<{
    dispatchKey: string;
    receipt: JsonObject;
  }> {
    const retries: Array<{ dispatchKey: string; receipt: JsonObject }> = [];
    for (const wait of this.currentDependencyWaits.values()) {
      if (
        wait.dispatchKey === null
        || !wait.deliveryPending
        || !wait.deliveryRetryNeeded
        || wait.terminalReceipt === null
      ) continue;
      wait.deliveryRetryNeeded = false;
      retries.push({
        dispatchKey: wait.dispatchKey,
        receipt: wait.terminalReceipt,
      });
    }
    return retries;
  }

  observeCurrentVisibleInvocation(
    invocationId: string,
    campaignId: string,
  ): void {
    if (invocationId && campaignId) {
      this.currentVisibleCampaignId = campaignId;
    }
  }

  private exactDependencyRefMatches(
    wait: CurrentDependencyWait,
    campaignId: string,
    operation: unknown,
    identity: JsonObject,
    subjectKind?: unknown,
    subjectId?: unknown,
  ): boolean {
    const identityFields = [
      "decision_id", "settlement_id", "source_scope_signature",
    ].filter((field) => (
      typeof wait.dependencyRef[field] === "string"
      && String(wait.dependencyRef[field]).trim()
    ));
    if (
      campaignId !== wait.campaignId
      || operation !== wait.dependencyRef.operation
      || identityFields.length !== 1
      || identity[identityFields[0]] !== wait.dependencyRef[identityFields[0]]
    ) {
      return false;
    }
    if (subjectKind === undefined && subjectId === undefined) return true;
    const subject = objectOrNull(wait.dependencyRef.subject);
    return (
      subjectKind !== undefined
      && subjectId !== undefined
      && subjectKind === subject?.kind
      && subjectId === subject?.id
    );
  }

  currentDependencyToolError(params: JsonObject): string | null {
    const campaignId = typeof params.campaign === "string"
      ? params.campaign.trim()
      : "";
    const operation = typeof params.operation === "string"
      ? params.operation.trim()
      : "";
    if (!campaignId || !operation) return null;
    const args = objectOrNull(params.arguments) ?? {};
    const active = [...this.currentDependencyWaits.values()].filter(
      (wait) => wait.campaignId === campaignId && wait.terminalDelivered,
    );
    if (active.length === 0) return null;
    const exactRecovery = active.some((wait) => {
      const subject = objectOrNull(wait.dependencyRef.subject);
      return (
        operation === "scene.context"
        || (
          operation === "progressive.status"
          && args.kind === subject?.kind
          && args.target_id === subject?.id
        )
      );
    });
    if (exactRecovery) return null;
    const exactConsumerReady = active.some((wait) => (
      wait.projectionConfirmed
      && this.exactDependencyRefMatches(
        wait,
        campaignId,
        operation,
        args,
        args.kind,
        args.target_id,
      )
    ));
    if (exactConsumerReady) return null;
    return (
      `${operation} is blocked until the fulfilled current dependency is `
      + "consumed through its exact canonical projection query; do not "
      + "release or reconstruct source facts from earlier previews"
    );
  }

  observeCurrentDependencyConsumerResult(
    operation: string,
    params: JsonObject,
    value: unknown,
  ): void {
    const envelope = objectOrNull(value);
    if (envelope?.ok !== true) return;
    const campaignId = typeof params.campaign === "string"
      ? params.campaign.trim()
      : "";
    if (!campaignId) return;
    const data = objectOrNull(envelope.data);
    const args = objectOrNull(params.arguments) ?? {};
    for (const [dependencyId, wait] of this.currentDependencyWaits) {
      if (wait.campaignId !== campaignId || !wait.terminalDelivered) continue;
      const subject = objectOrNull(wait.dependencyRef.subject);
      const subjectKind = typeof subject?.kind === "string"
        ? subject.kind
        : "";
      const subjectId = typeof subject?.id === "string" ? subject.id : "";
      if (!subjectKind || !subjectId) continue;
      if (operation === "scene.context" && subjectKind === "location") {
        const scene = objectOrNull(data?.scene);
        if (
          data?.active_scene_id === subjectId
          && ["deep", "body_parsed"].includes(String(scene?.parse_state ?? ""))
          && scene?.evidence_gap === false
        ) {
          wait.projectionConfirmed = true;
        }
      }
      if (
        wait.projectionConfirmed
        && this.exactDependencyRefMatches(
          wait,
          campaignId,
          operation,
          args,
          args.kind,
          args.target_id,
        )
      ) {
        this.removeCurrentDependency(dependencyId);
      }
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
    this.openingSetupAgentTurn += 1;
    this.openingSetupTurnCampaignId = null;
    this.openingSetupTurnCampaignAmbiguous = false;
    this.openingSetupVisibleOutputAuthorization = null;
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
    this.currentDependencySuppression = null;
    this.currentVisibleCampaignId = null;
    this.pendingMechanicalOutputGateEnvelope = null;
  }

  observeCanonicalReceipt(
    operation: string,
    envelope: JsonObject | null,
  ): void {
    if (envelope?.ok !== true) return;
    const data = objectOrNull(envelope.data);
    if (data === null) return;
    let entry = this.epochMechanicalReceipts.get(this.playerTurnEpoch);
    if (entry === undefined) {
      entry = { dice: 0, resource: 0 };
      this.epochMechanicalReceipts.set(this.playerTurnEpoch, entry);
      if (this.epochMechanicalReceipts.size > 8) {
        const oldest = [...this.epochMechanicalReceipts.keys()].sort(
          (a, b) => a - b,
        )[0];
        this.epochMechanicalReceipts.delete(oldest);
      }
    }
    if (typeof data.roll_id === "string" && data.roll_id.length > 0) {
      entry.dice += 1;
    } else if (operation.startsWith("state.")) {
      entry.resource += 1;
    } else if (
      (operation === "turn.finalize"
        || operation === "evidence.table_opening")
      && typeof data.rendered_text === "string"
      && data.rendered_text.length > 0
    ) {
      // The finalizer/settled-output receipt already fails closed when a
      // qualifying roll lacks binding, so its presence covers both marker
      // classes for the epoch even when the host digest gate declined to
      // arm the exact-replace (e.g. a raw-UTF8 digest variant).
      entry.dice += 1;
      entry.resource += 1;
    }
  }

  private mechanicalMarkersUncovered(visibleText: string): MechanicalMarker[] {
    const markers = detectMechanicalMarkers(visibleText);
    if (markers.length === 0) return [];
    const receipts = this.epochMechanicalReceipts.get(this.playerTurnEpoch)
      ?? { dice: 0, resource: 0 };
    return mechanicalMarkerClassesUncovered(
      markers,
      receipts.dice > 0,
      receipts.resource > 0,
    );
  }

  takeMechanicalOutputGateEnvelope(): JsonObject | null {
    const envelope = this.pendingMechanicalOutputGateEnvelope;
    this.pendingMechanicalOutputGateEnvelope = null;
    return envelope;
  }

  coordinatorContinuationContext(
    dispatchKey: string,
    terminalStatus: string,
  ): JsonObject {
    const dependencyId = this.currentDependencyByDispatch.get(dispatchKey);
    const dependencyWait = dependencyId
      ? this.currentDependencyWaits.get(dependencyId)
      : undefined;
    const exactCurrentDependency = (
      dependencyId !== undefined
      && dependencyWait?.dispatchKey === dispatchKey
      && terminalStatus === "fulfilled"
    );
    const recordedClass = this.dispatchClasses.get(dispatchKey);
    const dispatchClass = (
      recordedClass === "blocking_micro" && !exactCurrentDependency
        ? "nonblocking_background"
        : recordedClass ?? "nonblocking_background"
    );
    const openingState = [...this.openingSetupStates.values()].find(
      (candidate) => candidate.dispatchIdentity === dispatchKey,
    );
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
      ...(
        dispatchClass === "blocking_micro"
        && dependencyId !== undefined
        && dependencyWait !== undefined
          ? {
            dependency_id: dependencyId,
            dependency_campaign_id: dependencyWait.campaignId,
            dependency_job_id: dependencyWait.jobId,
            dependency_ref: dependencyWait.dependencyRef,
          }
          : {}
      ),
      ...(
        dispatchClass === "blocking_opening"
        && openingState?.route.next_operation !== null
        && openingState?.route.next_operation !== undefined
          ? { opening_setup_route: openingState.route }
          : {}
      ),
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
    if (
      details.continuation_class === "blocking_micro"
      && details.dispatch_class === "blocking_micro"
      && typeof details.dispatch_key === "string"
    ) {
      const dependencyId = this.currentDependencyByDispatch.get(
        details.dispatch_key,
      );
      const wait = dependencyId
        ? this.currentDependencyWaits.get(dependencyId)
        : undefined;
      if (
        wait?.terminalDelivered === true
        && details.dependency_id === dependencyId
        && details.dependency_campaign_id === wait.campaignId
        && details.dependency_job_id === wait.jobId
      ) {
        this.currentDependencySuppression = {
          epoch: this.playerTurnEpoch,
          campaignId: wait.campaignId,
          invocationId: details.dispatch_key,
        };
        this.currentVisibleCampaignId = wait.campaignId;
      }
      return;
    }
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
    const openingState = this.openingSetupStateForTranscript();
    const terminalBlocker = openingState === null
      ? null
      : this.openingSetupTerminalBlockers.get(
        openingState.route.campaign_id,
      ) ?? null;
    if (
      disposition === "terminal_blocker"
      && terminalBlocker !== null
    ) {
      const replacementText = terminalBlocker.visibleText;
      this.deliveredOpeningSetupTerminalBlocker = (
        terminalBlocker.details
      );
      this.openingSetupTerminalBlockers.delete(
        openingState!.route.campaign_id,
      );
      this.nonblockingContinuation = null;
      return { replacementText };
    }
    if (
      this.openingSetupStates.size > 0
      || this.pendingBindExists()
    ) {
      if (
        openingState !== null
        && this.openingSetupAuthorizationMatches(openingState)
      ) {
        const authorization = this.openingSetupVisibleOutputAuthorization!;
        this.openingSetupVisibleOutputAuthorization = null;
        if (
          openingState.characterSetupComplete
          && openingState.phase === "ready"
        ) {
          this.clearOpeningSetupRoute(
            openingState.route.campaign_id,
            openingState.generation,
          );
        }
        if (
          authorization.replacementText === null
          && authorization.replacementTextSha256 === null
        ) {
          return true;
        }
        if (
          authorization.replacementText === null
          || authorization.replacementTextSha256 === null
        ) {
          return false;
        }
        if (
          authorization.replacementText === visibleText
          && authorization.replacementTextSha256
            === canonicalJsonValueSha256(visibleText)
        ) {
          return true;
        }
        return {
          replacementText: authorization.replacementText,
          triggerSetupContinuation: true,
        };
      }
      if (
        openingState !== null
        && !openingState.characterSetupComplete
        && this.characterSetupAllowed(openingState)
      ) {
        // Character creation remains available, but arbitrary model prose
        // cannot acquire source authority from the phase alone. A successful
        // canonical setup receipt above exact-replaces its one owned output.
        return {
          replacementText: SAFE_CHARACTER_SETUP_PROMPT,
          triggerSetupContinuation: true,
        };
      }
      return false;
    }
    const currentSuppression = this.currentDependencySuppression;
    const terminalConsumptionPending = (
      this.currentVisibleCampaignId !== null
      && [...this.currentDependencyWaits.values()].some((wait) => (
        wait.campaignId === this.currentVisibleCampaignId
        && wait.terminalDelivered
      ))
    );
    const suppressCurrentDependency = (
      terminalConsumptionPending
      || (
        currentSuppression?.epoch === this.playerTurnEpoch
        && currentSuppression.campaignId === this.currentVisibleCampaignId
      )
    );
    if (
      !terminalConsumptionPending
      && currentSuppression?.epoch === this.playerTurnEpoch
    ) {
      this.currentDependencySuppression = null;
    }
    if (suppressCurrentDependency) {
      this.nonblockingContinuation = null;
      return false;
    }
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
    // Raw tool-free prose is the only text that reaches the player without a
    // hash-bound finalizer receipt. Formal mechanical markers in that prose
    // must still be covered by same-epoch authoritative receipts (rules.*
    // roll_id / state.* settlement). Otherwise intercept: hide the message
    // and arm the hidden execute-then-render instruction for the KP.
    const uncoveredMechanical = this.mechanicalMarkersUncovered(visibleText);
    if (uncoveredMechanical.length > 0) {
      this.pendingMechanicalOutputGateEnvelope = (
        buildMechanicalOutputGateEnvelope(
          this.playerTurnEpoch,
          uncoveredMechanical,
        )
      );
      return false;
    }
    return true;
  }

  markAgentEnd(): void {
    this.agentActive = false;
    for (const [key, decision] of this.pending) {
      const openingState = [...this.openingSetupStates.values()].find(
        (candidate) => candidate.dispatchIdentity === key,
      );
      const shouldWake = (
        this.states.get(key) !== "published"
        && (
          openingState === undefined
          || (
            openingState.characterSetupComplete
            && this.claimOpeningContinuationRelease(
              openingState,
              "terminal",
            )
          )
        )
      );
      decision.resolve(shouldWake);
      this.pending.delete(key);
      const currentDependencyId = this.currentDependencyByDispatch.get(key);
      const deliveryPending = currentDependencyId !== undefined
        && this.currentDependencyWaits.get(
          currentDependencyId,
        )?.deliveryPending === true;
      if (!deliveryPending) {
        this.states.delete(key);
        this.dispatchClasses.delete(key);
      }
    }
  }

  decideWake(dispatchKey: string): boolean | Promise<boolean> {
    const dependencyId = this.currentDependencyByDispatch.get(dispatchKey);
    const dependencyWait = dependencyId
      ? this.currentDependencyWaits.get(dependencyId)
      : undefined;
    if (
      dependencyId !== undefined
      && dependencyWait?.dispatchKey === dispatchKey
    ) {
      const sameSettlementWaits = [...this.currentDependencyWaits.values()]
        .filter((wait) => (
          wait.settlementGroupKey === dependencyWait.settlementGroupKey
        ));
      if (sameSettlementWaits.length > 1) {
        this.removeCurrentDependency(dependencyId);
        return false;
      }
      dependencyWait.deliveryPending = true;
    }
    // Source work may finish while character creation is still active. Keep
    // that terminal receipt append-only; the retained projection card becomes
    // the exact continuation after the investigator is durably linked.
    const openingState = [...this.openingSetupStates.values()].find(
      (candidate) => candidate.dispatchIdentity === dispatchKey,
    );
    if (
      openingState !== undefined
      && !openingState.characterSetupComplete
    ) {
      this.states.set(dispatchKey, "published");
      return false;
    }
    if (
      openingState !== undefined
      && openingState.continuationReleaseOwner !== null
    ) {
      this.states.set(dispatchKey, "published");
      return false;
    }
    const state = this.states.get(dispatchKey);
    if (state === "published") {
      this.states.delete(dispatchKey);
      this.dispatchClasses.delete(dispatchKey);
      return false;
    }
    if (
      (state !== "awaiting" && state !== "projected")
      || !this.agentActive
    ) {
      this.states.delete(dispatchKey);
      this.dispatchClasses.delete(dispatchKey);
      if (
        openingState !== undefined
        && !this.claimOpeningContinuationRelease(
          openingState,
          "terminal",
        )
      ) {
        return false;
      }
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
    this.epochMechanicalReceipts.clear();
    this.pendingMechanicalOutputGateEnvelope = null;
    this.clearOpeningSetupRoute();
    this.openingSetupGenerationSequence = 0;
    this.openingSetupAgentTurn = 0;
    this.openingSetupAudits = [];
    for (const decision of this.pending.values()) decision.resolve(false);
    this.pending.clear();
    this.states.clear();
    this.dispatchClasses.clear();
    this.currentDependencyWaits.clear();
    this.currentDependencyByDispatch.clear();
    this.currentDependencySuppression = null;
    this.currentVisibleCampaignId = null;
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

/**
 * Extension-layer forced injection for raw-PDF module binds.
 *
 * Skills are advisory for the live KP: observed DeepSeek sessions receive a
 * player message carrying a local PDF path, never load coc-module-init's bind
 * flow (pi docs: models do not always load SKILL.md), and instead call
 * unrelated setup.invoke operations or claim the system is "producing a source
 * bundle" while no parsing ever happens. This hook structurally detects the
 * `.pdf` path in the player's user message and steers one hidden instruction
 * into the KP context BEFORE its first model call, so `scenario.bind_pdf`
 * becomes the KP's first tool call without relying on the model reading any
 * skill. Injection is once per session per normalized PDF path.
 */
export const PLAYER_PDF_BIND_INSTRUCTION_CUSTOM_TYPE =
  "coc-player-pdf-bind-instruction";

/** One-shot hidden instruction: bind the player-provided raw PDF first. */
export function playerPdfBindInstruction(pdfPath: string): string {
  return (
    `玩家提供了 PDF：${pdfPath}。第一步必须调 \`scenario.bind_pdf\`（参数 `
    + `source_bundle_path=${pdfPath}）。若返回 bundle-must-be-directory 错误，`
    + "这是正确触发，系统会自动产包；等 hidden "
    + "`coc-raw-pdf-bind-first-bundle-terminal` 通知（含真实 bundle 路径）后"
    + "再 bind。不要调 setup.invoke 其他操作，不要宣称系统在后台工作直到收到"
    + "通知。"
  );
}

export type PlayerPdfBindDetection =
  | { status: "inject"; pdfPath: string }
  | { status: "skip"; reason: string };

/**
 * Extract the text payload of a user message (ignores toolResult parts so
 * tool-result transcripts never look like new player input).
 */
function userMessageText(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const value = message as { role?: unknown; content?: unknown };
  if (value.role !== "user") return null;
  if (!Array.isArray(value.content)) return null;
  const texts: string[] = [];
  for (const part of value.content) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as { type?: unknown; text?: unknown };
    if (candidate.type !== "text" || typeof candidate.text !== "string") {
      continue;
    }
    texts.push(candidate.text);
  }
  const text = texts.join("\n").trim();
  return text.length > 0 ? text : null;
}

/**
 * Normalize a raw `.pdf` token into an absolute path. URLs and empty tokens
 * are rejected structurally; `~` and relative paths resolve against the
 * workspace root exactly like the canonical toolbox does for
 * `source_bundle_path`.
 */
function normalizePlayerPdfPath(
  raw: string,
  workspaceRoot: string,
): string | null {
  const stripped = raw.trim().replace(
    /^[`"'“”『「]+|[`"'“”『」]+$/g,
    "",
  );
  if (!stripped) return null;
  // Structural guard: a URL is a link, not a local PDF path. Never treat
  // http(s)://…/x.pdf as a bindable source.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(stripped)) return null;
  const expanded = stripped.startsWith("~/")
    ? join(homedir(), stripped.slice(2))
    : stripped;
  return isAbsolute(expanded)
    ? resolve(expanded)
    : resolve(workspaceRoot, expanded);
}

/**
 * Extract the raw `.pdf` path token from a user message. Priority order:
 * quote-delimited `.pdf` substrings (paths containing spaces), then
 * whitespace tokens ending in `.pdf`. A token's path portion begins at the
 * first path separator so CJK prose directly abutting an absolute path
 * (「跑这个本：/tmp/x.pdf」) never pollutes the resolved path; URL tokens are
 * excluded before extraction.
 */
function extractPdfPathToken(text: string): string | null {
  const quoted = text.match(
    /(?:[`"'“”『「])([^`"'“”『」]*?\.pdf)(?:[`"'“”『」])/i,
  );
  if (quoted) return quoted[1];
  for (const token of text.split(/\s+/)) {
    if (!/\.pdf$/i.test(token)) continue;
    if (token.includes("://")) continue;
    const candidate = token.startsWith("~/")
      ? token
      : (() => {
        const index = token.search(/[/\\]/);
        return index >= 0 ? token.slice(index) : token;
      })();
    const cleaned = candidate.replace(/[\])},.，。、；：]+$/g, "");
    if (!/\.pdf$/i.test(cleaned)) continue;
    return cleaned;
  }
  return null;
}

/**
 * Structural detection, not keyword matching: the only signal is a `.pdf`
 * path token in the player's user message (quote-delimited first so paths
 * containing spaces survive, then any whitespace-delimited token). Returns
 * the normalized absolute path when detected.
 */
export function detectPlayerPdfBindRequest(
  message: unknown,
  workspaceRoot: string,
): PlayerPdfBindDetection {
  const text = userMessageText(message);
  if (text === null) {
    return { status: "skip", reason: "not_a_user_text_message" };
  }
  const rawCandidate = extractPdfPathToken(text);
  if (rawCandidate === null) {
    return { status: "skip", reason: "no_pdf_path_token" };
  }
  const pdfPath = normalizePlayerPdfPath(rawCandidate, workspaceRoot);
  if (pdfPath === null) {
    return { status: "skip", reason: "pdf_path_url_or_empty" };
  }
  return { status: "inject", pdfPath };
}

/**
 * Register the forced-injection listener. On a player user message carrying a
 * real local `.pdf` path, one hidden instruction is steered into the KP
 * context before the first model call of that turn (`deliverAs: "steer"` is
 * drained by the agent loop before `streamAssistantResponse`). Once-per-path
 * dedup survives within the caller-provided session set and is rolled back on
 * a delivery failure so one transient drop does not burn the injection.
 */
export function registerPlayerPdfBindInstruction(
  pi: ExtensionAPI,
  options: {
    workspaceRoot: (ctx: ExtensionContext) => string;
    isCurrent: (epoch: number) => boolean;
    epoch: () => number;
    injectedPaths?: Set<string>;
  },
): void {
  const injectedPaths = options.injectedPaths ?? new Set<string>();
  pi.on("message_start", async (event, ctx) => {
    const detection = await detectPlayerPdfBindRequest(
      event.message,
      options.workspaceRoot(ctx),
    );
    if (detection.status !== "inject") return;
    if (!options.isCurrent(options.epoch())) return;
    if (injectedPaths.has(detection.pdfPath)) return;
    // Only bindable reality is injected: a path that does not exist on disk is
    // a document mention, not a player-provided module, so it stays silent.
    let fileStat;
    try {
      fileStat = await stat(detection.pdfPath);
    } catch {
      return;
    }
    if (!fileStat.isFile()) return;
    injectedPaths.add(detection.pdfPath);
    try {
      pi.sendMessage({
        customType: PLAYER_PDF_BIND_INSTRUCTION_CUSTOM_TYPE,
        content: playerPdfBindInstruction(detection.pdfPath),
        display: false,
        details: {
          schema_version: 1,
          pdf_path: detection.pdfPath,
          instruction_ref: "pi.player-pdf-bind.first-instruction.v1",
        },
      }, { deliverAs: "steer" });
    } catch {
      injectedPaths.delete(detection.pdfPath);
    }
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
  onWakeDeliveryFailure?: (dispatchKey: string) => void,
  onWakeDeliverySuccess?: (dispatchKey: string) => void,
  appendTerminalReceipt = true,
): Promise<JsonObject> {
  let appendStatus = appendTerminalReceipt ? "delivered" : "retained";
  if (appendTerminalReceipt) {
    try { pi.appendEntry("coc-source-coordinator-terminal", receipt); }
    catch { appendStatus = "failed"; }
  }
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
      const structuredBlockingMicro = (
        context?.dispatch_class === "blocking_micro"
        && context?.continuation_class === "blocking_micro"
      );
      if (!structuredBlockingOpening && !structuredBlockingMicro) {
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
            // Only an exact blocking opening or an explicitly marked current
            // blocking_micro dependency creates a model turn. Ordinary
            // background and unclassified terminals remain durable audit
            // entries for the next natural turn.
            pi.sendMessage({
              customType: "coc-source-coordinator-terminal-continuation",
              content: JSON.stringify(notice),
              display: false,
              details: notice,
            }, { triggerTurn: true, deliverAs: "followUp" });
            onWakeDeliverySuccess?.(dispatchKey);
            continuedDispatches.add(dispatchKey);
            continuationStatus = "delivered";
          } catch {
            continuationStatus = "failed";
            try {
              onWakeDeliveryFailure?.(dispatchKey);
            } catch { /* delivery rollback is best effort */ }
          }
        }
      }
    }
  }
  const status = appendStatus !== "failed" && continuationStatus !== "failed"
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
export function deliverMechanicalOutputGateInstruction(
  pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage">,
  envelope: JsonObject | null,
): boolean {
  if (envelope === null) return false;
  try {
    pi.appendEntry("coc-mechanical-output-gate", envelope);
  } catch { /* mechanical gate audit is best effort */ }
  try {
    pi.sendMessage({
      customType: MECHANICAL_OUTPUT_GATE_CUSTOM_TYPE,
      content: JSON.stringify(envelope),
      display: false,
      details: envelope,
    }, { triggerTurn: true, deliverAs: "followUp" });
    return true;
  } catch {
    return false;
  }
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

function locatorDiagnostic(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 512);
}

async function openingReviewRenderedPageCount(root: string): Promise<number> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch { return 0; }
  let count = 0;
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) count += await openingReviewRenderedPageCount(path);
    else if (entry.isFile() && entry.name.endsWith(".md")) count += 1;
  }
  return count;
}

async function writeOpeningReviewTerminalEvidence(
  task: JsonObject,
  failureClass: string,
  producerError: string | undefined,
): Promise<void> {
  const workspace = typeof task.workspace_root === "string"
    ? resolve(task.workspace_root) : "";
  const campaignId = typeof task.campaign_id === "string"
    ? task.campaign_id : "";
  const generation = task.opening_review_generation;
  if (!workspace || !campaignId || !Number.isInteger(generation)) return;
  const bundleRoot = join(
    workspace, ".tmp", "coc-opening-source-review", campaignId,
  );
  const evidenceDir = join(
    workspace, ".coc", "campaigns", campaignId, "logs",
    "opening-source-review-evidence",
  );
  const destination = join(evidenceDir, `transport-terminal-g${String(generation)}.json`);
  const evidence = {
    schema_version: 1,
    secrecy: "keeper_only",
    campaign_id: campaignId,
    opening_review_generation: generation,
    status: "producer_terminal_failure",
    failure_class: failureClass,
    rendered_markdown_pages: await openingReviewRenderedPageCount(bundleRoot),
    transport_lock_path: join(
      workspace, ".coc", "campaigns", campaignId,
      "opening-source-review-transport.lock",
    ),
    ...(producerError ? { producer_error: producerError } : {}),
  };
  try {
    await mkdir(evidenceDir, { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(evidence)}\n`, "utf8");
    await rename(temporary, destination);
  } catch {
    // Lifecycle delivery must not be hidden behind a diagnostic-write fault.
  }
}

function locatorEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "USER",
    "LOGNAME", "SHELL", "CODEX_HOME", "PI_CODING_AGENT_DIR",
    "COC_PI_COMMAND", "COC_PI_PDF_SKILL", "COC_PI_PDF_INSPECTOR_COMMAND",
    "COC_PI_OPENING_MODEL", "COC_PI_PDF_MODEL",
  ];
  return Object.fromEntries(
    allowed.flatMap((key) => (
      typeof process.env[key] === "string" ? [[key, process.env[key]]] : []
    )),
  );
}

export function validatePiSourceScopeLocatorTask(input: unknown): JsonObject {
  const task = asObject(input, "Pi source-scope locator task");
  exactKeys(task, [
    "schema_version", "contract_id", "bootstrap_instruction",
    "instruction_ref", "contract_ref", "contract_revision", "adapter_mode",
    "model_policy", "workspace_root", "campaign_id", "asset_root_id",
    "job_id", "job_kind", "kind", "target_id", "target_label", "reason",
    "source", "source_bundle_path", "cached_pdf_indices",
    "max_selected_pages", "pdf_index_caliber",
    "source_bundle_manifest_contract",
    "result_delivery",
  ], "Pi source-scope locator task");
  if (
    task.schema_version !== 1
    || task.contract_id !== "coc.pi-source-scope-locator-task.v1"
    || task.adapter_mode !== "pi_external_pdf_skill_lifecycle"
    || task.model_policy !== "pinned_xai_grok_4_5_thinking_low"
    || task.max_selected_pages !== 3
    || task.result_delivery !== "natural_completion_notification_only"
  ) throw new Error("Pi source-scope locator task contract drift");
  if (task.pdf_index_caliber !== "printed_page_number_1_based") {
    throw new Error(
      "Pi source-scope locator pdf_index_caliber must be printed_page_number_1_based",
    );
  }
  const cachedPdfIndices = task.cached_pdf_indices;
  if (
    !Array.isArray(cachedPdfIndices)
    || cachedPdfIndices.some(
      (value) => !Number.isInteger(value) || Number(value) < 0,
    )
    || JSON.stringify(cachedPdfIndices) !== JSON.stringify(
      [...new Set(cachedPdfIndices as number[])].sort((a, b) => a - b),
    )
  ) throw new Error(
    "Pi source-scope locator cached_pdf_indices must be unique ascending "
    + "non-negative page indices",
  );
  for (const field of [
    "workspace_root", "campaign_id", "asset_root_id", "job_id", "job_kind",
    "kind", "target_id", "target_label", "source_bundle_path",
  ]) nonEmpty(task[field], field);
  if (
    !isAbsolute(String(task.workspace_root))
    || !isAbsolute(String(task.source_bundle_path))
  ) throw new Error("Pi source-scope locator paths must be absolute");
  const workspaceRoot = resolve(String(task.workspace_root));
  const bundleRoot = resolve(
    workspaceRoot,
    ".tmp",
    "coc-source-scope",
  );
  const bundlePath = resolve(String(task.source_bundle_path));
  if (!bundlePath.startsWith(`${bundleRoot}${sep}`)) {
    throw new Error("Pi source-scope locator bundle path escapes its workspace");
  }
  const source = asObject(task.source, "locator source");
  exactKeys(
    source,
    ["path", "source_id", "title", "file_sha256"],
    "locator source",
  );
  if (
    !isAbsolute(nonEmpty(source.path, "source.path"))
    || !nonEmpty(source.source_id, "source.source_id")
    || !nonEmpty(source.title, "source.title")
    || !/^[a-f0-9]{64}$/.test(nonEmpty(source.file_sha256, "source.file_sha256"))
  ) throw new Error("Pi source-scope locator source identity is invalid");
  return structuredClone(task);
}

async function runLocatorProcess(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<JsonObject> {
  if (!isAbsolute(command)) {
    throw new Error("COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND must be absolute");
  }
  if (Buffer.byteLength(input, "utf8") > MAX_BYTES) {
    throw new Error("source-scope locator stdin exceeds the bounded limit");
  }
  const child = spawn(command, args, {
    cwd: process.cwd(),
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
    env: locatorEnvironment(),
  });
  let stdout = "";
  let stderr = "";
  let stderrBytes = 0;
  const code = await new Promise<number | null>((resolveClose, rejectClose) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void terminateTree(child).then(
        () => rejectClose(error),
        (terminationError) => rejectClose(
          new Error(
            `${error.message}; producer tree termination failed: ${
              terminationError instanceof Error
                ? terminationError.message
                : "unknown error"
            }`,
          ),
        ),
      );
    };
    const abort = () => finishError(new Error("source-scope locator aborted"));
    timer = setTimeout(
      () => finishError(new Error("source-scope locator timed out")),
      timeoutMs,
    );
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, "utf8") > MAX_BYTES) {
        finishError(new Error("source-scope locator stdout exceeded limit"));
      }
    });
    child.stderr.on("data", (chunk) => {
      if (settled) return;
      stderrBytes += chunk.length;
      stderr += chunk.toString();
      if (stderrBytes > MAX_BYTES) {
        finishError(new Error("source-scope locator stderr exceeded limit"));
      }
    });
    child.once("error", finishError);
    child.once("close", (closeCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolveClose(closeCode);
    });
    child.stdin.end(input);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
  if (code !== 0) {
    const diagnostic = locatorDiagnostic(stderr);
    throw new Error(
      `source-scope locator producer failed (exit ${String(code)})${
        diagnostic ? `: ${diagnostic}` : ""
      }`,
    );
  }
  let parsed: unknown;
  try { parsed = JSON.parse(stdout.trim()); }
  catch { throw new Error("source-scope locator producer must return strict JSON"); }
  return asObject(parsed, "source-scope locator producer result");
}

export async function runPiSourceScopeProducer(
  taskValue: unknown,
  options: {
    command?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<JsonObject> {
  const task = validatePiSourceScopeLocatorTask(taskValue);
  const command = options.command
    ?? process.env.COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND
    ?? "";
  if (!command || !isAbsolute(command)) {
    throw new Error(
      "COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND must name an absolute external PDF-skill producer",
    );
  }
  const timeoutMs = options.timeoutMs ?? SOURCE_SCOPE_LOCATOR_TIMEOUT_MS;
  const handshake = await runLocatorProcess(
    command,
    ["--capabilities"],
    "",
    timeoutMs,
    options.signal,
  );
  exactKeys(handshake, [
    "schema_version", "contract_id", "capability", "producer",
    "max_selected_pages", "writes_canonical_bundle", "visual_review",
    "repository_pdf_parser", "ocr", "cache_reference",
  ], "source-scope locator producer handshake");
  if (
    handshake.schema_version !== 1
    || handshake.contract_id
      !== "coc.pi-source-scope-locator-producer-capabilities.v1"
    || handshake.capability !== "bounded_pdf_visual_locator"
    || handshake.max_selected_pages !== 3
    || handshake.writes_canonical_bundle !== true
    || handshake.visual_review !== true
    || handshake.repository_pdf_parser !== false
    || handshake.ocr !== false
  ) throw new Error("source-scope locator producer capability mismatch");
  const receipt = await runLocatorProcess(
    command,
    ["--run"],
    JSON.stringify(task),
    timeoutMs,
    options.signal,
  );
  exactKeys(receipt, [
    "schema_version", "contract_id", "job_id", "status", "kind",
    "target_id", "pdf_indices",
    "source_bundle_path", "failure_class",
  ], "source-scope locator producer receipt");
  const status = String(receipt.status ?? "");
  if (
    receipt.schema_version !== 1
    || receipt.contract_id
      !== "coc.pi-source-scope-locator-producer-result.v1"
    || receipt.job_id !== task.job_id
    || receipt.kind !== task.kind
    || receipt.target_id !== task.target_id
    || !["located", "not_located", "failed"].includes(status)
  ) throw new Error("source-scope locator producer receipt binding drift");
  const indices = receipt.pdf_indices;
  if (
    !Array.isArray(indices)
    || indices.length > 3
    || indices.some((value) => !Number.isInteger(value) || (value as number) < 1)
    || JSON.stringify(indices) !== JSON.stringify(
      [...new Set(indices as number[])].sort((a, b) => a - b),
    )
  ) throw new Error(
    "source-scope locator producer pdf_indices are invalid: must be 1..3 "
    + "ascending positive integers (printed page numbers, 1-based)",
  );
  if (status === "located") {
    if (
      indices.length === 0
      || receipt.source_bundle_path !== task.source_bundle_path
      || receipt.failure_class !== null
    ) throw new Error("located source-scope receipt is incomplete");
  } else if (
    indices.length !== 0
    || receipt.source_bundle_path !== null
    || (
      status === "not_located"
        ? receipt.failure_class !== null
        : typeof receipt.failure_class !== "string"
    )
  ) throw new Error("non-located source-scope receipt is invalid");
  return receipt;
}

async function runPiOpeningSourceReviewTransport(
  task: JsonObject,
  command: string,
  signal?: AbortSignal,
  timeoutMs = OPENING_SOURCE_REVIEW_TIMEOUT_MS,
): Promise<JsonObject> {
  const receipt = await runLocatorProcess(
    command, ["--run-opening-review"], JSON.stringify(task),
    timeoutMs, signal,
  );
  exactKeys(receipt, [
    "schema_version", "contract_id", "status", "campaign_id", "scenario_id",
    "opening_review_generation", "failure_class", "facts",
  ], "opening source review transport receipt");
  const expectedGeneration = receipt.status === "reviewed"
    ? Number(task.opening_review_generation) + 1
    : Number(task.opening_review_generation);
  if (
    receipt.schema_version !== 1
    || receipt.contract_id
      !== "coc.pi-opening-source-review-transport-result.v1"
    || !["reviewed", "failed"].includes(String(receipt.status))
    || receipt.campaign_id !== task.campaign_id
    || receipt.scenario_id !== task.scenario_id
    || !Number.isInteger(receipt.opening_review_generation)
    || Number(receipt.opening_review_generation)
      !== expectedGeneration
    || (receipt.status === "reviewed"
      ? (
        receipt.failure_class !== null
        || !validOpeningTransportFacts(receipt.facts)
      )
      : (
        typeof receipt.failure_class !== "string"
        || receipt.facts !== null
      ))
  ) throw new Error("opening source review transport receipt binding drift");
  return receipt;
}

function validOpeningTransportFacts(value: unknown): value is JsonObject {
  const facts = objectOrNull(value);
  const questions = [
    "era",
    "place",
    "investigator_hook",
    "investigator_constraints",
    "player_safe_summary",
    "content_flags",
  ];
  const stringLimits: Record<string, number> = {
    era: 128,
    place: 256,
    investigator_hook: 512,
    investigator_constraints: 512,
    player_safe_summary: 768,
  };
  if (
    facts === null
    || !exactKeysMatch(facts, [
      "schema_version", "contract_id", ...questions,
    ])
    || facts.schema_version !== 1
    || facts.contract_id !== "coc.opening-fast-facts.v1"
  ) return false;
  let retainedSourceId: string | null = null;
  for (const question of questions) {
    const answer = objectOrNull(facts[question]);
    if (answer === null) return false;
    const status = answer.status;
    const refsKey = status === "source"
      ? "source_refs"
      : status === "unresolved"
        ? "inspected_source_refs"
        : null;
    if (
      refsKey === null
      || !exactKeysMatch(
        answer,
        status === "source"
          ? ["status", "value", "source_refs"]
          : ["status", "inspected_source_refs"],
      )
    ) return false;
    if (status === "source") {
      const factValue = answer.value;
      if (question === "content_flags") {
        if (
          !Array.isArray(factValue)
          || factValue.length === 0
          || factValue.length > 16
          || factValue.some((item) => (
            typeof item !== "string"
            || item.trim().length === 0
            || item.length > 128
          ))
          || new Set(factValue).size !== factValue.length
        ) return false;
      } else if (
        typeof factValue !== "string"
        || factValue.trim().length === 0
        || factValue.length > stringLimits[question]
      ) return false;
    }
    const refs = answer[refsKey];
    if (
      !Array.isArray(refs)
      || refs.length === 0
      || refs.length > 3
    ) return false;
    const seen = new Set<string>();
    for (const candidate of refs) {
      const ref = objectOrNull(candidate);
      if (
        ref === null
        || !exactKeysMatch(ref, ["source_id", "pdf_index"])
        || typeof ref.source_id !== "string"
        || ref.source_id.trim().length === 0
        || ref.source_id.length > 256
        || !Number.isInteger(ref.pdf_index)
        || Number(ref.pdf_index) < 0
      ) return false;
      if (retainedSourceId === null) retainedSourceId = ref.source_id;
      if (ref.source_id !== retainedSourceId) return false;
      const key = `${ref.source_id}:${String(ref.pdf_index)}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
  }
  return true;
}

export function openingSourceReviewTerminalFollowUp(
  receipt: JsonObject,
  route: JsonObject | null,
): JsonObject {
  // The transport receipt is the authoritative review result: its campaign,
  // scenario, generation, and facts were already binding-validated by
  // runPiOpeningSourceReviewTransport before onTerminal. The route is only
  // extension-side state bookkeeping: when the in-memory opening setup state
  // is absent or misaligned (daemon restart, phase already advanced, gate
  // rehydration via a resume probe), observeOpeningSourceReviewTransport
  // returns null. That bookkeeping gap must not convert a genuinely reviewed
  // receipt into a terminal_failure (with a null failure_class): the KP still
  // needs the exact sealed adopt card, and the canonical rehydration path
  // (facts-adoption gate on session.resume) re-arms extension state from the
  // same authoritative campaign state.
  if (
    receipt.status === "reviewed"
    && validOpeningTransportFacts(receipt.facts)
  ) {
    return {
      schema_version: 1,
      status: "reviewed",
      campaign_id: receipt.campaign_id,
      next_operation: {
        operation: "setup.adopt_source_facts",
        invoke_via: "coc_invoke",
        campaign: receipt.campaign_id,
        arguments: {
          campaign_id: receipt.campaign_id,
          facts: receipt.facts,
        },
      },
    };
  }
  return {
    schema_version: 1,
    status: "terminal_failure",
    failure_class: receipt.failure_class,
    campaign_id: receipt.campaign_id,
  };
}

function objectOrNull(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

export function projectPiGuidedCharacterContract(
  value: unknown,
  campaignId: string,
): unknown {
  const envelope = objectOrNull(value);
  const data = objectOrNull(envelope?.data);
  const contract = objectOrNull(data?.result);
  const eraContract = objectOrNull(contract?.guided_quick_fire_campaign_era);
  if (envelope?.ok !== true || data === null || contract === null || eraContract === null) {
    return value;
  }
  let inputMode: GuidedCharacterCreationInputMode | null = null;
  let route = "guided_quick_fire";
  if (
    eraContract.status === "standard_quick_fire_available"
    && eraContract.supported === true
  ) {
    inputMode = "guided_quick_fire";
  } else {
    const fallback = objectOrNull(eraContract.fallback);
    if (
      eraContract.status === "kp_guided_era_adaptive_available"
      && fallback?.status === "available"
      && fallback?.available === true
      && fallback.route === "kp_guided_era_adaptive"
      && fallback.input_mode === "kp_guided_era_adaptive"
    ) {
      inputMode = "kp_guided_era_adaptive";
      route = "kp_guided_era_adaptive";
    }
  }
  if (inputMode === null) {
    return {
      ok: false,
      tool: "setup.investigator_contract",
      error: {
        code: "guided_character_creation_route_unavailable",
        message: "the current campaign exposes no usable guided character-creation route",
        details: {
          campaign_id: campaignId,
          route_status: eraContract.status,
          campaign_era: eraContract.required_sheet_era,
        },
      },
    };
  }
  const payloadSchema = objectOrNull(contract.payload_schema);
  const definitions = objectOrNull(payloadSchema?.$defs);
  const branches = Array.isArray(payloadSchema?.oneOf) ? payloadSchema.oneOf : null;
  if (definitions === null || branches === null) {
    return {
      ok: false,
      tool: "setup.investigator_contract",
      error: { code: "guided_contract_projection_failed" },
    };
  }
  const candidates = branches.filter((branch) => {
    const branchObject = objectOrNull(branch);
    const properties = objectOrNull(branchObject?.properties);
    const creation = objectOrNull(properties?.creation);
    const ref = typeof creation?.$ref === "string" ? creation.$ref : "";
    const definition = ref.startsWith("#/$defs/")
      ? objectOrNull(definitions[ref.slice("#/$defs/".length)])
      : null;
    const definitionProperties = objectOrNull(definition?.properties);
    const mode = objectOrNull(definitionProperties?.input_mode);
    return mode?.const === inputMode;
  });
  if (candidates.length !== 1) {
    return {
      ok: false,
      tool: "setup.investigator_contract",
      error: { code: "guided_contract_projection_failed" },
    };
  }
  const projected = structuredClone(envelope);
  const projectedData = objectOrNull(projected.data)!;
  const projectedContract = objectOrNull(projectedData.result)!;
  const projectedSchema = objectOrNull(projectedContract.payload_schema)!;
  const projectedDefinitions = objectOrNull(projectedSchema.$defs)!;
  const droppedBranches: string[] = [];
  const dropDefinition = (key: string): void => {
    if (key in projectedDefinitions) {
      delete projectedDefinitions[key];
      droppedBranches.push(key);
    }
  };
  projectedSchema.oneOf = [structuredClone(candidates[0])];
  dropDefinition("complete_sheet");
  dropDefinition("complete_sheet_creation");
  if (inputMode === "kp_guided_era_adaptive") {
    dropDefinition("quick_fire_sheet");
    dropDefinition("quick_fire_creation");
    // Adaptive create does not consume Quick Fire skill-catalog rows; drop the
    // bulk so a host that already applied keeper_hot_v1 still retains schema.
    const catalog = objectOrNull(projectedContract.guided_quick_fire_skill_catalog);
    if (catalog !== null && "rows" in catalog) {
      const { rows: _rows, ...catalogMeta } = catalog;
      projectedContract.guided_quick_fire_skill_catalog = catalogMeta;
    }
  }
  projectedSchema.title = `COC7 ${inputMode} investigator.create payload`;
  projectedSchema.description = (
    "Pi opening setup permits only the contract-selected investigator.create "
    + "branch until the exact current investigator create and campaign link succeed."
  );
  projectedContract.applicable_input_mode = inputMode;
  projectedContract.character_creation_route = {
    status: "available",
    route,
    input_mode: inputMode,
  };
  // The transport header can only say a projector ran, not whether anything the
  // KP needs was withheld. Only the branches for input modes this campaign
  // cannot use were dropped, so state that: a KP that reads `payload_projected`
  // alone otherwise concludes its schema was truncated and burns the gate
  // trying to re-fetch a fuller one that does not exist.
  projectedContract.payload_schema_projection = {
    status: "complete_for_selected_input_mode",
    selected_input_mode: inputMode,
    omitted_unusable_branches: droppedBranches,
    full_schema_available_elsewhere: false,
    note: (
      "This payload_schema is the whole accepted investigator.create shape for "
      + "this campaign. Only branches for input modes it cannot use were "
      + "removed. Build the payload from this schema; do not request a fuller "
      + "schema and do not retry through discovery."
    ),
  };
  return projected;
}

export function findPiOpeningSourceReviewTrigger(
  value: unknown,
): JsonObject | null {
  const envelope = objectOrNull(value);
  const gate = objectOrNull(objectOrNull(envelope?.data)?.opening_gate)
    ?? objectOrNull(objectOrNull(envelope?.error)?.details);
  return gate?.phase === "opening_source_review_required"
    && gate.hard_gate === true && gate.activation_allowed === false
    && typeof gate.campaign_id === "string" && !!gate.campaign_id
    && typeof gate.scenario_id === "string" && !!gate.scenario_id
    && Number.isInteger(gate.opening_review_generation)
    && Number(gate.opening_review_generation) >= 1 ? {
    schema_version: 1,
    contract_id: "coc.pi-opening-source-review-transport.v1",
    campaign_id: gate.campaign_id,
    scenario_id: gate.scenario_id,
    opening_review_generation: gate.opening_review_generation,
  } : null;
}

function findCurrentDependencyLifecycle(value: unknown): {
  campaignId: string;
  waits: JsonObject[];
  dispatches: JsonObject[];
  snapshotScope: JsonObject | null;
} | null {
  const envelope = objectOrNull(value);
  if (envelope?.ok !== true) return null;
  const data = objectOrNull(envelope.data);
  const sceneContext = objectOrNull(data?.scene_context);
  const candidates = [
    objectOrNull(data?.host_work),
    objectOrNull(data?.progressive),
    objectOrNull(sceneContext?.progressive),
  ].filter((candidate) => (
    candidate !== null
    && (
      Array.isArray(candidate.current_dependency_waits)
      || Array.isArray(candidate.current_dependency_dispatches)
    )
  )) as JsonObject[];
  if (candidates.length !== 1) return null;
  const projection = candidates[0];
  const campaignId = typeof projection.campaign_id === "string"
    ? projection.campaign_id.trim()
    : "";
  const waits = Array.isArray(projection.current_dependency_waits)
    ? projection.current_dependency_waits
    : null;
  const dispatches = Array.isArray(projection.current_dependency_dispatches)
    ? projection.current_dependency_dispatches
    : [];
  const snapshotScope = objectOrNull(
    projection.current_dependency_snapshot_scope,
  );
  if (
    !campaignId
    || projection.current_dependency_snapshot_complete !== true
    || waits === null
  ) return null;
  if (
    snapshotScope !== null
    && (
      snapshotScope.schema_version !== 1
      || snapshotScope.contract_id
        !== "coc.source-current-dependency-snapshot-scope.v1"
      || snapshotScope.kind !== "exact_dependency_ref"
      || snapshotScope.campaign_id !== campaignId
      || objectOrNull(snapshotScope.dependency_ref) === null
    )
  ) return null;
  const waitById = new Map<string, JsonObject>();
  for (const value of waits) {
    const wait = objectOrNull(value);
    const dependencyId = typeof wait?.dependency_id === "string"
      ? wait.dependency_id.trim()
      : "";
    const jobId = typeof wait?.job_id === "string"
      ? wait.job_id.trim()
      : "";
    const waitCampaignId = typeof wait?.campaign_id === "string"
      ? wait.campaign_id.trim()
      : "";
    if (
      wait?.schema_version !== 1
      || wait.contract_id !== "coc.source-current-dependency-wait.v1"
      || !dependencyId
      || !jobId
      || waitCampaignId !== campaignId
      || objectOrNull(wait.dependency_ref) === null
      || (
        snapshotScope !== null
        && JSON.stringify(wait.dependency_ref)
          !== JSON.stringify(snapshotScope.dependency_ref)
      )
      || waitById.has(dependencyId)
    ) return null;
    waitById.set(dependencyId, wait);
  }
  const validatedDispatches: JsonObject[] = [];
  for (const value of dispatches) {
    const dispatch = objectOrNull(value);
    const dependencyId = typeof dispatch?.dependency_id === "string"
      ? dispatch.dependency_id.trim()
      : "";
    const jobId = typeof dispatch?.job_id === "string"
      ? dispatch.job_id.trim()
      : "";
    const wait = waitById.get(dependencyId);
    const action = objectOrNull(dispatch?.next_host_action);
    const task = objectOrNull(action?.task);
    const packet = objectOrNull(task?.packet);
    if (
      wait === undefined
      || dispatch?.campaign_id !== campaignId
      || wait.job_id !== jobId
      || JSON.stringify(wait.dependency_ref)
        !== JSON.stringify(dispatch?.dependency_ref)
      || action?.action !== "invoke_coc_dispatch_source_work"
      || task?.contract_id !== "coc.pi-source-coordinator-task.v1"
      || packet?.campaign_id !== campaignId
    ) return null;
    validatedDispatches.push(dispatch);
  }
  return {
    campaignId,
    waits: [...waitById.values()],
    dispatches: validatedDispatches,
    snapshotScope,
  };
}

function currentDependencySubmissionRetained(value: unknown): boolean {
  const result = objectOrNull(value);
  return [
    "activating", "pending", "retrying", "submitted",
  ].includes(String(result?.status ?? ""));
}

interface RawPdfBindBundleDispatchDeps {
  isCurrent(): boolean;
  workspaceRoot: string;
  command(): string | undefined;
  states: Map<string, JsonObject>;
  controllers: Map<string, AbortController>;
  inflight: Map<string, Promise<JsonObject>>;
  inflightCampaigns: Map<string, string>;
  waitNotifiedCampaigns: Set<string>;
  onTerminal(result: JsonObject): void;
  audit(entry: JsonObject): void;
  timeoutMs?: number;
}

function rawPdfBindFailure(value: unknown, params: JsonObject): JsonObject | null {
  if (params.operation !== "setup.invoke") return null;
  const setupArguments = objectOrNull(params.arguments);
  const payload = objectOrNull(setupArguments?.payload);
  if (setupArguments?.kind !== "scenario.bind_pdf" || payload === null) return null;
  const envelope = value instanceof CanonicalToolError
    ? objectOrNull(value.envelope)
    : objectOrNull(value);
  const error = objectOrNull(envelope?.error);
  const sourceBundlePath = typeof payload.source_bundle_path === "string"
    ? payload.source_bundle_path.trim()
    : "";
  const campaignId = typeof params.campaign === "string"
    ? params.campaign.trim()
    : typeof payload.campaign_id === "string"
      ? payload.campaign_id.trim()
      : "";
  if (
    envelope?.ok !== false
    || envelope.tool !== "setup.invoke"
    || !sourceBundlePath
    || !campaignId
    || typeof error?.message !== "string"
    || !error.message.includes(RAW_PDF_BIND_BUNDLE_ERROR)
  ) return null;
  return { campaign_id: campaignId, source_bundle_path: sourceBundlePath };
}

async function executableAbsoluteFile(command: string | undefined): Promise<string | null> {
  if (!command || !isAbsolute(command)) return null;
  try {
    const resolved = await realpath(command);
    const fileStat = await stat(resolved);
    return fileStat.isFile() && (fileStat.mode & 0o111) !== 0 ? resolved : null;
  } catch {
    return null;
  }
}

export async function autoDispatchPiRawPdfBindBundle(
  deps: RawPdfBindBundleDispatchDeps,
  toolName: string,
  value: unknown,
  params: JsonObject,
): Promise<JsonObject | null> {
  if (!isCanonicalInvokeSurface(toolName)) return null;
  const failedBind = rawPdfBindFailure(value, params);
  if (failedBind === null) return null;
  const suppliedPath = isAbsolute(failedBind.source_bundle_path)
    ? resolve(failedBind.source_bundle_path)
    : resolve(deps.workspaceRoot, failedBind.source_bundle_path);
  const key = `raw-pdf-bind:${suppliedPath}`;
  const previous = deps.states.get(key);
  if (previous !== undefined) return previous;
  const inflight = deps.inflight.get(key);
  if (inflight !== undefined) return inflight;
  // A raw PDF bind commonly reaches the KP as one canonical failure before
  // the private producer can return its accepted bundle path. Do not turn a
  // later guessed path in that same campaign into a second, false terminal
  // failure: it has not been examined by a producer and the active job is the
  // only authority that can say whether first-bundle production failed.
  const activeDispatchKey = deps.inflightCampaigns.get(failedBind.campaign_id);
  if (activeDispatchKey !== undefined) {
    const waiting = {
      status: "waiting",
      dispatch_key: key,
      campaign_id: failedBind.campaign_id,
      active_dispatch_key: activeDispatchKey,
    };
    deps.audit(waiting);
    if (
      deps.isCurrent()
      && !deps.waitNotifiedCampaigns.has(failedBind.campaign_id)
    ) {
      deps.waitNotifiedCampaigns.add(failedBind.campaign_id);
      deps.onTerminal(waiting);
    }
    return waiting;
  }
  // One producer run per bind path: a retry while the first locator child is
  // still in flight must await the same run instead of launching a second
  // concurrent child (two children render the same PDF against the same
  // provider account and both slow down; the acceptance run observed a
  // concurrent duplicate timing out at the old 240s budget).
  const run = (async (): Promise<JsonObject> => {
  const finish = (entry: JsonObject) => {
    deps.states.set(key, entry);
    deps.audit(entry);
    if (deps.isCurrent()) deps.onTerminal(entry);
    return entry;
  };
  // A producer that never got to answer says nothing about this PDF, so its
  // outcome must not be remembered as this path's verdict. Terminal states are
  // cached per dispatch key, so without this a single dropped connection made
  // the book unbindable for the rest of the session: every later attempt
  // replayed the cached failure, and the Keeper -- correctly refusing to
  // hammer a terminal result -- had no way forward. The opening review path
  // already distinguishes these; this one did not.
  const retryable = (entry: JsonObject) => {
    deps.audit(entry);
    deps.states.delete(key);
    return entry;
  };
  if (!deps.isCurrent()) {
    return finish({ status: "failed", dispatch_key: key, failure_class: "session_closed" });
  }
  let pdfStat;
  try { pdfStat = await stat(suppliedPath); }
  catch { return finish({ status: "failed", dispatch_key: key, failure_class: "raw_pdf_bind_source_unavailable" }); }
  if (!pdfStat.isFile() || !suppliedPath.toLowerCase().endsWith(".pdf")) {
    return finish({ status: "failed", dispatch_key: key, failure_class: "raw_pdf_bind_source_not_pdf_file" });
  }
  const command = await executableAbsoluteFile(deps.command());
  if (command === null) {
    return finish({ status: "failed", dispatch_key: key, failure_class: "source_scope_locator_command_unavailable" });
  }
  let fileSha256: string;
  try { fileSha256 = createHash("sha256").update(await readFile(suppliedPath)).digest("hex"); }
  catch { return finish({ status: "failed", dispatch_key: key, failure_class: "raw_pdf_bind_source_unreadable" }); }
  const safeCampaign = failedBind.campaign_id.replace(/[^A-Za-z0-9._:-]/g, "_");
  const jobId = `raw-pdf-bind-${fileSha256.slice(0, 16)}`;
  const task = {
    schema_version: 1,
    contract_id: "coc.pi-source-scope-locator-task.v1",
    bootstrap_instruction: "produce a minimal reviewed source bundle for a raw PDF bind retry",
    instruction_ref: "pi.raw-pdf-bind.first-bundle.v1",
    contract_ref: "coc.pi-source-scope-locator-task.v1",
    contract_revision: "1",
    adapter_mode: "pi_external_pdf_skill_lifecycle",
    model_policy: "pinned_xai_grok_4_5_thinking_low",
    workspace_root: resolve(deps.workspaceRoot),
    campaign_id: failedBind.campaign_id,
    asset_root_id: `raw-pdf-bind:${safeCampaign}`,
    job_id: jobId,
    job_kind: "raw_pdf_bind_first_bundle",
    kind: "raw_pdf_bind_first_bundle",
    target_id: `pdf:${fileSha256}`,
    target_label: basename(suppliedPath),
    reason: "scenario.bind_pdf received a raw PDF instead of a source bundle",
    source: {
      path: suppliedPath,
      source_id: `pdf:${fileSha256}`,
      title: basename(suppliedPath),
      file_sha256: fileSha256,
    },
    source_bundle_path: join(
      resolve(deps.workspaceRoot), ".tmp", "coc-source-scope", safeCampaign,
      `${fileSha256.slice(0, 16)}-first-bundle`,
    ),
    cached_pdf_indices: [],
    max_selected_pages: 3,
    pdf_index_caliber: "printed_page_number_1_based",
    // State the manifest shape instead of letting the producer infer it. The
    // repository validates this bundle exactly — `producer` in particular must
    // be the literal below, even though the process writing it is a Pi/Grok
    // child — so a contract id alone left the producer guessing and every raw
    // PDF bind failed with `manifest.producer must equal 'codex-pdf-skill'`.
    source_bundle_manifest_contract: {
      schema_version: 1,
      contract_id: "codex-pdf-skill-source-bundle.v1",
      template: {
        schema_version: 1,
        producer: "codex-pdf-skill",
        source: {
          source_id: "<task.source.source_id>",
          title: "<task.source.title>",
          path: "<task.source.path>",
          file_sha256: "<task.source.file_sha256>",
          page_count: 0,
        },
        pages: [{
          pdf_index: 0,
          markdown_path: "<bundle-relative .md path>",
          text_sha256: "<sha256 of that file's exact bytes>",
          review_state: "auto_accepted",
          parse_confidence: 1,
          // Each anchor must occur verbatim in that page's Markdown; the
          // repository re-checks them, so an invented anchor rejects the bundle.
          grep_anchors: ["<exact substring copied from that page>"],
        }],
      },
    },
    result_delivery: "natural_completion_notification_only",
  };
  let validatedTask: JsonObject;
  try { validatedTask = validatePiSourceScopeLocatorTask(task); }
  catch { return finish({ status: "failed", dispatch_key: key, failure_class: "raw_pdf_bind_task_invalid" }); }
  try { await mkdir(dirname(String(validatedTask.source_bundle_path)), { recursive: true }); }
  catch { return finish({ status: "failed", dispatch_key: key, failure_class: "raw_pdf_bind_output_unavailable" }); }
  const controller = new AbortController();
  deps.controllers.set(key, controller);
  try {
    const receipt = await runPiSourceScopeProducer(validatedTask, {
      command,
      timeoutMs: deps.timeoutMs,
      signal: controller.signal,
    });
    if (receipt.status !== "located") {
      return finish({
        status: "failed", dispatch_key: key,
        failure_class: typeof receipt.failure_class === "string"
          ? receipt.failure_class : "raw_pdf_bind_bundle_not_produced",
      });
    }
    return finish({
      status: "located", dispatch_key: key,
      source_bundle_path: receipt.source_bundle_path,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const aborted = controller.signal.aborted;
    const failureClass = aborted
      ? "raw_pdf_bind_bundle_aborted"
      : message.includes("timed out")
        ? "raw_pdf_bind_bundle_timeout"
        : message.includes("capability")
          ? "raw_pdf_bind_bundle_preflight_failed"
          : "raw_pdf_bind_bundle_failed";
    const entry = {
      status: "failed", dispatch_key: key, failure_class: failureClass,
      ...(message ? { producer_error: locatorDiagnostic(message) } : {}),
    };
    // A preflight rejection is a property of this environment and will repeat;
    // everything else here is the producer failing to answer, which the next
    // attempt may well get past. Retryability does not erase the terminal
    // notification: a real producer exit/timeout is the active job's verdict,
    // unlike a guessed path while that job is still in flight.
    if (failureClass === "raw_pdf_bind_bundle_preflight_failed") {
      return finish(entry);
    }
    const retry = retryable(entry);
    if (deps.isCurrent()) deps.onTerminal(entry);
    return retry;
  } finally {
    if (deps.controllers.get(key) === controller) deps.controllers.delete(key);
  }
  })();
  deps.inflightCampaigns.set(failedBind.campaign_id, key);
  deps.inflight.set(key, run);
  void run.finally(() => {
    if (deps.inflight.get(key) === run) deps.inflight.delete(key);
    if (deps.inflightCampaigns.get(failedBind.campaign_id) === key) {
      deps.inflightCampaigns.delete(failedBind.campaign_id);
      deps.waitNotifiedCampaigns.delete(failedBind.campaign_id);
    }
  });
  return run;
}

export async function autoDispatchPiOpeningSourceReview(
  deps: OpeningSourceReviewDispatchDeps,
  toolName: string,
  value: unknown,
): Promise<JsonObject | null> {
  if (!isCanonicalInvokeSurface(toolName)) return null;
  const trigger = findPiOpeningSourceReviewTrigger(value);
  if (trigger === null) return null;
  const task = {
    ...trigger,
    workspace_root: deps.workspaceRoot,
    // The producer must finish inside the deadline this transport enforces.
    // Telling it the budget is the only way it can size its own work; a fixed
    // inner constant either overruns this deadline or wastes what is left.
    // deps.timeoutMs is optional; the transport applies the same default, so
    // resolve it here rather than handing the producer a NaN budget.
    transport_timeout_seconds: Math.max(1, Math.floor(
      (deps.timeoutMs ?? OPENING_SOURCE_REVIEW_TIMEOUT_MS) / 1000,
    )),
  };
  const key = (
    `opening-source-review:${trigger.campaign_id}:`
    + String(trigger.opening_review_generation)
  );
  const previous = deps.states.get(key);
  if (previous !== undefined) return previous;
  const finish = (entry: JsonObject) => {
    deps.states.set(key, entry);
    deps.audit(entry);
    return entry;
  };
  const retryable = (entry: JsonObject) => {
    deps.audit(entry);
    deps.states.delete(key);
    return entry;
  };
  const submitted = { status: "submitted", dispatch_key: key };
  finish(submitted);
  const command = deps.command();
  if (!command || !isAbsolute(command) || !deps.isCurrent()) {
    return retryable({
      status: "retryable_failure",
      dispatch_key: key,
      failure_class: !deps.isCurrent()
        ? "session_closed"
        : "opening_source_review_command_unavailable",
    });
  }
  const controller = new AbortController();
  deps.controllers.set(key, controller);
  try {
    const receipt = await runPiOpeningSourceReviewTransport(
      task, command, controller.signal, deps.timeoutMs,
    );
    const terminal = finish({
      status: receipt.status,
      dispatch_key: key,
      receipt,
    });
    if (deps.isCurrent()) deps.onTerminal(receipt);
    return terminal;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const failureClass = controller.signal.aborted
      ? "opening_source_review_aborted"
      : message.includes("timed out")
        ? "opening_source_review_timeout"
        : "opening_source_review_transport_failed";
    const producerError = message ? locatorDiagnostic(message) : undefined;
    // The transport can die after it has rendered pages but before it writes a
    // receipt. Keep this outcome retryable, but never leave the KP without a
    // terminal event: the canonical task remains pending for the next retry.
    await writeOpeningReviewTerminalEvidence(task, failureClass, producerError);
    const terminalReceipt: JsonObject = {
      schema_version: 1,
      contract_id: "coc.pi-opening-source-review-transport-result.v1",
      status: "failed",
      campaign_id: task.campaign_id,
      scenario_id: task.scenario_id,
      opening_review_generation: task.opening_review_generation,
      failure_class: failureClass,
      facts: null,
    };
    const retry = retryable({
      status: "retryable_failure",
      dispatch_key: key,
      failure_class: failureClass,
      ...(producerError ? { producer_error: producerError } : {}),
    });
    if (deps.isCurrent()) deps.onTerminal(terminalReceipt);
    return retry;
  } finally {
    if (deps.controllers.get(key) === controller) {
      deps.controllers.delete(key);
    }
  }
}

type PendingStewardDomain = "npc" | "scene" | "clue" | "rule";

const PENDING_STEWARD_DOMAINS: PendingStewardDomain[] = [
  "npc", "scene", "clue", "rule",
];

function piOpeningGateCleared(
  params: JsonObject,
  value: unknown,
): string | null {
  if (
    params.operation !== "progressive.opening_bootstrap"
    && params.operation !== "progressive.project_opening"
  ) return null;
  const campaignId = typeof params.campaign === "string"
    ? params.campaign.trim()
    : "";
  const envelope = objectOrNull(value);
  const data = objectOrNull(envelope?.data);
  return (
    campaignId
    && envelope?.ok === true
    && (data?.status === "current" || data?.status === "complete")
  ) ? campaignId : null;
}

async function pendingStewardDomains(
  workspaceRoot: string,
  campaignId: string,
): Promise<Array<{ domain: PendingStewardDomain; content: JsonObject }>> {
  const root = resolve(workspaceRoot);
  const saveRoot = resolve(root, ".coc", "campaigns", campaignId, "save");
  const statePath = resolve(saveRoot, "steward-state.json");
  if (!statePath.startsWith(`${saveRoot}${sep}`)) return [];
  let document: JsonObject | null = null;
  try {
    const info = await stat(statePath);
    if (!info.isFile() || info.size > 5_000_000) return [];
    document = objectOrNull(JSON.parse(await readFile(statePath, "utf8")));
  } catch (error) {
    // A missing document is the expected result when every initial domain_put
    // was rejected by the opening gate.  All background domains are pending;
    // malformed/unreadable existing state is not safe to overwrite.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return PENDING_STEWARD_DOMAINS.map((domain) => ({ domain, content: {} }));
    }
    return [];
  }
  if (
    document?.schema_version !== 2
    || document.campaign_id !== campaignId
  ) return [];
  const domains = objectOrNull(document.domains);
  if (domains === null) return [];
  return PENDING_STEWARD_DOMAINS.flatMap((domain) => {
    const snapshot = objectOrNull(domains[domain]);
    if (snapshot?.status !== "pending") return [];
    const { status: _status, ...content } = snapshot;
    return [{ domain, content }];
  });
}

function pendingStewardTask(
  workspaceRoot: string,
  campaignId: string,
  domain: PendingStewardDomain,
  dispatchKey: string,
): JsonObject {
  const agentId = domain === "npc"
    ? "steward-npc"
    : domain === "scene"
      ? "steward-scene"
      : "steward-rule";
  return {
    schema_version: 1,
    contract_id: "coc.pi-steward-pending-refill.v1",
    dispatch_key: dispatchKey,
    campaign_id: campaignId,
    workspace_root: resolve(workspaceRoot),
    domain,
    agent_id: agentId,
    instruction: (
      `Host opening gate is clear. Dispatch ${agentId} once for only the ${domain} domain `
      + `of campaign ${campaignId}. Locate the campaign's canonical page/OCR caches, `
      + "write only the requested pending domain through steward.domain_put, and do not "
      + "rewrite another domain that is already ready. This is host-owned refill work: "
      + "do not ask the player, do not repeat an existing dispatch_key, and do not block play."
    ),
  };
}

interface PendingStewardRefillDeps {
  isCurrent(): boolean;
  workspaceRoot: string;
  states: Map<string, JsonObject>;
  send(task: JsonObject): void;
  recordFailure(
    campaignId: string,
    domain: PendingStewardDomain,
    content: JsonObject,
    dispatchKey: string,
  ): Promise<void>;
  audit(entry: JsonObject): void;
}

/**
 * Queue the normal Pi subagent work for every steward domain still pending when
 * the persisted opening gate clears.  The host owns this recovery fanout; the
 * KP receives exact hidden subagent tasks rather than having to remember a
 * compensating manual retry.  State is keyed per campaign/domain so repeated
 * current-opening receipts and a concurrent manual completion cannot requeue a
 * ready domain.
 */
export async function autoDispatchPiPendingStewardDomains(
  deps: PendingStewardRefillDeps,
  params: JsonObject,
  value: unknown,
): Promise<JsonObject | null> {
  const campaignId = piOpeningGateCleared(params, value);
  if (campaignId === null || !deps.isCurrent()) return null;
  const pending = await pendingStewardDomains(deps.workspaceRoot, campaignId);
  const queued: string[] = [];
  await Promise.all(pending.map(async ({ domain, content }) => {
    const dispatchKey = `steward-refill:${campaignId}:${domain}`;
    if (deps.states.has(dispatchKey)) return;
    const task = pendingStewardTask(
      deps.workspaceRoot, campaignId, domain, dispatchKey,
    );
    deps.states.set(dispatchKey, { status: "submitted", dispatch_key: dispatchKey });
    deps.audit({ status: "submitted", dispatch_key: dispatchKey, campaign_id: campaignId, domain });
    try {
      if (!deps.isCurrent()) throw new Error("session_closed");
      deps.send(task);
      queued.push(domain);
    } catch {
      deps.states.set(dispatchKey, { status: "failed", dispatch_key: dispatchKey });
      deps.audit({ status: "failed", dispatch_key: dispatchKey, campaign_id: campaignId, domain });
      try {
        await deps.recordFailure(campaignId, domain, content, dispatchKey);
        deps.audit({ status: "failure_recorded", dispatch_key: dispatchKey, campaign_id: campaignId, domain });
      } catch {
        deps.audit({ status: "failure_record_failed", dispatch_key: dispatchKey, campaign_id: campaignId, domain });
      }
    }
  }));
  return { status: "submitted", campaign_id: campaignId, domains: queued.sort() };
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

function terminalBlockingOpeningEnvelope(
  bootstrapValue: unknown,
  terminalReceipt: JsonObject,
  submission: JsonObject,
): JsonObject {
  const bootstrap = asObject(bootstrapValue, "opening bootstrap result");
  const bootstrapData = asObject(
    bootstrap.data,
    "opening bootstrap data",
  );
  const sourceWork = objectOrNull(bootstrapData.source_work) ?? {};
  const {
    background_takeover: _privateTakeover,
    ...publicSourceWork
  } = sourceWork;
  return {
    ...bootstrap,
    data: {
      ...bootstrapData,
      status: "source_terminal",
      source_work: {
        ...publicSourceWork,
        status: "fulfilled",
        terminal: true,
      },
      source_dependency_terminal: true,
      projection_ready: false,
      activation_allowed: false,
      coordinator_submission: submission,
      coordinator_terminal: terminalReceipt,
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
  startupCampaignId?: () => string | null;
  welcomeAgentDir?: string;
  launchCoordinator?: (
    task: JsonObject,
    context: PrivateLaunchContext,
    signal?: AbortSignal,
  ) => ChildRun;
}

export function explicitPiStartupCampaignId(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env.PI_COC_CAMPAIGN_ID;
  if (value === undefined) return null;
  if (!isCanonicalCampaignId(value)) {
    throw new Error(
      "PI_COC_CAMPAIGN_ID must match "
      + "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    );
  }
  return value;
}

type StartupResumeGate = {
  campaignId: string;
  workspaceRoot: string;
  phase: "pending" | "terminal_failure";
  failureClass: string | null;
  blockerDelivery: "pending" | "sending" | "delivered" | "exhausted";
  blockerDeliveryAttempts: number;
  hiddenRepromptDelivery: "pending" | "sending" | "delivered";
};

export default function mainExtension(pi: ExtensionAPI, overrides: MainExtensionOverrides = {}) {
  let mcp: McpJsonlClient | null = null;
  let sessionEpoch = 0;
  let sessionClosing = true;
  let sourceProducerStates = new Map<string, JsonObject>();
  let sourceProducerControllers = new Map<string, AbortController>();
  let sourceProducerRuns = new Set<Promise<unknown>>();
  let rawPdfBindBundleStates = new Map<string, JsonObject>();
  let rawPdfBindBundleControllers = new Map<string, AbortController>();
  let rawPdfBindBundleInflight = new Map<string, Promise<JsonObject>>();
  let rawPdfBindBundleInflightCampaigns = new Map<string, string>();
  let rawPdfBindBundleWaitNotifiedCampaigns = new Set<string>();
  let rawPdfBindBundleRuns = new Set<Promise<unknown>>();
  let pendingStewardRefillStates = new Map<string, JsonObject>();
  let pendingStewardRefillRuns = new Set<Promise<unknown>>();
  let injectedPlayerPdfPaths = new Set<string>();
  let startupResumeGate: StartupResumeGate | null = null;
  const openingContinuationGate = new OpeningTerminalContinuationGate();
  const supplyCoordinator = new PiSemanticSupplyCoordinator();
  const sceneSupplyWaits = new Map<string, number>();
  let kpPlayPhase: PlayPhase = "live_turn";
  const resolveAclPhase = (campaignId?: string): PlayPhase => {
    if (startupResumeGate !== null && startupResumeGate.phase === "pending") {
      return "recovery";
    }
    const campaign = typeof campaignId === "string" ? campaignId : "";
    if (campaign && openingContinuationGate.hasActiveOpeningSetupFor(campaign)) {
      return "opening";
    }
    if (!campaign && openingContinuationGate.hasActiveOpeningSetup()) {
      return "opening";
    }
    return kpPlayPhase;
  };
  const applyKpActiveTools = () => {
    if (process.env.PI_SUBAGENT_CHILD === "1") return;
    pi.setActiveTools(activeToolsForPhase(resolveAclPhase()));
  };
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
  const refreshKeeperBriefing = async (
    ctx: ExtensionContext,
    campaignId: string,
    reason: KeeperBriefing["reason"],
  ): Promise<void> => {
    const briefing = await readKeeperBriefing(ctx.cwd, campaignId, reason);
    if (briefing === null) return;
    try {
      pi.sendMessage(keeperBriefingMessage(briefing), { triggerTurn: false });
      pi.appendEntry("coc-keeper-briefing", {
        schema_version: 1,
        status: "delivered",
        campaign_id: campaignId,
        reason,
        custom_type: KEEPER_BRIEFING_CUSTOM_TYPE,
      });
    } catch { /* keeper context refresh is best effort and never blocks play */ }
  };
  const projectCoordinatorTerminal = (receipt: JsonObject) => {
    const dispatchKey = typeof receipt.packet_id === "string"
      ? receipt.packet_id.trim()
      : "";
    const terminalStatus = typeof receipt.status === "string"
      ? receipt.status.trim()
      : "";
    openingContinuationGate.observeOpeningCoordinatorTerminal(receipt);
    openingContinuationGate.observeCurrentDependencyTerminalReceipt(
      dispatchKey,
      receipt,
    );
    const continuationContext = (
      openingContinuationGate.coordinatorContinuationContext(
        dispatchKey,
        terminalStatus,
      )
    );
    return publishCoordinatorTerminal(
      pi,
      receipt,
      supplyCoordinator.terminalDedupe(),
      (key) => openingContinuationGate.decideWake(key),
      () => continuationContext,
      (key) => {
        openingContinuationGate.releaseOpeningTerminalContinuation(key);
        openingContinuationGate.rollbackCurrentDependencyDelivery(key);
      },
      (key) => openingContinuationGate.markCurrentDependencyTerminalDelivered(key),
    );
  };
  const startSemanticSupply = (ctx: ExtensionContext, epoch: number) => {
    supplyCoordinator.start({
      isCurrent: () => isCurrent(epoch),
      coordinatorEnabled: overrides.coordinatorEnabled ?? piCoordinatorEnabled,
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
      launchCoordinator: (task, launch, signal) => (
        overrides.launchCoordinator?.(task, launch, signal)
        ?? spawnPiChild({ role: "coordinator", task, ...launch, signal })
      ),
      callCanonical: (params, signal) => client(ctx).callTool(
        "coc_invoke",
        params,
        signal,
      ),
      appendAudit: (name, value) => { try { pi.appendEntry(name, value); } catch { /* audit is best effort */ } },
      sendHidden: (context, options) => {
        pi.sendMessage({
          customType: "coc-semantic-readiness-private",
          content: JSON.stringify(context),
          display: false,
          details: context,
        }, options);
      },
      projectTerminal: projectCoordinatorTerminal,
      createManager: overrides.createManager,
    });
  };
  const rawPdfBindBundleDispatchDeps = (
    ctx: ExtensionContext,
    epoch: number,
  ): RawPdfBindBundleDispatchDeps => ({
    isCurrent: () => isCurrent(epoch),
    workspaceRoot: resolve(ctx.cwd),
    command: () => process.env.COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND,
    states: rawPdfBindBundleStates,
    controllers: rawPdfBindBundleControllers,
    inflight: rawPdfBindBundleInflight,
    inflightCampaigns: rawPdfBindBundleInflightCampaigns,
    waitNotifiedCampaigns: rawPdfBindBundleWaitNotifiedCampaigns,
    onTerminal: (terminal) => {
      const content = terminal.status === "waiting"
        ? {
          schema_version: 1,
          status: "waiting",
          campaign_id: terminal.campaign_id,
          instruction: "raw PDF 首包正在生成。请等待 hidden located 通知给出的 source_bundle_path；不要猜测路径，也不要重试 scenario.bind_pdf。",
        }
        : terminal.status === "located"
        ? {
          schema_version: 1,
          status: "located",
          source_bundle_path: terminal.source_bundle_path,
          instruction: "首包已产出。请立刻使用该 source_bundle_path 重试 scenario.bind_pdf；不要再把 raw PDF 路径传给 bind。",
        }
        : {
          schema_version: 1,
          status: "terminal_failure",
          failure_class: terminal.failure_class,
          ...(typeof terminal.producer_error === "string"
            ? { producer_error: terminal.producer_error }
            : {}),
          instruction: "raw PDF 首包产出失败。请如实告诉玩家当前环境无法现场解析 PDF，不要自动或反复重试 scenario.bind_pdf。",
        };
      try {
        pi.sendMessage({
          customType: terminal.status === "waiting"
            ? "coc-raw-pdf-bind-first-bundle-wait"
            : "coc-raw-pdf-bind-first-bundle-terminal",
          content: JSON.stringify(content),
          display: false,
          details: content,
        }, { triggerTurn: true, deliverAs: "followUp" });
      } catch { /* hidden retry guidance is best effort */ }
    },
    audit: (entry) => {
      try { pi.appendEntry("coc-raw-pdf-bind-first-bundle-lifecycle", entry); }
      catch { /* lifecycle audit is best effort */ }
    },
  });
  const flushOpeningSetupAudits = () => {
    for (const audit of openingContinuationGate.takeOpeningSetupAudits()) {
      try { pi.appendEntry("coc-opening-setup-route-audit", audit); }
      catch { /* opening setup audit is best effort */ }
    }
  };
  const openingSourceReviewDispatchDeps = (
    ctx: ExtensionContext,
    epoch: number,
  ): OpeningSourceReviewDispatchDeps => ({
    isCurrent: () => isCurrent(epoch),
    workspaceRoot: resolve(ctx.cwd),
    command: () => process.env.COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND,
    states: sourceProducerStates,
    controllers: sourceProducerControllers,
    onTerminal: (receipt) => {
      const route = (
        openingContinuationGate.observeOpeningSourceReviewTransport(receipt)
      );
      flushOpeningSetupAudits();
      const content = openingSourceReviewTerminalFollowUp(receipt, route);
      pi.sendMessage({
        customType: "coc-opening-source-review-terminal",
        content: JSON.stringify(content),
        display: false,
        details: content,
      }, { triggerTurn: true, deliverAs: "followUp" });
    },
    audit: (entry) => {
      try { pi.appendEntry("coc-opening-source-review-lifecycle", entry); }
      catch { /* audit is best effort */ }
    },
  });
  const pendingStewardRefillDispatchDeps = (
    ctx: ExtensionContext,
    epoch: number,
  ): PendingStewardRefillDeps => ({
    isCurrent: () => isCurrent(epoch),
    workspaceRoot: ctx.cwd,
    states: pendingStewardRefillStates,
    send: (task) => {
      pi.sendMessage({
        customType: "coc-steward-pending-refill",
        content: JSON.stringify(task),
        display: false,
        details: task,
      }, { triggerTurn: true, deliverAs: "followUp" });
    },
    recordFailure: async (campaignId, domain, content, dispatchKey) => {
      await client(ctx).callTool("coc_invoke", {
        operation: "steward.domain_put",
        root: ctx.cwd,
        campaign: campaignId,
        arguments: {
          domain,
          status: "pending",
          content,
          failed_chunks: [{
            chunk_id: dispatchKey,
            reason: "Pi pending-steward refill dispatch could not be delivered",
            attempts: 1,
            source_refs: [],
          }],
          decision_id: `${dispatchKey}:delivery-failure`,
        },
      });
    },
    audit: (entry) => {
      try { pi.appendEntry("coc-steward-pending-refill", entry); }
      catch { /* lifecycle audit is best effort */ }
    },
  });
  const initializeSession = (ctx: ExtensionContext): string | null => {
    sessionEpoch += 1;
    sessionClosing = false;
    openingContinuationGate.reset();
    startSemanticSupply(ctx, sessionEpoch);
    sourceProducerStates = new Map<string, JsonObject>();
    sourceProducerControllers = new Map<string, AbortController>();
    sourceProducerRuns = new Set<Promise<unknown>>();
    rawPdfBindBundleStates = new Map<string, JsonObject>();
    rawPdfBindBundleControllers = new Map<string, AbortController>();
    rawPdfBindBundleInflight = new Map<string, Promise<JsonObject>>();
    rawPdfBindBundleInflightCampaigns = new Map<string, string>();
    rawPdfBindBundleWaitNotifiedCampaigns = new Set<string>();
    rawPdfBindBundleRuns = new Set<Promise<unknown>>();
    pendingStewardRefillStates = new Map<string, JsonObject>();
    pendingStewardRefillRuns = new Set<Promise<unknown>>();
    const startupCampaignId = overrides.startupCampaignId === undefined
      ? explicitPiStartupCampaignId()
      : overrides.startupCampaignId();
    startupResumeGate = startupCampaignId === null
      ? null
      : {
          campaignId: startupCampaignId,
          workspaceRoot: ctx.cwd,
          phase: "pending",
          failureClass: null,
          blockerDelivery: "pending",
          blockerDeliveryAttempts: 0,
          hiddenRepromptDelivery: "pending",
        };
    const tableIntent = tableOpenIntentFromEnv();
    const openingGateActive = openingContinuationGate.hasActiveOpeningSetup();
    if (
      tableIntent === "character-setup"
      || startupCampaignId !== null
      || openingGateActive
    ) {
      kpPlayPhase = "opening";
    } else {
      kpPlayPhase = "cold_start";
    }
    // The host owns exact nested coordinator-task dispatch. Keep the
    // fail-closed tool registered for the private manager boundary and probes,
    // but never expose it to the KP model. A pi-subagents child process owns
    // its own active surface: the agent's --tools allowlist (steward agents
    // carry bash/read/grep/find on the host filesystem). Forcing the KP set
    // here would wipe that allowlist; the KP root session is unaffected
    // because it never carries PI_SUBAGENT_CHILD=1.
    applyKpActiveTools();
    return startupCampaignId;
  };
  const exactStartupResumeInvocation = (
    name: string,
    params: JsonObject,
  ): boolean => {
    const gate = startupResumeGate;
    const args = objectOrNull(params.arguments);
    return (
      gate !== null
      && gate.phase === "pending"
      && isCanonicalInvokeSurface(name)
      && params.operation === "session.resume"
      && params.root === gate.workspaceRoot
      && params.campaign === gate.campaignId
      && args !== null
      && Object.keys(args).length === 0
    );
  };
  const startupResumeToolError = (
    name: string,
    params: JsonObject,
  ): string | null => {
    const gate = startupResumeGate;
    if (
      gate === null
      || name === "coc_capabilities"
      || exactStartupResumeInvocation(name, params)
    ) {
      return null;
    }
    if (gate.phase === "terminal_failure") {
      return (
        "Pi startup continuation is terminally blocked "
        + `(failure_class=${gate.failureClass ?? "startup_resume_failed"}). `
        + "Relaunch pi-coc with the corrected --campaign <campaign_id>."
      );
    }
    return (
      "Pi startup continuation is hard-gated until the selected campaign "
      + "enters the current KP context. "
      + startupResumeInstruction(gate.campaignId, gate.workspaceRoot)
    );
  };
  const publishStartupResumeBlocker = (
    gate: StartupResumeGate,
    failureClass: string,
  ): void => {
    if (
      gate.blockerDelivery !== "pending"
      || gate.blockerDeliveryAttempts >= 2
    ) return;
    gate.blockerDelivery = "sending";
    gate.blockerDeliveryAttempts += 1;
    try {
      pi.sendMessage({
        customType: "coc-startup-resume-blocker",
        content: (
          "【COC 启动受阻】无法载入明确指定的战役"
          + `（failure_class: ${failureClass}）。`
          + "为避免进入错误战役，当前桌面已停止战役、设置与来源操作。"
          + "请退出后使用 `pi-coc --campaign <正确的 campaign_id>` 重新启动；"
          + "如需新的 Pi 对话记录，可同时加上 `--new`。"
        ),
        display: true,
        details: {
          schema_version: 1,
          status: "terminal_failure",
          failure_class: failureClass,
          campaign_id: gate.campaignId,
          recovery: "relaunch_with_corrected_campaign_selector",
        },
      }, { triggerTurn: false });
      gate.blockerDelivery = "delivered";
    } catch {
      gate.blockerDelivery = gate.blockerDeliveryAttempts >= 2
        ? "exhausted"
        : "pending";
    }
  };
  const terminalizeStartupResume = (failureClass: string): void => {
    const gate = startupResumeGate;
    if (gate === null || gate.phase === "terminal_failure") return;
    gate.phase = "terminal_failure";
    gate.failureClass = failureClass;
    publishStartupResumeBlocker(gate, failureClass);
  };
  const canonicalFailureClass = (value: unknown): string => (
    typeof value === "string"
    && /^[a-z][a-z0-9_]{0,63}$/.test(value)
  )
    ? value
    : "startup_resume_failed";
  const acceptedResumeModes = new Set([
    "already_acknowledged",
    "pending_finalization",
    "open_turn_recovery",
    "awaiting_player",
  ]);
  const classifyStartupResumeResult = (
    value: unknown,
    campaignId: string,
    openingObservation: OpeningSetupObservationDisposition,
  ): { accepted: true } | { accepted: false; failureClass: string } => {
    if (
      openingObservation.reason === "prebound_opening_selection"
      || openingObservation.reason
        === "prebound_opening_source_facts_adoption_required"
      || openingObservation.reason
        === "prebound_opening_character_setup"
      || openingObservation.reason
        === "prebound_opening_source_materialization"
      || openingObservation.reason
        === "prebound_opening_source_review_required"
    ) {
      return { accepted: true };
    }
    if (openingObservation.reason === "source_contract_invalid") {
      return {
        accepted: false,
        failureClass: "opening_source_contract_invalid",
      };
    }
    const envelope = objectOrNull(value);
    if (
      envelope === null
      || envelope.tool !== "session.resume"
      || typeof envelope.ok !== "boolean"
    ) {
      return {
        accepted: false,
        failureClass: "startup_resume_result_invalid",
      };
    }
    const data = objectOrNull(envelope.data);
    if (envelope.ok === true) {
      if (
        data === null
        || data.schema_version !== 1
        || data.campaign_id !== campaignId
        || typeof data.mode !== "string"
        || !acceptedResumeModes.has(data.mode)
      ) {
        return {
          accepted: false,
          failureClass: (
            data !== null
            && typeof data.campaign_id === "string"
            && data.campaign_id !== campaignId
          )
            ? "startup_resume_campaign_mismatch"
            : "startup_resume_result_invalid",
        };
      }
      return { accepted: true };
    }
    const error = objectOrNull(envelope.error);
    return {
      accepted: false,
      failureClass: canonicalFailureClass(error?.code),
    };
  };
  type StartupCanonicalFailureProjection =
    | { kind: "not_canonical" }
    | { kind: "invalid" }
    | { kind: "projected"; envelope: JsonObject };
  const projectStartupSourceFactsAdoption = (
    details: JsonObject,
    campaignId: string,
  ): JsonObject | null => {
    const card = objectOrNull(details.next_operation);
    const args = objectOrNull(card?.arguments);
    if (
      !exactKeysMatch(details, [
        "schema_version", "status", "hard_gate", "activation_allowed",
        "phase", "campaign_id", "scenario_id",
        "opening_review_generation", "next_operation", "instruction",
      ])
      || details.schema_version !== 1
      || details.status !== "blocked"
      || details.hard_gate !== true
      || details.activation_allowed !== false
      || details.phase !== "opening_source_facts_adoption_required"
      || details.campaign_id !== campaignId
      || typeof details.scenario_id !== "string"
      || !Number.isInteger(details.opening_review_generation)
      || card === null
      || !exactKeysMatch(card, [
        "operation", "invoke_via", "campaign", "arguments",
      ])
      || card.operation !== "setup.adopt_source_facts"
      || card.invoke_via !== "coc_invoke"
      || card.campaign !== campaignId
      || args === null
      || !exactKeysMatch(args, ["campaign_id", "facts"])
      || args.campaign_id !== campaignId
      || !validOpeningTransportFacts(args.facts)
    ) return null;
    return structuredClone(details);
  };
  const projectStartupOpeningSelection = (
    details: JsonObject,
    campaignId: string,
  ): JsonObject | null => {
    const card = objectOrNull(details.next_operation);
    const prefilled = objectOrNull(card?.prefilled_arguments);
    if (
      details.schema_version !== 1
      || details.status !== "blocked"
      || details.hard_gate !== true
      || details.activation_allowed !== false
      || details.phase !== "opening_selection"
      || details.campaign_id !== campaignId
      || card === null
      || card.operation !== "progressive.prepare_opening"
      || card.invoke_via !== "coc_invoke"
      || card.hard_gate !== true
      || card.authority !== "canonical_setup"
      || prefilled === null
      || !exactKeysMatch(prefilled, [])
      || !Array.isArray(card.missing_arguments)
      || card.missing_arguments.length !== 0
    ) return null;
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_selection",
      campaign_id: campaignId,
      next_operation: {
        operation: "progressive.prepare_opening",
        invoke_via: "coc_invoke",
        prefilled_arguments: {},
        missing_arguments: [],
        hard_gate: true,
        authority: "canonical_setup",
      },
      instruction: (
        "invoke the exact retained progressive.prepare_opening route"
      ),
    };
  };
  const projectStartupCharacterSetup = (
    details: JsonObject,
    campaignId: string,
  ): JsonObject | null => {
    if (details.character_setup_policy === "kp_guided_era_adaptive") {
      if (
        !exactKeysMatch(details, [
          "schema_version", "status", "hard_gate", "activation_allowed",
          "phase", "campaign_id", "character_setup_policy",
          "character_setup_input_mode", "next_operation", "instruction",
        ])
        || details.schema_version !== 1
        || details.status !== "blocked"
        || details.hard_gate !== true
        || details.activation_allowed !== false
        || details.phase !== "opening_character_setup_required"
        || details.campaign_id !== campaignId
        || details.character_setup_input_mode !== "kp_guided_era_adaptive"
        || details.next_operation !== null
        || typeof details.instruction !== "string"
      ) return null;
      return {
        schema_version: 1,
        status: "blocked",
        hard_gate: true,
        activation_allowed: false,
        phase: "opening_character_setup_required",
        campaign_id: campaignId,
        character_setup_policy: "kp_guided_era_adaptive",
        character_setup_input_mode: "kp_guided_era_adaptive",
        next_operation: null,
        instruction: (
          "complete the retained KP-guided era-adaptive investigator creation "
          + "and exact campaign link before opening play"
        ),
      };
    }
    if (
      !exactKeysMatch(details, [
        "schema_version",
        "status",
        "hard_gate",
        "activation_allowed",
        "phase",
        "campaign_id",
        "character_setup_policy",
        "next_operation",
        "instruction",
      ])
      || details.schema_version !== 1
      || details.status !== "blocked"
      || details.hard_gate !== true
      || details.activation_allowed !== false
      || details.phase !== "opening_character_setup_required"
      || details.campaign_id !== campaignId
      || details.character_setup_policy !== "guided_quick_fire"
      || details.next_operation !== null
      || typeof details.instruction !== "string"
    ) return null;
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_character_setup_required",
      campaign_id: campaignId,
      character_setup_policy: "guided_quick_fire",
      next_operation: null,
      instruction: (
        "complete the retained guided Quick Fire investigator creation and "
        + "exact campaign link before opening play"
      ),
    };
  };
  const projectStartupSourceMaterialization = (
    details: JsonObject,
    campaignId: string,
  ): JsonObject | null => {
    if (
      details.schema_version !== 1
      || details.status !== "blocked"
      || details.hard_gate !== true
      || details.activation_allowed !== false
      || details.phase !== "opening_source_materialization"
      || (
        details.campaign_id !== undefined
        && details.campaign_id !== campaignId
      )
    ) return null;
    // Whenever the canonical gate hands back a recovery card rather than a
    // wait, forward it. Projecting the card away is what leaves the Keeper
    // answering player turns with empty messages: it is told it is blocked and
    // given nothing to do. Only the exact recovery operations are forwarded,
    // and the canonical instruction travels with them rather than being
    // reworded here.
    const lifecycleStatus = String(details.source_lifecycle_status ?? "");
    if (lifecycleStatus !== "pending") {
      const card = objectOrNull(details.next_operation);
      if (
        card === null
        || (
          card.operation !== "progressive.opening_bootstrap"
          && card.operation !== "progressive.project_opening"
        )
        || card.invoke_via !== "coc_invoke"
        || card.hard_gate !== true
        || objectOrNull(card.prefilled_arguments) === null
        || !Array.isArray(card.missing_arguments)
        || typeof details.instruction !== "string"
        || details.instruction.trim().length === 0
      ) return null;
      const projected: JsonObject = {
        schema_version: 1,
        status: "blocked",
        hard_gate: true,
        activation_allowed: false,
        phase: "opening_source_materialization",
        campaign_id: campaignId,
        source_lifecycle_status: lifecycleStatus,
        next_operation: structuredClone(card),
        instruction: details.instruction,
      };
      if (lifecycleStatus === "resolver_lost") {
        projected.retained_start_location_id = String(
          details.retained_start_location_id ?? "",
        );
      }
      return projected;
    }
    if (
      details.source_lifecycle_status !== "pending"
      || (
        details.next_operation !== undefined
        && details.next_operation !== null
      )
    ) return null;
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_source_materialization",
      campaign_id: campaignId,
      source_lifecycle_status: "pending",
      next_operation: null,
      instruction: (
        "wait for the retained canonical opening source lifecycle terminal "
        + "event before any setup or play operation"
      ),
    };
  };
  const projectStartupSourceReviewRequired = (
    details: JsonObject,
    campaignId: string,
  ): JsonObject | null => {
    if (
      details.schema_version !== 1
      || details.status !== "blocked"
      || details.hard_gate !== true
      || details.activation_allowed !== false
      || details.phase !== "opening_source_review_required"
      || details.campaign_id !== campaignId
      || typeof details.scenario_id !== "string"
      || !details.scenario_id
      || details.source_provenance
        !== "selection_hint_only_not_provenance"
      || details.required_source_owner
        !== "coc-opening-source-coordinator"
      || !Number.isInteger(details.opening_review_generation)
      || Number(details.opening_review_generation) < 1
      || typeof details.character_setup_complete !== "boolean"
      || details.next_operation !== null
    ) return null;
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_source_review_required",
      campaign_id: campaignId,
      scenario_id: details.scenario_id,
      source_provenance: "selection_hint_only_not_provenance",
      required_source_owner: "coc-opening-source-coordinator",
      opening_review_generation: details.opening_review_generation,
      character_setup_complete: details.character_setup_complete,
      next_operation: null,
      instruction: (
        "retain the fast locator only for character background while the "
        + "canonical opening source coordinator reviews the complete playable "
        + "opening window"
      ),
    };
  };
  const projectStartupSourceContractInvalid = (
    details: JsonObject,
    campaignId: string,
  ): JsonObject | null => {
    if (
      details.schema_version !== 1
      || details.status !== "blocked"
      || details.hard_gate !== true
      || details.activation_allowed !== false
      || details.phase !== "opening_source_contract_invalid"
      || (
        details.campaign_id !== undefined
        && details.campaign_id !== campaignId
      )
      || (
        details.next_operation !== undefined
        && details.next_operation !== null
      )
    ) return null;
    const sourceContract = objectOrNull(details.source_contract_error);
    const sourceCode = canonicalFailureClass(sourceContract?.code);
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_source_contract_invalid",
      campaign_id: campaignId,
      source_contract_error: { code: sourceCode },
      next_operation: null,
      instruction: (
        "the canonical opening source contract is invalid; stop setup and "
        + "play until the contract is repaired"
      ),
    };
  };
  const startupCanonicalFailureProjection = (
    error: unknown,
    name: string,
    params: JsonObject,
  ): StartupCanonicalFailureProjection => {
    if (!(error instanceof CanonicalToolError)) {
      return { kind: "not_canonical" };
    }
    const envelope = objectOrNull(error.envelope);
    const envelopeError = objectOrNull(envelope?.error);
    const envelopeDetails = objectOrNull(envelopeError?.details);
    if (
      error.toolName !== name
      || envelope === null
      || envelope.ok !== false
      || envelope.tool !== "session.resume"
      || envelopeError === null
      || envelopeError.code !== error.code
      || error.details !== envelopeDetails
    ) return { kind: "invalid" };
    const code = canonicalFailureClass(error.code);
    let projectedDetails: JsonObject | null = null;
    if (
      code === "opening_setup_incomplete"
      && typeof params.campaign === "string"
      && envelopeDetails !== null
    ) {
      projectedDetails = (
        projectStartupSourceFactsAdoption(
          envelopeDetails,
          params.campaign,
        )
        ?? projectStartupOpeningSelection(envelopeDetails, params.campaign)
        ?? projectStartupCharacterSetup(envelopeDetails, params.campaign)
        ?? projectStartupSourceMaterialization(
          envelopeDetails,
          params.campaign,
        )
        ?? projectStartupSourceReviewRequired(
          envelopeDetails,
          params.campaign,
        )
        ?? projectStartupSourceContractInvalid(
          envelopeDetails,
          params.campaign,
        )
      );
    }
    return {
      kind: "projected",
      envelope: {
        ok: false,
        tool: "session.resume",
        error: {
          code,
          ...(projectedDetails === null
            ? {}
            : { details: projectedDetails }),
        },
      },
    };
  };
  const sceneSupplyPreflight = async (
    params: JsonObject,
    signal: AbortSignal | undefined,
    ctx: ExtensionContext,
  ): Promise<{ supply: JsonObject | null; blocked: JsonObject | null }> => {
    if (
      process.env.COC_PI_SCENE_SUPPLY !== "1"
      || params.operation !== "state.move_scene"
      || typeof params.campaign !== "string"
    ) {
      return { supply: null, blocked: null };
    }
    const moveArgs = objectOrNull(params.arguments);
    const sceneId = typeof moveArgs?.scene_id === "string" ? moveArgs.scene_id.trim() : "";
    const campaignId = params.campaign.trim();
    if (!sceneId || !campaignId) return { supply: null, blocked: null };
    const waitKey = `${campaignId}\u0000${sceneId}`;
    const check = async (allowMinimalFallback: boolean): Promise<JsonObject | null> => {
      try {
        const response = await client(ctx).callTool("coc_invoke", {
          operation: "steward.scene_supply",
          ...(typeof params.root === "string" ? { root: params.root } : {}),
          campaign: campaignId,
          arguments: {
            scene_id: sceneId,
            ...(allowMinimalFallback ? { allow_minimal_fallback: true } : {}),
          },
        }, signal);
        const envelope = objectOrNull(response);
        return envelope?.ok === true ? objectOrNull(envelope.data) : null;
      } catch {
        // A missing/older steward surface must not turn ordinary play into a
        // host failure. A configured supply gate is enforced only on a valid
        // canonical readiness answer.
        return null;
      }
    };
    let supply = await check(false);
    if (supply === null) return { supply: null, blocked: null };
    let decision = decideSceneSupply(supply, sceneSupplyWaits.get(waitKey) ?? 0);
    if (decision.action === "retry_with_minimal") {
      const minimal = await check(true);
      if (minimal !== null) {
        supply = minimal;
        decision = decideSceneSupply(supply, sceneSupplyWaits.get(waitKey) ?? 0);
      }
    }
    if (decision.action === "allow") {
      sceneSupplyWaits.delete(waitKey);
      return { supply, blocked: null };
    }
    const completedWaits = (sceneSupplyWaits.get(waitKey) ?? 0) + 1;
    sceneSupplyWaits.set(waitKey, completedWaits);
    const content = {
      schema_version: 1,
      contract_id: "coc.pi-scene-supply-wait.v1",
      audience: "keeper_only",
      scene_id: sceneId,
      campaign_id: campaignId,
      completed_waits: completedWaits,
      player_wait_text: decision.playerWaitText,
      source_cache_path: supply.source_cache_path,
      instruction: decision.instruction,
    };
    try {
      pi.sendMessage({
        customType: "coc-scene-supply-wait",
        content: JSON.stringify(content),
        display: false,
        details: content,
      }, { triggerTurn: false });
      pi.appendEntry("coc-scene-supply-gate", content);
    } catch { /* hidden scene-supply guidance/audit is best effort */ }
    return {
      supply,
      blocked: {
        ok: false,
        tool: "state.move_scene",
        error: {
          code: "scene_supply_pending",
          message: "destination SceneBundle is not ready; wait for steward-scene before moving",
        },
        data: {
          scene_supply: supply,
          player_wait_text: decision.playerWaitText,
          retry_policy: "dispatch_or_resume steward-scene, await completion, retry once; then source-bound minimal fallback only",
        },
      },
    };
  };
  const gateway = (name: string) => async (_id: string, params: JsonObject, signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) => {
    if (isCanonicalInvokeSurface(name)) {
      params = normalizePiCocInvokeArguments(params);
    }
    const epoch = sessionEpoch;
    const startupResumeError = startupResumeToolError(name, params);
    if (startupResumeError !== null) {
      try {
        pi.appendEntry("coc-startup-resume-gate", {
          schema_version: 1,
          status: "rejected",
          campaign_id: startupResumeGate?.campaignId,
          tool: name,
          operation: params.operation,
        });
      } catch { /* startup resume audit is best effort */ }
      throw new Error(startupResumeError);
    }
    const startupResumeAttempt = exactStartupResumeInvocation(name, params);
    if (isCanonicalInvokeSurface(name) && PRIVATE_LEASE_OPERATIONS.has(String(params.operation))) {
      try {
        pi.appendEntry("coc-source-coordinator-private-boundary", {
          status: "rejected",
          failure_class: "private_lifecycle_operation",
        });
      } catch { /* private boundary audit is best effort */ }
      throw new Error("canonical operation is reserved for the private source coordinator lifecycle");
    }
    const openingSetupError = openingContinuationGate.openingSetupToolError(
      name,
      params,
      _id,
    );
    flushOpeningSetupAudits();
    if (openingSetupError !== null) {
      try {
        pi.appendEntry("coc-opening-setup-route", {
          status: "rejected",
          failure_class: "opening_setup_incomplete",
          tool: name,
        });
      } catch { /* opening setup audit is best effort */ }
      throw new Error(openingSetupError);
    }
    if (isCanonicalInvokeSurface(name)) {
      const aclPhase = resolveAclPhase(
        typeof params.campaign === "string" ? params.campaign : "",
      );
      const acl = evaluateExecuteAcl({
        toolName: name,
        operation: String(params.operation || ""),
        phase: aclPhase,
      });
      if (!acl.ok) {
        try {
          pi.appendEntry("coc-execute-acl", {
            schema_version: 1,
            status: "rejected",
            code: acl.code,
            tool: name,
            operation: params.operation,
            phase: aclPhase,
          });
        } catch { /* acl audit is best effort */ }
        throw new Error(acl.message);
      }
      try {
        pi.appendEntry("coc-tool-telemetry", {
          schema_version: 1,
          wrapper_tool: acl.wrapper,
          transport_tool: acl.transport_tool,
          canonical_operation: acl.canonical_operation,
          host_tool: name,
          translated_from_invoke: name === "coc_invoke",
          phase: aclPhase,
        });
      } catch { /* telemetry is best effort */ }
    }
    if (isCanonicalInvokeSurface(name)) {
      const dependencyError = (
        openingContinuationGate.currentDependencyToolError(params)
      );
      if (dependencyError !== null) {
        try {
          pi.appendEntry("coc-source-current-dependency-consumption", {
            status: "rejected",
            failure_class: "canonical_projection_required",
            campaign_id: params.campaign,
            operation: params.operation,
          });
        } catch { /* exact dependency audit is best effort */ }
        throw new Error(dependencyError);
      }
    }
    let preparedSceneSupply: JsonObject | null = null;
    if (isCanonicalInvokeSurface(name) && params.operation === "state.move_scene") {
      const preflight = await sceneSupplyPreflight(params, signal, ctx);
      if (preflight.blocked !== null) return result(preflight.blocked);
      preparedSceneSupply = preflight.supply;
    }
    let value: unknown;
    let scenePriorityHandled = false;
    try {
      value = await client(ctx).callTool(
        isCanonicalInvokeSurface(name) ? "coc_invoke" : name,
        params,
        signal,
      );
      if (
        preparedSceneSupply !== null
        && params.operation === "state.move_scene"
        && objectOrNull(value)?.ok === true
      ) {
        const envelope = asObject(value, "scene move envelope");
        const data = asObject(envelope.data, "scene move data");
        value = {
          ...envelope,
          data: {
            ...data,
            scene_supply: preparedSceneSupply,
          },
        };
        const sceneId = String(objectOrNull(params.arguments)?.scene_id ?? "").trim();
        const prefetch = {
          schema_version: 1,
          contract_id: "coc.pi-scene-supply-prefetch.v1",
          audience: "keeper_only",
          scene_id: sceneId,
          source_cache_path: preparedSceneSupply.source_cache_path,
          instruction: (
            "The current SceneBundle is ready. Before continuing ordinary play, "
            + "resume or dispatch steward-scene to prefetch its directory-adjacent, "
            + "same-parent child, if-chain, and next-timeline neighbors. Write every "
            + "source-bound result with steward.scene_bundle_put. This prefetch is "
            + "background preparation only; it does not decide scenes, actions, clues, or narration."
          ),
        };
        try {
          pi.sendMessage({
            customType: "coc-scene-supply-prefetch",
            content: JSON.stringify(prefetch),
            display: false,
            details: prefetch,
          }, { triggerTurn: false });
          pi.appendEntry("coc-scene-supply-prefetch", prefetch);
        } catch { /* hidden prefetch guidance/audit is best effort */ }
      }
    } catch (error) {
      const blockedPhase = error instanceof CanonicalToolError
        ? inferPhaseFromError(error)
        : null;
      if (blockedPhase !== null && blockedPhase !== kpPlayPhase) {
        kpPlayPhase = blockedPhase;
        applyKpActiveTools();
      }
      const rawPdfBindRun = autoDispatchPiRawPdfBindBundle(
        rawPdfBindBundleDispatchDeps(ctx, epoch), name, error, params,
      );
      rawPdfBindBundleRuns.add(rawPdfBindRun);
      // A canonical opening-source-review gate is deliberately a hard error
      // with no next_operation: the KP must not claim or fulfill it.  It is
      // nevertheless the host's dispatch signal.  Previously this error path
      // rethrew before the success-only auto-dispatch below could observe the
      // envelope, so an already-bound Pi campaign stayed pending forever.
      // Use the exact canonical envelope rather than inferring anything from
      // its contract labels; the trigger validates the complete gate shape.
      const openingReviewRun = autoDispatchPiOpeningSourceReview(
        openingSourceReviewDispatchDeps(ctx, epoch),
        name,
        error instanceof CanonicalToolError ? error.envelope : error,
      );
      sourceProducerRuns.add(openingReviewRun);
      void openingReviewRun.catch(() => {}).finally(() => {
        sourceProducerRuns.delete(openingReviewRun);
      });
      void rawPdfBindRun.catch(() => {}).finally(() => {
        rawPdfBindBundleRuns.delete(rawPdfBindRun);
      });
      // Outside the explicit startup gate, a canonical session.resume
      // recovery error is still the persisted opening gate: feed it through
      // the same observation path so the extension in-memory route state is
      // rebuilt from campaign persistent state after a daemon restart or
      // crash (EPIPE/peer death), exactly like the env-armed startup resume.
      const directResumeRecovery = (
        isCanonicalInvokeSurface(name)
        && params.operation === "session.resume"
        && error instanceof CanonicalToolError
        && error.code === "opening_setup_incomplete"
        && error.details !== null
      );
      const canonicalOpeningRefresh = (
        isCanonicalInvokeSurface(name)
        && error instanceof CanonicalToolError
        && openingContinuationGate.reconcileCanonicalOpeningRefresh(
          params,
          error.envelope,
          _id,
        )
      );
      const canonicalFailure = (
        startupResumeAttempt || directResumeRecovery
      )
        ? startupCanonicalFailureProjection(error, name, params)
        : { kind: "not_canonical" as const };
      if (canonicalFailure.kind === "projected") {
        value = canonicalFailure.envelope;
      } else {
        if (canonicalOpeningRefresh) {
          flushOpeningSetupAudits();
          throw error;
        }
        if (startupResumeAttempt) {
          terminalizeStartupResume(
            canonicalFailure.kind === "invalid"
              ? "startup_resume_result_invalid"
              : "startup_resume_transport_failed",
          );
        }
        if (isCanonicalInvokeSurface(name) && !directResumeRecovery) {
          openingContinuationGate.markOpeningSetupRouteAttemptFailure(
            _id,
            params,
            failedBlockingOpeningEnvelope(
              {
                status: "terminal_failure",
                failure_class: "canonical_route_call_failed",
              },
              "opening_setup_route_call_failed",
            ),
          );
          flushOpeningSetupAudits();
        }
        if (canonicalFailure.kind === "invalid") {
          if (startupResumeAttempt) {
            return result({
              ok: false,
              tool: "session.resume",
              error: { code: "startup_resume_result_invalid" },
            });
          }
        }
        throw error;
      }
    }
    if (isCanonicalInvokeSurface(name)) {
      const briefingOperation = String(params.operation);
      const briefingEnvelope = objectOrNull(value);
      const briefingReason = briefingOperation === "session.resume"
        ? "session_resume"
        : (briefingOperation === "steward.domain_put" || briefingOperation === "steward.scene_bundle_put")
          ? "steward_refresh"
          : null;
      if (
        briefingReason !== null
        && briefingEnvelope?.ok === true
        && typeof params.campaign === "string"
        && params.campaign.trim()
        && isCurrent(epoch)
      ) {
        await refreshKeeperBriefing(ctx, params.campaign.trim(), briefingReason);
      }
      const moduleInitResolution = await resolveCanonicalModuleInitPrivateContext(
        ctx.cwd,
        params,
        value,
      );
      if (moduleInitResolution.status === "invalid") {
        value = moduleInitPrivateProjectionFailure(
          moduleInitResolution.campaignId,
        );
      } else if (moduleInitResolution.status === "ready") {
        const moduleInitContext = moduleInitResolution.context;
        if (!isCurrent(epoch)) {
          value = moduleInitPrivateProjectionFailure(
            moduleInitContext.campaign_id,
          );
        } else {
          try {
            pi.sendMessage({
              customType: "coc-module-init-private",
              content: JSON.stringify(moduleInitContext),
              display: false,
              details: moduleInitContext,
            }, { triggerTurn: false });
            try {
              pi.appendEntry("coc-module-init-private-projection", {
                schema_version: 1,
                status: "delivered",
                campaign_id: moduleInitContext.campaign_id,
                l0_sha256: moduleInitContext.l0_sha256,
              });
            } catch { /* private projection audit is best effort */ }
          } catch {
            value = moduleInitPrivateProjectionFailure(
              moduleInitContext.campaign_id,
            );
          }
        }
      }
      scenePriorityHandled = supplyCoordinator.observeCanonical(
        String(params.operation),
        params,
        value,
      );
      openingContinuationGate.observeCurrentDependencyConsumerResult(
        String(params.operation),
        params,
        value,
      );
      const setupVisibleOutput = await canonicalSetupVisibleOutput(
        ctx.cwd,
        params,
        value,
      );
      const openingObservation = (
        openingContinuationGate.observeOpeningSetupInvocation(
          String(params.operation),
          params,
          value,
          _id,
          setupVisibleOutput,
        )
      );
      const rawPdfBindRun = autoDispatchPiRawPdfBindBundle(
        rawPdfBindBundleDispatchDeps(ctx, epoch), name, value, params,
      );
      rawPdfBindBundleRuns.add(rawPdfBindRun);
      void rawPdfBindRun.catch(() => {}).finally(() => {
        rawPdfBindBundleRuns.delete(rawPdfBindRun);
      });
      const openingReviewRun = autoDispatchPiOpeningSourceReview(
        openingSourceReviewDispatchDeps(ctx, epoch),
        name,
        value,
      );
      sourceProducerRuns.add(openingReviewRun);
      void openingReviewRun.catch(() => {}).finally(() => {
        sourceProducerRuns.delete(openingReviewRun);
      });
      const pendingStewardRefillRun = autoDispatchPiPendingStewardDomains(
        pendingStewardRefillDispatchDeps(ctx, epoch), params, value,
      );
      pendingStewardRefillRuns.add(pendingStewardRefillRun);
      void pendingStewardRefillRun.catch(() => {}).finally(() => {
        pendingStewardRefillRuns.delete(pendingStewardRefillRun);
      });
      if (startupResumeAttempt) {
        const selectedCampaignId = startupResumeGate?.campaignId ?? "";
        const disposition = classifyStartupResumeResult(
          value,
          selectedCampaignId,
          openingObservation,
        );
        if (disposition.accepted) {
          startupResumeGate = null;
        } else {
          terminalizeStartupResume(disposition.failureClass);
        }
      }
      value = openingObservation.modelProjection ?? value;
      value = openingContinuationGate.projectGuidedCharacterContract(
        String(params.operation),
        params,
        value,
      );
      flushOpeningSetupAudits();
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
          (
            task !== null
            && dispatchKey
            && !openingObservation.dispatchAllowed
          )
          || (
            !openingObservation.accepted
            && task === null
            && !objectOrNull(bootstrapSourceWork?.background_takeover)
            && bootstrapSourceStatus !== "queued"
            && bootstrapSourceStatus !== "coalesced"
          )
        ) {
          return result(failedBlockingOpeningEnvelope(
            {
              status: "contract_violation",
              failure_class: "opening_bootstrap_result_rejected",
              observer_reason: openingObservation.reason,
            },
            "opening_bootstrap_result_rejected",
          ));
        }
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
          openingContinuationGate.markOpeningSetupRouteAttemptFailure(
            _id,
            params,
            failedBlockingOpeningEnvelope(
              contractViolation,
              "opening_coordinator_task_invalid",
            ),
          );
          flushOpeningSetupAudits();
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
          // Canonical already accepted a live queued/coalesced materialization.
          // Missing takeover here is a transport/projection gap, not a terminal
          // opening_source_failure: surface the canonical receipt and let the
          // materialization gate's dispatch_lost recoverability re-arm later.
          try {
            pi.appendEntry(
              "coc-source-coordinator-auto-dispatch",
              {
                status: "deferred",
                failure_class: "opening_coordinator_task_missing",
                source_status: bootstrapSourceStatus,
              },
            );
          } catch { /* audit is best effort */ }
          flushOpeningSetupAudits();
          return result(value);
        }
        if (dispatchKey) {
          let projectionParams: JsonObject;
          try {
            projectionParams = blockingOpeningProjectionCall(params, value);
          } catch {
            const failure = failedBlockingOpeningEnvelope(
              {
                status: "contract_violation",
                failure_class: "opening_projection_card_invalid",
                dispatch_key: dispatchKey,
              },
              "opening_projection_card_invalid",
            );
            openingContinuationGate.markOpeningSetupRouteAttemptFailure(
              _id,
              params,
              failure,
              dispatchKey,
            );
            flushOpeningSetupAudits();
            return result(failure);
          }
          if (!openingContinuationGate.beginOpeningBackground(
            _id,
            params,
            dispatchKey,
            projectionParams,
          )) {
            return result(failedBlockingOpeningEnvelope(
              {
                status: "contract_violation",
                failure_class: "opening_background_identity_mismatch",
                dispatch_key: dispatchKey,
              },
              "opening_background_identity_mismatch",
            ));
          }
          let submission: JsonObject | null = null;
          try {
            submission = await supplyCoordinator.autoDispatch(
              name,
              value,
              {
                waitForTerminal: false,
                signal,
                submissionOwner: () => (
                  openingContinuationGate.openingSetupDispatchOwned(
                    _id,
                    params,
                    dispatchKey,
                  )
                ),
                onSubmissionOwnershipLost: () => {
                  openingContinuationGate.releaseOpeningSetupDispatchOwnership(
                    _id,
                    dispatchKey,
                  );
                  flushOpeningSetupAudits();
                },
              },
            );
          } catch {
            submission = {
              status: "submit_failed",
              failure_class: signal?.aborted
                ? "coordinator_submit_cancelled"
                : "coordinator_submit_failed",
              dispatch_key: dispatchKey,
            };
          }
          if (
            submission === null
            || [
              "capability_unavailable",
              "capability_check_failed",
              "launch_context_unavailable",
              "session_closed",
              "validation_failed",
              "workspace_drift",
              "ownership_lost",
              "submit_failed",
            ].includes(String(submission.status))
          ) {
            const terminal = submission ?? coordinatorDispatchNullReason(
              supplyCoordinator.activeManager()?.state(dispatchKey),
              dispatchKey,
            );
            openingContinuationGate.markOpeningSetupRouteAttemptFailure(
              _id,
              params,
              failedBlockingOpeningEnvelope(
                terminal,
                "opening_source_background_start_failed",
              ),
              dispatchKey,
            );
            flushOpeningSetupAudits();
            return result(failedBlockingOpeningEnvelope(
              terminal,
              "opening_source_background_start_failed",
            ));
          }
          const backgroundSubmission = (
            openingContinuationGate.markOpeningBackgroundSubmitted(
              _id,
              params,
              dispatchKey,
            )
          );
          if (backgroundSubmission.status === "terminal") {
            flushOpeningSetupAudits();
            if (backgroundSubmission.receipt.status !== "fulfilled") {
              return result(failedBlockingOpeningEnvelope(
                backgroundSubmission.receipt,
                "opening_source_terminal_failure",
              ));
            }
            return result(terminalBlockingOpeningEnvelope(
              value,
              backgroundSubmission.receipt,
              submission,
            ));
          }
          if (backgroundSubmission.status === "stale") {
            const terminal = {
              status: "contract_violation",
              failure_class: "opening_background_submission_stale",
              dispatch_key: dispatchKey,
            };
            openingContinuationGate.markOpeningSetupRouteAttemptFailure(
              _id,
              params,
              failedBlockingOpeningEnvelope(
                terminal,
                "opening_source_background_start_failed",
              ),
              dispatchKey,
            );
            flushOpeningSetupAudits();
            return result(failedBlockingOpeningEnvelope(
              terminal,
              "opening_source_background_start_failed",
            ));
          }
          flushOpeningSetupAudits();
          const {
            background_takeover: _privateTakeover,
            ...publicSourceWork
          } = bootstrapSourceWork ?? {};
          return result({
            ...asObject(value, "opening bootstrap result"),
            data: {
              ...asObject(
                asObject(value, "opening bootstrap result").data,
                "opening bootstrap data",
              ),
              source_work: publicSourceWork,
              source_dependency_terminal: false,
              projection_ready: false,
              activation_allowed: false,
              coordinator_submission: submission,
            },
          });
        }
      }
      const envelope = objectOrNull(value);
      const data = objectOrNull(envelope?.data);
      const operation = String(params.operation);
      openingContinuationGate.observeCanonicalReceipt(operation, envelope);
      const nextPhase = inferPhaseFromEnvelope(operation, value, kpPlayPhase);
      if (nextPhase !== kpPlayPhase) {
        kpPlayPhase = nextPhase;
        applyKpActiveTools();
      }
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
        operation === "evidence.table_opening"
        && envelope?.ok === true
        && typeof data?.text === "string"
        && data.text.length > 0
        && typeof data?.text_sha256 === "string"
      ) {
        openingContinuationGate.markFinalizedOutputReady(
          data.text,
          data.text_sha256,
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
      const invocationCampaignId = typeof params.campaign === "string"
        ? params.campaign.trim()
        : "";
      if (envelope?.ok === true && invocationCampaignId) {
        openingContinuationGate.observeCurrentVisibleInvocation(
          _id,
          invocationCampaignId,
        );
      }
      const dependencyLifecycle = findCurrentDependencyLifecycle(value);
      if (dependencyLifecycle !== null) {
        // The retired request_deepen transport owned the removed projection
        // blocker/suppression helpers. Current dependency snapshots still own
        // terminal suppression and dispatch dedupe through this gate below.
        openingContinuationGate.observeCurrentDependencySnapshot(
          dependencyLifecycle.campaignId,
          dependencyLifecycle.waits,
          dependencyLifecycle.snapshotScope,
        );
        for (const dispatch of dependencyLifecycle.dispatches) {
          const dependencyId = String(dispatch.dependency_id ?? "").trim();
          const jobId = String(dispatch.job_id ?? "").trim();
          const action = objectOrNull(dispatch.next_host_action);
          const task = objectOrNull(action?.task);
          const packet = objectOrNull(task?.packet);
          const dispatchKey = typeof packet?.packet_id === "string"
            ? packet.packet_id.trim()
            : "";
          if (
            task === null
            || openingContinuationGate.currentDependencyDeliveryPending(
              dependencyId,
              jobId,
              dispatchKey,
            )
          ) {
            continue;
          }
          if (
            !openingContinuationGate.prepareCurrentDependencyDispatch(
              dependencyId,
              jobId,
              dispatchKey,
            )
          ) {
            try {
              pi.appendEntry("coc-source-current-dependency-dispatch", {
                status: "identity_rejected",
                dependency_id: dependencyId,
                job_id: jobId,
                dispatch_key: dispatchKey,
              });
            } catch { /* exact dependency audit is best effort */ }
            continue;
          }
          const submission = await supplyCoordinator.autoDispatch(
            name,
            value,
            { exactTask: task },
          );
          if (!currentDependencySubmissionRetained(submission)) {
            const retained = objectOrNull(submission);
            const terminal = objectOrNull(retained?.terminal_receipt);
            const notification = objectOrNull(retained?.notification);
            if (
              retained?.status === "completed"
              && terminal?.status === "fulfilled"
              && notification?.hidden_continuation !== "failed"
            ) {
              openingContinuationGate.markCurrentDependencyTerminalDelivered(
                dispatchKey,
              );
            } else {
              openingContinuationGate.rollbackCurrentDependencySubmission(
                dependencyId,
                jobId,
                dispatchKey,
              );
            }
          }
        }
      }
      if (!scenePriorityHandled) {
        void supplyCoordinator.autoDispatch(
          name,
          value,
        ).catch(() => {});
      }
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
    name: "coc_invoke", label: "COC invoke (hidden compat)",
    description: "Hidden compatibility gateway. Live KP should use the closed domain tools.", parameters: invokeSchema,
    execute: gateway("coc_invoke"),
    ...compactToolRenderers("coc_invoke"),
  });
  for (const domainName of DOMAIN_TOOL_NAMES) {
    pi.registerTool({
      name: domainName,
      label: DOMAIN_TOOL_LABELS[domainName],
      description: DOMAIN_TOOL_DESCRIPTIONS[domainName],
      parameters: domainToolSchema(domainName),
      execute: gateway(domainName),
      ...compactToolRenderers(domainName),
    });
  }
  pi.registerTool({
    name: "coc_dispatch_source_work", label: "COC source dispatch",
    description: "Submit one exact repository-produced Pi source coordinator task.", parameters: dispatchSchema,
    ...compactToolRenderers("coc_dispatch_source_work"),
    async execute(_id: string, params: JsonObject, signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) {
      const startupResumeError = startupResumeToolError(
        "coc_dispatch_source_work",
        params,
      );
      if (startupResumeError !== null) throw new Error(startupResumeError);
      const epoch = sessionEpoch;
      if (!isCurrent(epoch)) return result(sessionClosed());
      exactKeys(params, ["task"], "dispatch request");
      return result(await supplyCoordinator.submitManual(params.task, signal));
    },
  });
  pi.registerTool({
    name: "coc_map_supply", label: "COC map supply",
    description: "Detect native-text image pages, validate externally rendered map assets, or privately inject one map image for the Keeper.", parameters: mapSupplySchema,
    ...compactToolRenderers("coc_map_supply"),
    async execute(_id: string, params: JsonObject, _signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) {
      const operation = String(params.operation ?? "");
      const needsOcr = Array.isArray(params.needs_ocr)
        ? params.needs_ocr.filter((value): value is number => Number.isInteger(value) && value >= 0)
        : [];
      if (operation === "detect") {
        if (typeof params.pages_dir !== "string" || !params.pages_dir.trim()) throw new Error("detect requires pages_dir");
        return result(await detectMapSupplyPageDirectory(params.pages_dir, needsOcr));
      }
      if (operation === "render") {
        if (
          typeof params.pages_dir !== "string" || !params.pages_dir.trim()
          || typeof params.asset_root_id !== "string" || !params.asset_root_id.trim()
          || typeof params.source_pdf_path !== "string" || !params.source_pdf_path.trim()
        ) throw new Error("render requires pages_dir, asset_root_id, and source_pdf_path");
        const selection = await detectMapSupplyPageDirectory(params.pages_dir, needsOcr);
        if (!selection.needs_image.length) return result({ ...selection, assets: [], status: "nothing_to_render" });
        return result({
          ...selection,
          status: "rendered",
          ...(await renderMapSupplyPages({
            workspace_root: ctx.cwd,
            asset_root_id: params.asset_root_id,
            source_pdf_path: params.source_pdf_path,
            pdf_indices: selection.needs_image,
          })),
        });
      }
      if (operation === "present") {
        if (typeof params.image_ref !== "string" || !params.image_ref.trim()) throw new Error("present requires image_ref");
        const message = await mapVisualMessage(ctx.cwd, params.image_ref, typeof params.caption === "string" ? params.caption : undefined);
        pi.sendMessage(message as never, { triggerTurn: false });
        return result({ status: "delivered", ...(message.details as JsonObject) });
      }
      throw new Error("unsupported coc_map_supply operation");
    },
  });
  pi.registerTool({
    name: "coc_progressive_ocr", label: "Progressive OCR",
    description: "Run configured external Progressive OCR status/fast/enhance/export.", parameters: ocrSchema,
    ...compactToolRenderers("coc_progressive_ocr"),
    async execute(_id: string, params: JsonObject, signal: AbortSignal | undefined) {
      const startupResumeError = startupResumeToolError(
        "coc_progressive_ocr",
        params,
      );
      if (startupResumeError !== null) throw new Error(startupResumeError);
      const openingSetupError = openingContinuationGate.openingSetupToolError(
        "coc_progressive_ocr",
        params,
        _id,
      );
      flushOpeningSetupAudits();
      if (openingSetupError !== null) throw new Error(openingSetupError);
      return result(await runOcr(params, signal));
    },
  });
  // Game table HUD replaces the coding-agent token/path footer in TUI sessions.
  registerCocHud(pi, (ctx) => client(ctx));
  // Per-turn step timing + token telemetry: JSONL evidence under the COC
  // agent home, a summary line after each settled turn, and /timing.
  // The real pi-coc wrapper always exports PI_CODING_AGENT_DIR; without it
  // (bare test harnesses embedding this extension) telemetry stays off so
  // probe turns never pollute the player's real evidence log.
  const telemetryAgentDir = (
    overrides.welcomeAgentDir
    ?? process.env.PI_CODING_AGENT_DIR
    ?? null
  );
  if (telemetryAgentDir !== null) {
    registerTurnTelemetry(pi, { agentDir: telemetryAgentDir });
  }
  const agentDir = (
    overrides.welcomeAgentDir
    ?? process.env.PI_CODING_AGENT_DIR
    ?? join(process.cwd(), ".pi", "coc-agent")
  );
  const startCocWelcome = registerCocWelcome(
    pi,
    (ctx) => client(ctx),
    agentDir,
  );
  registerPlayerTranscriptGate(
    pi,
    (visibleText) => {
      if (startupResumeGate !== null) {
        const gate = startupResumeGate;
        if (gate.phase === "terminal_failure") {
          publishStartupResumeBlocker(
            gate,
            gate.failureClass ?? "startup_resume_failed",
          );
        } else if (
          gate.phase === "pending"
          && gate.hiddenRepromptDelivery === "pending"
        ) {
          gate.hiddenRepromptDelivery = "sending";
          try {
            pi.sendMessage({
              customType: STARTUP_RESUME_CUSTOM_TYPE,
              content: startupResumeInstruction(
                gate.campaignId,
                gate.workspaceRoot,
              ),
              display: false,
              details: {
                schema_version: 1,
                campaign_id: gate.campaignId,
                first_campaign_operation: "session.resume",
              },
            }, { triggerTurn: true, deliverAs: "followUp" });
            gate.hiddenRepromptDelivery = "delivered";
          } catch {
            // Leave delivery unclaimed so one later transcript boundary can
            // retry; the campaign gate remains armed throughout.
            gate.hiddenRepromptDelivery = "pending";
          }
        }
        return false;
      }
      const decision = openingContinuationGate.acceptVisibleAssistantFinal(
        visibleText,
      );
      const deliveredBlocker = (
        openingContinuationGate.takeDeliveredOpeningSetupTerminalBlocker()
      );
      if (deliveredBlocker !== null) {
        try {
          pi.appendEntry(
            "coc-opening-setup-terminal-blocker",
            deliveredBlocker,
          );
        } catch { /* hidden structured blocker audit is best effort */ }
      }
      if (decision === false) {
        deliverMechanicalOutputGateInstruction(
          pi,
          openingContinuationGate.takeMechanicalOutputGateEnvelope(),
        );
      }
      if (
        decision === false
        || decision === true
        || (
          typeof decision === "object"
          && decision.triggerSetupContinuation === true
        )
      ) {
        const route = (
          openingContinuationGate.requiredOpeningSetupContinuation()
        );
        if (route !== null) {
          try {
            pi.sendMessage({
              customType: "coc-opening-setup-route",
              content: JSON.stringify(route),
              display: false,
              details: route,
            }, { triggerTurn: true, deliverAs: "followUp" });
          } catch {
            openingContinuationGate.releaseOpeningSetupContinuation(
              route,
              "route",
            );
          }
        }
      }
      return decision;
    },
    (message) => openingContinuationGate.observeMessageStart(message),
  );
  // Forced raw-PDF bind injection: the KP must not need to read coc-module-init
  // to know the first call after a player PDF path is scenario.bind_pdf.
  registerPlayerPdfBindInstruction(pi, {
    workspaceRoot: (ctx) => ctx.cwd,
    isCurrent,
    epoch: () => sessionEpoch,
    injectedPaths: injectedPlayerPdfPaths,
  });
  pi.on("agent_start", () => {
    openingContinuationGate.markAgentStart();
  });
  pi.on("agent_end", async () => {
    openingContinuationGate.markAgentEnd();
    // Resolving a pending terminal wake resumes its original publisher in the
    // preceding microtask. Let that send commit or mark an exact retry before
    // claiming retries at this post-tool lifecycle boundary.
    await Promise.resolve();
    const ownedContinuedDispatches = supplyCoordinator.terminalDedupe();
    for (
      const retry of openingContinuationGate
        .takeCurrentDependencyDeliveryRetries()
    ) {
      const terminalStatus = typeof retry.receipt.status === "string"
        ? retry.receipt.status.trim()
        : "";
      const continuationContext = (
        openingContinuationGate.coordinatorContinuationContext(
          retry.dispatchKey,
          terminalStatus,
        )
      );
      await publishCoordinatorTerminal(
        pi,
        retry.receipt,
        ownedContinuedDispatches,
        (dispatchKey) => openingContinuationGate.decideWake(dispatchKey),
        () => continuationContext,
        (dispatchKey) => (
          openingContinuationGate.rollbackCurrentDependencyDelivery(
            dispatchKey,
          )
        ),
        (dispatchKey) => (
          openingContinuationGate.markCurrentDependencyTerminalDelivered(
            dispatchKey,
          )
        ),
        false,
      );
    }
  });
  pi.on("session_start", async (event, ctx) => {
    sceneSupplyWaits.clear();
    const startupCampaignId = initializeSession(ctx);
    if (startupCampaignId !== null) {
      await refreshKeeperBriefing(ctx, startupCampaignId, "session_start");
    }
    await startCocWelcome(event, ctx, startupCampaignId);
  });
  pi.on("session_shutdown", async () => {
    sessionClosing = true;
    sessionEpoch += 1;
    startupResumeGate = null;
    sceneSupplyWaits.clear();
    openingContinuationGate.reset();
    await supplyCoordinator.shutdown();
    for (const controller of sourceProducerControllers.values()) {
      controller.abort("session_shutdown");
    }
    for (const controller of rawPdfBindBundleControllers.values()) {
      controller.abort("session_shutdown");
    }
    await Promise.allSettled([
      ...sourceProducerRuns,
      ...rawPdfBindBundleRuns,
      ...pendingStewardRefillRuns,
    ]);
    sourceProducerControllers.clear();
    sourceProducerRuns.clear();
    sourceProducerStates.clear();
    rawPdfBindBundleControllers.clear();
    rawPdfBindBundleRuns.clear();
    rawPdfBindBundleInflight.clear();
    rawPdfBindBundleInflightCampaigns.clear();
    rawPdfBindBundleWaitNotifiedCampaigns.clear();
    rawPdfBindBundleStates.clear();
    pendingStewardRefillStates.clear();
    pendingStewardRefillRuns.clear();
    injectedPlayerPdfPaths.clear();
    const ownedMcp = mcp;
    mcp = null;
    await ownedMcp?.close();
  });
}

export const __test = {
  explicitPiStartupCampaignId,
  piCoordinatorEnabled,
  runOcr,
  findAutoDispatchTask,
  findCurrentDependencyLifecycle,
  autoDispatchCoordinator,
  coordinatorDispatchNullReason,
  autoDispatchPiOpeningSourceReview,
  autoDispatchPiRawPdfBindBundle,
  findPiOpeningSourceReviewTrigger,
  autoDispatchPiPendingStewardDomains,
  runPiSourceScopeProducer,
  validatePiSourceScopeLocatorTask,
  MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN,
};
