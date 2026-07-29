import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  asObject,
  CanonicalToolError,
  CoordinatorDispatchManager,
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
import { compactToolRenderers } from "../lib/tool-render.ts";
import { registerCocHud } from "../lib/hud.ts";
import {
  registerCocWelcome,
  STARTUP_RESUME_CUSTOM_TYPE,
  startupResumeInstruction,
} from "../lib/welcome.ts";
import { isCanonicalCampaignId } from "../lib/campaign-id.mjs";

const emptySchema = { type: "object", properties: {}, additionalProperties: false } as const;
const OCR_TIMEOUT_MS = 15 * 60 * 1000;
const SOURCE_SCOPE_LOCATOR_TIMEOUT_MS = 5 * 60 * 1000;
const SOURCE_SCOPE_PUBLICATION_MARKER = ".coc-source-scope-publication.json";
const SOURCE_SCOPE_PUBLISH_LOCK_STALE_MS = 30_000;
const SOURCE_SCOPE_PUBLISH_LOCK_OWNER = "owner.json";
const SOURCE_SCOPE_PUBLISH_RECOVERY_GUARD_SUFFIX = ".recovery.guard";
const discoverSchema = { type: "object", properties: { operation: { type: "string" }, domain: { type: "string" } }, additionalProperties: false } as const;
const invokeSchema = {
  type: "object",
  properties: { operation: { type: "string", minLength: 1 }, root: { type: "string" }, campaign: { type: "string" }, arguments: { type: "object", additionalProperties: true } },
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
const SAFE_CHARACTER_SETUP_PROMPT = (
  "请继续确认调查员的职业、特征与技能；调查员正式加入战役后再开始场景。"
);
const CURRENT_DEPENDENCY_PROJECTION_BLOCKER_TEXT = (
  "当前来源依赖的精确任务超过安全传输上限，无法安全提交。"
  + "本回合已停止；请重试同一来源请求。"
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
  character_setup_policy?: "guided_quick_fire_no_source";
  startup_resume_policy?: "source_materialization_wait_only";
  instruction: string;
};
type OpeningSetupTerminalBlocker = {
  visibleText: string;
  details: JsonObject;
};
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
  attemptClass: "bind" | "route" | "character" | "probe";
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
  projectionBlocked: boolean;
  projectionBlockerDelivered: boolean;
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

  private characterSetupAllowedActions(
    campaignId: string,
    includeSourceBriefing = true,
  ): JsonObject[] {
    const actions: JsonObject[] = [
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
      },
      {
        operation: "setup.invoke",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        kind: "investigator.create",
        contract_source: "setup.investigator_contract.result.payload_schema",
        required_creation_input_mode: "guided_quick_fire",
      },
      {
        operation: "setup.invoke",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        kind: "campaign.link_investigator",
        required_payload_fields: ["campaign_id", "investigator_ids"],
        requires_current_opening_receipt: "investigator.create:guided_quick_fire",
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

  private canonicalSetupInvokeForOpening(
    params: JsonObject,
    route: OpeningSetupRoute,
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
      const keys = Object.keys(payload);
      const creation = objectOrNull(payload.creation);
      const quickFireMaterialization = (
        creation?.input_mode === "guided_quick_fire"
      );
      const luckReceipt = objectOrNull(creation?.luck_roll_receipt);
      const sheet = objectOrNull(payload.sheet);
      return (
        keys.every((key) => (
          ["campaign_id", "investigator_id", "sheet", "creation"].includes(key)
        ))
        && ["investigator_id", "sheet"].every((key) => keys.includes(key))
        && typeof payload.investigator_id === "string"
        && sheet !== null
        && creation !== null
        && (
          (
            quickFireMaterialization
            && creation?.method === "quick_fire_array"
            && Array.isArray(creation.characteristic_assignment_order)
            && creation.characteristic_assignment_order.length === 8
            && Number.isInteger(creation.luck_roll_total)
            && payload.campaign_id === route.campaign_id
            && luckReceipt !== null
            && exactKeysMatch(
              luckReceipt,
              ["campaign_id", "decision_id", "roll_id"],
            )
            && luckReceipt.campaign_id === route.campaign_id
            && typeof luckReceipt.decision_id === "string"
            && luckReceipt.decision_id.trim().length > 0
            && typeof luckReceipt.roll_id === "string"
            && luckReceipt.roll_id.trim().length > 0
          )
        )
      );
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
        && this.canonicalSetupInvokeForOpening(params, route)
      );
    }
    const setupArgs = objectOrNull(params.arguments);
    if (
      state.route.character_setup_policy === "guided_quick_fire_no_source"
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
        this.canonicalSetupInvokeForOpening(params, route)
        && this.linkMatchesCurrentGuidedCreates(params, state)
      );
    }
    if (operation === "setup.investigator_contract") {
      const args = objectOrNull(params.arguments);
      return args !== null
        && exactKeysMatch(args, ["campaign_id"])
        && args.campaign_id === route.campaign_id;
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
    return this.canonicalSetupInvokeForOpening(params, route)
      || (
        operation === "rules.roll_dice"
        && this.quickFireLuckInvocation(params)
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
  ): OpeningSetupRoute {
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
  ): OpeningSetupRoute {
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
    const envelope = objectOrNull(value);
    const data = objectOrNull(envelope?.data);
    const contract = objectOrNull(data?.result);
    const payloadSchema = objectOrNull(contract?.payload_schema);
    const branches = Array.isArray(payloadSchema?.oneOf)
      ? payloadSchema.oneOf
      : null;
    const defs = objectOrNull(payloadSchema?.$defs);
    if (branches === null || defs === null) {
      return JSON.stringify(value).includes("import_complete_sheet")
        ? {
            ok: false,
            tool: "setup.investigator_contract",
            error: { code: "guided_contract_projection_failed" },
          }
        : value;
    }
    const guidedBranch = branches.find((branch) => {
      const branchObject = objectOrNull(branch);
      const properties = objectOrNull(branchObject?.properties);
      const creation = objectOrNull(properties?.creation);
      return creation?.$ref === "#/$defs/quick_fire_creation";
    });
    if (guidedBranch === undefined) {
      return {
        ok: false,
        tool: "setup.investigator_contract",
        error: { code: "guided_contract_projection_failed" },
      };
    }
    const projected = structuredClone(envelope!);
    const projectedData = objectOrNull(projected.data)!;
    const projectedContract = objectOrNull(projectedData.result)!;
    const projectedSchema = objectOrNull(projectedContract.payload_schema)!;
    const projectedDefs = objectOrNull(projectedSchema.$defs)!;
    projectedSchema.oneOf = [structuredClone(guidedBranch)];
    delete projectedDefs.complete_sheet;
    delete projectedDefs.complete_sheet_creation;
    projectedSchema.title = (
      "COC7 guided Quick Fire investigator.create payload"
    );
    projectedSchema.description = (
      "Pi opening setup permits only the guided_quick_fire branch until "
      + "the exact current investigator create and campaign link succeed."
    );
    projectedContract.applicable_input_mode = "guided_quick_fire";
    if (JSON.stringify(projected).includes("import_complete_sheet")) {
      return {
        ok: false,
        tool: "setup.investigator_contract",
        error: { code: "guided_contract_projection_failed" },
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
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: gate.phase,
      campaign_id: gate.campaign_id,
      next_operation: nextOperation,
      instruction: typeof gate.instruction === "string"
        ? gate.instruction
        : "invoke the exact retained canonical setup route",
    };
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
    if (name !== "coc_invoke") return null;
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
        && route.phase === "opening_selection"
        && this.exactPrepareCard(route.next_operation)
      ) {
        const initialized = this.initializeOpeningSetupState(
          attempt.campaignId,
          route,
          "selection",
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
          reason: "bind_opening_selection",
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
    const canonicalCharacterSetupProbe = (
      attempt.attemptClass === "probe"
      && operation === "session.resume"
      && this.unboundAttemptIsFresh(attempt)
      && exactProjectedResumeError
      && returnedGate !== null
      && exactKeysMatch(returnedGate, [
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
      && returnedGate.schema_version === 1
      && returnedGate.status === "blocked"
      && returnedGate.hard_gate === true
      && returnedGate.activation_allowed === false
      && returnedGate.phase === "opening_character_setup_required"
      && returnedGate.campaign_id === attempt.campaignId
      && returnedGate.character_setup_policy === "guided_quick_fire"
      && returnedGate.next_operation === null
    );
    const canonicalMaterializationProbe = (
      attempt.attemptClass === "probe"
      && operation === "session.resume"
      && this.unboundAttemptIsFresh(attempt)
      && exactProjectedResumeError
      && returnedGate !== null
      && exactKeysMatch(returnedGate, [
        "schema_version",
        "status",
        "hard_gate",
        "activation_allowed",
        "phase",
        "campaign_id",
        "source_lifecycle_status",
        "next_operation",
        "instruction",
      ])
      && returnedGate.schema_version === 1
      && returnedGate.status === "blocked"
      && returnedGate.hard_gate === true
      && returnedGate.activation_allowed === false
      && returnedGate.phase === "opening_source_materialization"
      && returnedGate.campaign_id === attempt.campaignId
      && returnedGate.source_lifecycle_status === "pending"
      && returnedGate.next_operation === null
    );
    if (state === undefined && canonicalCharacterSetupProbe) {
      const route = this.recoveredCurrentCharacterSetupRoute(
        attempt.campaignId,
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
        transition: "canonical_character_setup_guided_gate_rehydrated",
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
        if (
          investigatorId
          && payload?.campaign_id === attempt.campaignId
          && creation?.input_mode === "guided_quick_fire"
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
            reason: "guided_quick_fire_create_current",
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
        if (state.phase === "ready") {
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
    projectionBlocked = false,
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
        projectionBlocked,
        projectionBlockerDelivered: (
          projectionBlocked
          && existing?.jobId === jobId
          && existing.projectionBlocked
        )
          ? existing.projectionBlockerDelivered
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

  armCurrentDependencySuppression(
    invocationId: string,
    campaignId: string,
  ): void {
    if (!invocationId || !campaignId) return;
    this.currentDependencySuppression = {
      epoch: this.playerTurnEpoch,
      campaignId,
      invocationId,
    };
    this.currentVisibleCampaignId = campaignId;
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
    const blocked = [...this.currentDependencyWaits.values()].filter(
      (wait) => wait.campaignId === campaignId && wait.projectionBlocked,
    );
    if (blocked.length > 0) {
      const exactRetry = (
        operation === "progressive.request_deepen"
        && blocked.some((wait) => {
          const declared = objectOrNull(args.current_dependency);
          return (
            declared !== null
            && this.exactDependencyRefMatches(
              wait,
              campaignId,
              declared.operation,
              declared,
              args.kind,
              args.target_id,
            )
          );
        })
      );
      if (exactRetry) return null;
      return (
        `${operation} is blocked because the exact current-dependency `
        + "projection exceeded the safe transport budget; retry only the "
        + "same structured progressive.request_deepen request"
      );
    }
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
        || (
          operation === "progressive.request_deepen"
          && objectOrNull(args.current_dependency) !== null
          && this.exactDependencyRefMatches(
            wait,
            campaignId,
            objectOrNull(args.current_dependency)?.operation,
            objectOrNull(args.current_dependency) ?? {},
            args.kind,
            args.target_id,
          )
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
      if (
        operation === "progressive.request_deepen"
        && args.kind === subjectKind
        && args.target_id === subjectId
        && objectOrNull(args.current_dependency) !== null
        && this.exactDependencyRefMatches(
          wait,
          campaignId,
          objectOrNull(args.current_dependency)?.operation,
          objectOrNull(args.current_dependency) ?? {},
          args.kind,
          args.target_id,
        )
      ) {
        const status = objectOrNull(data?.status);
        const merged = Array.isArray(data?.merged_location_ids)
          ? data.merged_location_ids
          : [];
        if (
          subjectKind === "location"
          && status?.deep_ready === true
          && merged.includes(subjectId)
        ) {
          wait.projectionConfirmed = true;
        }
      }
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
    if (
      this.currentVisibleCampaignId === null
      || ![...this.currentDependencyWaits.values()].some((wait) => (
        wait.campaignId === this.currentVisibleCampaignId
        && wait.projectionBlocked
      ))
    ) {
      this.currentVisibleCampaignId = null;
    }
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
    const projectionBlocker = this.currentVisibleCampaignId === null
      ? undefined
      : [...this.currentDependencyWaits.values()].find((wait) => (
        wait.campaignId === this.currentVisibleCampaignId
        && wait.projectionBlocked
      ));
    if (projectionBlocker !== undefined) {
      this.nonblockingContinuation = null;
      if (!projectionBlocker.projectionBlockerDelivered) {
        projectionBlocker.projectionBlockerDelivered = true;
        return {
          replacementText: CURRENT_DEPENDENCY_PROJECTION_BLOCKER_TEXT,
        };
      }
      return false;
    }
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
function absolute(value: unknown, label: string) {
  const path = nonEmpty(value, label);
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  return resolve(path);
}

async function piCoordinatorEnabled(): Promise<boolean> {
  const document = asObject(JSON.parse(await readFile(fileURLToPath(new URL("../../references/host-capabilities.json", import.meta.url)), "utf8")), "host capabilities");
  return asObject(document.pi, "Pi capabilities").coc_source_coordinator_v1 === true;
}

function locatorEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "USER",
    "LOGNAME", "SHELL", "CODEX_HOME", "COC_CODEX_COMMAND",
    "COC_CODEX_PDF_SKILL",
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
    "max_selected_pages", "source_bundle_manifest_contract",
    "resolve_operation", "result_delivery",
  ], "Pi source-scope locator task");
  if (
    task.schema_version !== 1
    || task.contract_id !== "coc.pi-source-scope-locator-task.v1"
    || task.adapter_mode !== "pi_external_pdf_skill_lifecycle"
    || task.model_policy !== "external_codex_cli_configured_default"
    || task.max_selected_pages !== 3
    || task.result_delivery !== "natural_completion_notification_only"
  ) throw new Error("Pi source-scope locator task contract drift");
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
  const resolveOperation = asObject(task.resolve_operation, "resolve operation");
  exactKeys(resolveOperation, [
    "operation", "invoke_via", "prefilled_arguments", "missing_arguments",
    "authority", "hard_gate",
  ], "resolve operation");
  const prefilled = asObject(
    resolveOperation.prefilled_arguments,
    "resolve prefilled arguments",
  );
  if (
    resolveOperation.operation !== "progressive.resolve_source_scope"
    || resolveOperation.invoke_via !== "coc_invoke"
    || prefilled.job_id !== task.job_id
    || prefilled.kind !== task.kind
    || prefilled.target_id !== task.target_id
  ) throw new Error("Pi source-scope locator resolve binding drift");
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
  if (code !== 0) throw new Error("source-scope locator producer failed");
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
    "repository_pdf_parser", "ocr",
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
    "target_id", "pdf_indices", "source_bundle_path", "failure_class",
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
    || indices.some((value) => !Number.isInteger(value) || (value as number) < 0)
    || JSON.stringify(indices) !== JSON.stringify(
      [...new Set(indices as number[])].sort((a, b) => a - b),
    )
  ) throw new Error("source-scope locator producer pdf_indices are invalid");
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceScopeTaskDigest(task: JsonObject): string {
  return sha256Json({
    schema_version: task.schema_version,
    contract_id: task.contract_id,
    contract_revision: task.contract_revision,
    workspace_root: task.workspace_root,
    campaign_id: task.campaign_id,
    asset_root_id: task.asset_root_id,
    job_id: task.job_id,
    job_kind: task.job_kind,
    kind: task.kind,
    target_id: task.target_id,
    source: task.source,
    source_bundle_path: task.source_bundle_path,
    max_selected_pages: task.max_selected_pages,
    resolve_operation: task.resolve_operation,
  });
}

async function validateStagedSourceBundle(
  task: JsonObject,
  receipt: JsonObject,
): Promise<string> {
  const root = resolve(nonEmpty(task.source_bundle_path, "source_bundle_path"));
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("staged source bundle root must be a real directory");
  }
  const canonicalRoot = await realpath(root);
  if (
    canonicalRoot
    !== join(await realpath(dirname(root)), basename(root))
  ) {
    throw new Error("staged source bundle root contains a symlink");
  }
  const manifestPath = join(root, "manifest.json");
  const manifestStat = await lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error("staged source bundle manifest must be a real file");
  }
  if (await realpath(manifestPath) !== join(canonicalRoot, "manifest.json")) {
    throw new Error("staged source bundle manifest contains a symlink");
  }
  const manifestBytes = await readFile(manifestPath);
  if (manifestBytes.length > MAX_BYTES) {
    throw new Error("staged source bundle manifest exceeds limit");
  }
  const manifest = asObject(
    JSON.parse(manifestBytes.toString("utf8")),
    "staged source bundle manifest",
  );
  const source = asObject(manifest.source, "staged source identity");
  const expectedSource = asObject(task.source, "locator source");
  const pages = manifest.pages;
  if (
    manifest.schema_version !== 1
    || manifest.producer !== "codex-pdf-skill"
    || source.source_id !== expectedSource.source_id
    || nonEmpty(source.title, "manifest.source.title")
      !== nonEmpty(expectedSource.title, "task.source.title")
    || resolve(String(source.path ?? "")) !== resolve(String(expectedSource.path))
    || source.file_sha256 !== expectedSource.file_sha256
    || !Number.isInteger(source.page_count)
    || Number(source.page_count) <= 0
    || !Array.isArray(pages)
    || pages.length < 1
    || pages.length > 3
  ) throw new Error("staged source bundle identity is invalid");
  const expectedIndices = receipt.pdf_indices as number[];
  const actualIndices: number[] = [];
  const pageDigests: JsonObject[] = [];
  for (const [position, rawPage] of pages.entries()) {
    const page = asObject(rawPage, `staged source page ${position}`);
    const pdfIndex = page.pdf_index;
    const markdownPath = String(page.markdown_path ?? "");
    if (
      !Number.isInteger(pdfIndex)
      || Number(pdfIndex) < 0
      || Number(pdfIndex) >= Number(source.page_count)
      || !markdownPath
      || isAbsolute(markdownPath)
      || page.review_state !== "manual_accepted"
      || typeof page.parse_confidence !== "number"
      || Number(page.parse_confidence) < 0
      || Number(page.parse_confidence) > 1
      || !Array.isArray(page.grep_anchors)
      || page.grep_anchors.some(
        (anchor) => typeof anchor !== "string" || !anchor.trim(),
      )
      || !/^[a-f0-9]{64}$/.test(String(page.text_sha256 ?? ""))
    ) throw new Error("staged source bundle page contract is invalid");
    const pagePath = resolve(root, markdownPath);
    if (!pagePath.startsWith(`${root}${sep}`)) {
      throw new Error("staged source bundle page escapes its root");
    }
    const pageStat = await lstat(pagePath);
    if (!pageStat.isFile() || pageStat.isSymbolicLink()) {
      throw new Error("staged source bundle page must be a real file");
    }
    if (
      await realpath(pagePath)
      !== resolve(canonicalRoot, markdownPath)
    ) {
      throw new Error("staged source bundle page contains a symlink");
    }
    const bytes = await readFile(pagePath);
    if (
      bytes.length > MAX_BYTES
      || createHash("sha256").update(bytes).digest("hex")
        !== page.text_sha256
    ) throw new Error("staged source bundle page content is invalid");
    actualIndices.push(Number(pdfIndex));
    pageDigests.push({
      pdf_index: Number(pdfIndex),
      markdown_path: markdownPath,
      text_sha256: page.text_sha256,
    });
  }
  if (
    JSON.stringify([...actualIndices].sort((a, b) => a - b))
    !== JSON.stringify(expectedIndices)
  ) throw new Error("staged source bundle pages diverge from producer receipt");
  return sha256Json({
    manifest_sha256: createHash("sha256").update(manifestBytes).digest("hex"),
    pages: pageDigests.sort(
      (left, right) => Number(left.pdf_index) - Number(right.pdf_index),
    ),
  });
}

async function writeSourceScopePublicationMarker(
  stableTask: JsonObject,
  stagedTask: JsonObject,
  receipt: JsonObject,
  bundleDigest: string,
): Promise<void> {
  const source = asObject(stableTask.source, "locator source");
  const core = {
    schema_version: 1,
    contract_id: "coc.pi-source-scope-publication.v1",
    state: "published_unregistered",
    task_digest: sourceScopeTaskDigest(stableTask),
    bundle_digest: bundleDigest,
    job_id: stableTask.job_id,
    kind: stableTask.kind,
    target_id: stableTask.target_id,
    pdf_indices: structuredClone(receipt.pdf_indices),
    source_id: source.source_id,
    file_sha256: source.file_sha256,
    stable_path: stableTask.source_bundle_path,
  };
  const marker = {
    ...core,
    marker_sha256: sha256Json(core),
  };
  await writeFile(
    join(
      nonEmpty(stagedTask.source_bundle_path, "staging source_bundle_path"),
      SOURCE_SCOPE_PUBLICATION_MARKER,
    ),
    `${JSON.stringify(marker)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

async function recoverPublishedSourceBundle(
  task: JsonObject,
): Promise<JsonObject> {
  const stablePath = resolve(
    nonEmpty(task.source_bundle_path, "stable source_bundle_path"),
  );
  const markerPath = join(stablePath, SOURCE_SCOPE_PUBLICATION_MARKER);
  const markerStat = await lstat(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new Error("stable source bundle publication marker is invalid");
  }
  const markerBytes = await readFile(markerPath);
  if (markerBytes.length > MAX_BYTES) {
    throw new Error("stable source bundle publication marker exceeds limit");
  }
  const marker = asObject(
    JSON.parse(markerBytes.toString("utf8")),
    "stable source bundle publication marker",
  );
  exactKeys(marker, [
    "schema_version", "contract_id", "state", "task_digest",
    "bundle_digest", "job_id", "kind", "target_id", "pdf_indices",
    "source_id", "file_sha256", "stable_path", "marker_sha256",
  ], "stable source bundle publication marker");
  const {
    marker_sha256: markerSha256,
    ...core
  } = marker;
  const source = asObject(task.source, "locator source");
  if (
    marker.schema_version !== 1
    || marker.contract_id !== "coc.pi-source-scope-publication.v1"
    || marker.state !== "published_unregistered"
    || marker.task_digest !== sourceScopeTaskDigest(task)
    || marker.job_id !== task.job_id
    || marker.kind !== task.kind
    || marker.target_id !== task.target_id
    || marker.source_id !== source.source_id
    || marker.file_sha256 !== source.file_sha256
    || marker.stable_path !== task.source_bundle_path
    || !/^[a-f0-9]{64}$/.test(String(marker.bundle_digest ?? ""))
    || markerSha256 !== sha256Json(core)
  ) throw new Error("stable source bundle publication marker binding drift");
  const receipt = {
    schema_version: 1,
    contract_id: "coc.pi-source-scope-locator-producer-result.v1",
    job_id: task.job_id,
    status: "located",
    kind: task.kind,
    target_id: task.target_id,
    pdf_indices: structuredClone(marker.pdf_indices),
    source_bundle_path: task.source_bundle_path,
    failure_class: null,
  };
  const validatedReceipt = await runPiSourceScopeProducerReceiptOnly(
    task,
    receipt,
  );
  const bundleDigest = await validateStagedSourceBundle(
    task,
    validatedReceipt,
  );
  if (bundleDigest !== marker.bundle_digest) {
    throw new Error("stable source bundle content drift");
  }
  return validatedReceipt;
}

async function runPiSourceScopeProducerReceiptOnly(
  taskValue: unknown,
  receiptValue: unknown,
): Promise<JsonObject> {
  const task = validatePiSourceScopeLocatorTask(taskValue);
  const receipt = asObject(receiptValue, "source-scope locator receipt");
  exactKeys(receipt, [
    "schema_version", "contract_id", "job_id", "status", "kind",
    "target_id", "pdf_indices", "source_bundle_path", "failure_class",
  ], "source-scope locator producer receipt");
  const status = String(receipt.status ?? "");
  if (
    receipt.schema_version !== 1
    || receipt.contract_id
      !== "coc.pi-source-scope-locator-producer-result.v1"
    || receipt.job_id !== task.job_id
    || receipt.kind !== task.kind
    || receipt.target_id !== task.target_id
    || status !== "located"
    || !Array.isArray(receipt.pdf_indices)
    || receipt.pdf_indices.length < 1
    || receipt.pdf_indices.length > 3
    || receipt.pdf_indices.some(
      (value) => !Number.isInteger(value) || Number(value) < 0,
    )
    || JSON.stringify(receipt.pdf_indices) !== JSON.stringify(
      [...new Set(receipt.pdf_indices as number[])].sort((a, b) => a - b),
    )
    || receipt.source_bundle_path !== task.source_bundle_path
    || receipt.failure_class !== null
  ) throw new Error("source-scope locator recovery receipt binding drift");
  return receipt;
}

function processOwnerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function createPublishLock(
  lockPath: string,
  taskDigest: string,
): Promise<{ owner: JsonObject }> {
  await mkdir(lockPath, { mode: 0o700 });
  const owner = {
    schema_version: 1,
    contract_id: "coc.pi-source-scope-publish-lock.v1",
    pid: process.pid,
    owner_nonce: randomUUID(),
    created_at_ms: Date.now(),
    task_digest: taskDigest,
  };
  const handle = await open(
    join(lockPath, SOURCE_SCOPE_PUBLISH_LOCK_OWNER),
    "wx",
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { owner };
}

type PublishLockInspection = {
  stale: boolean;
  dev: number;
  ino: number;
};

async function inspectPublishLock(
  lockPath: string,
): Promise<PublishLockInspection> {
  const stat = await lstat(lockPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("source-scope publish lock is invalid");
  }
  const directoryAgeMs = Date.now() - stat.mtimeMs;
  const ownerPath = join(lockPath, SOURCE_SCOPE_PUBLISH_LOCK_OWNER);
  let ownerBytes: string;
  try {
    const ownerStat = await lstat(ownerPath);
    if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) {
      throw new Error("source-scope publish lock owner is invalid");
    }
    ownerBytes = await readFile(ownerPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      stale: directoryAgeMs >= SOURCE_SCOPE_PUBLISH_LOCK_STALE_MS,
      dev: stat.dev,
      ino: stat.ino,
    };
  }
  let existing: JsonObject;
  try {
    existing = asObject(
      JSON.parse(ownerBytes.trim()),
      "source-scope publish lock",
    );
  } catch {
    // A process can crash while writing the owner record. With no readable
    // PID, the directory mtime is the only safe bounded recovery signal.
    return {
      stale: directoryAgeMs >= SOURCE_SCOPE_PUBLISH_LOCK_STALE_MS,
      dev: stat.dev,
      ino: stat.ino,
    };
  }
  try {
    exactKeys(existing, [
      "schema_version", "contract_id", "pid", "owner_nonce",
      "created_at_ms", "task_digest",
    ], "source-scope publish lock");
  } catch {
    const partialPid = Number(existing.pid);
    return {
      stale: !(
        Number.isInteger(partialPid)
        && partialPid > 0
        && processOwnerAlive(partialPid)
      ) && directoryAgeMs >= SOURCE_SCOPE_PUBLISH_LOCK_STALE_MS,
      dev: stat.dev,
      ino: stat.ino,
    };
  }
  const pid = Number(existing.pid);
  const ageMs = Date.now() - Number(existing.created_at_ms);
  if (
    existing.schema_version !== 1
    || existing.contract_id !== "coc.pi-source-scope-publish-lock.v1"
    || !Number.isInteger(pid)
    || pid <= 0
    || !/^[0-9a-f-]{36}$/.test(String(existing.owner_nonce ?? ""))
    || !Number.isFinite(ageMs)
    || !/^[a-f0-9]{64}$/.test(String(existing.task_digest ?? ""))
  ) {
    return {
      stale: !(
        Number.isInteger(pid)
        && pid > 0
        && processOwnerAlive(pid)
      ) && directoryAgeMs >= SOURCE_SCOPE_PUBLISH_LOCK_STALE_MS,
      dev: stat.dev,
      ino: stat.ino,
    };
  }
  return {
    stale: !processOwnerAlive(pid)
      && ageMs >= SOURCE_SCOPE_PUBLISH_LOCK_STALE_MS,
    dev: stat.dev,
    ino: stat.ino,
  };
}

function recoveryGuardOwnerName(owner: JsonObject): string {
  return [
    "owner-v1",
    owner.pid,
    owner.created_at_ms,
    owner.owner_nonce,
    owner.task_digest,
  ].join("__");
}

function parseRecoveryGuardOwnerName(value: string): JsonObject | null {
  const parts = value.split("__");
  if (
    parts.length !== 5
    || parts[0] !== "owner-v1"
    || !/^[0-9]+$/.test(parts[1] ?? "")
    || !/^[0-9]+$/.test(parts[2] ?? "")
    || !/^[0-9a-f-]{36}$/.test(parts[3] ?? "")
    || !/^[a-f0-9]{64}$/.test(parts[4] ?? "")
  ) return null;
  return {
    pid: Number(parts[1]),
    created_at_ms: Number(parts[2]),
    owner_nonce: parts[3],
    task_digest: parts[4],
  };
}

async function createPublishRecoveryGuard(
  guardPath: string,
  taskDigest: string,
): Promise<{ owner: JsonObject; ownerPath: string }> {
  await mkdir(guardPath, { mode: 0o700 });
  const owner = {
    pid: process.pid,
    created_at_ms: Date.now(),
    owner_nonce: randomUUID(),
    task_digest: taskDigest,
  };
  const ownerPath = join(guardPath, recoveryGuardOwnerName(owner));
  await mkdir(ownerPath, { mode: 0o700 });
  return { owner, ownerPath };
}

async function acquirePublishRecoveryGuard(
  guardPath: string,
  taskDigest: string,
): Promise<{ owner: JsonObject; ownerPath: string }> {
  try {
    return await createPublishRecoveryGuard(guardPath, taskDigest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = await lstat(guardPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("source-scope publish recovery guard is invalid");
  }
  const entries = await readdir(guardPath, { withFileTypes: true });
  if (entries.length === 0) {
    if (Date.now() - stat.mtimeMs < SOURCE_SCOPE_PUBLISH_LOCK_STALE_MS) {
      throw new Error("source-scope publish recovery guard is active");
    }
    try {
      await rmdir(guardPath);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY"].includes(
        String((error as NodeJS.ErrnoException).code ?? ""),
      )) throw error;
    }
    try {
      return await createPublishRecoveryGuard(guardPath, taskDigest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("source-scope publish recovery guard is active");
      }
      throw error;
    }
  }
  if (
    entries.length !== 1
    || !entries[0].isDirectory()
    || entries[0].isSymbolicLink()
  ) throw new Error("source-scope publish recovery guard metadata is invalid");
  const priorOwner = parseRecoveryGuardOwnerName(entries[0].name);
  if (priorOwner === null) {
    throw new Error("source-scope publish recovery guard metadata is invalid");
  }
  const pid = Number(priorOwner.pid);
  const ageMs = Date.now() - Number(priorOwner.created_at_ms);
  if (
    !Number.isInteger(pid)
    || pid <= 0
    || !Number.isFinite(ageMs)
    || processOwnerAlive(pid)
    || ageMs < SOURCE_SCOPE_PUBLISH_LOCK_STALE_MS
  ) throw new Error("source-scope publish recovery guard is active");
  const priorOwnerPath = join(guardPath, entries[0].name);
  try {
    await rmdir(priorOwnerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("source-scope publish recovery guard changed");
    }
    throw error;
  }
  try {
    await rmdir(guardPath);
  } catch (error) {
    if (["ENOENT", "ENOTEMPTY"].includes(
      String((error as NodeJS.ErrnoException).code ?? ""),
    )) throw new Error("source-scope publish recovery guard changed");
    throw error;
  }
  try {
    return await createPublishRecoveryGuard(guardPath, taskDigest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("source-scope publish recovery guard is active");
    }
    throw error;
  }
}

async function releasePublishRecoveryGuard(
  guardPath: string,
  guard: { owner: JsonObject; ownerPath: string },
): Promise<void> {
  try {
    if (basename(guard.ownerPath) !== recoveryGuardOwnerName(guard.owner)) {
      return;
    }
    await rmdir(guard.ownerPath);
    await rmdir(guardPath);
  } catch {
    // Never remove a guard whose current owner cannot be proven.
  }
}

async function acquirePublishLock(
  lockPath: string,
  stablePath: string,
  taskDigest: string,
): Promise<{ owner: JsonObject }> {
  try {
    return await createPublishLock(lockPath, taskDigest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (await pathExists(stablePath)) {
    throw new Error("publish lock recovery found an existing stable bundle");
  }
  const guardPath = `${lockPath}${SOURCE_SCOPE_PUBLISH_RECOVERY_GUARD_SUFFIX}`;
  const guard = await acquirePublishRecoveryGuard(guardPath, taskDigest);
  try {
    if (await pathExists(stablePath)) {
      throw new Error("publish lock recovery found an existing stable bundle");
    }
    const inspected = await inspectPublishLock(lockPath);
    if (!inspected.stale) {
      throw new Error("source-scope publish lock is active");
    }
    const current = await inspectPublishLock(lockPath);
    if (
      !current.stale
      || current.dev !== inspected.dev
      || current.ino !== inspected.ino
    ) throw new Error("source-scope publish lock changed during recovery");
    await rm(lockPath, { recursive: true });
    try {
      return await createPublishLock(lockPath, taskDigest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("source-scope stale publish lock takeover lost");
      }
      throw error;
    }
  } finally {
    await releasePublishRecoveryGuard(guardPath, guard);
  }
}

async function releasePublishLock(
  lockPath: string,
  lock: { owner: JsonObject },
): Promise<void> {
  try {
    const ownerPath = join(lockPath, SOURCE_SCOPE_PUBLISH_LOCK_OWNER);
    const ownerStat = await lstat(ownerPath);
    if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) return;
    const current = asObject(
      JSON.parse((await readFile(ownerPath, "utf8")).trim()),
      "source-scope publish lock",
    );
    if (current.owner_nonce === lock.owner.owner_nonce) {
      await rm(lockPath, { recursive: true });
    }
  } catch {
    // Never remove a lock whose current owner cannot be proven.
  }
}

async function publishStagedSourceBundle(
  stableTask: JsonObject,
  stagedTask: JsonObject,
  receipt: JsonObject,
): Promise<JsonObject> {
  const bundleDigest = await validateStagedSourceBundle(stagedTask, receipt);
  await writeSourceScopePublicationMarker(
    stableTask,
    stagedTask,
    receipt,
    bundleDigest,
  );
  const stablePath = resolve(
    nonEmpty(stableTask.source_bundle_path, "stable source_bundle_path"),
  );
  const stagingPath = resolve(
    nonEmpty(stagedTask.source_bundle_path, "staging source_bundle_path"),
  );
  const stableParent = dirname(stablePath);
  await mkdir(stableParent, { recursive: true });
  if (
    await realpath(stableParent)
    !== join(await realpath(dirname(stableParent)), basename(stableParent))
  ) {
    throw new Error("stable source bundle parent contains a symlink");
  }
  const lockPath = `${stablePath}.publish.lock`;
  const lock = await acquirePublishLock(
    lockPath,
    stablePath,
    sourceScopeTaskDigest(stableTask),
  );
  try {
    if (await pathExists(stablePath)) {
      throw new Error("stable source bundle already exists");
    }
    await rename(stagingPath, stablePath);
  } finally {
    await releasePublishLock(lockPath, lock);
  }
  return {
    ...receipt,
    source_bundle_path: stablePath,
  };
}

function objectOrNull(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function findAutoDispatchTakeover(value: unknown): JsonObject | null {
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
  return present[0].takeover;
}

function findAutoDispatchTask(value: unknown): JsonObject | null {
  const takeover = findAutoDispatchTakeover(value);
  const action = objectOrNull(takeover?.next_host_action);
  const task = objectOrNull(action?.task);
  return action?.action === "invoke_coc_dispatch_source_work"
    && task?.contract_id === "coc.pi-source-coordinator-task.v1"
    ? task
    : null;
}

export function findPiSourceScopeLocatorTask(value: unknown): JsonObject | null {
  const envelope = objectOrNull(value);
  if (envelope?.ok !== true) return null;
  const data = objectOrNull(envelope.data);
  const progressive = objectOrNull(data?.progressive);
  const sceneContext = objectOrNull(data?.scene_context);
  const resumeProgressive = objectOrNull(sceneContext?.progressive);
  const candidates = [
    objectOrNull(data?.source_scope_takeover),
    objectOrNull(progressive?.source_scope_takeover),
    objectOrNull(resumeProgressive?.source_scope_takeover),
  ].filter((candidate): candidate is JsonObject => candidate !== null);
  const unique = new Map<string, JsonObject>();
  for (const candidate of candidates) {
    const action = objectOrNull(candidate.next_host_action);
    const dispatchKey = typeof action?.dispatch_key === "string"
      ? action.dispatch_key.trim()
      : "";
    const task = objectOrNull(action?.task);
    const key = dispatchKey || (
      typeof task?.job_id === "string" ? `job:${task.job_id}` : ""
    );
    if (!key) return null;
    const previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candidate)) {
      return null;
    }
    unique.set(key, candidate);
  }
  if (unique.size !== 1) return null;
  const action = objectOrNull([...unique.values()][0].next_host_action);
  const task = objectOrNull(action?.task);
  return (
    action?.action === "invoke_coc_dispatch_source_scope_locator"
    && task?.contract_id === "coc.pi-source-scope-locator-task.v1"
  ) ? task : null;
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

function currentDependencyInvocationConsumes(
  params: JsonObject,
  lifecycle: {
    campaignId: string;
    waits: JsonObject[];
  },
): boolean {
  const campaignId = typeof params.campaign === "string"
    ? params.campaign.trim()
    : "";
  const operation = typeof params.operation === "string"
    ? params.operation.trim()
    : "";
  if (!campaignId || campaignId !== lifecycle.campaignId || !operation) {
    return false;
  }
  const args = objectOrNull(params.arguments) ?? {};
  const declared = objectOrNull(args.current_dependency);
  if (operation === "progressive.request_deepen" && declared !== null) {
    return lifecycle.waits.some((wait) => {
      const dependencyRef = objectOrNull(wait.dependency_ref);
      const subject = objectOrNull(dependencyRef?.subject);
      return (
        dependencyRef?.operation === declared.operation
        && subject?.kind === args.kind
        && subject?.id === args.target_id
        && ["settlement_id", "decision_id", "source_scope_signature"].some(
          (field) => (
            typeof declared[field] === "string"
            && declared[field] === dependencyRef?.[field]
          ),
        )
      );
    });
  }
  return false;
}

function currentDependencySubmissionRetained(value: unknown): boolean {
  const result = objectOrNull(value);
  return [
    "activating", "pending", "retrying", "submitted",
  ].includes(String(result?.status ?? ""));
}

function currentDependencyProjectionBlocked(value: unknown): boolean {
  const envelope = objectOrNull(value);
  const data = objectOrNull(envelope?.data);
  const blocker = objectOrNull(data?.current_dependency_projection_blocker);
  return (
    envelope?.ok === true
    && data?.current_dependency === true
    && blocker?.status === "blocked"
    && blocker.contract_id
      === "coc.source-current-dependency-projection-blocker.v1"
  );
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
  submissionOwner?: () => boolean;
  onSubmissionOwnershipLost?: () => void;
  exactTask?: JsonObject;
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
  }
  catch {
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
  // No await may occur between this final exact-attempt ownership check and
  // manager.submit. In the JS event loop this makes validation + submission
  // one synchronous owner action; later terminal awaits are projection-gated.
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

interface SourceScopeAutoDispatchDeps {
  isCurrent(): boolean;
  command(): string | undefined;
  call(name: string, args: JsonObject, signal?: AbortSignal): Promise<JsonObject>;
  onResolved(value: JsonObject): Promise<void>;
  states: Map<string, JsonObject>;
  controllers: Map<string, AbortController>;
  audit(entry: JsonObject): void;
}

export async function autoDispatchPiSourceScopeLocator(
  deps: SourceScopeAutoDispatchDeps,
  toolName: string,
  value: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<JsonObject | null> {
  if (toolName !== "coc_invoke") return null;
  const rawTask = findPiSourceScopeLocatorTask(value);
  if (rawTask === null) return null;
  let task: JsonObject;
  try { task = validatePiSourceScopeLocatorTask(rawTask); }
  catch {
    const failure = {
      status: "validation_failed",
      failure_class: "source_scope_locator_task_invalid",
    };
    deps.audit(failure);
    return failure;
  }
  const key = `source-scope-locator:${nonEmpty(task.job_id, "job_id")}`;
  const previous = deps.states.get(key);
  if (previous) return previous;
  const submitted = { status: "submitted", dispatch_key: key };
  deps.states.set(key, submitted);
  deps.audit(submitted);
  if (!deps.isCurrent()) {
    const failure = {
      status: "session_closed",
      dispatch_key: key,
      failure_class: "session_closed",
    };
    deps.states.set(key, failure);
    deps.audit(failure);
    return failure;
  }
  const command = deps.command();
  if (!command || !isAbsolute(command)) {
    const failure = {
      status: "capability_unavailable",
      dispatch_key: key,
      failure_class: "source_scope_locator_command_unavailable",
    };
    deps.states.set(key, failure);
    deps.audit(failure);
    return failure;
  }
  const stablePath = resolve(
    nonEmpty(task.source_bundle_path, "source_bundle_path"),
  );
  let recoveredReceipt: JsonObject | null = null;
  if (await pathExists(stablePath)) {
    try {
      recoveredReceipt = await recoverPublishedSourceBundle(task);
    } catch {
      const failure = {
        status: "failed",
        dispatch_key: key,
        failure_class: "source_scope_stable_bundle_mismatch",
      };
      deps.states.set(key, failure);
      deps.audit(failure);
      return failure;
    }
  }
  const stagingPath = join(
    dirname(stablePath),
    `.locator-staging-${randomUUID()}`,
  );
  await mkdir(dirname(stagingPath), { recursive: true });
  const stagedTask = {
    ...task,
    source_bundle_path: stagingPath,
  };
  const controller = new AbortController();
  deps.controllers.set(key, controller);
  const abort = () => controller.abort(
    options.signal?.reason ?? "source_scope_locator_interrupted",
  );
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  try {
    let receipt: JsonObject;
    if (recoveredReceipt !== null) {
      receipt = recoveredReceipt;
    } else {
      try {
        receipt = await runPiSourceScopeProducer(stagedTask, {
          command,
          timeoutMs: options.timeoutMs,
          signal: controller.signal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const failure = {
          status: "failed",
          dispatch_key: key,
          failure_class: message.includes("timed out")
            ? "source_scope_locator_timeout"
            : message.includes("aborted")
              ? "source_scope_locator_aborted"
              : message.includes("capability")
                ? "source_scope_locator_preflight_failed"
                : "source_scope_locator_result_invalid",
        };
        deps.states.set(key, failure);
        deps.audit(failure);
        return failure;
      }
      if (!deps.isCurrent()) {
        const failure = {
          status: "session_closed",
          dispatch_key: key,
          failure_class: "session_closed_before_scope_registration",
        };
        deps.states.set(key, failure);
        deps.audit(failure);
        return failure;
      }
      if (receipt.status !== "located") {
        const terminal = {
          status: receipt.status,
          dispatch_key: key,
          failure_class: receipt.failure_class,
        };
        deps.states.set(key, terminal);
        deps.audit(terminal);
        return terminal;
      }
      try {
        receipt = await publishStagedSourceBundle(task, stagedTask, receipt);
      } catch {
        const failure = {
          status: "failed",
          dispatch_key: key,
          failure_class: "source_scope_bundle_publication_failed",
        };
        deps.states.set(key, failure);
        deps.audit(failure);
        return failure;
      }
    }
    if (!deps.isCurrent()) {
      const failure = {
        status: "session_closed",
        dispatch_key: key,
        failure_class: "session_closed_before_scope_registration",
      };
      deps.states.set(key, failure);
      deps.audit(failure);
      return failure;
    }
    const resolveOperation = asObject(
      task.resolve_operation,
      "resolve operation",
    );
    const prefilled = asObject(
      resolveOperation.prefilled_arguments,
      "resolve prefilled arguments",
    );
    let resolved: JsonObject;
    try {
      resolved = await deps.call("coc_invoke", {
        operation: "progressive.resolve_source_scope",
        root: task.workspace_root,
        campaign: task.campaign_id,
        arguments: {
          ...structuredClone(prefilled),
          pdf_indices: structuredClone(receipt.pdf_indices),
          source_bundle_path: receipt.source_bundle_path,
        },
      }, controller.signal);
      if (resolved.ok !== true) {
        throw new Error("canonical scope resolution rejected");
      }
    } catch {
      const failure = {
        status: "failed",
        dispatch_key: key,
        failure_class: "source_scope_registration_failed",
      };
      deps.states.set(key, failure);
      deps.audit(failure);
      return failure;
    }
    try {
      if (deps.isCurrent()) await deps.onResolved(resolved);
    } catch {
      const failure = {
        status: "scope_registered",
        dispatch_key: key,
        job_id: task.job_id,
        pdf_indices: structuredClone(receipt.pdf_indices),
        failure_class: "source_scope_continuation_failed",
      };
      deps.states.set(key, failure);
      deps.audit(failure);
      return failure;
    }
    const terminal = {
      status: "scope_registered",
      dispatch_key: key,
      job_id: task.job_id,
      pdf_indices: structuredClone(receipt.pdf_indices),
    };
    deps.states.set(key, terminal);
    deps.audit(terminal);
    return terminal;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    if (deps.controllers.get(key) === controller) {
      deps.controllers.delete(key);
    }
    if (await pathExists(stagingPath)) {
      await rm(stagingPath, { recursive: true, force: true });
    }
  }
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
  let manager: CoordinatorDispatchManager | null = null;
  let sessionEpoch = 0;
  let sessionClosing = true;
  let continuedCoordinatorDispatches = new Set<string>();
  let sourceScopeLocatorStates = new Map<string, JsonObject>();
  let sourceScopeLocatorControllers = new Map<string, AbortController>();
  let sourceScopeLocatorRuns = new Set<Promise<unknown>>();
  let startupResumeGate: StartupResumeGate | null = null;
  const openingContinuationGate = new OpeningTerminalContinuationGate();
  const kpActiveTools = [
    "coc_capabilities",
    "coc_discover",
    "coc_invoke",
    "coc_progressive_ocr",
  ];
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
        ownedContinuedDispatches,
        (dispatchKey) => openingContinuationGate.decideWake(dispatchKey),
        () => continuationContext,
        (dispatchKey) => {
          openingContinuationGate.releaseOpeningTerminalContinuation(
            dispatchKey,
          );
          openingContinuationGate.rollbackCurrentDependencyDelivery(
            dispatchKey,
          );
        },
        (dispatchKey) => (
          openingContinuationGate.markCurrentDependencyTerminalDelivered(
            dispatchKey,
          )
        ),
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
  const dispatchResolvedSourceWork = async (
    resolved: JsonObject,
    ctx: ExtensionContext,
    epoch: number,
  ) => {
    const lifecycle = findCurrentDependencyLifecycle(resolved);
    if (lifecycle !== null) {
      openingContinuationGate.observeCurrentDependencySnapshot(
        lifecycle.campaignId,
        lifecycle.waits,
        lifecycle.snapshotScope,
        currentDependencyProjectionBlocked(resolved),
      );
      for (const dispatch of lifecycle.dispatches) {
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
          || !openingContinuationGate.prepareCurrentDependencyDispatch(
            dependencyId,
            jobId,
            dispatchKey,
          )
        ) continue;
        const submission = await autoDispatchCoordinator(
          autoDispatchDeps(ctx, epoch),
          "coc_invoke",
          resolved,
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
    await autoDispatchCoordinator(
      autoDispatchDeps(ctx, epoch),
      "coc_invoke",
      resolved,
    );
  };
  const sourceScopeDispatchDeps = (
    ctx: ExtensionContext,
    epoch: number,
  ): SourceScopeAutoDispatchDeps => ({
    isCurrent: () => isCurrent(epoch),
    command: () => process.env.COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND,
    call: (name, args, signal) => client(ctx).callTool(name, args, signal),
    onResolved: (resolved) => dispatchResolvedSourceWork(resolved, ctx, epoch),
    states: sourceScopeLocatorStates,
    controllers: sourceScopeLocatorControllers,
    audit: (entry) => {
      try { pi.appendEntry("coc-source-scope-locator-lifecycle", entry); }
      catch { /* audit is best effort */ }
    },
  });
  const flushOpeningSetupAudits = () => {
    for (const audit of openingContinuationGate.takeOpeningSetupAudits()) {
      try { pi.appendEntry("coc-opening-setup-route-audit", audit); }
      catch { /* opening setup audit is best effort */ }
    }
  };
  const initializeSession = (ctx: ExtensionContext): string | null => {
    sessionEpoch += 1;
    sessionClosing = false;
    openingContinuationGate.reset();
    continuedCoordinatorDispatches = new Set<string>();
    sourceScopeLocatorStates = new Map<string, JsonObject>();
    sourceScopeLocatorControllers = new Map<string, AbortController>();
    sourceScopeLocatorRuns = new Set<Promise<unknown>>();
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
    // The host owns exact nested coordinator-task dispatch. Keep the
    // fail-closed tool registered for the private manager boundary and probes,
    // but never expose it to the KP model.
    pi.setActiveTools(kpActiveTools);
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
      && name === "coc_invoke"
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
        === "prebound_opening_character_setup"
      || openingObservation.reason
        === "prebound_opening_source_materialization"
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
      || details.source_lifecycle_status !== "pending"
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
        projectStartupOpeningSelection(envelopeDetails, params.campaign)
        ?? projectStartupCharacterSetup(envelopeDetails, params.campaign)
        ?? projectStartupSourceMaterialization(
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
  const gateway = (name: string) => async (_id: string, params: JsonObject, signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) => {
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
    if (name === "coc_invoke" && PRIVATE_LEASE_OPERATIONS.has(String(params.operation))) {
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
    if (name === "coc_invoke") {
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
    let value: unknown;
    try {
      value = await client(ctx).callTool(name, params, signal);
    } catch (error) {
      const canonicalFailure = startupResumeAttempt
        ? startupCanonicalFailureProjection(error, name, params)
        : { kind: "not_canonical" as const };
      if (canonicalFailure.kind === "projected") {
        value = canonicalFailure.envelope;
      } else {
        if (startupResumeAttempt) {
          terminalizeStartupResume(
            canonicalFailure.kind === "invalid"
              ? "startup_resume_result_invalid"
              : "startup_resume_transport_failed",
          );
        }
        if (name === "coc_invoke") {
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
          return result({
            ok: false,
            tool: "session.resume",
            error: { code: "startup_resume_result_invalid" },
          });
        }
        throw error;
      }
    }
    if (name === "coc_invoke") {
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
          openingContinuationGate.markOpeningSetupRouteAttemptFailure(
            _id,
            params,
            failedBlockingOpeningEnvelope(
              contractViolation,
              "opening_coordinator_task_missing",
            ),
          );
          flushOpeningSetupAudits();
          throw new Error(
            "canonical opening bootstrap returned unresolved source work "
            + "without an exact coordinator task",
          );
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
            submission = await autoDispatchCoordinator(
              autoDispatchDeps(ctx, epoch),
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
            const terminal = submission ?? {
              status: "capability_unavailable",
              failure_class: "coordinator_capability_unavailable",
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
        const dependencyProjectionBlocked = (
          currentDependencyProjectionBlocked(value)
        );
        openingContinuationGate.observeCurrentDependencySnapshot(
          dependencyLifecycle.campaignId,
          dependencyLifecycle.waits,
          dependencyLifecycle.snapshotScope,
          dependencyProjectionBlocked,
        );
        if (currentDependencyInvocationConsumes(
          params,
          dependencyLifecycle,
        )) {
          openingContinuationGate.armCurrentDependencySuppression(
            _id,
            dependencyLifecycle.campaignId,
          );
        }
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
          const submission = await autoDispatchCoordinator(
            autoDispatchDeps(ctx, epoch),
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
      if (
        currentDependencyProjectionBlocked(value)
        && params.operation === "progressive.request_deepen"
        && objectOrNull(
          objectOrNull(params.arguments)?.current_dependency,
        ) !== null
        && invocationCampaignId
      ) {
        openingContinuationGate.armCurrentDependencySuppression(
          _id,
          invocationCampaignId,
        );
      }
      void autoDispatchCoordinator(
        autoDispatchDeps(ctx, epoch),
        name,
        value,
      ).catch(() => {});
      const locatorRun = autoDispatchPiSourceScopeLocator(
        sourceScopeDispatchDeps(ctx, epoch),
        name,
        value,
      );
      sourceScopeLocatorRuns.add(locatorRun);
      void locatorRun.catch(() => {}).finally(() => {
        sourceScopeLocatorRuns.delete(locatorRun);
      });
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
      const startupResumeError = startupResumeToolError(
        "coc_dispatch_source_work",
        params,
      );
      if (startupResumeError !== null) throw new Error(startupResumeError);
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
  const agentDir = (
    overrides.welcomeAgentDir
    ?? process.env.PI_CODING_AGENT_DIR
    ?? join(homedir(), ".pi", "coc-agent")
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
  pi.on("agent_start", () => {
    openingContinuationGate.markAgentStart();
  });
  pi.on("agent_end", async () => {
    openingContinuationGate.markAgentEnd();
    // Resolving a pending terminal wake resumes its original publisher in the
    // preceding microtask. Let that send commit or mark an exact retry before
    // claiming retries at this post-tool lifecycle boundary.
    await Promise.resolve();
    const ownedContinuedDispatches = continuedCoordinatorDispatches;
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
    const startupCampaignId = initializeSession(ctx);
    await startCocWelcome(event, ctx, startupCampaignId);
  });
  pi.on("session_shutdown", async () => {
    sessionClosing = true;
    sessionEpoch += 1;
    startupResumeGate = null;
    openingContinuationGate.reset();
    for (const controller of sourceScopeLocatorControllers.values()) {
      controller.abort("session_shutdown");
    }
    await Promise.allSettled([...sourceScopeLocatorRuns]);
    sourceScopeLocatorControllers.clear();
    sourceScopeLocatorRuns.clear();
    sourceScopeLocatorStates.clear();
    const ownedManager = manager;
    const ownedMcp = mcp;
    manager = null;
    mcp = null;
    await ownedManager?.shutdown();
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
  autoDispatchPiSourceScopeLocator,
  findPiSourceScopeLocatorTask,
  runPiSourceScopeProducer,
  validatePiSourceScopeLocatorTask,
  MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN,
};
