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
  "progressive.claim_host_work",
  "progressive.fulfill_host_work",
  "progressive.renew_host_work_leases",
  "progressive.release_host_work_leases",
]);
const OPENING_SETUP_CHARACTER_KINDS = new Set([
  "actor.create",
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
type OpeningSetupRoute = {
  schema_version: 1;
  status: "blocked";
  hard_gate: true;
  activation_allowed: false;
  phase: string;
  campaign_id: string;
  next_operation: JsonObject | null;
  instruction: string;
};
type OpeningSetupTerminalBlocker = {
  visibleText: string;
  details: JsonObject;
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
  projectionCard: JsonObject | null;
  bootstrapRetryCard: JsonObject | null;
  continuationReleaseOwner: "route" | "terminal" | null;
  backgroundTerminalReceipt: JsonObject | null;
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
};
type OpeningBackgroundSubmissionDisposition =
  | { status: "submitted" }
  | { status: "terminal"; receipt: JsonObject }
  | { status: "stale" };
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
      && exactKeysMatch(
        args,
        ["expression", "decision_id", "reason"],
      )
      && args.expression === "3D6"
      && args.reason === "Quick-Fire investigator Luck"
      && typeof args.decision_id === "string"
      && args.decision_id.trim().length > 0
    );
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
    if (args.kind === "actor.create") {
      return exactKeysMatch(payload, ["campaign_id", "actor_id", "sheet"])
        && payload.campaign_id === route.campaign_id
        && typeof payload.actor_id === "string"
        && objectOrNull(payload.sheet) !== null;
    }
    if (args.kind === "investigator.create") {
      const keys = Object.keys(payload);
      const creation = objectOrNull(payload.creation);
      const quickFireMaterialization = (
        creation !== null
        && (
          creation.characteristic_assignment_order !== undefined
          || creation.luck_roll_total !== undefined
        )
      );
      const luckReceipt = objectOrNull(creation?.luck_roll_receipt);
      return (
        keys.every((key) => (
          ["campaign_id", "investigator_id", "sheet", "creation"].includes(key)
        ))
        && ["investigator_id", "sheet"].every((key) => keys.includes(key))
        && typeof payload.investigator_id === "string"
        && objectOrNull(payload.sheet) !== null
        && (
          payload.creation === undefined
          || creation !== null
        )
        && (
          !quickFireMaterialization
          || (
            payload.campaign_id === route.campaign_id
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
        && (
          quickFireMaterialization
          || payload.campaign_id === undefined
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

  private characterSetupAllowed(state: OpeningSetupState): boolean {
    return [
      "materializing",
      "retry",
      "projection",
      "ready",
    ].includes(state.phase);
  }

  private openingSetupCharacterInvocation(
    params: JsonObject,
    state: OpeningSetupState,
  ): boolean {
    if (!this.characterSetupAllowed(state)) return false;
    const route = state.route;
    const operation = String(params.operation ?? "");
    if (params.campaign !== route.campaign_id) return false;
    if (operation === "setup.investigator_contract") {
      const args = objectOrNull(params.arguments);
      return args !== null
        && exactKeysMatch(args, ["campaign_id"])
        && args.campaign_id === route.campaign_id;
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

  private armOpeningEvidenceRoute(state: OpeningSetupState): void {
    state.phase = "opening_evidence";
    state.route = {
      ...state.route,
      phase: "opening_table_evidence_required",
      next_operation: this.openingEvidenceCard(),
      instruction: (
        "draft the source-backed opening without restating or reversing the "
        + "authoritative scene.context.time anchor; invoke this exact retained "
        + "evidence.table_opening card, then deliver only its returned data.text"
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
    const state = {
      route,
      generation: attempt.generation,
      generationSequence: attempt.generationSequence,
      revision: 1,
      phase,
      dispatchIdentity: null,
      characterSetupComplete: false,
      projectionCard: null,
      bootstrapRetryCard: null,
      continuationReleaseOwner: null,
      backgroundTerminalReceipt: null,
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
        this.initializeOpeningSetupState(
          attempt.campaignId,
          route,
          "selection",
          attempt,
        );
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
      const acceptedCharacterResult = linkAttempt
        ? this.exactCanonicalLinkReceipt(params, envelope)
        : envelope?.ok === true;
      if (linkAttempt && acceptedCharacterResult) {
        state.characterSetupComplete = true;
        if (state.phase === "ready") {
          this.armOpeningEvidenceRoute(state);
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
      if (
        acceptedCharacterResult
        && attempt.agentTurn === this.openingSetupAgentTurn
        && !this.openingSetupTurnCampaignAmbiguous
        && this.openingSetupTurnCampaignId === attempt.campaignId
      ) {
        this.openingSetupVisibleOutputAuthorization = {
          campaignId: attempt.campaignId,
          generation: state.generation,
          revision: state.revision,
          agentTurn: attempt.agentTurn,
          invocationId,
        };
      } else if (acceptedCharacterResult) {
        this.recordOpeningSetupAudit({
          status: "ignored",
          reason: "late_or_ambiguous_setup_output",
          campaign_id: attempt.campaignId,
          invocation_id: invocationId,
        });
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
        this.clearOpeningSetupRoute(
          attempt.campaignId,
          state.generation,
        );
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "opening_table_evidence_current",
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
      state.phase = "projection";
      state.continuationReleaseOwner = null;
      state.route = {
        ...state.route,
        phase: "opening_projection_required",
        next_operation: state.projectionCard,
        instruction: (
          "background opening source work is fulfilled; invoke this exact "
          + "retained projection card before any live-play operation"
        ),
      };
      this.openingSetupContinuationQueued.delete(state.route.campaign_id);
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
      instruction: (
        "opening background failed; preserve evidence and retry only this "
        + "exact retained bootstrap card"
      ),
    };
    state.dispatchIdentity = null;
    state.projectionCard = null;
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

  trackBlockingMicroDispatch(dispatchKey: string): void {
    if (!dispatchKey) return;
    this.states.set(dispatchKey, "awaiting");
    this.dispatchClasses.set(dispatchKey, "blocking_micro");
    this.queueVisibleAssistantDisposition("operational_wait", dispatchKey);
  }

  releaseBlockingMicroDispatch(dispatchKey: string): void {
    if (this.dispatchClasses.get(dispatchKey) !== "blocking_micro") return;
    this.states.delete(dispatchKey);
    this.dispatchClasses.delete(dispatchKey);
    this.queuedVisibleDispositions = this.queuedVisibleDispositions.filter(
      (queued) => !(
        queued.disposition === "operational_wait"
        && queued.dispatchKey === dispatchKey
      ),
    );
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
  }

  coordinatorContinuationContext(
    dispatchKey: string,
    terminalStatus: string,
  ): JsonObject {
    const dispatchClass = this.dispatchClasses.get(dispatchKey)
      ?? "nonblocking_background";
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
      const naturalCharacterSetupAllowed = (
        openingState !== null
        && !openingState.characterSetupComplete
        && this.characterSetupAllowed(openingState)
      );
      if (
        !naturalCharacterSetupAllowed
        && (
          openingState === null
          || !this.openingSetupAuthorizationMatches(openingState)
        )
      ) {
        return false;
      }
      if (
        openingState !== null
        && this.openingSetupAuthorizationMatches(openingState)
      ) {
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
      }
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
      this.states.delete(key);
      this.dispatchClasses.delete(key);
    }
  }

  decideWake(dispatchKey: string): boolean | Promise<boolean> {
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

function blockingMicroAutoDispatchTask(value: unknown): JsonObject | null {
  const takeover = findAutoDispatchTakeover(value);
  const boundary = objectOrNull(takeover?.play_boundary);
  if (
    boundary?.current_dependent_settlement_waits_for_terminal !== true
  ) {
    return null;
  }
  return findAutoDispatchTask(value);
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
      if (options.waitForTerminal) return boundedFailure(unavailable);
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
      openingContinuationGate.observeOpeningCoordinatorTerminal(receipt);
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
        (dispatchKey) => (
          openingContinuationGate.releaseOpeningTerminalContinuation(
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
  const flushOpeningSetupAudits = () => {
    for (const audit of openingContinuationGate.takeOpeningSetupAudits()) {
      try { pi.appendEntry("coc-opening-setup-route-audit", audit); }
      catch { /* opening setup audit is best effort */ }
    }
  };
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
    let value: unknown;
    try {
      value = await client(ctx).callTool(name, params, signal);
    } catch (error) {
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
      throw error;
    }
    if (name === "coc_invoke") {
      const openingObservation = (
        openingContinuationGate.observeOpeningSetupInvocation(
          String(params.operation),
          params,
          value,
          _id,
        )
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
      const blockingMicroTask = blockingMicroAutoDispatchTask(value);
      if (blockingMicroTask !== null) {
        const packet = objectOrNull(blockingMicroTask.packet);
        const dispatchKey = typeof packet?.packet_id === "string"
          ? packet.packet_id.trim()
          : "";
        openingContinuationGate.trackBlockingMicroDispatch(dispatchKey);
        const submission = await autoDispatchCoordinator(
          autoDispatchDeps(ctx, epoch),
          name,
          value,
        );
        if (submission?.status !== "submitted") {
          openingContinuationGate.releaseBlockingMicroDispatch(dispatchKey);
        }
      } else {
        void autoDispatchCoordinator(
          autoDispatchDeps(ctx, epoch),
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
    async execute(_id: string, params: JsonObject, signal: AbortSignal | undefined) {
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
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "coc-agent");
  registerCocWelcome(pi, (ctx) => client(ctx), agentDir);
  registerPlayerTranscriptGate(
    pi,
    (visibleText) => {
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
      if (decision === false || decision === true) {
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

export const __test = {
  piCoordinatorEnabled,
  runOcr,
  findAutoDispatchTask,
  autoDispatchCoordinator,
  MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN,
};
