/**
 * Pi-only projection between canonical operation contracts and model tools.
 *
 * The canonical archive remains authoritative. This module only removes
 * arguments that an exact, retained host binding card owns, restores those
 * arguments before the existing gateway wrapper, and adds model-facing
 * recovery metadata to an existing canonical failure envelope.
 */
import type { JsonSchema } from "./operation-contracts.ts";
import type { SemanticProjectionView } from "./semantic-identity-registry.ts";

export type StateJournalBindingCard = {
  schema_version: 1;
  operation: "state.journal";
  binding_revision: string;
  root: string;
  campaign: string;
  player_text: string;
  decision_id: string;
  run_id?: string;
};

export type NarrationReviewBindingCard = {
  schema_version: 1;
  operation: "narration.review";
  binding_revision: string;
  root: string;
  campaign: string;
  decision_id: string;
  turn_id: string;
  source_digest: string;
  revision: number;
  state_claim_compilation: Record<string, unknown>;
};

export type TurnFinalizeBindingCard = {
  schema_version: 1;
  operation: "turn.finalize";
  binding_revision: string;
  root: string;
  campaign: string;
  decision_id: string;
  revision: number;
  turn_id: string;
  source_digest: string;
  narration_review_id: string;
  repair_finalization_id?: string;
};

export type SceneRouteCandidate = {
  candidate_id: string;
  scene_id: string;
  travel_minutes?: number;
};

export type SceneMoveBindingCard = {
  schema_version: 1;
  operation: "state.move_scene";
  binding_revision: string;
  root: string;
  campaign: string;
  decision_id: string;
  source_revision: string;
  source_digest: string;
  selection_mode: "current_candidates" | "manual_scene";
  candidates: readonly SceneRouteCandidate[];
};

export type AdvanceTimeBindingCard = {
  schema_version: 1;
  operation: "state.advance_time";
  binding_revision: string;
  root: string;
  campaign: string;
  decision_id: string;
  clock_revision: string;
  clock_digest: string;
  clock_precision: "precise" | "imprecise";
};

export type CombatTargetCandidate =
  | {
    candidate_id: string;
    invocation_mode: "target_npc_id";
    target_npc_id: string;
    affordance_id?: never;
  }
  | {
    candidate_id: string;
    invocation_mode: "affordance_id";
    affordance_id: string;
    target_npc_id?: never;
  }
  | {
    candidate_id: string;
    invocation_mode: "pending_defense";
    target_npc_id?: never;
    affordance_id?: never;
  };

export type CombatResolveBindingCard = {
  schema_version: 1;
  operation: "combat.resolve";
  binding_revision: string;
  root: string;
  campaign: string;
  decision_id: string;
  combat_revision: string;
  combat_digest: string;
  candidates: readonly CombatTargetCandidate[];
};

export type TableOpeningBindingCard = {
  schema_version: 1;
  operation: "evidence.table_opening";
  binding_revision: string;
  root: string;
  campaign: string;
  decision_id: string;
  run_id: string;
};

export type NpcEngagementBindingCard = {
  schema_version: 1;
  operation: "state.record_npc_engagement";
  binding_revision: string;
  root: string;
  campaign: string;
  decision_id: string;
  npc_id: string;
  investigator: string;
  first_impression_ref: string;
  run_id: string;
};

export type NpcReactionRunBindingCard = {
  schema_version: 1;
  operation: "npc.reaction";
  binding_revision: string;
  root: string;
  campaign: string;
  /** Binding-card identity only; the model still owns its per-NPC decision. */
  decision_id: string;
  investigator: string;
  run_id?: string;
};

export type TypedToolBindingCard =
  | StateJournalBindingCard
  | NarrationReviewBindingCard
  | TurnFinalizeBindingCard
  | SceneMoveBindingCard
  | AdvanceTimeBindingCard
  | CombatResolveBindingCard
  | TableOpeningBindingCard
  | NpcEngagementBindingCard
  | NpcReactionRunBindingCard;

/**
 * Same identity shape, but supplied independently from current canonical host
 * state rather than retained from the model presentation card.
 */
export type CurrentTypedToolHostContext = TypedToolBindingCard;

export type PiFailureClass =
  | "schema_validation"
  | "dynamic_candidate"
  | "business_precondition"
  | "idempotency_conflict"
  | "transient_transport"
  | "invariant_terminal";

export type PiFailureRecovery =
  | "model_next_action"
  | "host_binding_refresh"
  | "host_internal_retry"
  | "none";

export type PiAllowedNextAction = {
  operation: string;
  action: string;
  reason: string;
  host_bound: boolean;
};

export class ToolContractProjectionError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ToolContractProjectionError";
    this.code = code;
    this.details = details;
  }
}

export const HOST_OWNED_FIELDS: Record<TypedToolBindingCard["operation"], readonly string[]> = {
  "state.journal": [
    "root",
    "campaign",
    "player_text",
    "decision_id",
    "run_id",
  ],
  "narration.review": [
    "root",
    "campaign",
    "decision_id",
    "turn_id",
    "source_digest",
    "revision",
    "state_claim_compilation",
  ],
  "turn.finalize": [
    "root",
    "campaign",
    "decision_id",
    "revision",
    "narration_review_id",
    "repair_finalization_id",
  ],
  "state.move_scene": [
    "root",
    "campaign",
    "decision_id",
    "travel_minutes",
  ],
  "state.advance_time": [
    "root",
    "campaign",
    "decision_id",
  ],
  "combat.resolve": [
    "root",
    "campaign",
    "decision_id",
    "target_npc_id",
    "affordance_id",
  ],
  "evidence.table_opening": [
    "root",
    "campaign",
    "decision_id",
    "run_id",
  ],
  "state.record_npc_engagement": [
    "root",
    "campaign",
    "decision_id",
    "npc_id",
    "investigator",
    "first_impression_ref",
    "run_id",
  ],
  "npc.reaction": [
    "root",
    "campaign",
    "investigator",
    "run_id",
  ],
};

/**
 * Model-owned schema view: the presented typed schema minus the exact
 * host-owned field table the invoke-time binding enforces. Host-only fields
 * are excluded from this view — never exempted inside raw validation — and
 * the schema identity inventory derives from exactly this view, so every
 * remaining identity-bearing path must classify into a registry/grammar
 * domain or the inventory fails.
 */
/** Integrity/hash-named fields are machine identity: never model-owned. */
const INTEGRITY_FIELD_NAME = /(?:^|_)(?:sha256|sha1|digest|hash|integrity|seal|receipt)(?:_|$)/i;

/** Never-model-authored fields may not survive at ANY nesting depth. */
function stripNeverModelAuthoredFields(schema: JsonSchema): void {
  if (isPlainObject(schema.properties)) {
    for (const field of Object.keys(schema.properties)) {
      if (
        RAW_NEVER_MODEL_AUTHORED_FIELDS.has(field)
        || INTEGRITY_FIELD_NAME.test(field)
      ) {
        delete schema.properties[field];
      }
    }
    for (const sub of Object.values(schema.properties)) {
      if (isPlainObject(sub)) stripNeverModelAuthoredFields(sub as JsonSchema);
    }
  }
  // A `required` entry whose property was stripped must not survive either —
  // a required host-only field would be unfillable by the model. When the
  // schema declares no `properties` at all (open object), `required` stays.
  if (Array.isArray(schema.required) && isPlainObject(schema.properties)) {
    schema.required = schema.required.filter((field) =>
      typeof field === "string"
        && !RAW_NEVER_MODEL_AUTHORED_FIELDS.has(field)
        && !INTEGRITY_FIELD_NAME.test(field)
        && Object.hasOwn(schema.properties, field)
    );
  }
  for (const key of ["items", "additionalProperties"] as const) {
    if (isPlainObject(schema[key])) {
      stripNeverModelAuthoredFields(schema[key] as JsonSchema);
    }
  }
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    if (Array.isArray(schema[key])) {
      for (const branch of schema[key] as JsonSchema[]) {
        if (isPlainObject(branch)) stripNeverModelAuthoredFields(branch);
      }
    }
  }
}

export function projectModelOwnedSchema(
  operation: string,
  presentedSchema: JsonSchema,
): JsonSchema {
  const hostOwned = (
    HOST_OWNED_FIELDS as Record<string, readonly string[] | undefined>
  )[operation] ?? [];
  const hostOwnedSet = new Set([...hostOwned]);
  const cloned = structuredClone(presentedSchema);
  if (isPlainObject(cloned.properties)) {
    for (const field of Object.keys(cloned.properties)) {
      if (hostOwnedSet.has(field)) delete cloned.properties[field];
    }
  }
  if (Array.isArray(cloned.required)) {
    cloned.required = cloned.required.filter(
      (field) => typeof field === "string" && !hostOwnedSet.has(field),
    );
  }
  stripNeverModelAuthoredFields(cloned);
  return cloned;
}

const PI_SCHEMA_CODES = new Set<string>([
  "missing_param",
  "invalid_param",
  "missing_parameters",
  "invalid_arguments",
  "invalid_param_type",
]);

/** Single schema-code policy shared by classification and schema attachment. */
export function isPiSchemaFailure(operation: string, code: string): boolean {
  return PI_SCHEMA_CODES.has(code)
    || (operation === "state.advance_time" && code === "invalid_request");
}

const DYNAMIC_CANDIDATE_ACTIONS: Record<string, readonly PiAllowedNextAction[]> = {
  unknown_combat_target: [{
    operation: "combat.context",
    action: "refresh_semantic_candidates",
    reason: "refresh the current canonical combat targets before choosing again",
    host_bound: true,
  }],
  unknown_scene_route: [{
    operation: "scene.context",
    action: "refresh_semantic_candidates",
    reason: "refresh the current source-authored scene routes before choosing again",
    host_bound: true,
  }],
  scene_not_adjacent: [{
    operation: "scene.context",
    action: "refresh_semantic_candidates",
    reason: "refresh the current source-authored scene routes before choosing again",
    host_bound: true,
  }],
};

const BUSINESS_PRECONDITION_ACTIONS: Record<string, readonly PiAllowedNextAction[]> = {
  no_unfinalized_journal: [{
    operation: "state.journal",
    action: "journal_current_turn",
    reason: "journal the settled turn before requesting its output context",
    host_bound: true,
  }],
  turn_pending_finalization: [{
    operation: "turn.output_context",
    action: "resume_pending_settlement",
    reason: "continue the exact pending turn settlement before any new mutation",
    host_bound: true,
  }],
  turn_finalization_pending: [{
    operation: "turn.output_context",
    action: "resume_pending_settlement",
    reason: "continue the exact pending turn settlement before another journal",
    host_bound: true,
  }],
  narration_review_required: [{
    operation: "narration.review",
    action: "review_retained_draft",
    reason: "review the retained draft and frozen settlement before finalizing",
    host_bound: true,
  }],
  state_authority_review_blocked: [{
    operation: "narration.review",
    action: "revise_narration_only",
    reason: "revise narration only against the same frozen settlement",
    host_bound: true,
  }],
  agency_review_blocked: [{
    operation: "narration.review",
    action: "revise_narration_only",
    reason: "remove or properly bind unauthorized PC propositions against the same frozen settlement",
    host_bound: true,
  }],
  state_authority_source_unknown: [{
    operation: "narration.review",
    action: "correct_state_authority_review",
    reason: "bind claims only to the current frozen mechanics effects and review the same draft again",
    host_bound: true,
  }],
  state_authority_kind_mismatch: [{
    operation: "narration.review",
    action: "correct_state_authority_review",
    reason: "correct the claim kind against the current frozen mechanics effect",
    host_bound: true,
  }],
  state_authority_subject_mismatch: [{
    operation: "narration.review",
    action: "correct_state_authority_review",
    reason: "correct the claim subject against the current frozen mechanics effect",
    host_bound: true,
  }],
  state_authority_excerpt_mismatch: [{
    operation: "narration.review",
    action: "correct_state_authority_review",
    reason: "use an exact draft excerpt for the current frozen mechanics claim",
    host_bound: true,
  }],
  state_authority_disposition_mismatch: [{
    operation: "narration.review",
    action: "correct_state_authority_review",
    reason: "correct the review disposition to match the structured current claims",
    host_bound: true,
  }],
  state_authority_claim_duplicate: [{
    operation: "narration.review",
    action: "correct_state_authority_review",
    reason: "submit each current frozen mechanics claim once",
    host_bound: true,
  }],
  default_mechanics_placement_unavailable: [{
    operation: "turn.finalize",
    action: "split_action_and_consequence_paragraphs",
    reason: "supply a complete causal mechanics placement revision without rerunning state",
    host_bound: true,
  }],
  roll_after_consequence: [{
    operation: "turn.finalize",
    action: "move_roll_before_consequence",
    reason: "revise the draft/coverage placement so the public roll precedes its fictional result",
    host_bound: true,
  }],
  excerpt_mismatch: [{
    operation: "turn.finalize",
    action: "copy_verbatim_excerpt",
    reason: "replace the coverage excerpt with an exact substring of the retained draft",
    host_bound: true,
  }],
  mechanics_text_in_draft: [{
    operation: "turn.finalize",
    action: "remove_deterministic_mechanics_text",
    reason: "keep the draft fictional and let the finalizer insert authoritative mechanics",
    host_bound: true,
  }],
  invalid_mechanics_placement: [{
    operation: "turn.finalize",
    action: "omit_or_correct_mechanics_placements",
    reason: "use safe automatic placement or correct the complete structured placement list",
    host_bound: true,
  }],
  incomplete_mechanics_placement: [{
    operation: "turn.finalize",
    action: "place_each_mechanics_source_once",
    reason: "place every current mechanic source exactly once without rerunning settlement",
    host_bound: true,
  }],
  invalid_coverage: [{
    operation: "turn.finalize",
    action: "correct_causal_coverage",
    reason: "repair the structured coverage rows against the retained output context",
    host_bound: true,
  }],
  duplicate_obligation: [{
    operation: "turn.finalize",
    action: "deduplicate_causal_coverage",
    reason: "submit exactly one coverage row per retained obligation",
    host_bound: true,
  }],
  unknown_obligation: [{
    operation: "turn.output_context",
    action: "refresh_retained_obligations",
    reason: "refresh the exact current obligation ids before revising coverage",
    host_bound: true,
  }],
  missing_obligation: [{
    operation: "turn.finalize",
    action: "complete_causal_coverage",
    reason: "add one coverage row for every retained obligation",
    host_bound: true,
  }],
  exceptional_beat_required: [{
    operation: "turn.finalize",
    action: "add_source_bound_exceptional_beat",
    reason: "add the causal critical/fumble beat required by the retained obligation",
    host_bound: true,
  }],
  unknown_mechanics_source: [{
    operation: "turn.finalize",
    action: "correct_mechanics_source_selection",
    reason: "select only mechanics sources present in the retained output context",
    host_bound: true,
  }],
  duplicate_mechanics_source: [{
    operation: "turn.finalize",
    action: "correct_mechanics_source_selection",
    reason: "place every retained mechanics source exactly once",
    host_bound: true,
  }],
  agency_claim_invalid: [{
    operation: "turn.finalize",
    action: "correct_agency_claims",
    reason: "correct the structured claim identity, type, or exact draft excerpt",
    host_bound: true,
  }],
  agency_source_invalid: [{
    operation: "turn.finalize",
    action: "correct_agency_claims",
    reason: "bind the semantic claim to a source from the retained agency projection",
    host_bound: true,
  }],
  agency_override_invalid: [{
    operation: "turn.finalize",
    action: "correct_agency_claims",
    reason: "bind forced behavior only to a matching active retained override",
    host_bound: true,
  }],
  substantive_exceptional_effect_required: [{
    operation: "state.exceptional_effect",
    action: "apply_source_bound_exceptional_effect",
    reason: "apply the required source-bound exceptional effect before finalizing the frozen turn",
    host_bound: true,
  }],
};

const HOST_BINDING_REFRESH_CODES = new Set([
  "idempotency_conflict",
  "revision_conflict",
  "run_segment_conflict",
]);

const STALE_BINDING_CODES = new Set([
  "narration_review_mismatch",
  "source_digest_mismatch",
  "stale_revision",
  "stale_binding_context",
  "turn_source_changed",
  "delivery_conflict",
  "repair_conflict",
  "state_claim_compiler_stale",
]);

const TRANSIENT_CODES = new Set([
  "campaign_busy",
  "subsystem_transaction_failed",
  "development_settlement_failed",
  "transport_timeout",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const MODULE_CONTEXT_MACHINE_FIELDS = new Set([
  "wire",
  "grep_anchor",
  "grep_anchors",
  "current_generation",
  "module_graph_path",
  "shard_path",
  "evidence_path",
  "review_path",
  "bundle_path",
  "markdown_path",
]);

/**
 * Project the read-only ModuleGraph context without hiding its semantic ids.
 * Contract-declared machine fields stay in the gateway's canonical `details`;
 * authored graph properties are otherwise preserved verbatim.
 */
export function projectModuleContextResultForModel(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const project = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(project);
    if (!isPlainObject(input)) return input;
    const out: Record<string, unknown> = {};
    for (const [field, child] of Object.entries(input)) {
      if (
        MODULE_CONTEXT_MACHINE_FIELDS.has(field)
        || field.endsWith("_sha256")
      ) continue;
      out[field] = project(child);
    }
    return out;
  };
  return project(value) as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      `retained binding field ${field} must be a non-empty string`,
      { field },
    );
  }
  return value;
}

function requirePositiveRevision(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      `retained binding field ${field} must be a positive integer`,
      { field },
    );
  }
  return Number(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((row) => canonicalJson(row)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const fields = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function validateSceneCandidates(
  value: readonly SceneRouteCandidate[],
  allowEmpty = false,
): void {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      allowEmpty
        ? "retained scene candidates must be an array"
        : "retained scene candidates must be a non-empty array",
      { field: "candidates" },
    );
  }
  const seenCandidates = new Set<string>();
  for (const candidate of value) {
    if (!isPlainObject(candidate)) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "retained scene candidate must be an object",
        { field: "candidates" },
      );
    }
    const candidateId = nonEmptyString(
      candidate.candidate_id,
      "candidates.candidate_id",
    );
    if (seenCandidates.has(candidateId)) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "retained scene candidate ids must be unique",
        { field: "candidates.candidate_id" },
      );
    }
    seenCandidates.add(candidateId);
    nonEmptyString(candidate.scene_id, "candidates.scene_id");
    const travel = candidate.travel_minutes;
    if (
      Object.hasOwn(candidate, "travel_minutes")
      && (!Number.isInteger(travel) || Number(travel) < 0)
    ) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "retained travel_minutes must be absent or a non-negative integer",
        { field: "candidates.travel_minutes" },
      );
    }
  }
}

function validateCombatCandidates(value: readonly CombatTargetCandidate[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "retained combat candidates must be a non-empty array",
      { field: "candidates" },
    );
  }
  const seen = new Set<string>();
  let pendingDefenseCount = 0;
  for (const candidate of value) {
    if (!isPlainObject(candidate)) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "retained combat candidate must be an object",
        { field: "candidates" },
      );
    }
    const candidateId = nonEmptyString(candidate.candidate_id, "candidates.candidate_id");
    if (seen.has(candidateId)) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "retained combat candidate ids must be unique",
        { field: "candidates.candidate_id" },
      );
    }
    seen.add(candidateId);
    if (candidate.invocation_mode === "target_npc_id") {
      nonEmptyString(candidate.target_npc_id, "candidates.target_npc_id");
      if (candidate.affordance_id !== undefined) {
        throw new ToolContractProjectionError(
          "binding_context_invalid",
          "target-mode combat candidate cannot retain affordance_id",
          { field: "candidates.affordance_id" },
        );
      }
    } else if (candidate.invocation_mode === "affordance_id") {
      nonEmptyString(candidate.affordance_id, "candidates.affordance_id");
      if (candidate.target_npc_id !== undefined) {
        throw new ToolContractProjectionError(
          "binding_context_invalid",
          "affordance-mode combat candidate cannot retain target_npc_id",
          { field: "candidates.target_npc_id" },
        );
      }
    } else if (candidate.invocation_mode === "pending_defense") {
      pendingDefenseCount += 1;
      if (candidate.target_npc_id !== undefined || candidate.affordance_id !== undefined) {
        throw new ToolContractProjectionError(
          "binding_context_invalid",
          "pending-defense candidate cannot retain target or affordance identity",
          { field: "candidates" },
        );
      }
    } else {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "combat candidate has an unsupported canonical invocation mode",
        { field: "candidates.invocation_mode" },
      );
    }
  }
  if (pendingDefenseCount > 0 && (pendingDefenseCount !== 1 || value.length !== 1)) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "pending defense must be the sole retained combat candidate",
      { field: "candidates" },
    );
  }
}

function validateBindingShape(binding: TypedToolBindingCard): void {
  nonEmptyString(binding.binding_revision, "binding_revision");
  nonEmptyString(binding.root, "root");
  nonEmptyString(binding.campaign, "campaign");
  nonEmptyString(binding.decision_id, "decision_id");
  if (binding.operation === "state.journal") {
    nonEmptyString(binding.player_text, "player_text");
    if (binding.run_id !== undefined) nonEmptyString(binding.run_id, "run_id");
  } else if (binding.operation === "narration.review") {
    nonEmptyString(binding.turn_id, "turn_id");
    nonEmptyString(binding.source_digest, "source_digest");
    requirePositiveRevision(binding.revision, "revision");
    if (!isPlainObject(binding.state_claim_compilation)) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "retained binding field state_claim_compilation must be an object",
        { field: "state_claim_compilation" },
      );
    }
  } else if (binding.operation === "turn.finalize") {
    requirePositiveRevision(binding.revision, "revision");
    nonEmptyString(binding.turn_id, "turn_id");
    nonEmptyString(binding.source_digest, "source_digest");
    nonEmptyString(binding.narration_review_id, "narration_review_id");
    if (binding.repair_finalization_id !== undefined) {
      nonEmptyString(binding.repair_finalization_id, "repair_finalization_id");
    }
  } else if (binding.operation === "state.move_scene") {
    nonEmptyString(binding.source_revision, "source_revision");
    nonEmptyString(binding.source_digest, "source_digest");
    const selectionMode = binding.selection_mode;
    if (selectionMode !== "current_candidates" && selectionMode !== "manual_scene") {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "scene selection_mode must be current_candidates or manual_scene",
        { field: "selection_mode" },
      );
    }
    validateSceneCandidates(binding.candidates, selectionMode === "manual_scene");
  } else if (binding.operation === "state.advance_time") {
    nonEmptyString(binding.clock_revision, "clock_revision");
    nonEmptyString(binding.clock_digest, "clock_digest");
    if (binding.clock_precision !== "precise" && binding.clock_precision !== "imprecise") {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "clock_precision must be precise or imprecise",
        { field: "clock_precision" },
      );
    }
  } else if (binding.operation === "combat.resolve") {
    nonEmptyString(binding.combat_revision, "combat_revision");
    nonEmptyString(binding.combat_digest, "combat_digest");
    validateCombatCandidates(binding.candidates);
  } else if (
    binding.operation === "evidence.table_opening"
  ) {
    nonEmptyString(binding.run_id, "run_id");
  } else if (binding.operation === "npc.reaction") {
    nonEmptyString(binding.investigator, "investigator");
    if (binding.run_id !== undefined) nonEmptyString(binding.run_id, "run_id");
  } else {
    nonEmptyString(binding.npc_id, "npc_id");
    nonEmptyString(binding.investigator, "investigator");
    nonEmptyString(binding.first_impression_ref, "first_impression_ref");
    nonEmptyString(binding.run_id, "run_id");
  }
}

function validateBindingCard(
  operation: string,
  binding: TypedToolBindingCard | null | undefined,
  currentHostContext: CurrentTypedToolHostContext | null | undefined,
): TypedToolBindingCard {
  if (!binding) {
    throw new ToolContractProjectionError(
      "binding_context_missing",
      `no retained host binding is armed for ${operation}`,
      { operation },
    );
  }
  if (binding.schema_version !== 1 || binding.operation !== operation) {
    throw new ToolContractProjectionError(
      "binding_context_mismatch",
      `retained host binding does not belong to ${operation}`,
      { operation, bound_operation: binding.operation },
    );
  }
  if (!currentHostContext) {
    throw new ToolContractProjectionError(
      "current_host_context_missing",
      `no independently derived current host context is available for ${operation}`,
      { operation },
    );
  }
  if (binding === currentHostContext) {
    throw new ToolContractProjectionError(
      "current_host_context_not_independent",
      `current host context for ${operation} must be independently derived`,
      { operation },
    );
  }
  if (
    currentHostContext.schema_version !== 1
    || currentHostContext.operation !== operation
  ) {
    throw new ToolContractProjectionError(
      "current_host_context_mismatch",
      `current host context does not belong to ${operation}`,
      { operation, current_operation: currentHostContext.operation },
    );
  }
  validateBindingShape(binding);
  validateBindingShape(currentHostContext);
  if (canonicalJson(binding) !== canonicalJson(currentHostContext)) {
    const bindingRecord = binding as unknown as Record<string, unknown>;
    const currentRecord = currentHostContext as unknown as Record<string, unknown>;
    const mismatchedFields = [...new Set([
      ...Object.keys(bindingRecord),
      ...Object.keys(currentRecord),
    ])].filter((field) => (
      canonicalJson(bindingRecord[field]) !== canonicalJson(currentRecord[field])
    )).sort();
    throw new ToolContractProjectionError(
      "binding_context_stale",
      `retained host binding for ${operation} does not match current canonical identity`,
      { operation, mismatched_fields: mismatchedFields },
    );
  }
  return binding;
}

function bindingValues(binding: TypedToolBindingCard): Record<string, unknown> {
  if (binding.operation === "state.journal") {
    return {
      root: binding.root,
      campaign: binding.campaign,
      player_text: binding.player_text,
      decision_id: binding.decision_id,
      ...(binding.run_id === undefined ? {} : { run_id: binding.run_id }),
    };
  }
  if (binding.operation === "narration.review") {
    return {
      root: binding.root,
      campaign: binding.campaign,
      decision_id: binding.decision_id,
      turn_id: binding.turn_id,
      source_digest: binding.source_digest,
      revision: binding.revision,
      state_claim_compilation: structuredClone(binding.state_claim_compilation),
    };
  }
  if (binding.operation === "turn.finalize") {
    return {
      root: binding.root,
      campaign: binding.campaign,
      decision_id: binding.decision_id,
      revision: binding.revision,
      narration_review_id: binding.narration_review_id,
      ...(binding.repair_finalization_id === undefined
        ? {}
        : { repair_finalization_id: binding.repair_finalization_id }),
    };
  }
  if (binding.operation === "evidence.table_opening") {
    return {
      root: binding.root,
      campaign: binding.campaign,
      decision_id: binding.decision_id,
      run_id: binding.run_id,
    };
  }
  if (binding.operation === "state.record_npc_engagement") {
    return {
      root: binding.root,
      campaign: binding.campaign,
      decision_id: binding.decision_id,
      npc_id: binding.npc_id,
      investigator: binding.investigator,
      first_impression_ref: binding.first_impression_ref,
      run_id: binding.run_id,
    };
  }
  if (binding.operation === "npc.reaction") {
    return {
      root: binding.root,
      campaign: binding.campaign,
      investigator: binding.investigator,
      ...(binding.run_id === undefined ? {} : { run_id: binding.run_id }),
    };
  }
  return {
    root: binding.root,
    campaign: binding.campaign,
    decision_id: binding.decision_id,
  };
}

function hostOwnedFields(binding: TypedToolBindingCard): string[] {
  const fields = [...HOST_OWNED_FIELDS[binding.operation]];
  if (binding.operation === "state.move_scene") {
    if (binding.selection_mode === "manual_scene") {
      fields.push("candidate_id");
    } else if (sceneNeedsRouteChoice(binding.candidates)) {
      fields.push("scene_id");
    } else {
      fields.push("candidate_id");
    }
  }
  if (
    binding.operation === "state.advance_time"
    && binding.clock_precision === "precise"
  ) fields.push("day_phase_after", "display_after");
  if (
    binding.operation === "combat.resolve"
    && binding.candidates.length === 1
  ) fields.push("candidate_id");
  return fields;
}

function sceneNeedsRouteChoice(candidates: readonly SceneRouteCandidate[]): boolean {
  const destinations = new Set<string>();
  for (const candidate of candidates) {
    if (destinations.has(candidate.scene_id)) return true;
    destinations.add(candidate.scene_id);
  }
  return false;
}

function setEnumProperty(
  schema: JsonSchema,
  field: string,
  values: readonly string[],
  description: string,
): void {
  if (!isPlainObject(schema.properties)) return;
  const current = isPlainObject(schema.properties[field])
    ? schema.properties[field]
    : {};
  schema.properties[field] = {
    ...current,
    type: "string",
    enum: [...values],
    description,
  };
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!required.includes(field)) schema.required = [...required, field];
}

/**
 * Remove host-owned fields only after the exact retained binding is validated
 * against an independently derived current canonical host context.
 */
export function projectBoundTypedToolParameters(
  operation: string,
  inputSchema: JsonSchema,
  binding: TypedToolBindingCard | null | undefined,
  currentHostContext: CurrentTypedToolHostContext | null | undefined,
): JsonSchema {
  const valid = validateBindingCard(operation, binding, currentHostContext);
  const cloned = structuredClone(inputSchema);
  const owned = hostOwnedFields(valid);
  cloned.required = Array.isArray(cloned.required)
    ? cloned.required.filter((field) => typeof field !== "string" || !owned.includes(field))
    : cloned.required;
  if (isPlainObject(cloned.properties)) {
    for (const field of owned) delete cloned.properties[field];
  }
  if (valid.operation === "state.move_scene") {
    const selectionMode = valid.selection_mode;
    if (selectionMode === "manual_scene") {
      // Keep the archive's semantic scene_id string unconstrained. A manual
      // destination is still KP-owned; only identity and derived travel are
      // host-owned from the current receipt.
    } else if (sceneNeedsRouteChoice(valid.candidates)) {
      setEnumProperty(
        cloned,
        "candidate_id",
        valid.candidates.map((candidate) => candidate.candidate_id),
        "Choose one current source-authored semantic route; the host binds its exact destination and travel time.",
      );
    } else {
      setEnumProperty(
        cloned,
        "scene_id",
        valid.candidates.map((candidate) => candidate.scene_id),
        "Choose one current source-authored semantic scene id; the host binds exact travel time.",
      );
    }
  }
  if (valid.operation === "combat.resolve" && valid.candidates.length > 1) {
    setEnumProperty(
      cloned,
      "candidate_id",
      valid.candidates.map((candidate) => candidate.candidate_id),
      "Choose one current semantic combat route; the host binds its exact canonical invocation mode.",
    );
  }
  return cloned;
}

/**
 * Reject caller-forged host-owned fields and restore the exact retained values.
 * The result still uses canonical operation argument names and is ready for
 * wrapTypedToolInvokeParams; no alternate gateway envelope is introduced.
 */
export function bindRetainedTypedToolArguments(
  operation: string,
  modelInput: Record<string, unknown>,
  binding: TypedToolBindingCard | null | undefined,
  currentHostContext: CurrentTypedToolHostContext | null | undefined,
): Record<string, unknown> {
  const valid = validateBindingCard(operation, binding, currentHostContext);
  const owned = hostOwnedFields(valid);
  const forged = owned.filter((field) => Object.hasOwn(modelInput, field));
  if (forged.length) {
    throw new ToolContractProjectionError(
      "forged_host_argument",
      `model input for ${operation} contains host-owned fields: ${forged.join(", ")}`,
      { operation, fields: forged },
    );
  }
  const result = {
    ...structuredClone(modelInput),
    ...bindingValues(valid),
  };
  if (valid.operation === "state.move_scene") {
    const selectionMode = valid.selection_mode;
    if (selectionMode === "manual_scene") {
      const sceneId = typeof result.scene_id === "string" ? result.scene_id.trim() : "";
      const matches = valid.candidates.filter((row) => row.scene_id === sceneId);
      const travelShapes = new Map<string, SceneRouteCandidate>();
      for (const candidate of matches) {
        const key = Object.hasOwn(candidate, "travel_minutes")
          ? `timed:${candidate.travel_minutes}`
          : "absent";
        if (!travelShapes.has(key)) travelShapes.set(key, candidate);
      }
      delete result.candidate_id;
      result.scene_id = sceneId;
      delete result.travel_minutes;
      const exactRoute = travelShapes.size === 1
        ? travelShapes.values().next().value as SceneRouteCandidate | undefined
        : undefined;
      if (exactRoute && Object.hasOwn(exactRoute, "travel_minutes")) {
        result.travel_minutes = exactRoute.travel_minutes;
      }
      return result;
    }
    const routeChoice = sceneNeedsRouteChoice(valid.candidates);
    const candidate = routeChoice
      ? valid.candidates.find((row) => (
          row.candidate_id === (typeof result.candidate_id === "string"
            ? result.candidate_id
            : "")
        ))
      : valid.candidates.find((row) => (
          row.scene_id === (typeof result.scene_id === "string" ? result.scene_id : "")
        ));
    if (!candidate) {
      throw new ToolContractProjectionError(
        "semantic_candidate_stale",
        "selected scene route is not in the current retained semantic candidates",
        { operation, candidate_field: routeChoice ? "candidate_id" : "scene_id" },
      );
    }
    delete result.candidate_id;
    result.scene_id = candidate.scene_id;
    delete result.travel_minutes;
    if (Object.hasOwn(candidate, "travel_minutes")) {
      result.travel_minutes = candidate.travel_minutes;
    }
  }
  if (valid.operation === "combat.resolve") {
    const candidateId = valid.candidates.length === 1
      ? valid.candidates[0].candidate_id
      : typeof result.candidate_id === "string" ? result.candidate_id : "";
    const candidate = valid.candidates.find((row) => row.candidate_id === candidateId);
    if (!candidate) {
      throw new ToolContractProjectionError(
        "semantic_candidate_stale",
        "selected combat route is not in the current retained semantic candidates",
        { operation, candidate_field: "candidate_id" },
      );
    }
    delete result.candidate_id;
    if (candidate.invocation_mode === "target_npc_id") {
      result.target_npc_id = candidate.target_npc_id;
    } else if (candidate.invocation_mode === "affordance_id") {
      result.affordance_id = candidate.affordance_id;
    }
  }
  return result;
}

/**
 * Pi-only static schema overlays that can reject invalid model arguments
 * before any retained host context exists. The canonical archive is not
 * changed; only the presented schema is deepened.
 */
export function projectPiTypedToolParameters(
  operation: string,
  inputSchema: JsonSchema,
): JsonSchema {
  // Semantic-handle overlay first: every presented schema exposes only the
  // stable entity handles; exact canonical identities are host-bound.
  const handleOverlayed = projectSemanticHandleSchemaOverlay(inputSchema);
  if (operation !== "rules.social_adjudicate") return handleOverlayed;
  const cloned = handleOverlayed;
  if (!isPlainObject(cloned.properties)) return cloned;
  const direction = {
    type: "string",
    enum: ["support", "neutral", "oppose"],
  };
  const evidenceRefs = {
    type: "array",
    items: {},
  };
  cloned.properties.motive = {
    description: (
      "Structured NPC motive. intensity 1 or 2 requires at least one "
      + "canonical evidence ref; intensity 0 may use an empty list."
    ),
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          direction,
          intensity: { const: 0, type: "integer" },
          evidence_refs: evidenceRefs,
        },
        required: ["direction", "intensity", "evidence_refs"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          direction,
          intensity: { enum: [1, 2], type: "integer" },
          evidence_refs: { ...evidenceRefs, minItems: 1 },
        },
        required: ["direction", "intensity", "evidence_refs"],
      },
    ],
  };
  return cloned;
}

/**
 * Model-call argument projection for one exact invocation surface.
 *
 * `model_owned_arguments` is DERIVED, never enumerated: it is the actual typed
 * inputSchema property set minus the authoritative host-owned field table that
 * the invoke-time binding enforces, split by the schema's own `required`.
 * `host_bound_auto_attached_arguments` are the schema fields the host attaches
 * (identity, revision, decision, compiler receipts); the model must never
 * echo or construct them.
 */
export type ModelCallArgumentProjection = {
  operation: string;
  invoke_via: string;
  contract_source: "mcp_operation_contracts.inputSchema";
  /**
   * Real invocation shape of the `invoke_via` tool:
   * - "typed_flat": the tool is the direct typed surface (e.g.
   *   coc_turn_finalize) and takes the model-owned arguments flat.
   * - "generic_envelope": the tool is the generic coc_invoke gateway and
   *   takes `{ operation, arguments }`; the model-owned arguments nest
   *   inside `arguments` exactly once.
   */
  invocation_shape: "typed_flat" | "generic_envelope";
  /** Present only for generic_envelope: the exact operation name to place
   * in the envelope's `operation` field. */
  envelope_operation?: string;
  model_owned_required_arguments: string[];
  model_owned_optional_arguments: string[];
  host_bound_auto_attached_arguments: string[];
};

/**
 * Derive the model-call argument split for `operation` from the ACTUAL typed
 * schema (loaded from the canonical MCP operation contract archive) and the
 * same host-owned table `bindRetainedTypedToolArguments` enforces. No model-
 * owned field is hand-listed here, so the projection cannot drift from the
 * archive; a host call surface without a host-owned contract fails closed.
 */
export function projectModelCallArguments(
  operation: string,
  invokeVia: string,
  inputSchema: JsonSchema,
): ModelCallArgumentProjection {
  const hostOwned = (HOST_OWNED_FIELDS as Record<string, readonly string[] | undefined>)[operation];
  if (hostOwned === undefined) {
    throw new ToolContractProjectionError(
      "model_call_projection_unavailable",
      `no host-owned argument contract exists for ${operation}`,
      { operation },
    );
  }
  if (typeof invokeVia !== "string" || !invokeVia) {
    throw new ToolContractProjectionError(
      "model_call_projection_unavailable",
      `invoke_via for ${operation} must be a non-empty string`,
      { operation },
    );
  }
  // The generic gateway takes a nested envelope, not flat typed arguments;
  // any other invoke_via is the direct typed surface with flat arguments.
  const genericEnvelope = invokeVia === "coc_invoke";
  const properties = isPlainObject(inputSchema.properties)
    ? Object.keys(inputSchema.properties)
    : [];
  if (properties.length === 0) {
    throw new ToolContractProjectionError(
      "model_call_projection_unavailable",
      `typed schema for ${operation} exposes no properties`,
      { operation },
    );
  }
  const required = new Set(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.filter((field): field is string => typeof field === "string")
      : [],
  );
  const hostOwnedSet = new Set(hostOwned);
  const modelOwnedRequired: string[] = [];
  const modelOwnedOptional: string[] = [];
  const hostBound: string[] = [];
  for (const field of properties) {
    if (hostOwnedSet.has(field)) hostBound.push(field);
    else (required.has(field) ? modelOwnedRequired : modelOwnedOptional).push(field);
  }
  return {
    operation,
    invoke_via: invokeVia,
    contract_source: "mcp_operation_contracts.inputSchema",
    invocation_shape: genericEnvelope ? "generic_envelope" : "typed_flat",
    ...(genericEnvelope ? { envelope_operation: operation } : {}),
    model_owned_required_arguments: modelOwnedRequired,
    model_owned_optional_arguments: modelOwnedOptional,
    host_bound_auto_attached_arguments: hostBound,
  };
}

function hasDynamicCandidateDetails(error: Record<string, unknown>): boolean {
  const details = isPlainObject(error.details) ? error.details : null;
  if (!details) return false;
  return [
    "allowed_candidates",
    "allowed_scene_ids",
    "allowed_target_ids",
    "current_candidates",
  ].some((key) => Array.isArray(details[key]));
}

function structuredViolationCodes(error: Record<string, unknown>): string[] {
  const direct = Array.isArray(error.violations) ? error.violations : [];
  const details = isPlainObject(error.details) && Array.isArray(error.details.violations)
    ? error.details.violations
    : [];
  return [...direct, ...details].flatMap((value) => (
    isPlainObject(value) && typeof value.code === "string" && value.code
      ? [value.code]
      : []
  ));
}

function nextActionForSameOperation(operation: string): PiAllowedNextAction[] {
  return operation
    ? [{
      operation,
      action: "correct_model_arguments",
      reason: "correct the model-owned arguments using violations and expected_schema",
      host_bound: false,
    }]
    : [];
}

function failureDisposition(
  operation: string,
  error: Record<string, unknown>,
): {
  class: PiFailureClass;
  recoverable_by: PiFailureRecovery;
  allowed_next_actions: PiAllowedNextAction[];
  automatic_action?: string;
} {
  const code = typeof error.code === "string" ? error.code : "";
  const dynamicActions = DYNAMIC_CANDIDATE_ACTIONS[code];
  const inferredDynamicActions = (
    isPiSchemaFailure(operation, code)
    && hasDynamicCandidateDetails(error)
    && (operation === "state.move_scene" || operation.startsWith("combat."))
  )
    ? operation.startsWith("combat.")
      ? DYNAMIC_CANDIDATE_ACTIONS.unknown_combat_target
      : DYNAMIC_CANDIDATE_ACTIONS.unknown_scene_route
    : null;
  if (dynamicActions || inferredDynamicActions) {
    return {
      class: "dynamic_candidate",
      recoverable_by: "model_next_action",
      allowed_next_actions: structuredClone(dynamicActions ?? inferredDynamicActions ?? []),
    };
  }
  const repairCode = BUSINESS_PRECONDITION_ACTIONS[code]
    ? code
    : structuredViolationCodes(error).find((value) => BUSINESS_PRECONDITION_ACTIONS[value]);
  if (repairCode) {
    return {
      class: "business_precondition",
      recoverable_by: "model_next_action",
      allowed_next_actions: structuredClone(BUSINESS_PRECONDITION_ACTIONS[repairCode]),
    };
  }
  if (isPiSchemaFailure(operation, code)) {
    return {
      class: "schema_validation",
      recoverable_by: "model_next_action",
      allowed_next_actions: nextActionForSameOperation(operation),
    };
  }
  if (HOST_BINDING_REFRESH_CODES.has(code)) {
    return {
      class: "idempotency_conflict",
      recoverable_by: "host_binding_refresh",
      allowed_next_actions: [],
      automatic_action: "refresh_retained_binding_or_fault",
    };
  }
  if (STALE_BINDING_CODES.has(code)) {
    return {
      class: "business_precondition",
      recoverable_by: "host_binding_refresh",
      allowed_next_actions: [],
      automatic_action: "refresh_retained_binding_or_fault",
    };
  }
  if (TRANSIENT_CODES.has(code) || error.retryable === true) {
    return {
      class: "transient_transport",
      recoverable_by: "host_internal_retry",
      allowed_next_actions: [],
      automatic_action: "respect_existing_bounded_runtime_retry",
    };
  }
  return {
    class: "invariant_terminal",
    recoverable_by: "none",
    allowed_next_actions: [],
  };
}

/**
 * Add Pi-only classification and recovery routing to an existing canonical
 * business-failure envelope. Existing code/message/details/violations/hints,
 * retryable, and MCP isError semantics are preserved; the Pi-owned
 * class/recoverability/action keys are normalized here.
 */
export function projectPiToolFailure(
  visible: Record<string, unknown> | null,
  operation: string | null | undefined,
): Record<string, unknown> | null {
  if (!visible || !operation || !isPlainObject(visible.error)) return visible;
  const error = visible.error;
  const disposition = failureDisposition(operation, error);
  return {
    ...visible,
    error: {
      ...error,
      class: disposition.class,
      recoverable_by: disposition.recoverable_by,
      allowed_next_actions: disposition.allowed_next_actions,
      ...(disposition.automatic_action === undefined
        ? {}
        : { automatic_action: disposition.automatic_action }),
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Model-visible canonical result projection (the single Pi gateway boundary).
//
// After every canonical host observer/binding has consumed the exact envelope,
// model-facing `content` is projected here: wire/integrity/archive/cache/job/
// packet/receipt hashes and opaque identity fields are stripped, the current
// investigator/subject/advice identities become stable semantic handles, and
// per-operation semantic views keep exactly the substance the KP needs. The
// gateway keeps the untouched canonical envelope in host-only `details`.
// Detection is field-structured (schema/operation/field rules); no content
// prose scanning happens in production — regex leak scanning is tests-only.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Canonical-id → presented semantic-handle projection for observed
 * roll/effect/item/weapon/route entities (e.g. `toolbox-…-000003` →
 * `roll:spot-hidden`). Produced by the semantic identity registry for one
 * exact session-epoch/campaign/turn scope; built from structured observation
 * facts only — never from random bytes. Domains are NEVER flattened: each
 * family keeps its own canonical→handle map.
 */
export type SemanticIdMap = SemanticProjectionView;

/** Bounded diagnostic: an unmapped required identity member (no value echoed). */
export type UnmappedIdentityRef = {
  field: string;
  parentField: string | null;
  domain: string;
  /** Exact nested path of the unmappable identity (diagnostics only). */
  path?: string;
};

/** Diagnostics collector threaded through projection (never carries values). */
export type ProjectionIdentityDiagnostics = {
  unmapped: UnmappedIdentityRef[];
};

/** Stable semantic handle for the current investigator entity. */
export const CURRENT_INVESTIGATOR_HANDLE = "current-investigator";
/** Stable semantic handle for the current PC agency subject ref. */
export const CURRENT_PC_SUBJECT_HANDLE = "pc:current-investigator";
/** Stable semantic handle for the current player-input source ref. */
export const CURRENT_PLAYER_INPUT_SOURCE_HANDLE = "player_input:current";
/** Stable semantic handle for the current storylet advisory uptake identity. */
export const CURRENT_ADVICE_HANDLE = "storylet:current-advice";
export const CURRENT_CANDIDATE_HANDLE = "storylet:current-candidate";

/** Exact canonical entity identities the host retains from observed envelopes. */
export type SemanticEntityFacts = {
  investigatorId: string | null;
  pcSubjectRefs: readonly string[];
  playerInputSourceRef: string | null;
  advisoryAdviceId: string | null;
  advisoryCandidateRef: string | null;
};

export const emptySemanticEntityFacts = (): SemanticEntityFacts => ({
  investigatorId: null,
  pcSubjectRefs: [],
  playerInputSourceRef: null,
  advisoryAdviceId: null,
  advisoryCandidateRef: null,
});

/**
 * Structured deny rules. `identity` fields are exact host-internal names;
 * `integrityTokens` matches field-name tokens (sha256/digest/hash families);
 * `stringRevision` fields are dropped only when their value is a string
 * (opaque revision tokens), never when integer (semantic ordinals).
 */
const DENIED_IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  "turn_id",
  "session_id",
  "entry_id",
  "finalization_id",
  "narration_review_id",
  "review_id",
  "settlement_snapshot_id",
  "first_impression_ref",
  "journal_decision_id",
  "repair_finalization_id",
  "identity_ref",
  "profile_revision_ref",
  "identity_contract",
  "contract_ref",
  "state_claim_compilation",
  "packet_id",
  "packet",
  "pi_task",
  "claim_operation",
  "coordinator_dispatch",
  "background_takeover",
  "ready_background_requests",
  "next_host_action",
  "host_dispatch",
  "task_prompt",
  "job_id",
  "supersedes_host_job_ids",
  "superseded_host_job_ids",
  "pending_supersede_host_job_ids",
  "consumer_refs",
  "host_work_request",
  "workspace_root",
  "data_ref",
  "row_ref",
  "exact_text_ref",
  "python_executable",
  "toolbox_script",
  "catalog_path",
  "source_bundle_path",
  "asset_ids",
  "player_input",
  "checkpoint_id",
  "enqueue",
  "worker_kick",
  "cache",
  "source_cache_path",
  "receipt_id",
]);

const INTEGRITY_NAME_TOKENS = ["sha256", "digest", "hash"] as const;

function fieldNameTokens(name: string): string[] {
  return name.split(/[^A-Za-z0-9]+/).filter((token) => token.length > 0);
}

/**
 * Operation-declared host integrity fields: the closed universe of machine
 * integrity names the host emits, keyed by the operation whose canonical
 * envelope may carry them. A declared field is intentionally details-only:
 * silently stripped from model content while the exact canonical envelope
 * stays in host-only `details`. The SAME integrity-named field on an
 * operation that never declared it is UNKNOWN evidence — it fails closed
 * with a bounded diagnostic instead of being silently deleted.
 */
const CLASSIFIED_INTEGRITY_FIELDS: ReadonlySet<string> = new Set([
  "source_digest", "mechanics_bundle_sha256", "contract_projection_sha256",
  "accepted_draft_sha256", "rendered_text_sha256", "integrity_digest",
  "draft_sha256", "request_digest", "review_digest", "text_sha256",
  "full_result_sha256", "contract_archive_sha256", "bundle_sha256s",
  "full_capsule_sha256", "projection_sha256", "scenario_binding_sha256",
  "original_hash", "bundle_sha256", "bundle_sha256s", "sha256",
  "payload_sha256", "receipt_digest", "rendered_sha256",
  "baseline_draft_sha256", "data_digest", "row_digest", "content_sha256",
]);

/**
 * Operation-declared output identity projection registry. Each entry is the
 * closed declaration of the identity/integrity-bearing field paths ONE
 * operation's canonical data may carry and what happens to each:
 * - `integrity`: host-only machine identity — stripped from model content;
 *   the exact canonical values stay in host-only details. Declared = silent.
 * - `semantic`: declared model-visible semantic content — the value must
 *   STILL pass the closed semantic grammar (meaning-bearing slug, approved
 *   namespace, anchored semantic, or entropy-free path); declared paths are
 *   never grammar-exempt, only path-allowed.
 * - `hostOnly`: operation-known machine identity or identity-shaped guidance
 *   that is intentionally stripped while the exact canonical value remains
 *   available in host details.
 * The registry-domain projectors (roll/effect/item/weapon/route handle
 * mapping, lost-id arrays, current-entity handles, obligations, provenance)
 * are the declared registry-domain-mapping dispositions and stay closed
 * tables. Any identity/integrity-like path NOT declared for the operation —
 * including plausible semantic slugs and unknown `*_id(s)`/`*_ref(s)` —
 * fails closed with exact path diagnostics. There is no global
 * grammar acceptance and no silent deletion.
 */
type OperationIdentityDeclarations = {
  integrity: ReadonlySet<string>;
  semantic: ReadonlySet<string>;
  hostOnly: ReadonlySet<string>;
};

const declaredIdentityTable = (
  semantic: readonly string[],
  integrity: readonly string[],
  hostOnly: readonly string[] = [],
): OperationIdentityDeclarations => ({
  semantic: new Set(semantic),
  integrity: new Set(integrity),
  hostOnly: new Set(hostOnly),
});

/**
 * Identity-bearing fields emitted by the bounded `scene.context` wire view.
 * `session.resume.data.scene_context` is the same canonical sub-document and
 * must be projected through this exact closed declaration instead of widening
 * the outer resume operation. Route ids are deliberately absent: they are
 * projected only through the live semantic route registry.
 */
const SCENE_CONTEXT_SEMANTIC_IDENTITY_FIELDS = [
  "active_scene_id", "affordance_id", "asset_root_id", "campaign_id",
  "civil_segment_id", "clock_id", "clue_id", "clue_ids",
  "conclusion_id", "drilldown_refs", "flag_id", "grants_clue_ids",
  "location_id", "mechanics_ref", "npc_id", "npc_ids", "ref_id",
  "scene_id", "source_ref", "trigger_id",
] as const;

const OPERATION_IDENTITY_DECLARATIONS: ReadonlyMap<
  string,
  OperationIdentityDeclarations
> = new Map([
  ["session.resume", declaredIdentityTable(
    [
      "active_scene_id", "asset_root_id", "campaign_id", "civil_segment_id",
      "clue_id", "decision_id", "location_id", "run_segment_id",
      "scenario_id", "source_ref", "table_opening_id",
    ],
    [
      "baseline_draft_sha256", "rendered_sha256", "rendered_text_sha256",
      "source_digest", "full_capsule_sha256", "data_digest", "row_digest",
      "content_sha256", "contract_projection_sha256",
    ],
  )],
  ["scene.map", declaredIdentityTable(
    ["active_scene_id", "progressive_asset_root_id", "scene_id"],
    [],
  )],
  ["scene.context", declaredIdentityTable(
    SCENE_CONTEXT_SEMANTIC_IDENTITY_FIELDS,
    [],
  )],
  ["clues.query", declaredIdentityTable(
    [
      "asset_id", "clue_id", "clue_refs", "conclusion_id",
      "delivered_handout_ids", "discovered_clue_ids", "discovered_route_ids",
      "image_ref", "scene_refs",
    ],
    [],
  )],
  ["npc.query", declaredIdentityTable(
    [
      "clue_id", "deflect_id", "fact_id", "known_fact_ids", "npc_id",
      "revealable_fact_ids", "schedule_id", "subject_id",
      "valid_optional_evidence_refs",
    ],
    [],
    ["feasibility_refs", "memory_id", "source_ref"],
  )],
  ["secrets.briefing", declaredIdentityTable(
    ["clue_id", "clue_ids", "npc_id", "npc_ids", "scene_id"],
    [],
  )],
  ["steward.scene_supply", declaredIdentityTable(["scene_id"], [])],
  ["setup.inspect", declaredIdentityTable(
    ["active_scenario_id", "campaign_id", "pregen_id", "scenario_id"],
    ["projection_sha256"],
  )],
  ["setup.phase", declaredIdentityTable(["asset_root_id", "campaign_id"], [])],
  ["setup.adopt_source_facts", declaredIdentityTable(["campaign_id"], [])],
  ["setup.investigator_contract", declaredIdentityTable(["campaign_id"], [])],
  ["setup.quick_start", declaredIdentityTable(
    ["campaign_id", "decision_id", "pregen_id", "scenario_id", "state_refs"],
    [],
  )],
  ["setup.complete", declaredIdentityTable(
    ["campaign_id", "decision_id", "scenario_id", "state_refs"],
    [],
  )],
  ["epistemic.query", declaredIdentityTable(
    [
      "active_question_ids", "answer_question_ids", "answered_question_ids",
      "applied_effect_ids", "open_question_ids",
    ],
    [],
  )],
  ["evidence.table_opening", declaredIdentityTable(
    ["campaign_id", "run_id", "run_segment_id", "source_id", "source_ref"],
    ["rendered_text_sha256", "text_sha256"],
  )],
  ["actions.list", declaredIdentityTable(
    ["affordance_id", "id", "scene_id"],
    [],
  )],
  ["actions.advise", declaredIdentityTable(
    [
      "authorized_entity_refs", "authorized_route_ids", "clock_id", "clue_id",
      "family_id", "front_id", "last_storylet_id", "location_id", "npc_id",
      "scene_id", "storylet_id", "trope_id",
    ],
    [],
  )],
  ["state.move_scene", declaredIdentityTable(
    [
      "asset_root_id", "from_location_id", "from_scene_id", "scene_id",
      "to_location_id", "to_scene_id",
    ],
    [],
  )],
  ["progressive.on_enter_scene", declaredIdentityTable(
    ["asset_root_id", "scene_id"],
    ["scenario_binding_sha256"],
  )],
  ["rules.roll", declaredIdentityTable(
    ["attempt_id", "decision_id", "original_check_decision_id", "scene_id"],
    [],
  )],
  ["state.advance_time", declaredIdentityTable(
    ["civil_segment_id", "location_id", "source_ref"],
    [],
  )],
  ["state.inventory_list", declaredIdentityTable(["npc_id"], [])],
  ["state.item_grant", declaredIdentityTable(["npc_id"], [])],
  ["state.item_remove", declaredIdentityTable(["npc_id"], [])],
  ["state.item_use", declaredIdentityTable(["npc_id"], [])],
  ["state.record_clue", declaredIdentityTable(
    ["clue_id", "decision_id", "route_id", "scene_id"],
    [],
  )],
  ["state.deliver_handout", declaredIdentityTable(
    ["asset_id", "image_ref"],
    [],
  )],
  ["state.journal", declaredIdentityTable(["decision_id", "thread_id"], [])],
  ["turn.output_context", declaredIdentityTable(
    [
      "authorized_entity_refs", "authorized_route_ids", "clock_id", "clue_id",
      "decision_id", "family_id", "front_id", "last_storylet_id",
      "location_id", "npc_id", "required_obligation_ids", "run_segment_id",
      "scene_id", "source_id", "source_ref", "storylet_id", "trope_id",
    ],
    ["contract_projection_sha256", "mechanics_bundle_sha256", "source_digest", "text_sha256"],
  )],
  ["narration.review", declaredIdentityTable(
    ["decision_id"],
    ["draft_sha256", "request_digest", "review_digest", "source_digest", "payload_sha256"],
  )],
  ["turn.finalize", declaredIdentityTable(
    ["decision_id", "run_segment_id"],
    [
      "accepted_draft_sha256", "contract_projection_sha256", "integrity_digest",
      "rendered_text_sha256", "source_digest", "payload_sha256",
    ],
  )],
  ["state.purchase", declaredIdentityTable(
    ["decision_id"],
    [],
  )],
]);

const IDENTITY_NAMED_FIELD = /(^|_)(id|ids|ref|refs)$/;

/**
 * Globally declared semantic paths: closed host contracts (the
 * turn-processing fault receipt) whose semantic contract id may appear in
 * ANY operation's error details. Values still pass the closed semantic
 * grammar; unknown namespaced or entropy-bearing values fail closed.
 */
const GLOBAL_SEMANTIC_IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  "contract_id",
]);

// Closed-universe check: every operation-declared integrity field must be a
// member of the classified integrity-name universe — per-operation
// declarations narrow the boundary; they never extend the name universe.
for (const declarations of OPERATION_IDENTITY_DECLARATIONS.values()) {
  for (const field of declarations.integrity) {
    if (!CLASSIFIED_INTEGRITY_FIELDS.has(field)) {
      throw new ToolContractProjectionError(
        "integrity_declaration_outside_universe",
        `integrity field ${field} is operation-declared but outside the ` +
          "classified integrity universe",
      );
    }
  }
}

function declaredIdentityDisposition(
  operation: string | null,
  field: string,
): "host_only" | "integrity" | "semantic" | null {
  if (GLOBAL_SEMANTIC_IDENTITY_FIELDS.has(field)) return "semantic";
  if (operation === null) return null;
  const declarations = OPERATION_IDENTITY_DECLARATIONS.get(operation);
  if (declarations === undefined) return null;
  if (declarations.hostOnly.has(field)) return "host_only";
  if (declarations.integrity.has(field)) return "integrity";
  if (declarations.semantic.has(field)) return "semantic";
  return null;
}

function isIntegrityFieldName(name: string): boolean {
  const lowered = name.toLowerCase();
  return fieldNameTokens(lowered).some((token) =>
    INTEGRITY_NAME_TOKENS.some((integrity) => token.startsWith(integrity))
  );
}

function isStringRevisionField(name: string): boolean {
  return name === "revision" || /_revision$/.test(name);
}

/**
 * Entity-handle rewrites. `advice_id`/`candidate_ref` are rewritten only
 * under a `narrative_opportunity` parent (the single current advisory); the
 * same names elsewhere are advisory identity lists and fail closed (drop).
 */
function projectEntityHandleValue(
  field: string,
  value: unknown,
  parentField: string | null,
): { action: "keep"; value?: unknown } | { action: "drop" } {
  if (field === "investigator_id" && typeof value === "string") {
    return { action: "keep", value: CURRENT_INVESTIGATOR_HANDLE };
  }
  if (field === "party" && Array.isArray(value)) {
    return {
      action: "keep",
      value: value.map((entry) =>
        typeof entry === "string" ? CURRENT_INVESTIGATOR_HANDLE : entry
      ),
    };
  }
  if (field === "pc_subject_refs" && Array.isArray(value)) {
    return {
      action: "keep",
      value: value.map((entry) =>
        typeof entry === "string" ? CURRENT_PC_SUBJECT_HANDLE : entry
      ),
    };
  }
  if (field === "advice_id" || field === "candidate_ref") {
    if (parentField === "narrative_opportunity" && typeof value === "string") {
      return {
        action: "keep",
        value: field === "advice_id" ? CURRENT_ADVICE_HANDLE : CURRENT_CANDIDATE_HANDLE,
      };
    }
    return { action: "drop" };
  }
  return { action: "keep" };
}

/**
 * Recursive UNKNOWN identity discovery: any identity/integrity-bearing field
 * NOT covered by the explicit projectors above must still pass the closed
 * semantic grammar before it may appear in model content. Structured key
 * classification — never prose scanning:
 * - integrity/hash/digest/cache/job/packet family fields NEVER pass;
 * - `*_id(s)`/`*_ref(s)` values pass only as meaning-bearing multi-token
 *   slugs or `kind:semantic-remainder` namespaces (machine prefixes and
 *   entropy material always reject).
 * Failures drop the value and emit a bounded diagnostic, which the gateway
 * turns into `semantic_identity_unavailable` — never a silent pass.
 */
const DISCOVERY_IDENTITY_NAME = /(^|_)(id|ids|ref|refs)$/;
const DISCOVERY_INFRA_NAME =
  /(?:^|_)(?:cache|job|packet|lease|receipt|checkpoint|token|seal)(?:$|_)/i;
const DISCOVERY_NAMESPACE = /^[a-z][a-z0-9._-]{0,63}:/;
const discoveryDomain = (field: string): string =>
  DISCOVERY_INFRA_NAME.test(field) ? "integrity" : "unknown";

function projectDiscoveredIdentityValue(
  field: string,
  value: string,
  parentField: string | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
): { action: "keep"; value?: unknown } | { action: "drop" } | null {
  if (DISCOVERY_INFRA_NAME.test(field)) {
    diagnostics?.unmapped.push({
      field,
      parentField,
      domain: discoveryDomain(field),
    });
    return { action: "drop" };
  }
  const machinePrefix = RAW_REJECTED_PREFIXES.find((prefix) =>
    value.startsWith(prefix)
  );
  // Path-shaped refs (state_refs file provenance) pass when no segment
  // carries entropy material.
  const isPathLike = value.includes("/")
    && !/[**|<>$`]/.test(value)
    && value.split("/").every((segment) => {
      if (segment === "" || segment === "." || segment === "..") return true;
      // Hidden directories (".coc") lead with a dot by convention.
      const slug = segment.startsWith(".") ? segment.slice(1) : segment;
      return slug.length > 0 && isSemanticSlugShape(slug);
    });
  const passes = machinePrefix === undefined
    && !violatesSemanticIdentityGrammar(value)
    && (isMultiTokenSlug(value)
      || isSemanticSlugShape(value)
      || isDiscoveryNamespaceSemantic(value)
      || isDiscoveryAnchoredSemantic(value)
      || isPathLike);
  if (!passes) {
    diagnostics?.unmapped.push({
      field,
      parentField,
      domain: discoveryDomain(field),
    });
    return { action: "drop" };
  }
  return null;
}

function isDiscoveryNamespaceSemantic(value: string): boolean {
  const match = DISCOVERY_NAMESPACE.exec(value);
  if (match === null) return false;
  const remainder = value.slice(match[0].length);
  if (remainder.length < 3) return false;
  return remainder.split(":").every((segment) => isSemanticSlugShape(segment));
}

/**
 * Kind-anchored structured refs with a `#` anchor ("table.opening#<slug>")
 * are the session-level provenance form: a dotted semantic head plus slug
 * segments. Entropy and machine-namespace checks still apply upstream.
 */
function isDiscoveryAnchoredSemantic(value: string): boolean {
  const match = /^([a-z][a-z0-9._-]{0,63})#(.+)$/.exec(value);
  if (match === null) return false;
  if (!isSemanticSlugShape(match[1])) return false;
  return match[2].split(/[#.:_-]+/).every((segment) => isSemanticSlugShape(segment));
}

function projectDiscoveredIdentityField(
  field: string,
  value: unknown,
  parentField: string | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
  operation: string | null = null,
  fieldPath: string = field,
  valueFromHostProjector = false,
): { action: "keep"; value?: unknown } | { action: "drop" } | null {
  const identityNamed = DISCOVERY_IDENTITY_NAME.test(field)
    || DISCOVERY_INFRA_NAME.test(field);
  if (!identityNamed) return null;
  // Operation-declared closure: an identity/integrity-bearing path the
  // operation never declared is unknown STRING evidence — it fails closed
  // with a bounded diagnostic regardless of its value shape. A
  // semantic-looking slug on an undeclared path is still an undeclared
  // path. Non-string values (counts, nested objects) carry no identity
  // material themselves and recurse as before; host-rewritten
  // current-entity handles are not model-authored and skip only this
  // declaration gate.
  const declared = valueFromHostProjector
    || declaredIdentityDisposition(operation, field) !== null;
  if (operation !== null && !declared && typeof value === "string") {
    diagnostics?.unmapped.push({
      field,
      parentField,
      domain: DISCOVERY_INFRA_NAME.test(field) ? "integrity" : "undeclared",
      path: fieldPath,
    });
    return { action: "drop" };
  }
  if (typeof value === "string") {
    return projectDiscoveredIdentityValue(field, value, parentField, diagnostics);
  }
  if (Array.isArray(value)) {
    const members: unknown[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") {
        members.push(entry);
        continue;
      }
      const outcome = projectDiscoveredIdentityValue(
        field,
        entry,
        parentField,
        diagnostics,
      );
      if (outcome === null) members.push(entry);
      else if (outcome.action === "keep") members.push(outcome.value);
    }
    return { action: "keep", value: members };
  }
  // Non-string values (objects/numbers/null) recurse through the normal walk.
  return null;
}

/** Fields whose scalar value is a canonical roll/effect/item/weapon/route identity. */
const SEMANTIC_ID_SCALAR_FIELDS: ReadonlyMap<string, string> = new Map([
  ["roll_id", "roll:"],
  ["consuming_roll_id", "roll:"],
  ["resolution_roll_id", "roll:"],
  ["source_roll_id", "roll:"],
  ["effect_id", "effect:"],
  ["weapon_id", "weapon:"],
  ["base_weapon_id", "weapon:"],
  ["item_id", "item:"],
  ["route_id", "route:"],
  ["route_ref", "route:"],
]);

/** Lost/removed-id arrays: project through the lost last-known handles. */
const LOST_ID_ARRAY_FIELDS: ReadonlyMap<string, "items" | "weapons"> = new Map([
  ["lost_weapon_ids", "weapons"],
  ["lost_equipment_ids", "items"],
]);

/** Fields whose array members are canonical roll/effect/item/route identities. */
const SEMANTIC_ID_ARRAY_FIELDS: ReadonlyMap<string, string> = new Map([
  ["source_roll_ids", "roll:"],
  ["roll_ids", "roll:"],
  ["presented_roll_ids", "roll:"],
  ["source_ids", "roll:"],
  ["substantive_effect_ids", "effect:"],
  ["effect_ids", "effect:"],
  ["weapon_effect_ids", "effect:"],
  ["item_ids", "item:"],
  ["route_ids", "route:"],
  ["route_refs", "route:"],
]);

/** Structured namespaces that may pass projection without registry mapping. */
const APPROVED_SEMANTIC_NAMESPACES: ReadonlySet<string> = new Set([
  "roll:", "effect:", "item:", "route:", "state:", "rule:", "check:",
  "narration_contract:", "clue:", "npc:", "scene:", "handout:", "thread:",
  "location:", "clock:", "pdf:", "module:", "source:", "weapon:", "advice:",
  "storylet:", "storylet-candidate:", "secret:", "affordance:", "delivery:",
]);

/** Domain map lookup for one presented prefix — never a flattened map. */
function projectionDomainMap(
  prefix: string,
  semanticIds: SemanticIdMap,
): ReadonlyMap<string, string> {
  switch (prefix) {
    case "effect:": return semanticIds.effects;
    case "item:": return semanticIds.items;
    case "weapon:": return semanticIds.weapons;
    case "route:": return semanticIds.routes;
    default: return semanticIds.rolls;
  }
}

/**
 * Map one canonical roll/effect/item/weapon/route value to its
 * registry-presented semantic handle, resolved in the value's OWN domain.
 * Unobserved values fail closed (dropped, or recorded in diagnostics) —
 * they are never echoed.
 */
function projectSemanticIdValue(
  prefix: string,
  value: string,
  semanticIds: SemanticIdMap | null,
): string | null {
  if (semanticIds === null) return null;
  const domainMap = projectionDomainMap(prefix, semanticIds);
  const direct = domainMap.get(value);
  if (direct !== undefined) return direct;
  const canonical = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  const live = domainMap.get(canonical);
  if (live !== undefined) return live;
  // Removed/lost entities keep their LAST-KNOWN semantic handle for content
  // that must NAME them (mutation result scalars) — resolution stays dead.
  if (prefix === "item:") return semanticIds.lost.items.get(canonical) ?? null;
  if (prefix === "weapon:") return semanticIds.lost.weapons.get(canonical) ?? null;
  return null;
}

function projectSemanticIdField(
  field: string,
  value: unknown,
  parentField: string | null,
  semanticIds: SemanticIdMap | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
  operation: string | null = null,
): { action: "keep"; value?: unknown } | { action: "drop" } | null {
  if (
    operation === "npc.query"
    && field === "valid_optional_evidence_refs"
    && declaredIdentityDisposition(operation, field) === "semantic"
    && Array.isArray(value)
  ) {
    const members: string[] = [];
    for (const entry of value) {
      if (typeof entry === "string" && isNpcFactEvidenceRef(entry)) {
        members.push(entry);
      } else if (typeof entry === "string") {
        diagnostics?.unmapped.push({
          field,
          parentField,
          domain: "evidence",
        });
      }
    }
    return { action: "keep", value: members };
  }
  if (semanticIds === null) return null;
  const lostDomain = LOST_ID_ARRAY_FIELDS.get(field);
  if (lostDomain !== undefined && Array.isArray(value)) {
    const lostMap = semanticIds.lost[lostDomain];
    const members: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") continue;
      const handle = lostMap.get(entry)
        ?? projectSemanticIdValue(`${lostDomain === "weapons" ? "weapon" : "item"}:`, entry, semanticIds);
      if (handle === null) {
        diagnostics?.unmapped.push({
          field,
          parentField,
          domain: lostDomain === "weapons" ? "weapon" : "item",
        });
        continue;
      }
      members.push(handle);
    }
    return { action: "keep", value: members };
  }
  const scalarPrefix = SEMANTIC_ID_SCALAR_FIELDS.get(field);
  if (scalarPrefix !== undefined && typeof value === "string") {
    const handle = projectSemanticIdValue(scalarPrefix, value, semanticIds);
    if (handle === null) {
      diagnostics?.unmapped.push({
        field,
        parentField,
        domain: scalarPrefix.replace(/:$/, ""),
      });
      return { action: "drop" };
    }
    return { action: "keep", value: handle };
  }
  const arrayPrefix = SEMANTIC_ID_ARRAY_FIELDS.get(field);
  if (arrayPrefix !== undefined && Array.isArray(value)) {
    const members: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") continue;
      const handle = projectSemanticIdValue(arrayPrefix, entry, semanticIds);
      if (handle !== null) {
        members.push(handle);
        continue;
      }
      // Non-registry members survive only when they carry an approved
      // structured namespace (`state:`-family refs); bare members are
      // canonical identities and drop with a bounded diagnostic when
      // unregistered (the value is never echoed).
      if (
        !entry.startsWith(arrayPrefix)
        && isNamespacedSemantic(entry, APPROVED_SEMANTIC_NAMESPACES)
      ) {
        members.push(entry);
        continue;
      }
      diagnostics?.unmapped.push({
        field,
        parentField,
        domain: arrayPrefix.replace(/:$/, ""),
      });
    }
    return { action: "keep", value: members };
  }
  // `source_effect_id` carries either a registry roll/effect handle or a
  // structured non-registry semantic ref (`state:`/`rule:`/`check:`/
  // `narration_contract:`); the former must map, the latter passes, and
  // bare unregistered canonical ids drop with a diagnostic.
  if (field === "source_effect_id" && typeof value === "string") {
    const handle = projectSemanticIdValue("roll:", value, semanticIds)
      ?? projectSemanticIdValue("effect:", value, semanticIds);
    if (handle !== null) return { action: "keep", value: handle };
    if (isNamespacedSemantic(value, APPROVED_SEMANTIC_NAMESPACES)) return null;
    diagnostics?.unmapped.push({ field, parentField, domain: "effect" });
    return { action: "drop" };
  }
  return null;
}

/**
 * Obligation-shaped values (`roll:<canonical>`) under obligation/coverage
 * fields: mapped through the observed semantic roll handles.
 */
function projectObligationValue(
  field: string,
  value: unknown,
  parentField: string | null,
  semanticIds: SemanticIdMap | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
): { action: "keep"; value?: unknown } | { action: "drop" } | null {
  if (semanticIds === null) return null;
  const obligationField = field === "obligation_id"
    || field === "obligation_ids"
    || field === "required_obligation_ids"
    || (field === "source_id"
      && (parentField === "obligation" || parentField === "obligations"));
  if (!obligationField) return null;
  if (Array.isArray(value)) {
    const members: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") continue;
      const handle = projectSemanticIdValue("roll:", entry, semanticIds);
      if (handle === null) {
        diagnostics?.unmapped.push({ field, parentField, domain: "roll" });
        continue;
      }
      members.push(handle);
    }
    return { action: "keep", value: members };
  }
  if (typeof value !== "string") return null;
  const handle = projectSemanticIdValue("roll:", value, semanticIds);
  if (handle === null) {
    diagnostics?.unmapped.push({ field, parentField, domain: "roll" });
    return { action: "drop" };
  }
  return { action: "keep", value: handle };
}

// ─── Structured provenance projection (source_refs family) ───
//
// `source_refs`-family fields carry source-bound provenance. The closed
// projector keeps exactly the approved semantic forms — `pdf_index-<ordinal>`
// page handles and structured semantic records — and drops opaque archive,
// hash, UUID, and random-string members. Host `details` keep the exact mixed
// list.

const stringSet = (values: readonly string[]): ReadonlySet<string> => new Set(values);

const PROVENANCE_FIELD = /(?:^|_)source_refs$/;
const PDF_PAGE_REF = /^pdf_index-\d+$/;
const PROVENANCE_SOURCE_NAMESPACES = stringSet(["pdf:", "module:", "source:", "handout:"]);

function projectProvenanceMember(member: unknown): unknown {
  if (typeof member === "string") {
    return PDF_PAGE_REF.test(member) ? member : null;
  }
  if (!isPlainObject(member)) return null;
  if (
    typeof member.source_id !== "string"
    || !isNamespacedSemantic(member.source_id, PROVENANCE_SOURCE_NAMESPACES)
  ) {
    // A record without an explicit semantic provenance namespace (bare
    // slugs included) is opaque provenance.
    return null;
  }
  const projectedMember: Record<string, unknown> = { source_id: member.source_id };
  if (Number.isInteger(member.pdf_index) && (member.pdf_index as number) >= 0) {
    projectedMember.pdf_index = member.pdf_index;
  }
  if (typeof member.page_ref === "string" && PDF_PAGE_REF.test(member.page_ref)) {
    projectedMember.page_ref = member.page_ref;
  }
  if (Number.isInteger(member.printed_page) && (member.printed_page as number) >= 0) {
    projectedMember.printed_page = member.printed_page;
  }
  // grep_anchors (and every other archive/hash/cache/random member field) is
  // host-only; the exact original record stays in details.
  return projectedMember;
}

function projectProvenanceRefs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(projectProvenanceMember)
      .filter((member) => member !== null);
  }
  return projectProvenanceMember(value);
}

/**
 * Structured recursive model-content sanitizer: drops wire/integrity/cache/
 * archive/job/packet/receipt identity fields and rewrites current-entity
 * references to semantic handles. Semantic substance passes unchanged.
 * Operation-aware: identity/integrity-bearing paths are judged against the
 * operation's declared projection registry — undeclared paths fail closed
 * with exact path diagnostics regardless of their value shape.
 */
export function stripOpaqueModelIdentity(
  value: unknown,
  parentField: string | null = null,
  semanticIds: SemanticIdMap | null = null,
  diagnostics: ProjectionIdentityDiagnostics | null = null,
  operation: string | null = null,
  fieldPath = "",
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      stripOpaqueModelIdentity(entry, parentField, semanticIds, diagnostics, operation, fieldPath)
    );
  }
  if (!isPlainObject(value)) return value;
  const projected: Record<string, unknown> = {};
  for (const [field, child] of Object.entries(value)) {
    const childPath = fieldPath ? `${fieldPath}.${field}` : field;
    if (DENIED_IDENTITY_FIELDS.has(field)) continue;
    if (declaredIdentityDisposition(operation, field) === "host_only") continue;
    if (isIntegrityFieldName(field)) {
      // Integrity evidence is host-only. A field the operation DECLARED is
      // intentionally details-only (silent strip); an UNDECLARED integrity
      // field is unknown evidence — it fails closed with a bounded
      // diagnostic instead of being silently deleted.
      if (declaredIdentityDisposition(operation, field) !== "integrity") {
        diagnostics?.unmapped.push({
          field,
          parentField,
          domain: "integrity",
          path: childPath,
        });
      }
      continue;
    }
    if (isStringRevisionField(field) && typeof child === "string") continue;
    const semanticId = projectSemanticIdField(
      field,
      child,
      parentField,
      semanticIds,
      diagnostics,
      operation,
    )
      ?? projectObligationValue(field, child, parentField, semanticIds, diagnostics);
    if (semanticId !== null) {
      if (semanticId.action === "drop") continue;
      // Semantic handles are already model-safe; still recurse for members.
      projected[field] = stripOpaqueModelIdentity(
        semanticId.value,
        field,
        semanticIds,
        diagnostics,
        operation,
        childPath,
      );
      continue;
    }
    if (PROVENANCE_FIELD.test(field)) {
      // Closed provenance projector: approved semantic members only; the
      // exact mixed list stays host-side in details.
      projected[field] = projectProvenanceRefs(child);
      continue;
    }
    const handle = projectEntityHandleValue(field, child, parentField);
    if (handle.action === "drop") continue;
    const rewritten = handle.action === "keep" && handle.value !== undefined;
    const replacement = rewritten ? handle.value : child;
    // Unknown-identity discovery: any identity/integrity-bearing field the
    // explicit projectors above declined must be DECLARED for this
    // operation AND pass the closed semantic grammar — absence of a
    // declaration is never a grammar pass, and a declaration never exempts
    // the value from the grammar. Host-rewritten current-entity handles are
    // themselves the closed projector output and carry no model-authored
    // identity, so they skip only the declaration gate.
    const discovered = projectDiscoveredIdentityField(
      field,
      replacement,
      field,
      diagnostics,
      operation,
      childPath,
      rewritten,
    );
    if (discovered !== null) {
      if (discovered.action === "drop") continue;
      projected[field] = stripOpaqueModelIdentity(
        discovered.value,
        field,
        semanticIds,
        diagnostics,
        operation,
        childPath,
      );
      continue;
    }
    projected[field] = stripOpaqueModelIdentity(
      replacement,
      field,
      semanticIds,
      diagnostics,
      operation,
      childPath,
    );
  }
  return projected;
}

/**
 * Model-visible hints are Pi-authored from structured envelope fields only.
 * Canonical hint prose is never parsed, matched, or relayed — it may embed
 * opaque transport tokens, and fixed-text parsing could not survive template
 * drift. Operations without a structured derivation receive no hints.
 */
const RULES_PUSH_HINT =
  "failed: the player may push this roll with a changed method and an "
  + "announced consequence (rules.push)";
const OPENING_DELIVERY_HINT =
  "deliver data.text exactly; its authoritative opening-time anchor and "
  + "deterministic public first-impression block are canonical and must not "
  + "be contradicted, recomputed, rewritten, or duplicated";
const REVIEW_GUIDANCE_HINTS = [
  "findings are advisory; the KP decides whether and how to revise them",
  "bind every authorized PC proposition as an agency_claim in turn.finalize",
];
const FINALIZE_DELIVERY_HINTS = [
  "echo rendered_text exactly; direct-host output is contract-invalid if any "
    + "text or number is changed",
  "a narration-only repair uses the same settled journal and never reruns "
    + "rules or state",
];

function deriveModelVisibleHints(
  operation: string | null | undefined,
  envelope: Record<string, unknown>,
): string[] {
  const data = isPlainObject(envelope.data) ? envelope.data : null;
  if (operation === "rules.roll" && data?.passed === false) {
    return [RULES_PUSH_HINT];
  }
  if (
    operation === "evidence.table_opening"
    && data !== null
    && typeof data.text === "string"
  ) {
    return [OPENING_DELIVERY_HINT];
  }
  if (operation === "narration.review" && envelope.ok === true) {
    return [...REVIEW_GUIDANCE_HINTS];
  }
  if (operation === "turn.finalize" && envelope.ok === true) {
    return [...FINALIZE_DELIVERY_HINTS];
  }
  return [];
}

/** Envelope-level host-only fields: transport metadata and host checkpoints. */
const ENVELOPE_HOST_ONLY_FIELDS: ReadonlySet<string> = new Set([
  "wire",
  "continuation",
  "cache",
]);

function sanitizeEnvelopeBranch(
  value: unknown,
  semanticIds: SemanticIdMap | null = null,
  diagnostics: ProjectionIdentityDiagnostics | null = null,
  operation: string | null = null,
): unknown {
  return stripOpaqueModelIdentity(value, null, semanticIds, diagnostics, operation);
}

/**
 * Structured semantic view of `turn.output_context`: obligations, visible
 * mechanics, guidance, and draft instructions only. Turn/source/revision/
 * journal/review/integrity identities are hidden here and retained in host
 * state (`retainedOutputContextFacts`).
 */
const OUTPUT_CONTEXT_KEPT_FIELDS = [
  "schema_version",
  "turn_number",
  "obligations",
  "required_obligation_ids",
  "source_roll_ids",
  "mechanics_summary",
  "missing_substantive_effects",
  "pending_modifier_consumptions",
  "composition_mode",
  "placement_segment_types",
  "npc_performance_constraints",
  "candidate_factors",
  "pending_narration_draft_status",
] as const;

function projectOutputContextContractProjection(data: Record<string, unknown>): unknown {
  const raw = isPlainObject(data.contract_projection)
    ? data.contract_projection
    : {};
  const narrowed: Record<string, unknown> = {};
  for (const field of [
    "narration_budget",
    "control_overrides",
    "agency_review_required",
    "agency_authority",
  ]) {
    if (field in raw) narrowed[field] = raw[field];
  }
  return stripOpaqueModelIdentity(narrowed);
}

function projectOperationDescriptor(
  card: unknown,
  semanticIds: SemanticIdMap | null = null,
  diagnostics: ProjectionIdentityDiagnostics | null = null,
): Record<string, unknown> {
  const source = isPlainObject(card) ? card : {};
  const operation = typeof source.operation === "string" ? source.operation : "";
  const hostOwned = new Set(
    (HOST_OWNED_FIELDS as Record<string, readonly string[] | undefined>)[operation] ?? [],
  );
  const listed = Array.isArray(source.missing_arguments)
    ? source.missing_arguments.filter((entry): entry is string => typeof entry === "string")
    : [];
  const prefilled = isPlainObject(source.prefilled_arguments)
    ? Object.keys(source.prefilled_arguments)
    : [];
  const descriptor: Record<string, unknown> = {};
  for (const field of ["operation", "invoke_via", "authority", "hard_gate", "hard_gate_scope"]) {
    if (field in source) descriptor[field] = source[field];
  }
  descriptor.missing_model_arguments = listed.filter((field) => !hostOwned.has(field));
  descriptor.host_bound_auto_attached_arguments = [
    ...new Set([...listed.filter((field) => hostOwned.has(field)), ...prefilled]),
  ].sort();
  if (isPlainObject(source.coverage_contract)) {
    descriptor.coverage_contract = stripOpaqueModelIdentity(
      source.coverage_contract,
      null,
      semanticIds,
      diagnostics,
    );
  }
  return descriptor;
}

function projectAdoptionOperation(card: unknown): Record<string, unknown> {
  const source = isPlainObject(card) ? card : {};
  const descriptor: Record<string, unknown> = {};
  for (const field of ["operation", "invoke_via", "authority", "hard_gate"]) {
    if (field in source) descriptor[field] = source[field];
  }
  descriptor.semantic_identity_handles = {
    advice_id: CURRENT_ADVICE_HANDLE,
    candidate_ref: CURRENT_CANDIDATE_HANDLE,
  };
  descriptor.host_restored_identity_arguments = [
    "advisory_uptake.advice_id",
    "advisory_uptake.candidate_ref",
  ];
  return descriptor;
}

/**
 * Settle views are closed field allowlists: any PRESENT identity/integrity
 * key the view does not project is diagnosed (bounded failure) instead of
 * being silently excluded from content.
 */
const SETTLE_SCAN_IDENTITY_NAME =
  /(^|_)(id|ids|ref|refs)$|sha256|digest|hash|integrity/i;

function diagnoseUnprojectedIdentityKeys(
  operation: string,
  data: Record<string, unknown>,
  projectedKeys: ReadonlySet<string>,
  diagnostics: ProjectionIdentityDiagnostics | null,
): void {
  if (diagnostics === null) return;
  // Host-owned and never-model-authored identity is excluded from settle
  // views BY DESIGN (host-bound); integrity-named fields are machine-only
  // ONLY when THIS operation declared them. The scan flags UNKNOWN identity
  // and integrity keys those structured boundaries do not account for —
  // never a globally classified field name.
  const declarations = OPERATION_IDENTITY_DECLARATIONS.get(operation);
  const known = new Set([
    ...projectedKeys,
    ...RAW_NEVER_MODEL_AUTHORED_FIELDS,
    ...((HOST_OWNED_FIELDS as Record<string, readonly string[] | undefined>)[operation] ?? []),
    ...DENIED_IDENTITY_FIELDS,
    ...(declarations?.integrity ?? []),
  ]);
  for (const [field, value] of Object.entries(data)) {
    if (known.has(field)) continue;
    const integrityNamed = INTEGRITY_FIELD_NAME.test(field);
    if (!integrityNamed && !SETTLE_SCAN_IDENTITY_NAME.test(field)) continue;
    // Undeclared identity/integrity evidence on THIS operation is diagnosed
    // like any other unmappable identity; operation-declared host integrity
    // stays classified in `known` and silently details-only.
    if (typeof value !== "string" || !value) continue;
    diagnostics.unmapped.push({
      field,
      parentField: null,
      domain: integrityNamed ? "integrity" : "unknown",
    });
  }
}

function projectOutputContextData(
  data: Record<string, unknown>,
  semanticIds: SemanticIdMap | null = null,
  diagnostics: ProjectionIdentityDiagnostics | null = null,
): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const field of OUTPUT_CONTEXT_KEPT_FIELDS) {
    if (field in data) view[field] = data[field];
  }
  diagnoseUnprojectedIdentityKeys(
    "turn.output_context",
    data,
    new Set(OUTPUT_CONTEXT_KEPT_FIELDS),
    diagnostics,
  );
  const projected = stripOpaqueModelIdentity(
    view,
    null,
    semanticIds,
    diagnostics,
    "turn.output_context",
  ) as Record<string, unknown>;
  projected.contract_projection = projectOutputContextContractProjection(data);
  if (data.agency_review_operation !== undefined) {
    projected.agency_review_operation = projectOperationDescriptor(
      data.agency_review_operation,
      semanticIds,
      diagnostics,
    );
  }
  if (data.finalize_operation !== undefined) {
    projected.finalize_operation = projectOperationDescriptor(
      data.finalize_operation,
      semanticIds,
      diagnostics,
    );
  }
  if (data.full_projection_operation !== undefined) {
    projected.full_projection_operation = stripOpaqueModelIdentity(
      data.full_projection_operation,
    );
  }
  if (data.narrative_opportunity !== undefined) {
    const raw = isPlainObject(data.narrative_opportunity)
      ? data.narrative_opportunity
      : {};
    const kept: Record<string, unknown> = {};
    for (const field of ["schema_version", "authority", "hard_gate", "reason", "candidate"]) {
      if (field in raw) kept[field] = raw[field];
    }
    const projectedOpportunity = stripOpaqueModelIdentity(
      kept,
      null,
      semanticIds,
      diagnostics,
      "turn.output_context",
    ) as Record<string, unknown>;
    if (typeof raw.advice_id === "string") {
      projectedOpportunity.advice_id = CURRENT_ADVICE_HANDLE;
    }
    if (typeof raw.candidate_ref === "string") {
      projectedOpportunity.candidate_ref = CURRENT_CANDIDATE_HANDLE;
    }
    if (raw.adoption_operation !== undefined) {
      projectedOpportunity.adoption_operation = projectAdoptionOperation(
        raw.adoption_operation,
      );
    }
    projected.narrative_opportunity = projectedOpportunity;
  }
  return projected;
}

/**
 * Structured semantic view of a successful `narration.review`: accepted/
 * revision guidance only. Review/compiler/draft hashes and receipt identities
 * stay host-internal.
 */
const REVIEW_KEPT_FIELDS = [
  "schema_version",
  "visibility",
  "authority",
  "hard_gate",
  "agency_hard_gate",
  "state_authority_hard_gate",
  "findings",
  "agency_gate",
  "state_authority_review",
  "state_claim_review_disagreement",
  "state_authority_gate",
  "recommendation",
  "revision",
] as const;

/**
 * Structured semantic view of a successful `turn.finalize`: rendered text,
 * visible mechanics (embedded in the rendered text), and semantic status
 * only. Exact receipt/digest identity stays in host-only `details`.
 */
function projectFinalizeData(
  data: Record<string, unknown>,
  diagnostics: ProjectionIdentityDiagnostics | null = null,
): Record<string, unknown> {
  diagnoseUnprojectedIdentityKeys(
    "turn.finalize",
    data,
    new Set(["schema_version", "status", "accepted_revision", "rendered_text"]),
    diagnostics,
  );
  const view: Record<string, unknown> = {
    schema_version: data.schema_version,
    status: "finalized",
    ...(Number.isInteger(data.accepted_revision)
      ? { accepted_revision: data.accepted_revision }
      : {}),
    ...(typeof data.rendered_text === "string"
      ? { rendered_text: data.rendered_text }
      : {}),
  };
  const finalizeView: Record<string, unknown> = stripOpaqueModelIdentity(
    view,
    null,
    null,
    diagnostics,
    "turn.finalize",
  ) as Record<string, unknown>;
  return finalizeView;
}

/**
 * Project the canonical scene wire view through its own closed identity
 * contract. The same projector is used for a direct `scene.context` result
 * and for the identical sub-document embedded by `session.resume`.
 */
function projectSceneContextData(
  data: Record<string, unknown>,
  semanticIds: SemanticIdMap | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
): Record<string, unknown> {
  const view: Record<string, unknown> = { ...data };
  if (isPlainObject(data.exit_operation_template)) {
    const descriptor = projectOperationDescriptor(
      data.exit_operation_template,
      semanticIds,
      diagnostics,
    );
    const argumentBinding = isPlainObject(
      data.exit_operation_template.argument_binding,
    )
      ? data.exit_operation_template.argument_binding
      : null;
    if (
      argumentBinding !== null
      && typeof argumentBinding.scene_id === "string"
    ) {
      // The canonical card names this host-authored instruction `scene_id`,
      // but its value is prose ("copy selected exit destination"), not an
      // identifier for the model to relay. Preserve the guidance under a
      // non-identity model-view name instead of weakening the ID grammar.
      descriptor.destination_binding = argumentBinding.scene_id;
    }
    view.exit_operation_template = descriptor;
  }
  return sanitizeEnvelopeBranch(
    view,
    semanticIds,
    diagnostics,
    "scene.context",
  ) as Record<string, unknown>;
}

const NPC_REACTION_KEPT_FIELDS = [
  "schema_version",
  "npc_display_name",
  "app",
  "credit_rating",
  "governing_attribute",
  "governing_value",
  "roll_id",
  "required_level",
  "achieved_level",
  "outcome",
  "passed",
  "surplus_levels",
  "reaction_tier",
  "disposition",
  "context",
] as const;

const NPC_REACTION_ROLL_KEPT_FIELDS = [
  "roll_id",
  "kind",
  "npc_display_name",
  "display_skill",
  "app",
  "credit_rating",
  "governing_attribute",
  "governing_value",
  "base_target",
  "target",
  "required_level",
  "difficulty",
  "required_target",
  "effective_target",
  "achieved_level",
  "passed",
  "success",
  "surplus_levels",
  "outcome",
  "bonus",
  "penalty",
  "roll",
  "unmodified_roll",
  "tens_values",
  "units",
  "reaction_tier",
  "visibility",
] as const;

/** Strict model-visible evidence handle emitted by npc.query social cards. */
function isNpcFactEvidenceRef(value: string): boolean {
  const match = /^npc_fact:([^/]+)\/([^/]+)$/.exec(value);
  return match !== null
    && isMultiTokenSlug(match[1])
    && isMultiTokenSlug(match[2]);
}

/**
 * Public first-impression mechanics plus one executable semantic engagement
 * card. Receipt/run/hash/source identities stay host-side; roll ids are
 * projected through the live semantic registry and restored on later calls.
 */
function projectNpcReactionData(
  data: Record<string, unknown>,
  semanticIds: SemanticIdMap | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const field of NPC_REACTION_KEPT_FIELDS) {
    if (field in data) view[field] = data[field];
  }
  const rollRecord = isPlainObject(data.roll_record)
    ? data.roll_record
    : null;
  if (rollRecord !== null) {
    const rollView: Record<string, unknown> = {};
    for (const field of NPC_REACTION_ROLL_KEPT_FIELDS) {
      if (field in rollRecord) rollView[field] = rollRecord[field];
    }
    view.roll_record = rollView;
  }
  if (isPlainObject(data.record_engagement_operation)) {
    view.record_engagement_operation = projectOperationDescriptor(
      data.record_engagement_operation,
      semanticIds,
      diagnostics,
    );
  }
  return sanitizeEnvelopeBranch(
    view,
    semanticIds,
    diagnostics,
    "npc.reaction",
  ) as Record<string, unknown>;
}

/** Campaign write acknowledgement without machine event/receipt identity. */
function projectNpcEngagementData(
  data: Record<string, unknown>,
  semanticIds: SemanticIdMap | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const field of [
    "schema_version", "event_type", "producer", "interaction_kind",
    "first_contact", "interaction_label", "route_completion",
  ]) {
    if (field in data) view[field] = data[field];
  }
  const effect = isPlainObject(data.context_effect)
    ? data.context_effect
    : null;
  if (effect !== null) {
    view.context_effect = Object.fromEntries(
      [
        "observable_manner", "causal_explanation", "boundary_preserved",
        "opportunity_or_friction",
      ].filter((field) => field in effect).map((field) => [field, effect[field]]),
    );
  }
  const binding = isPlainObject(data.identity_binding)
    ? data.identity_binding
    : null;
  if (binding !== null) {
    view.identity_binding = Object.fromEntries(
      [
        "status", "authored_identity_attested", "coverage_eligible", "reasons",
      ].filter((field) => field in binding).map((field) => [field, binding[field]]),
    );
  }
  return sanitizeEnvelopeBranch(
    view,
    semanticIds,
    diagnostics,
    "state.record_npc_engagement",
  ) as Record<string, unknown>;
}

/** Registered handout delivery without transport presentation identity. */
function projectHandoutDeliveryData(
  data: Record<string, unknown>,
  semanticIds: SemanticIdMap | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const field of [
    "asset_id", "delivered", "newly_delivered", "already_delivered",
    "delivered_total",
  ]) {
    if (field in data) view[field] = data[field];
  }
  const card = isPlainObject(data.card) ? data.card : null;
  if (card !== null) {
    const cardView: Record<string, unknown> = {};
    for (const field of [
      "asset_id", "kind", "content_origin", "title", "summary",
      "when_to_deliver", "text", "authored_text", "localized_text",
      "image_ref", "source_refs", "player_visible", "delivered", "secret",
    ]) {
      if (field in card) cardView[field] = card[field];
    }
    view.card = cardView;
  }
  return sanitizeEnvelopeBranch(
    view,
    semanticIds,
    diagnostics,
    "state.deliver_handout",
  ) as Record<string, unknown>;
}

/**
 * The single post-observer model-content projection for canonical envelopes.
 * Operation-aware for module.context / scene.context / session.resume /
 * turn.output_context / narration.review / turn.finalize; every other
 * canonical family uses the structured recursive sanitizer.
 */
export function projectModelVisibleCanonicalResult(
  operation: string | null | undefined,
  envelope: Record<string, unknown>,
  semanticIds: SemanticIdMap | null = null,
  diagnostics: ProjectionIdentityDiagnostics | null = null,
): Record<string, unknown> {
  if (operation === "module.context") {
    const moduleProjection = projectModuleContextResultForModel(envelope);
    return {
      ...moduleProjection,
      warnings: [],
      hints: [],
    };
  }
  const projected: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(envelope)) {
    if (ENVELOPE_HOST_ONLY_FIELDS.has(field)) continue;
    projected[field] = value;
  }
  const data = isPlainObject(projected.data) ? projected.data : null;
  const operationName = typeof operation === "string" ? operation : null;
  if (data !== null) {
    if (operation === "scene.context") {
      projected.data = projectSceneContextData(data, semanticIds, diagnostics);
    } else if (operation === "npc.reaction") {
      projected.data = projectNpcReactionData(data, semanticIds, diagnostics);
    } else if (operation === "state.record_npc_engagement") {
      projected.data = projectNpcEngagementData(data, semanticIds, diagnostics);
    } else if (operation === "state.deliver_handout") {
      projected.data = projectHandoutDeliveryData(data, semanticIds, diagnostics);
    } else if (operation === "session.resume") {
      const sceneContext = isPlainObject(data.scene_context)
        ? data.scene_context
        : null;
      const resumeData: Record<string, unknown> = { ...data };
      delete resumeData.scene_context;
      const resumeView = sanitizeEnvelopeBranch(
        resumeData,
        semanticIds,
        diagnostics,
        operationName,
      ) as Record<string, unknown>;
      if (sceneContext !== null) {
        resumeView.scene_context = projectSceneContextData(
          sceneContext,
          semanticIds,
          diagnostics,
        );
      }
      projected.data = resumeView;
    } else if (operation === "turn.output_context") {
      projected.data = projectOutputContextData(data, semanticIds, diagnostics);
    } else if (
      operation === "turn.finalize"
      && projected.ok === true
    ) {
      projected.data = projectFinalizeData(data, diagnostics);
    } else if (
      operation === "narration.review"
      && projected.ok === true
    ) {
      const view: Record<string, unknown> = {};
      for (const field of REVIEW_KEPT_FIELDS) {
        if (field in data) view[field] = data[field];
      }
      diagnoseUnprojectedIdentityKeys(
        "narration.review",
        data,
        new Set(REVIEW_KEPT_FIELDS),
        diagnostics,
      );
      projected.data = stripOpaqueModelIdentity(
        view,
        null,
        semanticIds,
        diagnostics,
        operationName,
      );
    } else {
      projected.data = sanitizeEnvelopeBranch(data, semanticIds, diagnostics, operationName);
    }
  }
  if (projected.error !== undefined) {
    projected.error = sanitizeEnvelopeBranch(
      projected.error,
      semanticIds,
      diagnostics,
      operationName,
    );
  }
  // Hints are Pi-authored from structured fields; canonical hint prose is
  // never parsed or relayed.
  projected.hints = deriveModelVisibleHints(operation, envelope);
  // Canonical warning prose is omitted under the same no-prose policy as
  // hints; the exact warnings stay host-side in details.
  projected.warnings = [];
  return projected;
}

/**
 * Derive exact semantic-entity facts from one canonical result's `data`.
 * Structured extraction from closed operation/field paths; returns only the
 * fields the operation's canonical envelope actually carries.
 */
/**
 * Authoritative party/current-PC authority carried by one observation.
 * `absent` means the envelope carries no party authority at all; `empty`
 * and `ambiguous` are authoritative invalidations of any prior identity.
 */
export type SemanticPartyAuthority =
  | { kind: "absent" }
  | { kind: "empty" }
  | { kind: "ambiguous"; investigatorIds: readonly string[] }
  | { kind: "single"; investigatorId: string; pcSubjectRefs: readonly string[] };

function partyAuthorityFromIds(
  ids: readonly string[],
  pcSubjectRefs: readonly string[],
): SemanticPartyAuthority {
  if (ids.length === 0) return { kind: "empty" };
  if (ids.length === 1) {
    return {
      kind: "single",
      investigatorId: ids[0],
      pcSubjectRefs: pcSubjectRefs.length > 0
        ? pcSubjectRefs
        : [`pc:${ids[0]}`],
    };
  }
  return { kind: "ambiguous", investigatorIds: ids };
}

function collectPartyIds(scene: Record<string, unknown>): {
  present: boolean;
  ids: string[];
} {
  const ids: string[] = [];
  let present = false;
  if (Array.isArray(scene.party)) {
    present = true;
    for (const entry of scene.party) {
      if (typeof entry === "string") ids.push(entry);
    }
  }
  if (!present && Array.isArray(scene.party_investigators)) {
    present = true;
    for (const row of scene.party_investigators) {
      if (isPlainObject(row) && typeof row.investigator_id === "string") {
        ids.push(row.investigator_id);
      }
    }
  }
  return { present, ids };
}

export function deriveSemanticEntityFacts(
  operation: string,
  data: Record<string, unknown>,
): Partial<SemanticEntityFacts> & { partyAuthority?: SemanticPartyAuthority } {
  const facts: Partial<SemanticEntityFacts> & {
    partyAuthority?: SemanticPartyAuthority;
  } = {};
  if (operation === "scene.context") {
    const collected = collectPartyIds(data);
    if (collected.present) {
      facts.partyAuthority = partyAuthorityFromIds(collected.ids, collected.ids.map((id) => `pc:${id}`));
      if (facts.partyAuthority.kind === "single") {
        facts.investigatorId = facts.partyAuthority.investigatorId;
      }
    }
    return facts;
  }
  if (operation === "session.resume") {
    const sceneContext = isPlainObject(data.scene_context) ? data.scene_context : null;
    if (sceneContext !== null) {
      const collected = collectPartyIds(sceneContext);
      if (collected.present) {
        facts.partyAuthority = partyAuthorityFromIds(
          collected.ids,
          collected.ids.map((id) => `pc:${id}`),
        );
        if (facts.partyAuthority.kind === "single") {
          facts.investigatorId = facts.partyAuthority.investigatorId;
        }
      }
    }
    return facts;
  }
  if (operation === "turn.output_context") {
    const contractProjection = isPlainObject(data.contract_projection)
      ? data.contract_projection
      : null;
    const agencyAuthority = contractProjection === null
      ? null
      : isPlainObject(contractProjection.agency_authority)
        ? contractProjection.agency_authority
        : null;
    if (agencyAuthority !== null && Array.isArray(agencyAuthority.pc_subject_refs)) {
      const refs = agencyAuthority.pc_subject_refs
        .filter((entry): entry is string => typeof entry === "string");
      facts.partyAuthority = partyAuthorityFromIds(
        refs.map((ref) => (ref.startsWith("pc:") ? ref.slice("pc:".length) : ref)),
        refs,
      );
      if (facts.partyAuthority.kind === "single") {
        facts.pcSubjectRefs = refs;
        facts.investigatorId = facts.partyAuthority.investigatorId;
      }
    }
    if (
      contractProjection !== null
      && isPlainObject(contractProjection.player_input)
      && typeof contractProjection.player_input.source_ref === "string"
    ) {
      facts.playerInputSourceRef = contractProjection.player_input.source_ref;
    }
  }
  if (operation === "turn.output_context" || operation === "actions.advise") {
    const opportunity = isPlainObject(data.narrative_opportunity)
      ? data.narrative_opportunity
      : null;
    if (opportunity !== null) {
      if (typeof opportunity.advice_id === "string") {
        facts.advisoryAdviceId = opportunity.advice_id;
      }
      if (typeof opportunity.candidate_ref === "string") {
        facts.advisoryCandidateRef = opportunity.candidate_ref;
      }
    }
  }
  return facts;
}

export type SemanticHandleRestoreResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; code: string; message: string };

// ─── Closed semantic-identity grammar for model-authored identity fields ───
//
// Every model-authored identifier must be meaning-bearing: lowercase/word
// tokens joined by separators, stable and human-readable. UUID shapes, hex
// digests, and long random alnum tokens are opaque and fail closed before
// transport without echo. `pi-…` decision ids are the host-generated semantic
// decision namespace (machine-attached identity) and are exempt.

/** Model-authored identity fields under the closed grammar, at any depth. */
const GRAMMAR_IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  "claim_id",
  "source_effect_id",
  "handout_id",
  "clue_id",
  "npc_id",
  "scene_id",
  "item_id",
  "obligation_id",
]);

const isGrammarIdentityField = (field: string): boolean =>
  GRAMMAR_IDENTITY_FIELDS.has(field)
  || field === "decision_id"
  || field === "run_id"
  || field === "run_segment_id"
  || field === "presented_roll_ids"
  || field === "npc_ids"
  || field.endsWith("_decision_id");

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_TOKEN = /^[0-9a-f]+$/i;
const ALNUM_TOKEN = /^[0-9a-zA-Z]+$/;

/**
 * True when the value is opaque under the closed grammar: UUID-shaped, a
 * ≥16-char hex token (digest/entropy), a ≥20-char single alnum token (random
 * base62/base64 blob), digest-marked, empty, or overlong.
 */
export function violatesSemanticIdentityGrammar(value: string): boolean {
  if (!value.trim() || value.length > 256) return true;
  if (value.toLowerCase().includes("sha256:")) return true;
  if (value.startsWith("pi-")) return false;
  if (UUID_SHAPE.test(value)) return true;
  // UUID embedded inside an otherwise-semantic id is still an opaque relay.
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(value)) {
    return true;
  }
  for (const token of value.split(/[^0-9a-zA-Z]+/)) {
    if (!token) continue;
    if (token.length >= 16 && HEX_TOKEN.test(token)) return true;
    if (token.length >= 20 && ALNUM_TOKEN.test(token)) return true;
  }
  return false;
}

/**
 * Reject opaque values under the closed identity grammar, recursively over
 * model-authored identity fields (including inside coverage/claims arrays).
 * Failure messages name only the field — never the supplied value.
 */
function rejectOpaqueModelIdentity(
  container: Record<string, unknown>,
): { field: string } | null {
  const visit = (value: unknown, field: string | null): { field: string } | null => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = visit(item, field);
        if (hit !== null) return hit;
      }
      return null;
    }
    if (!isPlainObject(value)) {
      if (
        typeof value === "string"
        && field !== null
        && isGrammarIdentityField(field)
        && violatesSemanticIdentityGrammar(value)
      ) {
        return { field };
      }
      return null;
    }
    for (const [key, child] of Object.entries(value)) {
      const hit = visit(child, key);
      if (hit !== null) return hit;
    }
    return null;
  };
  return visit(container, null);
}

// ─── Raw model-identity validation (closed field/namespace grammar) ─────
//
// Runs on the RAW model payload BEFORE any host binding injection or handle
// restoration, on both typed and generic surfaces. Host-injected values are
// added only AFTER this validation, so they bypass it by provenance — never
// by a string exemption. Structured field/namespace grammar is the
// authority; UUID/digest/entropy checks are a secondary defense.

/**
 * Structured semantic slug: lowercase word/digit segments joined by ._- ;
 * CJK ideographs count as meaning-bearing segment material (zh-Hans labels).
 */
function isSemanticSlugShape(value: string): boolean {
  if (!/^[a-z0-9\u3400-\u9fff]+(?:[-._][a-z0-9\u3400-\u9fff]+)*$/.test(value)) {
    return false;
  }
  // Secondary defense: UUID/digest/high-entropy material inside a slug.
  return !violatesSemanticIdentityGrammar(value);
}

/** Multi-token structured slug: at least two meaning-bearing segments. */
function isMultiTokenSlug(value: string): boolean {
  if (!isSemanticSlugShape(value)) return false;
  return value.split(/[-._]/).length >= 2;
}

/** Model-COMPOSED ids: an explicit field prefix plus structured segments. */
function isPrefixedComposedId(
  value: string,
  prefixes: readonly string[],
): boolean {
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      const remainder = value.slice(prefix.length);
      if (isSemanticSlugShape(remainder) && remainder.length > 0) return true;
    }
  }
  return false;
}

/**
 * ECHOED canonical entity refs (scene/clue/NPC/handout/item ids and roll id
 * lists): a multi-token meaning-bearing slug or the field's explicit
 * semantic namespace. Bare single tokens (`abcd`, `foo`) are not closed.
 */
function isEchoedSemanticRef(
  value: string,
  namespaces: ReadonlySet<string>,
): boolean {
  return isMultiTokenSlug(value) || isNamespacedSemantic(value, namespaces);
}

/** Model-authored decision ids name their settling operation. */
const DECISION_ID_PREFIXES: readonly string[] = [
  "journal-",
  "roll-",
  "move-",
  "advance-time-",
  "on-enter-",
  "opening-",
  "table-opening-",
  "push-",
  "luck-",
  "development-",
  "combat-",
  "npc-",
  "recall-",
  "recovery-",
  "review-",
  "deliver-",
  "exceptional-",
  "finalize-",
  "fin-",
  "associate-",
  "accept-",
  "ask-",
  "confirm-",
  "grant-",
  "record-",
  "item-",
  "cash-",
];

/**
 * Canonical colon-form decision vocabulary ("quick-start:<campaign>:attempt-N")
 * — every segment meaning-bearing, mirroring the canonical argument pattern.
 */
function isColonFormDecisionId(value: string): boolean {
  const match = /^(quick-start|setup-complete):(.+)$/.exec(value);
  if (match === null) return false;
  const segments = match[2].split(":");
  if (segments.length < 1 || segments.length > 6) return false;
  return segments.every((segment) => isSemanticSlugShape(segment));
}

/** Canonical decision ids may carry the deterministic `:finalize` suffix. */
function isDecisionIdValue(value: string): boolean {
  if (isColonFormDecisionId(value)) return true;
  let base = value.endsWith(":finalize")
    ? value.slice(0, -":finalize".length)
    : value;
  const turnScoped = /^t[1-9][0-9]*-(.+)$/.exec(base);
  if (turnScoped !== null) base = turnScoped[1];
  return isPrefixedComposedId(base, DECISION_ID_PREFIXES);
}

function isNamespacedSemantic(
  value: string,
  namespaces: ReadonlySet<string>,
): boolean {
  const idx = value.indexOf(":");
  if (idx <= 0) return false;
  if (!namespaces.has(value.slice(0, idx + 1))) return false;
  // The namespace scopes the semantics; the remainder still needs a
  // minimal meaning-bearing form (never one-char arbitrary tokens).
  // Host-presented chains may nest colon-scoped segments (e.g.
  // `scene-route:<scene>:<kind>:<ordinal>`); every segment must be
  // meaning-bearing slug material.
  const remainder = value.slice(idx + 1);
  // CJK semantic names are often two characters (猎刀); ASCII slugs keep the
  // four-character minimum.
  const minimum = /[\u3400-\u9fff]/.test(remainder) ? 2 : 4;
  if (remainder.length < minimum) return false;
  return remainder.split(":").every((segment) => isSemanticSlugShape(segment));
}

/** Closed per-field model-input rules. Unknown namespaces never pass. */
const RAW_HANDLE_ONLY: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["investigator", stringSet([CURRENT_INVESTIGATOR_HANDLE])],
  ["subject_ref", stringSet([CURRENT_PC_SUBJECT_HANDLE])],
]);

const RAW_HANDLE_OR_NAMESPACE: ReadonlyMap<
  string,
  { handles: ReadonlySet<string>; namespaces: ReadonlySet<string> }
> = new Map([
  ["source_ref", {
    handles: stringSet([CURRENT_PLAYER_INPUT_SOURCE_HANDLE]),
    namespaces: stringSet(["narration_contract:"]),
  }],
  ["advice_id", {
    handles: stringSet([CURRENT_ADVICE_HANDLE]),
    namespaces: stringSet(["advice:", "storylet:"]),
  }],
  ["candidate_ref", {
    handles: stringSet([CURRENT_CANDIDATE_HANDLE]),
    namespaces: stringSet(["storylet-candidate:"]),
  }],
]);

/** Model-composed ids: closed field prefixes. */
const RAW_COMPOSED_FIELDS: ReadonlyMap<string, readonly string[]> = new Map([
  // `claim-` is the documented claim namespace; `agency-` is the semantic
  // claim namespace real campaigns author (attempt-02).
  ["claim_id", ["claim-", "agency-"]],
  ["run_id", ["run-"]],
  ["run_segment_id", ["run-"]],
]);

/** Echoed canonical entity refs: multi-token slug or field namespace. */
const RAW_ECHOED_FIELDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["scene_id", stringSet(["scene:"])],
  ["clue_id", stringSet(["clue:"])],
  ["clue_ids", stringSet(["clue:"])],
  ["committed_clue_ids", stringSet(["clue:"])],
  ["npc_id", stringSet(["npc:"])],
  ["npc_ids", stringSet(["npc:"])],
  ["opening_required_npc_ids", stringSet(["npc:"])],
  ["opening_required_secret_ids", stringSet(["secret:"])],
  ["handout_id", stringSet(["handout:"])],
  ["item_id", stringSet(["item:"])],
  ["weapon_id", stringSet(["weapon:", "item:"])],
  ["weapon_effect_ids", stringSet(["effect:"])],
  ["effect_id", stringSet(["effect:"])],
  ["roll_ids", stringSet(["roll:"])],
  ["presented_roll_ids", stringSet(["roll:"])],
  ["source_roll_id", stringSet(["roll:"])],
  ["source_ids", stringSet(["roll:"])],
  ["obligation_id", stringSet(["roll:"])],
  ["obligation_ids", stringSet(["roll:"])],
  ["consuming_roll_id", stringSet(["roll:"])],
  ["resolution_roll_id", stringSet(["roll:"])],
  ["source_effect_id", stringSet(["roll:", "state:", "rule:", "check:", "narration_contract:", "effect:"])],
  ["route_id", stringSet(["route:"])],
  ["route_ref", stringSet(["route:"])],
  ["campaign_id", stringSet([])],
  ["scenario_id", stringSet([])],
  ["ruleset_id", stringSet(["ruleset:"])],
  ["start_location_id", stringSet(["location:"])],
  ["location_id", stringSet(["location:"])],
  ["clock_id", stringSet(["clock:"])],
  ["flag_id", stringSet(["flag:"])],
  ["thread_id", stringSet(["thread:"])],
  ["marker_id", stringSet(["marker:"])],
  ["trigger_id", stringSet(["trigger:"])],
  ["hook_id", stringSet(["hook:"])],
  ["quest_id", stringSet(["quest:"])],
  ["insight_id", stringSet(["insight:"])],
  ["commitment_id", stringSet(["commitment:"])],
  ["promise_id", stringSet(["promise:"])],
  ["subject_id", stringSet([])],
  ["seed_ids", stringSet([])],
  ["actor_id", stringSet(["actor:", "npc:"])],
  ["caregiver_id", stringSet(["npc:", "person:"])],
  ["rescuer_id", stringSet(["npc:", "person:"])],
  ["base_weapon_id", stringSet(["weapon:", "item:"])],
  ["target_id", stringSet([])],
  ["target_npc_id", stringSet(["npc:"])],
  ["affordance_id", stringSet(["affordance:"])],
  ["matched_affordance_ids", stringSet(["affordance:"])],
  ["selected_affordance_ids", stringSet(["affordance:"])],
  ["delivery_id", stringSet(["delivery:"])],
  ["override_id", stringSet(["override:"])],
  ["trigger", stringSet([])],
  ["record_id", stringSet(["record:"])],
  ["fallback_archetype_id", stringSet(["archetype:"])],
  ["start_location", stringSet([])],
  // Canonical-generated or structured semantic refs that canonical validation
  // judges; the closed multi-token/machine-rejection grammar still applies.
  ["ending_id", stringSet(["ending:"])],
  ["evidence_ref", stringSet(["evidence:"])],
  ["evidence_refs", stringSet(["evidence:"])],
  ["feasibility_refs", stringSet(["evidence:"])],
  ["observable_fact_refs", stringSet([])],
  ["first_impression_ref", stringSet([])],
  ["price_ref", stringSet([])],
  ["social_adjudication_ref", stringSet([])],
  ["revision_event_ref", stringSet([])],
  ["dependency_ref", stringSet([])],
  ["entity_refs", stringSet([])],
  ["refs", stringSet([])],
  ["ids", stringSet([])],
  ["mechanics_ref", stringSet([])],
  ["resolution_event_ids", stringSet([])],
  ["source_event_ids", stringSet([])],
  ["notebook_entry_ids", stringSet(["notebook:"])],
  ["investigator_id", stringSet([])],
  ["investigator_ids", stringSet([])],
  ["candidate_id", stringSet(["scene-route:", "attack:", "combat-route:", "combat:", "storylet-candidate:", "advice:"])],
  // Setup-lane semantic card contract ids ("coc.opening-fast-facts.v1").
  ["contract_id", stringSet([])],
  ["item_ids", stringSet(["item:"])],
  ["lost_weapon_ids", stringSet(["weapon:"])],
  ["lost_equipment_ids", stringSet(["item:"])],
  ["route_ids", stringSet(["route:"])],
  ["route_refs", stringSet(["route:"])],
  ["source_roll_ids", stringSet(["roll:"])],
  ["substantive_effect_ids", stringSet(["effect:"])],
]);

/**
 * Machine-attached settle-path/transcript identity and workstream
 * infrastructure identity: NEVER model-authored on any surface or lane.
 * Host values reach arguments only after raw validation, by provenance;
 * model delivery access is the semantic replay lane only. There is no
 * documented relay exception anywhere.
 */
const RAW_NEVER_MODEL_AUTHORED_FIELDS: ReadonlySet<string> = new Set([
  "turn_id", "narration_review_id", "finalization_id",
  "journal_decision_id", "repair_finalization_id", "review_decision_id",
  "request_decision_id", "linked_time_decision_id",
  "settlement_snapshot_id", "entry_id", "conversation_window_id",
  "first_impression_ref",
  "identity_ref",
  // Workstream infrastructure identity: host-attached, never model-authored.
  "asset_root_id", "backlog_id", "chunk_id", "executor_id", "job_id",
  "lease_ids", "task_id", "dependency_id",
  "host_session_id", "rendered_sha256", "finalized_rendered_sha256",
  "session_id", "run_segment_id",
]);

/** Provenance-content fields: closed structured provenance member grammar. */
const RAW_PROVENANCE_FIELDS: ReadonlySet<string> = new Set([
  "source_id", "source_refs", "inspected_source_refs",
]);

/** Machine-attached namespaces are never model input on any field. */
const RAW_REJECTED_PREFIXES: readonly string[] = [
  "pi-",
  "toolbox-",
  "roll:toolbox-",
  "source-lease-",
  "ws-v1",
  "turn-v1",
  "ca-v1",
  "job-",
  "packet-",
];
/**
 * Source/effect roll-reference fields must name the model's own semantic
 * roll ids; the canonical internal toolbox roll id family stays host-side
 * and is never relayed through them. (Coverage `obligation_id` values are
 * the host-presented semantic obligation keys and are exempt — they are the
 * only join key for causal coverage.)
 */
const RAW_NO_INTERNAL_ROLL_ID_FIELDS: ReadonlySet<string> = new Set([
  "source_roll_id",
  "source_ids",
]);

const isDecisionIdField = (field: string): boolean =>
  field === "decision_id" || field.endsWith("_decision_id");

export type ModelIdentityFieldClass =
  | "composed"
  | "echoed"
  | "handle_only"
  | "handle_or_namespace"
  | "decision"
  | "provenance"
  | "never_model_authored"
  | "vocabulary"
  | "unclassified";

/**
 * Single classifier for model-schema identity fields. `never_model_authored`
 * is NOT a model-owned classification: fields in that family must be
 * projected out of every model-owned schema (host-bound), so their presence
 * in a projected schema is an inventory failure.
 */
export function modelIdentityFieldClass(field: string): ModelIdentityFieldClass {
  if (isDecisionIdField(field)) return "decision";
  if (RAW_NEVER_MODEL_AUTHORED_FIELDS.has(field)) return "never_model_authored";
  if (RAW_PROVENANCE_FIELDS.has(field)) return "provenance";
  if (RAW_VOCABULARY_FIELDS.has(field)) return "vocabulary";
  if (RAW_COMPOSED_FIELDS.has(field)) return "composed";
  if (RAW_ECHOED_FIELDS.has(field)) return "echoed";
  if (RAW_HANDLE_ONLY.has(field)) return "handle_only";
  if (RAW_HANDLE_OR_NAMESPACE.has(field)) return "handle_or_namespace";
  return "unclassified";
}

/**
 * Every field the raw model-identity grammar classifies. The schema-driven
 * inventory regression asserts any identity-bearing model-schema field is
 * classified through `modelIdentityFieldClass` — there are no open exemptions.
 */
export const RAW_IDENTITY_GRAMMAR_FIELDS: ReadonlySet<string> = new Set([
  ...RAW_COMPOSED_FIELDS.keys(),
  ...RAW_ECHOED_FIELDS.keys(),
  ...RAW_HANDLE_ONLY.keys(),
  ...RAW_HANDLE_OR_NAMESPACE.keys(),
  "decision_id",
]);

function isProvenanceMember(value: string): boolean {
  return PDF_PAGE_REF.test(value)
    || isNamespacedSemantic(value, PROVENANCE_SOURCE_NAMESPACES);
}

function rawIdentityFieldRule(
  field: string,
): ((value: string) => boolean) | null {
  if (isDecisionIdField(field)) {
    return (value) => isDecisionIdValue(value);
  }
  if (RAW_PROVENANCE_FIELDS.has(field)) {
    return (value) => isProvenanceMember(value);
  }
  if (RAW_VOCABULARY_FIELDS.has(field)) {
    return (value) => value.trim().length > 0
      && !RAW_REJECTED_PREFIXES.some((prefix) => value.startsWith(prefix))
      && !violatesSemanticIdentityGrammar(value);
  }
  const composed = RAW_COMPOSED_FIELDS.get(field);
  if (composed !== undefined) {
    return (value) => isPrefixedComposedId(value, composed);
  }
  const echoed = RAW_ECHOED_FIELDS.get(field);
  if (echoed !== undefined) {
    return (value) => isEchoedSemanticRef(value, echoed);
  }
  const handles = RAW_HANDLE_ONLY.get(field);
  if (handles !== undefined) return (value) => handles.has(value);
  const handleOrNs = RAW_HANDLE_OR_NAMESPACE.get(field);
  if (handleOrNs !== undefined) {
    return (value) => handleOrNs.handles.has(value)
      || isNamespacedSemantic(value, handleOrNs.namespaces);
  }
  return null;
}

/**
 * Canonical-defined vocabulary identity fields (e.g. the built-in "starter"
 * pregen): single-token values are legal because canonical validation owns
 * the vocabulary — but the values still reject machine namespaces/entropy.
 */
const RAW_VOCABULARY_FIELDS: ReadonlySet<string> = new Set([
  "pregen_id",
]);

/** Identity-shaped field names the machine rejection covers even when unruled. */
const IDENTITY_FIELD_NAME_SHAPE = /(^|_)(id|ids|ref|refs)$/;

const isIdentityShapedFieldName = (field: string): boolean =>
  IDENTITY_FIELD_NAME_SHAPE.test(field)
  || field === "investigator"
  || field === "trigger";

/** Machine-attached material class for diagnostics (never the value). */
function rejectMachineIdentityValue(value: string): string | null {
  const prefix = RAW_REJECTED_PREFIXES.find((candidate) =>
    value.startsWith(candidate)
  );
  if (prefix !== undefined) return `namespace ${prefix.replace(/-$/, "")}`;
  if (UUID_SHAPE.test(value)) return "uuid";
  if (violatesSemanticIdentityGrammar(value)) return "opaque token";
  return null;
}

export type RawIdentityValidationResult =
  | { ok: true }
  | { ok: false; field: string; message: string };

/**
 * Validate the RAW model payload against the closed field/namespace grammar
 * before any host injection or restoration. Model-authored `pi-*` values are
 * always rejected — that namespace is machine-attached and reaches arguments
 * only after this validation, by provenance. Failures name only the field.
 */
export function validateRawModelIdentityPayload(
  container: Record<string, unknown>,
): RawIdentityValidationResult {
  const visit = (value: unknown, field: string | null): RawIdentityValidationResult | null => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = visit(item, field);
        if (hit !== null) return hit;
      }
      return null;
    }
    if (!isPlainObject(value)) {
      if (typeof value !== "string" || field === null) return null;
      // Host-attached settle-path/transcript identity is NEVER model-authored:
      // any raw model supply rejects before host restoration, naming only the
      // field. Host values reach arguments after this gate, by provenance.
      if (RAW_NEVER_MODEL_AUTHORED_FIELDS.has(field)) {
        return {
          ok: false,
          field,
          message: `${field} is host-bound identity attached by the gateway; `
            + "it is never model-authored. Pass the semantic form instead.",
        };
      }
      const rule = rawIdentityFieldRule(field);
      if (rule === null) {
        // Unclassified identity-shaped fields still reject machine-attached
        // namespaces and entropy material before any nullable-rule pass —
        // shape-only acceptance is never a bypass.
        if (!isIdentityShapedFieldName(field)) return null;
        const machine = rejectMachineIdentityValue(value);
        if (machine !== null) {
          return {
            ok: false,
            field,
            message: `${field} uses machine-attached identity material `
              + `(${machine}), which is never model-authored; pass the `
              + "semantic form instead.",
          };
        }
        return null;
      }
      const rejectedPrefix = RAW_REJECTED_PREFIXES.find((prefix) =>
        value.startsWith(prefix)
      );
      if (rejectedPrefix !== undefined) {
        return {
          ok: false,
          field,
          message: `${field} uses the machine-attached ${rejectedPrefix.replace(/-$/, "")} `
            + "namespace or internal id family, which is never model-authored; "
            + "pass the semantic form instead.",
        };
      }
      if (!rule(value)) {
        return {
          ok: false,
          field,
          message: `${field} must use its closed semantic form: meaning-bearing `
            + "slugs, the documented handles, or the field's allowed semantic "
            + "namespaces. Arbitrary, unknown-namespace, or opaque values are rejected.",
        };
      }
      return null;
    }
    for (const [key, child] of Object.entries(value)) {
      const hit = visit(child, key);
      if (hit !== null) return hit;
    }
    return null;
  };
  const hit = visit(container, null);
  return hit ?? { ok: true };
}

function restoreSubjectRef(
  value: unknown,
  facts: SemanticEntityFacts | null,
): { ok: true; value?: unknown } | { ok: false; message: string } {
  if (typeof value !== "string") return { ok: true };
  if (value === CURRENT_PC_SUBJECT_HANDLE) {
    if (!facts || facts.pcSubjectRefs.length !== 1) {
      return {
        ok: false,
        message: (
          "subject_ref uses the semantic current-PC handle but the host has no "
          + "exact current subject binding; refresh with turn.output_context first."
        ),
      };
    }
    return { ok: true, value: facts.pcSubjectRefs[0] };
  }
  if (value.startsWith("pc:")) {
    return {
      ok: false,
      message: (
        "subject_ref must be the semantic handle pc:current-investigator; "
        + "exact PC identity is host-bound and opaque ids are not accepted."
      ),
    };
  }
  return { ok: true };
}

/**
 * Registry-backed handle resolution for one exact invocation scope
 * (session epoch + campaign + player turn). Built by the gateway from the
 * semantic identity registry; `null` results fail closed without echo.
 */
export type SemanticIdentityHandleResolver = {
  resolveRoll: (handle: string) => string | null;
  resolveEffect: (handle: string) => string | null;
  resolveItem: (handle: string) => string | null;
  resolveWeapon: (handle: string) => string | null;
  resolveRoute: (handle: string) => string | null;
};

/** Scalar fields whose entire value is a registry roll handle. */
const RESTORE_ROLL_SCALARS: ReadonlySet<string> = new Set([
  "obligation_id", "source_roll_id", "consuming_roll_id", "resolution_roll_id",
]);
/** Array fields whose prefixed members are registry roll handles. */
const RESTORE_ROLL_ARRAYS: ReadonlySet<string> = new Set([
  "roll_ids", "presented_roll_ids", "source_roll_ids", "source_ids",
  "obligation_ids", "required_obligation_ids",
]);
const RESTORE_EFFECT_ARRAYS: ReadonlySet<string> = new Set([
  "effect_ids", "weapon_effect_ids", "substantive_effect_ids",
]);
/** Array fields whose prefixed members are registry item handles. */
const RESTORE_ITEM_ARRAYS: ReadonlySet<string> = new Set([
  "item_ids", "lost_equipment_ids",
]);
const RESTORE_ROUTE_FIELDS: ReadonlySet<string> = new Set([
  "route_id", "route_ref", "route_ids", "route_refs",
]);

/**
 * Restore exact canonical entity identities from semantic handles in model
 * arguments, in place semantics: `investigator`, `agency_claims[].subject_ref`,
 * `state_authority_review.claims[].subject_ref`,
 * `agency_claims[].source_ref`, `advisory_uptake` identity handles, and the
 * observed roll/effect/item handles (`roll:<handle>`, `effect:<handle>`,
 * `item:<handle>`) on coverage, placement, and effect-reference fields.
 * Explicit opaque ids fail closed without echoing the supplied value.
 */
export function restoreSemanticEntityHandles(
  operation: string,
  args: Record<string, unknown>,
  facts: SemanticEntityFacts | null,
  resolver: SemanticIdentityHandleResolver | null = null,
): SemanticHandleRestoreResult {
  let restored: Record<string, unknown> = { ...structuredClone(args) };
  const fail = (code: string, message: string): SemanticHandleRestoreResult => ({
    ok: false,
    code,
    message,
  });
  if (Object.hasOwn(restored, "investigator")) {
    const value = restored.investigator;
    if (value === CURRENT_INVESTIGATOR_HANDLE) {
      if (!facts || !facts.investigatorId) {
        return fail(
          "semantic_entity_binding_missing",
          "investigator uses the semantic current-investigator handle but the "
            + "host has no exact party binding; call scene.context first.",
        );
      }
      restored.investigator = facts.investigatorId;
    } else if (typeof value === "string" && value.trim()) {
      return fail(
        "opaque_entity_identity",
        "investigator must be the semantic handle current-investigator; "
          + "exact investigator identity is host-bound.",
      );
    }
  }
  const claims = Array.isArray(restored.agency_claims) ? restored.agency_claims : [];
  for (const claim of claims) {
    if (!isPlainObject(claim)) continue;
    if (Object.hasOwn(claim, "subject_ref")) {
      const subject = restoreSubjectRef(claim.subject_ref, facts);
      if (!subject.ok) return fail("opaque_entity_identity", subject.message);
      if (subject.value !== undefined) claim.subject_ref = subject.value;
    }
    if (Object.hasOwn(claim, "source_ref") && typeof claim.source_ref === "string") {
      if (claim.source_ref === CURRENT_PLAYER_INPUT_SOURCE_HANDLE) {
        if (!facts || !facts.playerInputSourceRef) {
          return fail(
            "semantic_entity_binding_missing",
            "source_ref uses the semantic current player-input handle but the "
              + "host has no exact player-input binding; refresh turn.output_context first.",
          );
        }
        claim.source_ref = facts.playerInputSourceRef;
      } else if (claim.source_ref.startsWith("player_input:")) {
        return fail(
          "opaque_entity_identity",
          "source_ref must be the semantic handle player_input:current (or the "
            + "retained semantic narration_contract ref); exact player-input "
            + "source refs are host-bound.",
        );
      }
    }
  }
  const stateReview = isPlainObject(restored.state_authority_review)
    ? restored.state_authority_review
    : null;
  if (stateReview !== null && Array.isArray(stateReview.claims)) {
    for (const claim of stateReview.claims) {
      if (!isPlainObject(claim) || !Object.hasOwn(claim, "subject_ref")) continue;
      const subject = restoreSubjectRef(claim.subject_ref, facts);
      if (!subject.ok) return fail("opaque_entity_identity", subject.message);
      if (subject.value !== undefined) claim.subject_ref = subject.value;
    }
  }
  const uptake = isPlainObject(restored.advisory_uptake) ? restored.advisory_uptake : null;
  if (uptake !== null) {
    // Advisory identity namespaces: the canonical opaque identity families
    // (`storylets:<ordinal>:<hex>`, `storylet-candidate-v1:<hex>`) are
    // host-bound — the model passes the semantic handles. Any other value is
    // model-owned semantics that canonical validation judges.
    const opaqueAdvisoryRef = (value: unknown): boolean =>
      typeof value === "string"
      && (value.startsWith("storylets:") || value.startsWith("storylet-candidate-v1:"));
    if (Object.hasOwn(uptake, "advice_id")) {
      if (uptake.advice_id === CURRENT_ADVICE_HANDLE) {
        if (!facts || !facts.advisoryAdviceId) {
          return fail(
            "semantic_entity_binding_missing",
            "advice_id uses the semantic current-advice handle but the host has "
              + "no retained advisory identity; refresh turn.output_context first.",
          );
        }
        uptake.advice_id = facts.advisoryAdviceId;
      } else if (opaqueAdvisoryRef(uptake.advice_id)) {
        return fail(
          "opaque_entity_identity",
          "advice_id must be the semantic handle storylet:current-advice; "
            + "the exact advisory identity is host-bound.",
        );
      }
    }
    if (Object.hasOwn(uptake, "candidate_ref")) {
      if (uptake.candidate_ref === CURRENT_CANDIDATE_HANDLE) {
        if (!facts || !facts.advisoryCandidateRef) {
          return fail(
            "semantic_entity_binding_missing",
            "candidate_ref uses the semantic current-candidate handle but the "
              + "host has no retained advisory identity; refresh turn.output_context first.",
          );
        }
        uptake.candidate_ref = facts.advisoryCandidateRef;
      } else if (opaqueAdvisoryRef(uptake.candidate_ref)) {
        return fail(
          "opaque_entity_identity",
          "candidate_ref must be the semantic handle storylet:current-candidate; "
            + "the exact advisory identity is host-bound.",
        );
      }
    }
  }
  // Closed semantic-identity grammar applies to the model-authored payload
  // BEFORE registry restoration. Exact canonical ids attached by the host
  // after this point may contain hashes by design and must not be mistaken
  // for model-authored identity.
  const grammarViolation = rejectOpaqueModelIdentity(restored);
  if (grammarViolation !== null) {
    return fail(
      "opaque_identity_grammar",
      `${grammarViolation.field} must be a meaning-bearing semantic id; `
        + "UUIDs, hashes, and random tokens are host-bound or rejected.",
    );
  }

  // Registry-backed restoration: observed handles map back to the exact
  // canonical ids before transport, judged against the exact current
  // invocation scope. Unknown/stale/retired handles fail closed.
  if (resolver !== null) {
    // Scalar/​array classification. Roll obligation family stays STRICT (the
    // host always presents those as handles). Item/weapon/route fields are
    // PREFIX-GATED: only values presented in the domain's namespace resolve
    // through the registry; bare canonical ids pass through untouched for
    // canonical validation to judge.
    const classify = (field: string, value: string): string => {
      if (
        RESTORE_ROLL_SCALARS.has(field)
        || (RESTORE_ROLL_ARRAYS.has(field) && value.startsWith("roll:"))
        || (field === "source_effect_id" && value.startsWith("roll:"))
      ) return "roll";
      if (
        field === "effect_id"
        || (RESTORE_EFFECT_ARRAYS.has(field) && value.startsWith("effect:"))
        || (field === "source_effect_id" && value.startsWith("effect:"))
      ) return "effect";
      if (
        field === "weapon_id"
        || (field === "lost_weapon_ids" && value.startsWith("weapon:"))
      ) {
        return value.startsWith("weapon:") ? "weapon" : "";
      }
      if (
        (field === "weapon_id" || field === "base_weapon_id")
        && value.startsWith("weapon:")
      ) return "weapon";
      if (
        (field === "item_id" || (RESTORE_ITEM_ARRAYS.has(field)))
        && value.startsWith("item:")
      ) return "item";
      if (RESTORE_ROUTE_FIELDS.has(field) && value.startsWith("route:")) {
        return "route";
      }
      return "";
    };
    const restoreOne = (
      domain: "roll" | "effect" | "item" | "weapon" | "route",
      value: string,
    ): { ok: true; value: string } | { ok: false; reason: string } => {
      const resolve = domain === "roll"
        ? resolver.resolveRoll
        : domain === "effect"
        ? resolver.resolveEffect
        : domain === "item"
        ? resolver.resolveItem
        : domain === "weapon"
        ? resolver.resolveWeapon
        : resolver.resolveRoute;
      const canonical = resolve(value);
      if (canonical === null) {
        return {
          ok: false,
          reason: `unknown or no-longer-authoritative semantic ${domain} `
            + "handle; refresh the current turn context before referencing it.",
        };
      }
      return { ok: true, value: canonical };
    };
    const violation = ((): string | null => {
      const visit = (value: unknown, field: string | null): string | null => {
        if (Array.isArray(value)) {
          for (const entry of value) {
            const hit = visit(entry, field);
            if (hit !== null) return hit;
          }
          return null;
        }
        if (!isPlainObject(value)) {
          if (typeof value !== "string" || field === null) return null;
          const domain = classify(field, value);
          if (domain === "") return null;
          const restored = restoreOne(
            domain as "roll" | "effect" | "item" | "weapon" | "route",
            value,
          );
          return restored.ok ? null : restored.reason;
        }
        for (const [key, child] of Object.entries(value)) {
          const hit = visit(child, key);
          if (hit !== null) return hit;
        }
        return null;
      };
      return visit(restored, null);
    })();
    if (violation !== null) {
      return {
        ok: false,
        code: "unknown_semantic_handle",
        message: violation,
      };
    }
    const rewrite = (value: unknown, field: string | null): unknown => {
      if (Array.isArray(value)) {
        return value.map((entry) => rewrite(entry, field));
      }
      if (!isPlainObject(value)) {
        if (typeof value !== "string" || field === null) return value;
        const domain = classify(field, value);
        if (domain === "") return value;
        const restored = restoreOne(
          domain as "roll" | "effect" | "item" | "weapon" | "route",
          value,
        );
        return restored.ok ? restored.value : value;
      }
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        out[key] = rewrite(child, key);
      }
      return out;
    };
    restored = rewrite(restored, null) as Record<string, unknown>;
  }

  return { ok: true, value: restored };
}

/**
 * Presented-schema overlay: every model-fillable `investigator` argument and
 * PC `subject_ref`/player-input `source_ref` field accepts only semantic
 * handles. Exact canonical identities are host-bound at invoke time.
 */
function projectSemanticHandleSchemaOverlay(schema: JsonSchema): JsonSchema {
  const cloned = structuredClone(schema);
  if (!isPlainObject(cloned.properties)) return cloned;
  if (isPlainObject(cloned.properties.investigator)) {
    cloned.properties.investigator = {
      type: "string",
      enum: [CURRENT_INVESTIGATOR_HANDLE],
      description: (
        "Semantic handle for the current investigator; the host binds the "
        + "exact canonical identity. Opaque investigator ids are rejected."
      ),
    };
  }
  const overlaySubjectRef = (container: unknown): void => {
    if (!isPlainObject(container)) return;
    const items = isPlainObject(container.items) ? container.items : null;
    const properties = items === null ? null : isPlainObject(items.properties) ? items.properties : null;
    if (properties === null) return;
    if (isPlainObject(properties.subject_ref)) {
      properties.subject_ref = {
        type: "string",
        enum: [CURRENT_PC_SUBJECT_HANDLE],
        description: (
          "Semantic handle for the current PC subject; the host restores the "
          + "exact canonical subject ref."
        ),
      };
    }
    if (isPlainObject(properties.source_ref) && typeof properties.source_ref.type === "string") {
      properties.source_ref = {
        ...properties.source_ref,
        description: (
          "Use the semantic handle player_input:current for the current player "
            + "input (host restores the exact ref), or the retained semantic "
            + "narration_contract ref. Opaque source refs are rejected."
        ),
      };
    }
  };
  overlaySubjectRef(cloned.properties.agency_claims);
  const stateReview = isPlainObject(cloned.properties.state_authority_review)
    ? cloned.properties.state_authority_review
    : null;
  const stateReviewProperties = stateReview !== null
    && isPlainObject(stateReview.properties)
    ? stateReview.properties
    : null;
  if (stateReviewProperties !== null) {
    overlaySubjectRef(stateReviewProperties.claims);
  }
  return cloned;
}
