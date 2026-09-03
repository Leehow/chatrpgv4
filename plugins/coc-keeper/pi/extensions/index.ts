import {
  createOpeningSetupMachineMethods,
  installOpeningSetupMachineState,
  NO_SELECTOR_SETUP_COMPLETE_DECISION_ID_PATTERN,
  type OpeningSetupMachineMethods,
  type OpeningSetupMachineStateSurface,
} from "../lib/opening-setup-machine.ts";
import {
  createCurrentDependencyMachineMethods,
  installCurrentDependencyMachineState,
  type CurrentDependencyMachineMethods,
  type CurrentDependencyMachineStateSurface,
} from "../lib/current-dependency-machine.ts";
import {
  createTurnOutputGateMethods,
  compareCanonicalTurnProgress,
  installTurnOutputGateState,
  type CanonicalTurnProgress,
  type TurnOutputGateMethods,
  type TurnOutputGateStateSurface,
} from "../lib/turn-output-gate.ts";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
import { isDeepStrictEqual } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  asObject,
  CanonicalToolError,
  exactKeys,
  modelVisibleCanonicalToolResult,
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
  type McpTransportMeta,
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
  MemoryExtractionDispatcher,
  defaultRunMemoryHostBridge,
  memoryHostBridgeCommand,
  type MemoryExtractionRefs,
  type MemoryHostBridgeRequest,
} from "../lib/memory-extraction-dispatch.ts";
import {
  buildMechanicalOutputGateEnvelope,
  buildSettledOutputGateEnvelope,
  buildSettledOutputPreflightEnvelope,
  detectMechanicalMarkers,
  MECHANICAL_OUTPUT_GATE_CUSTOM_TYPE,
  SETTLED_OUTPUT_PREFLIGHT_CUSTOM_TYPE,
  SETTLED_OUTPUT_GATE_CUSTOM_TYPE,
  mechanicalMarkerClassesUncovered,
  type MechanicalMarker,
} from "../lib/mechanical-output-gate.ts";
import { compactToolRenderers } from "../lib/tool-render.ts";
import {
  decideSceneSupply,
  type SceneSupplyDispatchStatus,
} from "../lib/scene-supply.ts";
import {
  detectMapSupplyPageDirectory,
  mapVisualMessage,
  renderMapSupplyPages,
} from "../lib/map-supply.ts";
import {
  executeSourceAssetTool,
  SOURCE_ASSET_TOOL_NAME,
  SOURCE_ASSET_TOOL_SCHEMA,
} from "../lib/source-asset-catalog.ts";
import { registerSkillDocRead } from "../lib/skill-doc-read.ts";
import {
  KEEPER_BRIEFING_CUSTOM_TYPE,
  keeperBriefingMessage,
  readKeeperBriefing,
  type KeeperBriefing,
} from "../lib/keeper-briefing.ts";
import { registerCocHud } from "../lib/hud.ts";
import { registerTurnTelemetry, type TurnTelemetry } from "../lib/turn-telemetry.ts";
import {
  createDebugExperimentHost,
  type DebugExperimentHostContext,
  type DebugExperimentReceipt,
} from "../lib/debug-experiment.ts";
import {
  cocSystemInstructionOperations,
  latestExternalUserText,
  registerCocSystemInstructionCommand,
  sendCocSystemInstruction,
} from "../lib/system-instruction.ts";
import {
  clearOpenTurnPlayerInput,
  validPreJournalWindow,
  createOpenTurnAnchor,
  loadOpenTurnPlayerInput,
  loadZeroToolOpenTurnPlayerInput,
  recordOpenTurnPlayerInput,
  validOpenTurnAnchor,
  type OpenTurnAnchor,
} from "../lib/open-turn-player-input.ts";

import { createContextFold, readFoldSettings } from "../lib/context-fold.ts";
import {
  registerCocWelcome,
  STARTUP_RESUME_CUSTOM_TYPE,
  startupResumeInstruction,
  tableOpenIntentFromEnv,
  debugLaneEnabled,
} from "../lib/welcome.ts";
import { isCanonicalCampaignId } from "../lib/campaign-id.mjs";
import {
  activeToolsForPhase,
  activeToolsForStartupResumePending,
  DOMAIN_TOOL_DESCRIPTIONS,
  DOMAIN_TOOL_LABELS,
  DOMAIN_TOOL_NAMES,
  domainToolSchema,
  evaluateExecuteAcl,
  isPreCampaignFreshCreation,
  inferPhaseFromEnvelope,
  inferPhaseFromError,
  isCanonicalInvokeSurface,
  remapUnopenedReadyTableResume,
  sessionRoleFromEnv,
  type PlayPhase,
} from "../lib/domain-tools.ts";
import {
  executionClassForPolicy,
  KP_SURFACES,
  OPERATION_POLICY,
  type SessionRole,
} from "../lib/operation-policy.ts";
import {
  handoffFromEnvelope,
} from "../lib/handoff.ts";
import {
  CHARGEN_BACKSTORY_KEYS,
  parseChargenClerkBrief,
  runChargenInProcess,
  shouldRegisterChargenDelegate,
  type ChargenClerkBrief,
} from "../lib/chargen-clerk.ts";
import { extraToolsForSessionRole } from "../lib/session-role-tools.ts";
import { NonRetryableFailureCircuit } from "../lib/nonretry-circuit.ts";
import {
  applyAcknowledgedResumeRecoveryGuidance,
  applyPendingFinalizationRecoveryGuidance,
  applyOpenTurnRecoveryGuidance,
  buildDraftShapeRecoveryCard,
  draftShapePayloadDigest,
  hasReviewEvidenceEntry,
  projectDraftShapeRecoveryForModel,
  selectRecoverableDraftShapeCard,
  isDraftShapePlacementFailure,
  isPendingFinalizationResume,
  pendingFinalizationInlineCardsComplete,
  validateLiveOutputContext,
  type LiveOutputContextCards,
  type PendingFinalizationHydration,
  DRAFT_SHAPE_RECOVERY_CARD_AUDIT,
  DRAFT_SHAPE_RECOVERY_COMPLETE_AUDIT,
  DRAFT_SHAPE_RECOVERY_SEAL_AUDIT,
  HOST_BOUND_FINALIZE_ARGUMENTS,
  NARRATION_REVIEW_EVIDENCE_AUDIT,
  OPEN_TURN_RECOVERY_GUIDANCE_AUDIT,
  PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT,
} from "../lib/recovery-guidance.ts";
import {
  bindStartupResumeParams,
  isExactStartupResumeParams,
  startupResumeIdentityArgumentsMatch,
} from "../lib/startup-resume-gate.ts";
import {
  applyRetainedAdoptSourceFacts,
  attachExpectedSchema,
  bindRetainedTypedToolArguments,
  retainedTypedToolHostArguments,
  buildReviewedAgencyBinding,
  buildReviewedCoverageBindingFacts,
  CURRENT_INVESTIGATOR_HANDLE,
  deriveChaseActionCandidates,
  deriveSemanticEntityFacts,
  defaultTypedToolCatalog,
  listTypedOperationTools,
  projectBoundTypedToolParameters,
  projectModelVisibleCanonicalResult,
  projectPiToolFailure,
  restoreSemanticEntityHandles,
  stripOpaqueModelIdentity,
  ToolContractProjectionError,
  typedToolNameForOperation,
  buildGenericInvokeInputSchema,
  validateGenericInvokeAgainstRegisteredSchema,
  validateProjectedModelArguments,
  validateRawModelIdentityPayload,
  HOST_OWNED_FIELDS,
  wrapTypedToolInvokeParams,
  type CurrentTypedToolHostContext,
  type ChaseActionCandidate,
  type SanityBoutActionCandidate,
  type SanityBoutBindingCard,
  type ReviewedAgencyBinding,
  type ReviewedCoverageBindingFacts,
  type SemanticEntityFacts,
  type SemanticIdMap,
  type TypedOperationTool,
  type TypedToolBindingCard,
  type UnmappedIdentityRef,
} from "../lib/typed-tools.ts";
import {
  HOST_PROVENANCE_PLEDGES,
  pledgeConsumersOf,
  pledgedValue,
} from "../lib/host-provenance-pledges.ts";
import {
  createSemanticIdentityRegistry,
  type SemanticIdentityRegistry,
  type SemanticIdentityScope,
} from "../lib/semantic-identity-registry.ts";
import type { SemanticIdentityHandleResolver } from "../lib/tool-contract-projection.ts";
import {
  affordancesFromHealingCardProjection,
  affordancesFromSanityTriggerProjection,
  loadToolNamespace,
  projectToolWorkingSet,
  type LoadedExactOperation,
  type LoadedNamespace,
  type ModelVisibleHostTool,
  type ToolWorkingSet,
  type ToolWorkingSetSnapshot,
  type WorkingSetNamespace,
} from "../lib/tool-working-set.ts";
import {
  registerPlayerPdfBindInstruction,
  userMessageText,
} from "../lib/player-pdf-bind.ts";
import {
  PiStateClaimCompiler,
  PiStateClaimCompilerFailure,
  STATE_CLAIM_HOST_FIELD,
} from "../lib/state-claim-compiler.ts";
export {
  PLAYER_PDF_BIND_INSTRUCTION_CUSTOM_TYPE,
  detectPlayerPdfBindRequest,
  playerPdfBindInstruction,
  registerPlayerPdfBindInstruction,
} from "../lib/player-pdf-bind.ts";
export type { PlayerPdfBindDetection } from "../lib/player-pdf-bind.ts";

const RULES_DIRECTOR_SINGLE_DRAFT_PROFILE = "rules-director-single-draft";

function rulesDirectorSingleDraftProfileActive(): boolean {
  return process.env.COC_PI_ACCEPTANCE_PROFILE
    === RULES_DIRECTOR_SINGLE_DRAFT_PROFILE;
}

const emptySchema = { type: "object", properties: {}, additionalProperties: false } as const;
const OCR_TIMEOUT_MS = 15 * 60 * 1000;
export const TURN_PROCESSING_FAULT_CUSTOM_TYPE = "coc-turn-processing-fault";
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
const discoverSchema = {
  type: "object",
  properties: {
    operation: {
      type: "string",
      pattern: "^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$",
    },
    domain: {
      type: "string",
      enum: KP_SURFACES.filter((surface) => surface !== "none"),
    },
  },
  maxProperties: 1,
  additionalProperties: false,
} as const;
/**
 * The REGISTERED generic coc_invoke input schema: the closed, operation-
 * discriminated envelope (each branch = operation const + that operation's
 * projected model-owned arguments). Host routing identity (root, campaign,
 * session/finalization/receipt/chunk identities) is absent — the host binds
 * it. This exact object is the tool-registration schema, the runtime
 * validation source, and the schema inventory source; there is no synthetic
 * substitute.
 */
const invokeSchema = buildGenericInvokeInputSchema() as unknown as JsonObject;
const genericInvokeInputSchema = invokeSchema as unknown as Parameters<
  typeof validateGenericInvokeAgainstRegisteredSchema
>[1];
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
  "setup.complete",
]);
const mapSupplySchema = {
  type: "object",
  properties: {
    operation: { type: "string", enum: ["detect", "render", "present"] },
    pages_dir: { type: "string" },
    candidate_pdf_indices: { type: "array", maxItems: 256, items: { type: "integer", minimum: 0 } },
    needs_ocr: { type: "array", maxItems: 256, items: { type: "integer", minimum: 0 } },
    asset_root_id: { type: "string" },
    source_pdf_path: { type: "string" },
    image_ref: { type: "string" },
    caption: { type: "string", maxLength: 400 },
  },
  required: ["operation"], additionalProperties: false,
} as const;
function coc7ChargenCatalog(): {
  skillIds: string[];
  zhHansSkillLabels: Record<string, string>;
} {
  const rulesPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../rulesets/coc7/rules-json/skills.json",
  );
  const parsed = JSON.parse(readFileSync(rulesPath, "utf8"));
  const skills = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as JsonObject).skills
    : null;
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) {
    throw new Error("canonical COC7 skill catalog is unavailable for chargen tool schema");
  }
  const skillIds = Object.keys(skills)
    .filter((name) => name !== "Credit Rating" && name !== "Cthulhu Mythos")
    .sort();
  const zhHansSkillLabels = Object.fromEntries(
    Object.entries(skills).flatMap(([name, value]) => {
      const skill = value && typeof value === "object" && !Array.isArray(value)
        ? value as JsonObject
        : null;
      const labels = skill && skill.localized_labels
        && typeof skill.localized_labels === "object"
        && !Array.isArray(skill.localized_labels)
        ? skill.localized_labels as JsonObject
        : null;
      const label = labels?.["zh-Hans"];
      return typeof label === "string" && label.trim()
        ? [[name, label.trim()]]
        : [];
    }),
  );
  return { skillIds, zhHansSkillLabels };
}

const COC7_CHARGEN_CATALOG = coc7ChargenCatalog();
const CHARGEN_SKILL_IDS = COC7_CHARGEN_CATALOG.skillIds;

function zhHansPlayerTerms(): Record<string, string> {
  const termsPath = fileURLToPath(
    new URL("../../scripts/default_localized_terms.json", import.meta.url),
  );
  const parsed = JSON.parse(readFileSync(termsPath, "utf8"));
  const terms = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as JsonObject)["zh-Hans"]
    : null;
  if (!terms || typeof terms !== "object" || Array.isArray(terms)) {
    throw new Error("zh-Hans player-facing terms are unavailable");
  }
  return Object.fromEntries(
    Object.entries(terms)
      .filter((entry): entry is [string, string] => (
        typeof entry[1] === "string" && entry[1].trim().length > 0
      )),
  );
}

const ZH_HANS_PLAYER_TERMS = zhHansPlayerTerms();

function zhHansChargenSkillLabel(canonicalName: string): string {
  if (canonicalName === "Language (Own)") return "母语";
  const languageMatch = /^(?:Other Language|Language) \((.+)\)$/.exec(canonicalName);
  if (languageMatch) {
    const languageLabels: Record<string, string> = {
      English: "英语",
      Spanish: "西班牙语",
    };
    return `语言（${languageLabels[languageMatch[1]] ?? languageMatch[1]}）`;
  }
  const localized = COC7_CHARGEN_CATALOG.zhHansSkillLabels[canonicalName]
    ?? ZH_HANS_PLAYER_TERMS[canonicalName];
  if (localized) return localized;
  return canonicalName;
}

const ZH_HANS_CHARGEN_BACKSTORY_LABELS: Record<string, string> = {
  personal_description: "外貌与来历",
  ideology_beliefs: "人格信念",
  significant_people: "重要之人",
  meaningful_locations: "意义之地",
  treasured_possessions: "珍视之物",
  traits: "特质",
  injuries_scars: "伤病与疤痕",
  phobias_manias: "恐惧与躁狂",
  encounters: "神话遭遇",
  scenario_bound: "如何卷入",
};

function zhHansChargenRoleplaySummary(brief: ChargenClerkBrief): string[] {
  const lines = CHARGEN_BACKSTORY_KEYS.flatMap((field) => {
    const value = brief.backstory?.[field]?.trim();
    if (!value) return [];
    const starred = brief.key_connection?.backstory_field === field ? " ★" : "";
    return [`${ZH_HANS_CHARGEN_BACKSTORY_LABELS[field] ?? field}${starred}：${value}`];
  });
  const blocks: string[] = [];
  if (lines.length > 0) blocks.push(`人物背景：\n- ${lines.join("\n- ")}`);
  if (brief.equipment?.length) {
    blocks.push(`随身物品：${brief.equipment.join("；")}`);
  }
  return blocks;
}

export const chargenDelegateSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    occupation_name: { type: "string", minLength: 1 },
    age: { type: "integer", minimum: 15, maximum: 89 },
    assignment_priority: { type: "string" },
    interest_allocation_intent: { type: "string" },
    occupation_skill_names: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    interest_skill_names: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    professional_language_names: {
      type: "array",
      maxItems: 2,
      items: { type: "string", pattern: "^Language \\(.+\\)$" },
    },
    investigator_id: { type: "string" },
    mode: { type: "string", enum: ["quick_fire", "era_adaptive", "pregen"] },
    pregen_id: { type: "string" },
    occupation_label: { type: "string", minLength: 1 },
    own_language: { type: "string", minLength: 1 },
    backstory: {
      type: "object",
      additionalProperties: false,
      properties: {
        personal_description: { type: "string" },
        ideology_beliefs: { type: "string" },
        significant_people: { type: "string" },
        meaningful_locations: { type: "string" },
        treasured_possessions: { type: "string" },
        traits: { type: "string" },
        injuries_scars: { type: "string" },
        phobias_manias: { type: "string" },
        encounters: { type: "string" },
        scenario_bound: { type: "string" },
      },
    },
    equipment: {
      type: "array",
      items: { type: "string" },
    },
    key_connection: {
      type: "object",
      additionalProperties: false,
      required: ["backstory_field", "summary"],
      properties: {
        backstory_field: {
          type: "string",
          enum: [
            "personal_description",
            "ideology_beliefs",
            "significant_people",
            "meaningful_locations",
            "treasured_possessions",
            "traits",
          ],
        },
        summary: { type: "string", minLength: 1 },
      },
    },
  },
  required: ["name", "occupation_name"],
  additionalProperties: false,
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

/**
 * Single post-observer model-content boundary: every canonical envelope is
 * projected through the structured Pi-owned projection (operation-aware
 * semantic views plus the recursive opaque-identity sanitizer) before it
 * becomes model-facing `content`. The exact canonical envelope stays
 * host-internal in `details`, so host observers, audit entries, and exact
 * delivery replay are unchanged.
 */
function modelVisibleCanonicalEnvelope(
  operation: unknown,
  value: JsonObject,
  semanticIds: SemanticIdMap | null = null,
  diagnostics: ProjectionIdentityDiagnostics | null = null,
): JsonObject {
  return projectModelVisibleCanonicalResult(
    typeof operation === "string" ? operation : null,
    value,
    semanticIds,
    diagnostics,
  );
}

/**
 * Host-tool model-content projection (Identifier Law): Pi-owned source
 * workstream tools carry internal asset ids/hashes/paths in their results;
 * model content passes through the same structured sanitizer, and this
 * tool's internal srcasset identity fields are dropped. Handout/card asset
 * ids inside canonical operations stay semantic and are untouched. Host
 * consumers keep reading the exact canonical value from `details`.
 */
function projectHostToolModelContent(
  value: JsonObject,
  options: { dropAssetIdFields?: boolean } = {},
): JsonObject {
  const dropAssetIdFields = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(dropAssetIdFields);
    if (typeof input !== "object" || input === null) return input;
    const projected: JsonObject = {};
    for (const [field, child] of Object.entries(input)) {
      if (options.dropAssetIdFields && field === "asset_id") continue;
      projected[field] = dropAssetIdFields(child);
    }
    return projected;
  };
  const prepared = options.dropAssetIdFields
    ? dropAssetIdFields(value)
    : value;
  return stripOpaqueModelIdentity(prepared) as JsonObject;
}

/** Fixed semantic messages for recovery finalize results — no value echo. */
const RECOVERY_FINALIZE_SEMANTIC_MESSAGES: Record<string, string> = {
  default_mechanics_placement_unavailable:
    "最终化未完成：某个 public check 的 consequence 段落位于第零段或其摘录没有落在任何段落中。"
      + "请按 recovery 指引在 consequence 段落前插入独立的 action/setup 段落，"
      + "然后仅以修正后的 draft 重新调用 turn.finalize。",
  recovery_payload_not_draft_only:
    "恢复重放被拒绝：恢复调用只需携带修正段落形状后的 draft；"
      + "其余冻结参数由宿主自动重建并附加。",
  recovery_identity_mismatch:
    "恢复重放被拒绝：恢复调用不得携带宿主机绑定身份；身份由宿主自动注入。",
  recovery_draft_missing:
    "恢复重放被拒绝：恢复调用必须携带修正段落形状后的完整 draft。",
  recovery_payload_unavailable:
    "恢复重放被拒绝：内部冻结负载不可用，无法机器重建恢复调用。",
  recovery_binding_unarmed:
    "恢复重放被拒绝：本会话没有已验证的冻结绑定，无法机器绑定恢复身份。",
  recovery_failed:
    "最终化未完成：恢复重放遇到下游失败，未产生任何玩家可见结果。"
      + "请按 recovery 指引仅以修正后的 draft 重试；"
      + "其余参数与身份由宿主自动重建并附加。",
};

/** Closed whitelist of semantic recovery finalize codes. */
const RECOVERY_FINALIZE_SEMANTIC_CODES: ReadonlySet<string> = new Set(
  Object.keys(RECOVERY_FINALIZE_SEMANTIC_MESSAGES),
);

const RECOVERY_FINALIZE_FALLBACK_MESSAGE =
  "最终化未完成：请按 recovery 指引仅以修正后的 draft 重试；"
    + "其余参数与身份由宿主自动重建并附加。";

/**
 * Model-visible projection of a recovery finalize result. Success exposes
 * semantic status and the player-visible rendered text only; failures expose
 * a bounded semantic code and fixed guidance without echoing internal or
 * caller-supplied opaque values. The exact canonical envelope stays
 * host-internal (gateway `details`).
 */
function projectRecoveryFinalizeResult(
  value: JsonObject,
  trustedRecovery: JsonObject | null,
): JsonObject {
  if (value.ok === true) {
    const data = objectOrNull(value.data);
    return {
      ok: true,
      tool: "turn.finalize",
      data: {
        schema_version: 1,
        status: "finalized",
        ...(data !== null && typeof data.rendered_text === "string"
          ? { rendered_text: data.rendered_text }
          : {}),
      },
      warnings: [],
      hints: [],
    };
  }
  const error = objectOrNull(value.error) ?? {};
  // Closed semantic whitelist: downstream canonical codes are never copied.
  // Unknown failures collapse to the generic semantic `recovery_failed`
  // with a fixed message — no raw code, message, or value echo.
  const rawCode = typeof error.code === "string" && error.code
    ? error.code
    : "";
  const code = RECOVERY_FINALIZE_SEMANTIC_CODES.has(rawCode)
    ? rawCode
    : "recovery_failed";
  // The canonical error's `recovery` payload is never trusted, passed
  // through, or inspected — contract ids and shapes are attacker-controlled
  // downstream data. A semantic recovery instruction rides along ONLY when
  // the host reconstructed it from the exact validated armed internal card
  // (supplied as `trustedRecovery` by the gateway); otherwise it is omitted.
  return {
    ok: false,
    tool: "turn.finalize",
    error: {
      code,
      message: RECOVERY_FINALIZE_SEMANTIC_MESSAGES[code],
      retryable: false,
      ...(trustedRecovery !== null && trustedRecovery !== undefined
        ? { recovery: structuredClone(trustedRecovery) }
        : {}),
    },
    warnings: [],
    hints: [],
  };
}

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

export function openingHandoffOperationForSessionRole(
  _role: "setup" | "play" | null,
): "evidence.table_opening" {
  // The table records and delivers the player-visible opening after its
  // mandatory session.resume. There is no other answer: the setup role is
  // retired, and a campaign that has not been handed off never reaches a play
  // host -- the launcher refuses it and names `pi-coc-setup`.
  return "evidence.table_opening";
}

/** Gate envelopes may grow additive fields (e.g. `opening_phase`). Cards stay exact. */
function hasRequiredKeys(value: JsonObject, required: string[]): boolean {
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

const OPENING_LIFECYCLE_PHASES = new Set([
  "module_preparation",
  "character_creation",
  "opening_selection",
]);
const SESSION_RESUME_ENVELOPE_TOOLS = new Set([
  "session.resume",
  "coc_session_resume",
  "coc_invoke",
]);

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

/**
 * Startup-only structured scan of the persistent session branch: does it end
 * with a real unmatched external player turn? Any structured user message
 * arms the pending fact regardless of whether its content is an array, a
 * string, attachment-only, empty, or absent — the same explicit contract as
 * the welcome.ts sessionBranchHasTrailingPlayerUser helper; text presence
 * is never a prerequisite. A later assistant message clears it only when it
 * carries non-empty player-visible text. Thinking-only, tool-only, and empty
 * assistant entries, tool results, hidden custom messages, and non-message
 * entries (compaction, telemetry, steering) never clear it, and prose
 * content is never interpreted.
 */
function branchEndsWithUnmatchedPlayerUser(branch: unknown): boolean {
  if (!Array.isArray(branch)) return false;
  let pendingPlayerUser = false;
  for (const raw of branch) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { type?: unknown; message?: unknown };
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (!message || typeof message !== "object") continue;
    const structured = message as { role?: unknown };
    if (structured.role === "user") {
      pendingPlayerUser = true;
      continue;
    }
    const assistant = assistantContentMessage(message);
    if (
      assistant !== null
      && (visibleAssistantText(assistant) ?? "").trim().length > 0
    ) {
      pendingPlayerUser = false;
    }
  }
  return pendingPlayerUser;
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

export function shouldTriggerOpeningSetupContinuation(
  decision: VisibleAssistantFinalDecision,
): boolean {
  return decision === false || (
    typeof decision === "object"
    && decision.triggerSetupContinuation === true
  );
}
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
    | "handoff_decision"
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
const REVIEW_RECOVERY_FAILURE_CLASSES = new Set([
  "protocol_invalid",
  "result_invalid",
]);

type FrozenReviewRecoveryIdentity = {
  campaign_id: string;
  run_id: string;
  session_id: string;
  player_turn_epoch: number;
  turn_id: string;
  revision: number;
  source_digest: string;
  failure_class: string;
};

function frozenReviewIdentityFromFault(
  base: JsonObject,
  playerTurnEpoch: number,
): FrozenReviewRecoveryIdentity | null {
  const campaignId = typeof base.campaign_id === "string" ? base.campaign_id : "";
  const runId = typeof base.run_id === "string" ? base.run_id : "";
  const sessionId = typeof base.session_id === "string" ? base.session_id : "";
  const turnId = typeof base.turn_id === "string" ? base.turn_id : "";
  const sourceDigest = typeof base.source_digest === "string"
    ? base.source_digest
    : "";
  const failureClass = typeof base.failure_class === "string"
    ? base.failure_class
    : "";
  const revision = Number(base.revision);
  if (
    !campaignId
    || !runId
    || !sessionId
    || !turnId
    || !sourceDigest
    || !failureClass
    || !Number.isInteger(revision)
    || revision < 1
  ) return null;
  return {
    campaign_id: campaignId,
    run_id: runId,
    session_id: sessionId,
    player_turn_epoch: playerTurnEpoch,
    turn_id: turnId,
    revision,
    source_digest: sourceDigest,
    failure_class: failureClass,
  };
}

function frozenReviewIdentitiesMatch(
  latched: FrozenReviewRecoveryIdentity,
  request: {
    campaign_id: string;
    run_id: string;
    session_id: string;
    player_turn_epoch: number;
    turn_id: string;
    revision: number;
    source_digest: string;
  },
): boolean {
  return latched.campaign_id === request.campaign_id
    && latched.run_id === request.run_id
    && latched.session_id === request.session_id
    && latched.player_turn_epoch === request.player_turn_epoch
    && latched.turn_id === request.turn_id
    && latched.revision === request.revision
    && latched.source_digest === request.source_digest;
}

export interface OpeningTerminalContinuationGate
  extends OpeningSetupMachineMethods,
    OpeningSetupMachineStateSurface,
    CurrentDependencyMachineMethods,
    CurrentDependencyMachineStateSurface,
    TurnOutputGateMethods,
    TurnOutputGateStateSurface {}

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

  observeMessageStart(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const value = message as {
      role?: unknown;
      customType?: unknown;
      details?: unknown;
    };
    if (value.role === "user") {
      const playerText = userMessageText(message);
      if (playerText !== null) this.markExternalUserInput(playerText);
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
    requireFinalization = false,
  ): VisibleAssistantFinalDecision {
    // Only the transcript gate's confirmed tool-free assistant final reaches
    // this method. Streaming starts/updates and tool-bearing finals cannot
    // consume host provenance.
    const disposition = this.queuedVisibleDispositions.shift()?.disposition;
    const openingState = this.openingSetupStateForTranscript();
    if (
      openingState !== null
      && openingState.characterSetupComplete
      && this.pendingChargenPlayerSummary?.campaignId
        === openingState.route.campaign_id
    ) {
      const replacementText = this.pendingChargenPlayerSummary.text;
      this.pendingChargenPlayerSummary = null;
      return { replacementText };
    }
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
        && !openingState.characterSetupComplete
        && !this.characterConversationAllowed(openingState)
      ) {
        return false;
      }
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
        if (!this.characterConversationAllowed(openingState)) return false;
        // Guided character creation is a player conversation owned by the
        // live KP. The setup host prompt keeps it to one natural question at
        // a time and the typed chargen delegate owns the eventual confirmed
        // write; this transcript boundary must not expose host/tool
        // instructions by replacing the KP's player-facing question.
        return true;
      }
      return false;
    }
    const currentSuppression = this.currentDependencySuppression;
    if (
      this.turnProcessingFault !== null
      && this.turnProcessingFault.epoch === this.playerTurnEpoch
    ) {
      // Only a current-epoch terminal fault suppresses further visible
      // output. A fault retained from an older epoch (for example the
      // narration.review latch) must not suppress this new epoch's
      // player-visible delivery.
      this.pendingMechanicalOutputGateEnvelope = null;
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
    if (requireFinalization) {
      this.pendingMechanicalOutputGateEnvelope = (
        buildSettledOutputGateEnvelope(this.playerTurnEpoch)
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
    this.currentExternalPlayerText = null;
    this.finalizedOutput = null;
    this.nonblockingContinuation = null;
    this.epochMechanicalReceipts.clear();
    this.pendingMechanicalOutputGateEnvelope = null;
    this.turnProcessingFault = null;
    this.preInferenceFinalizationSteerEpoch = 0;
    this.emptyTerminalRecoveryEpoch = 0;
    this.epochPlayerOutputDelivered = 0;
    this.clearOpeningSetupRoute();
    this.openingSetupGenerationSequence = 0;
    this.openingSetupAgentTurn = 0;
    this.openingSetupAudits = [];
    this.pendingChargenPlayerSummary = null;
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
  allowEmptyFinalReplacement?: () => boolean,
  onEmptyAssistantFinal?: () => void,
  onLeadingWhitespaceStreamLimit?: (
    details: { deltaCount: number; charCount: number },
    ctx: ExtensionContext,
  ) => void,
  onLeadingWhitespaceObserved?: (
    details: { deltaCount: number; charCount: number },
  ) => void,
): void {
  // Bound a stream that emits leading whitespace forever, and nothing else.
  //
  // Only the character count is a trigger. A counted delta always carries at
  // least one character, so `charCount >= deltaCount` always holds and a delta
  // bound can only ever fire FIRST — four times sooner when a provider streams
  // one character at a time, which is exactly what happened: every abort in
  // the 2026-09-01 run3 table was 32 deltas of 32 characters, and the Keeper
  // re-prompted by the empty-terminal recovery then produced its narration
  // immediately. The stream was padding, not runaway, and the host's own abort
  // was what emptied the turn: eight of 28 turns paid an extra model round
  // trip for it. The character bound alone says what the guard means.
  const LEADING_WHITESPACE_CHAR_LIMIT = 512;
  let whitespaceDeltaCount = 0;
  let whitespaceCharCount = 0;
  let streamHasSemanticOutput = false;
  let whitespaceLimitDelivered = false;
  const resetWhitespaceWatch = () => {
    whitespaceDeltaCount = 0;
    whitespaceCharCount = 0;
    streamHasSemanticOutput = false;
    whitespaceLimitDelivered = false;
  };
  pi.on("message_start", (event) => {
    if (assistantContentMessage(event.message) !== null) resetWhitespaceWatch();
    onMessageStart?.(event.message);
    hideUnsettledAssistantText(event.message);
  });
  pi.on("message_update", (event, ctx) => {
    const update = event.assistantMessageEvent as {
      type?: unknown;
      delta?: unknown;
    };
    if (update?.type === "text_delta" && typeof update.delta === "string") {
      if (update.delta.trim().length > 0) {
        streamHasSemanticOutput = true;
      } else if (update.delta.length > 0 && !streamHasSemanticOutput) {
        whitespaceDeltaCount += 1;
        whitespaceCharCount += update.delta.length;
        if (
          !whitespaceLimitDelivered
          && whitespaceCharCount >= LEADING_WHITESPACE_CHAR_LIMIT
        ) {
          whitespaceLimitDelivered = true;
          onLeadingWhitespaceStreamLimit?.({
            deltaCount: whitespaceDeltaCount,
            charCount: whitespaceCharCount,
          }, ctx);
        }
      }
    } else if (
      typeof update?.type === "string"
      && update.type.startsWith("toolcall_")
    ) {
      streamHasSemanticOutput = true;
    }
    hideUnsettledAssistantText(event.message);
  });
  pi.on("message_end", (event) => {
    const assistant = assistantContentMessage(event.message);
    if (!assistant) return;
    if (whitespaceCharCount > 0) {
      onLeadingWhitespaceObserved?.({
        deltaCount: whitespaceDeltaCount,
        charCount: whitespaceCharCount,
      });
    }
    const stopReason = (assistant as { stopReason?: unknown }).stopReason;
    if (stopReason === "error" || stopReason === "aborted") {
      // A terminal provider failure is not a player-visible assistant final.
      // Sending its empty/error payload through the settlement gate creates a
      // hidden follow-up model call and can turn one non-retryable provider
      // error into an unbounded host loop.
      resetWhitespaceWatch();
      return { message: withoutAssistantText(event.message) };
    }
    if (!assistant.content.some((part) => part.type === "toolCall")) {
      const visibleText = visibleAssistantText(assistant) ?? "";
      if (
        visibleText.trim().length === 0
        && allowEmptyFinalReplacement?.() !== true
      ) {
        // Thinking-only and empty tool-free terminals carry no player output
        // to settle. In particular, they must not arm a finalization
        // follow-up — but the host gets the empty-terminal callback so one
        // bounded same-epoch recovery can answer a swallowed external
        // player turn without duplicating the player's message.
        onEmptyAssistantFinal?.();
        resetWhitespaceWatch();
        return { message: withoutAssistantText(event.message) };
      }
      {
        const decision = onVisibleAssistantFinal?.(visibleText);
        if (decision === false) {
          resetWhitespaceWatch();
          return { message: withoutAssistantText(event.message) };
        }
        if (
          decision
          && typeof decision === "object"
          && typeof decision.replacementText === "string"
        ) {
          resetWhitespaceWatch();
          return {
            message: withExactAssistantText(
              event.message,
              decision.replacementText,
            ),
          };
        }
      }
      resetWhitespaceWatch();
      return;
    }
    resetWhitespaceWatch();
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
            sendCocSystemInstruction(pi, {
              sourceType: "coc-source-coordinator-terminal-continuation",
              customType: "coc-source-coordinator-terminal-continuation",
              instruction: (
                "Consume this exact terminal dependency receipt through its "
                + "documented continuation; it is host control, not player input."
              ),
              context: notice,
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
    const customType = envelope.kind === "settled_output_gate"
      ? SETTLED_OUTPUT_GATE_CUSTOM_TYPE
      : MECHANICAL_OUTPUT_GATE_CUSTOM_TYPE;
    sendCocSystemInstruction(pi, {
      sourceType: customType,
      customType,
      instruction: typeof envelope.instruction === "string"
        ? envelope.instruction
        : "Complete only the missing settled-output work from existing receipts.",
      context: envelope,
    }, { triggerTurn: true, deliverAs: "followUp" });
    return true;
  } catch {
    return false;
  }
}

export function deliverPreInferenceFinalizationSteer(
  pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage">,
  envelope: JsonObject | null,
): boolean {
  if (envelope === null) return false;
  try {
    pi.appendEntry("coc-settled-output-preflight", envelope);
  } catch { /* preflight audit is best effort */ }
  try {
    sendCocSystemInstruction(pi, {
      sourceType: SETTLED_OUTPUT_PREFLIGHT_CUSTOM_TYPE,
      customType: SETTLED_OUTPUT_PREFLIGHT_CUSTOM_TYPE,
      instruction: typeof envelope.instruction === "string"
        ? envelope.instruction
        : "Begin this player turn with the required canonical grounding.",
      context: envelope,
    }, { deliverAs: "steer" });
    return true;
  } catch {
    return false;
  }
}

export const EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE = (
  "coc-empty-terminal-recovery"
);

export function buildEmptyTerminalRecoveryInstruction(
  finalizationRequired: boolean,
): string {
  return (
    "你的上一条终态是 provider 成功返回但零可见正文、零工具调用（只有推理），"
    + "当前外部玩家输入仍未获得玩家可见回答。"
    + "不要重发、复述或改写玩家消息——它已在对话中恰好一次，不得重复。"
    + "本回合的规则与状态写入可能已部分或全部完成：先盘点本回合已有的权威收据"
    + "（roll_id／decision_id）与已落账状态；凡已由收据或状态体现的规则、状态、"
    + "工具调用一律不得重跑、重放或改写，只补做确实缺失的部分。"
    + (finalizationRequired
      ? "若尚缺结算边界，按本回合已武装的 settled-output 契约补齐缺失的 canonical "
        + "步骤与 turn.finalize，最后只输出 turn.finalize 返回的 rendered_text。"
      : "然后像正常 KP 回合一样给出玩家可见回答。")
  );
}

export function deliverEmptyTerminalRecovery(
  pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage">,
  envelope: JsonObject,
  instruction: string,
): boolean {
  try {
    sendCocSystemInstruction(pi, {
      sourceType: EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE,
      customType: EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE,
      instruction,
      context: envelope,
    }, { triggerTurn: true, deliverAs: "followUp" });
  } catch {
    // No scheduled marker may exist without a sent follow-up: the RPC
    // driver's in-flight wait counts only the scheduled marker, so a
    // failed send must not look like a pending recovery turn. Audit the
    // failure under a distinct marker the driver ignores.
    try {
      pi.appendEntry(
        "coc-empty-terminal-recovery-delivery-failed",
        envelope,
      );
    } catch { /* delivery-failure audit is best effort */ }
    return false;
  }
  try {
    pi.appendEntry(EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE, envelope);
  } catch { /* recovery audit is best effort */ }
  return true;
}

export function deliverPendingPreInferenceFinalizationSteer(
  pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage">,
  gate: OpeningTerminalContinuationGate,
  requireFinalization: boolean,
): "not_required" | "delivered" | "failed" {
  const envelope = gate.takePreInferenceFinalizationSteer(
    requireFinalization,
  );
  if (envelope === null) return "not_required";
  if (!deliverPreInferenceFinalizationSteer(pi, envelope)) return "failed";
  return gate.markPreInferenceFinalizationSteerDelivered(envelope)
    ? "delivered"
    : "failed";
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
      instruction:
        "Call next_operation.invoke_via exactly with next_operation.arguments now. "
        + "Do not emit player-visible text or begin character creation until that tool returns ok.",
      next_operation: {
        operation: "setup.adopt_source_facts",
        invoke_via: "coc_setup_adopt_source_facts",
        arguments: {
          campaign_id: receipt.campaign_id,
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
        // Required array; empty is valid when this selected window has no
        // extractable image. Each row binds exact bytes to one selected page.
        assets: [{
          path: "<bundle-relative PNG, JPEG, or WebP path>",
          sha256: "<sha256 of exact image bytes>",
          pdf_index: "<selected zero-based PDF index containing this image>",
        }],
      },
      assets_may_be_empty: true,
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

/**
 * Semantic finalize evidence → one scheduled memory-extraction worker.
 * Scheduling is fire-and-forget: the returned promise settles when the
 * background worker settles and is never awaited by the player path.
 */
export function autoDispatchPiMemoryExtraction(
  dispatcher: MemoryExtractionDispatcher,
  params: JsonObject,
  value: unknown,
  isCurrent: () => boolean,
): Promise<unknown> {
  const campaignId = typeof params.campaign === "string"
    ? params.campaign.trim()
    : "";
  if (!campaignId || params.operation !== "turn.finalize" || !isCurrent()) {
    return Promise.resolve(null);
  }
  const envelope = objectOrNull(value);
  if (envelope?.ok !== true) return Promise.resolve(null);
  const data = objectOrNull(envelope.data);
  const extraction = objectOrNull(data?.memory_extraction);
  if (extraction === null) return Promise.resolve(null);
  const turn = extraction.turn_number;
  if (
    typeof extraction.job_id !== "string"
    || typeof extraction.episode_id !== "string"
    || typeof extraction.backlog_id !== "string"
    || typeof extraction.timeline_id !== "string"
    || typeof turn !== "number"
    || !Number.isInteger(turn)
    || turn < 1
  ) {
    return Promise.resolve(null);
  }
  const refs: MemoryExtractionRefs = {
    campaign_id: campaignId,
    job_id: extraction.job_id,
    episode_id: extraction.episode_id,
    timeline_id: extraction.timeline_id,
    turn_number: turn,
    backlog_id: extraction.backlog_id,
  };
  return dispatcher.schedule(refs);
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
  launchMemoryExtractor?: (
    task: JsonObject,
    context: PrivateLaunchContext,
    signal?: AbortSignal,
  ) => ChildRun;
  runMemoryHostBridge?: (
    request: MemoryHostBridgeRequest,
  ) => Promise<JsonObject>;
  createStateClaimCompiler?: () => PiStateClaimCompiler;
  /**
   * Test seam: supply (a wrapper around) the semantic identity registry
   * factory so regressions can spy on every registry access. Production
   * never passes it — the canonical factory is used.
   */
  createSemanticIdentityRegistry?: () => SemanticIdentityRegistry;
  dispatchDebugExperiment?: (
    command: string,
    context: DebugExperimentHostContext,
  ) => Promise<DebugExperimentReceipt>;
  hostHydrationObserverCheckpoint?: (
    stage: "compiler" | "binding" | "progress",
  ) => void;
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

export type StartupRecoveryThinkingProjection = {
  apply(messages: readonly unknown[], startupGateActive: boolean): unknown[];
};

/**
 * Pi keeps provider thinking blocks in its durable linear transcript. Keep
 * that evidence untouched, but remove reasoning that canonical startup
 * recovery has superseded from subsequent model requests. The boundary is
 * monotonic for this host context: before the first resume call the explicit
 * startup gate supersedes the entire prior session tail; afterwards an exact
 * canonical session.resume receipt advances (never rewinds) the boundary.
 */
export function createStartupRecoveryThinkingProjection(): StartupRecoveryThinkingProjection {
  let boundary = 0;

  const canonicalResumeReceipt = (message: unknown): boolean => {
    const row = objectOrNull(message);
    if (row?.role !== "toolResult") return false;
    const content = row.content;
    const first = Array.isArray(content) ? objectOrNull(content[0]) : null;
    const text = typeof content === "string"
      ? content
      : typeof first?.text === "string" ? first.text : "";
    if (!text.startsWith("{")) return false;
    let envelope: JsonObject | null = null;
    try {
      envelope = objectOrNull(JSON.parse(text));
    } catch {
      return false;
    }
    if (envelope?.tool !== "session.resume") return false;
    if (envelope.ok === true) {
      const data = objectOrNull(envelope.data);
      return (
        data?.schema_version === 1
        && typeof data.campaign_id === "string"
        && data.campaign_id.length > 0
        && typeof data.mode === "string"
        && data.mode.length > 0
      );
    }
    const error = objectOrNull(envelope.error);
    return envelope.ok === false
      && typeof error?.code === "string"
      && error.code.length > 0;
  };

  const withoutThinking = (message: unknown): unknown => {
    const row = objectOrNull(message);
    if (row === null || !Array.isArray(row.content)) return message;
    const content = row.content.filter(
      (part) => objectOrNull(part)?.type !== "thinking",
    );
    if (content.length === row.content.length) return message;
    return { ...row, content };
  };

  return {
    apply(messages, startupGateActive) {
      if (!Array.isArray(messages)) return messages as unknown[];
      let receiptBoundary = 0;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (canonicalResumeReceipt(messages[index])) {
          receiptBoundary = index + 1;
          break;
        }
      }
      boundary = Math.max(
        boundary,
        startupGateActive ? messages.length : receiptBoundary,
      );
      if (boundary === 0) return messages as unknown[];
      return messages.map((message, index) => (
        index < boundary ? withoutThinking(message) : message
      ));
    },
  };
}

export function turnFinalizationRequiredForPhase(phase: PlayPhase): boolean {
  return phase === "live_turn" || phase === "pending_finalization" || phase === "ending";
}

export function endingOutputFromReceipt(
  args: JsonObject,
  data: JsonObject | null,
): { renderedText: string; renderedSha256: string } | null {
  void args;
  const resumed = objectOrNull(data?.ending_output);
  if (!(data?.mode === "ending" && resumed !== null)) return null;
  const renderedText = typeof resumed.rendered_text === "string"
    ? resumed.rendered_text
    : "";
  const renderedSha256 = typeof resumed.rendered_sha256 === "string"
    ? resumed.rendered_sha256
    : "";
  if (!renderedText || !renderedSha256) return null;
  return {
    renderedText,
    renderedSha256,
  };
}

type StartupResumeGate = {
  origin: "startup_selector" | "role_null_handoff";
  campaignId: string;
  workspaceRoot: string;
  phase: "pending" | "terminal_failure";
  failureClass: string | null;
  blockerDelivery: "pending" | "sending" | "delivered" | "exhausted";
  blockerDeliveryAttempts: number;
  hiddenRepromptDelivery: "pending" | "sending" | "delivered";
};

// A successful silent settled startup resume (already_acknowledged /
// awaiting_player) acknowledges existing table state; it is not a new player
// turn. The remainder of the auto-open agent turn that performed the resume
// must not journal, re-resume, call rules/state, or replay prose/history, so
// the host quarantines that same agent turn until its agent_end.
type StartupSilentResumeQuarantine = {
  campaignId: string;
  mode: "already_acknowledged" | "awaiting_player";
};

// Exact-delivery replay quarantine for the current player input: while it is
// armed, the host replay stream owns the visible output — model-authored
// prose is suppressed and state/rules/journal/narration.review/turn.finalize
// calls are rejected until the replaying agent turn ends.
type DeliveryReplayQuarantine = { campaignId: string };

export default function mainExtension(pi: ExtensionAPI, overrides: MainExtensionOverrides = {}) {
  const debugExperimentHost = createDebugExperimentHost();
  let mcp: McpJsonlClient | null = null;
  let turnTelemetry: TurnTelemetry | null = null;
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
  // Idle-boundary source takeover bookkeeping: one bounded background
  // coordinator dispatch per agent_end when pending host work is claimable.
  let idleTakeoverAttempts = new Map<string, number>();
  let idleTakeoverBusy = false;
  let idleTakeoverContext: ExtensionContext | null = null;
  let startupResumeGate: StartupResumeGate | null = null;
  let startupSilentResumeQuarantine: StartupSilentResumeQuarantine | null = null;
  let deliveryReplayQuarantine: DeliveryReplayQuarantine | null = null;
  // Startup-only fact from the persistent session branch (read once in
  // initializeSession): the branch ends with a real unmatched external
  // player turn. While true, a silent settled startup resume
  // (already_acknowledged / awaiting_player) must not arm the same-turn
  // quarantine — the auto-open agent has to finish that existing player
  // epoch with the normal tool/output/empty-final surface instead of
  // orphaning the input behind a resend. Consumed after the one startup
  // resume classification; recomputed on initialize, cleared on shutdown.
  let startupBranchTrailingPlayerUser = false;
  const launcherRole = sessionRoleFromEnv();
  // `launcherRole` is `play` or null now: the setup role is retired and
  // `sessionRoleFromEnv` refuses it. Null is the bare legacy launch with no
  // campaign, which the table treats as play.
  let effectiveTypedRole: SessionRole = launcherRole ?? "play";
  const openingContinuationGate = new OpeningTerminalContinuationGate();
  const nonRetryableFailureCircuit = new NonRetryableFailureCircuit();
  const stateClaimCompiler = (
    overrides.createStateClaimCompiler?.() ?? new PiStateClaimCompiler()
  );
  const supplyCoordinator = new PiSemanticSupplyCoordinator();
  let memoryExtractionRuns = new Set<Promise<unknown>>();
  const memoryExtractionDispatcher = new MemoryExtractionDispatcher();
  // One successful, model-projectable session.resume may re-arm the durable
  // extraction backlog once for this campaign/session epoch. Startup itself
  // is deliberately absent from this boundary: for a continuing campaign the
  // resume receipt must remain the first canonical campaign operation.
  let memoryExtractionRearmedCampaigns = new Set<string>();
  const sceneSupplyDispatches = new Map<string, SceneSupplyDispatchStatus>();
  let kpPlayPhase: PlayPhase = "live_turn";
  let currentWorkspaceRoot = "";
  let currentHostSessionId = "";
  let canonicalProgressCampaignId = "";
  let currentOpenTurnAnchor: {
    campaignId: string;
    anchor: OpenTurnAnchor;
  } | null = null;
  let journaledOpenTurnAnchor: {
    campaignId: string;
    anchor: OpenTurnAnchor;
    turnNumber: number;
  } | null = null;
  // The live player message for the current turn, kept in memory regardless of
  // phase. A restart leaves the durable open-turn input cache empty for the
  // first message of the new process (no anchor existed when it arrived), and
  // recovery cannot exit without that input: the journal it requires is denied,
  // so the campaign stays in `recovery` forever. Holding the message here lets
  // the resume path adopt what the player just said instead of stranding the
  // table on a turn nobody can reconstruct.
  let livePlayerMessageForOpenTurn: {
    campaignId: string;
    text: string;
    playerTurnEpoch: number;
  } | null = null;
  let openTurnRecoveryAuthorization: {
    campaignId: string;
    sessionEpoch: number;
    playerTurnEpoch: number;
    anchorDigest: string;
  } | null = null;
  // One host-owned live hydration attempt per strict pending identity:
  // campaign + pending turn/source identity (an identity-less marker for
  // pointer-only resumes) + player epoch + session generation. Concurrent
  // resume handling shares the in-flight fetch; both success and failure
  // outcomes are cached so repeated handling of the same unresolved pending
  // identity never refetches. A changed identity, session reset, or new
  // player epoch replaces the attempt. Identity-less resumes can never
  // wildcard-reuse an identified attempt and vice versa.
  let pendingFinalizationHydrationState: {
    campaign: string;
    pendingKey: string;
    playerTurnEpoch: number;
    sessionEpoch: number;
    inFlight: Promise<PendingFinalizationHydration> | null;
    outcome:
      | { status: "success"; cards: LiveOutputContextCards }
      | { status: "unavailable" }
      | null;
  } | null = null;
  // Failed `turn.finalize` draft-shape recovery cards, keyed by campaign.
  // Built from the exact failed call plus the retained frozen-turn
  // identities, persisted as a `coc-draft-shape-recovery-card` session entry
  // (survives a process restart on the same session file), and re-presented
  // on an already-acknowledged resume while the preserved pending turn
  // remains. Cleared with the session's own in-memory turn state; a fresh
  // session re-reads the persisted entry instead of inventing one.
  const draftShapeRecoveryCards = new Map<string, JsonObject>();
  // Boot-unique namespace element for machine-generated decision ids. The
  // campaign's durable idempotency ledger outlives this process, and
  // playerTurnEpoch restarts from 0 on every boot — so ids composed without
  // a fresh salt would replay exactly what a previous boot already consumed,
  // wedging state.journal/narration.review into permanent idempotency
  // conflicts after any host restart.
  const HOST_BOOT_SALT = createHash("sha256")
    .update(`${process.pid}:${Date.now()}:${performance.timeOrigin}`)
    .digest("hex")
    .slice(0, 8);
  let canonicalProgress: CanonicalTurnProgress = {
    playerTurnEpoch: 0,
    canonicalProgressRevision: 0,
    stage: "awaiting_player",
    campaignRevision: null,
    journalRevision: null,
    reviewRevision: null,
    finalizedRenderedSha256: null,
    closedObligationCount: 0,
  };
  let loadedNamespaces: LoadedNamespace[] = [];
  let loadedOperations: LoadedExactOperation[] = [];
  let lastWorkingSet: ToolWorkingSet | null = null;
  type ActiveToolWorkingSetFingerprint = {
    digest: string;
    workingSetRevision: string | null;
  };
  const toolWorkingSetAtExecutionStart = new Map<
    string,
    ActiveToolWorkingSetFingerprint
  >();
  /**
   * Fingerprint the exact model-visible active tool interface. This is the
   * single runtime seam for deciding whether a completed tool invalidated the
   * remaining calls in the model's current batch. The digest is host-only;
   * models never copy or emit it.
   */
  const activeToolWorkingSetRevision = (): ActiveToolWorkingSetFingerprint | null => {
    try {
      const activeNames = [...new Set(pi.getActiveTools())].sort();
      const definitions = new Map(
        pi.getAllTools().map((tool) => [tool.name, tool]),
      );
      const activeDefinitions = activeNames.map((name) => {
        const definition = definitions.get(name);
        if (definition === undefined) {
          throw new Error(`active tool ${name} is not registered`);
        }
        return {
          name,
          description: definition.description,
          parameters: definition.parameters,
          promptGuidelines: definition.promptGuidelines,
        };
      });
      return {
        digest: createHash("sha256")
          .update(JSON.stringify({
            projected_revision: lastWorkingSet?.revision ?? null,
            player_turn_epoch: canonicalProgress.playerTurnEpoch,
            canonical_progress_revision:
              canonicalProgress.canonicalProgressRevision,
            stage: canonicalProgress.stage,
            active_tools: activeDefinitions,
          }), "utf8")
          .digest("hex"),
        workingSetRevision: lastWorkingSet?.revision ?? null,
      };
    } catch {
      return null;
    }
  };
  pi.on("tool_execution_start", (event: unknown) => {
    const typed = event as { toolCallId?: unknown } | undefined;
    const toolCallId = typeof typed?.toolCallId === "string"
      ? typed.toolCallId
      : "";
    if (!toolCallId) return;
    const fingerprint = activeToolWorkingSetRevision();
    if (fingerprint !== null) {
      toolWorkingSetAtExecutionStart.set(toolCallId, fingerprint);
    }
  });
  pi.on("tool_result", (event: unknown) => {
    const typed = event as {
      toolCallId?: unknown;
      toolName?: unknown;
      input?: unknown;
    } | undefined;
    const toolCallId = typeof typed?.toolCallId === "string"
      ? typed.toolCallId
      : "";
    if (!toolCallId) return undefined;
    const before = toolWorkingSetAtExecutionStart.get(toolCallId) ?? null;
    toolWorkingSetAtExecutionStart.delete(toolCallId);
    const after = activeToolWorkingSetRevision();
    if (
      before === null
      || after === null
      || before.digest === after.digest
    ) return undefined;
    const input = objectOrNull(typed?.input);
    try {
      pi.appendEntry("coc-tool-working-set-replan", {
        schema_version: 1,
        contract_id: "coc.pi-tool-working-set-replan.v1",
        status: "requested",
        reason: "active_tool_interface_changed",
        ...(typeof typed?.toolName === "string"
          ? { tool_name: typed.toolName }
          : {}),
        ...(typeof input?.operation === "string"
          ? { operation: input.operation }
          : {}),
        stage: canonicalProgress.stage,
        player_turn_epoch: canonicalProgress.playerTurnEpoch,
        canonical_progress_revision:
          canonicalProgress.canonicalProgressRevision,
        before: {
          working_set_revision: before.workingSetRevision,
          active_tool_interface_sha256: `sha256:${before.digest}`,
        },
        after: {
          working_set_revision: after.workingSetRevision,
          active_tool_interface_sha256: `sha256:${after.digest}`,
        },
      });
    } catch { /* replan audit is host-only and best effort */ }
    return { replan: true };
  });
  pi.on("tool_execution_end", (event: unknown) => {
    const typed = event as { toolCallId?: unknown } | undefined;
    if (typeof typed?.toolCallId === "string") {
      // Immediate validation/block failures do not enter the tool_result hook.
      toolWorkingSetAtExecutionStart.delete(typed.toolCallId);
    }
  });
  let operatorSystemInstructionScope: {
    sourceType: "operator_command";
    playerTurnEpoch: number;
  } | null = null;
  const typedToolCatalog = defaultTypedToolCatalog();
  const typedToolDefinitions = listTypedOperationTools(typedToolCatalog);
  const typedToolByOperation = new Map(
    typedToolDefinitions.map((tool) => [tool.operation, tool]),
  );
  const typedOperationNeedsCampaign = (operation: string): boolean => {
    const inputSchema = typedToolCatalog.contracts.operations.get(operation)?.inputSchema;
    const properties = objectOrNull(inputSchema?.properties);
    return properties !== null && Object.hasOwn(properties, "campaign");
  };
  // `decision_id` is declared host-owned for state.move_scene and
  // state.advance_time, so neither model schema shows it — but the canonical
  // operations require one. Without a host-supplied value the Keeper fails
  // the write with missing_param, retries identically, is repeat-blocked,
  // and narrates a transition that never landed: fiction and authoritative
  // scene diverge, which is the one outcome the state contract exists to
  // prevent. Observed on a live table (2026-09-01) and once before it. The
  // move key names the destination so two different moves in one turn stay
  // distinct while a repeated identical move stays idempotent. Supplied on
  // BOTH the typed and generic invoke surfaces, only after raw model
  // validation, so model input is never confused with host provenance.
  const hostSceneWriteDecisionId = (
    operation: string,
    args: JsonObject,
  ): string | null => {
    if (Object.hasOwn(args, "decision_id")) return null;
    if (operation === "state.move_scene") {
      const destination = typeof args.scene_id === "string" && args.scene_id.trim()
        ? args.scene_id.trim()
        : typeof args.candidate_id === "string" && args.candidate_id.trim()
          ? args.candidate_id.trim()
          : "scene";
      return semanticDecisionId(`state.move_scene:${destination}`);
    }
    if (operation === "state.advance_time") {
      return semanticDecisionId("state.advance_time");
    }
    return null;
  };
  const retainedTypedBindings = new Map<string, TypedToolBindingCard>();
  /**
   * Retained host provenance pledges (see host-provenance-pledges.ts):
   * never-model-authored required arguments the host attaches by provenance
   * after raw validation. Keyed `campaign\u0000consumerOperation`; the last
   * accepted producer wins, and a committed consumer clears its own row.
   */
  const retainedHostPledges = new Map<string, string>();
  const hostPledgeKey = (campaign: string, consumer: string): string =>
    `${campaign}\u0000${consumer}`;
  const currentTypedBindingFactories = new Map<
    string,
    () => CurrentTypedToolHostContext | null
  >();
  const revokedSceneBindingOperations = new Set<string>();
  let refreshTypedToolDefinition = (_operation: string): void => {};
  let hostHydrationObservationTransaction: {
    audits: Array<{ name: string; value: JsonObject }>;
    bindingRefreshes: Set<string>;
    reprojectTools: boolean;
  } | null = null;
  const appendObservationAudit = (name: string, value: JsonObject): void => {
    if (hostHydrationObservationTransaction !== null) {
      hostHydrationObservationTransaction.audits.push({ name, value });
      return;
    }
    pi.appendEntry(name, value);
  };
  let retainedOutputContextFacts: {
    root: string;
    campaign: string;
    turnId: string;
    sourceDigest: string;
    revision: number;
    journalDecisionId: string;
    finalizeDecisionId: string | null;
    narrationReviewId: string | null;
    playerInputSourceRef: string;
    agencyAuthority: JsonObject;
    controlOverrides: JsonObject[];
    coverageBindingFacts: ReviewedCoverageBindingFacts;
    reviewedAgencyBinding: ReviewedAgencyBinding | null;
    directGenericFinalize: boolean;
    directTypedFinalize: boolean;
  } | null = null;
  // Exact canonical entity identities retained from observed envelopes so the
  // model can use semantic handles (current-investigator / pc:current-
  // investigator / player_input:current / advisory handles) and the host
  // restores exact identity before transport. Never model-visible.
  // Investigator authority state is owned by the semantic identity registry
  // (`applyPartyAuthority` / `currentParty`): session/campaign-scoped with an
  // EXPLICIT authority state — `single` binds one current PC; `empty`/
  // `ambiguous` are authoritative invalidations of any prior identity for the
  // same epoch+campaign. The state survives ordinary player messages and is
  // replaced only by a newer authoritative observation, a session-epoch
  // reset, or a campaign change.
  // Turn-scoped facts (current player-input source ref, current advisory
  // uptake identities): re-armed each settle phase and cleared with the turn.
  let retainedTurnEntityFacts: {
    playerInputSourceRef: string | null;
    advisoryAdviceId: string | null;
    advisoryCandidateRef: string | null;
  } = {
    playerInputSourceRef: null,
    advisoryAdviceId: null,
    advisoryCandidateRef: null,
  };
  // THE semantic identity registry: one typed owner of the canonical↔handle
  // mappings for rolls, effects, items/weapons, and routes. Handles derive
  // ONLY from structured observation facts; registration is one-to-one and
  // collision-safe (stable ordinals, never overwrite, never `roll-N`);
  // lifetimes are authoritative (player-turn, party, persistent-effect, and
  // snapshot domains) and every projection/resolution is judged against the
  // exact invocation session epoch + campaign (+ player turn for turn-scoped
  // records).
  const semanticRegistry = overrides.createSemanticIdentityRegistry?.()
    ?? createSemanticIdentityRegistry();
  const registryScope = (invocationCampaign: string): SemanticIdentityScope => ({
    sessionEpoch,
    campaign: invocationCampaign,
    playerTurnEpoch: canonicalProgress.playerTurnEpoch,
  });
  // Authoritative owner/container scope derived from one structured object
  // (a canonical result's data, or the invocation's own model arguments):
  // an NPC field keys the npc holder, an investigator field the investigator
  // holder, an active scene the route container. Same canonical ids or
  // handles under two owners are never judged through a global view.
  const inventoryOwnerKeyOf = (
    source: Record<string, unknown> | null,
  ): string | null => {
    if (source === null) return null;
    const npcId = typeof source.npc_id === "string" && source.npc_id.trim()
      ? source.npc_id.trim()
      : "";
    if (npcId) return `inventory:npc:${npcId}`;
    const investigatorId = typeof source.investigator_id === "string"
      && source.investigator_id.trim()
      ? source.investigator_id.trim()
      : "";
    if (investigatorId) return `inventory:investigator:${investigatorId}`;
    return null;
  };
  const sceneOwnerKeyOf = (
    source: Record<string, unknown> | null,
  ): string | null => {
    if (source === null) return null;
    const activeSceneId = typeof source.active_scene_id === "string"
      && source.active_scene_id.trim()
      ? source.active_scene_id.trim()
      : "";
    return activeSceneId ? `scene:${activeSceneId}` : null;
  };
  const scopedRegistryScope = (
    invocationCampaign: string,
    source: Record<string, unknown> | null,
  ): SemanticIdentityScope => {
    const base = registryScope(invocationCampaign);
    const ownerKey = inventoryOwnerKeyOf(source);
    const sceneOwnerKey = sceneOwnerKeyOf(source);
    return {
      ...base,
      ...(ownerKey !== null ? { ownerKey } : {}),
      ...(sceneOwnerKey !== null ? { sceneOwnerKey } : {}),
    };
  };
  // Live registry projection for one invocation; empty campaign → boundary
  // projection (nothing is live, so canonical ids drop instead of leaking).
  // Snapshot domains project within the authoritative owner/container scope
  // of the observed result; ambiguous (owner-less, multi-owner) identities
  // fail closed instead of collapsing to an arbitrary owner.
  const liveSemanticIdMap = (
    invocationCampaign: string,
    resultData: Record<string, unknown> | null = null,
  ): SemanticIdMap =>
    semanticRegistry.projectAll(scopedRegistryScope(invocationCampaign, resultData));
  const semanticObligationRefsFor = (
    facts: ReviewedCoverageBindingFacts,
    invocationCampaign: string,
  ): Array<{ obligation_id: string; obligation_ref: string }> | null => {
    const projected = liveSemanticIdMap(invocationCampaign);
    const refs = facts.obligations.flatMap((row) => {
      const obligationId = typeof row.obligation_id === "string"
        ? row.obligation_id
        : "";
      const canonical = obligationId.startsWith("roll:")
        ? obligationId.slice("roll:".length)
        : obligationId;
      const obligationRef = projected.rolls.get(canonical);
      return obligationId && obligationRef
        ? [{ obligation_id: obligationId, obligation_ref: obligationRef }]
        : [];
    });
    return refs.length === facts.obligations.length ? refs : null;
  };
  const liveSemanticResolver = (
    invocationCampaign: string,
    invocationArguments: Record<string, unknown> | null = null,
  ): SemanticIdentityHandleResolver | null => {
    if (!invocationCampaign) return null;
    const scope = scopedRegistryScope(invocationCampaign, invocationArguments);
    const resolve = (
      domain:
        | "roll" | "effect" | "item" | "weapon" | "route" | "affordance"
        | "transcript",
      handle: string,
    ): string | null => {
      const result = semanticRegistry.resolveHandle(domain, handle, scope);
      return result.ok ? result.canonicalId : null;
    };
    // The registry knows WHY a handle did not resolve. Saying "refresh the
    // turn context" for all seven causes is wrong for most of them: a refresh
    // does not transfer ownership, un-consume an effect, or move a handle
    // between campaigns. Each message names the real cause and only promises a
    // refresh where a refresh is genuinely the route out.
    const failureReason = (
      domain:
        | "roll" | "effect" | "item" | "weapon" | "route" | "affordance"
        | "transcript",
      handle: string,
    ): string | null => {
      const result = semanticRegistry.resolveHandle(domain, handle, scope);
      if (result.ok) return null;
      switch (result.reason) {
        case "stale_turn":
          return `this ${domain} handle was issued in an earlier player turn; `
            + "refresh the current turn context and use the handle it presents.";
        case "stale_session":
          return `this ${domain} handle belongs to an earlier session; `
            + "refresh the current turn context and use the handle it presents.";
        case "campaign_mismatch":
          return `this ${domain} handle belongs to a different campaign.`;
        case "owner_mismatch":
          return `this ${domain} handle is held by a different owner; use the `
            + "handle presented for the owner you are acting on.";
        case "ambiguous_owner":
          return `two owners hold this ${domain} handle; name the owner `
            + "explicitly so the host can bind the right one.";
        case "invalidated":
          return `this ${domain} handle was consumed or retired and cannot be `
            + "referenced again.";
        case "unknown_handle":
          return `no ${domain} handle by that name was ever presented this `
            + "turn; copy one verbatim from the current turn context.";
        default:
          return null;
      }
    };
    return {
      resolveRoll: (handle) => resolve("roll", handle),
      resolveEffect: (handle) => resolve("effect", handle),
      resolveItem: (handle) => resolve("item", handle),
      resolveWeapon: (handle) => resolve("weapon", handle),
      resolveRoute: (handle) => resolve("route", handle),
      resolveAffordance: (handle) => resolve("affordance", handle),
      resolveTranscript: (handle) => resolve("transcript", handle),
      describeFailure: failureReason,
    };
  };
  const clearTurnEntityFacts = (): void => {
    retainedTurnEntityFacts = {
      playerInputSourceRef: null,
      advisoryAdviceId: null,
      advisoryCandidateRef: null,
    };
  };
  // Effective facts for one restore: identity must be in the `single` state
  // and belong to the live session epoch and the EXACT campaign of the
  // current invocation — never a previous global campaign. An absent,
  // ambiguous, or differing campaign leaves no authorized identity, so
  // restoration fails closed instead of leaking.
  const effectiveSemanticEntityFacts = (
    invocationCampaign: string,
  ): SemanticEntityFacts => {
    // Identity must be in the `single` state and belong to the live session
    // epoch and the EXACT campaign of the current invocation — never a
    // previous global campaign. An absent, ambiguous, empty, or differing
    // campaign leaves no authorized identity, so restoration fails closed
    // instead of leaking.
    if (!invocationCampaign) {
      return {
        investigatorId: null,
        pcSubjectRefs: [],
        playerInputSourceRef: null,
        advisoryAdviceId: null,
        advisoryCandidateRef: null,
      };
    }
    const party = semanticRegistry.currentParty(registryScope(invocationCampaign));
    const identityLive = party.live && party.state === "single";
    return {
      investigatorId: identityLive ? party.investigatorId : null,
      pcSubjectRefs: identityLive ? party.pcSubjectRefs : [],
      playerInputSourceRef: retainedTurnEntityFacts.playerInputSourceRef,
      advisoryAdviceId: retainedTurnEntityFacts.advisoryAdviceId,
      advisoryCandidateRef: retainedTurnEntityFacts.advisoryCandidateRef,
    };
  };
  type StructuredBindingScope = {
    sessionEpoch: number;
    playerTurnEpoch: number;
    stage: CanonicalTurnProgress["stage"];
    phase: PlayPhase;
  };
  type SceneBindingFacts = StructuredBindingScope & {
    root: string;
    campaign: string;
    sourceRevision: string;
    sourceDigest: string;
    activeSceneId: string;
    sceneSelectionMode: "current_candidates" | "manual_scene";
    sceneCandidates: Array<{
      candidate_id: string;
      scene_id: string;
      travel_minutes?: number;
    }>;
    clockPrecision: "precise" | "imprecise";
    npcIds: string[];
    combatAffordanceIds: string[];
  };
  type CombatBindingFacts = StructuredBindingScope & {
    root: string;
    campaign: string;
    combatRevision: string;
    combatDigest: string;
    candidates: Array<
      | {
        candidate_id: string;
        invocation_mode: "target_npc_id";
        target_npc_id: string;
      }
      | {
        candidate_id: string;
        invocation_mode: "affordance_id";
        affordance_id: string;
      }
      | {
        candidate_id: string;
        invocation_mode: "pending_defense";
        allowed_defenses: Array<"dodge" | "fight_back" | "dive_for_cover" | "none">;
      }
    >;
  };
  type ChaseBindingFacts = StructuredBindingScope & {
    root: string;
    campaign: string;
    chaseId: string;
    chaseRevision: number;
    chaseDigest: string;
    investigatorId: string;
    decisionId: string;
    candidates: ChaseActionCandidate[];
  };
  type NpcInteractionBindingFacts = StructuredBindingScope & {
    root: string;
    campaign: string;
    sourceRevision: string;
    sourceDigest: string;
    candidates: Array<{
      investigator: string;
      npcId: string;
      factRefs: string[];
      firstImpressionRef?: string;
    }>;
  };
  type SanityBoutBindingFacts = StructuredBindingScope & {
    root: string;
    campaign: string;
    investigatorId: string;
    boutId: string;
    choiceId: string;
    sourceCommandId: string;
    choiceRevision: number;
    actions: Array<"tick" | "end">;
  };
  let currentSceneBindingFacts: SceneBindingFacts | null = null;
  let retainedSceneAffordanceOperations: string[] = [];
  let currentCombatBindingFacts: CombatBindingFacts | null = null;
  let currentChaseBindingFacts: ChaseBindingFacts | null = null;
  let currentSanityBoutBindingFacts: SanityBoutBindingFacts | null = null;
  let currentNpcInteractionBindingFacts: NpcInteractionBindingFacts | null = null;
  let lastHealingCardProjection: {
    playerTurnEpoch: number;
    projection: JsonObject;
  } | null = null;
  let faultRecoveryOperation: string | null = null;
  let noSelectorQuickStartRecovery: {
    params: JsonObject;
    retriesRemaining: number;
  } | null = null;
  let applyKpActiveTools = (): void => {};
  let terminalizeTurnProcessingFault = (
    _fault: JsonObject,
    _options: { deliver?: boolean; reprojectTools?: boolean } = {},
  ): JsonObject => _fault;

  const clearTypedBinding = (operation: string): void => {
    const existed = retainedTypedBindings.delete(operation);
    currentTypedBindingFactories.delete(operation);
    if (existed) refreshTypedToolDefinition(operation);
  };
  const beginSceneDerivedBindingReplacement = (): void => {
    currentSceneBindingFacts = null;
    currentCombatBindingFacts = null;
    currentChaseBindingFacts = null;
    lastHealingCardProjection = null;
    retainedSceneAffordanceOperations = [];
    for (const operation of [
      "state.move_scene", "state.advance_time", "combat.resolve",
      "rules.social_adjudicate", "rules.psychology_observe",
    ]) {
      revokedSceneBindingOperations.add(operation);
      retainedTypedBindings.delete(operation);
      currentTypedBindingFactories.delete(operation);
    }
  };
  const revokeSceneDerivedBindings = (): void => {
    currentSceneBindingFacts = null;
    currentCombatBindingFacts = null;
    lastHealingCardProjection = null;
    retainedSceneAffordanceOperations = [];
    for (const operation of [
      "state.move_scene", "state.advance_time", "combat.resolve",
      "rules.social_adjudicate", "rules.psychology_observe",
    ]) {
      revokedSceneBindingOperations.add(operation);
      retainedTypedBindings.delete(operation);
      currentTypedBindingFactories.delete(operation);
      try { refreshTypedToolDefinition(operation); }
      catch { /* the revoked gateway remains authoritative if schema cleanup fails */ }
    }
    loadedOperations = loadedOperations.filter((grant) => (
      grant.operation !== "state.move_scene"
      && grant.operation !== "state.advance_time"
      && grant.operation !== "combat.resolve"
    ));
    try { applyKpActiveTools(); }
    catch { /* best-effort projection must not replace the primary receipt error */ }
  };
  const clearTurnTypedBindings = (): void => {
    lastHealingCardProjection = null;
    retainedOutputContextFacts = null;
    // Player messages close the turn: turn-scoped entity facts re-arm with the
    // next settle phase. The session/campaign-scoped current-PC identity
    // deliberately survives so the next turn uses the semantic handle without
    // a redundant scene.context call.
    clearTurnEntityFacts();
    currentSceneBindingFacts = null;
    currentNpcInteractionBindingFacts = null;
    revokedSceneBindingOperations.clear();
    for (const operation of [
      "state.journal",
      "narration.review",
      "turn.finalize",
      "state.move_scene",
      "state.advance_time",
      "combat.resolve",
      "evidence.table_opening",
      "state.record_npc_engagement",
      "chase.execute",
      "sanity.execute",
      "rules.social_adjudicate",
      "rules.psychology_observe",
    ]) clearTypedBinding(operation);
    currentChaseBindingFacts = null;
    currentSanityBoutBindingFacts = null;
  };
  const armTypedBinding = (
    binding: TypedToolBindingCard,
    currentFactory: () => CurrentTypedToolHostContext | null,
  ): void => {
    retainedTypedBindings.set(binding.operation, binding);
    currentTypedBindingFactories.set(binding.operation, currentFactory);
    if (hostHydrationObservationTransaction !== null) {
      hostHydrationObservationTransaction.bindingRefreshes.add(binding.operation);
    } else {
      refreshTypedToolDefinition(binding.operation);
    }
    try {
      appendObservationAudit("coc-typed-tool-binding", {
        schema_version: 1,
        status: "armed",
        operation: binding.operation,
        binding_revision: binding.binding_revision,
        player_turn_epoch: canonicalProgress.playerTurnEpoch,
      });
    } catch { /* binding audit is best effort */ }
  };
  /**
   * Arm the host-owned identity for `evidence.table_opening`.
   *
   * `run_id` and `decision_id` are the host's to mint; the Keeper cannot know
   * them and the retry circuit explicitly refuses to let it invent them. So
   * any lane that puts this operation in front of the model must also arm this
   * binding, or it hands the Keeper a call that cannot succeed and then blames
   * it for the arguments it was never allowed to supply.
   *
   * Returns whether it armed, so callers can clear a stale binding instead.
   */
  const armTableOpeningBinding = (
    campaignId: string,
    params: JsonObject,
    mode: string,
    nextOperations: readonly string[],
  ): boolean => {
    if (
      mode !== "table_opening"
      || !nextOperations.includes("evidence.table_opening")
      || !campaignId
    ) {
      // Say why. A binding that silently declines to arm turns into the model
      // being asked for host-owned identity three tool calls later, with
      // nothing in the record connecting the two.
      try {
        appendObservationAudit("coc-typed-tool-binding", {
          schema_version: 1,
          status: "not_armed",
          operation: "evidence.table_opening",
          mode,
          next_operations: [...nextOperations],
          campaign_id: campaignId,
        });
      } catch { /* binding audit is best effort */ }
      return false;
    }
    const openingRoot = typeof params.root === "string" && params.root
      ? params.root
      : currentWorkspaceRoot;
    const card = (): TypedToolBindingCard => ({
      schema_version: 1,
      operation: "evidence.table_opening",
      binding_revision: `table-opening:${campaignId}:opening-1`,
      root: openingRoot,
      campaign: campaignId,
      decision_id: `table-opening:${campaignId}:opening-1`,
      run_id: `run-${campaignId}`,
    });
    armTypedBinding(card(), () => (
      canonicalProgressCampaignId !== campaignId || !currentWorkspaceRoot
        ? null
        : card()
    ));
    return true;
  };
  const currentBindingContext = (operation: string): {
    binding: TypedToolBindingCard;
    current_host_context: CurrentTypedToolHostContext;
  } | null => {
    const binding = retainedTypedBindings.get(operation);
    const current = currentTypedBindingFactories.get(operation)?.() ?? null;
    return binding && current
      ? { binding, current_host_context: current }
      : null;
  };
  const hostBindingRefreshOperation = (operation: string): string => (
    operation === "combat.resolve"
      ? "combat.context"
      : operation === "state.move_scene" || operation === "state.advance_time"
        ? "scene.context"
        : operation
  );
  const hostVisibleFailure = (
    tool: string,
    code: string,
    message: string,
    details: JsonObject,
    recovery: {
      class: string;
      recoverableBy: string;
      allowedNextActions?: JsonObject[];
      automaticAction?: string;
    },
  ): JsonObject => ({
    ok: false,
    tool,
    isError: true,
    error: {
      code,
      message,
      details,
      retryable: false,
      class: recovery.class,
      recoverable_by: recovery.recoverableBy,
      allowed_next_actions: recovery.allowedNextActions ?? [],
      ...(recovery.automaticAction === undefined
        ? {}
        : { automatic_action: recovery.automaticAction }),
    },
    retryable: false,
    will_retry: false,
  });
  const hostFailureResult = (visible: JsonObject) => ({
    ...result(visible),
    isError: true,
  });
  const hostBindingFailure = (
    operation: string,
    error: ToolContractProjectionError,
  ): JsonObject => {
    const visible = hostVisibleFailure(
      operation,
      error.code,
      error.message,
      error.details,
      {
        class: "invariant_terminal",
        recoverableBy: "none",
      },
    );
    const projected = projectPiToolFailure(visible, operation) ?? visible;
    const projectedError = objectOrNull(projected.error) ?? {};
    const refreshOperation = hostBindingRefreshOperation(operation);
    if (error.code === "binding_context_stale") {
      return {
        ...projected,
        ok: false,
        isError: true,
        error: {
          ...projectedError,
          class: "business_precondition",
          recoverable_by: "host_binding_refresh",
          allowed_next_actions: [],
          automatic_action: `refresh_retained_binding_via:${refreshOperation}`,
        },
      };
    }
    if (error.code === "semantic_candidate_stale") {
      return {
        ...projected,
        ok: false,
        isError: true,
        error: {
          ...projectedError,
          class: "dynamic_candidate",
          recoverable_by: "model_next_action",
          allowed_next_actions: [{
            operation: refreshOperation,
            action: "refresh_semantic_candidates",
            reason: "refresh the current canonical candidates before choosing again",
            host_bound: true,
          }],
        },
      };
    }
    return { ...projected, ok: false, isError: true };
  };
  const discoveryFailure = (
    code: string,
    message: string,
    details: JsonObject = {},
  ) => {
    const recovery = code === "namespace_too_large"
      ? {
          class: "dynamic_candidate",
          recoverableBy: "model_next_action",
          allowedNextActions: [{
            operation: "coc_discover",
            action: "select_exact_operation",
            reason: "request one exact semantic dotted operation instead of the oversized namespace",
            host_bound: false,
          }],
        }
      : code === "unknown_operation"
        ? {
            class: "dynamic_candidate",
            recoverableBy: "model_next_action",
            allowedNextActions: [{
              operation: "coc_discover",
              action: "list_available_namespaces",
              reason: "call coc_discover without selectors, then choose one advertised exact operation",
              host_bound: true,
            }],
          }
        : code === "invalid_snapshot"
          ? {
              class: "business_precondition",
              recoverableBy: "host_binding_refresh",
              automaticAction: "refresh_registered_tool_schemas",
            }
          : {
              class: "schema_validation",
              recoverableBy: "model_next_action",
              allowedNextActions: [{
                operation: "coc_discover",
                action: "correct_discovery_selector",
                reason: "supply exactly one valid operation or namespace selector",
                host_bound: false,
              }],
            };
    return hostFailureResult(hostVisibleFailure(
      "coc_discover",
      code,
      message,
      details,
      recovery,
    ));
  };
  const bindingScopeMatches = (scope: StructuredBindingScope): boolean => (
    scope.sessionEpoch === sessionEpoch
    && !sessionClosing
    && scope.playerTurnEpoch === canonicalProgress.playerTurnEpoch
    && scope.stage === canonicalProgress.stage
    && scope.phase === resolveAclPhase()
  );

  const canonicalProgressFacts = (
    progress: CanonicalTurnProgress,
  ): string => JSON.stringify({
    playerTurnEpoch: progress.playerTurnEpoch,
    stage: progress.stage,
    campaignRevision: progress.campaignRevision,
    journalRevision: progress.journalRevision,
    reviewRevision: progress.reviewRevision,
    finalizedRenderedSha256: progress.finalizedRenderedSha256,
    closedObligationCount: progress.closedObligationCount,
  });
  const advanceCanonicalProgress = (
    campaignId: string,
    patch: Partial<Omit<CanonicalTurnProgress, "playerTurnEpoch" | "canonicalProgressRevision">>,
    options: {
      newPlayerEpoch?: number;
      reprojectTools?: boolean;
      hostBindingRefresh?: {
        kind: "host_binding_refresh";
        operation: "turn.output_context";
        turnId: string;
        sourceDigest: string;
        outputRevision: number;
        sessionGeneration: number;
      };
    } = {},
  ): boolean => {
    const newEpoch = options.newPlayerEpoch;
    const base = newEpoch === undefined
      ? canonicalProgress
      : {
          playerTurnEpoch: newEpoch,
          canonicalProgressRevision: 0,
          stage: "acting" as const,
          campaignRevision: null,
          journalRevision: null,
          reviewRevision: null,
          finalizedRenderedSha256: null,
          closedObligationCount: 0,
        };
    const unversioned: CanonicalTurnProgress = { ...base, ...patch };
    const candidate: CanonicalTurnProgress = newEpoch === undefined
      ? canonicalProgressFacts(unversioned) === canonicalProgressFacts(base)
        ? base
        : {
            ...unversioned,
            canonicalProgressRevision: base.canonicalProgressRevision + 1,
          }
      : unversioned;
    const refresh = options.hostBindingRefresh;
    const authorizedFaultRecovery = (
      canonicalProgress.stage === "faulted"
      && newEpoch === undefined
      && refresh !== undefined
      && refresh.kind === "host_binding_refresh"
      && refresh.operation === "turn.output_context"
      && refresh.operation === faultRecoveryOperation
      && candidate.stage === "output_context_ready"
      && candidate.playerTurnEpoch === canonicalProgress.playerTurnEpoch
      && candidate.canonicalProgressRevision
        === canonicalProgress.canonicalProgressRevision + 1
    );
    if (authorizedFaultRecovery && refresh !== undefined && campaignId) {
      const authorization = nonRetryableFailureCircuit.authorizeHostBindingRefresh({
        kind: refresh.kind,
        operation: refresh.operation,
        recoverableBy: "host_binding_refresh",
        recoveryEligible: faultRecoveryOperation === refresh.operation,
        campaignId,
        turnId: refresh.turnId,
        sourceDigest: refresh.sourceDigest,
        outputRevision: refresh.outputRevision,
        playerTurnEpoch: candidate.playerTurnEpoch,
        sessionGeneration: refresh.sessionGeneration,
        fromProgress: canonicalProgress,
        toProgress: candidate,
      });
      if (
        authorization === null
        || !nonRetryableFailureCircuit.advanceAuthorizedHostBindingRefresh({
          campaignId,
          authorization,
          operation: refresh.operation,
          turnId: refresh.turnId,
          sourceDigest: refresh.sourceDigest,
          outputRevision: refresh.outputRevision,
          playerTurnEpoch: candidate.playerTurnEpoch,
          sessionGeneration: refresh.sessionGeneration,
          canonicalProgress: candidate,
        })
      ) return false;
      canonicalProgress = candidate;
      faultRecoveryOperation = null;
      openingContinuationGate.clearTurnProcessingFault();
      canonicalProgressCampaignId = campaignId;
      try {
        pi.appendEntry("coc-canonical-turn-progress", {
          schema_version: 1,
          status: "advanced",
          player_turn_epoch: candidate.playerTurnEpoch,
          canonical_progress_revision: candidate.canonicalProgressRevision,
          stage: candidate.stage,
          reason: "authorized_fault_recovery_receipt",
          recovery_operation: refresh.operation,
        });
      } catch { /* progress audit is best effort */ }
      if (options.reprojectTools !== false) {
        if (hostHydrationObservationTransaction !== null) {
          hostHydrationObservationTransaction.reprojectTools = true;
        } else {
          applyKpActiveTools();
        }
      }
      return true;
    }
    const comparison = compareCanonicalTurnProgress(canonicalProgress, candidate);
    if (comparison.order === "stale" || comparison.order === "regressive") {
      try {
        appendObservationAudit("coc-canonical-turn-progress", {
          schema_version: 1,
          status: "rejected",
          reason: comparison.reason,
          player_turn_epoch: candidate.playerTurnEpoch,
          canonical_progress_revision: candidate.canonicalProgressRevision,
          stage: candidate.stage,
        });
      } catch { /* progress audit is best effort */ }
      return false;
    }
    if (comparison.order === "equal") return true;
    canonicalProgress = candidate;
    if (campaignId) canonicalProgressCampaignId = campaignId;
    if (campaignId) {
      nonRetryableFailureCircuit.advance({
        campaignId,
        playerTurnEpoch: candidate.playerTurnEpoch,
        canonicalProgress: candidate,
      });
    }
    try {
      appendObservationAudit("coc-canonical-turn-progress", {
        schema_version: 1,
        status: "advanced",
        player_turn_epoch: candidate.playerTurnEpoch,
        canonical_progress_revision: candidate.canonicalProgressRevision,
        stage: candidate.stage,
        reason: comparison.reason,
      });
    } catch { /* progress audit is best effort */ }
    if (options.reprojectTools !== false) {
      if (hostHydrationObservationTransaction !== null) {
        hostHydrationObservationTransaction.reprojectTools = true;
      } else {
        applyKpActiveTools();
      }
    }
    return true;
  };

  const semanticDecisionId = (
    operation: string,
    revision = canonicalProgress.canonicalProgressRevision + 1,
  ): string => (
    `pi-${operation.replace(/\./gu, "-")}:${HOST_BOOT_SALT}:player-epoch-${
      canonicalProgress.playerTurnEpoch
    }:revision-${revision}`
  );
  const bindSanityHostArguments = (
    operation: string,
    modelArguments: JsonObject,
  ): JsonObject => {
    if (operation === "rules.sanity_check") {
      const triggerId = typeof modelArguments.trigger_id === "string"
        && modelArguments.trigger_id.trim()
        ? modelArguments.trigger_id.trim()
        : "sanity-check";
      return {
        ...modelArguments,
        decision_id: semanticDecisionId(`rules.sanity_check:${triggerId}`),
      };
    }
    if (operation !== "sanity.execute") return modelArguments;
    const command = objectOrNull(modelArguments.command) ?? {};
    const semanticBoutAction = command.action === "tick"
      || command.action === "end";
    const boutBinding = retainedTypedBindings.get("sanity.execute");
    if (boutBinding?.operation === "sanity.execute") {
      if (!semanticBoutAction) {
        throw new ToolContractProjectionError(
          "semantic_candidate_stale",
          "an active sanity bout accepts only the current semantic tick/end action",
          { operation, candidate_field: "command.action" },
        );
      }
      return bindRetainedTypedToolArguments(
        operation,
        modelArguments,
        boutBinding,
        currentTypedBindingFactories.get(operation)?.() ?? null,
      ) as JsonObject;
    }
    if (semanticBoutAction) {
      throw new ToolContractProjectionError(
        "binding_context_missing",
        "call sanity.context to bind the current active bout before choosing tick/end",
        { operation },
      );
    }
    const payload = objectOrNull(command.payload) ?? {};
    const kind = typeof command.kind === "string" && command.kind.trim()
      ? command.kind.trim()
      : "sanity_check";
    const semanticScope = (
      typeof payload.trigger_id === "string" && payload.trigger_id.trim()
        ? payload.trigger_id.trim()
        : typeof payload.choice_id === "string" && payload.choice_id.trim()
          ? payload.choice_id.trim()
          : kind
    );
    const decisionId = semanticDecisionId(
      `sanity.execute:${kind}:${semanticScope}`,
    );
    return {
      ...modelArguments,
      decision_id: decisionId,
      command: {
        command_id: decisionId,
        kind,
        phase: "resolve",
        payload: {
          ...payload,
          decision_id: decisionId,
          ...(
            kind === "bout_tick" || kind === "bout_end"
              ? { terminal_command_ids: [decisionId] }
              : {}
          ),
        },
      },
    };
  };
  const operationCardRevision = (
    value: unknown,
    operation: string,
  ): number | null => {
    const card = objectOrNull(value);
    const prefilled = objectOrNull(card?.prefilled_arguments);
    const revision = prefilled?.revision;
    if (typeof revision !== "number") return null;
    return (
      card?.operation === operation
      && Number.isInteger(revision)
      && revision > 0
    ) ? revision : null;
  };
  const armJournalBinding = (campaignId: string): void => {
    const playerText = openingContinuationGate.currentExternalPlayerText;
    if (
      !campaignId
      || !currentWorkspaceRoot
      || typeof playerText !== "string"
      || !playerText
    ) return;
    const binding: TypedToolBindingCard = {
      schema_version: 1,
      operation: "state.journal",
      binding_revision: `state-journal:player-epoch-${canonicalProgress.playerTurnEpoch}`,
      root: currentWorkspaceRoot,
      campaign: campaignId,
      player_text: playerText,
      decision_id: semanticDecisionId("state.journal", 1),
    };
    const playerTurnEpoch = canonicalProgress.playerTurnEpoch;
    armTypedBinding(binding, () => {
      const currentText = openingContinuationGate.currentExternalPlayerText;
      if (
        canonicalProgress.playerTurnEpoch !== playerTurnEpoch
        || typeof currentText !== "string"
        || !currentText
      ) return null;
      return {
        schema_version: 1,
        operation: "state.journal",
        binding_revision: `state-journal:player-epoch-${playerTurnEpoch}`,
        root: currentWorkspaceRoot,
        campaign: canonicalProgressCampaignId || campaignId,
        player_text: currentText,
        decision_id: `pi-state-journal:${HOST_BOOT_SALT}:player-epoch-${playerTurnEpoch}:revision-1`,
      };
    });
  };
  const armNpcEngagementBindingFromQuery = (
    campaignId: string,
    params: JsonObject,
    data: JsonObject,
  ): void => {
    const args = objectOrNull(params.arguments) ?? {};
    const requestedNpcId = typeof args.npc_id === "string"
      ? args.npc_id.trim()
      : "";
    const rows = (Array.isArray(data.npcs) ? data.npcs : [])
      .map((value) => objectOrNull(value))
      .filter((value): value is JsonObject => value !== null)
      .filter((value) => (
        !requestedNpcId
        || value.npc_id === requestedNpcId
      ));
    if (!campaignId || rows.length !== 1) {
      clearTypedBinding("state.record_npc_engagement");
      return;
    }
    const row = rows[0];
    const readiness = objectOrNull(row.first_contact_readiness);
    const impression = objectOrNull(
      readiness?.requested_pair_first_impression,
    );
    const npcId = typeof row.npc_id === "string" ? row.npc_id.trim() : "";
    const firstImpressionRef = typeof impression?.first_impression_ref === "string"
      ? impression.first_impression_ref.trim()
      : "";
    if (
      !npcId
      || impression?.status !== "settled"
      || impression?.receipt_exists !== true
      || !firstImpressionRef
    ) {
      clearTypedBinding("state.record_npc_engagement");
      return;
    }
    let investigatorId = typeof impression.investigator_id === "string"
      ? impression.investigator_id.trim()
      : "";
    if (!investigatorId || investigatorId === CURRENT_INVESTIGATOR_HANDLE) {
      const party = semanticRegistry.currentParty(registryScope(campaignId));
      investigatorId = party.live && party.state === "single"
        ? party.investigatorId
        : "";
    }
    const root = typeof params.root === "string" && params.root
      ? params.root
      : currentWorkspaceRoot;
    if (!investigatorId || !root) {
      clearTypedBinding("state.record_npc_engagement");
      return;
    }
    const identityRef = typeof row.identity_ref === "string"
      ? row.identity_ref.trim()
      : "";
    const playerTurnEpoch = canonicalProgress.playerTurnEpoch;
    const runId = `run-${campaignId}`;
    const decisionId = (
      `npc-engagement:${campaignId}:${npcId}:player-epoch-${playerTurnEpoch}`
    );
    const card = (): TypedToolBindingCard => ({
      schema_version: 1,
      operation: "state.record_npc_engagement",
      binding_revision: (
        `npc-engagement:${campaignId}:${npcId}:player-epoch-${playerTurnEpoch}`
      ),
      root,
      campaign: campaignId,
      decision_id: decisionId,
      npc_id: npcId,
      investigator: investigatorId,
      ...(identityRef ? { identity_ref: identityRef } : {}),
      run_id: runId,
    });
    armTypedBinding(card(), () => (
      canonicalProgressCampaignId === campaignId
      && canonicalProgress.playerTurnEpoch === playerTurnEpoch
        ? card()
        : null
    ));
  };
  const observeCanonicalProgress = (
    operation: string,
    params: JsonObject,
    value: unknown,
    validatedLiveCards: LiveOutputContextCards | null = null,
  ): void => {
    const envelope = objectOrNull(value);
    const data = objectOrNull(envelope?.data);
    if (envelope?.ok !== true || data === null) return;
    // The envelope is authoritative, and it names its own campaign. Reading the
    // id only from the request left it empty whenever a call carried no
    // selector -- which is the normal shape for `session.resume`, since the
    // session is already bound to one campaign. On a fresh session that meant
    // `evidence.table_opening` never received its host-owned binding, and the
    // first played turn asked the Keeper for a `run_id` it has no way to know,
    // while the retry circuit simultaneously refused to let it supply one.
    // The envelope only fills a hole here; a request selector still wins.
    const campaignId = (
      typeof params.campaign === "string" ? params.campaign.trim() : ""
    )
      || canonicalProgressCampaignId
      || (typeof data.campaign_id === "string" ? data.campaign_id.trim() : "");
    if (campaignId) canonicalProgressCampaignId = campaignId;
    // Retain exact canonical entity identities for semantic-handle
    // restoration. Host-side only; structured per-operation extraction from
    // the observed envelope — never from projected model content. An
    // authoritative party observation REPLACES the registry investigator
    // state: empty or ambiguous party authority invalidates any prior
    // current-PC identity for this epoch+campaign instead of silently
    // retaining it.
    {
      const derived = deriveSemanticEntityFacts(operation, data);
      const authority = derived.partyAuthority ?? null;
      if (authority !== null && authority.kind !== "absent") {
        const campaign = campaignId || canonicalProgressCampaignId;
        semanticRegistry.applyPartyAuthority(
          registryScope(campaign),
          authority.kind === "single"
            ? {
              kind: "single",
              investigatorId: authority.investigatorId,
              pcSubjectRefs: authority.pcSubjectRefs,
            }
            : authority.kind === "empty"
            ? { kind: "empty" }
            : { kind: "ambiguous", investigatorIds: authority.investigatorIds },
        );
      }
      if (
        derived.playerInputSourceRef !== undefined
        || derived.advisoryAdviceId !== undefined
        || derived.advisoryCandidateRef !== undefined
      ) {
        retainedTurnEntityFacts = {
          playerInputSourceRef: derived.playerInputSourceRef
            ?? retainedTurnEntityFacts.playerInputSourceRef,
          advisoryAdviceId: derived.advisoryAdviceId
            ?? retainedTurnEntityFacts.advisoryAdviceId,
          advisoryCandidateRef: derived.advisoryCandidateRef
            ?? retainedTurnEntityFacts.advisoryCandidateRef,
        };
      }
    }
    // Register observed semantic roll/effect/item/route handles in THE
    // registry from structured facts (attempt ids, skills, kinds, labels,
    // ordinals). Host-side only; the model sees and echoes handles, the host
    // restores canonical ids. Roll records are player-turn-scoped; applied
    // exceptional effects persist until an authoritative consume/resolve;
    // inventory and routes are authoritative snapshots (replacement, never
    // append); every record is keyed by exact session epoch + campaign.
    {
      const currentCampaign = campaignId || canonicalProgressCampaignId;
      const scope = registryScope(currentCampaign);
      const registerRoll = (canonical: unknown, facts: readonly unknown[]): void => {
        if (typeof canonical !== "string" || !canonical.trim()) return;
        semanticRegistry.register({
          domain: "roll",
          canonicalId: canonical,
          facts,
          scope,
          lifetime: "player_turn",
        });
      };
      // transcript.locate candidates: name each row by what it MEANS -- its
      // turn and speaker -- and keep the canonical locator host-side. The
      // locator's last component is the row's owning decision (a journal
      // decision id, or a finalization id for a settled Keeper row), which is
      // machine identity by design: it is what makes row identity canonical
      // instead of positional. Declared `semantic`, it could never satisfy the
      // semantic grammar, so a single journal-backed candidate collapsed the
      // WHOLE envelope to `semantic_identity_unavailable` -- 7 of 9 calls in
      // one live turn, and 4 more in the turn that forked the worldline.
      // `authoritative` lifetime: a transcript row is settled history and does
      // not retire when the player turn advances.
      if (operation === "transcript.locate" && envelope?.ok === true) {
        for (const raw of Array.isArray(data?.candidates) ? data.candidates : []) {
          const candidate = objectOrNull(raw);
          const canonical = candidate?.transcript_ref;
          if (typeof canonical !== "string" || !canonical.trim()) continue;
          const turn = candidate?.turn;
          const role = typeof candidate?.role === "string" ? candidate.role : "";
          const kind = typeof candidate?.record_kind === "string"
            ? candidate.record_kind
            : "";
          const speaker = typeof candidate?.speaker === "string"
            ? candidate.speaker
            : "";
          semanticRegistry.register({
            domain: "transcript",
            canonicalId: canonical.trim(),
            facts: [
              Number.isInteger(turn) && role ? `turn-${turn}-${role}` : "",
              Number.isInteger(turn) ? `turn-${turn}` : "",
              speaker,
              kind,
            ],
            scope,
            lifetime: "authoritative",
          });
        }
      }
      const walkCanonicalRows = (
        value: unknown,
        visit: (row: Record<string, unknown>) => void,
      ): void => {
        if (Array.isArray(value)) {
          for (const entry of value) walkCanonicalRows(entry, visit);
          return;
        }
        const row = objectOrNull(value);
        if (row === null) return;
        visit(row);
        for (const child of Object.values(row)) {
          walkCanonicalRows(child, visit);
        }
      };
      if (
        operation === "rules.sanity_check"
        || operation === "sanity.execute"
        || operation === "combat.resolve"
      ) {
        walkCanonicalRows(data, (row) => {
          registerRoll(row.roll_id, [
            row.skill,
            row.goal,
            row.roll_role,
            row.event_type,
          ]);
          if (operation !== "rules.sanity_check") return;
          const check = objectOrNull(data.check);
          for (const [field, role] of [
            ["check_roll_id", "san-check"],
            ["int_roll_id", "int-check"],
            ["bout_duration_roll_id", "bout-duration"],
            ["bout_table_roll_id", "bout-table"],
            ["bout_rounds_roll_id", "bout-rounds"],
            ["mania_roll_id", "mania"],
            ["phobia_roll_id", "phobia"],
            ["loss_roll_id", "san-loss"],
          ] as const) {
            registerRoll(row[field], [data.source, check?.skill, role]);
          }
          const sessionRollIds = Array.isArray(row.session_roll_ids)
            ? row.session_roll_ids
            : [];
          sessionRollIds.forEach((rollId, index) => {
            registerRoll(rollId, [data.source, "san-session-roll", index + 1]);
          });
        });
      }
      if (operation === "mechanics.ensure" || operation === "combat.resolve") {
        walkCanonicalRows(data, (row) => {
          if (typeof row.weapon_id !== "string" || !row.weapon_id.trim()) return;
          semanticRegistry.register({
            domain: "weapon",
            canonicalId: row.weapon_id.trim(),
            facts: [row.name, row.weapon_label, row.extends, "combat-weapon"],
            scope,
            lifetime: "player_turn",
          });
        });
      }
      if (operation === "rules.roll" || operation === "rules.push") {
        const resolutionContext = objectOrNull(data.resolution_context);
        const rollArguments = objectOrNull(params.arguments);
        registerRoll(data.roll_id, [
          resolutionContext?.attempt_id,
          data.skill,
          resolutionContext?.roll_density_group,
          rollArguments?.decision_id,
        ]);
      }
      // The ten-family cutover moved execution to `rules.settle` and left
      // this registration behind. Seven of the operations named in this block
      // (`rules.roll`, `rules.push`, `rules.opposed`, `rules.sanity_check`,
      // `sanity.execute`, `combat.resolve`, `rules.psychology_observe`) are
      // `kp_surface: "none"` now, so in normal play they never fire — and
      // every roll a graph settlement produces went unregistered.
      //
      // The damage is not cosmetic. An unregistered roll has no semantic
      // handle, so its `roll:<canonical>` obligation cannot map; the
      // `state.journal` refusal that names the remedy for a fumble is then
      // collapsed into `semantic_identity_unavailable`, and the Keeper is
      // left with a turn it cannot journal and no route out. That deadlock
      // was observed at a live table.
      if (operation === "rules.settle") {
        const settlement = objectOrNull(data.settlement);
        const settled = objectOrNull(settlement?.result);
        const family = data.family;
        const decisionRef = data.decision_ref;
        walkCanonicalRows(settled ?? {}, (row) => {
          // Every canonical roll a settlement carries, wherever it sits:
          // the bound check, a sanity check and its loss roll, and any
          // session roll the subsystem recorded.
          // Facts are ordered most-distinctive first, matching the sibling
          // branches: a handle built from the family alone collides the
          // moment one settlement rolls twice.
          const check = objectOrNull(row.check);
          registerRoll(row.roll_id, [
            row.skill ?? row.characteristic,
            row.goal ?? row.source,
            family,
          ]);
          for (const [field, role] of [
            ["check_roll_id", "check"],
            ["loss_roll_id", "loss"],
            ["phobia_roll_id", "phobia"],
            ["mania_roll_id", "mania"],
          ] as const) {
            registerRoll(row[field], [
              row.source ?? row.goal,
              check?.skill ?? row.skill,
              role,
            ]);
          }
          const sessionRollIds = Array.isArray(row.session_roll_ids)
            ? row.session_roll_ids
            : [];
          sessionRollIds.forEach((rollId, index) => {
            registerRoll(rollId, [row.source, family, "session-roll", index + 1]);
          });
        });
      }
      if (operation === "rules.roll_dice") {
        registerRoll(data.roll_id, [
          data.reason,
          data.expression,
          "random-dice-roll",
        ]);
      }
      if (operation === "rules.settle") {
        // RuleGraph settlement records its canonical percentile evidence in
        // nested result rows (settlement.result.bound_check and family
        // variants), never through a rules.roll envelope this gateway would
        // observe. Without registration a graph-settled critical/fumble has
        // no live roll handle: state.exceptional_effect can never bind the
        // source roll and the turn cannot close.
        const settleArguments = objectOrNull(params.arguments);
        walkCanonicalRows(data, (row) => {
          registerRoll(row.roll_id, [
            settleArguments?.decision_id,
            row.skill,
            row.outcome ?? row.achieved_level,
            "settled-check",
          ]);
        });
      }
      if (operation === "rules.opposed") {
        registerRoll(data.investigator_roll_id, [
          data.skill,
          "investigator-opposed-roll",
        ]);
        registerRoll(data.opponent_roll_id, [
          data.opponent_label,
          "opponent-opposed-roll",
        ]);
      }
      if (operation === "rules.psychology_observe") {
        registerRoll(data.roll_id, [
          data.question,
          data.outcome,
          "psychology-observation",
        ]);
      }
      if (operation === "npc.reaction") {
        registerRoll(data.roll_id, [
          data.npc_display_name,
          data.npc_id,
          "first-impression",
        ]);
      }
      if (operation === "session.resume") {
        const currentTurn = objectOrNull(data.current_turn);
        const rows = Array.isArray(currentTurn?.rows)
          ? currentTurn.rows
          : [];
        rows.forEach((entry, index) => {
          const row = objectOrNull(entry);
          const summary = objectOrNull(row?.receipt_summary);
          if (summary === null) return;
          registerRoll(summary.roll_id, [
            row?.tool,
            summary.outcome,
            "recovered-first-impression",
            index + 1,
          ]);
        });
      }
      if (operation === "turn.output_context") {
        const obligations = Array.isArray(data.obligations) ? data.obligations : [];
        obligations.forEach((obligation, index) => {
          const row = objectOrNull(obligation);
          if (row === null) return;
          const obligationId = typeof row.obligation_id === "string"
            ? row.obligation_id
            : "";
          // Non-roll obligations (first-impression, sanity_bout) keep the
          // full kind-prefixed id as the canonical so restoration returns
          // the exact Python join key. Roll obligations strip the prefix
          // so they share the live roll-domain handle.
          const canonical = obligationId.startsWith("roll:")
            ? obligationId.slice("roll:".length)
            : obligationId;
          registerRoll(canonical, [
            row.npc_display_name,
            row.skill,
            row.source_kind,
            row.goal,
            index + 1,
          ]);
          for (
            const effectId
            of Array.isArray(row.substantive_effect_ids) ? row.substantive_effect_ids : []
          ) {
            if (typeof effectId !== "string" || !effectId.trim()) continue;
            semanticRegistry.register({
              domain: "effect",
              canonicalId: effectId,
              facts: [row.skill, "substantive-effect"],
              scope,
              lifetime: "player_turn",
            });
          }
        });
        for (const rollId of Array.isArray(data.source_roll_ids) ? data.source_roll_ids : []) {
          registerRoll(rollId, [data.turn_number, "source-roll"]);
        }
        // A recovered pending turn may be the first observation in this Pi
        // session of the exact mechanics frozen by the prior host. Register
        // every nested model-referenceable roll/effect from structured
        // output_context facts before projecting it. The model receives only
        // stable semantic handles; exact ids remain in canonical `details`
        // and are restored through the same registry on review/finalize.
        const mechanics = objectOrNull(data.mechanics_summary);
        for (const rowValue of Array.isArray(mechanics?.public_check)
          ? mechanics.public_check
          : []) {
          const row = objectOrNull(rowValue);
          if (row === null) continue;
          registerRoll(row.roll_id, [
            row.display_skill,
            row.skill,
            row.kind,
            row.outcome,
          ]);
        }
        const registerOutputContextEffect = (
          rowValue: unknown,
          category: string,
        ): void => {
          const row = objectOrNull(rowValue);
          if (row === null || typeof row.effect_id !== "string") return;
          // The registry uses its first fact as the presented handle base.
          // Compose only controlled semantic dimensions so even a short
          // resource token (`HP`, `MP`) yields a multi-token handle accepted
          // by the same closed point-of-use grammar (`hp-scalar-state-delta`),
          // without embedding canonical identity or weakening validation.
          const semanticEffectFact = [
            row.resource,
            row.effect_kind,
            category,
          ].filter((fact): fact is string => (
            typeof fact === "string" && fact.trim().length > 0
          )).map((fact) => fact.trim()).join("-");
          semanticRegistry.register({
            domain: "effect",
            canonicalId: row.effect_id,
            facts: [
              semanticEffectFact,
              row.npc_display_name,
              category,
            ],
            scope,
            lifetime: "player_turn",
          });
        };
        for (const category of [
          "state_delta",
          "exceptional_effect",
          "concealed_consequence",
        ]) {
          for (const row of Array.isArray(mechanics?.[category])
            ? mechanics[category]
            : []) {
            registerOutputContextEffect(row, category);
          }
        }
        for (const constraintValue of Array.isArray(data.npc_performance_constraints)
          ? data.npc_performance_constraints
          : []) {
          const constraint = objectOrNull(constraintValue);
          if (constraint === null) continue;
          registerOutputContextEffect(constraint, "npc_performance_constraint");
          registerRoll(constraint.source_roll_id, [
            constraint.npc_display_name,
            constraint.effect_kind,
            "npc-performance-constraint",
          ]);
        }
        for (const pendingValue of Array.isArray(data.pending_modifier_consumptions)
          ? data.pending_modifier_consumptions
          : []) {
          const pending = objectOrNull(pendingValue);
          if (pending === null) continue;
          if (typeof pending.effect_id === "string") {
            semanticRegistry.register({
              domain: "effect",
              canonicalId: pending.effect_id,
              facts: [
                pending.effect_kind,
                pending.skill,
                "pending-modifier-consumption",
              ],
              scope,
              // This effect pre-existed the recovered turn and stays live
              // until the authoritative consume operation retires it.
              lifetime: "authoritative",
            });
          }
          registerRoll(pending.roll_id, [
            pending.skill,
            pending.effect_kind,
            "pending-modifier-roll",
          ]);
        }
      }
      // Exceptional effects: apply registers a persistent handle;
      // consume/resolve are the authoritative retirement of the named id.
      if (operation === "state.exceptional_effect") {
        const action = typeof data.action === "string" ? data.action : "apply";
        const effectArguments = objectOrNull(params.arguments);
        const effectInput = typeof effectArguments?.effect_id === "string"
          ? effectArguments.effect_id.trim()
          : "";
        if (
          (action === "consume" || action === "resolve")
          && effectInput
        ) {
          semanticRegistry.retire("effect", effectInput, scope);
          const canonicalEffect = typeof data.effect_id === "string"
            ? data.effect_id
            : "";
          if (canonicalEffect && canonicalEffect !== effectInput) {
            semanticRegistry.retire("effect", canonicalEffect, scope);
          }
        } else {
          const effect = objectOrNull(data.effect);
          const canonicalEffect = typeof data.effect_id === "string"
            ? data.effect_id
            : typeof effect?.effect_id === "string"
              ? effect.effect_id
              : "";
          const effectKind = typeof data.kind === "string"
            ? data.kind
            : typeof effect?.effect_kind === "string"
              ? effect.effect_kind
              : "effect";
          if (canonicalEffect) {
            semanticRegistry.register({
              domain: "effect",
              canonicalId: canonicalEffect,
              facts: [effectKind, operation],
              scope,
              lifetime: "authoritative",
            });
          }
        }
      } else if (typeof data.effect_id === "string") {
        // Any other envelope naming an effect registers it turn-scoped.
        semanticRegistry.register({
          domain: "effect",
          canonicalId: data.effect_id,
          facts: [data.kind, operation],
          scope,
          lifetime: "player_turn",
        });
      }
      // Inventory/weapons: authoritative mutation results carry the REAL
      // canonical shapes (items/weapons arrays, nested granted weapon specs,
      // name-only rows). Every snapshot keys by the authoritative OWNER
      // (investigator/npc) so one holder's listing never retires another
      // holder's mappings. Removal/consume results carry the post-mutation
      // `items` snapshot: replacement retires removed entities.
      const collectInventoryEntries = (
        source: unknown,
        idField: string,
      ): Array<{ canonicalId: string; facts: readonly unknown[] }> => {
        const entries: Array<{ canonicalId: string; facts: readonly unknown[] }> = [];
        for (const entry of Array.isArray(source) ? source : []) {
          // Bare-string rows are name-only entries: the name IS the
          // canonical value the mutation operations expect.
          if (typeof entry === "string") {
            if (entry.trim()) entries.push({ canonicalId: entry.trim(), facts: [entry] });
            continue;
          }
          const row = objectOrNull(entry);
          if (row === null) continue;
          const explicitId = typeof row[idField] === "string" && row[idField].trim()
            ? row[idField].trim()
            : "";
          // Name-only weapons have no opaque invented id: the canonical
          // value is the exact name.
          const name = typeof row.name === "string" && row.name.trim()
            ? row.name.trim()
            : "";
          const label = typeof row.label === "string" && row.label.trim()
            ? row.label.trim()
            : "";
          const canonicalId = explicitId || name || label;
          if (canonicalId) {
            entries.push({ canonicalId, facts: [label, name, explicitId] });
          }
        }
        return entries;
      };
      // Owner-scoped registry mutation for one canonical inventory result.
      // Every register/retire/snapshot below is judged within the EXACT
      // owner/container scope derived from the authoritative result.
      const mutateInventoryRegistry = (ownerScope: SemanticIdentityScope): void => {
        // Full authoritative snapshots (list results and every mutation that
        // returns the post-mutation arrays) register/retire by replacement
        // WITHIN the reporting owner. The item snapshot is the UNION of the
        // item/gear arrays and the weapon entries: the remove/use contract
        // names every held entity (runtime weapons, name-only included) by
        // scalar item_id, so weapon entries share the item identity — while
        // the single merged snapshot never invalidates the holder's other
        // items.
        const itemEntries = [
          ...collectInventoryEntries(data.items, "item_id"),
          ...collectInventoryEntries(data.gear, "item_id"),
        ];
        const weaponEntries = [
          ...collectInventoryEntries(data.weapons, "weapon_id"),
          ...collectInventoryEntries(data.authored_weapons, "weapon_id"),
        ];
        if (Array.isArray(data.items) || Array.isArray(data.gear)) {
          semanticRegistry.applySnapshot("item", ownerScope, itemEntries);
        }
        if (
          Array.isArray(data.weapons) || Array.isArray(data.authored_weapons)
        ) {
          semanticRegistry.applySnapshot("weapon", ownerScope, weaponEntries);
          if (itemEntries.length === 0 && weaponEntries.length > 0) {
            // No authoritative item array in this envelope: the weapon
            // entries are the only held entities the result names.
            semanticRegistry.applySnapshot("item", ownerScope, weaponEntries);
          } else if (weaponEntries.length > 0) {
            semanticRegistry.applySnapshot(
              "item",
              ownerScope,
              [...itemEntries, ...weaponEntries],
            );
          }
        }
        // Authoritative losses retire the exact entities WITHIN the reporting
        // owner's scope — another holder of the same canonical id keeps
        // their mapping.
        for (const lost of Array.isArray(data.lost_weapon_ids)
          ? data.lost_weapon_ids
          : []) {
          if (typeof lost === "string" && lost.trim()) {
            semanticRegistry.retire("weapon", lost, ownerScope);
          }
        }
        for (const lost of Array.isArray(data.lost_equipment_ids)
          ? data.lost_equipment_ids
          : []) {
          if (typeof lost === "string" && lost.trim()) {
            semanticRegistry.retire("item", lost, ownerScope);
          }
        }
        // Grant (investigator and NPC): the canonical result names the
        // granted entity as scalar item_id in EVERY shape — register the
        // item mapping so projection of that scalar resolves; a weapon
        // grant additionally embeds the weapon spec (weapon_id or
        // name-only) and registers the weapon mapping for the same owner.
        if (operation === "state.item_grant"
          && typeof data.item_id === "string" && data.item_id.trim()
        ) {
          semanticRegistry.register({
            domain: "item",
            canonicalId: data.item_id.trim(),
            facts: [data.label, data.kind, operation],
            scope: ownerScope,
            lifetime: "snapshot",
          });
          const grantedWeaponSpec = objectOrNull(data.weapon);
          if (grantedWeaponSpec !== null) {
            const weaponId = typeof grantedWeaponSpec.weapon_id === "string"
              && grantedWeaponSpec.weapon_id.trim()
              ? grantedWeaponSpec.weapon_id.trim()
              : typeof grantedWeaponSpec.name === "string"
              && grantedWeaponSpec.name.trim()
                ? grantedWeaponSpec.name.trim()
                : "";
            if (weaponId) {
              semanticRegistry.register({
                domain: "weapon",
                canonicalId: weaponId,
                facts: [data.label, grantedWeaponSpec.name, grantedWeaponSpec.weapon_id],
                scope: ownerScope,
                lifetime: "snapshot",
              });
            }
          }
        }
        // Remove (investigator and NPC): the canonical scalar item_id leaves
        // BOTH projected domains under the reporting owner — a removed
        // runtime weapon carries the item_id as its weapon alias.
        if (operation === "state.item_remove"
          && typeof data.item_id === "string" && data.item_id.trim()
        ) {
          semanticRegistry.retire("item", data.item_id.trim(), ownerScope);
          semanticRegistry.retire("weapon", data.item_id.trim(), ownerScope);
        }
        // Use/consume: the post-use items snapshot above already invalidates
        // a consumed entity for the exact owner; decrements keep it live.
        // No separate scalar retirement exists in the canonical shape.
        // Purchase (investigator-only): the canonical result names the bought
        // entity without snapshot arrays. Register the scalar item identity
        // under the purchasing owner; a weapon purchase resolves in BOTH
        // projected domains.
        if (operation === "state.purchase"
          && typeof data.item_id === "string" && data.item_id.trim()
        ) {
          semanticRegistry.register({
            domain: "item",
            canonicalId: data.item_id.trim(),
            facts: [data.label, data.kind, operation],
            scope: ownerScope,
            lifetime: "snapshot",
          });
          if (data.kind === "weapon") {
            semanticRegistry.register({
              domain: "weapon",
              canonicalId: data.item_id.trim(),
              facts: [data.label, data.kind, operation],
              scope: ownerScope,
              lifetime: "snapshot",
            });
          }
        }
      };
      const INVENTORY_OPS = new Set([
        "state.inventory_list", "state.item_grant", "state.item_remove",
        "state.item_use", "state.purchase",
      ]);
      if (INVENTORY_OPS.has(operation)) {
        // Authoritative owner/container scope from the exact canonical
        // result: an NPC mutation keys by npc_id, an investigator mutation
        // by investigator_id (state.purchase is investigator-only by
        // contract). An envelope without an authoritative owner registers
        // and retires NOTHING — there is no global fallback scope, and a
        // same canonical id under another owner is never touched.
        const npcOwnerId = typeof data.npc_id === "string" && data.npc_id.trim()
          ? data.npc_id.trim()
          : "";
        const investigatorOwnerId = npcOwnerId === ""
          && typeof data.investigator_id === "string" && data.investigator_id.trim()
            ? data.investigator_id.trim()
            : "";
        const ownerKey = npcOwnerId
          ? `inventory:npc:${npcOwnerId}`
          : investigatorOwnerId
            ? `inventory:investigator:${investigatorOwnerId}`
            : "";
        if (ownerKey !== "") {
          mutateInventoryRegistry({ ...scope, ownerKey });
        }
      } else if (typeof data.weapon_id === "string" && data.weapon_id.trim()) {
        // Any other envelope naming an equipped/used weapon registers it in
        // the weapon domain (combat results, equip results) under the
        // party-level container.
        semanticRegistry.register({
          domain: "weapon",
          canonicalId: data.weapon_id,
          facts: [data.label, data.name, operation],
          scope: { ...scope, ownerKey: "inventory:party" },
          lifetime: "snapshot",
        });
      }
      // Routes: the authoritative scene snapshot comes from the SAME
      // structured `exits`/`action_routes` arrays the scene bindings consume.
      // Applying even an EMPTY snapshot retires routes the new scene state no
      // longer holds — replacement, never append.
      const sceneSnapshotData = operation === "scene.context"
        ? data
        : operation === "session.resume"
          ? objectOrNull(data.scene_context)
          : null;
      if (sceneSnapshotData !== null) {
        const routeEntries: Array<{ canonicalId: string; facts: readonly unknown[] }> = [];
        // Copy-verbatim affordance projection of the actionable route working
        // set (`action_routes`/`route_index` rows — never travel `exits`).
        // Same canonical ids, independently minted `affordance:` handles.
        const affordanceEntries: Array<
          { canonicalId: string; facts: readonly unknown[] }
        > = [];
        const routeOwnerScope = {
          ...scope,
          ownerKey: `scene:${typeof sceneSnapshotData.active_scene_id === "string" ? sceneSnapshotData.active_scene_id.trim() : "unknown"}`,
        };
        const activeScene = typeof sceneSnapshotData.active_scene_id === "string"
          ? sceneSnapshotData.active_scene_id.trim()
          : "";
        for (const exit of Array.isArray(sceneSnapshotData.exits) ? sceneSnapshotData.exits : []) {
          const row = objectOrNull(exit);
          if (row === null) continue;
          const explicitId = [row.route_id, row.edge_id, row.id].find((candidate) => (
            typeof candidate === "string" && candidate.trim()
          ));
          const destination = typeof row.to === "string" ? row.to.trim() : "";
          const kind = typeof row.kind === "string" && row.kind.trim()
            ? row.kind.trim()
            : "route";
          const canonicalId = typeof explicitId === "string"
            ? explicitId.trim()
            : destination
              ? `route:${activeScene || destination}:${kind}:${destination}`
              : "";
          if (canonicalId) {
            routeEntries.push({
              canonicalId,
              facts: [activeScene, destination, kind, explicitId],
            });
          }
        }
        for (
          const route of Array.isArray(sceneSnapshotData.action_routes)
            ? sceneSnapshotData.action_routes
            : []
        ) {
          const row = objectOrNull(route);
          if (row === null) continue;
          const id = typeof row.route_id === "string" && row.route_id.trim()
            ? row.route_id
            : "";
          if (id) {
            routeEntries.push({
              canonicalId: id,
              facts: [activeScene, row.resolution_kind, row.label, row.name],
            });
            affordanceEntries.push({
              canonicalId: id,
              facts: [activeScene, row.resolution_kind, row.label, row.name],
            });
          }
        }
        for (
          const route of Array.isArray(sceneSnapshotData.route_index)
            ? sceneSnapshotData.route_index
            : []
        ) {
          const row = objectOrNull(route);
          if (row === null) continue;
          const id = typeof row.route_id === "string" && row.route_id.trim()
            ? row.route_id.trim()
            : "";
          if (id) {
            routeEntries.push({
              canonicalId: id,
              facts: [
                activeScene,
                row.route_type,
                row.resolution_kind,
                row.grants_clue_ids,
              ],
            });
            affordanceEntries.push({
              canonicalId: id,
              facts: [
                activeScene,
                row.route_type,
                row.resolution_kind,
                row.grants_clue_ids,
              ],
            });
          }
        }
        semanticRegistry.applySnapshot("route", routeOwnerScope, routeEntries);
        semanticRegistry.applySnapshot(
          "affordance",
          routeOwnerScope,
          affordanceEntries,
        );
      }
    }

    if (operation === "sanity.context" || operation === "sanity.execute") {
      armSanityBoutBindingFromCanonical(operation, campaignId, params, data);
    }

    if (operation === "state.journal" && typeof data.turn_id === "string") {
      const retainedAnchor = currentOpenTurnAnchor;
      if (
        campaignId
        && currentWorkspaceRoot
        && retainedAnchor?.campaignId === campaignId
      ) {
        clearOpenTurnPlayerInput(
          currentWorkspaceRoot,
          campaignId,
          retainedAnchor.anchor,
        );
      }
      journaledOpenTurnAnchor = (
        retainedAnchor?.campaignId === campaignId
        && Number.isSafeInteger(data.turn_number)
        && Number(data.turn_number) > 0
      ) ? {
          campaignId,
          anchor: retainedAnchor.anchor,
          turnNumber: Number(data.turn_number),
        } : null;
      openTurnRecoveryAuthorization = null;
      advanceCanonicalProgress(campaignId, {
        stage: "journaled",
        journalRevision: data.turn_id,
      });
      clearTypedBinding("state.journal");
      return;
    }
    if (operation === "turn.output_context" && typeof data.turn_id === "string") {
      const contractProjection = objectOrNull(data.contract_projection);
      const agencyReviewRequired = contractProjection?.agency_review_required === true;
      const reviewCard = objectOrNull(data.agency_review_operation);
      const finalizeCard = objectOrNull(data.finalize_operation);
      const revision = agencyReviewRequired
        ? operationCardRevision(reviewCard, "narration.review")
        : operationCardRevision(finalizeCard, "turn.finalize");
      const directGenericFinalize = (
        !agencyReviewRequired
        && finalizeCard?.invoke_via === "coc_invoke"
      );
      const directTypedFinalize = (
        !agencyReviewRequired
        && finalizeCard?.invoke_via === "coc_turn_finalize"
      );
      const sourceDigest = typeof data.source_digest === "string"
        ? data.source_digest
        : "";
      if (sourceDigest && revision !== null) {
        let coverageBindingFacts: ReviewedCoverageBindingFacts | null = null;
        try {
          coverageBindingFacts = buildReviewedCoverageBindingFacts(data);
        } catch (error) {
          // Never silently. Null here means no finalize binding is armed,
          // which leaves the Keeper in `review_ready` with only the producer
          // to call and no way to advance -- an infinite loop that ends in a
          // lost turn. Swallowing the reason turned a one-line diagnosis into
          // a three-hour one on 2026-09-02 (campaign amaranthine-loop: the
          // output context carried no `mechanics_summary`, so the binding
          // builder refused it as an incomplete canonical context).
          coverageBindingFacts = null;
          try {
            pi.appendEntry("coc-coverage-binding-unavailable", {
              schema_version: 1,
              status: "rejected",
              campaign_id: campaignId,
              turn_id: typeof data.turn_id === "string" ? data.turn_id : null,
              code: objectOrNull(error)?.code ?? "binding_context_invalid",
              message: String(
                (error as { message?: unknown } | null)?.message ?? error,
              ).slice(0, 240),
              consequence: "turn.finalize binding not armed for this turn",
            });
          } catch { /* audit is best effort */ }
        }
        const playerInput = objectOrNull(contractProjection?.player_input);
        const agencyAuthority = objectOrNull(
          contractProjection?.agency_authority,
        );
        const controlOverrides = Array.isArray(
          contractProjection?.control_overrides,
        )
          ? contractProjection.control_overrides.filter(
            (row): row is JsonObject => objectOrNull(row) !== null,
          ) as JsonObject[]
          : [];
        const journalDecisionId = typeof data.journal_decision_id === "string"
          ? data.journal_decision_id
          : semanticDecisionId("state.journal", 1);
        const finalizePrefilled = objectOrNull(
          finalizeCard?.prefilled_arguments,
        );
        const directFinalizeDecisionId = (
          directTypedFinalize
          && typeof finalizePrefilled?.decision_id === "string"
          && finalizePrefilled.decision_id === `${journalDecisionId}:finalize`
        ) ? finalizePrefilled.decision_id : null;
        retainedOutputContextFacts = (
          coverageBindingFacts === null
          || (directTypedFinalize && directFinalizeDecisionId === null)
        ) ? null : {
          root: typeof params.root === "string" && params.root
            ? params.root
            : currentWorkspaceRoot,
          campaign: campaignId,
          turnId: data.turn_id,
          sourceDigest,
          revision,
          journalDecisionId,
          finalizeDecisionId: directFinalizeDecisionId,
          narrationReviewId: null,
          playerInputSourceRef: typeof playerInput?.source_ref === "string"
            ? playerInput.source_ref
            : "",
          agencyAuthority: agencyAuthority ?? {},
          controlOverrides,
          coverageBindingFacts,
          reviewedAgencyBinding: null,
          directGenericFinalize,
          directTypedFinalize,
        };
        if (agencyReviewRequired && retainedOutputContextFacts !== null) {
          const retainedReviewBinding: TypedToolBindingCard = {
            schema_version: 1,
            operation: "narration.review",
            binding_revision: `narration-review:${data.turn_id}:revision-${revision}`,
            root: retainedOutputContextFacts.root,
            campaign: campaignId,
            decision_id: semanticDecisionId("narration.review", revision),
            turn_id: data.turn_id,
            source_digest: sourceDigest,
            revision,
            state_claim_compilation: {},
          };
          armTypedBinding(retainedReviewBinding, () => {
            const current = retainedOutputContextFacts;
            if (current === null || current.turnId !== data.turn_id) return null;
            return {
              schema_version: 1,
              operation: "narration.review",
              binding_revision: `narration-review:${current.turnId}:revision-${current.revision}`,
              root: current.root,
              campaign: current.campaign,
              decision_id: semanticDecisionId("narration.review", current.revision),
              turn_id: current.turnId,
              source_digest: current.sourceDigest,
              revision: current.revision,
              state_claim_compilation: {},
            };
          });
          if (hostHydrationObservationTransaction !== null) {
            overrides.hostHydrationObserverCheckpoint?.("binding");
          }
        } else if (directTypedFinalize && retainedOutputContextFacts !== null) {
          const retainedFinalizeBinding: TypedToolBindingCard = {
            schema_version: 1,
            operation: "turn.finalize",
            binding_revision: `turn-finalize-direct:${data.turn_id}:revision-${revision}`,
            root: retainedOutputContextFacts.root,
            campaign: campaignId,
            decision_id: retainedOutputContextFacts.finalizeDecisionId!,
            revision,
            turn_id: data.turn_id,
            source_digest: sourceDigest,
            narration_review_id: null,
            direct_single_draft: true,
          };
          armTypedBinding(retainedFinalizeBinding, () => {
            const current = retainedOutputContextFacts;
            if (
              current === null
              || current.turnId !== data.turn_id
              || current.finalizeDecisionId === null
              || current.directTypedFinalize !== true
            ) return null;
            return {
              schema_version: 1,
              operation: "turn.finalize",
              binding_revision:
                `turn-finalize-direct:${current.turnId}:revision-${current.revision}`,
              root: current.root,
              campaign: current.campaign,
              decision_id: current.finalizeDecisionId,
              revision: current.revision,
              turn_id: current.turnId,
              source_digest: current.sourceDigest,
              narration_review_id: null,
              direct_single_draft: true,
            };
          });
          if (hostHydrationObservationTransaction !== null) {
            overrides.hostHydrationObserverCheckpoint?.("binding");
          }
        }
      }
      advanceCanonicalProgress(campaignId, {
        stage: "output_context_ready",
        campaignRevision: Number.isInteger(data.manifest_revision)
          ? `manifest:${data.manifest_revision}`
          : canonicalProgress.campaignRevision,
        journalRevision: data.turn_id,
      }, {
        ...(canonicalProgress.stage === "faulted" && validatedLiveCards !== null
          ? {
              hostBindingRefresh: {
                kind: "host_binding_refresh" as const,
                operation: "turn.output_context" as const,
                turnId: validatedLiveCards.turnId,
                sourceDigest: validatedLiveCards.sourceDigest,
                outputRevision: validatedLiveCards.revision,
                sessionGeneration: sessionEpoch,
              },
            }
          : {}),
      });
      return;
    }
    if (operation === "narration.review") {
      // A successful review changes the authoritative pending-draft/review
      // identity even when the turn/source/revision tuple is unchanged. A
      // later resume must refetch that exact context; reusing the pre-review
      // hydration would re-advertise an already consumed review card.
      pendingFinalizationHydrationState = null;
      const facts = retainedOutputContextFacts;
      const reviewId = typeof data.review_id === "string"
        ? data.review_id
        : typeof data.narration_review_id === "string"
          ? data.narration_review_id
          : "";
      if (facts !== null && reviewId) {
        const revision = Number(data.revision ?? facts.revision);
        const rewriteRequired = (
          data.agency_gate === "rewrite_required"
          || data.state_authority_gate === "rewrite_required"
        );
        if (rewriteRequired) {
          // A review receipt can be successfully recorded while still
          // rejecting this exact prose. It is progress evidence, not
          // finalize authority. Retire revision-N bindings immediately; the
          // gateway refresh below will hydrate the canonical revision-N+1
          // output-context card before another visible review can execute.
          retainedOutputContextFacts = {
            ...facts,
            revision,
            finalizeDecisionId: null,
            narrationReviewId: null,
            reviewedAgencyBinding: null,
          };
          clearTypedBinding("turn.finalize");
          clearTypedBinding("narration.review");
          advanceCanonicalProgress(campaignId, {
            stage: "review_ready",
            reviewRevision: revision,
          });
          return;
        }
        const reviewArgs = objectOrNull(params.arguments);
        const reviewedDraft = typeof reviewArgs?.draft_text === "string"
          ? reviewArgs.draft_text
          : "";
        const semanticObligationRefs = semanticObligationRefsFor(
          facts.coverageBindingFacts,
          facts.campaign,
        );
        let reviewedAgencyBinding: ReviewedAgencyBinding | null = null;
        if (
          data.agency_gate === "clear"
          && data.state_authority_gate === "clear"
          && revision === facts.revision
          && data.turn_id === facts.turnId
          && data.source_digest === facts.sourceDigest
          && reviewArgs?.turn_id === facts.turnId
          && reviewArgs?.source_digest === facts.sourceDigest
          && reviewArgs?.revision === facts.revision
          && reviewedDraft
          && typeof data.draft_sha256 === "string"
          && data.draft_sha256 === canonicalJsonValueSha256(reviewedDraft)
          && semanticObligationRefs !== null
        ) {
          try {
            reviewedAgencyBinding = buildReviewedAgencyBinding({
              review_id: reviewId,
              revision,
              draft_sha256: data.draft_sha256,
              draft: reviewedDraft,
              state_authority_review: data.state_authority_review,
              player_input_source_ref: facts.playerInputSourceRef,
              agency_authority: facts.agencyAuthority,
              control_overrides: facts.controlOverrides,
              coverage_binding_facts: facts.coverageBindingFacts,
              semantic_obligation_refs: semanticObligationRefs,
            });
          } catch {
            reviewedAgencyBinding = null;
          }
        }
        if (reviewedAgencyBinding === null) {
          // A clear review without exact current span/authority binding cannot
          // safely expose finalize. Keep the settlement frozen; never fall
          // back to asking the model to transcribe exact reviewed evidence.
          retainedOutputContextFacts = {
            ...facts,
            revision,
            finalizeDecisionId: null,
            narrationReviewId: null,
            reviewedAgencyBinding: null,
          };
          clearTypedBinding("turn.finalize");
          advanceCanonicalProgress(campaignId, {
            stage: "review_ready",
            reviewRevision: revision,
          });
          return;
        }
        const finalizeDecisionId = semanticDecisionId("turn.finalize", revision);
        retainedOutputContextFacts = {
          ...facts,
          revision,
          finalizeDecisionId,
          narrationReviewId: reviewId,
          reviewedAgencyBinding,
        };
        const retainedFinalizeBinding: TypedToolBindingCard = {
          schema_version: 1,
          operation: "turn.finalize",
          binding_revision: `turn-finalize:${facts.turnId}:review-${revision}`,
          root: facts.root,
          campaign: facts.campaign,
          decision_id: finalizeDecisionId,
          revision,
          turn_id: facts.turnId,
          source_digest: facts.sourceDigest,
          narration_review_id: reviewId,
          reviewed_agency_binding: structuredClone(reviewedAgencyBinding),
        };
        armTypedBinding(retainedFinalizeBinding, () => {
          const current = retainedOutputContextFacts;
          if (
            current === null
            || current.finalizeDecisionId === null
            || current.narrationReviewId === null
          ) return null;
          return {
            schema_version: 1,
            operation: "turn.finalize",
            binding_revision: `turn-finalize:${current.turnId}:review-${current.revision}`,
            root: current.root,
            campaign: current.campaign,
            decision_id: current.finalizeDecisionId,
            revision: current.revision,
            turn_id: current.turnId,
            source_digest: current.sourceDigest,
            narration_review_id: current.narrationReviewId,
            ...(current.reviewedAgencyBinding === null
              ? {}
              : {
                  reviewed_agency_binding: structuredClone(
                    current.reviewedAgencyBinding,
                  ),
                }),
          };
        });
        clearTypedBinding("narration.review");
        advanceCanonicalProgress(campaignId, {
          stage: "review_ready",
          reviewRevision: revision,
        });
        // Durable host-owned accepted-review evidence. Recovery-card
        // rehydration authenticates a card's narration review identity
        // against this entry — card JSON alone is never trusted.
        try {
          pi.appendEntry(NARRATION_REVIEW_EVIDENCE_AUDIT, {
            schema_version: 1,
            campaign_id: campaignId,
            turn_id: facts.turnId,
            source_digest: facts.sourceDigest,
            revision,
            review_id: reviewId,
          });
        } catch { /* review evidence persistence is best effort */ }
      }
      return;
    }
    if (
      operation === "turn.finalize"
      && typeof data.rendered_text_sha256 === "string"
    ) {
      advanceCanonicalProgress(campaignId, {
        stage: "finalized",
        finalizedRenderedSha256: data.rendered_text_sha256,
        closedObligationCount: Array.isArray(data.obligation_ids)
          ? data.obligation_ids.length
          : canonicalProgress.closedObligationCount,
      });
      // An accepted finalize receipt is the only recovery completion: errors
      // and prose never reach this branch, so they never retire a card. The
      // exact-card tombstone is written only when the receipt AND the
      // host-injected finalize arguments correlate exactly with the stored
      // card — campaign, turn_id, source_digest, revision,
      // narration_review_id, and payload seal — and the in-memory card is
      // retired only after that exact tombstone append succeeded. An append
      // failure stays fail-closed: recovery remains pending and the host
      // never claims a durable retirement it did not achieve; rehydration
      // of the unretired durable card still cannot re-arm, because the
      // canonical probe of a finalized turn returns no unfinalized journal.
      const recoveryCard = campaignId
        ? draftShapeRecoveryCards.get(campaignId)
        : undefined;
      const finalizeArgs = objectOrNull(params.arguments);
      if (
        recoveryCard !== undefined
        && typeof data.source_digest === "string"
        && data.source_digest === recoveryCard.source_digest
        && finalizeArgs !== null
        && finalizeArgs.revision === recoveryCard.revision
        && finalizeArgs.narration_review_id
          === recoveryCard.narration_review_id
      ) {
        try {
          pi.appendEntry(DRAFT_SHAPE_RECOVERY_COMPLETE_AUDIT, {
            schema_version: 1,
            campaign_id: campaignId,
            turn_id: recoveryCard.turn_id,
            source_digest: recoveryCard.source_digest,
            revision: recoveryCard.revision,
            narration_review_id: recoveryCard.narration_review_id,
            payload_sha256: draftShapePayloadDigest(
              recoveryCard.frozen_finalize_payload,
            ),
            rendered_text_sha256: data.rendered_text_sha256,
          });
          // Durable retirement succeeded — only now is the in-memory card
          // cleared and recovery closure claimed.
          draftShapeRecoveryCards.delete(campaignId);
        } catch { /* recovery stays pending; no durable retirement claim */ }
      }
      const journaledAnchor = journaledOpenTurnAnchor;
      if (
        journaledAnchor?.campaignId === campaignId
        && currentWorkspaceRoot
      ) {
        clearOpenTurnPlayerInput(
          currentWorkspaceRoot,
          campaignId,
          journaledAnchor.anchor,
        );
      }
      if (
        journaledAnchor?.campaignId === campaignId
        && currentOpenTurnAnchor?.campaignId === campaignId
        && currentOpenTurnAnchor.anchor.anchor_digest
          === journaledAnchor.anchor.anchor_digest
        && typeof data.source_digest === "string"
        && /^sha256:[0-9a-f]{64}$/u.test(data.source_digest)
      ) {
        currentOpenTurnAnchor = {
          campaignId,
          anchor: createOpenTurnAnchor({
            timelineId: journaledAnchor.anchor.timeline_id,
            priorFinalizedTurn: journaledAnchor.turnNumber,
            priorFinalizedSourceDigest: data.source_digest,
          }),
        };
      } else {
        currentOpenTurnAnchor = null;
      }
      journaledOpenTurnAnchor = null;
      clearTurnTypedBindings();
      return;
    }
    if (operation === "npc.reaction") {
      const npcId = typeof data.npc_id === "string"
        ? data.npc_id.trim()
        : "";
      const investigatorId = typeof data.investigator_id === "string"
        ? data.investigator_id.trim()
        : "";
      const firstImpressionRef = typeof data.first_impression_ref === "string"
        ? data.first_impression_ref.trim()
        : "";
      const runId = typeof data.run_id === "string"
        ? data.run_id.trim()
        : "";
      const bindingRoot = typeof params.root === "string" && params.root
        ? params.root
        : currentWorkspaceRoot;
      if (
        campaignId && npcId && investigatorId && firstImpressionRef && runId
        && bindingRoot
      ) {
        const playerTurnEpoch = canonicalProgress.playerTurnEpoch;
        const decisionId = `npc-engagement-${campaignId}-${npcId}-1`;
        const binding: TypedToolBindingCard = {
          schema_version: 1,
          operation: "state.record_npc_engagement",
          binding_revision: (
            `npc-engagement:${campaignId}:${npcId}:player-epoch-${playerTurnEpoch}`
          ),
          root: bindingRoot,
          campaign: campaignId,
          decision_id: decisionId,
          npc_id: npcId,
          investigator: investigatorId,
          first_impression_ref: firstImpressionRef,
          run_id: runId,
        };
        armTypedBinding(binding, () => {
          if (
            canonicalProgressCampaignId !== campaignId
            || canonicalProgress.playerTurnEpoch !== playerTurnEpoch
          ) return null;
          return {
            schema_version: 1,
            operation: "state.record_npc_engagement",
            binding_revision: (
              `npc-engagement:${campaignId}:${npcId}:player-epoch-${playerTurnEpoch}`
            ),
            root: bindingRoot,
            campaign: campaignId,
            decision_id: decisionId,
            npc_id: npcId,
            investigator: investigatorId,
            first_impression_ref: firstImpressionRef,
            run_id: runId,
          };
        });
      }
      return;
    }
    if (operation === "npc.query") {
      armNpcEngagementBindingFromQuery(campaignId, params, data);
      observeNpcInteractionBindingsFromQuery(campaignId, params, envelope);
      return;
    }
    if (operation === "state.record_npc_engagement") {
      clearTypedBinding("state.record_npc_engagement");
      return;
    }
    if (operation === "scene.context") {
      armStructuredSceneBindings(campaignId, params, envelope);
      armNpcReactionBindingFromScene(campaignId, params, envelope);
      rearmSocialPsychologyBindings();
      return;
    }
    if (operation === "combat.context") {
      armStructuredCombatBinding(campaignId, params, envelope);
      return;
    }
    if (operation === "chase.context") {
      armStructuredChaseBinding(campaignId, params, envelope);
      return;
    }
    if (operation === "state.move_scene") {
      currentSceneBindingFacts = null;
      currentNpcInteractionBindingFacts = null;
      lastHealingCardProjection = null;
      retainedSceneAffordanceOperations = [];
      currentCombatBindingFacts = null;
      clearTypedBinding("state.move_scene");
      clearTypedBinding("state.advance_time");
      clearTypedBinding("combat.resolve");
      clearTypedBinding("rules.social_adjudicate");
      clearTypedBinding("rules.psychology_observe");
      applyKpActiveTools();
      return;
    }
    if (operation === "state.advance_time") {
      currentSceneBindingFacts = null;
      currentNpcInteractionBindingFacts = null;
      lastHealingCardProjection = null;
      clearTypedBinding("state.move_scene");
      clearTypedBinding("state.advance_time");
      clearTypedBinding("rules.social_adjudicate");
      clearTypedBinding("rules.psychology_observe");
      applyKpActiveTools();
      return;
    }
    if (operation === "combat.resolve") {
      currentCombatBindingFacts = null;
      clearTypedBinding("combat.resolve");
      applyKpActiveTools();
      return;
    }
    if (operation === "chase.execute") {
      currentChaseBindingFacts = null;
      clearTypedBinding("chase.execute");
      applyKpActiveTools();
      return;
    }
    if (operation === "evidence.table_opening") {
      clearTypedBinding("evidence.table_opening");
      return;
    }
    if (operation === "session.resume") {
      const nextOperations = Array.isArray(data.next_operations)
        ? data.next_operations.filter((item): item is string => typeof item === "string")
        : [];
      if (canonicalProgress.stage === "faulted") {
        const retainedFault = openingContinuationGate.currentTurnProcessingFault();
        // A pending-finalization resume advertises turn.finalize as the
        // canonical state machine's eventual next operation, while the host
        // recovery contract requires a fresh output-context receipt first.
        // Route the model-visible fault lane to that exact first host step;
        // exposing finalize here deadlocks on narration_review_required.
        faultRecoveryOperation = (
          data.mode === "pending_finalization"
          && retainedFault?.stage === "state_claim_compilation"
        )
          ? "turn.output_context"
          : nextOperations.find((candidate) => (
              OPERATION_POLICY[candidate] !== undefined
            )) ?? null;
        // The recovery lane offers an operation; it must also supply what that
        // operation needs from the host. Without this, a table opening that
        // failed once became unrecoverable: the fault routed the model straight
        // back to `evidence.table_opening` with no binding, so every retry
        // asked the Keeper for a `run_id` the circuit forbade it to invent,
        // and the Keeper could only tell the player to try again later.
        if (!armTableOpeningBinding(
          campaignId,
          params,
          typeof data.mode === "string" ? data.mode : "",
          nextOperations,
        )) {
          clearTypedBinding("evidence.table_opening");
        }
        applyKpActiveTools();
        return;
      }
      const mode = typeof data.mode === "string" ? data.mode : "";
      const resumedAnchor = validOpenTurnAnchor(data.open_turn_anchor)
        ? structuredClone(data.open_turn_anchor)
        : null;
      if (resumedAnchor !== null && campaignId) {
        currentOpenTurnAnchor = { campaignId, anchor: resumedAnchor };
        journaledOpenTurnAnchor = null;
      } else if (mode !== "already_acknowledged") {
        currentOpenTurnAnchor = null;
        journaledOpenTurnAnchor = null;
      }
      const resumedStage = mode === "pending_finalization"
        ? nextOperations.includes("narration.review")
          ? "output_context_ready"
          : nextOperations.includes("turn.finalize")
            ? "review_ready"
            : "journaled"
        : mode === "ending"
          ? "finalized"
          : mode === "table_opening"
          || mode === "open_turn_recovery"
          ? "acting"
          : "awaiting_player";
      advanceCanonicalProgress(campaignId, { stage: resumedStage });
      if (mode === "open_turn_recovery") {
        const currentTurn = objectOrNull(data.current_turn);
        const recoveryRoot = currentWorkspaceRoot;
        const zeroToolAccepted = currentTurn?.zero_tool_accepted_input === true;
        const recoveredPlayer = resumedAnchor === null
          ? { ok: false as const, code: "invalid_anchor" as const }
          : zeroToolAccepted
            ? loadZeroToolOpenTurnPlayerInput({
                root: recoveryRoot,
                campaignId,
                anchor: resumedAnchor,
              })
            : loadOpenTurnPlayerInput({
                root: recoveryRoot,
                campaignId,
                currentTurn,
                anchor: resumedAnchor,
              });
        if (recoveredPlayer.ok) {
          openingContinuationGate.currentExternalPlayerText = recoveredPlayer.card.text;
          armJournalBinding(campaignId);
          try {
            pi.appendEntry("coc-open-turn-player-input-rebound", {
              schema_version: 1,
              status: "rebound",
              campaign_id: campaignId,
              player_turn_epoch: canonicalProgress.playerTurnEpoch,
              source: "host_open_turn_input_cache",
            });
          } catch { /* recovery binding audit is best effort */ }
        } else if (
          resumedAnchor !== null
          && livePlayerMessageForOpenTurn !== null
          && livePlayerMessageForOpenTurn.campaignId === campaignId
        ) {
          // The durable cache is empty because the message arrived before this
          // process had an anchor. The player is right here and just spoke, so
          // adopt that message as the open turn's input rather than leaving the
          // table in a recovery it can never exit. Recorded durably now, so the
          // next restart recovers it the ordinary way, and audited as adopted
          // rather than recovered — the provenance difference is real.
          const adopted = recordOpenTurnPlayerInput({
            root: recoveryRoot,
            campaignId,
            sessionId: currentHostSessionId ?? "",
            playerTurnEpoch: canonicalProgress.playerTurnEpoch,
            text: livePlayerMessageForOpenTurn.text,
            anchor: resumedAnchor,
          });
          if (adopted === "recorded" || adopted === "replaced_stale" || adopted === "idempotent") {
            openingContinuationGate.currentExternalPlayerText =
              livePlayerMessageForOpenTurn.text;
            armJournalBinding(campaignId);
            try {
              pi.appendEntry("coc-open-turn-player-input-rebound", {
                schema_version: 1,
                status: "adopted_live_message",
                campaign_id: campaignId,
                player_turn_epoch: canonicalProgress.playerTurnEpoch,
                source: "live_player_message_after_restart",
              });
            } catch { /* recovery binding audit is best effort */ }
          } else {
            openingContinuationGate.currentExternalPlayerText = null;
            clearTypedBinding("state.journal");
          }
        } else {
          openingContinuationGate.currentExternalPlayerText = null;
          clearTypedBinding("state.journal");
          try {
            pi.appendEntry("coc-open-turn-player-input-rebound", {
              schema_version: 1,
              status: "unavailable",
              campaign_id: campaignId,
              player_turn_epoch: canonicalProgress.playerTurnEpoch,
              source: recoveredPlayer.code,
            });
          } catch { /* recovery binding audit is best effort */ }
        }
      }
      if (!armTableOpeningBinding(campaignId, params, mode, nextOperations)) {
        clearTypedBinding("evidence.table_opening");
      }
      const resumedSceneContext = objectOrNull(data.scene_context);
      if (resumedSceneContext !== null) {
        const sceneEnvelope = {
          ...envelope,
          data: resumedSceneContext,
        };
        armStructuredSceneBindings(campaignId, params, sceneEnvelope);
        armNpcReactionBindingFromScene(
          campaignId,
          params,
          sceneEnvelope,
          mode === "table_opening" ? `run-${campaignId}` : undefined,
        );
      }
    }
  };
  const resolveAclPhase = (campaignId?: string): PlayPhase => {
    // An active opening setup decides the phase before a pending startup
    // resume does. `recovery` describes an unclosed PLAY turn, and the
    // operations that answer it are play operations; a setup that has not
    // finished has none of them. Ordering the resume gate first deadlocked a
    // fresh campaign outright: chargen failed, the turn never closed, the
    // phase read `recovery`, and then `setup.complete` (cold_start/opening/
    // live_turn) and `progressive.prepare_opening` (opening) were both
    // phase-forbidden while every play operation was role-forbidden for
    // `setup`. Six operations tried, no way forward, and the table could
    // never open. Seen live on 2026-09-02 in campaign amaranthine-loop.
    const campaign = typeof campaignId === "string" ? campaignId : "";
    if (campaign && openingContinuationGate.hasActiveOpeningSetupFor(campaign)) {
      return "opening";
    }
    if (!campaign && openingContinuationGate.hasActiveOpeningSetup()) {
      return "opening";
    }
    if (startupResumeGate !== null && startupResumeGate.phase === "pending") {
      return "recovery";
    }
    return kpPlayPhase;
  };
  const structuredReceiptIdentity = (
    envelope: JsonObject,
  ): { revision: string; digest: string } | null => {
    const wire = objectOrNull(envelope.wire);
    const cache = objectOrNull(envelope.cache);
    const digest = typeof wire?.full_result_sha256 === "string"
      ? wire.full_result_sha256.trim()
      : "";
    const revision = typeof cache?.revision === "string" && cache.revision.trim()
      ? cache.revision.trim()
      : digest;
    return digest && revision ? { revision, digest } : null;
  };
  const sanityResumeIds = (
    choiceId: string,
    revision: number,
    action: "tick" | "end",
  ): { decisionId: string; commandId: string } => {
    // Byte-identical to coc_subsystem_executor._resume_ids: Python
    // json.dumps(sort_keys=True,separators=(",",":")) orders these keys as
    // action, choice_id, revision. The opaque digest remains host-only.
    const material = JSON.stringify({
      action,
      choice_id: choiceId,
      revision,
    });
    const digest = createHash("sha256").update(material).digest("hex");
    return {
      decisionId: `resume-${digest.slice(0, 32)}`,
      commandId: `resume:${digest}:confirm`,
    };
  };
  const sanityBoutCardFromFacts = (
    facts: SanityBoutBindingFacts,
  ): SanityBoutBindingCard => {
    const candidates: SanityBoutActionCandidate[] = facts.actions.map((action) => {
      const ids = sanityResumeIds(
        facts.choiceId,
        facts.choiceRevision,
        action,
      );
      return {
        action,
        kind: action === "tick" ? "bout_tick" : "bout_end",
        decision_id: ids.decisionId,
        command_id: ids.commandId,
      };
    });
    return {
      schema_version: 1,
      operation: "sanity.execute",
      binding_revision: (
        `sanity-bout:player-epoch-${facts.playerTurnEpoch}`
        + `:choice-revision-${facts.choiceRevision}`
      ),
      root: facts.root,
      campaign: facts.campaign,
      decision_id: candidates[0].decision_id,
      investigator: facts.investigatorId,
      bout_id: facts.boutId,
      choice_id: facts.choiceId,
      source_command_id: facts.sourceCommandId,
      choice_revision: facts.choiceRevision,
      candidates,
    };
  };
  const clearSanityBoutBinding = (): void => {
    currentSanityBoutBindingFacts = null;
    clearTypedBinding("sanity.execute");
  };
  const armSanityBoutBindingFromCanonical = (
    operation: string,
    campaignId: string,
    params: JsonObject,
    data: JsonObject,
  ): void => {
    const snapshot = objectOrNull(data.snapshot);
    const pendingValues = operation === "sanity.context"
      ? (Array.isArray(data.pending_choices) ? data.pending_choices : [])
      : (Array.isArray(data.results) ? data.results : []).flatMap((value) => {
        const row = objectOrNull(value);
        const pendingChoice = objectOrNull(row?.pending_choice);
        return pendingChoice === null ? [] : [pendingChoice];
      });
    const pending = pendingValues.map((row) => objectOrNull(row)).filter(
      (row): row is JsonObject => row !== null,
    ).filter((row) => (
      row.kind === "bout_keeper_action"
      && row.responder === "keeper"
    ));
    const existing = currentSanityBoutBindingFacts;
    const contextBase = operation === "sanity.context" ? {
      root: typeof params.root === "string" && params.root
        ? params.root
        : currentWorkspaceRoot,
      investigatorId: typeof data.investigator_id === "string"
        ? data.investigator_id.trim()
        : typeof snapshot?.investigator_id === "string"
          ? snapshot.investigator_id.trim()
          : "",
      boutId: typeof snapshot?.active_bout_id === "string"
        ? snapshot.active_bout_id.trim()
        : "",
    } : existing?.campaign === campaignId && bindingScopeMatches(existing)
      ? {
          root: existing.root,
          investigatorId: existing.investigatorId,
          boutId: existing.boutId,
        }
      : null;
    if (
      !campaignId
      || pending.length !== 1
      || contextBase === null
      || (
        operation === "sanity.context"
        && (
          data.active !== true
          || snapshot?.bout_active !== true
        )
      )
    ) {
      clearSanityBoutBinding();
      return;
    }
    const choice = pending[0];
    const choiceId = typeof choice.choice_id === "string"
      ? choice.choice_id.trim()
      : "";
    const sourceCommandId = typeof choice.command_id === "string"
      ? choice.command_id.trim()
      : "";
    const choiceRevision = Number(choice.revision);
    const options = Array.isArray(choice.options) ? choice.options : [];
    const optionActions = new Set(options.flatMap((value) => {
      const option = objectOrNull(value);
      return option?.action === "tick" || option?.action === "end"
        ? [option.action]
        : [];
    }));
    const actions = (["tick", "end"] as const).filter((action) => (
      optionActions.has(action)
    ));
    if (
      !contextBase.root
      || !choiceId
      || !sourceCommandId
      || !Number.isInteger(choiceRevision)
      || choiceRevision < 0
      || !contextBase.boutId
      || !contextBase.investigatorId
      || actions.length === 0
    ) {
      clearSanityBoutBinding();
      return;
    }
    const facts: SanityBoutBindingFacts = {
      sessionEpoch,
      playerTurnEpoch: canonicalProgress.playerTurnEpoch,
      stage: canonicalProgress.stage,
      phase: resolveAclPhase(campaignId),
      root: contextBase.root,
      campaign: campaignId,
      investigatorId: contextBase.investigatorId,
      boutId: contextBase.boutId,
      choiceId,
      sourceCommandId,
      choiceRevision,
      actions: [...actions],
    };
    currentSanityBoutBindingFacts = facts;
    armTypedBinding(sanityBoutCardFromFacts(facts), () => {
      const current = currentSanityBoutBindingFacts;
      if (
        current === null
        || current.campaign !== campaignId
        || !bindingScopeMatches(current)
      ) return null;
      return sanityBoutCardFromFacts(current);
    });
  };
  const rearmSocialPsychologyBindings = (): void => {
    const scene = currentSceneBindingFacts;
    const query = currentNpcInteractionBindingFacts;
    const clear = (): void => {
      clearTypedBinding("rules.social_adjudicate");
      clearTypedBinding("rules.psychology_observe");
    };
    if (
      scene === null
      || query === null
      || scene.campaign !== query.campaign
      || !bindingScopeMatches(scene)
      || !bindingScopeMatches(query)
    ) {
      clear();
      return;
    }
    const currentNpcIds = new Set(scene.npcIds);
    const candidates = query.candidates.filter((candidate) => (
      currentNpcIds.has(candidate.npcId)
    ));
    if (candidates.length === 0) {
      clear();
      return;
    }
    const card = (
      operation: "rules.social_adjudicate" | "rules.psychology_observe",
      currentScene: SceneBindingFacts,
      currentQuery: NpcInteractionBindingFacts,
    ): TypedToolBindingCard => {
      const rows = currentQuery.candidates
        .filter((candidate) => new Set(currentScene.npcIds).has(candidate.npcId))
        .filter((candidate) => (
          operation === "rules.social_adjudicate" || candidate.factRefs.length > 0
        ))
        .map((candidate) => ({
          candidate_id: `${operation === "rules.social_adjudicate"
            ? "social-target"
            : "psychology-target"}:${candidate.npcId}`,
          investigator: candidate.investigator,
          npc_id: candidate.npcId,
          conversation_window_id: (
            `conversation:${currentScene.activeSceneId}:${candidate.investigator}:${candidate.npcId}`
          ),
          ...(candidate.firstImpressionRef === undefined
            ? {}
            : { first_impression_ref: candidate.firstImpressionRef }),
          validated_fact_refs: structuredClone(candidate.factRefs),
          ...(operation === "rules.psychology_observe"
            ? { observation_revision: 0, observer_scope: candidate.investigator }
            : {}),
        }));
      const base = {
        schema_version: 1 as const,
        operation,
        binding_revision: (
          `${operation}:${currentScene.activeSceneId}:player-epoch-${currentScene.playerTurnEpoch}`
          + `:${currentScene.sourceRevision}:${currentScene.sourceDigest}`
          + `:${currentQuery.sourceRevision}:${currentQuery.sourceDigest}`
        ),
        root: currentScene.root,
        campaign: currentScene.campaign,
        decision_id: semanticDecisionId(operation),
        candidates: rows,
      };
      return operation === "rules.psychology_observe"
        ? {
            ...base,
            operation,
            realize_decision_id: semanticDecisionId(
              operation,
              canonicalProgress.canonicalProgressRevision + 2,
            ),
          }
        : base;
    };
    const arm = (operation: "rules.social_adjudicate" | "rules.psychology_observe") => {
      const initial = card(operation, scene, query);
      if (initial.candidates.length === 0) {
        clearTypedBinding(operation);
        return;
      }
      armTypedBinding(initial, () => {
        const currentScene = currentSceneBindingFacts;
        const currentQuery = currentNpcInteractionBindingFacts;
        if (
          currentScene === null
          || currentQuery === null
          || currentScene.campaign !== currentQuery.campaign
        ) return null;
        return card(
          operation,
          {
            ...currentScene,
            sessionEpoch,
            playerTurnEpoch: canonicalProgress.playerTurnEpoch,
            stage: canonicalProgress.stage,
            phase: resolveAclPhase(currentScene.campaign),
          },
          {
            ...currentQuery,
            sessionEpoch,
            playerTurnEpoch: canonicalProgress.playerTurnEpoch,
            stage: canonicalProgress.stage,
            phase: resolveAclPhase(currentQuery.campaign),
          },
        );
      });
      revokedSceneBindingOperations.delete(operation);
    };
    arm("rules.social_adjudicate");
    arm("rules.psychology_observe");
  };
  const observeNpcInteractionBindingsFromQuery = (
    campaignId: string,
    params: JsonObject,
    envelope: JsonObject,
  ): void => {
    const data = objectOrNull(envelope.data);
    const identity = structuredReceiptIdentity(envelope);
    const scene = currentSceneBindingFacts;
    if (!campaignId || data === null || identity === null) {
      currentNpcInteractionBindingFacts = null;
      rearmSocialPsychologyBindings();
      return;
    }
    const party = semanticRegistry.currentParty(registryScope(campaignId));
    const currentInvestigator = party.live && party.state === "single"
      ? party.investigatorId
      : "";
    const candidates = (Array.isArray(data.npcs) ? data.npcs : []).flatMap((entry) => {
      const row = objectOrNull(entry);
      const readiness = objectOrNull(row?.first_contact_readiness);
      const impression = objectOrNull(readiness?.requested_pair_first_impression);
      const npcId = typeof row?.npc_id === "string" ? row.npc_id.trim() : "";
      const observedInvestigator = typeof impression?.investigator_id === "string"
        ? impression.investigator_id.trim()
        : "";
      const investigator = observedInvestigator || currentInvestigator;
      if (!npcId || !investigator) return [];
      const factRefs = (Array.isArray(row?.facts) ? row.facts : []).flatMap((factValue) => {
        const fact = objectOrNull(factValue);
        const factId = typeof fact?.fact_id === "string" ? fact.fact_id.trim() : "";
        return factId ? [`npc_fact:${npcId}/${factId}`] : [];
      });
      const firstImpressionRef = (
        impression?.status === "settled"
        && impression.receipt_exists === true
        && typeof impression.first_impression_ref === "string"
      ) ? impression.first_impression_ref.trim() : "";
      return [{
        investigator,
        npcId,
        factRefs: [...new Set(factRefs)],
        ...(firstImpressionRef ? { firstImpressionRef } : {}),
      }];
    });
    const root = typeof params.root === "string" && params.root
      ? params.root
      : scene?.root ?? currentWorkspaceRoot;
    currentNpcInteractionBindingFacts = root ? {
      sessionEpoch,
      playerTurnEpoch: canonicalProgress.playerTurnEpoch,
      stage: canonicalProgress.stage,
      phase: resolveAclPhase(campaignId),
      root,
      campaign: campaignId,
      sourceRevision: identity.revision,
      sourceDigest: identity.digest,
      candidates,
    } : null;
    rearmSocialPsychologyBindings();
  };
  const sceneMoveCardFromFacts = (
    facts: SceneBindingFacts,
  ): TypedToolBindingCard => ({
    schema_version: 1,
    operation: "state.move_scene",
    binding_revision: `scene:${facts.activeSceneId}:player-epoch-${facts.playerTurnEpoch}:${facts.phase}:${facts.stage}`,
    root: facts.root,
    campaign: facts.campaign,
    decision_id: semanticDecisionId("state.move_scene"),
    source_revision: facts.sourceRevision,
    source_digest: facts.sourceDigest,
    selection_mode: facts.sceneSelectionMode,
    candidates: structuredClone(facts.sceneCandidates),
  });
  const advanceTimeCardFromFacts = (
    facts: SceneBindingFacts,
  ): TypedToolBindingCard => ({
    schema_version: 1,
    operation: "state.advance_time",
    binding_revision: `clock:${facts.activeSceneId}:player-epoch-${facts.playerTurnEpoch}:${facts.phase}:${facts.stage}`,
    root: facts.root,
    campaign: facts.campaign,
    decision_id: semanticDecisionId("state.advance_time"),
    clock_revision: facts.sourceRevision,
    clock_digest: facts.sourceDigest,
    clock_precision: facts.clockPrecision,
  });
  const combatResolveCardFromFacts = (
    facts: CombatBindingFacts,
  ): TypedToolBindingCard => ({
    schema_version: 1,
    operation: "combat.resolve",
    binding_revision: `combat:player-epoch-${facts.playerTurnEpoch}:${facts.phase}:${facts.stage}:revision-${facts.combatRevision}`,
    root: facts.root,
    campaign: facts.campaign,
    decision_id: semanticDecisionId("combat.resolve"),
    combat_revision: facts.combatRevision,
    combat_digest: facts.combatDigest,
    candidates: structuredClone(facts.candidates),
  });
  const chaseExecuteCardFromFacts = (
    facts: ChaseBindingFacts,
  ): TypedToolBindingCard => ({
    schema_version: 1,
    operation: "chase.execute",
    binding_revision: (
      `chase:${facts.chaseId}:revision-${facts.chaseRevision}`
    ),
    root: facts.root,
    campaign: facts.campaign,
    decision_id: facts.decisionId,
    investigator: facts.investigatorId,
    chase_id: facts.chaseId,
    chase_revision: facts.chaseRevision,
    chase_digest: facts.chaseDigest,
    candidates: structuredClone(facts.candidates),
  });
  const armStructuredChaseBinding = (
    campaignId: string,
    params: JsonObject,
    envelope: JsonObject,
  ): void => {
    const data = objectOrNull(envelope.data);
    const identity = structuredReceiptIdentity(envelope);
    const snapshot = objectOrNull(data?.snapshot);
    const chaseId = typeof snapshot?.chase_id === "string"
      ? snapshot.chase_id.trim()
      : "";
    const chaseRevision = Number(snapshot?.revision);
    const party = semanticRegistry.currentParty(registryScope(campaignId));
    const investigatorId = party.live && party.state === "single"
      ? party.investigatorId
      : "";
    const candidates = data === null
      ? []
      : deriveChaseActionCandidates(data);
    if (
      data?.active !== true
      || snapshot?.status !== "active"
      || identity === null
      || !chaseId
      || !Number.isInteger(chaseRevision)
      || chaseRevision < 1
      || !investigatorId
      || candidates.length === 0
    ) {
      currentChaseBindingFacts = null;
      clearTypedBinding("chase.execute");
      applyKpActiveTools();
      return;
    }
    const decisionId = `move-${chaseId}-revision-${chaseRevision}`;
    const facts: ChaseBindingFacts = {
      sessionEpoch,
      playerTurnEpoch: canonicalProgress.playerTurnEpoch,
      stage: canonicalProgress.stage,
      phase: resolveAclPhase(campaignId),
      root: typeof params.root === "string" && params.root
        ? params.root
        : currentWorkspaceRoot,
      campaign: campaignId,
      chaseId,
      chaseRevision,
      chaseDigest: identity.digest,
      investigatorId,
      decisionId,
      candidates,
    };
    currentChaseBindingFacts = facts;
    armTypedBinding(chaseExecuteCardFromFacts(facts), () => {
      const current = currentChaseBindingFacts;
      return current === null ? null : chaseExecuteCardFromFacts(current);
    });
    applyKpActiveTools();
  };
  const rearmCurrentCombatBinding = (campaignId: string): void => {
    const retained = currentCombatBindingFacts;
    if (
      retained === null
      || retained.sessionEpoch !== sessionEpoch
      || retained.campaign !== campaignId
      || retained.candidates.length === 0
    ) return;
    const facts: CombatBindingFacts = {
      ...retained,
      sessionEpoch,
      playerTurnEpoch: canonicalProgress.playerTurnEpoch,
      stage: canonicalProgress.stage,
      phase: resolveAclPhase(campaignId),
    };
    currentCombatBindingFacts = facts;
    armTypedBinding(combatResolveCardFromFacts(facts), () => {
      const current = currentCombatBindingFacts;
      return current !== null
        ? combatResolveCardFromFacts({
            ...current,
            sessionEpoch,
            playerTurnEpoch: canonicalProgress.playerTurnEpoch,
            stage: canonicalProgress.stage,
            phase: resolveAclPhase(current.campaign),
          })
        : null;
    });
    revokedSceneBindingOperations.delete("combat.resolve");
  };
  const armStructuredSceneBindings = (
    campaignId: string,
    params: JsonObject,
    envelope: JsonObject,
  ): void => {
    const data = objectOrNull(envelope.data);
    const identity = structuredReceiptIdentity(envelope);
    const activeSceneId = typeof data?.active_scene_id === "string"
      ? data.active_scene_id.trim()
      : "";
    const time = objectOrNull(data?.time);
    if (data === null || identity === null || !activeSceneId || time === null) {
      revokeSceneDerivedBindings();
      return;
    }
    const openSceneCandidates: SceneBindingFacts["sceneCandidates"] = [];
    const allSceneRoutes: SceneBindingFacts["sceneCandidates"] = [];
    const routeOrdinals = new Map<string, number>();
    const exactRoutes = new Set<string>();
    const sceneExitRows = Array.isArray(data.exits) ? data.exits : [];
    const hasOpenSceneRoute = sceneExitRows.some((row) => {
      const exit = objectOrNull(row);
      return exit?.open === true
        && typeof exit.to === "string"
        && Boolean(exit.to.trim());
    });
    for (const row of sceneExitRows) {
      const exit = objectOrNull(row);
      const sceneId = typeof exit?.to === "string" ? exit.to.trim() : "";
      if (!sceneId || (hasOpenSceneRoute && exit?.open !== true)) continue;
      const rawTravel = exit.travel_minutes;
      const hasTravelMinutes = Object.hasOwn(exit, "travel_minutes");
      if (
        hasTravelMinutes
        && (!Number.isInteger(rawTravel) || Number(rawTravel) < 0)
      ) {
        const error = new ToolContractProjectionError(
          "binding_context_invalid",
          "structured scene context travel_minutes must be absent or a non-negative integer",
          { field: "data.exits.travel_minutes" },
        );
        revokeSceneDerivedBindings();
        throw error;
      }
      const travelMinutes = hasTravelMinutes ? Number(rawTravel) : undefined;
      const kind = typeof exit.kind === "string" && exit.kind.trim()
        ? exit.kind.trim()
        : "route";
      const sourceIdentity = [exit.route_id, exit.edge_id, exit.id]
        .find((candidate) => (
          typeof candidate === "string"
          && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.trim())
        ));
      const exactIdentity = JSON.stringify({
        scene_id: sceneId,
        kind,
        ...(travelMinutes === undefined ? {} : { travel_minutes: travelMinutes }),
        when: exit.when ?? null,
        source_identity: sourceIdentity ?? null,
      });
      if (exactRoutes.has(exactIdentity)) {
        const error = new ToolContractProjectionError(
          "binding_context_invalid",
          "structured scene context contains an exact duplicate authored route",
          { field: "data.exits" },
        );
        revokeSceneDerivedBindings();
        throw error;
      }
      exactRoutes.add(exactIdentity);
      const routeScope = `${sceneId}\u0000${kind}`;
      const ordinal = (routeOrdinals.get(routeScope) ?? 0) + 1;
      routeOrdinals.set(routeScope, ordinal);
      const candidateId = typeof sourceIdentity === "string"
        ? `scene-route:${sceneId}:${sourceIdentity.trim()}`
        : `scene-route:${sceneId}:${kind}:${ordinal}`;
      const candidate = {
        candidate_id: candidateId,
        scene_id: sceneId,
        ...(travelMinutes === undefined ? {} : { travel_minutes: travelMinutes }),
      };
      allSceneRoutes.push(candidate);
      if (exit?.open === true) openSceneCandidates.push(candidate);
    }
    const npcIds = (Array.isArray(data.npcs_present) ? data.npcs_present : [])
      .flatMap((row) => {
        const npc = objectOrNull(row);
        const npcId = typeof npc?.npc_id === "string" ? npc.npc_id.trim() : "";
        return npcId ? [npcId] : [];
      });
    const routedCombatAffordanceIds = (
      Array.isArray(data.action_routes) ? data.action_routes : []
    ).flatMap((row) => {
      const route = objectOrNull(row);
      const routeId = typeof route?.route_id === "string"
        ? route.route_id.trim()
        : "";
      return routeId && route?.resolution_kind === "combat_engagement"
        ? [routeId]
        : [];
    });
    const keeperMechanics = objectOrNull(data.keeper_mechanics);
    const explicitAffordanceRows = (
      Array.isArray(keeperMechanics?.affordance_operations)
        ? keeperMechanics.affordance_operations
        : []
    );
    // Compiled scene archives expose affordance operations as structured
    // {affordance_id, kind, tool} rows. Retain the historical string form for
    // third-party producers, but do not silently discard the canonical object
    // form: these are the scene-authored tools the Keeper needs on the next
    // player turn.
    const explicitAffordanceOperations = explicitAffordanceRows.flatMap((entry) => {
      if (typeof entry === "string" && entry.trim()) return [entry.trim()];
      const row = objectOrNull(entry);
      const tool = typeof row?.tool === "string" ? row.tool.trim() : "";
      return tool ? [tool] : [];
    });
    const explicitCombatAffordanceIds = explicitAffordanceRows.flatMap((entry) => {
      const row = objectOrNull(entry);
      const affordanceId = typeof row?.affordance_id === "string"
        ? row.affordance_id.trim()
        : "";
      return affordanceId && row?.tool === "combat.resolve"
        ? [affordanceId]
        : [];
    });
    const rawPrecision = typeof time.time_precision === "string"
      ? time.time_precision
      : "";
    const clockPrecision = (
      rawPrecision === "precise"
      || rawPrecision === "exact"
      || (typeof time.local_datetime === "string" && time.local_datetime.trim())
    ) ? "precise" as const : "imprecise" as const;
    const sceneSelectionMode = openSceneCandidates.length > 0
      ? "current_candidates" as const
      : "manual_scene" as const;
    const facts: SceneBindingFacts = {
      sessionEpoch,
      playerTurnEpoch: canonicalProgress.playerTurnEpoch,
      stage: canonicalProgress.stage,
      phase: resolveAclPhase(campaignId),
      root: typeof params.root === "string" && params.root
        ? params.root
        : currentWorkspaceRoot,
      campaign: campaignId,
      sourceRevision: identity.revision,
      sourceDigest: identity.digest,
      activeSceneId,
      sceneSelectionMode,
      sceneCandidates: sceneSelectionMode === "current_candidates"
        ? openSceneCandidates
        : allSceneRoutes,
      clockPrecision,
      npcIds: [...new Set(npcIds)].sort(),
      combatAffordanceIds: [...new Set([
        ...routedCombatAffordanceIds,
        ...explicitCombatAffordanceIds,
      ])].sort(),
    };
    beginSceneDerivedBindingReplacement();
    try {
      currentSceneBindingFacts = facts;
      lastHealingCardProjection = {
        playerTurnEpoch: canonicalProgress.playerTurnEpoch,
        projection: data,
      };
      retainedSceneAffordanceOperations = [
        ...new Set([
          ...explicitAffordanceOperations,
          ...affordancesFromSanityTriggerProjection(data).map(
            (affordance) => affordance.operation,
          ),
        ]),
      ].sort();
      armTypedBinding(sceneMoveCardFromFacts(facts), () => {
        const current = currentSceneBindingFacts;
        return current !== null
          ? sceneMoveCardFromFacts({
              ...current,
              sessionEpoch,
              playerTurnEpoch: canonicalProgress.playerTurnEpoch,
              stage: canonicalProgress.stage,
              phase: resolveAclPhase(current.campaign),
            })
          : null;
      });
      armTypedBinding(advanceTimeCardFromFacts(facts), () => {
        const current = currentSceneBindingFacts;
        return current !== null
          ? advanceTimeCardFromFacts({
              ...current,
              sessionEpoch,
              playerTurnEpoch: canonicalProgress.playerTurnEpoch,
              stage: canonicalProgress.stage,
              phase: resolveAclPhase(current.campaign),
            })
          : null;
      });
      const combatCandidates: CombatBindingFacts["candidates"] = [
        ...facts.npcIds.map((npcId) => ({
          candidate_id: `attack:${npcId}`,
          invocation_mode: "target_npc_id" as const,
          target_npc_id: npcId,
        })),
        ...facts.combatAffordanceIds.map((affordanceId) => ({
          candidate_id: `combat-route:${affordanceId}`,
          invocation_mode: "affordance_id" as const,
          affordance_id: affordanceId,
        })),
      ];
      if (combatCandidates.length > 0) {
        currentCombatBindingFacts = {
          sessionEpoch,
          playerTurnEpoch: facts.playerTurnEpoch,
          stage: facts.stage,
          phase: facts.phase,
          root: facts.root,
          campaign: facts.campaign,
          combatRevision: facts.sourceRevision,
          combatDigest: facts.sourceDigest,
          candidates: combatCandidates,
        };
        armTypedBinding(
          combatResolveCardFromFacts(currentCombatBindingFacts),
          () => {
            const current = currentCombatBindingFacts;
            return current !== null
              ? combatResolveCardFromFacts({
                  ...current,
                  sessionEpoch,
                  playerTurnEpoch: canonicalProgress.playerTurnEpoch,
                  stage: canonicalProgress.stage,
                  phase: resolveAclPhase(current.campaign),
                })
              : null;
          },
        );
        revokedSceneBindingOperations.delete("combat.resolve");
      } else {
        refreshTypedToolDefinition("combat.resolve");
      }
      applyKpActiveTools();
      revokedSceneBindingOperations.delete("state.move_scene");
      revokedSceneBindingOperations.delete("state.advance_time");
    } catch (error) {
      revokeSceneDerivedBindings();
      throw error;
    }
  };
  const armNpcReactionBindingFromScene = (
    campaignId: string,
    params: JsonObject,
    envelope: JsonObject,
    runIdOverride?: string,
  ): void => {
    const data = objectOrNull(envelope.data);
    if (data === null || !campaignId) return;
    const party = (Array.isArray(data.party) ? data.party : [])
      .filter((value): value is string => (
        typeof value === "string"
        && value.trim().length > 0
        && value !== CURRENT_INVESTIGATOR_HANDLE
      ))
      .map((value) => value.trim());
    const partyRows = Array.isArray(data.party_investigators)
      ? data.party_investigators
      : [];
    for (const entry of partyRows) {
      const row = objectOrNull(entry);
      const id = typeof row?.investigator_id === "string"
        ? row.investigator_id.trim()
        : "";
      if (id && id !== CURRENT_INVESTIGATOR_HANDLE) party.push(id);
    }
    const exactParty = [...new Set(party)];
    let investigatorId = exactParty.length === 1 ? exactParty[0] : "";
    if (!investigatorId) {
      const retainedParty = semanticRegistry.currentParty(
        registryScope(campaignId),
      );
      if (
        retainedParty.live
        && retainedParty.state === "single"
        && retainedParty.investigatorId !== CURRENT_INVESTIGATOR_HANDLE
      ) {
        investigatorId = retainedParty.investigatorId;
      }
    }
    if (!investigatorId) {
      clearTypedBinding("npc.reaction");
      return;
    }
    const root = typeof params.root === "string" && params.root
      ? params.root
      : currentWorkspaceRoot;
    if (!root) return;
    const retained = retainedTypedBindings.get("npc.reaction");
    const runId = runIdOverride ?? (
      retained?.operation === "npc.reaction" ? retained.run_id : undefined
    );
    const card = (): TypedToolBindingCard => ({
      schema_version: 1,
      operation: "npc.reaction",
      binding_revision: `npc-reaction:${campaignId}:${investigatorId}`,
      root,
      campaign: campaignId,
      decision_id: `npc-reaction-binding:${campaignId}:${investigatorId}`,
      investigator: investigatorId,
      ...(runId === undefined ? {} : { run_id: runId }),
    });
    armTypedBinding(card(), () => (
      canonicalProgressCampaignId === campaignId ? card() : null
    ));
  };
  const armStructuredCombatBinding = (
    campaignId: string,
    params: JsonObject,
    envelope: JsonObject,
  ): void => {
    const data = objectOrNull(envelope.data);
    const identity = structuredReceiptIdentity(envelope);
    if (data === null || identity === null) return;
    const combat = objectOrNull(data.combat);
    const combatValue = objectOrNull(combat?.value);
    const pendingDefense = objectOrNull(data.pending_defense);
    const revisionValue = combatValue?.revision;
    const combatRevision = typeof revisionValue === "string" && revisionValue.trim()
      ? revisionValue.trim()
      : Number.isInteger(revisionValue)
        ? String(revisionValue)
        : identity.revision;
    const candidates: CombatBindingFacts["candidates"] = [];
    if (pendingDefense !== null) {
      const allowedDefenseValues = Array.isArray(pendingDefense.allowed_defenses)
        ? pendingDefense.allowed_defenses
        : [];
      const allowedDefenseKinds = allowedDefenseValues.filter((value): value is (
        "dodge" | "fight_back" | "dive_for_cover" | "none"
      ) => (
        value === "dodge"
        || value === "fight_back"
        || value === "dive_for_cover"
        || value === "none"
      ));
      if (
        allowedDefenseKinds.length === 0
        || allowedDefenseKinds.length !== allowedDefenseValues.length
        || new Set(allowedDefenseKinds).size !== allowedDefenseKinds.length
      ) {
        currentCombatBindingFacts = null;
        clearTypedBinding("combat.resolve");
        applyKpActiveTools();
        return;
      }
      const combatId = typeof combatValue?.combat_id === "string"
        ? combatValue.combat_id.trim()
        : "current";
      candidates.push({
        candidate_id: `defend-pending:${combatId}:revision-${combatRevision}`,
        invocation_mode: "pending_defense",
        allowed_defenses: allowedDefenseKinds,
      });
    } else {
      const scene = currentSceneBindingFacts;
      if (scene !== null && bindingScopeMatches(scene)) {
        for (const npcId of scene.npcIds) {
          candidates.push({
            candidate_id: `attack:${npcId}`,
            invocation_mode: "target_npc_id",
            target_npc_id: npcId,
          });
        }
        for (const affordanceId of scene.combatAffordanceIds) {
          candidates.push({
            candidate_id: `combat-route:${affordanceId}`,
            invocation_mode: "affordance_id",
            affordance_id: affordanceId,
          });
        }
      }
    }
    if (candidates.length === 0) {
      currentCombatBindingFacts = null;
      clearTypedBinding("combat.resolve");
      applyKpActiveTools();
      return;
    }
    const facts: CombatBindingFacts = {
      sessionEpoch,
      playerTurnEpoch: canonicalProgress.playerTurnEpoch,
      stage: canonicalProgress.stage,
      phase: resolveAclPhase(campaignId),
      root: typeof params.root === "string" && params.root
        ? params.root
        : currentWorkspaceRoot,
      campaign: campaignId,
      combatRevision,
      combatDigest: identity.digest,
      candidates,
    };
    currentCombatBindingFacts = facts;
    armTypedBinding(combatResolveCardFromFacts(facts), () => {
      const current = currentCombatBindingFacts;
      return current !== null
        ? combatResolveCardFromFacts({
            ...current,
            sessionEpoch,
            playerTurnEpoch: canonicalProgress.playerTurnEpoch,
            stage: canonicalProgress.stage,
            phase: resolveAclPhase(current.campaign),
          })
        : null;
    });
    revokedSceneBindingOperations.delete("combat.resolve");
    applyKpActiveTools();
  };
  const resolvedWorkingSetHostTools = (role: SessionRole): ModelVisibleHostTool[] => {
    const directFinalize = (
      canonicalProgress.stage === "output_context_ready"
      && retainedOutputContextFacts?.directGenericFinalize === true
    );
    const desiredNames = new Set(
      rulesDirectorSingleDraftProfileActive() && role === "play"
        ? (directFinalize ? ["coc_invoke"] : [])
        : [
            "coc_discover",
            "subagent",
            "await_subagent",
            "subagent_status",
            "subagent_result",
            ...(directFinalize ? ["coc_invoke"] : []),
            ...extraToolsForSessionRole(role),
          ],
    );
    if (typeof pi.getAllTools !== "function") {
      // Explicit compatibility lane for old focused ExtensionAPI fakes. The
      // production Pi runtime always resolves the registered definitions.
      return [...desiredNames].sort().map((name) => ({
        name,
        parameters: emptySchema,
      }));
    }
    return pi.getAllTools()
      .filter((tool) => desiredNames.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        parameters: tool.parameters as ModelVisibleHostTool["parameters"],
      }));
  };
  const workingSetSnapshot = (role: SessionRole): ToolWorkingSetSnapshot => {
    // Pass the campaign: the per-campaign branches of resolveAclPhase (an
    // active opening setup, or a campaign whose canonical status is still
    // `setup`) are skipped without one, and this snapshot is what the tool
    // working set gates every operation on. Calling it bare made a fresh
    // campaign's whole surface read `recovery` no matter what the campaign
    // itself said, which is how a failed chargen locked the table shut.
    const phase = resolveAclPhase(canonicalProgressCampaignId);
    const verifiedOpenTurnRecovery = (
      role === "play"
      && phase === "recovery"
      && canonicalProgress.stage === "acting"
      && openTurnRecoveryAuthorization !== null
      && openTurnRecoveryAuthorization.campaignId === canonicalProgressCampaignId
      && openTurnRecoveryAuthorization.sessionEpoch === sessionEpoch
      && openTurnRecoveryAuthorization.playerTurnEpoch
        === canonicalProgress.playerTurnEpoch
      && currentOpenTurnAnchor?.campaignId === canonicalProgressCampaignId
      && currentOpenTurnAnchor.anchor.anchor_digest
        === openTurnRecoveryAuthorization.anchorDigest
    );
    loadedNamespaces = loadedNamespaces.filter((grant) => (
      grant.role === role
      && grant.phase === phase
      && grant.stage === canonicalProgress.stage
      && grant.playerTurnEpoch === canonicalProgress.playerTurnEpoch
    ));
    loadedOperations = loadedOperations.filter((grant) => (
      grant.role === role
      && grant.phase === phase
      && grant.stage === canonicalProgress.stage
      && grant.playerTurnEpoch === canonicalProgress.playerTurnEpoch
    ));
    // The setup role is retired, so neither a retained `setup.complete` route
    // nor a fresh-setup quick start can be live in a play host.
    const retainedSetupComplete = false;
    const startupQuickStart = false;
    const healingAffordances = (
      lastHealingCardProjection !== null
      && lastHealingCardProjection.playerTurnEpoch === canonicalProgress.playerTurnEpoch
        ? affordancesFromHealingCardProjection(lastHealingCardProjection.projection)
        : []
    );
    return {
      role,
      phase,
      stage: canonicalProgress.stage,
      playerTurnEpoch: canonicalProgress.playerTurnEpoch,
      canonicalProgressRevision: canonicalProgress.canonicalProgressRevision,
      ...(
        role === "play" && rulesDirectorSingleDraftProfileActive()
          ? { acceptanceProfile: RULES_DIRECTOR_SINGLE_DRAFT_PROFILE as const }
          : {}
      ),
      roleManifestToolNames: extraToolsForSessionRole(role),
      hostTools: resolvedWorkingSetHostTools(role),
      affordances: {
        operations: [
          ...retainedSceneAffordanceOperations.map((operation) => ({
            operation,
            source: "scene" as const,
          })),
          ...(startupQuickStart
            ? [{ operation: "setup.quick_start", source: "host" as const }]
            : []),
          ...(retainedSetupComplete
            ? [{ operation: "setup.complete", source: "host" as const }]
            : []),
          ...healingAffordances,
        ],
      },
      loadedNamespaces,
      loadedOperations,
      boundOperations: [...retainedTypedBindings.keys()].sort(),
      ...(canonicalProgress.stage === "faulted" && faultRecoveryOperation !== null
        ? {
            recoveryRoute: {
              authorization: "fault" as const,
              code: "session_resume_authorized_recovery",
              operation: faultRecoveryOperation,
            },
          }
        : verifiedOpenTurnRecovery
          ? {
              recoveryRoute: {
                authorization: "stage" as const,
                code: "open_turn_pre_journal",
                operations: [],
              },
            }
          : {}),
    };
  };
  const withActualRegisteredSchemas = (
    projected: ToolWorkingSet,
  ): ToolWorkingSet => {
    if (!projected.ok || typeof pi.getAllTools !== "function") return projected;
    const definitions = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
    const operationToolNames = new Set(
      projected.activeOperationNames
        .map((operation) => typedToolByOperation.get(operation)?.name)
        .filter((name): name is string => typeof name === "string"),
    );
    let hostSchemaBytes = 0;
    let operationSchemaBytes = 0;
    const revisionRows: Array<{ name: string; parameters: unknown }> = [];
    for (const name of projected.activeToolNames) {
      const definition = definitions.get(name);
      let encoded: string | undefined;
      try { encoded = JSON.stringify(definition?.parameters); }
      catch { encoded = undefined; }
      if (definition === undefined || encoded === undefined) {
        return {
          ...projected,
          ok: false,
          activeToolNames: [],
          activeOperationNames: [],
          schemaBytes: 0,
          hostSchemaBytes: 0,
          operationSchemaBytes: 0,
          error: {
            code: "invalid_snapshot",
            message: `active tool ${name} has no currently registered serializable schema`,
            details: { missing_registered_tool: name },
          },
        };
      }
      const bytes = Buffer.byteLength(encoded, "utf8");
      if (operationToolNames.has(name)) operationSchemaBytes += bytes;
      else hostSchemaBytes += bytes;
      revisionRows.push({ name, parameters: definition.parameters });
    }
    revisionRows.sort((left, right) => left.name.localeCompare(right.name));
    const schemaRevision = createHash("sha256")
      .update(JSON.stringify(revisionRows), "utf8")
      .digest("hex")
      .slice(0, 24);
    return {
      ...projected,
      revision: `${projected.revision}:schemas-${schemaRevision}`,
      schemaBytes: hostSchemaBytes + operationSchemaBytes,
      hostSchemaBytes,
      operationSchemaBytes,
    };
  };
  const auditWorkingSet = (projected: ToolWorkingSet): void => {
    try {
      pi.appendEntry("coc-tool-working-set", {
        schema_version: 1,
        status: projected.ok ? "projected" : "rejected",
        revision: projected.revision,
        active_tool_count: projected.activeToolNames.length,
        schema_bytes: projected.schemaBytes,
        host_schema_bytes: projected.hostSchemaBytes,
        operation_schema_bytes: projected.operationSchemaBytes,
        role: effectiveTypedRole,
        launcher_role: launcherRole,
        phase: resolveAclPhase(),
        stage: canonicalProgress.stage,
        player_turn_epoch: canonicalProgress.playerTurnEpoch,
        canonical_progress_revision: canonicalProgress.canonicalProgressRevision,
        loaded_namespaces: loadedNamespaces.map((grant) => grant.namespace),
        loaded_operations: loadedOperations.map((grant) => grant.operation),
        reason_codes: [...new Set(projected.reasons.map((reason) => reason.code))],
        ...(projected.error === undefined ? {} : { error: projected.error }),
      });
    } catch { /* working-set audit is best effort */ }
  };
  // A DebugExperiment lane's first prompt is "resume and wait" — a turn with
  // nothing in it for the Keeper to do. Measured across five lanes on
  // 2026-09-02, the Keeper does it anyway: session.resume, scene.context,
  // state.journal, turn.output_context, turn.finalize, a whole turn nobody
  // asked for, burning the lane budget before the probe could seed anything.
  // Strengthening the prompt to "do not journal, do not finalize, this turn is
  // not yours to play" changed nothing, because a prompt IS a turn and the
  // model holds the full Keeper surface while it runs.
  //
  // So the restriction stops being a request. Until this lane has seen real
  // player input, the only tool bound is session.resume: the Keeper cannot
  // journal or finalize because it has nothing to do it with. Real tables are
  // untouched — they never get a do-nothing turn, because the host's startup
  // instruction is delivered with triggerTurn:false.
  // The lane's own resume prompt arrives as a user message too, so releasing
  // on "any user message" released it immediately — measured: the lane's first
  // op was session.resume (the restriction held) and everything after it ran
  // on the full surface. The host marks its own prompts; only an unmarked one
  // is the player's. The literal is duplicated in
  // plugins/coc-keeper/pi/bin/pi_coc_debug_experiment.py and pinned by
  // tests/pi/debug-lane-resume-surface.mjs.
  const DEBUG_LANE_HOST_PROMPT_MARKER = "[coc-debug-lane-host-prompt]";
  let debugLaneSawPlayerInput = false;
  const debugLaneResumeOnlySurface = (): string[] | null => {
    if (!debugLaneEnabled() || debugLaneSawPlayerInput) return null;
    const resume = typedToolByOperation.get("session.resume");
    return resume === undefined ? [] : [resume.name];
  };
  applyKpActiveTools = () => {
    // A pi-subagents child (PI_SUBAGENT_CHILD=1 on every child it spawns)
    // loads this ambient package extension too, but owns its own active
    // surface: the agent's --tools allowlist (steward agents carry
    // bash/read/grep/find on the host filesystem). Projecting the KP working
    // set there would wipe that allowlist — at session_start the closed
    // awaiting_player stage would leave the steward with no tools at all.
    if (process.env.PI_SUBAGENT_CHILD === "1") return;
    const resumeOnly = debugLaneResumeOnlySurface();
    if (resumeOnly !== null) {
      pi.setActiveTools(resumeOnly);
      return;
    }
    const role = effectiveTypedRole;
    if (operatorSystemInstructionScope !== null) {
      const operationTools = cocSystemInstructionOperations(role)
        .flatMap((operation) => {
          const definition = typedToolByOperation.get(operation);
          return definition === undefined ? [] : [definition.name];
        });
      pi.setActiveTools(operationTools);
      try {
        pi.appendEntry("coc-system-instruction-tool-scope", {
          schema_version: 1,
          contract_id: "coc.pi-system-instruction-tool-scope.v1",
          status: "active",
          source_type: operatorSystemInstructionScope.sourceType,
          role,
          player_turn_epoch: operatorSystemInstructionScope.playerTurnEpoch,
          operations: cocSystemInstructionOperations(role),
          active_tool_count: operationTools.length,
        });
      } catch { /* control-plane scope audit is best effort */ }
      return;
    }
    const gate = startupResumeGate;
    // Schema-time union only. Execute ACL still uses resolveAclPhase (recovery
    // while pending) and startupResumeToolError still hard-rejects non-resume.
    const tools = openingContinuationGate.hasPendingFinalizedOutput()
      ? []
      : noSelectorQuickStartRecovery !== null
        ? noSelectorQuickStartRecovery.retriesRemaining > 0
          ? [typedToolNameForOperation("setup.quick_start")]
          : []
      : startupSilentResumeQuarantine !== null
        // Silent settled startup resume: the quarantined remainder of the
        // auto-open agent turn must not reach any canonical tool.
        ? []
        : gate?.origin === "role_null_handoff"
          ? [typedToolNameForOperation("session.resume")]
          : gate !== null && gate.phase === "pending"
            ? activeToolsForStartupResumePending({
                workspaceRoot: gate.workspaceRoot,
                campaignId: gate.campaignId,
                fallbackPhase: kpPlayPhase,
                role,
              })
            : null;
    if (tools !== null) {
      pi.setActiveTools(tools);
      return;
    }
    const projected = withActualRegisteredSchemas(
      projectToolWorkingSet(workingSetSnapshot(role)),
    );
    lastWorkingSet = projected;
    auditWorkingSet(projected);
    if (projected.ok) {
      pi.setActiveTools([...projected.activeToolNames]);
      return;
    }
    pi.setActiveTools([]);
    if (
      canonicalProgress.playerTurnEpoch > 0
      && canonicalProgress.stage !== "faulted"
    ) {
      terminalizeTurnProcessingFault({
        schema_version: 1,
        contract_id: "coc.pi-turn-processing-fault.v1",
        kind: "turn_processing_fault",
        status: "terminal",
        stage: "tool_selection",
        code: projected.error?.code ?? "working_set_projection_failed",
        message: "tool working-set projection failed closed; the pending turn is preserved",
        retryable: false,
        will_retry: false,
        pending_turn_preserved: true,
        failure_class: "tool_selection",
      }, { deliver: false, reprojectTools: false });
    }
  };
  const emitSetupHandoff = (
    envelope: JsonObject | null,
    operation: string,
    params: JsonObject,
  ) => {
    const argumentsObject = objectOrNull(params.arguments);
    const campaignId = typeof params.campaign === "string"
      ? params.campaign
      : "";
    const decisionId = typeof argumentsObject?.decision_id === "string"
      ? argumentsObject.decision_id
      : "";
    const handoff = handoffFromEnvelope({
      ...(envelope ?? {}),
      operation,
    }, {
      campaignId,
      decisionId,
    });
    if (handoff === null) return;
    const payload = {
      type: "coc_setup_handoff",
      campaign_id: handoff.campaign_id,
      receipt: handoff.receipt,
      at: new Date().toISOString(),
      consumer: "pi-coc/same-process",
    };
    // A durable session-log record of the handoff. It no longer signals a
    // launcher: exit 42 and the setup role are retired, and the play host is
    // never the process that completed setup.
    try {
      pi.appendEntry("coc_setup_handoff", payload);
    } catch { /* session event-log is best effort */ }
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
  // Exact-delivery replay constants: the custom event is the player-visible
  // stream contract; the blocked set is the same-epoch mutation quarantine.
  const DELIVERY_REPLAY_CUSTOM_TYPE = "coc_delivery_replay";
  const deliveryReplayBlockedOperation = (operation: string): boolean => (
    operation === "narration.review"
    || operation === "turn.finalize"
    || operation.startsWith("state.")
    || operation.startsWith("rules.")
  );
  /**
   * Host-owned exact replay of the latest canonical delivery. The model's
   * typed call carries only the semantic replay request; the first canonical
   * request is semantic-only (campaign + mode, no in-memory arm required),
   * the machine-only identity returned by the first chunk is bound and
   * validated on every later chunk request and the replay ack, chunks stream
   * byte-for-byte as player-visible `coc_delivery_replay` events, and the
   * model-visible result carries no opaque identity.
   */
  const runExactDeliveryReplayLane = async (
    campaignId: string,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    epoch: number,
  ): Promise<JsonObject> => {
    deliveryReplayQuarantine = { campaignId };
    let offset: number | null = null;
    let totalBytes = 0;
    let chunkCount = 0;
    let finalizationId = "";
    let renderedSha256 = "";
    try {
      while (true) {
        const chunkArguments: JsonObject = offset === null
          ? { mode: "replay" }
          : {
            mode: "replay",
            text_offset: offset,
            finalization_id: finalizationId,
            rendered_sha256: renderedSha256,
          };
        const response = await client(ctx).callTool("coc_invoke", {
          operation: "session.delivery_text",
          campaign: campaignId,
          arguments: chunkArguments,
        }, signal);
        const envelope = objectOrNull(response);
        const data = envelope?.ok === true ? objectOrNull(envelope.data) : null;
        if (data === null || typeof data.text !== "string") {
          return {
            ok: false,
            tool: "session.delivery_text",
            error: {
              code: "delivery_replay_failed",
              message: (
                "逐字重放未能完成：规范交付块不可用或已漂移。可整次重试 "
                + "session.delivery_text mode=replay。"
              ),
              retryable: true,
            },
            warnings: [],
            hints: [],
          };
        }
        const chunkText = data.text;
        const returnedBytes = typeof data.returned_bytes === "number"
          ? data.returned_bytes
          : Buffer.byteLength(chunkText, "utf8");
        totalBytes = typeof data.total_bytes === "number"
          ? data.total_bytes
          : totalBytes;
        chunkCount = typeof data.chunk_count === "number"
          ? data.chunk_count
          : chunkCount;
        const responseFinalizationId = typeof data.finalization_id === "string"
          ? data.finalization_id
          : "";
        const responseRenderedSha256 = typeof data.rendered_sha256 === "string"
          ? data.rendered_sha256
          : "";
        if (!responseFinalizationId || !responseRenderedSha256) {
          return {
            ok: false,
            tool: "session.delivery_text",
            error: {
              code: "delivery_replay_failed",
              message: (
                "重放块缺少规范交付身份：无法绑定后续块请求；可整次重试。"
              ),
              retryable: true,
            },
            warnings: [],
            hints: [],
          };
        }
        if (!finalizationId) {
          // First chunk establishes the machine-bound canonical identity for
          // every later chunk request and the replay ack.
          finalizationId = responseFinalizationId;
          renderedSha256 = responseRenderedSha256;
        } else if (
          responseFinalizationId !== finalizationId
          || responseRenderedSha256 !== renderedSha256
        ) {
          return {
            ok: false,
            tool: "session.delivery_text",
            error: {
              code: "delivery_conflict",
              message: (
                "重放块序列返回了不一致的规范交付身份；已中止以避免混排两次交付。"
              ),
              retryable: true,
            },
            warnings: [],
            hints: [],
          };
        }
        const chunkOrdinal = typeof data.chunk_ordinal === "number"
          ? data.chunk_ordinal
          : 0;
        const isFinal = data.final === true;
        try {
          pi.sendMessage({
            customType: DELIVERY_REPLAY_CUSTOM_TYPE,
            content: chunkText,
            display: true,
            details: {
              schema_version: 1,
              kind: "coc_delivery_replay",
              campaign_id: campaignId,
              text: chunkText,
              chunk_ordinal: chunkOrdinal,
              chunk_count: chunkCount,
              chunk_bytes: returnedBytes,
              total_bytes: totalBytes,
              final: isFinal,
            },
          }, { triggerTurn: false });
        } catch {
          return {
            ok: false,
            tool: "session.delivery_text",
            error: {
              code: "delivery_replay_stream_failed",
              message: "逐字重放事件发送失败，本块未送达玩家；可整次重试。",
              retryable: true,
            },
            warnings: [],
            hints: [],
          };
        }
        if (isFinal) break;
        const nextOffset = data.next_offset;
        if (typeof nextOffset !== "number" || nextOffset <= offset) {
          return {
            ok: false,
            tool: "session.delivery_text",
            error: {
              code: "delivery_replay_failed",
              message: "逐字重放块序列中断：缺少有效的 next_offset；可整次重试。",
              retryable: true,
            },
            warnings: [],
            hints: [],
          };
        }
        offset = nextOffset;
      }
    } catch (error) {
      if (signal?.aborted) {
        return {
          ok: false,
          tool: "session.delivery_text",
          error: {
            code: "delivery_replay_aborted",
            message: "逐字重放被中止；本块未送达玩家。",
            retryable: true,
          },
          warnings: [],
          hints: [],
        };
      }
      void error;
      return {
        ok: false,
        tool: "session.delivery_text",
        error: {
          code: "delivery_replay_failed",
          message: "逐字重放传输失败；可整次重试 session.delivery_text mode=replay。",
          retryable: true,
        },
        warnings: [],
        hints: [],
      };
    }
    if (!isCurrent(epoch)) {
      return {
        ok: false,
        tool: "session.delivery_text",
        error: {
          code: "session_reset",
          message: "会话已在重放后重置；本结果不再属于当前回合。",
          retryable: false,
        },
        warnings: [],
        hints: [],
      };
    }
    let acknowledged = false;
    if (finalizationId && renderedSha256) {
      try {
        const ack = await client(ctx).callTool("coc_invoke", {
          operation: "session.delivery_ack",
          campaign: campaignId,
          arguments: {
            finalization_id: finalizationId,
            rendered_sha256: renderedSha256,
            ack_kind: "replayed",
            source_id: (
              `pi-delivery-replay:${campaignId}`
              + `:player-epoch-${canonicalProgress.playerTurnEpoch}`
            ),
            decision_id: semanticDecisionId("session.delivery_ack", 1),
          },
        }, signal);
        acknowledged = objectOrNull(ack)?.ok === true;
      } catch { /* ack is machine-owned and idempotent; retry is safe */ }
      if (!acknowledged) {
        try {
          pi.appendEntry("coc-delivery-replay-ack-failed", {
            schema_version: 1,
            campaign_id: campaignId,
            player_turn_epoch: canonicalProgress.playerTurnEpoch,
          });
        } catch { /* audit is best effort */ }
      }
    }
    return {
      ok: true,
      tool: "session.delivery_text",
      data: {
        schema_version: 1,
        mode: "replay",
        delivered: true,
        acknowledged,
        campaign_id: campaignId,
        chunk_count: chunkCount,
        total_bytes: totalBytes,
      },
      warnings: [],
      hints: [
        "the host streamed the exact canonical text; emit no additional "
        + "player-visible prose and no state/rules/journal/finalize calls",
      ],
    };
  };
  const deliverTurnProcessingFault = (fault: JsonObject): boolean => {
    try {
      pi.sendMessage({
        customType: TURN_PROCESSING_FAULT_CUSTOM_TYPE,
        content: JSON.stringify(fault),
        display: false,
        details: fault,
      }, { triggerTurn: false });
      return true;
    } catch {
      openingContinuationGate.releaseTurnProcessingFaultDelivery(fault);
      return false;
    }
  };
  terminalizeTurnProcessingFault = (
    fault: JsonObject,
    options: { deliver?: boolean; reprojectTools?: boolean } = {},
  ): JsonObject => {
    const armed = openingContinuationGate.armTurnProcessingFault(fault);
    faultRecoveryOperation = null;
    advanceCanonicalProgress(canonicalProgressCampaignId, {
      stage: "faulted",
    }, { reprojectTools: false });
    if (armed.first) {
      try { pi.appendEntry(TURN_PROCESSING_FAULT_CUSTOM_TYPE, armed.fault); }
      catch { /* terminal fault audit is best effort */ }
    }
    if (options.deliver !== false) {
      const deliverable = openingContinuationGate.takeTurnProcessingFaultForDelivery();
      if (deliverable !== null) deliverTurnProcessingFault(deliverable);
    }
    if (options.reprojectTools !== false) applyKpActiveTools();
    return armed.fault;
  };
  const malformedCanonicalSuccess = (
    operation: string,
    code: string,
    message: string,
  ): JsonObject => {
    const fault = terminalizeTurnProcessingFault({
      schema_version: 1,
      contract_id: "coc.pi-turn-processing-fault.v1",
      kind: "turn_processing_fault",
      status: "terminal",
      stage: "canonical_receipt_acceptance",
      code,
      message,
      retryable: false,
      will_retry: false,
      pending_turn_preserved: true,
      failure_class: "canonical_receipt_invalid",
      operation,
    });
    return {
      ok: false,
      tool: operation,
      isError: true,
      error: {
        code,
        message,
        retryable: false,
        details: fault,
      },
      retryable: false,
      will_retry: false,
    };
  };
  const acceptCanonicalStructuredResult = (
    operation: string,
    value: unknown,
  ): { value: JsonObject; accepted: boolean } => {
    const envelope = objectOrNull(value);
    if (envelope === null) {
      return {
        value: malformedCanonicalSuccess(
          operation,
          "canonical_result_invalid",
          "canonical result is not a structured envelope; the pending turn is preserved",
        ),
        accepted: false,
      };
    }
    if (envelope.ok !== true) return { value: envelope, accepted: false };
    const data = objectOrNull(envelope.data);
    if (operation === "turn.output_context") {
      const contractProjection = objectOrNull(data?.contract_projection);
      const agencyReviewRequired = contractProjection?.agency_review_required;
      const finalizeRevision = operationCardRevision(
        data?.finalize_operation,
        "turn.finalize",
      );
      const reviewRevision = operationCardRevision(
        data?.agency_review_operation,
        "narration.review",
      );
      const agencyReviewCardPresent = data !== null
        && Object.hasOwn(data, "agency_review_operation");
      const operationChainComplete = agencyReviewRequired === true
        ? reviewRevision !== null
          && finalizeRevision !== null
          && reviewRevision === finalizeRevision
        : agencyReviewRequired === false
          && !agencyReviewCardPresent
          && finalizeRevision !== null;
      const complete = (
        data !== null
        && typeof data.turn_id === "string" && data.turn_id.length > 0
        && typeof data.source_digest === "string" && data.source_digest.length > 0
        && typeof data.settlement_snapshot_id === "string"
        && data.settlement_snapshot_id.length > 0
        && typeof data.mechanics_bundle_sha256 === "string"
        && data.mechanics_bundle_sha256.length > 0
        && contractProjection !== null
        && operationChainComplete
      );
      if (!complete) {
        return {
          value: malformedCanonicalSuccess(
            operation,
            "output_context_receipt_invalid",
            "turn.output_context returned an incomplete authoritative receipt; the pending turn is preserved",
          ),
          accepted: false,
        };
      }
    }
    if (operation === "turn.finalize") {
      const renderedText = typeof data?.rendered_text === "string"
        ? data.rendered_text
        : "";
      const renderedSha256 = typeof data?.rendered_text_sha256 === "string"
        ? data.rendered_text_sha256
        : "";
      if (
        !renderedText
        || !renderedSha256
        || !openingContinuationGate.markFinalizedOutputReady(
          renderedText,
          renderedSha256,
        )
      ) {
        return {
          value: malformedCanonicalSuccess(
            operation,
            "finalization_receipt_invalid",
            "turn.finalize did not return and arm one complete digest-bound exact output; the pending turn is preserved",
          ),
          accepted: false,
        };
      }
    }
    if (operation === "session.resume" && data?.mode === "ending") {
      const ending = endingOutputFromReceipt({}, data);
      if (
        ending === null
        || !openingContinuationGate.markFinalizedOutputReady(
          ending.renderedText,
          ending.renderedSha256,
        )
      ) {
        return {
          value: malformedCanonicalSuccess(
            operation,
            "ending_receipt_invalid",
            "ending resume did not return and arm one complete digest-bound exact output; the pending ending is preserved",
          ),
          accepted: false,
        };
      }
    }
    return { value: envelope, accepted: true };
  };
  const refreshKeeperBriefing = async (
    ctx: ExtensionContext,
    campaignId: string,
    reason: KeeperBriefing["reason"],
    expectedSessionEpoch?: number,
  ): Promise<void> => {
    const briefing = await readKeeperBriefing(ctx.cwd, campaignId, reason);
    if (
      expectedSessionEpoch !== undefined
      && !isCurrent(expectedSessionEpoch)
    ) return;
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
  // Finalize-after asynchronous semantic memory extraction: one bounded
  // fire-and-forget derived worker. It never delays the canonical envelope,
  // never writes hard state/rules/transcript/output, and persists only
  // through the deterministic private Python host bridge.
  const startMemoryExtraction = (ctx: ExtensionContext, epoch: number) => {
    memoryExtractionDispatcher.start({
      isCurrent: () => isCurrent(epoch),
      workspaceRoot: () => resolve(ctx.cwd),
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
      launchExtractor: (task, launch, signal) => (
        overrides.launchMemoryExtractor?.(task, launch, signal)
        ?? spawnPiChild({ role: "memory-extractor", task, ...launch, signal })
      ),
      runHostBridge: overrides.runMemoryHostBridge
        ?? defaultRunMemoryHostBridge(memoryHostBridgeCommand, () => resolve(ctx.cwd)),
      appendAudit: (entry) => {
        try { pi.appendEntry("coc-memory-extraction-async", entry); }
        catch { /* audit is best effort */ }
      },
    });
  };
  // Re-arm durable pending extraction rows exactly once after a successful,
  // model-projectable session.resume. One read-only canonical status call,
  // fired off the critical path; never a polling loop and never a trigger
  // that interrupts player narration.
  const rearmPendingMemoryExtraction = (
    ctx: ExtensionContext,
    campaignId: string,
    epoch: number,
  ) => {
    if (!campaignId || !isCurrent(epoch)) return;
    if (memoryExtractionRearmedCampaigns.has(campaignId)) return;
    memoryExtractionRearmedCampaigns.add(campaignId);
    void (async () => {
      try {
        const response = await client(ctx).callTool("coc_invoke", {
          operation: "memory.extraction_status",
          campaign: campaignId,
          arguments: {},
        });
        if (!isCurrent(epoch)) return;
        const envelope = objectOrNull(response);
        if (envelope?.ok !== true) return;
        const data = objectOrNull(envelope.data);
        const rawEntries = Array.isArray(data?.entries) ? data.entries : [];
        const entries = rawEntries.flatMap((row) => {
          const entry = objectOrNull(row);
          const turn = entry?.turn_number;
          if (
            typeof entry?.backlog_id !== "string"
            || typeof entry?.timeline_id !== "string"
            || typeof turn !== "number"
            || !Number.isInteger(turn)
            || typeof entry?.status !== "string"
          ) return [];
          return [{
            backlog_id: entry.backlog_id,
            timeline_id: entry.timeline_id,
            turn_number: turn,
            status: entry.status,
          }];
        });
        memoryExtractionDispatcher.rearm(campaignId, entries);
      } catch {
        // Re-arm is best effort: the durable backlog row stays pending and
        // the next session boundary re-arms it again.
      }
    })();
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
        const customType = terminal.status === "waiting"
          ? "coc-raw-pdf-bind-first-bundle-wait"
          : "coc-raw-pdf-bind-first-bundle-terminal";
        sendCocSystemInstruction(pi, {
          sourceType: customType,
          customType,
          instruction: String(content.instruction),
          context: content,
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
      sendCocSystemInstruction(pi, {
        sourceType: "coc-opening-source-review-terminal",
        customType: "coc-opening-source-review-terminal",
        instruction: typeof content.instruction === "string"
          ? content.instruction
          : "Consume only this exact opening-source terminal continuation.",
        context: content,
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
      sendCocSystemInstruction(pi, {
        sourceType: "coc-steward-pending-refill",
        customType: "coc-steward-pending-refill",
        instruction: (
          "Consume this exact steward refill task through its documented "
          + "host lifecycle; it is not player input."
        ),
        context: task,
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
    // A new session epoch invalidates every registry record of the previous
    // epoch: handles are authoritative within one invocation lineage only.
    semanticRegistry.clearSession(sessionEpoch - 1);
    sessionClosing = false;
    currentWorkspaceRoot = resolve(ctx.cwd);
    currentHostSessionId = typeof ctx.sessionManager?.getSessionId === "function"
      ? String(ctx.sessionManager.getSessionId() || "")
      : "";
    canonicalProgressCampaignId = "";
    currentOpenTurnAnchor = null;
    journaledOpenTurnAnchor = null;
    openTurnRecoveryAuthorization = null;
    canonicalProgress = {
      playerTurnEpoch: 0,
      canonicalProgressRevision: 0,
      stage: "awaiting_player",
      campaignRevision: null,
      journalRevision: null,
      reviewRevision: null,
      finalizedRenderedSha256: null,
      closedObligationCount: 0,
    };
    loadedNamespaces = [];
    loadedOperations = [];
    retainedSceneAffordanceOperations = [];
    lastWorkingSet = null;
    faultRecoveryOperation = null;
    pendingFinalizationHydrationState = null;
    draftShapeRecoveryCards.clear();
    currentCombatBindingFacts = null;
    clearTurnTypedBindings();
    clearTypedBinding("npc.reaction");
    startupSilentResumeQuarantine = null;
    startupBranchTrailingPlayerUser = branchEndsWithUnmatchedPlayerUser(
      typeof ctx.sessionManager?.getBranch === "function"
        ? ctx.sessionManager.getBranch()
        : null,
    );
    openingContinuationGate.reset();
    noSelectorQuickStartRecovery = null;
    effectiveTypedRole = launcherRole ?? "setup";
    openingContinuationGate.setEffectiveTypedRole(effectiveTypedRole);
    nonRetryableFailureCircuit.reset();
    stateClaimCompiler.clear();
    startSemanticSupply(ctx, sessionEpoch);
    startMemoryExtraction(ctx, sessionEpoch);
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
    memoryExtractionRearmedCampaigns = new Set<string>();
    idleTakeoverAttempts = new Map<string, number>();
    idleTakeoverBusy = false;
    const startupCampaignId = overrides.startupCampaignId === undefined
      ? explicitPiStartupCampaignId()
      : overrides.startupCampaignId();
    startupResumeGate = startupCampaignId === null
      ? null
      : {
          origin: "startup_selector",
          campaignId: startupCampaignId,
          workspaceRoot: currentWorkspaceRoot,
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
    if (startupResumeGate !== null) {
      refreshTypedToolDefinition("session.resume");
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
  ): boolean => isExactStartupResumeParams(name, params, startupResumeGate);
  const bindStartupResumeInvocation = (
    name: string,
    params: JsonObject,
  ): JsonObject => bindStartupResumeParams(name, params, startupResumeGate);
  // A play host never creates a campaign. `pi-coc-setup` does that, and this
  // launcher refuses a campaign that is not ready, so the fresh-creation
  // predicates that used to let a startup-gated host run setup.quick_start or
  // campaign.create have no reachable state left.
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
      if (gate.origin === "role_null_handoff") {
        return (
          "Pi same-process setup handoff is terminally blocked "
          + `(failure_class=${gate.failureClass ?? "session_resume_failed"}). `
          + "Preserve the current campaign evidence and retry only session.resume."
        );
      }
      if (gate.failureClass === "resume_budget_exceeded") {
        // Not a launch-argument problem: the recovery payload exceeded the
        // fixed resume budget, which relaunching cannot change. Saying
        // "relaunch with the corrected --campaign" sent an operator after the
        // command line while a durable campaign sat unreachable.
        return (
          "Pi startup continuation is terminally blocked "
          + "(failure_class=resume_budget_exceeded). The campaign's canonical "
          + "state is intact and unchanged; the bounded recovery projection "
          + "does not fit the fixed resume budget, so relaunching reproduces "
          + "this exactly. This is a host-side reduction defect, not a "
          + "campaign selection or launch-argument problem."
        );
      }
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
      const roleNullHandoff = gate.origin === "role_null_handoff";
      pi.sendMessage({
        customType: "coc-startup-resume-blocker",
        content: roleNullHandoff
          ? (
              "【COC 交接受阻】设置收据已经保留，但同进程 session.resume 未能"
              + `接管战役（failure_class: ${failureClass}）。`
              + "不要重做设置或删除证据；仅修复并重试 session.resume。"
            )
          : (
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
          recovery: roleNullHandoff
            ? "retry_session_resume_without_repeating_setup"
            : "relaunch_with_corrected_campaign_selector",
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
    // ready_for_table after setup.complete (web respawn + launcher re-exec)
    "table_opening",
    // closed segment (state.end_session) resuming for post-ending
    // worldline bookkeeping (confluence/fork records): measured in the
    // worldline-accept-20260827 acceptance run — resuming an ended
    // campaign otherwise terminally quarantines the whole play epoch.
    "ending",
  ]);
  const classifyStartupResumeResult = (
    value: unknown,
    campaignId: string,
    openingObservation: OpeningSetupObservationDisposition,
  ): { accepted: true; mode: string | null } | { accepted: false; failureClass: string } => {
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
      return { accepted: true, mode: null };
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
      || typeof envelope.ok !== "boolean"
      || (
        typeof envelope.tool === "string"
        && envelope.tool.length > 0
        && !SESSION_RESUME_ENVELOPE_TOOLS.has(envelope.tool)
      )
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
      return { accepted: true, mode: data.mode };
    }
    const error = objectOrNull(envelope.error);
    const details = objectOrNull(error?.details);
    const openingPhase = details?.opening_phase;
    // opening_setup_incomplete on the selected campaign is an opening
    // lifecycle fact, not a wrong-campaign identity failure. Release the
    // startup gate when the canonical phase says setup is still in progress
    // so the KP can follow next_operation.
    if (
      error?.code === "opening_setup_incomplete"
      && typeof openingPhase === "string"
      && OPENING_LIFECYCLE_PHASES.has(openingPhase)
    ) {
      return { accepted: true, mode: null };
    }
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
      !hasRequiredKeys(details, [
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
        !hasRequiredKeys(details, [
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
      !hasRequiredKeys(details, [
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
    _name: string,
    params: JsonObject,
  ): StartupCanonicalFailureProjection => {
    if (!(error instanceof CanonicalToolError)) {
      return { kind: "not_canonical" };
    }
    const envelope = objectOrNull(error.envelope);
    const envelopeError = objectOrNull(envelope?.error);
    const envelopeDetails = objectOrNull(envelopeError?.details);
    const envelopeTool = typeof envelope?.tool === "string" ? envelope.tool : "";
    // Identify session.resume by the canonical operation and error code, not
    // by the host tool name. Typed `coc_session_resume` wraps into
    // coc_invoke, so CanonicalToolError.toolName is "coc_invoke" while the
    // registered execute name is "coc_session_resume".
    if (
      params.operation !== "session.resume"
      || envelope === null
      || envelope.ok !== false
      || !SESSION_RESUME_ENVELOPE_TOOLS.has(envelopeTool)
      || envelopeError === null
      || envelopeError.code !== error.code
      || error.details !== envelopeDetails
    ) {
      return { kind: "invalid" };
    }
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
  const publicSceneSupply = (supply: JsonObject): JsonObject => {
    const { background_takeover: _privateDispatch, ...visible } = supply;
    return visible;
  };
  const classifySceneSupplyDispatch = (
    value: unknown,
    dispatchKey?: string,
  ): SceneSupplyDispatchStatus => {
    const row = objectOrNull(value);
    const status = String(row?.status ?? "");
    const key = typeof row?.dispatch_key === "string" && row.dispatch_key.trim()
      ? row.dispatch_key.trim()
      : dispatchKey;
    if (["activating", "pending", "retrying", "submitted"].includes(status) && key) {
      return { status: "active", dispatchKey: key };
    }
    if (["completed", "terminal_failure"].includes(status)) {
      return {
        status: "terminal",
        ...(key ? { dispatchKey: key } : {}),
        ...(typeof row?.failure_class === "string"
          ? { failureClass: row.failure_class }
          : {}),
      };
    }
    return {
      status: "unavailable",
      failureClass: typeof row?.failure_class === "string"
        ? row.failure_class
        : "scene_supply_dispatch_unavailable",
    };
  };
  const sceneSupplyDispatchStatus = async (
    waitKey: string,
    supply: JsonObject,
    signal: AbortSignal | undefined,
    expectedSessionEpoch: number,
  ): Promise<SceneSupplyDispatchStatus | null> => {
    if (!isCurrent(expectedSessionEpoch)) return null;
    const retained = sceneSupplyDispatches.get(waitKey);
    if (retained?.status === "active") {
      const state = supplyCoordinator.activeManager()?.state(retained.dispatchKey);
      const current = classifySceneSupplyDispatch(state, retained.dispatchKey);
      if (!isCurrent(expectedSessionEpoch)) return null;
      sceneSupplyDispatches.set(waitKey, current);
      return current;
    }
    if (retained !== undefined) return retained;
    const task = findAutoDispatchTask({ ok: true, data: supply });
    const packet = objectOrNull(task?.packet);
    const dispatchKey = typeof packet?.packet_id === "string"
      ? packet.packet_id.trim()
      : "";
    if (task === null || !dispatchKey) {
      const unavailable: SceneSupplyDispatchStatus = {
        status: "unavailable",
        failureClass: task === null
          ? "scene_supply_dispatch_task_unavailable"
          : "scene_supply_dispatch_task_invalid",
      };
      if (!isCurrent(expectedSessionEpoch)) return null;
      sceneSupplyDispatches.set(waitKey, unavailable);
      return unavailable;
    }
    let submission: JsonObject | null;
    try {
      submission = await supplyCoordinator.autoDispatch(
        "coc_invoke",
        { ok: true, data: supply },
        { exactTask: task, priority: "scene", signal },
      );
    } catch {
      submission = {
        status: "unavailable",
        failure_class: "scene_supply_dispatch_failed",
        dispatch_key: dispatchKey,
      };
    }
    if (!isCurrent(expectedSessionEpoch)) return null;
    const classified = classifySceneSupplyDispatch(submission, dispatchKey);
    if (!isCurrent(expectedSessionEpoch)) return null;
    sceneSupplyDispatches.set(waitKey, classified);
    return classified;
  };
  const resolveSceneSupply = async (
    params: JsonObject,
    sceneId: string,
    initialSupply: JsonObject,
    signal: AbortSignal | undefined,
    checkMinimal: () => Promise<JsonObject | null>,
    expectedSessionEpoch: number,
  ) => {
    if (!isCurrent(expectedSessionEpoch)) return null;
    const campaignId = String(params.campaign ?? "").trim();
    const waitKey = `${campaignId}\u0000${sceneId}`;
    if (initialSupply.enforced !== true || initialSupply.ready === true) {
      if (!isCurrent(expectedSessionEpoch)) return null;
      sceneSupplyDispatches.delete(waitKey);
      return {
        supply: publicSceneSupply(initialSupply),
        decision: decideSceneSupply(initialSupply, {
          status: "unavailable",
          failureClass: "not_required",
        }),
        dispatch: null,
      };
    }
    const dispatch = await sceneSupplyDispatchStatus(
      waitKey,
      initialSupply,
      signal,
      expectedSessionEpoch,
    );
    if (!isCurrent(expectedSessionEpoch) || dispatch === null) return null;
    let supply = initialSupply;
    let decision = decideSceneSupply(supply, dispatch);
    if (decision.action === "retry_with_minimal") {
      const minimal = await checkMinimal();
      if (!isCurrent(expectedSessionEpoch)) return null;
      if (minimal !== null) {
        supply = minimal;
        decision = decideSceneSupply(supply, dispatch);
      }
    }
    if (decision.action === "allow") {
      if (!isCurrent(expectedSessionEpoch)) return null;
      sceneSupplyDispatches.delete(waitKey);
    }
    return { supply: publicSceneSupply(supply), decision, dispatch };
  };
  const sceneSupplyPreflight = async (
    params: JsonObject,
    signal: AbortSignal | undefined,
    ctx: ExtensionContext,
    expectedSessionEpoch: number,
  ): Promise<{ supply: JsonObject | null; blocked: JsonObject | null }> => {
    if (!isCurrent(expectedSessionEpoch)) return { supply: null, blocked: null };
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
        if (!isCurrent(expectedSessionEpoch)) return null;
        const envelope = objectOrNull(response);
        return envelope?.ok === true ? objectOrNull(envelope.data) : null;
      } catch {
        // A missing/older steward surface must not turn ordinary play into a
        // host failure. A configured supply gate is enforced only on a valid
        // canonical readiness answer.
        return null;
      }
    };
    const initialSupply = await check(false);
    if (!isCurrent(expectedSessionEpoch)) return { supply: null, blocked: null };
    if (initialSupply === null) return { supply: null, blocked: null };
    const resolved = await resolveSceneSupply(
      params,
      sceneId,
      initialSupply,
      signal,
      () => check(true),
      expectedSessionEpoch,
    );
    if (!isCurrent(expectedSessionEpoch) || resolved === null) {
      return { supply: null, blocked: null };
    }
    if (resolved.decision.action === "allow") {
      return { supply: resolved.supply, blocked: null };
    }
    const isBlocked = resolved.decision.action === "blocked";
    const content = {
      schema_version: 1,
      contract_id: isBlocked
        ? "coc.pi-scene-supply-blocked.v1"
        : "coc.pi-scene-supply-wait.v1",
      audience: "keeper_only",
      scene_id: sceneId,
      campaign_id: campaignId,
      host_gate_status: isBlocked ? "blocked" : "pending_with_live_dispatch",
      source_cache_path: resolved.supply.source_cache_path,
      instruction: resolved.decision.instruction,
    };
    try {
      if (!isCurrent(expectedSessionEpoch)) return { supply: null, blocked: null };
      pi.sendMessage({
        customType: isBlocked ? "coc-scene-supply-blocked" : "coc-scene-supply-wait",
        content: JSON.stringify(content),
        display: false,
        details: content,
      }, { triggerTurn: false });
      if (!isCurrent(expectedSessionEpoch)) return { supply: null, blocked: null };
      pi.appendEntry("coc-scene-supply-gate", content);
    } catch { /* hidden scene-supply guidance/audit is best effort */ }
    if (!isCurrent(expectedSessionEpoch)) return { supply: null, blocked: null };
    return {
      supply: resolved.supply,
      blocked: {
        ok: false,
        tool: "state.move_scene",
        error: {
          code: isBlocked ? "scene_supply_blocked" : "scene_supply_pending",
          message: isBlocked
            ? "the way ahead remains unestablished; keep the response in fiction and offer established leads"
            : "the way ahead is not yet established; keep the response in fiction and settle only independent action",
        },
        data: {
          scene_supply: resolved.supply,
          host_gate_status: isBlocked ? "blocked" : "pending_with_live_dispatch",
          instruction: resolved.decision.instruction,
        },
      },
    };
  };
  const observeHydratedOutputContextTransaction = (args: {
    campaign: string;
    liveParams: JsonObject;
    envelope: JsonObject;
    cards: LiveOutputContextCards;
    isAttemptCurrent: () => boolean;
  }): void => {
    const { campaign, liveParams, envelope, cards, isAttemptCurrent } = args;
    if (!isAttemptCurrent()) throw new Error("live_output_context_superseded");
    const compilerRetained = Reflect.get(
      stateClaimCompiler as object,
      "retained",
    );
    if (!(compilerRetained instanceof Map)) {
      throw new Error("state_claim_compiler_hydration_transaction_unavailable");
    }
    const compilerHadCampaign = compilerRetained.has(campaign);
    const compilerCampaignValue = compilerRetained.get(campaign);
    const retainedFactsSnapshot = retainedOutputContextFacts;
    const bindingSnapshot = new Map(retainedTypedBindings);
    const bindingFactorySnapshot = new Map(currentTypedBindingFactories);
    const progressSnapshot = { ...canonicalProgress };
    const progressCampaignSnapshot = canonicalProgressCampaignId;
    const faultRecoverySnapshot = faultRecoveryOperation;
    const loadedNamespacesSnapshot = [...loadedNamespaces];
    const loadedOperationsSnapshot = [...loadedOperations];
    const workingSetSnapshotValue = lastWorkingSet;
    const circuitSnapshot = nonRetryableFailureCircuit
      .captureHostHydrationState(campaign);
    const transaction = {
      audits: [] as Array<{ name: string; value: JsonObject }>,
      bindingRefreshes: new Set<string>(),
      reprojectTools: false,
    };
    hostHydrationObservationTransaction = transaction;
    let committed = false;
    try {
      if (cards.agencyReviewRequired) {
        stateClaimCompiler.observeOutputContext(campaign, envelope);
        overrides.hostHydrationObserverCheckpoint?.("compiler");
      }
      observeCanonicalProgress(
        "turn.output_context",
        liveParams,
        envelope,
        cards,
      );
      nonRetryableFailureCircuit.observe({
        campaignId: campaign,
        operation: "turn.output_context",
        phase: resolveAclPhase(campaign),
        operationArgs: {},
        envelope,
        playerTurnEpoch: canonicalProgress.playerTurnEpoch,
        canonicalProgress,
      });
      overrides.hostHydrationObserverCheckpoint?.("progress");
      if (!isAttemptCurrent()) throw new Error("live_output_context_superseded");
      for (const operation of transaction.bindingRefreshes) {
        refreshTypedToolDefinition(operation);
      }
      if (transaction.reprojectTools) applyKpActiveTools();
      hostHydrationObservationTransaction = null;
      for (const audit of transaction.audits) {
        try { pi.appendEntry(audit.name, audit.value); }
        catch { /* observation audit is best effort */ }
      }
      committed = true;
    } finally {
      hostHydrationObservationTransaction = null;
      if (!committed) {
        if (compilerHadCampaign) {
          compilerRetained.set(campaign, compilerCampaignValue);
        } else {
          compilerRetained.delete(campaign);
        }
        retainedOutputContextFacts = retainedFactsSnapshot;
        retainedTypedBindings.clear();
        for (const [operation, binding] of bindingSnapshot) {
          retainedTypedBindings.set(operation, binding);
        }
        currentTypedBindingFactories.clear();
        for (const [operation, factory] of bindingFactorySnapshot) {
          currentTypedBindingFactories.set(operation, factory);
        }
        canonicalProgress = progressSnapshot;
        canonicalProgressCampaignId = progressCampaignSnapshot;
        faultRecoveryOperation = faultRecoverySnapshot;
        loadedNamespaces = loadedNamespacesSnapshot;
        loadedOperations = loadedOperationsSnapshot;
        lastWorkingSet = workingSetSnapshotValue;
        nonRetryableFailureCircuit.restoreHostHydrationState(circuitSnapshot);
        const refreshes = new Set([
          ...transaction.bindingRefreshes,
          ...bindingSnapshot.keys(),
        ]);
        for (const operation of refreshes) {
          try { refreshTypedToolDefinition(operation); }
          catch { /* restored host maps remain authoritative */ }
        }
        if (transaction.reprojectTools) {
          try { applyKpActiveTools(); }
          catch { /* restored observer state remains authoritative */ }
        }
      }
    }
  };

  // Host-owned live output-context hydration for an accepted
  // pending-finalization resume whose canonical snapshot carries no valid
  // inline card chain (the real pointer-only recovery shape). One bounded
  // read-only turn.output_context typed invocation through the existing
  // transport — never a recursive gateway() call. The validated receipt is
  // fed through the same compiler/binding/progress observation path as an
  // explicit canonical output-context call, so a later narration.review
  // does not fail with state_claim_compiler_context_missing. Coalesces
  // concurrent and repeated handling of the same unresolved pending
  // identity (success and failure both cache); a changed identity gets one
  // new fetch. Cancellation, stale sessions, transport errors, invalid
  // receipts, identity mismatch, and observer failure return `unavailable`
  // with no retry and no cards — the card-free pointer guidance remains the
  // model's path, and no turn-processing fault is ever latched for this
  // private read. Never invokes narration.review or turn.finalize, never
  // retries model actions, never creates a player epoch, never mutates
  // campaign state or output gates.
  const runPendingFinalizationHydration = (args: {
    resumeValue: JsonObject;
    campaign: string;
    root: string;
    ctx: ExtensionContext;
    signal: AbortSignal | undefined;
    epoch: number;
    /**
     * Optional pending-turn identity override for a resume envelope that
     * carries no `pending_output_context` (an already-acknowledged lifecycle
     * no-op): the identity comes from the persisted draft-shape recovery
     * card, and the live receipt must correlate with exactly that identity.
     */
    pendingIdentity?: {
      turnId: string;
      sourceDigest: string;
      revision: number | null;
    };
  }): Promise<PendingFinalizationHydration> => {
    const { resumeValue, campaign, root, ctx, signal, epoch } = args;
    const resumeData = objectOrNull(resumeValue.data);
    const pendingIdentity = args.pendingIdentity ?? null;
    const pendingContext = pendingIdentity !== null
      ? {
          turn_id: pendingIdentity.turnId,
          source_digest: pendingIdentity.sourceDigest,
          ...(pendingIdentity.revision === null
            ? {}
            : { revision: pendingIdentity.revision }),
        }
      : objectOrNull(resumeData?.pending_output_context);
    const pendingTurnId = typeof pendingContext?.turn_id === "string"
      && pendingContext.turn_id
      ? pendingContext.turn_id
      : "";
    const pendingSourceDigest = typeof pendingContext?.source_digest === "string"
      && pendingContext.source_digest
      ? pendingContext.source_digest
      : "";
    const pendingRevision = Number.isInteger(pendingContext?.revision)
      && Number(pendingContext?.revision) > 0
      ? Number(pendingContext?.revision)
      : null;
    const pendingKey = pendingTurnId || pendingSourceDigest || pendingRevision !== null
      ? JSON.stringify({
          kind: "pending_identity",
          turn: pendingTurnId || null,
          source: pendingSourceDigest || null,
          revision: pendingRevision,
        })
      : JSON.stringify({ kind: "identity_less" });
    const latch = pendingFinalizationHydrationState;
    if (
      latch !== null
      && latch.campaign === campaign
      && latch.pendingKey === pendingKey
      && latch.sessionEpoch === epoch
      && latch.playerTurnEpoch === canonicalProgress.playerTurnEpoch
    ) {
      if (latch.outcome !== null) {
        // Cached outcome: guidance re-projects from the compact validated
        // cards; the observations from the first attempt remain in force
        // within this identity/epoch/session window.
        return latch.outcome.status === "success"
          ? { status: "success", cards: latch.outcome.cards }
          : { status: "unavailable" };
      }
      if (latch.inFlight !== null) return latch.inFlight;
    }
    // Caller-local cancellation before invocation: no fetch, no latch
    // interaction, no cards. (Checked outside the attempt so an aborted
    // caller never installs a resolved in-flight promise for its identity.)
    if (signal?.aborted) return { status: "unavailable" };
    const entry: {
      campaign: string;
      pendingKey: string;
      playerTurnEpoch: number;
      sessionEpoch: number;
      inFlight: Promise<PendingFinalizationHydration> | null;
      outcome:
        | { status: "success"; cards: LiveOutputContextCards }
        | { status: "unavailable" }
        | null;
    } = {
      campaign,
      pendingKey,
      playerTurnEpoch: canonicalProgress.playerTurnEpoch,
      sessionEpoch: epoch,
      inFlight: null,
      outcome: null,
    };
    const isAttemptOwnerCurrent = (): boolean => (
      pendingFinalizationHydrationState === entry
      && entry.campaign === campaign
      && entry.pendingKey === pendingKey
      && entry.playerTurnEpoch === canonicalProgress.playerTurnEpoch
      && entry.sessionEpoch === epoch
    );
    const isAttemptCurrent = (): boolean => (
      isAttemptOwnerCurrent()
      && signal?.aborted !== true
      && isCurrent(epoch)
    );
    const auditHydration = (status: string, cards: LiveOutputContextCards | null): void => {
      try {
        pi.appendEntry("coc-pending-finalization-live-context", {
          schema_version: 1,
          status,
          campaign_id: campaign,
          ...(cards !== null ? { turn_id: cards.turnId } : {}),
          ...(pendingTurnId ? { pending_turn_id: pendingTurnId } : {}),
          ...(cards !== null
            ? {
                operation_cards: {
                  agency_review_operation: cards.reviewCard !== null,
                  finalize_operation: true,
                },
              }
            : {}),
        });
      } catch { /* hydration audit is best effort */ }
    };
    const attempt = (async (): Promise<PendingFinalizationHydration> => {
      try {
        const liveParams = wrapTypedToolInvokeParams(
          typedToolNameForOperation("turn.output_context"),
          { root, campaign },
        ) as JsonObject;
        // The MCP transport bounds this read (head-request hang timer plus
        // the caller's abort signal); the host adds no second timeout lane.
        const fetched = await client(ctx).callToolWithTransportMeta(
          "coc_invoke",
          liveParams,
          signal,
        );
        // First post-transport ownership check: a superseded attempt cannot
        // even validate or cache against the new pending identity.
        if (signal?.aborted) return { status: "unavailable" };
        if (!isCurrent(epoch) || !isAttemptOwnerCurrent()) {
          return { status: "superseded" };
        }
        const envelope = objectOrNull(fetched.value);
        if (envelope === null) throw new Error("live_output_context_invalid");
        const cards = validateLiveOutputContext(
          envelope,
          pendingIdentity !== null
            ? { ...(resumeData ?? {}), pending_output_context: pendingContext }
            : resumeData,
        );
        if (cards === null) throw new Error("live_output_context_invalid");
        // Second ownership check is immediately before the all-or-nothing
        // observer transaction. No stale attempt may create compiler facts,
        // bindings, progress, circuit state, audits, or keeper cards.
        if (signal?.aborted) return { status: "unavailable" };
        if (!isCurrent(epoch) || !isAttemptOwnerCurrent()) {
          return { status: "superseded" };
        }
        observeHydratedOutputContextTransaction({
          campaign,
          liveParams,
          envelope,
          cards,
          isAttemptCurrent,
        });
        if (signal?.aborted) return { status: "unavailable" };
        if (!isCurrent(epoch) || !isAttemptOwnerCurrent()) {
          return { status: "superseded" };
        }
        entry.outcome = { status: "success", cards };
        auditHydration("refreshed", cards);
        return { status: "success", cards };
      } catch {
        // Genuine fetch/validation/observer failure for this identity:
        // fail closed, cache the failure, no error dumps.
        entry.outcome = { status: "unavailable" };
        auditHydration("unavailable", null);
        return { status: "unavailable" };
      } finally {
        entry.inFlight = null;
      }
    })();
    entry.inFlight = attempt;
    pendingFinalizationHydrationState = entry;
    return attempt;
  };
  // Rebuild the ordinary reviewed-agency finalize binding after successful
  // live hydration. Identity comes from the exact frozen draft while semantic
  // span/authority facts come from the independently validated canonical
  // accepted-review evidence block; neither is reconstructed from transcript
  // prose. A missing journal fact or any cross-source mismatch returns null,
  // so callers attach no finalize-only guidance rather than manufacturing a
  // partial binding. The same path also re-arms a persisted draft-shape repair
  // card; that sealed lane retains its narrower draft-only replay gate.
  const armRecoveredFinalizeBinding = (args: {
    campaign: string;
    root: string;
    narrationReviewId: string;
    cards: LiveOutputContextCards;
    exactCardDecision?: boolean;
  }): ReviewedAgencyBinding | null => {
    const revision = args.cards.revision;
    const frozenDraft = objectOrNull(args.cards.frozenDraft);
    const acceptedEvidence = objectOrNull(
      args.cards.acceptedReviewEvidence,
    );
    if (
      args.cards.journalDecisionId === null
      || frozenDraft === null
      || acceptedEvidence === null
      || acceptedEvidence.review_id !== args.narrationReviewId
      || frozenDraft.review_id !== args.narrationReviewId
      || acceptedEvidence.revision !== revision
      || frozenDraft.revision !== revision
      || acceptedEvidence.draft_sha256 !== frozenDraft.draft_sha256
      || typeof frozenDraft.draft_text !== "string"
    ) return null;
    const coverageBindingFacts = (
      acceptedEvidence.coverage_binding_facts as ReviewedCoverageBindingFacts
    );
    const semanticObligationRefs = semanticObligationRefsFor(
      coverageBindingFacts,
      args.campaign,
    );
    if (semanticObligationRefs === null) return null;
    let reviewedAgencyBinding: ReviewedAgencyBinding;
    try {
      reviewedAgencyBinding = buildReviewedAgencyBinding({
        review_id: args.narrationReviewId,
        revision,
        draft_sha256: String(frozenDraft.draft_sha256),
        draft: frozenDraft.draft_text,
        state_authority_review: acceptedEvidence.state_authority_review,
        player_input_source_ref: String(
          acceptedEvidence.player_input_source_ref ?? "",
        ),
        agency_authority: acceptedEvidence.agency_authority,
        control_overrides: acceptedEvidence.control_overrides,
        coverage_binding_facts: coverageBindingFacts,
        semantic_obligation_refs: semanticObligationRefs,
      });
    } catch {
      return null;
    }
    let finalizeDecisionId = semanticDecisionId("turn.finalize", revision);
    if (args.exactCardDecision === true) {
      const finalizePrefilled = objectOrNull(
        args.cards.finalizeCard.prefilled_arguments,
      );
      const exactDecision = typeof finalizePrefilled?.decision_id === "string"
        && finalizePrefilled.decision_id.length > 0
        ? finalizePrefilled.decision_id
        : "";
      if (exactDecision !== `${args.cards.journalDecisionId}:finalize`) {
        return null;
      }
      finalizeDecisionId = exactDecision;
    }
    retainedOutputContextFacts = {
      root: args.root,
      campaign: args.campaign,
      turnId: args.cards.turnId,
      sourceDigest: args.cards.sourceDigest,
      revision,
      journalDecisionId: args.cards.journalDecisionId,
      finalizeDecisionId,
      narrationReviewId: args.narrationReviewId,
      playerInputSourceRef: String(acceptedEvidence.player_input_source_ref),
      agencyAuthority: structuredClone(
        acceptedEvidence.agency_authority as JsonObject,
      ),
      controlOverrides: structuredClone(
        acceptedEvidence.control_overrides as JsonObject[],
      ),
      coverageBindingFacts: structuredClone(coverageBindingFacts),
      reviewedAgencyBinding,
      directGenericFinalize: false,
      directTypedFinalize: false,
    };
    const facts = retainedOutputContextFacts;
    const retainedFinalizeBinding: TypedToolBindingCard = {
      schema_version: 1,
      operation: "turn.finalize",
      binding_revision: `turn-finalize:${facts.turnId}:review-${revision}`,
      root: facts.root,
      campaign: facts.campaign,
      decision_id: finalizeDecisionId,
      revision,
      turn_id: facts.turnId,
      source_digest: facts.sourceDigest,
      narration_review_id: facts.narrationReviewId,
      reviewed_agency_binding: structuredClone(reviewedAgencyBinding),
    };
    armTypedBinding(retainedFinalizeBinding, () => {
      const current = retainedOutputContextFacts;
      if (
        current === null
        || current.finalizeDecisionId === null
        || current.narrationReviewId === null
      ) return null;
      return {
        schema_version: 1,
        operation: "turn.finalize",
        binding_revision: `turn-finalize:${current.turnId}:review-${current.revision}`,
        root: current.root,
        campaign: current.campaign,
        decision_id: current.finalizeDecisionId,
        revision: current.revision,
        turn_id: current.turnId,
        source_digest: current.sourceDigest,
        narration_review_id: current.narrationReviewId,
        ...(current.reviewedAgencyBinding === null
          ? {}
          : {
              reviewed_agency_binding: structuredClone(
                current.reviewedAgencyBinding,
              ),
            }),
      };
    });
    clearTypedBinding("narration.review");
    advanceCanonicalProgress(args.campaign, {
      stage: "review_ready",
      reviewRevision: revision,
    });
    return reviewedAgencyBinding;
  };
  // Host-injected `turn.finalize` identity fields: the canonical host-owned
  // contract set (including optional identities a given binding may not
  // currently carry, e.g. repair_finalization_id) — never model-owned replay
  // material.
  const RECOVERY_HOST_INJECTED_FINALIZE_ARGUMENTS = new Set([
    ...HOST_BOUND_FINALIZE_ARGUMENTS,
  ]);
  // Model-owned `turn.finalize` argument whitelist, derived canonically:
  // the typed schema's own properties minus the canonical host-owned set
  // minus whatever the live binding injects. Returns null when the typed
  // schema or a valid retained binding is unavailable — the card builder
  // fails closed rather than hand-picking fields.
  const modelOwnedFinalizeFields = (): string[] | null => {
    const typed = typedToolByOperation.get("turn.finalize");
    const properties = typed?.parameters?.properties;
    if (objectOrNull(properties) === null) return null;
    const binding = retainedTypedBindings.get("turn.finalize");
    const current = currentTypedBindingFactories.get("turn.finalize")?.()
      ?? null;
    if (binding === undefined || current === null) return null;
    try {
      const projected = projectBoundTypedToolParameters(
        "turn.finalize",
        typed!.parameters,
        binding,
        current,
      );
      const projectedProperties = objectOrNull(projected.properties);
      if (projectedProperties === null) return null;
      const fields = Object.keys(projectedProperties);
      // A clear review host-binds the ordinary finalize draft, but draft-shape
      // recovery must still freeze that exact draft and expose it as the sole
      // repairable field. Keep it in the internal recovery whitelist without
      // returning it to the ordinary model schema.
      if (
        binding.operation === "turn.finalize"
        && binding.reviewed_agency_binding !== undefined
        && Object.hasOwn(properties, "draft")
        && !fields.includes("draft")
      ) fields.push("draft");
      return fields;
    } catch {
      return null;
    }
  };
  const gateway = (name: string) => async (_id: string, params: JsonObject, signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) => {
    const epoch = sessionEpoch;
    const typedDefinition = typedToolDefinitions.find((tool) => tool.name === name);
    if (deliveryReplayQuarantine !== null) {
      const quarantinedOperation = typedDefinition?.operation ?? (
        isCanonicalInvokeSurface(name) ? String(params.operation || "") : ""
      );
      if (deliveryReplayBlockedOperation(quarantinedOperation)) {
        return hostFailureResult({
          ok: false,
          tool: quarantinedOperation,
          error: {
            code: "delivery_replay_owns_delivery",
            message: (
              "本回合的最新交付正由宿主逐字重放：不要调用 state/rules/日志、"
              + "narration.review 或 turn.finalize，也不要追加玩家可见文本。"
            ),
            retryable: false,
            details: {
              class: "invariant_terminal",
              recoverable_by: "none",
            },
          },
          warnings: [],
          hints: [],
        });
      }
    }
    if (typedDefinition !== undefined) {
      if (
        typedDefinition.operation === "session.resume"
        && startupResumeGate?.phase === "pending"
      ) {
        // Startup continuation identity is entirely host-owned. In
        // particular, no current-investigator binding exists until this
        // receipt establishes the party, so model-supplied selectors or
        // investigator handles are ignored before validation/restoration.
        params = {};
      }
      const rawTypedCommand = objectOrNull(params.command);
      const rawTypedPayload = objectOrNull(rawTypedCommand?.payload);
      if (
        typedDefinition.operation === "sanity.execute"
        && (
          Object.hasOwn(params, "decision_id")
          || Object.hasOwn(rawTypedCommand ?? {}, "command_id")
          || Object.hasOwn(rawTypedCommand ?? {}, "phase")
          || Object.hasOwn(rawTypedPayload ?? {}, "decision_id")
          || Object.hasOwn(rawTypedPayload ?? {}, "terminal_command_ids")
        )
      ) {
        return hostFailureResult(hostBindingFailure(
          typedDefinition.operation,
          new ToolContractProjectionError(
            "forged_host_argument",
            "sanity.execute command identity is host-owned",
            { operation: typedDefinition.operation },
          ),
        ));
      }
      if (
        typedDefinition.operation === "rules.sanity_check"
        && Object.hasOwn(params, "decision_id")
      ) {
        return hostFailureResult(hostBindingFailure(
          typedDefinition.operation,
          new ToolContractProjectionError(
            "forged_host_argument",
            "rules.sanity_check decision_id is host-owned",
            { operation: typedDefinition.operation, fields: ["decision_id"] },
          ),
        ));
      }
      if (
        typedDefinition.operation === "narration.review"
        && Object.hasOwn(params, STATE_CLAIM_HOST_FIELD)
      ) {
        // The compiler receipt is attached by the host after its own
        // state-claim compilation. The retained review binding rejects it
        // as forged, but that binding is armed only once a complete output
        // context has been observed; before that the canonical surface used
        // to drop the value silently, so a caller could probe a host-owned
        // field without ever seeing a refusal. Fail closed regardless of
        // binding state.
        return hostFailureResult(hostBindingFailure(
          typedDefinition.operation,
          new ToolContractProjectionError(
            "forged_host_argument",
            "narration.review state_claim_compilation is the host compiler "
              + "receipt and is never model-authored",
            {
              operation: typedDefinition.operation,
              fields: [STATE_CLAIM_HOST_FIELD],
            },
          ),
        ));
      }
      // Raw model-identity validation runs BEFORE any host injection or
      // restoration: host-attached identity reaches arguments only after
      // this gate, by provenance. Model-authored `pi-*` values are always
      // rejected here.
      const rawValidation = validateRawModelIdentityPayload(params);
      if (!rawValidation.ok) {
        return hostFailureResult({
          ok: false,
          tool: typedDefinition.operation,
          error: {
            code: "opaque_identity_grammar",
            message: rawValidation.message,
            retryable: false,
          },
          warnings: [],
          hints: [],
        });
      }
      if (
        typedDefinition.operation === "rules.sanity_check"
        || typedDefinition.operation === "sanity.execute"
      ) {
        try {
          params = bindSanityHostArguments(typedDefinition.operation, params);
        } catch (error) {
          if (!(error instanceof ToolContractProjectionError)) throw error;
          return hostFailureResult(hostBindingFailure(typedDefinition.operation, error));
        }
      }
      if (
        typedDefinition.operation === "session.resume"
        && operatorSystemInstructionScope !== null
      ) {
        const campaign = canonicalProgressCampaignId
          || explicitPiStartupCampaignId()
          || "";
        if (campaign) {
          params = {
            ...params,
            root: currentWorkspaceRoot,
            campaign,
          };
        }
      }
      if (
        launcherRole === null
        && typedDefinition.operation === "setup.quick_start"
        && (params.root !== undefined || params.campaign !== undefined)
      ) {
        return hostFailureResult(hostBindingFailure(
          typedDefinition.operation,
          new ToolContractProjectionError(
            "forged_host_argument",
            "setup.quick_start root/campaign are host-owned in a no-selector session",
            { operation: typedDefinition.operation },
          ),
        ));
      }
      if (
        typedDefinition.operation === "setup.complete"
        && (params.root !== undefined || params.campaign !== undefined)
      ) {
        return hostFailureResult(hostBindingFailure(
          typedDefinition.operation,
          new ToolContractProjectionError(
            "forged_host_argument",
            "setup.complete root/campaign are host-owned",
            { operation: typedDefinition.operation },
          ),
        ));
      }
      if (revokedSceneBindingOperations.has(typedDefinition.operation)) {
        return hostFailureResult(hostBindingFailure(
          typedDefinition.operation,
          new ToolContractProjectionError(
            "binding_context_missing",
            `no retained host binding is armed for ${typedDefinition.operation}`,
            { operation: typedDefinition.operation },
          ),
        ));
      }
      if (
        typedDefinition.operation === "setup.complete"
        && !Object.hasOwn(params, "decision_id")
      ) {
        // Identifier Law: bind only the exact retained handoff identity.
        // An unarmed setup stays incomplete instead of receiving a guessed
        // boot-local token that cannot survive process replacement.
        params = openingContinuationGate.prepareSetupCompleteArguments(
          params,
        ) as JsonObject;
      }
      if (typedDefinition.operation === "session.delivery_text") {
        // Semantic replay request only: the model passes at most
        // mode:"replay"; the host owns the campaign routing, machine-owned
        // identity and chunk transport. Any model-supplied identity/offset
        // fields are ignored by construction — the lane binds them itself.
        const replayCampaign = (
          typeof params.campaign === "string" && params.campaign.trim()
            ? params.campaign.trim()
            : typeof params.campaign_id === "string" && params.campaign_id.trim()
            ? params.campaign_id.trim()
            : canonicalProgressCampaignId
        );
        if (!replayCampaign) {
          return hostFailureResult({
            ok: false,
            tool: typedDefinition.operation,
            error: {
              code: "invalid_param",
              message: "session.delivery_text replay 需要 campaign。",
              retryable: false,
            },
            warnings: [],
            hints: [],
          });
        }
        const replayOutcome = await runExactDeliveryReplayLane(
          replayCampaign,
          ctx,
          signal,
          epoch,
        );
        return replayOutcome.ok === true
          ? result(replayOutcome)
          : hostFailureResult(replayOutcome);
      }
      const binding = retainedTypedBindings.get(typedDefinition.operation);
      // Run-02 armed-recovery detection: a typed `turn.finalize` whose
      // campaign carries an armed draft-shape recovery card is a DRAFT-ONLY
      // sealed replay. Ordinary host-binding injection is skipped for this
      // path — injecting revision/review/decision identities pre-wrap would
      // make raw model input indistinguishable from host material and the
      // recovery gate would misclassify it. The recovery block immediately
      // before transport validates the raw model input as draft-only and
      // performs the single validated injection from the armed card/binding.
      const armedRecoveryCampaign = (
        typedDefinition.operation === "turn.finalize"
        && effectiveTypedRole === "play"
        && binding !== undefined
        && draftShapeRecoveryCards.has(binding.campaign)
      ) ? binding.campaign : null;
      if (
        armedRecoveryCampaign === null
        && binding !== undefined
        && typedDefinition.operation !== "sanity.execute"
      ) {
        try {
          params = bindRetainedTypedToolArguments(
            typedDefinition.operation,
            params,
            binding,
            currentTypedBindingFactories.get(typedDefinition.operation)?.() ?? null,
          ) as JsonObject;
        } catch (error) {
          if (!(error instanceof ToolContractProjectionError)) throw error;
          return hostFailureResult(hostBindingFailure(typedDefinition.operation, error));
        }
      }
      {
        // A precise scene card supplies the retained host binding; an
        // ordinary unbound move or time advance still needs the same stable
        // host-owned idempotency key (see hostSceneWriteDecisionId).
        const hostDecisionId = hostSceneWriteDecisionId(
          typedDefinition.operation,
          params,
        );
        if (hostDecisionId !== null) {
          params = { ...params, decision_id: hostDecisionId };
        }
      }
      if (armedRecoveryCampaign !== null && !Object.hasOwn(params, "campaign")) {
        // Host-derived routing identity only, so the wrapped envelope names
        // the campaign; every other argument stays raw model input for the
        // recovery gate to validate.
        params = { ...params, campaign: armedRecoveryCampaign };
      }
    }
    if (
      (
        typedDefinition?.operation === "turn.finalize"
        || params.operation === "turn.finalize"
      )
      && (typeof params.campaign !== "string" || !params.campaign.trim())
      && canonicalProgressCampaignId
    ) {
      params = { ...params, campaign: canonicalProgressCampaignId };
    }
    if (
      typedDefinition !== undefined
      && typedOperationNeedsCampaign(typedDefinition.operation)
      // Never onto an operation that CREATES the campaign it names. The
      // fresh-setup gate requires the transport selector absent for those,
      // and attaching it here put `campaign.create` permanently out of reach
      // on the typed surface: the gate refused it while telling the Keeper to
      // call it. A later strip existed but only ran for launcher-less
      // sessions, so a launched table -- every real one -- never reached it.
      && !isPreCampaignFreshCreation(
        typedDefinition.operation,
        (objectOrNull(params.arguments) ?? params) as Record<string, unknown>,
      )
      && (typeof params.campaign !== "string" || !params.campaign.trim())
      && canonicalProgressCampaignId
    ) {
      // Typed schemas intentionally hide the transport campaign. Attach the
      // active canonical campaign before wrapping so semantic handles resolve
      // inside the exact current session/campaign scope.
      params = { ...params, campaign: canonicalProgressCampaignId };
    }
    params = wrapTypedToolInvokeParams(name, params) as JsonObject;
    // Bind the host-retained source-facts card before generic JSON-string
    // normalization so the exact setup transition can recover from a
    // provider's malformed double-encoding without relaxing other tools.
    params = openingContinuationGate.bindRetainedAdoptSourceFacts(params);
    if (isCanonicalInvokeSurface(name)) {
      params = normalizePiCocInvokeArguments(params);
      // Host routing identity: root is host-bound on the generic surface.
      // Model-supplied root is dropped (never transports); the host binds
      // its own workspace root before transport.
      if (typedDefinition === undefined) {
        const { root: _modelRoot, ...withoutModelRoot } = params;
        params = {
          ...withoutModelRoot,
          root: currentWorkspaceRoot,
        } as JsonObject;
      }
      // Host-bound campaign routing: the registered generic envelope has no
      // campaign field. The host binds the transport campaign from the
      // operation's own model-owned campaign argument when it carries one,
      // else from the host-tracked current campaign for this epoch — never
      // from model envelope input, which the registered schema does not
      // carry. Campaign-less calls to campaign-bound operations still fail
      // closed at the canonical layer.
      if (typedDefinition === undefined && !Object.hasOwn(params, "campaign")) {
        const boundArguments = objectOrNull(params.arguments);
        // setup.invoke campaign.create is pre-campaign: the campaign it names
        // does not exist yet, so a transport selector would only try to
        // hydrate a campaign that cannot be found, and the fresh-setup gate
        // rightly refuses a selector on this route. The selected identity
        // travels in the payload alone.
        const preCampaignCreate = (
          params.operation === "setup.invoke"
          && boundArguments?.kind === "campaign.create"
        );
        const argumentCampaign = typeof boundArguments?.campaign_id === "string"
          && boundArguments.campaign_id.trim()
          ? boundArguments.campaign_id.trim()
          : "";
        const boundCampaign = argumentCampaign || canonicalProgressCampaignId;
        if (boundCampaign && !preCampaignCreate) {
          params = { ...params, campaign: boundCampaign } as JsonObject;
        }
      }
    }
    // Semantic delivery lane: model-facing `session.delivery_text` is the
    // exact-replay lane only — campaign plus the semantic replay mode, on the
    // typed AND generic surfaces. Both route through the ONE host-owned
    // multi-chunk replay state machine (identity binding, chunk ordering,
    // completion/retirement). Legacy context-mode relay fields are not
    // model-authored and never reach transport.
    const deliveryOperation = typedDefinition?.operation ?? (
      isCanonicalInvokeSurface(name) ? String(params.operation || "") : ""
    );
    if (deliveryOperation === "session.delivery_text") {
      const deliveryArgs = objectOrNull(params.arguments) ?? {};
      const mode = deliveryArgs.mode === "context" ? "context" : "replay";
      // Envelope root is host-bound: never accepted inside the model
      // arguments either.
      const allowedKeys = new Set(["campaign", "mode"]);
      const extraKeys = Object.keys(deliveryArgs).filter((key) => !allowedKeys.has(key));
      if (mode === "context" || extraKeys.length > 0) {
        return hostFailureResult({
          ok: false,
          tool: "session.delivery_text",
          error: {
            code: "delivery_lane_semantic_only",
            message: "session.delivery_text 只接受语义重放：campaign 加 mode=replay。"
              + "交付身份（finalization_id、哈希与分块传输）由宿主持有并自动绑定，"
              + "模型不提供也不转发。",
            retryable: false,
            details: {
              class: "invariant_terminal",
              recoverable_by: "none",
              ...(mode === "context" ? { rejected_mode: "context" } : {}),
            },
          },
          warnings: [],
          hints: [],
        });
      }
      // GENERIC surface: route the semantic replay request through the same
      // host-owned lane the typed surface uses — never direct canonical
      // transport. (The typed branch above already returned via the lane.)
      if (typedDefinition === undefined) {
        const replayCampaign = typeof params.campaign === "string"
          && params.campaign.trim()
          ? params.campaign.trim()
          : "";
        if (!replayCampaign) {
          return hostFailureResult({
            ok: false,
            tool: "session.delivery_text",
            error: {
              code: "invalid_param",
              message: "session.delivery_text replay 需要 campaign。",
              retryable: false,
            },
            warnings: [],
            hints: [],
          });
        }
        const replayOutcome = await runExactDeliveryReplayLane(
          replayCampaign,
          ctx,
          signal,
          epoch,
        );
        return replayOutcome.ok === true
          ? result(replayOutcome)
          : hostFailureResult(replayOutcome);
      }
    }
    params = bindStartupResumeInvocation(name, params);
    // `campaign.create` is pre-campaign in exactly the way setup.quick_start
    // is: the campaign it names does not exist yet, so mirroring the id into
    // the transport recovery selector asks the toolbox to recover a context
    // for something unborn -- and the fresh-setup allowlist requires that
    // selector to be ABSENT. Only quick_start was stripped, so on the typed
    // surface (the only surface a live Keeper has) campaign.create could
    // never satisfy the gate: every custom/PDF table was refused with a
    // message telling the Keeper to call the very operation being refused.
    // Seen live on 2026-09-02: five refusals, then the Keeper fell back to
    // the built-in starter and told the player the requested module was
    // ready. PDF -> playable campaign was impossible through the product.
    const freshCreationOperation = isPreCampaignFreshCreation(
      typedDefinition?.operation,
      objectOrNull(params.arguments),
    );
    if (launcherRole === null && freshCreationOperation) {
      const { campaign: _freshCampaignSelector, ...freshCreationParams } = params;
      params = {
        ...freshCreationParams,
        root: resolve(ctx.cwd),
      };
    }
    if (
      launcherRole === null
      && typedDefinition?.operation === "setup.complete"
    ) {
      params = openingContinuationGate.bindNoSelectorSetupCompleteInvocation(
        params,
        resolve(ctx.cwd),
      ) as JsonObject;
    }
    params = openingContinuationGate.bindRetainedOpeningRoute(params);
    if (
      typedDefinition?.operation === "setup.complete"
      && launcherRole !== null
    ) {
      params = { ...params, root: resolve(ctx.cwd) } as JsonObject;
    }
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
    // Role/phase ACL: evaluated IMMEDIATELY after canonical operation
    // normalization and BEFORE any registry code — no currentParty, no
    // observation, projection, registration, snapshot, restoration, or any
    // other semantic-identity side effect may run for an operation the
    // session role/phase forbids. The rejection is the established ACL
    // error, with zero registry calls or side effects.
    if (isCanonicalInvokeSurface(name)) {
      const aclPhase = resolveAclPhase(
        typeof params.campaign === "string" ? params.campaign : "",
      );
      const acl = evaluateExecuteAcl({
        toolName: name,
        operation: String(params.operation || ""),
        phase: aclPhase,
        role: effectiveTypedRole,
        recoveryAuthorization: (
          aclPhase === "recovery"
          && canonicalProgress.stage === "acting"
          && openTurnRecoveryAuthorization !== null
          && openTurnRecoveryAuthorization.campaignId
            === (typeof params.campaign === "string"
              ? params.campaign.trim()
              : canonicalProgressCampaignId)
          && openTurnRecoveryAuthorization.sessionEpoch === sessionEpoch
          && openTurnRecoveryAuthorization.playerTurnEpoch
            === canonicalProgress.playerTurnEpoch
          && currentOpenTurnAnchor?.campaignId
            === (typeof params.campaign === "string"
              ? params.campaign.trim()
              : canonicalProgressCampaignId)
          && currentOpenTurnAnchor.anchor.anchor_digest
            === openTurnRecoveryAuthorization.anchorDigest
        ) ? { kind: "open_turn_pre_journal", stage: "acting" } : null,
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
        // Say what the session still owes. An active opening setup holds one
        // exact route; without it the KP hears only that its operation is
        // forbidden here and has no way to learn which single call opens the
        // way. Reading the retained route touches no registry state, so the
        // ACL-first invariant above holds.
        const retainedRoute = openingContinuationGate.retainedOpeningRouteFor(
          typeof params.campaign === "string" ? params.campaign : "",
        );
        throw new Error(
          retainedRoute === null
            ? acl.message
            : `${acl.message}; follow this exact retained route: `
              + JSON.stringify(retainedRoute),
        );
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
    // Semantic-handle restoration (Identifier Law boundary): model arguments
    // carry only stable semantic entity handles; the host restores the exact
    // canonical investigator/subject/source identities from retained observed
    // facts before transport. Explicit opaque ids fail closed without echo.
    {
      const restoredOperation = typedDefinition?.operation
        ?? (typeof params.operation === "string" ? params.operation : "");
      const restoredArgs = objectOrNull(params.arguments);
      const invocationCampaign = typeof params.campaign === "string"
        ? params.campaign.trim()
        : typeof params.campaign_id === "string"
          ? params.campaign_id.trim()
          : "";
      if (restoredOperation && restoredArgs !== null) {
        const reviewedFinalizeBinding = restoredOperation === "turn.finalize"
          ? retainedTypedBindings.get("turn.finalize")
          : undefined;
        const reviewedFinalizeCurrent = restoredOperation === "turn.finalize"
          ? currentTypedBindingFactories.get("turn.finalize")?.() ?? null
          : null;
        const armedDraftShapeRecovery = (
          restoredOperation === "turn.finalize"
          && invocationCampaign !== ""
          && draftShapeRecoveryCards.has(invocationCampaign)
        );
        // Generic-surface raw validation mirrors the typed branch: the raw
        // model payload is grammar-checked before host restoration attaches
        // provenance-tagged identity. Typed tools were already validated
        // pre-injection, so their (now host-augmented) arguments skip this
        // gate by provenance.
        const rawValidation = typedDefinition === undefined
          ? validateRawModelIdentityPayload(restoredArgs)
          : { ok: true as const };
        if (!rawValidation.ok) {
          return hostFailureResult({
            ok: false,
            tool: restoredOperation,
            error: {
              code: "opaque_identity_grammar",
              message: rawValidation.message,
              retryable: false,
            },
            warnings: [],
            hints: [],
          });
        }
        // Generic arguments are validated against the REGISTERED
        // operation-discriminated schema — the exact closed object used for
        // tool registration and inventory. Undeclared operations, extra
        // envelope fields, missing required fields, extra model-owned
        // fields, nested type/enum/oneOf violations: all fail closed before
        // transport; host injections come later, by provenance.
        if (
          typedDefinition === undefined && restoredArgs !== null
          // An armed recovery card owns this finalize lane: its own sealed
          // replay gate enforces draft-only supply with lane-specific codes.
          && !(
            restoredOperation === "turn.finalize"
            && draftShapeRecoveryCards.has(
              typeof params.campaign === "string" ? params.campaign.trim() : "",
            )
          )
        ) {
          const reviewedFinalizeSchema = (
            reviewedFinalizeBinding?.operation === "turn.finalize"
            && reviewedFinalizeBinding.reviewed_agency_binding !== undefined
            && reviewedFinalizeCurrent !== null
            && typedToolByOperation.get("turn.finalize") !== undefined
          )
            ? projectBoundTypedToolParameters(
              "turn.finalize",
              typedToolByOperation.get("turn.finalize")!.parameters,
              reviewedFinalizeBinding,
              reviewedFinalizeCurrent,
            )
            : null;
          const shape = reviewedFinalizeSchema === null
            ? validateGenericInvokeAgainstRegisteredSchema(
              {
                operation: restoredOperation,
                arguments: restoredArgs,
              },
              genericInvokeInputSchema,
            )
            : validateProjectedModelArguments(
              restoredArgs,
              reviewedFinalizeSchema,
            );
          if (!shape.ok) {
            return hostFailureResult({
              ok: false,
              tool: restoredOperation,
              error: {
                code: "unknown_model_argument",
                message: "these arguments do not match the model-owned "
                  + `surface for ${restoredOperation}: `
                  + `${shape.errors.join("; ")}. Host-owned identity is `
                  + "attached by the gateway; pass only model-owned fields.",
                retryable: false,
                details: {
                  class: "schema_validation",
                  schema_errors: shape.errors,
                },
              },
              warnings: [],
              hints: [],
            });
          }
        }
        // Typed binding fields have already passed byte-exact retained/current
        // host validation. Semantic restoration applies only to the model's
        // remaining fields; otherwise an exact host-bound investigator id
        // would be mistaken for a forged model identity.
        const hostBoundAfterRestore: JsonObject = {};
        let semanticArgs = restoredArgs;
        if (
          typedDefinition === undefined
          && !armedDraftShapeRecovery
          && reviewedFinalizeBinding?.operation === "turn.finalize"
          && reviewedFinalizeBinding.reviewed_agency_binding !== undefined
        ) {
          try {
            semanticArgs = bindRetainedTypedToolArguments(
              "turn.finalize",
              restoredArgs,
              reviewedFinalizeBinding,
              reviewedFinalizeCurrent,
            );
          } catch (error) {
            if (!(error instanceof ToolContractProjectionError)) throw error;
            return hostFailureResult(hostBindingFailure("turn.finalize", error));
          }
        }
        if (
          typedDefinition?.operation === "state.record_npc_engagement"
          || typedDefinition?.operation === "npc.reaction"
          || typedDefinition?.operation === "chase.execute"
          || typedDefinition?.operation === "rules.social_adjudicate"
          || typedDefinition?.operation === "rules.psychology_observe"
        ) {
          semanticArgs = { ...restoredArgs };
          for (const field of HOST_OWNED_FIELDS[typedDefinition.operation]) {
            if (Object.hasOwn(semanticArgs, field)) {
              hostBoundAfterRestore[field] = semanticArgs[field];
              delete semanticArgs[field];
            }
          }
        }
        if (
          typedDefinition?.operation === "sanity.execute"
          && retainedTypedBindings.get("sanity.execute")?.operation
            === "sanity.execute"
        ) {
          // The semantic action has already been compiled through the exact
          // retained/current bout binding. Keep its hash-derived executor
          // command out of model-identity restoration; only the semantic
          // investigator handle still crosses that boundary.
          semanticArgs = { ...restoredArgs };
          for (const field of ["decision_id", "command"]) {
            if (Object.hasOwn(semanticArgs, field)) {
              hostBoundAfterRestore[field] = semanticArgs[field];
              delete semanticArgs[field];
            }
          }
        }
        if (
          reviewedFinalizeBinding?.operation === "turn.finalize"
          && reviewedFinalizeBinding.reviewed_agency_binding !== undefined
          && !armedDraftShapeRecovery
        ) {
          semanticArgs = { ...semanticArgs };
          for (const field of ["coverage", "agency_claims"]) {
            if (Object.hasOwn(semanticArgs, field)) {
              hostBoundAfterRestore[field] = semanticArgs[field];
              delete semanticArgs[field];
            }
          }
        }
        const restored = restoreSemanticEntityHandles(
          restoredOperation,
          semanticArgs,
          effectiveSemanticEntityFacts(invocationCampaign),
          invocationCampaign !== ""
            ? liveSemanticResolver(invocationCampaign, restoredArgs)
            : null,
        );
        if (!restored.ok) {
          return hostFailureResult({
            ok: false,
            tool: restoredOperation,
            error: {
              code: restored.code,
              message: restored.message,
              retryable: false,
            },
            warnings: [],
            hints: [],
          });
        }
        params = {
          ...params,
          arguments: {
            ...(restored.value as JsonObject),
            ...hostBoundAfterRestore,
          },
        };
        if (
          typedDefinition === undefined
          && (
            restoredOperation === "rules.sanity_check"
            || restoredOperation === "sanity.execute"
          )
        ) {
          try {
            params = {
              ...params,
              arguments: bindSanityHostArguments(
                restoredOperation,
                objectOrNull(params.arguments) ?? {},
              ),
            };
          } catch (error) {
            if (!(error instanceof ToolContractProjectionError)) throw error;
            return hostFailureResult(hostBindingFailure(restoredOperation, error));
          }
        }
      }
    }
    params = openingContinuationGate.bindHandoutReplayRequest(params);

    // Host-bound session identity: session.resume may carry the host's own
    // session id; the host attaches it after raw validation, by provenance —
    // it is never model-authored.
    {
      const resumeOperation = typedDefinition?.operation
        ?? (isCanonicalInvokeSurface(name) ? String(params.operation || "") : "");
      if (resumeOperation === "session.resume") {
        const resumeArgs = objectOrNull(params.arguments);
        const hostSessionId = typeof ctx.sessionManager?.getSessionId === "function"
          ? String(ctx.sessionManager.getSessionId() || "")
          : "";
        if (resumeArgs !== null && hostSessionId
          && !Object.hasOwn(resumeArgs, "host_session_id")) {
          params = {
            ...params,
            arguments: { ...resumeArgs, host_session_id: hostSessionId } as JsonObject,
          };
        }
      }
    }
    // Host-owned scene-write idempotency key on the generic surface: the
    // registered envelope hides decision_id for state.move_scene and
    // state.advance_time (host-owned), so a generic call arrives without one
    // and the canonical operation would refuse it with missing_param — the
    // same fiction/state divergence the typed surface already closes.
    // Attached after raw validation, by provenance, like host_session_id.
    if (typedDefinition === undefined && isCanonicalInvokeSurface(name)) {
      const sceneWriteArgs = objectOrNull(params.arguments);
      const hostDecisionId = sceneWriteArgs === null
        ? null
        : hostSceneWriteDecisionId(String(params.operation || ""), sceneWriteArgs);
      if (hostDecisionId !== null) {
        params = {
          ...params,
          arguments: { ...sceneWriteArgs, decision_id: hostDecisionId } as JsonObject,
        };
      }
    }
    const startupResumeAttempt = exactStartupResumeInvocation(name, params);
    const noSelectorQuickStartRecoveryAttempt = (
      launcherRole === null
      && typedDefinition?.operation === "setup.quick_start"
      && noSelectorQuickStartRecovery !== null
    );
    if (noSelectorQuickStartRecoveryAttempt) {
      const retained = noSelectorQuickStartRecovery;
      if (
        retained === null
        || retained.retriesRemaining !== 1
        || !isDeepStrictEqual(params, retained.params)
      ) {
        return hostFailureResult(hostBindingFailure(
          "setup.quick_start",
          new ToolContractProjectionError(
            "quick_start_recovery_mismatch",
            "the one retained quick-start recovery must repeat the exact semantic request",
            { operation: "setup.quick_start" },
          ),
        ));
      }
      retained.retriesRemaining = 0;
      refreshTypedToolDefinition("setup.quick_start");
      applyKpActiveTools();
    }
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
    if (isCanonicalInvokeSurface(name)) {
      const blocked = nonRetryableFailureCircuit.preflight({
        campaignId: typeof params.campaign === "string" ? params.campaign : "",
        operation: String(params.operation || ""),
        phase: resolveAclPhase(
          typeof params.campaign === "string" ? params.campaign : "",
        ),
        operationArgs: objectOrNull(params.arguments) ?? {},
        playerTurnEpoch: canonicalProgress.playerTurnEpoch,
        canonicalProgress,
      });
      if (blocked !== null) {
        try {
          pi.appendEntry("coc-nonretryable-failure-circuit", blocked);
        } catch { /* circuit audit is best effort */ }
        return result(blocked);
      }
    }
    if (isCanonicalInvokeSurface(name)) {
      const pledge = HOST_PROVENANCE_PLEDGES[String(params.operation || "")];
      if (pledge !== undefined) {
        // Runs after raw model-identity validation, so the attached value is
        // host material by provenance rather than a model-authored identity.
        const pledgeCampaign = typeof params.campaign === "string"
          ? params.campaign.trim()
          : "";
        const retained = pledgeCampaign === ""
          ? undefined
          : retainedHostPledges.get(
            hostPledgeKey(pledgeCampaign, String(params.operation)),
          );
        if (retained === undefined) {
          return result({
            ok: false,
            tool: String(params.operation),
            error: {
              code: "host_pledge_unavailable",
              message: pledge.missingMessage,
              class: "business_precondition",
              recoverable_by: "model_next_action",
              allowed_next_actions: [{
                operation: pledge.producer,
                action: "call_operation",
                reason: "mint the host-attached identity this call requires",
                host_bound: false,
              }],
              retryable: false,
              details: { pledged_field: pledge.field, producer: pledge.producer },
            },
            warnings: [],
            hints: [],
          });
        }
        params = {
          ...params,
          arguments: {
            ...(objectOrNull(params.arguments) ?? {}),
            [pledge.field]: retained,
          },
        } as JsonObject;
      }
    }
    if (
      isCanonicalInvokeSurface(name)
      && params.operation === "narration.review"
      && effectiveTypedRole === "play"
    ) {
      const retainedFault = openingContinuationGate.currentTurnProcessingFault();
      const campaignId = typeof params.campaign === "string" ? params.campaign.trim() : "";
      const reviewArgs = objectOrNull(params.arguments);
      if (retainedFault !== null && (!campaignId || reviewArgs === null)) {
        return result({
          ok: false,
          tool: "narration.review",
          error: {
            code: "state_claim_compiler_context_missing",
            message: "call turn.output_context for this pending turn before narration.review",
          },
        });
      }
      if (!campaignId || reviewArgs === null) {
        return result({
          ok: false,
          tool: "narration.review",
          error: {
            code: "state_claim_compiler_context_missing",
            message: "call turn.output_context for this pending turn before narration.review",
          },
        });
      }
      // The field is host-owned on typed, domain, and compatibility paths.
      // Never preserve a caller-supplied value, even when it happens to be valid.
      const {
        [STATE_CLAIM_HOST_FIELD]: _forgedCompilation,
        ...modelReviewArgs
      } = reviewArgs;
      // Generic-surface review: host-owned settle identity (turn_id/
      // source_digest/revision/decision_id) is machine-bound from the armed
      // output-context card exactly like the typed surface — the model never
      // relays it. Model-authored host fields fail closed as forged.
      let keeperReviewArgs: Record<string, unknown> = modelReviewArgs;
      if (typedDefinition === undefined) {
        const reviewBinding = retainedTypedBindings.get("narration.review") ?? null;
        const reviewBindingCurrent = reviewBinding === null
          ? null
          : currentTypedBindingFactories.get("narration.review")?.() ?? null;
        if (reviewBinding !== null && reviewBindingCurrent !== null) {
          try {
            keeperReviewArgs = bindRetainedTypedToolArguments(
              "narration.review",
              modelReviewArgs,
              reviewBinding,
              reviewBindingCurrent,
            );
          } catch (error) {
            if (!(error instanceof ToolContractProjectionError)) throw error;
            return hostFailureResult(hostBindingFailure("narration.review", error));
          }
          // The machine-attached compiler receipt is re-attached after
          // compilation; the bound card's empty placeholder must not leak.
          const {
            [STATE_CLAIM_HOST_FIELD]: _boundCompilation,
            ...boundReviewArgs
          } = keeperReviewArgs;
          keeperReviewArgs = boundReviewArgs;
        }
      }
      if (retainedFault !== null) {
        const sessionId = typeof ctx.sessionManager?.getSessionId === "function"
          ? String(ctx.sessionManager.getSessionId() || "")
          : "";
        const revision = Number(keeperReviewArgs.revision);
        const matched = openingContinuationGate.matchFrozenReviewRecovery({
          campaign_id: campaignId,
          run_id: sessionId,
          session_id: sessionId,
          turn_id: typeof keeperReviewArgs.turn_id === "string" ? keeperReviewArgs.turn_id : "",
          revision: Number.isInteger(revision) ? revision : 0,
          source_digest: typeof keeperReviewArgs.source_digest === "string"
            ? keeperReviewArgs.source_digest
            : "",
        });
        if (matched !== "allow") {
          return result({
            ok: false,
            tool: "narration.review",
            error: {
              code: "turn_processing_fault_latched",
              retryable: false,
              message: "this player turn has a terminal processing fault; recover the preserved turn before retrying",
              details: retainedFault,
            },
          });
        }
      }
      const recoveryAttempt = retainedFault !== null;
      if (recoveryAttempt) {
        if (!openingContinuationGate.consumeFrozenReviewRecovery()) {
          return result({
            ok: false,
            tool: "narration.review",
            error: {
              code: "turn_processing_fault_latched",
              retryable: false,
              message: "this player turn has a terminal processing fault; recover the preserved turn before retrying",
              details: retainedFault,
            },
          });
        }
        stateClaimCompiler.releaseLatchedFailure(
          campaignId,
          typeof keeperReviewArgs.turn_id === "string" ? keeperReviewArgs.turn_id : "",
        );
      }
      try {
        const compilation = await stateClaimCompiler.compileReview({
          campaignId,
          arguments: keeperReviewArgs,
          ctx,
          signal,
          sessionEpoch: epoch,
          isCurrent,
        });
        openingContinuationGate.clearTurnProcessingFault();
        params = {
          ...params,
          arguments: {
            ...keeperReviewArgs,
            [STATE_CLAIM_HOST_FIELD]: compilation,
          },
        };
      } catch (error) {
        if (!isCurrent(epoch)) {
          return result({
            ok: false,
            tool: "narration.review",
            isError: true,
            error: {
              code: "session_closed",
              retryable: false,
              message: "the originating Pi session closed before state-claim compilation settled",
            },
            retryable: false,
            will_retry: false,
          });
        }
        const failure = error instanceof Error ? error.message : "";

        const contextMissing = failure === "state_claim_compiler_context_missing"
          || failure === "state_claim_compiler_context_invalid";
        if (recoveryAttempt && contextMissing) {
          openingContinuationGate.restoreFrozenReviewRecovery();
        }
        const typedFailure = error instanceof PiStateClaimCompilerFailure
          ? error
          : null;
        const invalid = typedFailure !== null
          ? typedFailure.failureClass === "protocol_invalid"
            || typedFailure.failureClass === "result_invalid"
          : failure.startsWith("state_claim_result_")
            || failure.startsWith("state_claim_coverage_")
            || failure.startsWith("state_claim_response_")
            || failure.startsWith("state_claim_model_protocol_")
            || failure.startsWith("state_claim_model_arguments_");
        const code = contextMissing
          ? "state_claim_compiler_context_missing"
          : invalid
            ? "state_claim_compiler_invalid"
            : "state_claim_compiler_unavailable";
        const sessionId = typeof ctx.sessionManager?.getSessionId === "function"
          ? String(ctx.sessionManager.getSessionId() || "")
          : "";
        const revision = Number(keeperReviewArgs.revision);
        const terminalFault = typedFailure === null
          ? null
          : terminalizeTurnProcessingFault({
            schema_version: 1,
            contract_id: "coc.pi-turn-processing-fault.v1",
            kind: "turn_processing_fault",
            status: "terminal",
            stage: "state_claim_compilation",
            campaign_id: campaignId,
            run_id: sessionId,
            session_id: sessionId,
            turn_id: typeof keeperReviewArgs.turn_id === "string"
              ? keeperReviewArgs.turn_id
              : null,
            revision: Number.isInteger(revision) ? revision : null,
            source_digest: typeof keeperReviewArgs.source_digest === "string"
              ? keeperReviewArgs.source_digest
              : null,
            code,
            message: "回合处理失败：玩家状态声明编译未完成。当前回合仍保留，请刷新后恢复。",
            retryable: false,
            will_retry: false,
            pending_turn_preserved: true,
            failure_class: typedFailure.failureClass,
            requested_model: typedFailure.requestedModel === null
              ? null
              : {
                provider: typeof typedFailure.requestedModel.provider === "string"
                  ? typedFailure.requestedModel.provider
                  : null,
                id: typeof typedFailure.requestedModel.id === "string"
                  ? typedFailure.requestedModel.id
                  : null,
                api: typeof typedFailure.requestedModel.api === "string"
                  ? typedFailure.requestedModel.api
                  : null,
            },
            elapsed_ms: typedFailure.elapsedMs,
          });
        try {
          pi.appendEntry("coc-state-claim-compiler", {
            schema_version: 1,
            status: "failed",
            code,
            campaign_id: campaignId,
            turn_id: keeperReviewArgs.turn_id,
            draft_sha256: typeof keeperReviewArgs.draft_text === "string"
              ? createHash("sha256").update(JSON.stringify(keeperReviewArgs.draft_text), "utf8").digest("hex")
              : null,
            ...(typedFailure === null ? {} : {
              failure_class: typedFailure.failureClass,
              requested_model: typedFailure.requestedModel,
              elapsed_ms: typedFailure.elapsedMs,
            }),
          });
        } catch { /* compiler failure audit is best effort */ }
        return result({
          ok: false,
          tool: "narration.review",
          isError: true,
          error: {
            code,
            retryable: false,
            message: contextMissing
              ? "call turn.output_context for this pending turn before narration.review"
              : "player-state claim compilation did not complete; narration review was not recorded",
            ...(terminalFault === null ? {} : { details: terminalFault }),
          },
          retryable: false,
          will_retry: false,
        });
      }
    }
    let preparedSceneSupply: JsonObject | null = null;
    if (isCanonicalInvokeSurface(name) && params.operation === "state.move_scene") {
      const preflight = await sceneSupplyPreflight(params, signal, ctx, epoch);
      if (!isCurrent(epoch)) {
        return hostFailureResult(hostVisibleFailure(
          "state.move_scene",
          "session_closed",
          "the originating Pi session closed before scene-supply preflight settled",
          {},
          { class: "business_precondition", recoverableBy: "none" },
        ));
      }
      if (preflight.blocked !== null) return result(preflight.blocked);
      preparedSceneSupply = preflight.supply;
    }
    let value: unknown;
    let transportMeta: McpTransportMeta | null = null;
    // Set only after the canonical resume has crossed its lifecycle acceptance
    // boundary. Startup result classification may reject an otherwise `ok`
    // envelope (for example an incomplete opening route), so `ok` alone is not
    // permission to inspect the extraction backlog.
    let memoryExtractionRearmEligible = false;
    // Run-02 armed-recovery result projection: while an armed recovery
    // finalize is being handled, model-visible content is projected to
    // semantic status and player-visible text only — integrity hashes,
    // source digests, receipt/review/decision ids, and internal payload/
    // binding data stay host-internal in `details` (the exact canonical
    // envelope is preserved there for event delivery/audit).
    let recoveryFinalizeActive = false;
    let recoveryCanonicalDetails: JsonObject | null = null;
    // A Pi-host recovery overlay may deliberately refine the model/behavior
    // surface without changing the canonical receipt. Keep that exact receipt
    // for host-only details while the overlay continues through progress, ACL,
    // working-set, and model projection.
    let canonicalDetailsOverride: JsonObject | null = null;
    // Host-reconstructed semantic recovery instruction: derived ONLY from
    // the exact validated armed internal card, never from any downstream
    // canonical error payload.
    let recoveryVisibleRecovery: JsonObject | null = null;
    const gatewayResult = (canonical: JsonObject) => {
      // The registry projection is judged against THIS invocation's exact
      // campaign. EVERY model-facing canonical operation fails closed with a
      // bounded semantic-identity error when a PRESENT identity field cannot
      // be mapped — required mechanics are never silently dropped from model
      // content. Optional absence remains absence. The exact canonical
      // envelope and the bounded diagnostics stay host-only in `details`.
      const gatewayCampaign = typeof params.campaign === "string"
        ? params.campaign.trim()
        : "";
      const diagnostics = { unmapped: [] as UnmappedIdentityRef[] };
      const canonicalData = objectOrNull(objectOrNull(canonical)?.data);
      const identityScopeData = params.operation === "session.resume"
        ? objectOrNull(canonicalData?.scene_context) ?? canonicalData
        : canonicalData;
      // Host tools such as coc_capabilities carry no `operation` argument, so
      // their identity declarations are keyed by the tool name the canonical
      // envelope reports; without this the boundary sees every field of such
      // an envelope as undeclared and fails the whole result closed.
      const identityOperation = typeof params.operation === "string"
          && params.operation.trim()
        ? params.operation
        : (typeof objectOrNull(canonical)?.tool === "string"
          ? String(objectOrNull(canonical)?.tool)
          : params.operation);
      let baseVisible = modelVisibleCanonicalEnvelope(
        identityOperation,
        canonical,
        liveSemanticIdMap(
          gatewayCampaign,
          identityScopeData,
        ),
        diagnostics,
      );
      if (params.operation === "narration.review") {
        const finalizeBinding = retainedTypedBindings.get("turn.finalize");
        if (
          finalizeBinding?.operation === "turn.finalize"
          && finalizeBinding.reviewed_agency_binding !== undefined
        ) {
          const visibleEnvelope = objectOrNull(baseVisible);
          const visibleData = objectOrNull(visibleEnvelope?.data);
          if (visibleEnvelope?.ok === true && visibleData !== null) {
            const reviewed = finalizeBinding.reviewed_agency_binding;
            baseVisible = {
              ...baseVisible,
              data: {
                ...visibleData,
                finalize_agency_binding: {
                  schema_version: 1,
                  mode: "semantic_reviewed_spans",
                  reviewed_spans: reviewed.spans.map(
                    (row) => row.reviewed_span,
                  ),
                  authorities: reviewed.authorities.map((row) => ({
                    authority: row.authority,
                    claim_types: [...row.claim_types],
                  })),
                  coverage_obligations: reviewed.coverage_obligations.map(
                    (row) => ({
                      obligation: row.obligation_ref,
                      source_kind: row.source_kind,
                      visibility: row.visibility,
                      npc_display_name: row.npc_display_name,
                      skill: row.skill,
                      goal: row.goal,
                      outcome: row.outcome,
                      exceptional_required: row.exceptional_required,
                      allowed_reviewed_spans: [...row.allowed_reviewed_spans],
                      realization: row.realization,
                      placement_mode: row.placement_mode,
                    }),
                  ),
                  mechanics_placement: structuredClone(
                    reviewed.mechanics_placement,
                  ),
                  model_arguments: ["coverage", "agency_claims"],
                  host_bound_evidence: [
                    "draft", "claim_id", "verbatim_reviewed_prose", "subject_ref",
                    "source_ref", "override_id", "narration_review_id",
                    "obligation_id", "mechanics_placements",
                  ],
                  instruction: (
                    "Call coc_turn_finalize with semantic coverage and "
                    + "agency_claims selections only. Copy each offered "
                    + "obligation into coverage.obligation_ref and choose its "
                    + "reviewed_span; then choose reviewed_span, "
                    + "claim_type, and authority for agency; the host restores "
                    + "the frozen draft, exact excerpts, canonical obligations, "
                    + "and safe mechanics placement."
                  ),
                },
              },
            };
          }
        }
      }
      // While an armed recovery owns this result, its closed semantic
      // whitelist is the projection — the hostile canonical payload never
      // reaches the identity discovery path.
      //
      // A canonical FAILURE envelope with a structured code is exempt from
      // the wholesale identity mask: nothing is being narrated from it, and
      // replacing an actionable code (e.g.
      // substantive_exceptional_effect_required, which names its exact
      // recovery operation) with the generic identity error leaves the model
      // no path to close the turn. The projected error has already dropped
      // every unmapped identity field and scrubbed residual machine ids from
      // its prose, so it is safe to deliver; the diagnostics ride along
      // host-only in `details`.
      const canonicalErrorCode = canonical.ok === false
        ? objectOrNull(canonical.error)?.code
        : undefined;
      const actionableCanonicalError = (
        typeof canonicalErrorCode === "string"
        && canonicalErrorCode.trim() !== ""
        && objectOrNull(objectOrNull(baseVisible)?.error) !== null
      );
      if (
        diagnostics.unmapped.length > 0
        && !recoveryFinalizeActive
        && !actionableCanonicalError
      ) {
        const operation = String(params.operation || "");
        const domains = [...new Set(diagnostics.unmapped.map((entry) => entry.domain))];
        // Which fields, not which values. The values are the identity this
        // gate exists to withhold and stay host-only; the field NAMES are
        // schema the Keeper already reads everywhere else, and without them
        // the refusal is unfalsifiable — "(undeclared)" names nothing, so a
        // whole family can go dark and the only way to learn which field did
        // it is to reconstruct it afterwards from host-internal evidence the
        // diagnostic lanes do not even record. On 2026-09-02 every
        // `rules.context` for the sanity family collapsed this way through a
        // full run: the Keeper, handed no cards and no reason, settled
        // decision refs from memory and spent five round trips guessing
        // arguments for a bout that was not underway.
        const undeclaredFields = [...new Set(
          diagnostics.unmapped.map((entry) => entry.path ?? entry.field),
        )].sort().slice(0, 12);
        return {
          ...hostFailureResult({
            ok: false,
            tool: operation,
            error: {
              code: "semantic_identity_unavailable",
              message: "this canonical result names identity-bearing fields "
                + `whose semantic identity is unavailable (${domains.join(", ")}: `
                + `${undeclaredFields.join(", ")}); `
                + "the host keeps the exact canonical result in internal "
                + "details instead of projecting partial mechanics. Refresh "
                + "the turn context before continuing.",
              retryable: false,
              details: {
                class: "business_precondition",
                recoverable_by: "refresh_turn_context",
                semantic_domains: domains,
                undeclared_fields: undeclaredFields,
              },
            },
            warnings: [],
            hints: [],
          }),
          // Host-only evidence: the exact canonical envelope plus the bounded
          // field/domain diagnostics (never the unmapped values).
          details: {
            canonical: canonicalDetailsOverride ?? canonical,
            semantic_identity_diagnostics: diagnostics.unmapped.map((entry) => ({
              field: entry.field,
              parent_field: entry.parentField,
              domain: entry.domain,
              ...(entry.path !== undefined ? { path: entry.path } : {}),
            })),
          },
        };
      }
      const visible = recoveryFinalizeActive
        ? projectRecoveryFinalizeResult(baseVisible, recoveryVisibleRecovery)
        : baseVisible;
      const baseInternalDetails = recoveryCanonicalDetails
        ?? canonicalDetailsOverride
        ?? canonical;
      // Identity diagnostics on a delivered actionable error stay host-only,
      // exactly as the masked path records them (same pattern as
      // `coc_transport` below). An armed recovery keeps its exact preserved
      // canonical envelope untouched.
      const internalDetails = actionableCanonicalError
          && !recoveryFinalizeActive
          && diagnostics.unmapped.length > 0
        ? {
          ...baseInternalDetails,
          semantic_identity_diagnostics: diagnostics.unmapped.map((entry) => ({
            field: entry.field,
            parent_field: entry.parentField,
            domain: entry.domain,
            ...(entry.path !== undefined ? { path: entry.path } : {}),
          })),
        }
        : baseInternalDetails;
      const rendered = { ...result(visible), details: internalDetails };
      const resumeData = objectOrNull(canonical.data);
      const resumeCampaign = typeof params.campaign === "string"
        ? params.campaign.trim()
        : "";
      if (
        params.operation === "session.resume"
        && memoryExtractionRearmEligible
        && canonical.ok === true
        && canonical.tool === "session.resume"
        && resumeCampaign
        && resumeData?.schema_version === 1
        && resumeData.campaign_id === resumeCampaign
        && typeof resumeData.mode === "string"
        && acceptedResumeModes.has(resumeData.mode)
        && signal?.aborted !== true
        && isCurrent(epoch)
      ) {
        rearmPendingMemoryExtraction(ctx, resumeCampaign, epoch);
      }
      // `details` retains the canonical host receipt for the internal event;
      // model-facing `content` receives the host-only-field projection.
      return transportMeta === null
        ? rendered
        : { ...rendered, details: { ...internalDetails, coc_transport: transportMeta } };
    };
    let scenePriorityHandled = false;
    try {
    // Run-02 recovery pre-transport enforcement on the FINAL effective
    // arguments that will be transported. With an authenticated recovery
    // card armed for this campaign, a recovered `turn.finalize` — typed or
    // generic coc_invoke — is a draft-only call: the model supplies ONLY
    // the corrected draft. Any explicitly supplied host-owned identity
    // field fails closed (`recovery_identity_mismatch`); any frozen
    // non-draft payload family fails closed
    // (`recovery_payload_not_draft_only`); a missing armed binding fails
    // closed (`recovery_binding_unarmed`). The host then reconstructs the
    // exact frozen payload from the validated internal card and injects
    // every binding identity, so the transported call is the complete
    // canonical finalize with zero model-relayed opaque material.
    if (
      (typedDefinition?.operation === "turn.finalize"
        || (isCanonicalInvokeSurface(name)
          && params.operation === "turn.finalize"))
      && effectiveTypedRole === "play"
      && typeof params.campaign === "string"
      && params.campaign.trim()
    ) {
      const recoveryCard = draftShapeRecoveryCards.get(params.campaign.trim());
      if (recoveryCard !== undefined) {
        recoveryFinalizeActive = true;
        recoveryVisibleRecovery = projectDraftShapeRecoveryForModel(recoveryCard);
        const recoveryReplayRejection = (
          code: string,
          message: string,
          recoverableBy: string,
        ) => hostFailureResult({
          ok: false,
          tool: "turn.finalize",
          error: {
            code,
            message,
            retryable: false,
            details: {
              class: "invariant_terminal",
              recoverable_by: recoverableBy,
            },
          },
          warnings: [],
          hints: [],
        });
        const binding = retainedTypedBindings.get("turn.finalize");
        const current = currentTypedBindingFactories.get("turn.finalize")?.()
          ?? null;
        if (binding === undefined || current === null) {
          return recoveryReplayRejection(
            "recovery_binding_unarmed",
            "恢复重放被拒绝：本会话没有已验证的冻结绑定，无法机器绑定恢复身份；"
              + "请先完成恢复性 session.resume 重新武装，再调用 turn.finalize。",
            "recovery_session_rearm",
          );
        }
        let hostInjected: Record<string, unknown>;
        try {
          hostInjected = retainedTypedToolHostArguments(
            "turn.finalize",
            binding,
            current,
          );
        } catch {
          return recoveryReplayRejection(
            "recovery_binding_unarmed",
            "恢复重放被拒绝：已武装绑定与当前规范事实不一致，无法机器绑定恢复身份。",
            "replay_exact_frozen_payload",
          );
        }
        const effectiveArguments = objectOrNull(params.arguments) ?? {};
        // Identity violations take precedence: scan every key before
        // rejecting so an explicit identity tamper is always classified as
        // such, never masked by an earlier payload violation.
        const offendingPayloadField = Object.keys(effectiveArguments).find(
          (field) =>
            field !== "draft"
            && !RECOVERY_HOST_INJECTED_FINALIZE_ARGUMENTS.has(field),
        );
        if (offendingPayloadField !== undefined) {
          return recoveryReplayRejection(
            "recovery_payload_not_draft_only",
            "恢复重放被拒绝：恢复调用只需携带修正段落形状后的 draft；"
              + "coverage、agency_claims 及其余冻结参数由宿主从已验证的内部卡"
              + "片自动重建并附加，模型不得提供或修改。",
            "replay_draft_only",
          );
        }
        const offendingIdentityField = Object.keys(
          effectiveArguments,
        ).find((field) =>
          RECOVERY_HOST_INJECTED_FINALIZE_ARGUMENTS.has(field));
        if (offendingIdentityField !== undefined) {
          return recoveryReplayRejection(
            "recovery_identity_mismatch",
            "恢复重放被拒绝：模型提供的 " + offendingIdentityField
              + " 属于宿主机绑定身份；恢复调用只需携带修正后的 draft，"
              + "身份由宿主自动注入，不得携带或改写。",
            "replay_exact_frozen_payload",
          );
        }
        const modelDraft = effectiveArguments.draft;
        if (typeof modelDraft !== "string" || !modelDraft.trim()) {
          return recoveryReplayRejection(
            "recovery_draft_missing",
            "恢复重放被拒绝：恢复调用必须携带修正段落形状后的完整 draft。",
            "replay_draft_only",
          );
        }
        const frozenPayload = objectOrNull(recoveryCard.frozen_finalize_payload);
        if (frozenPayload === null) {
          return recoveryReplayRejection(
            "recovery_payload_unavailable",
            "恢复重放被拒绝：内部冻结负载不可用，无法机器重建恢复调用。",
            "recovery_session_rearm",
          );
        }
        params = {
          ...params,
          arguments: {
            ...frozenPayload,
            ...hostInjected,
            draft: modelDraft,
          },
        };
      }
    }
      const call = await client(ctx).callToolWithTransportMeta(
        isCanonicalInvokeSurface(name) ? "coc_invoke" : name,
        params,
        signal,
      );
      value = call.value;
      transportMeta = call.transport;
      if (!isCurrent(epoch)) {
        return gatewayResult(asObject(value, "late canonical result"));
      }
      turnTelemetry?.recordTransportMeta(_id, transportMeta);
      if (
        process.env.COC_PI_SCENE_SUPPLY === "1"
        && params.operation === "steward.scene_supply"
        && typeof params.campaign === "string"
        && objectOrNull(value)?.ok === true
      ) {
        const envelope = asObject(value, "scene supply envelope");
        const initialSupply = asObject(envelope.data, "scene supply data");
        const supplyArgs = objectOrNull(params.arguments);
        const sceneId = typeof supplyArgs?.scene_id === "string"
          ? supplyArgs.scene_id.trim()
          : "";
        if (sceneId) {
          const resolved = await resolveSceneSupply(
            params,
            sceneId,
            initialSupply,
            signal,
            async () => {
              try {
                const minimal = await client(ctx).callTool("coc_invoke", {
                  operation: "steward.scene_supply",
                  ...(typeof params.root === "string" ? { root: params.root } : {}),
                  campaign: params.campaign,
                  arguments: { scene_id: sceneId, allow_minimal_fallback: true },
                }, signal);
                const minimalEnvelope = objectOrNull(minimal);
                return minimalEnvelope?.ok === true
                  ? objectOrNull(minimalEnvelope.data)
                  : null;
              } catch { return null; }
            },
            epoch,
          );
          if (!isCurrent(epoch) || resolved === null) {
            return gatewayResult(asObject(value, "late canonical result"));
          }
          const terminal = resolved.decision.action === "blocked";
          value = {
            ...envelope,
            data: {
              ...resolved.supply,
              ...(terminal ? { status: "blocked" } : {}),
              host_gate_status: resolved.decision.action === "wait"
                ? "pending_with_live_dispatch"
                : terminal ? "blocked" : "ready",
              ...(resolved.decision.action === "allow"
                ? {}
                : { instruction: resolved.decision.instruction }),
            },
          };
        }
      }
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
            "The current source-bound scene is ready. Continue normal play "
            + "using the returned data.scene_supply as Keeper-only grounding. "
            + "Any neighboring prefetch is private and host-owned; it requires "
            + "no Keeper action and must not be mentioned or promised at the table."
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
      if (!isCurrent(epoch)) {
        const visible = error instanceof CanonicalToolError
          ? modelVisibleCanonicalToolResult(error)
          : null;
        if (visible !== null) return result(visible);
        throw error;
      }
      if (
        launcherRole === null
        && typedDefinition?.operation === "setup.quick_start"
        && !(error instanceof CanonicalToolError)
        && objectOrNull(params.arguments)?.campaign_id === undefined
        && typeof objectOrNull(params.arguments)?.decision_id === "string"
        && noSelectorQuickStartRecovery === null
      ) {
        noSelectorQuickStartRecovery = {
          params: structuredClone(params),
          retriesRemaining: 1,
        };
        refreshTypedToolDefinition("setup.quick_start");
        applyKpActiveTools();
      } else if (noSelectorQuickStartRecoveryAttempt) {
        refreshTypedToolDefinition("setup.quick_start");
        applyKpActiveTools();
      }
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
        const visible = error instanceof CanonicalToolError
          ? attachExpectedSchema(
            modelVisibleCanonicalToolResult(error),
            typeof params.operation === "string" ? params.operation : null,
            undefined,
            typeof params.operation === "string"
              ? currentBindingContext(params.operation) ?? undefined
              : undefined,
          )
          : null;
        // Observable canonical envelopes stay live for observe. Finalizing
        // here deletes the admitted attempt and the later observe of the
        // same _id becomes unowned_result. Transport/non-envelope failures
        // still have no result to observe, so they finalize here.
        if (
          isCanonicalInvokeSurface(name)
          && !directResumeRecovery
          && visible === null
        ) {
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
        if (visible === null) throw error;
        value = visible;
      }
    }
    if (!isCurrent(epoch)) {
      return gatewayResult(asObject(value, "late canonical result"));
    }
    let liveHydration: PendingFinalizationHydration = { status: "not_attempted" };
    // True when this call attached a persisted draft-shape recovery card onto
    // an already-acknowledged resume: the silent-settled-startup quarantine
    // must stay disarmed so the recovery agent can reach the preserved turn.
    let acknowledgedResumeRecoveryAttached = false;
    if (isCanonicalInvokeSurface(name)) {
      const accepted = acceptCanonicalStructuredResult(
        String(params.operation || ""),
        value,
      );
      value = accepted.value;
      if (
        !startupResumeAttempt
        && params.operation === "session.resume"
        && accepted.accepted
      ) {
        memoryExtractionRearmEligible = true;
      }
      let acceptedData = objectOrNull(objectOrNull(value)?.data);
      if (
        accepted.accepted
        && params.operation === "session.resume"
        && acceptedData?.mode === "open_turn_recovery"
      ) {
        canonicalDetailsOverride = structuredClone(accepted.value);
      }
      if (
        accepted.accepted
        && params.operation === "session.resume"
        && typeof params.campaign === "string"
        && params.campaign.trim()
        && acceptedData?.campaign_id === params.campaign.trim()
        && acceptedData.mode === "awaiting_player"
        && acceptedData.current_turn == null
        && acceptedData.pending_turn == null
        && acceptedData.pending_output_context == null
        && acceptedData.ending_output == null
        && validOpenTurnAnchor(acceptedData.open_turn_anchor)
      ) {
        const cached = loadZeroToolOpenTurnPlayerInput({
          root: currentWorkspaceRoot,
          campaignId: params.campaign.trim(),
          anchor: acceptedData.open_turn_anchor,
        });
        if (cached.ok) {
          canonicalDetailsOverride = structuredClone(accepted.value);
          value = {
            ...(objectOrNull(value) ?? {}),
            data: {
              ...acceptedData,
              mode: "open_turn_recovery",
              next_operations: ["continue_current_turn_from_receipts"],
              current_turn: {
                schema_version: 1,
                meaningful_row_count: 0,
                operational_row_count: 0,
                rows: [],
                zero_tool_accepted_input: true,
              },
            },
          };
          acceptedData = objectOrNull(objectOrNull(value)?.data);
          try {
            pi.appendEntry("coc-zero-tool-open-turn-recovery", {
              schema_version: 1,
              status: "rebound",
              campaign_id: params.campaign.trim(),
            });
          } catch { /* zero-tool recovery audit is best effort */ }
        }
      }
      const acceptedContractProjection = objectOrNull(
        acceptedData?.contract_projection,
      );
      // Run-02 defect 1: a canonical `default_mechanics_placement_unavailable`
      // rejection left the KP with only an action label — never an executable
      // revision. Build the recovery card from the exact failed call plus the
      // retained frozen-turn identities, persist it (card plus machine-internal
      // payload seal) as session entries, and attach it to the model-visible
      // failure. Fail-closed three times over: without the full frozen
      // identity/draft/coverage/agency payload the host invents nothing; the
      // payload whitelist is derived from the canonical typed schema, never
      // hand-picked; and the card is cached or attached only after BOTH its
      // durable appends succeeded — a persistence failure leaves the original
      // canonical error and no recoverable claim. A card whose accepted-review
      // evidence never persisted is never created (it could never
      // authenticate).
      if (
        isCanonicalInvokeSurface(name)
        && params.operation === "turn.finalize"
        && effectiveTypedRole === "play"
        && isDraftShapePlacementFailure(value)
        && typeof params.campaign === "string"
        && params.campaign.trim()
      ) {
        const campaignId = params.campaign.trim();
        // One pending turn admits exactly one sealed payload. A repeat
        // failure never appends a second (possibly conflicting) card: the
        // armed card stays the single durable authority and is simply
        // re-attached for visibility.
        const existingCard = draftShapeRecoveryCards.get(campaignId);
        const facts = retainedOutputContextFacts;
        const modelOwnedFields = modelOwnedFinalizeFields();
        const sessionEntries = typeof ctx.sessionManager?.getEntries === "function"
          ? ctx.sessionManager.getEntries()
          : [];
        const evidenceDurable = facts === null
          ? false
          : hasReviewEvidenceEntry(sessionEntries, {
              campaign: campaignId,
              turnId: facts.turnId,
              sourceDigest: facts.sourceDigest,
              revision: facts.revision,
              narrationReviewId: facts.narrationReviewId ?? "",
            });
        const card = existingCard ?? (evidenceDurable
          ? buildDraftShapeRecoveryCard({
              root: typeof params.root === "string" && params.root
                ? params.root
                : ctx.cwd,
              campaign: campaignId,
              facts: facts === null
                ? null
                : {
                    turnId: facts.turnId,
                    sourceDigest: facts.sourceDigest,
                    revision: facts.revision,
                    narrationReviewId: facts.narrationReviewId ?? "",
                  },
              finalizeArguments: objectOrNull(params.arguments),
              failureEnvelope: value,
              modelOwnedFields,
            })
            : null);
        let persisted = existingCard !== undefined;
        if (existingCard === undefined && card !== null) {
          try {
            pi.appendEntry(DRAFT_SHAPE_RECOVERY_CARD_AUDIT, card);
            pi.appendEntry(DRAFT_SHAPE_RECOVERY_SEAL_AUDIT, {
              schema_version: 1,
              campaign_id: campaignId,
              turn_id: card.turn_id,
              source_digest: card.source_digest,
              revision: card.revision,
              narration_review_id: card.narration_review_id,
              payload_sha256: card.payload_sha256,
            });
            persisted = true;
          } catch {
            // Durable recovery was not armed; the original canonical error
            // below stays the model's only truth for this failure. A card
            // entry without its seal never authenticates.
            persisted = false;
          }
        }
        if (persisted && card !== null) {
          draftShapeRecoveryCards.set(campaignId, card);
          // Model-visible surface carries the semantic projection and a
          // FIXED semantic message — the canonical error can interpolate
          // caller-supplied source ids, so it is never echoed. The exact
          // canonical envelope stays host-internal in gateway `details`.
          const recovery = projectDraftShapeRecoveryForModel(card);
          if (recovery !== null) {
            recoveryFinalizeActive = true;
            recoveryVisibleRecovery = recovery;
            recoveryCanonicalDetails = asObject(
              value,
              "run-02 recovery canonical error envelope",
            );
            value = {
              ok: false,
              tool: "turn.finalize",
              error: {
                code: "default_mechanics_placement_unavailable",
                message: RECOVERY_FINALIZE_SEMANTIC_MESSAGES[
                  "default_mechanics_placement_unavailable"
                ],
                retryable: false,
                recovery,
              },
              warnings: [],
              hints: [],
            };
          }
        }
      }
      const validatedOutputContextCards = (
        accepted.accepted
        && params.operation === "turn.output_context"
      ) ? validateLiveOutputContext(value, null, {
          // Explicit coc_invoke lane binds the invocation campaign exactly:
          // a digest-valid receipt for another campaign never validates.
          campaignId: typeof params.campaign === "string"
            ? params.campaign.trim()
            : "",
        }) : null;
      if (
        accepted.accepted
        && params.operation === "turn.output_context"
        && typeof params.campaign === "string"
        && effectiveTypedRole === "play"
        && acceptedContractProjection?.agency_review_required === true
      ) {
        stateClaimCompiler.observeOutputContext(params.campaign, value);
      }
      // Host-owned live output-context hydration for an accepted pointer-only
      // pending-finalization resume. It must run BEFORE the resume progress
      // observation below: the live receipt is ingested at its true canonical
      // stage (output_context_ready), and the resume's inferred review_ready
      // advance is then forward instead of regressive. Skipped whenever a
      // fault-latched frozen recovery lane owns the turn, the snapshot already
      // carries a complete inline card chain, or the call is cancelled/stale;
      // failures are card-free and never latch a fault.
      if (
        accepted.accepted
        && params.operation === "session.resume"
        && isCurrent(epoch)
        && signal?.aborted !== true
        && typeof params.campaign === "string"
        && params.campaign.trim()
        && openingContinuationGate.currentTurnProcessingFault() === null
        && isPendingFinalizationResume(value)
        && acceptedData?.campaign_id === params.campaign
        && !pendingFinalizationInlineCardsComplete(value)
      ) {
        liveHydration = await runPendingFinalizationHydration({
          resumeValue: value,
          campaign: params.campaign,
          root: typeof params.root === "string" && params.root
            ? params.root
            : ctx.cwd,
          ctx,
          signal,
          epoch,
        });
        if (liveHydration.status === "superseded") {
          return gatewayResult(value as JsonObject);
        }
      } else if (
        accepted.accepted
        && params.operation === "session.resume"
        && isCurrent(epoch)
        && signal?.aborted !== true
        && typeof params.campaign === "string"
        && params.campaign.trim()
        && effectiveTypedRole === "play"
        && acceptedData?.campaign_id === params.campaign
        && acceptedData?.mode === "already_acknowledged"
      ) {
        // Run-02 defect 2, cross-agent lane: the lifecycle may already be
        // acknowledged while the preserved pending turn is still unfinalized.
        // A bare no-op leaves turn.finalize unarmed (review gated, finalize
        // projection with no current host context). Selection is always the
        // authenticated session-entry fold — in-memory JSON is never
        // trusted: the card must be structurally complete, the campaign's
        // only unresolved frozen identity, unretired by any successful
        // finalize, and its narration review identity must be authenticated
        // by host-owned accepted-review evidence. Only then does the host
        // probe the live canonical output context once (read-only,
        // bounded); a validating receipt matching the frozen identity
        // re-arms the host context, re-arms the preserved finalize binding,
        // and attaches the exact executable card onto the resume result
        // instead of the bare no-op. Anything else leaves the canonical
        // no-op untouched (fail closed, no invention, no fault).
        const campaignId = params.campaign.trim();
        const recoveryRoot = typeof params.root === "string" && params.root
          ? params.root
          : ctx.cwd;
        const card = selectRecoverableDraftShapeCard(
          typeof ctx.sessionManager?.getEntries === "function"
            ? ctx.sessionManager.getEntries()
            : [],
          campaignId,
        );
        if (card !== null) {
          draftShapeRecoveryCards.set(campaignId, card);
          const recoveredHydration = await runPendingFinalizationHydration({
            resumeValue: value,
            campaign: campaignId,
            root: recoveryRoot,
            ctx,
            signal,
            epoch,
            pendingIdentity: {
              turnId: String(card.turn_id),
              sourceDigest: String(card.source_digest),
              revision: Number.isInteger(card.revision)
                ? Number(card.revision)
                : null,
            },
          });
          if (recoveredHydration.status === "success" && isCurrent(epoch)) {
            // Missing or mismatched journal evidence fails the whole lane
            // closed: no binding, no guidance, no quarantine suppression.
            const recoveredAgencyBinding = armRecoveredFinalizeBinding({
              campaign: campaignId,
              root: recoveryRoot,
              narrationReviewId: String(card.narration_review_id),
              cards: recoveredHydration.cards,
            });
            if (recoveredAgencyBinding !== null) {
              const guided = applyAcknowledgedResumeRecoveryGuidance(
                value,
                card,
                { root: recoveryRoot, campaign: campaignId },
              );
              if (guided.attached) {
                value = guided.envelope as JsonObject;
                acknowledgedResumeRecoveryAttached = true;
                applyKpActiveTools();
                try {
                  pi.appendEntry(
                    "coc-acknowledged-resume-recovery-guidance",
                    guided.audit,
                  );
                } catch { /* recovery-guidance audit is best effort */ }
              }
            }
          }
        }
      }
      const authorizedHostBindingRefreshPending = (
        params.operation === "turn.output_context"
        && validatedOutputContextCards !== null
        && canonicalProgress.stage === "faulted"
        && faultRecoveryOperation === "turn.output_context"
      );
      observeCanonicalProgress(
        String(params.operation || ""),
        params,
        value,
        validatedOutputContextCards,
      );
      const authorizedHostBindingRefreshCommitted = (
        authorizedHostBindingRefreshPending
        && canonicalProgress.stage === "output_context_ready"
        && faultRecoveryOperation === null
      );
      if (!authorizedHostBindingRefreshCommitted) {
        nonRetryableFailureCircuit.observe({
          campaignId: typeof params.campaign === "string" ? params.campaign : "",
          operation: String(params.operation || ""),
          phase: resolveAclPhase(
            typeof params.campaign === "string" ? params.campaign : "",
          ),
          operationArgs: objectOrNull(params.arguments) ?? {},
          envelope: value,
          playerTurnEpoch: canonicalProgress.playerTurnEpoch,
          canonicalProgress,
        });
      }
      {
        // Retain/clear the host provenance pledges consumers are attached from.
        const pledgeCampaign = typeof params.campaign === "string"
          ? params.campaign.trim()
          : "";
        const pledgeEnvelope = objectOrNull(value);
        if (pledgeCampaign !== "" && pledgeEnvelope?.ok === true) {
          const producedFor = pledgeConsumersOf(String(params.operation || ""));
          for (const consumer of producedFor) {
            const minted = pledgedValue(HOST_PROVENANCE_PLEDGES[consumer], {
              data: objectOrNull(pledgeEnvelope.data),
              arguments: objectOrNull(params.arguments),
              call: params,
            });
            if (minted === null) continue;
            retainedHostPledges.set(
              hostPledgeKey(pledgeCampaign, consumer),
              minted,
            );
          }
          if (HOST_PROVENANCE_PLEDGES[String(params.operation || "")]) {
            retainedHostPledges.delete(
              hostPledgeKey(pledgeCampaign, String(params.operation)),
            );
          }
        }
      }
      const reviewEnvelope = objectOrNull(value);
      const reviewData = objectOrNull(reviewEnvelope?.data);
      const reviewRevision = Number(reviewData?.revision);
      const reviewRewriteRequired = (
        accepted.accepted
        && params.operation === "narration.review"
        && reviewEnvelope?.ok === true
        && typeof reviewData?.review_id === "string"
        && reviewData.review_id.length > 0
        && reviewRevision === 1
        && (
          reviewData.agency_gate === "rewrite_required"
          || reviewData.state_authority_gate === "rewrite_required"
        )
      );
      if (
        reviewRewriteRequired
        && typeof params.campaign === "string"
        && params.campaign.trim()
        && isCurrent(epoch)
        && signal?.aborted !== true
      ) {
        const reviewArgs = objectOrNull(params.arguments);
        const turnId = typeof reviewData?.turn_id === "string"
          ? reviewData.turn_id
          : typeof reviewArgs?.turn_id === "string"
            ? reviewArgs.turn_id
            : "";
        const sourceDigest = typeof reviewData?.source_digest === "string"
          ? reviewData.source_digest
          : typeof reviewArgs?.source_digest === "string"
            ? reviewArgs.source_digest
            : "";
        if (turnId && sourceDigest) {
          const campaignId = params.campaign.trim();
          const refreshed = await runPendingFinalizationHydration({
            resumeValue: {
              ok: true,
              tool: "session.resume",
              data: {
                schema_version: 1,
                campaign_id: campaignId,
                mode: "pending_finalization",
              },
            },
            campaign: campaignId,
            root: typeof params.root === "string" && params.root
              ? params.root
              : ctx.cwd,
            ctx,
            signal,
            epoch,
            pendingIdentity: {
              turnId,
              sourceDigest,
              revision: 2,
            },
          });
          if (refreshed.status === "superseded") {
            return gatewayResult(asObject(value, "late canonical result"));
          }
        }
      }
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
        await refreshKeeperBriefing(
          ctx,
          params.campaign.trim(),
          briefingReason,
          epoch,
        );
        if (!isCurrent(epoch)) {
          return gatewayResult(asObject(value, "late canonical result"));
        }
      }
      const moduleInitResolution = await resolveCanonicalModuleInitPrivateContext(
        ctx.cwd,
        params,
        value,
      );
      if (!isCurrent(epoch)) {
        return gatewayResult(asObject(value, "late canonical result"));
      }
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
      if (!isCurrent(epoch)) {
        return gatewayResult(asObject(value, "late canonical result"));
      }
      const openingObservationParams = (
        launcherRole === null
        && typedDefinition?.operation === "setup.quick_start"
      )
        ? openingContinuationGate.adoptNoSelectorQuickStartResultOwnership(
            params,
            value,
            _id,
          )
        : params;
      const openingObservation = (
        openingContinuationGate.observeOpeningSetupInvocation(
          String(params.operation),
          openingObservationParams,
          value,
          _id,
          setupVisibleOutput,
        )
      );
      if (
        noSelectorQuickStartRecoveryAttempt
        && openingObservation.accepted
        && (
          openingObservation.reason === "fresh_quick_start_character_setup"
          || openingObservation.reason
            === "fresh_quick_start_pregen_handoff_decision"
        )
      ) {
        noSelectorQuickStartRecovery = null;
        refreshTypedToolDefinition("setup.quick_start");
        applyKpActiveTools();
      }
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
      // Finalize-after asynchronous memory extraction: schedule the derived
      // semantic worker from the canonical finalize evidence and return the
      // player-facing envelope immediately — the worker is never awaited on
      // the player path.
      const memoryExtractionRun = autoDispatchPiMemoryExtraction(
        memoryExtractionDispatcher,
        params,
        value,
        () => isCurrent(epoch),
      );
      memoryExtractionRuns.add(memoryExtractionRun);
      void memoryExtractionRun.catch(() => {}).finally(() => {
        memoryExtractionRuns.delete(memoryExtractionRun);
      });
      if (startupResumeAttempt) {
        const selectedCampaignId = startupResumeGate?.campaignId ?? "";
        const startupGateOrigin = startupResumeGate?.origin ?? "startup_selector";
        const disposition = classifyStartupResumeResult(
          value,
          selectedCampaignId,
          openingObservation,
        );
        const exactRoleNullResume = (
          startupGateOrigin !== "role_null_handoff"
          || (
            openingObservation.accepted
            && openingObservation.reason === "role_null_handoff_resumed"
          )
        );
        if (disposition.accepted && exactRoleNullResume) {
          memoryExtractionRearmEligible = disposition.mode !== null;
          if (disposition.mode === null && openingObservation.accepted) {
            advanceCanonicalProgress(selectedCampaignId, {
              stage: "acting",
            }, { reprojectTools: false });
          }
          if (
            (disposition.mode === "already_acknowledged"
              || disposition.mode === "awaiting_player")
            // A resumed-and-armed pending-finalization recovery owns this
            // turn: the agent must finalize the preserved turn, not sit
            // quarantined behind a silent acknowledged no-op.
            && !acknowledgedResumeRecoveryAttached
          ) {
            if (!startupBranchTrailingPlayerUser) {
              // Arm the same-turn quarantine BEFORE clearing the startup gate
              // so the tool set applied here is already empty. A trailing
              // unmatched external player turn keeps it disarmed: the
              // auto-open agent must finish that existing player epoch with
              // normal tools, output, and empty-final recovery — no resend.
              startupSilentResumeQuarantine = {
                campaignId: selectedCampaignId,
                mode: disposition.mode,
              };
            }
          }
          if (
            startupSilentResumeQuarantine === null
            && livePlayerMessageForOpenTurn !== null
            && livePlayerMessageForOpenTurn.campaignId === selectedCampaignId
            && livePlayerMessageForOpenTurn.playerTurnEpoch
              === canonicalProgress.playerTurnEpoch
          ) {
            // The player message that reached this process before the startup
            // resume classified it owns this turn — the quarantine above is
            // disarmed precisely so the agent finishes it with ordinary tools.
            // state.journal is one of those tools and its player_text is
            // host-owned, so without arming here the Keeper spends the whole
            // turn on missing_param and the player gets an empty reply.
            openingContinuationGate.currentExternalPlayerText =
              livePlayerMessageForOpenTurn.text;
            armJournalBinding(selectedCampaignId);
          }
          startupResumeGate = null;
          if (startupGateOrigin === "role_null_handoff") {
            refreshTypedToolDefinition("session.resume");
          }
          applyKpActiveTools();
        } else if (startupGateOrigin === "role_null_handoff") {
          terminalizeStartupResume(
            disposition.accepted
              ? "role_null_handoff_resume_invalid"
              : disposition.failureClass,
          );
          applyKpActiveTools();
        } else {
          terminalizeStartupResume(disposition.failureClass);
        }
        // The startup branch fact served its one resume classification;
        // any later resume is no longer the startup boundary.
        startupBranchTrailingPlayerUser = false;
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
        const ownershipRejected = (
          openingObservation.reason === "unowned_result"
          || openingObservation.reason === "invocation_or_campaign_mismatch"
          || openingObservation.reason === "stale_generation_or_revision"
          || openingObservation.reason === "duplicate_invocation_identity"
        );
        if (
          (
            task !== null
            && dispatchKey
            && !openingObservation.dispatchAllowed
          )
          || (
            !openingObservation.accepted
            && ownershipRejected
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
          return gatewayResult(value as JsonObject);
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
          if (!isCurrent(epoch)) {
            return gatewayResult(asObject(value, "late canonical result"));
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
      const operation = String(params.operation);
      if (operation === "session.resume") {
        const remapped = remapUnopenedReadyTableResume(value, {
          workspaceRoot: typeof params.root === "string" ? params.root : ctx.cwd,
          campaignId: typeof params.campaign === "string" ? params.campaign : undefined,
        });
        if (remapped.remapped) value = remapped.envelope;
      }
      const envelope = objectOrNull(value);
      const data = objectOrNull(envelope?.data);
      openingContinuationGate.observeCanonicalReceipt(operation, envelope);
      // A play host never completes setup, so there is no role-null handoff to
      // accept: `pi-coc-setup` builds the campaign and exits, and this process
      // starts on a campaign that is already ready.
      if (
        operation !== "setup.complete"
        || (
          openingObservation.accepted
          && openingObservation.reason === "opening_setup_handoff_complete"
        )
      ) {
        emitSetupHandoff(envelope, operation, params);
      }
      const nextPhase = inferPhaseFromEnvelope(operation, value, kpPlayPhase, {
        workspaceRoot: typeof params.root === "string" ? params.root : ctx.cwd,
        campaignId: typeof params.campaign === "string" ? params.campaign : undefined,
      });
      if (nextPhase !== kpPlayPhase) {
        kpPlayPhase = nextPhase;
        applyKpActiveTools();
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
        applyKpActiveTools();
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
          if (!isCurrent(epoch)) {
            return gatewayResult(asObject(value, "late canonical result"));
          }
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
    if (isCanonicalInvokeSurface(name) && params.operation === "session.resume") {
      const resumeCampaign = typeof params.campaign === "string"
        ? params.campaign
        : "";
      const resumeSessionId = typeof ctx.sessionManager?.getSessionId === "function"
        ? String(ctx.sessionManager.getSessionId() || "")
        : "";
      const recoveryIdentity = openingContinuationGate.frozenReviewRecoveryIdentity();
      const reviewRecoveryArmed = isPendingFinalizationResume(value)
        && recoveryIdentity !== null
        && openingContinuationGate.armFrozenReviewRecovery({
          campaign_id: resumeCampaign,
          run_id: resumeSessionId,
          session_id: resumeSessionId,
          turn_id: recoveryIdentity.turn_id,
          revision: recoveryIdentity.revision,
          source_digest: recoveryIdentity.source_digest,
        });
      // A live success that can no longer be safely attached (caller
      // cancelled or session went stale between ingestion and guidance)
      // degrades to the card-free fallback; cancelled/stale sessions can
      // never attach cards.
      const effectiveLiveHydration: PendingFinalizationHydration = (
        liveHydration.status === "success"
        && (signal?.aborted || !isCurrent(epoch))
      )
        ? { status: "unavailable" }
        : liveHydration;
      const recoveryRoot = typeof params.root === "string" && params.root
        ? params.root
        : ctx.cwd;
      let acceptedReviewBinding: ReviewedAgencyBinding | null = null;
      if (
        effectiveLiveHydration.status === "success"
        && effectiveLiveHydration.cards.agencyReviewRequired
        && effectiveLiveHydration.cards.reviewCard !== null
        && effectiveLiveHydration.cards.frozenDraftMode === "exact_replay"
        && effectiveLiveHydration.cards.frozenDraft !== null
        && effectiveLiveHydration.cards.acceptedReviewEvidence !== null
        && typeof effectiveLiveHydration.cards.acceptedReviewEvidence.review_id
          === "string"
        && effectiveLiveHydration.cards.acceptedReviewEvidence.review_id.length > 0
      ) {
        acceptedReviewBinding = armRecoveredFinalizeBinding({
          campaign: resumeCampaign,
          root: recoveryRoot,
          narrationReviewId:
            effectiveLiveHydration.cards.acceptedReviewEvidence.review_id,
          cards: effectiveLiveHydration.cards,
          exactCardDecision: true,
        });
      }
      const pendingGuided = applyPendingFinalizationRecoveryGuidance(value, {
        root: recoveryRoot,
        campaign: resumeCampaign,
      }, {
        reviewRecoveryArmed,
        acceptedReviewBinding,
        ...(reviewRecoveryArmed ? { revision: recoveryIdentity.revision } : {}),
        ...(effectiveLiveHydration.status !== "not_attempted"
          ? { liveHydration: effectiveLiveHydration }
          : {}),
      });
      if (pendingGuided.attached) {
        openTurnRecoveryAuthorization = null;
        if (
          typeof params.campaign === "string"
          && params.campaign.trim()
          && currentOpenTurnAnchor?.campaignId === params.campaign.trim()
        ) {
          clearOpenTurnPlayerInput(
            currentWorkspaceRoot,
            params.campaign.trim(),
            currentOpenTurnAnchor.anchor,
          );
        }
        value = pendingGuided.envelope as JsonObject;
        try {
          pi.appendEntry(
            PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT,
            pendingGuided.audit,
          );
        } catch { /* recovery-guidance audit is best effort */ }
      } else {
        const openTurnData = objectOrNull(objectOrNull(value)?.data);
        const recoveryRoot = currentWorkspaceRoot;
        const zeroToolAccepted = (
          objectOrNull(openTurnData?.current_turn)?.zero_tool_accepted_input
          === true
        );
        const recoveredInput = (
          openTurnData?.mode === "open_turn_recovery"
          && typeof params.campaign === "string"
          && params.campaign.trim()
          && currentOpenTurnAnchor?.campaignId === params.campaign.trim()
        ) ? zeroToolAccepted
          ? loadZeroToolOpenTurnPlayerInput({
              root: recoveryRoot,
              campaignId: params.campaign.trim(),
              anchor: currentOpenTurnAnchor.anchor,
            })
          : loadOpenTurnPlayerInput({
              root: recoveryRoot,
              campaignId: params.campaign.trim(),
              currentTurn: openTurnData.current_turn,
              anchor: currentOpenTurnAnchor.anchor,
            }) : null;
        const guided = applyOpenTurnRecoveryGuidance(value, {
          expectedCampaign: typeof params.campaign === "string"
            ? params.campaign.trim()
            : undefined,
          playerInput: recoveredInput?.ok === true ? recoveredInput.card : null,
          zeroToolAccepted,
        });
        if (guided.attached) {
          value = guided.envelope as JsonObject;
          const authorized = guided.audit?.acting_authorized === true;
          openTurnRecoveryAuthorization = authorized
            && typeof params.campaign === "string"
            && params.campaign.trim()
            ? {
                campaignId: params.campaign.trim(),
                sessionEpoch,
                playerTurnEpoch: canonicalProgress.playerTurnEpoch,
                anchorDigest: currentOpenTurnAnchor?.anchor.anchor_digest ?? "",
              }
            : null;
          applyKpActiveTools();
          try {
            pi.appendEntry(OPEN_TURN_RECOVERY_GUIDANCE_AUDIT, guided.audit);
          } catch { /* recovery-guidance audit is best effort */ }
        } else if (
          openTurnData !== null
          && openTurnData.mode !== "open_turn_recovery"
          && typeof params.campaign === "string"
          && params.campaign.trim()
          && currentOpenTurnAnchor?.campaignId === params.campaign.trim()
          // Clear ONLY when the open pre-journal window is genuinely gone.
          // A resume can come back in a non-recovery mode for transient
          // reasons — a delivery replay owning the turn, a pending
          // finalization of the previous output — while the crashed turn is
          // still open and pre-journal. Clearing the accepted-input cache on
          // those resumes destroyed the one binding recovery can use, and a
          // live table deadlocked exactly that way: fault turn, replay-lock
          // resume wiped the cache, and every later recovery reported
          // player_input_binding_unavailable with no way forward.
          && !validPreJournalWindow(objectOrNull(openTurnData.current_turn))
        ) {
          openTurnRecoveryAuthorization = null;
          clearOpenTurnPlayerInput(
            recoveryRoot,
            params.campaign.trim(),
            currentOpenTurnAnchor.anchor,
          );
        }
      }
    }
    return gatewayResult(value as JsonObject);
  };
  const executeDiscovery = async (
    _id: string,
    params: JsonObject,
    _signal: AbortSignal | undefined,
    _update: unknown,
    _ctx: ExtensionContext,
  ) => {
    const role = effectiveTypedRole;
    const operation = typeof params.operation === "string" ? params.operation : null;
    const domain = typeof params.domain === "string" ? params.domain : null;
    if (operation !== null && domain !== null) {
      return discoveryFailure(
        "invalid_request",
        "choose exactly one of operation or domain",
        { selectors: ["operation", "domain"] },
      );
    }
    const snapshot = workingSetSnapshot(role);
    if (operation === null && domain === null) {
      const namespaces = KP_SURFACES
        .filter((surface): surface is WorkingSetNamespace => surface !== "none")
        .flatMap((namespace) => {
          const loaded = loadToolNamespace(snapshot, { kind: "namespace", namespace });
          return loaded.ok || loaded.code === "namespace_too_large"
            ? [{ namespace, exact_operation_supported: true }]
            : [];
        });
      return result({
        ok: true,
        tool: "coc_discover",
        data: {
          schema_version: 1,
          role,
          phase: snapshot.phase,
          stage: snapshot.stage,
          namespaces,
          selector: "pass one semantic dotted operation or one namespace enum",
        },
      });
    }
    const loaded = loadToolNamespace(
      snapshot,
      operation !== null
        ? { kind: "exact_operation", operation }
        : { kind: "namespace", namespace: domain as WorkingSetNamespace },
    );
    if (!loaded.ok) {
      return discoveryFailure(loaded.code, loaded.message, loaded.details);
    }
    const actualWorkingSet = withActualRegisteredSchemas(loaded.workingSet);
    if (!actualWorkingSet.ok) {
      return discoveryFailure(
        actualWorkingSet.error?.code ?? "invalid_snapshot",
        actualWorkingSet.error?.message
          ?? "registered tool schema projection failed closed",
        actualWorkingSet.error?.details ?? {},
      );
    }
    const typed = operation === null ? null : typedToolByOperation.get(operation) ?? null;
    let parameters = typed?.parameters ?? null;
    if (typed !== null) {
      const binding = retainedTypedBindings.get(typed.operation);
      if (binding !== undefined) {
        try {
          parameters = projectBoundTypedToolParameters(
            typed.operation,
            typed.parameters,
            binding,
            currentTypedBindingFactories.get(typed.operation)?.() ?? null,
          );
        } catch (error) {
          if (!(error instanceof ToolContractProjectionError)) throw error;
          return hostFailureResult(hostBindingFailure(typed.operation, error));
        }
      }
    }
    if (loaded.grant.kind === "namespace") {
      loadedNamespaces = [
        ...loadedNamespaces.filter((grant) => grant.namespace !== loaded.grant.namespace),
        loaded.grant,
      ];
    } else {
      loadedOperations = [
        ...loadedOperations.filter((grant) => grant.operation !== loaded.grant.operation),
        loaded.grant,
      ];
    }
    lastWorkingSet = actualWorkingSet;
    auditWorkingSet(actualWorkingSet);
    pi.setActiveTools([...actualWorkingSet.activeToolNames]);
    return result({
      ok: true,
      tool: "coc_discover",
      data: {
        schema_version: 1,
        loaded: loaded.grant,
        ...(typed === null ? {} : {
          operation_card: {
            operation: typed.operation,
            tool_name: typed.name,
            description: typed.description,
            parameters,
          },
        }),
        working_set: {
          revision: actualWorkingSet.revision,
          active_tool_count: actualWorkingSet.activeToolNames.length,
          schema_bytes: actualWorkingSet.schemaBytes,
        },
      },
    });
  };

  pi.registerTool({
    name: "coc_capabilities", label: "COC capabilities",
    description: "Return canonical COC host capabilities.", parameters: emptySchema,
    execute: gateway("coc_capabilities"),
    ...compactToolRenderers("coc_capabilities"),
  });
  pi.registerTool({
    name: "coc_discover", label: "COC discover",
    description: "Load one canonical operation or one bounded namespace into the current turn working set.", parameters: discoverSchema,
    executionMode: "sequential",
    execute: executeDiscovery,
    ...compactToolRenderers("coc_discover"),
  });
  pi.registerTool({
    name: "coc_invoke", label: "COC invoke (hidden compat)",
    description: "Hidden compatibility gateway. Live KP should use the closed domain tools.", parameters: invokeSchema,
    executionMode: "sequential",
    execute: gateway("coc_invoke"),
    ...compactToolRenderers("coc_invoke"),
  });
  for (const domainName of DOMAIN_TOOL_NAMES) {
    pi.registerTool({
      name: domainName,
      label: DOMAIN_TOOL_LABELS[domainName],
      description: DOMAIN_TOOL_DESCRIPTIONS[domainName],
      parameters: domainToolSchema(domainName),
      executionMode: "sequential",
      execute: gateway(domainName),
      ...compactToolRenderers(domainName),
    });
  }
  const registerTypedDefinition = (typed: TypedOperationTool): void => {
    const binding = currentBindingContext(typed.operation);
    let parameters = typed.parameters;
    if (binding !== null) {
      parameters = projectBoundTypedToolParameters(
        typed.operation,
        typed.parameters,
        binding.binding,
        binding.current_host_context,
      );
    }
    if (launcherRole === null && typed.operation === "setup.quick_start") {
      const projected = structuredClone(parameters);
      projected.required = (projected.required ?? []).filter(
        (key) => key !== "root" && key !== "campaign",
      );
      if (!projected.required.includes("decision_id")) {
        projected.required.push("decision_id");
      }
      if (projected.properties !== undefined) {
        delete projected.properties.root;
        delete projected.properties.campaign;
        const retainedArguments = objectOrNull(
          noSelectorQuickStartRecovery?.params.arguments,
        );
        if (retainedArguments !== null) {
          for (const [key, value] of Object.entries(retainedArguments)) {
            const property = objectOrNull(projected.properties[key]);
            if (property !== null) {
              projected.properties[key] = { ...property, const: value };
            }
          }
        }
      }
      parameters = projected;
    } else if (
      launcherRole === null
      && typed.operation === "setup.complete"
    ) {
      const projected = structuredClone(parameters);
      projected.required = (projected.required ?? []).filter(
        (key) => key !== "root" && key !== "campaign",
      );
      if (projected.properties !== undefined) {
        delete projected.properties.root;
        delete projected.properties.campaign;
        const decisionSchema = objectOrNull(
          projected.properties.decision_id,
        ) ?? {};
        const state = openingContinuationGate.openingSetupStateForTranscript();
        const card = objectOrNull(state?.route.next_operation);
        const prefilled = objectOrNull(card?.prefilled_arguments);
        const retainedDecisionId = (
          state?.phase === "handoff_decision"
          && card?.operation === "setup.complete"
          && typeof prefilled?.decision_id === "string"
          && prefilled.decision_id
        ) ? prefilled.decision_id : null;
        projected.properties.decision_id = {
          ...decisionSchema,
          pattern: NO_SELECTOR_SETUP_COMPLETE_DECISION_ID_PATTERN,
          ...(retainedDecisionId === null ? {} : {
            const: retainedDecisionId,
          }),
        };
      }
      parameters = projected;
    } else if (
      launcherRole !== null
      && typed.operation === "setup.complete"
    ) {
      // Web/setup sessions: once the chargen receipt has armed the handoff
      // card, surface its machine-issued decision_id as a const on the
      // presented schema and stop requiring the model to author one. The
      // retained-binding prepare path fills it when omitted, so the model
      // never has to invent identity (Model-Facing Identifier Law) while
      // the unready state keeps the strict schema that rejects premature
      // completion attempts.
      const projected = structuredClone(parameters);
      projected.required = (projected.required ?? []).filter(
        (key) => !["decision_id", "root", "campaign"].includes(key),
      );
      if (projected.properties === undefined || typeof projected.properties !== "object") {
        projected.properties = {};
      }
      delete projected.properties.root;
      delete projected.properties.campaign;
      const state = openingContinuationGate.openingSetupStateForTranscript();
      const card = objectOrNull(state?.route.next_operation);
      const prefilled = objectOrNull(card?.prefilled_arguments);
      const readyDecisionId = (
        state?.characterSetupComplete === true
        && state.phase === "handoff_decision"
        && card?.operation === "setup.complete"
        && typeof prefilled?.decision_id === "string"
        && prefilled.decision_id
      ) ? prefilled.decision_id : null;
      const baseSchema = objectOrNull(projected.properties.decision_id) ?? {};
      projected.properties.decision_id = readyDecisionId === null
        ? {
          ...baseSchema,
          description: (
            "Machine-issued handoff decision id. Omit this field unless "
            + "the table-opening card supplied an exact value to echo."
          ),
        }
        : {
          ...baseSchema,
          const: readyDecisionId,
          description: "Omit this field; the host attaches the exact value.",
        };
      parameters = projected;
    } else if (
      typed.operation === "session.resume"
      && startupResumeGate?.phase === "pending"
    ) {
      parameters = structuredClone(emptySchema);
    }
    pi.registerTool({
      name: typed.name,
      label: typed.label,
      description: typed.description,
      parameters,
      executionMode: executionClassForPolicy(
        OPERATION_POLICY[typed.operation],
      ) === "parallel_read" ? "parallel" : "sequential",
      ...(typed.operation === "setup.complete" && launcherRole !== null ? {
        prepareArguments: (args: unknown) => (
          openingContinuationGate.prepareSetupCompleteArguments(args)
        ),
      } : {}),
      execute: gateway(typed.name),
      ...compactToolRenderers(typed.name),
    });
  };
  refreshTypedToolDefinition = (operation: string): void => {
    const typed = typedToolByOperation.get(operation);
    if (typed !== undefined) {
      registerTypedDefinition(typed);
      try {
        pi.appendEntry("coc-typed-tool-binding", {
          schema_version: 1,
          status: "schema_refreshed",
          operation,
          binding_armed: retainedTypedBindings.has(operation),
        });
      } catch { /* binding audit is best effort */ }
    }
  };
  for (const typed of typedToolDefinitions) {
    registerTypedDefinition(typed);
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
      const submitted = await supplyCoordinator.submitManual(params.task, signal);
      // Identifier Law: model content is projected; exact result in details.
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(projectHostToolModelContent(submitted)),
        }],
        details: submitted,
      };
    },
  });
  pi.registerTool({
    name: "coc_map_supply", label: "COC map supply",
    description: "Validate explicit structured image-page candidates, validate externally rendered map assets, or privately inject one map image for the Keeper.", parameters: mapSupplySchema,
    ...compactToolRenderers("coc_map_supply"),
    async execute(_id: string, params: JsonObject, _signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) {
      const operation = String(params.operation ?? "");
      const needsOcr = Array.isArray(params.needs_ocr)
        ? params.needs_ocr.filter((value): value is number => Number.isInteger(value) && value >= 0)
        : [];
      const candidatePdfIndices = Array.isArray(params.candidate_pdf_indices)
        ? params.candidate_pdf_indices.filter((value): value is number => Number.isInteger(value) && value >= 0)
        : [];
      if (operation === "detect") {
        if (typeof params.pages_dir !== "string" || !params.pages_dir.trim()) throw new Error("detect requires pages_dir");
        const exact = await detectMapSupplyPageDirectory(params.pages_dir, candidatePdfIndices, needsOcr);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(projectHostToolModelContent(exact)),
          }],
          details: exact,
        };
      }
      if (operation === "render") {
        if (
          typeof params.pages_dir !== "string" || !params.pages_dir.trim()
          || typeof params.asset_root_id !== "string" || !params.asset_root_id.trim()
          || typeof params.source_pdf_path !== "string" || !params.source_pdf_path.trim()
        ) throw new Error("render requires pages_dir, asset_root_id, and source_pdf_path");
        const selection = await detectMapSupplyPageDirectory(params.pages_dir, candidatePdfIndices, needsOcr);
        if (!selection.needs_image.length) {
          const exact = { ...selection, assets: [], status: "nothing_to_render" } as JsonObject;
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(projectHostToolModelContent(exact)),
            }],
            details: exact,
          };
        }
        const exact = await renderMapSupplyPages({
          workspace_root: ctx.cwd,
          asset_root_id: params.asset_root_id,
          source_pdf_path: params.source_pdf_path,
          pdf_indices: selection.needs_image,
        });
        const envelopeExact = {
          ...selection,
          status: "rendered",
          ...exact,
        } as JsonObject;
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(projectHostToolModelContent(envelopeExact)),
          }],
          details: envelopeExact,
        };
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
    name: SOURCE_ASSET_TOOL_NAME,
    label: "COC source assets",
    description:
      "Catalog already-extracted source-bundle assets, record semantic associations, "
      + "query them for the current scene, and plan delivery through state.deliver_handout "
      + "or coc_map_supply.present. Asset IDs are code-derived; do not invent hashes or ids.",
    parameters: SOURCE_ASSET_TOOL_SCHEMA,
    ...compactToolRenderers(SOURCE_ASSET_TOOL_NAME),
    async execute(_id: string, params: JsonObject, _signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) {
      const startupResumeError = startupResumeToolError(SOURCE_ASSET_TOOL_NAME, params);
      if (startupResumeError !== null) throw new Error(startupResumeError);
      const exact = await executeSourceAssetTool({
        cwd: ctx.cwd,
        // The launcher-selected campaign is the source of truth for a fresh
        // PDF binding. After fresh setup clears its resume gate, retain the
        // same selector from the wrapper environment.
        campaign_id: startupResumeGate?.campaignId
          ?? explicitPiStartupCampaignId()
          ?? undefined,
        params,
      });
      // Identifier Law: internal srcasset ids/hashes/paths are host-only;
      // the model sees semantic kind/page/visibility/association rows.
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(projectHostToolModelContent(exact, {
            dropAssetIdFields: true,
          })),
        }],
        details: exact,
      };
    },
  });
  // `coc_chargen_delegate` is gone with the setup role it belonged to. The
  // canonical `setup.chargen_run` is what builds an investigator now, and
  // onboarding calls it directly.
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
  // Epoch context fold. Closed-turn tool results are 85-91% of the model-visible
  // context and are dead weight once `turn.finalize` closed their turn; the next
  // turn's authority comes from state/scene reads, not from old transcript JSON.
  // Registered before telemetry so the probe measures what is actually sent.
  const contextFold = createContextFold(readFoldSettings());
  const startupRecoveryThinking = createStartupRecoveryThinkingProjection();
  pi.on("context", (event) => {
    const folded = contextFold.apply(event.messages).messages;
    return {
      messages: startupRecoveryThinking.apply(
        folded,
        startupResumeGate !== null,
      ) as typeof event.messages,
    };
  });
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
    turnTelemetry = registerTurnTelemetry(pi, {
      agentDir: telemetryAgentDir,
      foldStats: () => contextFold.stats(),
    });
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
  registerCocSystemInstructionCommand(pi, {
    hostControl: async (command, context) => {
      const campaignId = explicitPiStartupCampaignId()
        ?? canonicalProgressCampaignId;
      if (!campaignId) {
        throw new Error("/system debug requires one active campaign");
      }
      const model = context.model;
      if (!model) {
        throw new Error("/system debug requires one configured model");
      }
      const agentHome = process.env.PI_CODING_AGENT_DIR;
      if (!agentHome) {
        throw new Error("/system debug requires the repo-local Pi agent home");
      }
      const commandContext = context as ExtensionContext & {
        isIdle?: () => boolean;
      };
      const debugContext: DebugExperimentHostContext = {
        workspaceRoot: resolve(context.cwd),
        campaignId,
        role: effectiveTypedRole,
        hostIsIdle: commandContext.isIdle?.() !== false,
        provider: String(model.provider || ""),
        model: String(model.id || ""),
        thinking: pi.getThinkingLevel(),
        agentHome: resolve(agentHome),
      };
      return overrides.dispatchDebugExperiment?.(command, debugContext)
        ?? debugExperimentHost.dispatch(command, debugContext);
    },
    beforeDispatch: (_instruction, context) => {
      operatorSystemInstructionScope = {
        sourceType: "operator_command",
        playerTurnEpoch: canonicalProgress.playerTurnEpoch,
      };
      const branch = typeof context.sessionManager?.getBranch === "function"
        ? context.sessionManager.getBranch()
        : null;
      const playerText = latestExternalUserText(branch);
      if (playerText !== null) {
        openingContinuationGate.currentExternalPlayerText = playerText;
        const campaignId = explicitPiStartupCampaignId()
          ?? canonicalProgressCampaignId;
        if (campaignId) armJournalBinding(campaignId);
      }
      applyKpActiveTools();
    },
    onDispatchError: () => {
      operatorSystemInstructionScope = null;
      applyKpActiveTools();
    },
  });
  const armAndDeliverEmptyTerminalFault = (code: string, message: string) => {
    const armed = openingContinuationGate.armTurnProcessingFault({
      schema_version: 1,
      contract_id: "coc.pi-turn-processing-fault.v1",
      kind: "turn_processing_fault",
      status: "terminal",
      stage: "player_output_delivery",
      code,
      message,
      retryable: false,
      will_retry: false,
      recovery_attempted: 1,
      failure_class: code,
    });
    if (armed.first) {
      try {
        pi.appendEntry(TURN_PROCESSING_FAULT_CUSTOM_TYPE, armed.fault);
      } catch { /* fault audit is best effort */ }
      const deliverable = (
        openingContinuationGate.takeTurnProcessingFaultForDelivery()
      );
      if (deliverable !== null) deliverTurnProcessingFault(deliverable);
    }
  };
  const deliverStartupResumeInstruction = (gate: StartupResumeGate): boolean => {
    if (
      gate.phase !== "pending"
      || gate.hiddenRepromptDelivery !== "pending"
    ) return false;
    gate.hiddenRepromptDelivery = "sending";
    try {
      sendCocSystemInstruction(pi, {
        sourceType: STARTUP_RESUME_CUSTOM_TYPE,
        customType: STARTUP_RESUME_CUSTOM_TYPE,
        instruction: startupResumeInstruction(
          gate.campaignId,
          gate.workspaceRoot,
        ),
        context: {
          campaign_id: gate.campaignId,
          first_campaign_operation: "session.resume",
        },
      }, { triggerTurn: true, deliverAs: "followUp" });
      gate.hiddenRepromptDelivery = "delivered";
      return true;
    } catch {
      // Leave delivery unclaimed so one later transcript/empty boundary can
      // retry; the campaign gate remains armed throughout.
      gate.hiddenRepromptDelivery = "pending";
      return false;
    }
  };
  const recoverEmptyAssistantOutput = () => {
    // Startup resume owns its own bounded reprompt lifecycle. Thinking-only
    // terminals do not reach the visible-final callback, so deliver that same
    // host instruction here exactly once instead of falling through to the
    // ordinary player-input recovery path.
    if (startupResumeGate !== null) {
      const gate = startupResumeGate;
      if (gate.phase === "terminal_failure") {
        publishStartupResumeBlocker(
          gate,
          gate.failureClass ?? "startup_resume_failed",
        );
      } else {
        deliverStartupResumeInstruction(gate);
      }
      return;
    }
    if (startupSilentResumeQuarantine !== null) {
      return;
    }
    const recovery = openingContinuationGate.takeEmptyTerminalRecovery();
    if (recovery !== null) {
      const scheduled = deliverEmptyTerminalRecovery(
        pi,
        recovery,
        buildEmptyTerminalRecoveryInstruction(
          turnFinalizationRequiredForPhase(kpPlayPhase),
        ),
      );
      if (scheduled) return;
      armAndDeliverEmptyTerminalFault(
        "empty_terminal_recovery_delivery_failed",
        "回合处理失败：空终态恢复指令投递失败，本回合外部玩家输入仍未回答。"
          + "不要重发玩家输入，也不要重放或重跑本回合已执行的规则与状态操作；"
          + "本回合可能已有 canonical 写入。保留现有证据与收据，经 "
          + "session.resume 核对既有收据后，仅补齐缺失的 finalization 与"
          + "玩家输出。",
      );
      return;
    }
    if (!openingContinuationGate.hasAnswerPendingExternalPlayerInput()) return;
    armAndDeliverEmptyTerminalFault(
      "empty_terminal_no_player_output",
      "回合处理失败：本回合外部玩家输入已受理，但助手终态仍未产生任何"
        + "玩家可见输出。不要重发玩家输入，也不要重放或重跑本回合已执行的"
        + "规则与状态操作；本回合可能已有 canonical 写入。保留现有证据与"
        + "收据，经 session.resume 核对既有收据后，仅补齐缺失的 "
        + "finalization 与玩家输出。",
    );
  };
  registerPlayerTranscriptGate(
    pi,
    (visibleText) => {
      if (operatorSystemInstructionScope !== null) {
        try {
          pi.appendEntry("coc-system-instruction-result", {
            schema_version: 1,
            contract_id: "coc.pi-system-instruction-result.v1",
            status: visibleText.trim() ? "completed" : "completed_empty",
            audience: "keeper_only",
            player_input: false,
            journal_policy: "never",
            text: visibleText,
          });
        } catch { /* hidden operator result audit is best effort */ }
        return false;
      }
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
          deliverStartupResumeInstruction(gate);
        }
        return false;
      }
      if (startupSilentResumeQuarantine !== null) {
        // Quarantined auto-open remainder: hide before the continuation
        // gate sees the final, so no settled/mechanical gate, follow-up,
        // fault delivery, or prose/history replay can arm from the silent
        // settled resume output.
        return false;
      }
      if (deliveryReplayQuarantine !== null) {
        // Exact-delivery replay owns this input's visible output: hide any
        // model-authored prose so the player receives only the exact host
        // replay stream, and no settled/mechanical gate arms alongside it.
        return false;
      }
      const decision = openingContinuationGate.acceptVisibleAssistantFinal(
        visibleText,
        turnFinalizationRequiredForPhase(kpPlayPhase),
      );
      if (
        decision === true
        || (
          decision
          && typeof decision === "object"
          && typeof decision.replacementText === "string"
        )
      ) {
        // Any player-visible delivery answers the epoch's external input;
        // later same-epoch empty terminals are background wakes, not
        // swallowed player turns, and must not arm recovery or a fault.
        openingContinuationGate.markEpochPlayerOutputDelivered();
        if (canonicalProgress.stage === "finalized") {
          advanceCanonicalProgress(canonicalProgressCampaignId, {
            stage: "delivered",
          });
        }
      }
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
        const fault = openingContinuationGate.takeTurnProcessingFaultForDelivery();
        if (fault !== null) deliverTurnProcessingFault(fault);
        else {
          const pendingGate = openingContinuationGate.takeMechanicalOutputGateEnvelope();
          if (pendingGate?.kind !== "settled_output_gate") {
            deliverMechanicalOutputGateInstruction(pi, pendingGate);
          } else {
            const recovery = openingContinuationGate.claimSettledOutputRecovery(
              canonicalProgress,
              "missing_finalization_receipt",
            );
            try {
              pi.appendEntry("coc-settled-output-recovery", {
                schema_version: 1,
                status: recovery.status,
                player_turn_epoch: canonicalProgress.playerTurnEpoch,
                canonical_progress_revision:
                  canonicalProgress.canonicalProgressRevision,
                stage: canonicalProgress.stage,
              });
            } catch { /* recovery audit is best effort */ }
            if (recovery.status === "claimed") {
              deliverMechanicalOutputGateInstruction(pi, recovery.envelope);
            } else {
              terminalizeTurnProcessingFault(recovery.fault);
            }
          }
        }
      }
      if (shouldTriggerOpeningSetupContinuation(decision)) {
        const route = (
          openingContinuationGate.requiredOpeningSetupContinuation()
        );
        if (route !== null) {
          try {
            sendCocSystemInstruction(pi, {
              sourceType: "coc-opening-setup-route",
              customType: "coc-opening-setup-route",
              instruction: (
                "Continue only the exact opening setup route in this host "
                + "context; it is not a player action."
              ),
              context: route,
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
    (message) => {
      const externalPlayerText = userMessageText(message);
      const externalUser = externalPlayerText !== null;
      if (externalUser) operatorSystemInstructionScope = null;
      if (
        externalUser
        && startupResumeGate !== null
        && startupResumeGate.phase === "pending"
      ) {
        // The startup branch snapshot is read before this process can receive
        // a new live player message. Preserve that newer structured fact so an
        // accepted awaiting_player resume does not quarantine the very turn
        // that requested it.
        startupBranchTrailingPlayerUser = true;
      }
      openingContinuationGate.observeMessageStart(message);
      if (externalUser) {
        stateClaimCompiler.beginExternalTurn();
        clearTurnTypedBindings();
        faultRecoveryOperation = null;
        const campaignId = explicitPiStartupCampaignId()
          ?? canonicalProgressCampaignId;
        advanceCanonicalProgress(campaignId, {}, {
          newPlayerEpoch: openingContinuationGate.playerTurnEpoch,
          reprojectTools: false,
        });
        rearmCurrentCombatBinding(campaignId);
        livePlayerMessageForOpenTurn = (
          campaignId && externalPlayerText !== null && externalPlayerText !== ""
        ) ? {
          campaignId,
          text: externalPlayerText,
          playerTurnEpoch: canonicalProgress.playerTurnEpoch,
        } : null;
        if (
          startupResumeGate === null
          && kpPlayPhase === "live_turn"
          && campaignId
          && currentWorkspaceRoot
          && currentHostSessionId
          && externalPlayerText !== null
        ) {
          const retained = currentOpenTurnAnchor?.campaignId === campaignId
            ? recordOpenTurnPlayerInput({
                root: currentWorkspaceRoot,
                campaignId,
                sessionId: currentHostSessionId,
                playerTurnEpoch: canonicalProgress.playerTurnEpoch,
                text: externalPlayerText,
                anchor: currentOpenTurnAnchor.anchor,
              })
            : "ignored" as const;
          if (
            retained === "recorded"
            || retained === "replaced_stale"
            || retained === "idempotent"
            // A missing trustworthy recovery anchor disables only durable
            // restart caching. The exact in-memory player message still owns
            // this live session's ordinary journal binding.
            || retained === "ignored"
          ) {
            armJournalBinding(campaignId);
          } else {
            openingContinuationGate.currentExternalPlayerText = null;
            clearTypedBinding("state.journal");
          }
          try {
            pi.appendEntry("coc-open-turn-player-input-cache", {
              schema_version: 1,
              status: retained,
              campaign_id: campaignId,
              player_turn_epoch: canonicalProgress.playerTurnEpoch,
            });
          } catch { /* operational cache audit is best effort */ }
        }
      }
      if (externalUser && startupResumeGate === null) {
        const preflightDelivery = deliverPendingPreInferenceFinalizationSteer(
          pi,
          openingContinuationGate,
          turnFinalizationRequiredForPhase(kpPlayPhase),
        );
        if (preflightDelivery === "failed") {
          try {
            pi.appendEntry("coc-settled-output-preflight-delivery-failed", {
              schema_version: 1,
              kind: "settled_output_preflight_delivery",
              status: "failed",
              failure_class: "steer_send_failed",
            });
          } catch { /* delivery failure is still surfaced below */ }
          throw new Error(
            "failed to deliver the settled-output preflight steer",
          );
        }
      }
      applyKpActiveTools();
    },
    () => openingContinuationGate.hasPendingFinalizedOutput()
      || deliveryReplayQuarantine !== null
      || operatorSystemInstructionScope !== null,
    recoverEmptyAssistantOutput,
    (details, ctx) => {
      try {
        pi.appendEntry("coc-leading-whitespace-stream-abort", {
          schema_version: 1,
          status: "aborted",
          failure_class: "leading_whitespace_stream_limit",
          player_turn_epoch: canonicalProgress.playerTurnEpoch,
          whitespace_delta_count: details.deltaCount,
          whitespace_char_count: details.charCount,
        });
      } catch { /* watchdog audit is best effort */ }
      ctx.abort();
      recoverEmptyAssistantOutput();
    },
    (details) => {
      try {
        pi.appendEntry("coc-leading-whitespace-observed", {
          schema_version: 1,
          player_turn_epoch: canonicalProgress.playerTurnEpoch,
          whitespace_delta_count: details.deltaCount,
          whitespace_char_count: details.charCount,
        });
      } catch { /* watchdog evidence is best effort */ }
    },
  );
  // Forced raw-PDF bind injection: the KP must not need to read coc-module-init
  // to know the first call after a player PDF path is scenario.bind_pdf.
  registerPlayerPdfBindInstruction(pi, {
    workspaceRoot: (ctx) => ctx.cwd,
    isCurrent,
    epoch: () => sessionEpoch,
  });
  pi.on("message_start", (event) => {
    if (userMessageText(event.message) === null) return;
    if (
      debugLaneEnabled()
      && !debugLaneSawPlayerInput
      && !(userMessageText(event.message) ?? "").trimStart()
        .startsWith(DEBUG_LANE_HOST_PROMPT_MARKER)
    ) {
      // The player's turn has arrived; the lane gets its normal surface back.
      debugLaneSawPlayerInput = true;
      applyKpActiveTools();
    }
    const context = openingContinuationGate.openingTableDecisionContext();
    if (context === null) return;
    sendCocSystemInstruction(pi, {
      sourceType: "coc-opening-table-player-decision",
      customType: "coc-opening-table-player-decision",
      instruction: (
        "Use this host-bound table-decision context while adjudicating the "
        + "current real player input; the context itself is not player input."
      ),
      context,
    }, { deliverAs: "steer" });
  });
  pi.on("agent_start", () => {
    openingContinuationGate.markAgentStart();
  });
  // Mid-turn coordinator dispatches defer on turn_pending_finalization by
  // design, and nothing re-armed between player turns, so pending host work
  // (deepen_handout cards and their images among it) never fulfilled in live
  // play. agent_end is the true idle boundary — the player turn is settled,
  // no finalization is pending, and the durable open requests are claimable.
  // One bounded background takeover here completes before the next player
  // turn needs the material; every guard fails closed to "no dispatch".
  const IDLE_TAKEOVER_MAX_ATTEMPTS_PER_PACKET = 3;
  const armIdleSourceTakeover = () => {
    if (idleTakeoverBusy) return;
    const campaignId = overrides.startupCampaignId === undefined
      ? explicitPiStartupCampaignId()
      : overrides.startupCampaignId();
    if (
      campaignId === null
      || idleTakeoverContext === null
      || startupResumeGate !== null
      || startupSilentResumeQuarantine !== null
      || openingContinuationGate.hasActiveOpeningSetup()
      || kpPlayPhase !== "live_turn"
    ) return;
    const epoch = sessionEpoch;
    idleTakeoverBusy = true;
    void (async () => {
      try {
        const response = await client(idleTakeoverContext).callTool(
          "coc_invoke",
          {
            operation: "progressive.status",
            campaign: campaignId,
            arguments: {},
          },
        );
        if (sessionEpoch !== epoch) return;
        const envelope = objectOrNull(response);
        if (envelope?.ok !== true) return;
        const task = findAutoDispatchTask(envelope);
        const packet = objectOrNull(task?.packet);
        const dispatchKey = typeof packet?.packet_id === "string"
          ? packet.packet_id.trim()
          : "";
        if (task === null || !dispatchKey) return;
        const attempts = idleTakeoverAttempts.get(dispatchKey) ?? 0;
        if (attempts >= IDLE_TAKEOVER_MAX_ATTEMPTS_PER_PACKET) return;
        if (supplyCoordinator.activeManager()?.state(dispatchKey)) return;
        idleTakeoverAttempts.set(dispatchKey, attempts + 1);
        try {
          pi.appendEntry("coc-idle-source-takeover", {
            status: "submitted",
            dispatch_key: dispatchKey,
            campaign_id: campaignId,
            attempt: attempts + 1,
          });
        } catch { /* takeover audit is best effort */ }
        await supplyCoordinator.autoDispatch("coc_invoke", envelope, {
          exactTask: task,
          priority: "background",
        });
      } catch {
        // Best effort only: the next idle boundary re-arms with a fresh
        // status probe; live play is never blocked by this takeover.
      } finally {
        idleTakeoverBusy = false;
      }
    })();
  };
  pi.on("agent_end", () => {
    if (operatorSystemInstructionScope !== null) {
      try {
        pi.appendEntry("coc-system-instruction-tool-scope", {
          schema_version: 1,
          contract_id: "coc.pi-system-instruction-tool-scope.v1",
          status: "closed",
          source_type: operatorSystemInstructionScope.sourceType,
          role: effectiveTypedRole,
          player_turn_epoch: operatorSystemInstructionScope.playerTurnEpoch,
        });
      } catch { /* control-plane scope audit is best effort */ }
      operatorSystemInstructionScope = null;
      applyKpActiveTools();
    }
    if (startupSilentResumeQuarantine !== null) {
      // The quarantined auto-open agent turn has ended; the next turn (a
      // real player message or table opening) gets the normal tool surface.
      startupSilentResumeQuarantine = null;
      applyKpActiveTools();
    }
    // The replay quarantine lives exactly one agent turn: that player input's
    // delivery was owned by the host replay stream; the next input gets the
    // normal tool/output surface again.
    deliveryReplayQuarantine = null;
    openingContinuationGate.markAgentEnd();
    // Terminal-delivery retries are bookkeeping recovery, not part of the
    // player turn's settlement boundary. Run them after this lifecycle hook
    // returns so a stalled retry cannot keep RPC/UI input locked forever.
    queueMicrotask(() => {
      const fault = openingContinuationGate.takeTurnProcessingFaultForDelivery();
      if (fault !== null) deliverTurnProcessingFault(fault);
      armIdleSourceTakeover();
      void (async () => {
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
      })().catch(() => {
        // Retry publication is already durable and will be reconsidered by the
        // next natural lifecycle boundary. It must never break live play.
      });
    });
  });
  // Canonical skill-doc read. Pi's native skill progressive disclosure tells
  // the model to "use the read tool" to load SKILL.md bodies and routed
  // references, but canonical pi-coc launches with --no-builtin-tools, so
  // that instruction would name a missing tool. Registered on session_start
  // BEFORE initializeSession applies the KP active set: the guard must see
  // the session's own initial tools, so a generic Pi session whose built-in
  // read is still active keeps it (no override), while a --no-builtin-tools
  // session gains only this path-restricted canonical-doc read. Activation
  // then flows through the manifest-driven applyKpActiveTools.
  pi.on("session_start", async () => {
    registerSkillDocRead(pi);
  });
  pi.on("session_start", async (event, ctx) => {
    toolWorkingSetAtExecutionStart.clear();
    sceneSupplyDispatches.clear();
    idleTakeoverContext = ctx;
    const startupCampaignId = initializeSession(ctx);
    if (startupCampaignId !== null) {
      await refreshKeeperBriefing(ctx, startupCampaignId, "session_start");
    }
    await startCocWelcome(event, ctx, startupCampaignId);
  });
  pi.on("session_shutdown", async () => {
    sessionClosing = true;
    sessionEpoch += 1;
    semanticRegistry.clearAll();
    startupResumeGate = null;
    startupSilentResumeQuarantine = null;
    effectiveTypedRole = launcherRole ?? "setup";
    openingContinuationGate.setEffectiveTypedRole(effectiveTypedRole);
    startupBranchTrailingPlayerUser = false;
    loadedNamespaces = [];
    loadedOperations = [];
    lastWorkingSet = null;
    toolWorkingSetAtExecutionStart.clear();
    faultRecoveryOperation = null;
    retainedOutputContextFacts = null;
    semanticRegistry.clearAll();
    clearTurnEntityFacts();
    draftShapeRecoveryCards.clear();
    currentSceneBindingFacts = null;
    currentHostSessionId = "";
    currentOpenTurnAnchor = null;
    journaledOpenTurnAnchor = null;
    openTurnRecoveryAuthorization = null;
    lastHealingCardProjection = null;
    currentCombatBindingFacts = null;
    currentChaseBindingFacts = null;
    retainedTypedBindings.clear();
    currentTypedBindingFactories.clear();
    sceneSupplyDispatches.clear();
    openingContinuationGate.reset();
    stateClaimCompiler.clear();
    await supplyCoordinator.shutdown();
    await memoryExtractionDispatcher.shutdown();
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
      ...memoryExtractionRuns,
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
  autoDispatchPiMemoryExtraction,
  runPiSourceScopeProducer,
  validatePiSourceScopeLocatorTask,
  MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN,
  projectHostToolModelContent,
};

// The public gate remains the stable facade.  Machine implementations are
// installed only after every injected dependency has initialized, avoiding a
// runtime cycle from the owned modules back into this integration root.
const openingTerminalMachineEnvironment: Record<string, any> = {
  EXISTING_CAMPAIGN_SETUP_KINDS,
  MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN,
  OPENING_SETUP_CHARACTER_KINDS,
  OPENING_START_LOCATION_ID,
  OWNED_OPENING_ROUTE_OPERATIONS,
  REVIEW_RECOVERY_FAILURE_CLASSES,
  ZH_HANS_PLAYER_TERMS,
  applyRetainedAdoptSourceFacts,
  buildSettledOutputGateEnvelope,
  buildSettledOutputPreflightEnvelope,
  canonicalJsonValueSha256,
  detectMechanicalMarkers,
  exactKeysMatch,
  failedBlockingOpeningEnvelope,
  findAutoDispatchTask,
  frozenReviewIdentitiesMatch,
  frozenReviewIdentityFromFault,
  handoffFromEnvelope,
  hasRequiredKeys,
  isAbsolute,
  isCanonicalCampaignId,
  isCanonicalInvokeSurface,
  join,
  mechanicalMarkerClassesUncovered,
  normalizePiCocInvokeArguments,
  objectOrNull,
  openingHandoffOperationForSessionRole,
  projectPiGuidedCharacterContract,
  resolve,
  result,
  sessionRoleFromEnv,
  startupResumeIdentityArgumentsMatch,
  typedToolNameForOperation,
  validOpeningTransportFacts,
  zhHansChargenRoleplaySummary,
  zhHansChargenSkillLabel,
};
Object.assign(
  OpeningTerminalContinuationGate.prototype,
  createOpeningSetupMachineMethods(openingTerminalMachineEnvironment),
  createCurrentDependencyMachineMethods(openingTerminalMachineEnvironment),
  createTurnOutputGateMethods(openingTerminalMachineEnvironment),
);
installOpeningSetupMachineState(OpeningTerminalContinuationGate.prototype);
installCurrentDependencyMachineState(OpeningTerminalContinuationGate.prototype);
installTurnOutputGateState(OpeningTerminalContinuationGate.prototype);
