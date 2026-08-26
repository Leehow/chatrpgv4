/**
 * Pi-only projection between canonical operation contracts and model tools.
 *
 * The canonical archive remains authoritative. This module only removes
 * arguments that an exact, retained host binding card owns, restores those
 * arguments before the existing gateway wrapper, and adds model-facing
 * recovery metadata to an existing canonical failure envelope.
 */
import type { JsonSchema } from "./operation-contracts.ts";

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
  selection_mode?: "current_candidates" | "manual_scene";
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

export type TypedToolBindingCard =
  | StateJournalBindingCard
  | NarrationReviewBindingCard
  | TurnFinalizeBindingCard
  | SceneMoveBindingCard
  | AdvanceTimeBindingCard
  | CombatResolveBindingCard;

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

const HOST_OWNED_FIELDS: Record<TypedToolBindingCard["operation"], readonly string[]> = {
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
};

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
    const selectionMode = binding.selection_mode ?? "current_candidates";
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
  } else {
    nonEmptyString(binding.combat_revision, "combat_revision");
    nonEmptyString(binding.combat_digest, "combat_digest");
    validateCombatCandidates(binding.candidates);
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
  return {
    root: binding.root,
    campaign: binding.campaign,
    decision_id: binding.decision_id,
  };
}

function hostOwnedFields(binding: TypedToolBindingCard): string[] {
  const fields = [...HOST_OWNED_FIELDS[binding.operation]];
  if (binding.operation === "state.move_scene") {
    if ((binding.selection_mode ?? "current_candidates") === "manual_scene") {
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
    const selectionMode = valid.selection_mode ?? "current_candidates";
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
    const selectionMode = valid.selection_mode ?? "current_candidates";
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
  if (operation !== "rules.social_adjudicate") return inputSchema;
  const cloned = structuredClone(inputSchema);
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
