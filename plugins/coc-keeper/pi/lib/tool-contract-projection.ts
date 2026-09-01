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

export const REVIEWED_AGENCY_CLAIM_TYPES = [
  "voluntary_action",
  "voluntary_speech",
  "voluntary_plan",
  "voluntary_belief",
  "voluntary_trust",
  "voluntary_active_emotion",
  "forced_behavior",
  "involuntary_physiology",
] as const;

export type ReviewedAgencyClaimType = typeof REVIEWED_AGENCY_CLAIM_TYPES[number];

export type ReviewedAgencySpan = {
  /** Stable model-facing ordinal selected after an accepted review. */
  reviewed_span: string;
  /** Exact reviewed bytes; host-only and restored at invocation time. */
  exact_excerpt: string;
};

export type ReviewedAgencyAuthority = {
  /** Stable model-facing authority choice, never a canonical source id. */
  authority: string;
  claim_types: readonly ReviewedAgencyClaimType[];
  /** Exact canonical evidence below stays host-only. */
  subject_ref: string;
  source_ref: string;
  override_id: string | null;
};

export const REVIEWED_COVERAGE_FACTS_CONTRACT =
  "coc.reviewed-coverage-binding-facts.v1";

export type ReviewedCoverageBindingFacts = {
  schema_version: 1;
  contract_id: typeof REVIEWED_COVERAGE_FACTS_CONTRACT;
  settlement_snapshot_id: string;
  mechanics_bundle_sha256: string;
  obligations: readonly Record<string, unknown>[];
  public_check_source_ids: readonly string[];
  state_delta_source_ids: readonly string[];
  exceptional_effect_source_ids: readonly string[];
};

export type SemanticObligationRef = {
  /** Exact canonical finalizer join key; host-only. */
  obligation_id: string;
  /** Stable meaning-bearing model selection minted by the identity registry. */
  obligation_ref: string;
};

export type ReviewedCoverageObligation = {
  obligation_ref: string;
  /** Exact canonical finalizer join key; host-only. */
  obligation_id: string;
  source_kind: string;
  visibility: string;
  npc_display_name: string | null;
  skill: string | null;
  goal: string | null;
  outcome: string | null;
  exceptional_required: boolean;
  allowed_reviewed_spans: readonly string[];
  realization: "fictional_beat" | "concealed_no_player_visible_beat";
  placement_mode:
    | "host_safe_default_before_result"
    | "canonical_repair_if_unsafe"
    | "host_safe_default"
    | "none";
};

export type ReviewedMechanicsPlacementBinding = {
  mode: "host_safe_default";
  public_check_count: number;
  state_delta_count: number;
  exceptional_effect_count: number;
};

export type ReviewedAgencyBinding = {
  schema_version: 1;
  review_id: string;
  revision: number;
  draft_sha256: string;
  draft: string;
  spans: readonly ReviewedAgencySpan[];
  authorities: readonly ReviewedAgencyAuthority[];
  coverage_obligations: readonly ReviewedCoverageObligation[];
  mechanics_placement: ReviewedMechanicsPlacementBinding;
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
  narration_review_id: string | null;
  /** Test-only direct first-draft binding; production review path omits it. */
  direct_single_draft?: true;
  repair_finalization_id?: string;
  /**
   * Present only after a clear accepted narration.review. The model selects
   * reviewed spans and semantic authority; the host restores the frozen
   * draft and the canonical exact agency_claims object.
   */
  reviewed_agency_binding?: ReviewedAgencyBinding;
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
    allowed_defenses: readonly CombatDefenseKind[];
    target_npc_id?: never;
    affordance_id?: never;
  };

export type CombatDefenseKind =
  | "dodge"
  | "fight_back"
  | "dive_for_cover"
  | "none";

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

export type ChaseActionCandidate = {
  actor_handle: string;
  action_handle: string;
  destination_handle: string;
  /** Exact canonical command material below stays host-only. */
  actor_id: string;
  action_id: string;
  kind: "chase_move";
};

export type ChaseExecuteBindingCard = {
  schema_version: 1;
  operation: "chase.execute";
  binding_revision: string;
  root: string;
  campaign: string;
  decision_id: string;
  investigator: string;
  chase_id: string;
  chase_revision: number;
  chase_digest: string;
  candidates: readonly ChaseActionCandidate[];
};

export type SanityBoutActionCandidate = {
  action: "tick" | "end";
  kind: "bout_tick" | "bout_end";
  /** Exact executor identities are host-only and never enter model schemas. */
  decision_id: string;
  command_id: string;
};

export type SanityBoutBindingCard = {
  schema_version: 1;
  operation: "sanity.execute";
  binding_revision: string;
  root: string;
  campaign: string;
  /** Binding-card identity; the selected candidate supplies the command decision. */
  decision_id: string;
  investigator: string;
  bout_id: string;
  choice_id: string;
  source_command_id: string;
  choice_revision: number;
  candidates: readonly SanityBoutActionCandidate[];
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
  identity_ref?: string;
  first_impression_ref?: string;
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

export type SocialInteractionCandidate = {
  candidate_id: string;
  investigator: string;
  npc_id: string;
  conversation_window_id: string;
  first_impression_ref?: string;
  validated_fact_refs: readonly string[];
};

export type SocialAdjudicationBindingCard = {
  schema_version: 1;
  operation: "rules.social_adjudicate";
  binding_revision: string;
  root: string;
  campaign: string;
  decision_id: string;
  candidates: readonly SocialInteractionCandidate[];
};

export type PsychologyObserveBindingCard = {
  schema_version: 1;
  operation: "rules.psychology_observe";
  binding_revision: string;
  root: string;
  campaign: string;
  decision_id: string;
  realize_decision_id: string;
  candidates: readonly (SocialInteractionCandidate & {
    observation_revision: number;
    observer_scope: string;
  })[];
};

export type TypedToolBindingCard =
  | StateJournalBindingCard
  | NarrationReviewBindingCard
  | TurnFinalizeBindingCard
  | SceneMoveBindingCard
  | AdvanceTimeBindingCard
  | CombatResolveBindingCard
  | ChaseExecuteBindingCard
  | SanityBoutBindingCard
  | TableOpeningBindingCard
  | NpcEngagementBindingCard
  | NpcReactionRunBindingCard
  | SocialAdjudicationBindingCard
  | PsychologyObserveBindingCard;

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

export const HOST_OWNED_FIELDS: Readonly<Record<string, readonly string[]>> = {
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
    "combat_revision",
  ],
  "chase.execute": [
    "root",
    "campaign",
    "decision_id",
    "investigator",
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
    "identity_ref",
    "first_impression_ref",
    "run_id",
  ],
  "npc.reaction": [
    "root",
    "campaign",
    "investigator",
    "run_id",
  ],
  "sanity.execute": [
    "decision_id",
  ],
  "rules.sanity_check": [
    "decision_id",
  ],
  "rules.social_adjudicate": [
    "root",
    "campaign",
    "decision_id",
    "investigator",
    "npc_id",
    "conversation_window_id",
  ],
  "rules.psychology_observe": [
    "root",
    "campaign",
    "decision_id",
    "investigator",
    "npc_id",
    "conversation_window_id",
    "observation_revision",
    "observer_scope",
    "observable_fact_refs",
    "revision_event_ref",
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
    reason: "use the semantic obligation handles from turn.output_context; never copy hash or receipt ids",
    host_bound: true,
  }],
  missing_obligation: [{
    operation: "turn.finalize",
    action: "complete_causal_coverage",
    reason: "add one coverage row for every semantic obligation handle in the retained output context",
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

const REVIEWED_OBLIGATION_REF_RE =
  /^roll:[a-z0-9\u3400-\u9fff][a-z0-9\u3400-\u9fff-]{0,126}$/;

function exactUniqueStrings(
  value: unknown,
  field: string,
  maxItems = 128,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      `${field} must be a bounded string array`,
      { field },
    );
  }
  const rows = value.map((entry) => nonEmptyString(entry, field));
  if (rows.length !== new Set(rows).size) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      `${field} must not contain duplicate identities`,
      { field },
    );
  }
  return rows;
}

function validateReviewedCoverageBindingFacts(
  value: unknown,
): ReviewedCoverageBindingFacts {
  if (
    !isPlainObject(value)
    || !exactObjectKeys(value, [
      "schema_version", "contract_id", "settlement_snapshot_id",
      "mechanics_bundle_sha256", "obligations", "public_check_source_ids",
      "state_delta_source_ids", "exceptional_effect_source_ids",
    ])
    || value.schema_version !== 1
    || value.contract_id !== REVIEWED_COVERAGE_FACTS_CONTRACT
  ) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "accepted-review coverage facts use the closed v1 host contract",
      { field: "coverage_binding_facts" },
    );
  }
  nonEmptyString(
    value.settlement_snapshot_id,
    "coverage_binding_facts.settlement_snapshot_id",
  );
  const mechanicsDigest = nonEmptyString(
    value.mechanics_bundle_sha256,
    "coverage_binding_facts.mechanics_bundle_sha256",
  );
  if (!/^sha256:[0-9a-f]{64}$/.test(mechanicsDigest)) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "accepted-review coverage facts require the exact mechanics digest",
      { field: "coverage_binding_facts.mechanics_bundle_sha256" },
    );
  }
  if (!Array.isArray(value.obligations) || value.obligations.length > 64) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "accepted-review coverage facts require at most 64 obligations",
      { field: "coverage_binding_facts.obligations" },
    );
  }
  const obligations = value.obligations.map((raw, index) => {
    if (!isPlainObject(raw)) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "accepted-review coverage obligation must be structured",
        { field: `coverage_binding_facts.obligations[${index}]` },
      );
    }
    for (const field of [
      "obligation_id", "source_kind", "source_id", "visibility",
    ]) {
      nonEmptyString(
        raw[field],
        `coverage_binding_facts.obligations[${index}].${field}`,
      );
    }
    if (typeof raw.exceptional_required !== "boolean") {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "coverage obligation exceptional_required must be boolean",
        { field: `coverage_binding_facts.obligations[${index}].exceptional_required` },
      );
    }
    return structuredClone(raw);
  });
  const obligationIds = obligations.map((row) => String(row.obligation_id));
  if (obligationIds.length !== new Set(obligationIds).size) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "accepted-review coverage obligations must have unique canonical ids",
      { field: "coverage_binding_facts.obligations" },
    );
  }
  const publicCheckSourceIds = exactUniqueStrings(
    value.public_check_source_ids,
    "coverage_binding_facts.public_check_source_ids",
  );
  const obligationSourceIds = new Set(
    obligations.map((row) => String(row.source_id)),
  );
  if (publicCheckSourceIds.some((sourceId) => !obligationSourceIds.has(sourceId))) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "every public check source must belong to a retained obligation",
      { field: "coverage_binding_facts.public_check_source_ids" },
    );
  }
  return {
    schema_version: 1,
    contract_id: REVIEWED_COVERAGE_FACTS_CONTRACT,
    settlement_snapshot_id: String(value.settlement_snapshot_id),
    mechanics_bundle_sha256: mechanicsDigest,
    obligations,
    public_check_source_ids: publicCheckSourceIds,
    state_delta_source_ids: exactUniqueStrings(
      value.state_delta_source_ids,
      "coverage_binding_facts.state_delta_source_ids",
    ),
    exceptional_effect_source_ids: exactUniqueStrings(
      value.exceptional_effect_source_ids,
      "coverage_binding_facts.exceptional_effect_source_ids",
    ),
  };
}

/** Build the exact host-only coverage facts from one canonical output context. */
export function buildReviewedCoverageBindingFacts(
  value: unknown,
): ReviewedCoverageBindingFacts {
  const data = isPlainObject(value) ? value : null;
  const mechanics = data !== null && isPlainObject(data.mechanics_summary)
    ? data.mechanics_summary
    : null;
  if (data === null || mechanics === null) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "coverage binding requires one complete canonical output context",
      { field: "output_context" },
    );
  }
  const sourceIds = (
    rows: unknown,
    field: "roll_id" | "effect_id" | "event_id",
  ): string[] => {
    if (!Array.isArray(rows)) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        `mechanics_summary.${field} source rows must be an array`,
        { field: `mechanics_summary.${field}` },
      );
    }
    return rows.map((raw, index) => {
      const row = isPlainObject(raw) ? raw : null;
      const value = row?.[field];
      if (typeof value !== "string" || !value.trim()) {
        throw new ToolContractProjectionError(
          "binding_context_invalid",
          `mechanics_summary source row lacks ${field}`,
          { field: `mechanics_summary.${field}[${index}]` },
        );
      }
      return value.trim();
    }).sort();
  };
  return validateReviewedCoverageBindingFacts({
    schema_version: 1,
    contract_id: REVIEWED_COVERAGE_FACTS_CONTRACT,
    settlement_snapshot_id: data.settlement_snapshot_id,
    mechanics_bundle_sha256: data.mechanics_bundle_sha256,
    obligations: Array.isArray(data.obligations) ? data.obligations : [],
    public_check_source_ids: sourceIds(mechanics.public_check, "roll_id"),
    state_delta_source_ids: sourceIds(mechanics.state_delta, "effect_id"),
    exceptional_effect_source_ids: sourceIds(
      mechanics.exceptional_effect,
      "event_id",
    ),
  });
}

export type ReviewedAgencyBindingSource = {
  review_id: string;
  revision: number;
  draft_sha256: string;
  draft: string;
  state_authority_review: unknown;
  player_input_source_ref: string;
  agency_authority: unknown;
  control_overrides: unknown;
  coverage_binding_facts: unknown;
  semantic_obligation_refs: unknown;
};

function reviewedParagraphs(draft: string): string[] {
  return draft
    .split(/\n[\t ]*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function reviewedSentences(paragraph: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < paragraph.length; index += 1) {
    if (!"。！？!?".includes(paragraph[index])) continue;
    const sentence = paragraph.slice(start, index + 1).trim();
    if (sentence) sentences.push(sentence);
    start = index + 1;
  }
  const tail = paragraph.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function authoritySlug(value: unknown): string {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "override";
}

/**
 * Build the host-only exact binding behind the post-review semantic surface.
 * This performs only structural segmentation (review claim / sentence /
 * paragraph ordinals); it never classifies prose meaning with strings.
 */
export function buildReviewedAgencyBinding(
  source: ReviewedAgencyBindingSource,
): ReviewedAgencyBinding {
  const reviewId = nonEmptyString(source.review_id, "review_id");
  const revision = requirePositiveRevision(source.revision, "revision");
  const draftSha256 = nonEmptyString(source.draft_sha256, "draft_sha256");
  const draft = nonEmptyString(source.draft, "draft");
  const authority = isPlainObject(source.agency_authority)
    ? source.agency_authority
    : null;
  const pcSubjectRefs = authority !== null && Array.isArray(authority.pc_subject_refs)
    ? authority.pc_subject_refs.filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    )
    : [];
  if (pcSubjectRefs.length !== 1 || new Set(pcSubjectRefs).size !== 1) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "semantic accepted-review binding currently requires one exact current PC",
      { field: "agency_authority.pc_subject_refs" },
    );
  }
  const subjectRef = pcSubjectRefs[0];
  const playerSourceRef = nonEmptyString(
    source.player_input_source_ref,
    "player_input_source_ref",
  );
  const spans: ReviewedAgencySpan[] = [];
  const spanNames = new Set<string>();
  const addSpan = (reviewedSpan: string, exactExcerpt: unknown): void => {
    if (
      spans.length >= 64
      || typeof exactExcerpt !== "string"
      || !exactExcerpt.trim()
      || !draft.includes(exactExcerpt)
      || spanNames.has(reviewedSpan)
    ) return;
    spans.push({ reviewed_span: reviewedSpan, exact_excerpt: exactExcerpt });
    spanNames.add(reviewedSpan);
  };
  const stateReview = isPlainObject(source.state_authority_review)
    ? source.state_authority_review
    : null;
  const stateClaims = stateReview !== null && Array.isArray(stateReview.claims)
    ? stateReview.claims
    : [];
  stateClaims.forEach((raw, index) => {
    const row = isPlainObject(raw) ? raw : null;
    addSpan(`reviewed-state-claim:${index + 1}`, row?.exact_excerpt);
  });
  reviewedParagraphs(draft).forEach((paragraph, paragraphIndex) => {
    reviewedSentences(paragraph).forEach((sentence, sentenceIndex) => {
      addSpan(
        `reviewed-sentence:paragraph-${paragraphIndex + 1}:${sentenceIndex + 1}`,
        sentence,
      );
    });
    addSpan(`reviewed-paragraph:${paragraphIndex + 1}`, paragraph);
  });
  if (spans.length === 0) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "accepted review did not yield any exact structural draft span",
      { field: "reviewed_agency_binding.spans" },
    );
  }
  const coverageFacts = validateReviewedCoverageBindingFacts(
    source.coverage_binding_facts,
  );
  if (!Array.isArray(source.semantic_obligation_refs)) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "accepted-review coverage binding requires semantic obligation refs",
      { field: "semantic_obligation_refs" },
    );
  }
  const semanticRefs = new Map<string, string>();
  const seenObligationRefs = new Set<string>();
  for (const [index, raw] of source.semantic_obligation_refs.entries()) {
    if (
      !isPlainObject(raw)
      || !exactObjectKeys(raw, ["obligation_id", "obligation_ref"])
    ) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "semantic obligation refs use the exact canonical/ref schema",
        { field: `semantic_obligation_refs[${index}]` },
      );
    }
    const obligationId = nonEmptyString(
      raw.obligation_id,
      `semantic_obligation_refs[${index}].obligation_id`,
    );
    const obligationRef = nonEmptyString(
      raw.obligation_ref,
      `semantic_obligation_refs[${index}].obligation_ref`,
    );
    if (
      !REVIEWED_OBLIGATION_REF_RE.test(obligationRef)
      || semanticRefs.has(obligationId)
      || seenObligationRefs.has(obligationRef)
    ) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "semantic obligation refs must be unique live roll-domain handles",
        { field: `semantic_obligation_refs[${index}]` },
      );
    }
    semanticRefs.set(obligationId, obligationRef);
    seenObligationRefs.add(obligationRef);
  }
  const canonicalObligationIds = coverageFacts.obligations.map(
    (row) => String(row.obligation_id),
  );
  if (
    semanticRefs.size !== canonicalObligationIds.length
    || canonicalObligationIds.some((obligationId) => !semanticRefs.has(obligationId))
  ) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "semantic obligation refs must cover the exact accepted-review obligations",
      { field: "semantic_obligation_refs" },
    );
  }
  const paragraphs = reviewedParagraphs(draft);
  const firstParagraphOrdinal = (excerpt: string): number => {
    const index = paragraphs.findIndex((paragraph) => paragraph.includes(excerpt));
    return index < 0 ? 0 : index + 1;
  };
  const publicCheckSources = new Set(coverageFacts.public_check_source_ids);
  const semanticText = (value: unknown): string | null => (
    typeof value === "string" && value.trim()
      ? value.trim().slice(0, 1024)
      : null
  );
  const coverageObligations: ReviewedCoverageObligation[] = coverageFacts.obligations
    .map((row) => {
      const obligationId = String(row.obligation_id);
      const sourceKind = String(row.source_kind);
      const concealed = sourceKind === "concealed_roll";
      const publicCheck = publicCheckSources.has(String(row.source_id));
      const safePublicSpans = publicCheck
        ? spans.filter((span) => firstParagraphOrdinal(span.exact_excerpt) > 1)
        : spans;
      const allowedReviewedSpans = concealed
        ? []
        : (safePublicSpans.length > 0 ? safePublicSpans : spans)
          .map((span) => span.reviewed_span);
      if (!concealed && allowedReviewedSpans.length === 0) {
        throw new ToolContractProjectionError(
          "binding_context_invalid",
          "a visible accepted-review obligation has no safe reviewed span",
          { field: `coverage_binding_facts.obligations.${obligationId}` },
        );
      }
      return {
        obligation_ref: semanticRefs.get(obligationId)!,
        obligation_id: obligationId,
        source_kind: sourceKind,
        visibility: String(row.visibility),
        npc_display_name: semanticText(row.npc_display_name),
        skill: semanticText(row.skill),
        goal: semanticText(row.goal),
        outcome: semanticText(row.outcome),
        exceptional_required: row.exceptional_required === true,
        allowed_reviewed_spans: allowedReviewedSpans,
        realization: concealed
          ? "concealed_no_player_visible_beat" as const
          : "fictional_beat" as const,
        placement_mode: concealed
          ? "none" as const
          : publicCheck
            ? safePublicSpans.length > 0
              ? "host_safe_default_before_result" as const
              : "canonical_repair_if_unsafe" as const
            : "host_safe_default" as const,
      };
    })
    .sort((left, right) => left.obligation_id.localeCompare(right.obligation_id));
  const authorities: ReviewedAgencyAuthority[] = [{
    authority: "current-player-input",
    claim_types: [
      "voluntary_action", "voluntary_speech", "voluntary_plan",
      "voluntary_belief", "voluntary_trust", "voluntary_active_emotion",
    ],
    subject_ref: subjectRef,
    source_ref: playerSourceRef,
    override_id: null,
  }];
  const physiologySources = authority !== null
    && Array.isArray(authority.involuntary_physiology_sources)
    ? authority.involuntary_physiology_sources.filter(isPlainObject)
    : [];
  physiologySources.forEach((row, index) => {
    if (
      row.source_type !== "ownership_contract"
      || typeof row.source_ref !== "string"
      || !row.source_ref.trim()
    ) return;
    authorities.push({
      authority: physiologySources.length === 1
        ? "involuntary-physiology"
        : `involuntary-physiology:${index + 1}`,
      claim_types: ["involuntary_physiology"],
      subject_ref: subjectRef,
      source_ref: row.source_ref,
      override_id: null,
    });
  });
  const controlOverrides = Array.isArray(source.control_overrides)
    ? source.control_overrides.filter(isPlainObject)
    : [];
  controlOverrides
    .filter((row) => (
      row.active === true
      && row.subject_ref === subjectRef
      && typeof row.override_id === "string"
      && row.override_id.trim().length > 0
      && typeof row.source_ref === "string"
      && row.source_ref.trim().length > 0
    ))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
    .forEach((row, index) => {
      authorities.push({
        authority: (
          `control-override:${authoritySlug(row.override_type)}:${index + 1}`
        ),
        claim_types: ["forced_behavior"],
        subject_ref: subjectRef,
        source_ref: String(row.source_ref),
        override_id: String(row.override_id),
      });
    });
  const built: ReviewedAgencyBinding = {
    schema_version: 1,
    review_id: reviewId,
    revision,
    draft_sha256: draftSha256,
    draft,
    spans,
    authorities,
    coverage_obligations: coverageObligations,
    mechanics_placement: {
      mode: "host_safe_default",
      public_check_count: coverageFacts.public_check_source_ids.length,
      state_delta_count: coverageFacts.state_delta_source_ids.length,
      exceptional_effect_count: coverageFacts.exceptional_effect_source_ids.length,
    },
  };
  validateReviewedAgencyBinding(built, {
    schema_version: 1,
    operation: "turn.finalize",
    binding_revision: "reviewed-agency-construction",
    root: "host",
    campaign: "host",
    decision_id: "host",
    revision,
    turn_id: "host",
    source_digest: "host",
    narration_review_id: reviewId,
  });
  return built;
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
      const allowed = candidate.allowed_defenses;
      const validDefenses = new Set<CombatDefenseKind>([
        "dodge", "fight_back", "dive_for_cover", "none",
      ]);
      if (
        !Array.isArray(allowed)
        || allowed.length === 0
        || new Set(allowed).size !== allowed.length
        || allowed.some((kind) => !validDefenses.has(kind))
      ) {
        throw new ToolContractProjectionError(
          "binding_context_invalid",
          "pending defense must retain one or more unique canonical allowed_defenses",
          { field: "candidates.allowed_defenses" },
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

function validateChaseCandidates(value: readonly ChaseActionCandidate[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "retained chase candidates must be a non-empty array",
      { field: "candidates" },
    );
  }
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!isPlainObject(candidate)) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "retained chase candidate must be an object",
        { field: "candidates" },
      );
    }
    const actor = nonEmptyString(candidate.actor_handle, "candidates.actor_handle");
    const action = nonEmptyString(candidate.action_handle, "candidates.action_handle");
    nonEmptyString(candidate.actor_id, "candidates.actor_id");
    nonEmptyString(candidate.action_id, "candidates.action_id");
    nonEmptyString(candidate.destination_handle, "candidates.destination_handle");
    if (candidate.kind !== "chase_move") {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "retained chase candidate has an unsupported command kind",
        { field: "candidates.kind" },
      );
    }
    const key = `${actor}\u0000${action}`;
    if (seen.has(key)) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "retained chase semantic choices must be unique",
        { field: "candidates" },
      );
    }
    seen.add(key);
  }
}

const REVIEWED_AGENCY_SPAN_RE =
  /^reviewed-(?:state-claim|sentence|paragraph):[a-z0-9][a-z0-9:-]{0,126}$/;
const REVIEWED_AGENCY_AUTHORITY_RE =
  /^(?:current-player-input|involuntary-physiology(?::[1-9][0-9]{0,2})?|control-override:[a-z0-9][a-z0-9-]{0,63}:[1-9][0-9]{0,2})$/;

function exactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}

function validateReviewedAgencyBinding(
  value: ReviewedAgencyBinding,
  owner: TurnFinalizeBindingCard,
): void {
  if (
    !isPlainObject(value)
    || !exactObjectKeys(value, [
      "schema_version", "review_id", "revision", "draft_sha256", "draft",
      "spans", "authorities", "coverage_obligations", "mechanics_placement",
    ])
    || value.schema_version !== 1
    || value.review_id !== owner.narration_review_id
    || value.revision !== owner.revision
  ) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "reviewed agency binding must match the accepted review identity and revision",
      { field: "reviewed_agency_binding" },
    );
  }
  const draft = nonEmptyString(value.draft, "reviewed_agency_binding.draft");
  const digest = nonEmptyString(
    value.draft_sha256,
    "reviewed_agency_binding.draft_sha256",
  );
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "reviewed agency binding draft digest must be a canonical sha256 value",
      { field: "reviewed_agency_binding.draft_sha256" },
    );
  }
  if (!Array.isArray(value.spans) || value.spans.length < 1 || value.spans.length > 64) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "reviewed agency binding requires one to 64 exact reviewed spans",
      { field: "reviewed_agency_binding.spans" },
    );
  }
  const spanNames = new Set<string>();
  for (const raw of value.spans) {
    if (
      !isPlainObject(raw)
      || !exactObjectKeys(raw, ["reviewed_span", "exact_excerpt"])
    ) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "reviewed agency spans use a closed semantic-ref/exact-excerpt schema",
        { field: "reviewed_agency_binding.spans" },
      );
    }
    const span = nonEmptyString(
      raw.reviewed_span,
      "reviewed_agency_binding.spans.reviewed_span",
    );
    const excerpt = nonEmptyString(
      raw.exact_excerpt,
      "reviewed_agency_binding.spans.exact_excerpt",
    );
    if (
      !REVIEWED_AGENCY_SPAN_RE.test(span)
      || !draft.includes(excerpt)
      || spanNames.has(span)
    ) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "reviewed agency spans must be unique semantic ordinals over exact draft excerpts",
        { field: "reviewed_agency_binding.spans" },
      );
    }
    spanNames.add(span);
  }
  if (
    !Array.isArray(value.authorities)
    || value.authorities.length < 1
    || value.authorities.length > 32
  ) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "reviewed agency binding requires one to 32 semantic authorities",
      { field: "reviewed_agency_binding.authorities" },
    );
  }
  const authorityNames = new Set<string>();
  for (const raw of value.authorities) {
    if (
      !isPlainObject(raw)
      || !exactObjectKeys(raw, [
        "authority", "claim_types", "subject_ref", "source_ref", "override_id",
      ])
    ) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "reviewed agency authorities use a closed semantic/canonical binding schema",
        { field: "reviewed_agency_binding.authorities" },
      );
    }
    const authority = nonEmptyString(
      raw.authority,
      "reviewed_agency_binding.authorities.authority",
    );
    nonEmptyString(raw.subject_ref, "reviewed_agency_binding.authorities.subject_ref");
    nonEmptyString(raw.source_ref, "reviewed_agency_binding.authorities.source_ref");
    const types = Array.isArray(raw.claim_types) ? raw.claim_types : [];
    const authorityTypesValid = authority === "current-player-input"
      ? types.every((entry) => (
        typeof entry === "string"
        && entry.startsWith("voluntary_")
      ))
      : authority.startsWith("involuntary-physiology")
        ? types.length === 1 && types[0] === "involuntary_physiology"
        : authority.startsWith("control-override:")
          ? types.length === 1 && types[0] === "forced_behavior"
          : false;
    if (
      !REVIEWED_AGENCY_AUTHORITY_RE.test(authority)
      || authorityNames.has(authority)
      || types.length < 1
      || types.length !== new Set(types).size
      || !types.every((entry) => (
        typeof entry === "string"
        && (REVIEWED_AGENCY_CLAIM_TYPES as readonly string[]).includes(entry)
      ))
      || !authorityTypesValid
      || (
        authority.startsWith("control-override:")
          ? typeof raw.override_id !== "string" || !raw.override_id.trim()
          : raw.override_id !== null
      )
    ) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "reviewed agency authority is stale, duplicated, or incompatible with its claim types",
        { field: "reviewed_agency_binding.authorities" },
      );
    }
    authorityNames.add(authority);
  }
  if (
    !Array.isArray(value.coverage_obligations)
    || value.coverage_obligations.length > 64
  ) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "reviewed coverage binding requires at most 64 obligations",
      { field: "reviewed_agency_binding.coverage_obligations" },
    );
  }
  const obligationIds = new Set<string>();
  const obligationRefs = new Set<string>();
  for (const [index, raw] of value.coverage_obligations.entries()) {
    if (
      !isPlainObject(raw)
      || !exactObjectKeys(raw, [
        "obligation_ref", "obligation_id", "source_kind", "visibility",
        "npc_display_name", "skill", "goal", "outcome",
        "exceptional_required", "allowed_reviewed_spans", "realization",
        "placement_mode",
      ])
    ) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "reviewed coverage obligations use the closed semantic/exact host schema",
        { field: `reviewed_agency_binding.coverage_obligations[${index}]` },
      );
    }
    const obligationRef = nonEmptyString(
      raw.obligation_ref,
      `reviewed_agency_binding.coverage_obligations[${index}].obligation_ref`,
    );
    const obligationId = nonEmptyString(
      raw.obligation_id,
      `reviewed_agency_binding.coverage_obligations[${index}].obligation_id`,
    );
    nonEmptyString(
      raw.source_kind,
      `reviewed_agency_binding.coverage_obligations[${index}].source_kind`,
    );
    nonEmptyString(
      raw.visibility,
      `reviewed_agency_binding.coverage_obligations[${index}].visibility`,
    );
    if (
      !REVIEWED_OBLIGATION_REF_RE.test(obligationRef)
      || obligationRefs.has(obligationRef)
      || obligationIds.has(obligationId)
      || typeof raw.exceptional_required !== "boolean"
      || !Array.isArray(raw.allowed_reviewed_spans)
      || raw.allowed_reviewed_spans.length > 64
      || raw.allowed_reviewed_spans.some((span) => (
        typeof span !== "string" || !spanNames.has(span)
      ))
      || raw.allowed_reviewed_spans.length
        !== new Set(raw.allowed_reviewed_spans).size
      || ![
        "fictional_beat", "concealed_no_player_visible_beat",
      ].includes(String(raw.realization))
      || ![
        "host_safe_default_before_result", "canonical_repair_if_unsafe",
        "host_safe_default", "none",
      ].includes(String(raw.placement_mode))
      || (
        raw.realization === "concealed_no_player_visible_beat"
          ? raw.allowed_reviewed_spans.length !== 0 || raw.placement_mode !== "none"
          : raw.allowed_reviewed_spans.length === 0 || raw.placement_mode === "none"
      )
      || [
        raw.npc_display_name, raw.skill, raw.goal, raw.outcome,
      ].some((entry) => entry !== null && typeof entry !== "string")
    ) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "reviewed coverage obligation is stale, duplicated, or structurally unsafe",
        { field: `reviewed_agency_binding.coverage_obligations[${index}]` },
      );
    }
    obligationRefs.add(obligationRef);
    obligationIds.add(obligationId);
  }
  const mechanics = value.mechanics_placement;
  if (
    !isPlainObject(mechanics)
    || !exactObjectKeys(mechanics, [
      "mode", "public_check_count", "state_delta_count",
      "exceptional_effect_count",
    ])
    || mechanics.mode !== "host_safe_default"
    || [
      mechanics.public_check_count,
      mechanics.state_delta_count,
      mechanics.exceptional_effect_count,
    ].some((count) => !Number.isInteger(count) || Number(count) < 0)
  ) {
    throw new ToolContractProjectionError(
      "binding_context_invalid",
      "reviewed mechanics placement binding must use the closed safe-default contract",
      { field: "reviewed_agency_binding.mechanics_placement" },
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
    const directSingleDraft = binding.direct_single_draft === true;
    if (binding.direct_single_draft !== undefined && !directSingleDraft) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "direct_single_draft must be true when present",
        { field: "direct_single_draft" },
      );
    }
    if (directSingleDraft) {
      if (
        binding.narration_review_id !== null
        || binding.reviewed_agency_binding !== undefined
      ) {
        throw new ToolContractProjectionError(
          "binding_context_invalid",
          "direct single-draft finalize cannot carry review evidence",
          { field: "narration_review_id" },
        );
      }
    } else {
      nonEmptyString(binding.narration_review_id, "narration_review_id");
    }
    if (binding.repair_finalization_id !== undefined) {
      nonEmptyString(binding.repair_finalization_id, "repair_finalization_id");
    }
    if (binding.reviewed_agency_binding !== undefined) {
      validateReviewedAgencyBinding(binding.reviewed_agency_binding, binding);
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
  } else if (binding.operation === "chase.execute") {
    nonEmptyString(binding.investigator, "investigator");
    nonEmptyString(binding.chase_id, "chase_id");
    requirePositiveRevision(binding.chase_revision, "chase_revision");
    nonEmptyString(binding.chase_digest, "chase_digest");
    validateChaseCandidates(binding.candidates);
  } else if (binding.operation === "sanity.execute") {
    nonEmptyString(binding.investigator, "investigator");
    nonEmptyString(binding.bout_id, "bout_id");
    nonEmptyString(binding.choice_id, "choice_id");
    nonEmptyString(binding.source_command_id, "source_command_id");
    if (
      !Number.isInteger(binding.choice_revision)
      || binding.choice_revision < 0
    ) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "sanity bout choice_revision must be a non-negative integer",
        { field: "choice_revision" },
      );
    }
    if (
      !Array.isArray(binding.candidates)
      || binding.candidates.length === 0
      || binding.candidates.length > 2
    ) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        "sanity bout binding requires one or two current semantic actions",
        { field: "candidates" },
      );
    }
    const actions = new Set<string>();
    for (const [index, candidate] of binding.candidates.entries()) {
      const expectedKind = candidate.action === "tick"
        ? "bout_tick"
        : candidate.action === "end"
          ? "bout_end"
          : null;
      if (
        expectedKind === null
        || candidate.kind !== expectedKind
        || actions.has(candidate.action)
      ) {
        throw new ToolContractProjectionError(
          "binding_context_invalid",
          "sanity bout candidates must be unique matching tick/end actions",
          { field: `candidates[${index}]` },
        );
      }
      nonEmptyString(candidate.decision_id, `candidates[${index}].decision_id`);
      nonEmptyString(candidate.command_id, `candidates[${index}].command_id`);
      actions.add(candidate.action);
    }
  } else if (
    binding.operation === "evidence.table_opening"
  ) {
    nonEmptyString(binding.run_id, "run_id");
  } else if (binding.operation === "npc.reaction") {
    nonEmptyString(binding.investigator, "investigator");
    if (binding.run_id !== undefined) nonEmptyString(binding.run_id, "run_id");
  } else if (
    binding.operation === "rules.social_adjudicate"
    || binding.operation === "rules.psychology_observe"
  ) {
    if (!Array.isArray(binding.candidates) || binding.candidates.length === 0) {
      throw new ToolContractProjectionError(
        "binding_context_invalid",
        `${binding.operation} requires at least one current interaction candidate`,
        { field: "candidates" },
      );
    }
    if (binding.operation === "rules.psychology_observe") {
      nonEmptyString(binding.realize_decision_id, "realize_decision_id");
    }
    const candidateIds = new Set<string>();
    for (const [index, candidate] of binding.candidates.entries()) {
      const prefix = `candidates[${index}]`;
      const candidateId = nonEmptyString(candidate.candidate_id, `${prefix}.candidate_id`);
      nonEmptyString(candidate.investigator, `${prefix}.investigator`);
      nonEmptyString(candidate.npc_id, `${prefix}.npc_id`);
      nonEmptyString(
        candidate.conversation_window_id,
        `${prefix}.conversation_window_id`,
      );
      if (candidate.first_impression_ref !== undefined) {
        nonEmptyString(candidate.first_impression_ref, `${prefix}.first_impression_ref`);
      }
      if (
        candidateIds.has(candidateId)
        || !Array.isArray(candidate.validated_fact_refs)
        || (
          binding.operation === "rules.psychology_observe"
          && candidate.validated_fact_refs.length === 0
        )
        || candidate.validated_fact_refs.some((ref) => (
          typeof ref !== "string" || !ref.trim()
        ))
        || new Set(candidate.validated_fact_refs).size
          !== candidate.validated_fact_refs.length
      ) {
        throw new ToolContractProjectionError(
          "binding_context_invalid",
          `${binding.operation} candidates must have unique ids and verified fact refs`,
          { field: prefix },
        );
      }
      candidateIds.add(candidateId);
      if (binding.operation === "rules.psychology_observe") {
        if (
          !Number.isInteger(candidate.observation_revision)
          || candidate.observation_revision < 0
        ) {
          throw new ToolContractProjectionError(
            "binding_context_invalid",
            "psychology observation revision must be a non-negative integer",
            { field: `${prefix}.observation_revision` },
          );
        }
        nonEmptyString(candidate.observer_scope, `${prefix}.observer_scope`);
      }
    }
  } else {
    nonEmptyString(binding.npc_id, "npc_id");
    nonEmptyString(binding.investigator, "investigator");
    if (binding.identity_ref !== undefined) {
      nonEmptyString(binding.identity_ref, "identity_ref");
    }
    if (binding.first_impression_ref !== undefined) {
      nonEmptyString(binding.first_impression_ref, "first_impression_ref");
    }
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
      ...(binding.narration_review_id === null
        ? {}
        : { narration_review_id: binding.narration_review_id }),
      ...(binding.reviewed_agency_binding === undefined
        ? {}
        : { draft: binding.reviewed_agency_binding.draft }),
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
      ...(binding.identity_ref === undefined
        ? {}
        : { identity_ref: binding.identity_ref }),
      ...(binding.first_impression_ref === undefined
        ? {}
        : { first_impression_ref: binding.first_impression_ref }),
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
  if (binding.operation === "chase.execute") {
    return {
      root: binding.root,
      campaign: binding.campaign,
      decision_id: binding.decision_id,
      investigator: binding.investigator,
    };
  }
  if (binding.operation === "combat.resolve") {
    const revision = Number(binding.combat_revision);
    return {
      root: binding.root,
      campaign: binding.campaign,
      decision_id: binding.decision_id,
      ...(Number.isInteger(revision) && revision >= 0
        ? { combat_revision: revision }
        : {}),
    };
  }
  if (binding.operation === "sanity.execute") {
    return {
      root: binding.root,
      campaign: binding.campaign,
      decision_id: binding.decision_id,
    };
  }
  if (
    binding.operation === "rules.social_adjudicate"
    || binding.operation === "rules.psychology_observe"
  ) {
    return {
      root: binding.root,
      campaign: binding.campaign,
      decision_id: binding.decision_id,
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
  if (
    binding.operation === "turn.finalize"
    && binding.reviewed_agency_binding !== undefined
  ) fields.push("draft", "mechanics_placements");
  return fields;
}

function selectedInteractionCandidate(
  binding: SocialAdjudicationBindingCard | PsychologyObserveBindingCard,
  modelInput: Record<string, unknown>,
): SocialInteractionCandidate | PsychologyObserveBindingCard["candidates"][number] {
  const candidateId = binding.candidates.length === 1
    ? binding.candidates[0].candidate_id
    : typeof modelInput.candidate_id === "string"
      ? modelInput.candidate_id
      : "";
  const selected = binding.candidates.find((row) => row.candidate_id === candidateId);
  if (!selected) {
    throw new ToolContractProjectionError(
      "semantic_candidate_stale",
      `selected ${binding.operation} target is not current`,
      { operation: binding.operation, candidate_field: "candidate_id" },
    );
  }
  return selected;
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

function requireSchemaField(schema: JsonSchema, field: string): void {
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!required.includes(field)) schema.required = [...required, field];
}

function projectChaseCommandSchema(
  schema: JsonSchema,
  binding: ChaseExecuteBindingCard,
): void {
  if (!isPlainObject(schema.properties)) return;
  schema.properties.command = {
    oneOf: binding.candidates.map((candidate) => {
      const properties: Record<string, unknown> = {
        actor: {
          type: "string",
          const: candidate.actor_handle,
          description: "Choose one current semantic chase actor handle.",
        },
        action: {
          type: "string",
          const: candidate.action_handle,
          description: "Choose one current legal semantic chase action.",
        },
      };
      return {
        type: "object",
        additionalProperties: false,
        properties,
        required: ["actor", "action"],
      };
    }),
    description: (
      "Choose only the semantic actor and action. "
      + "The host binds the canonical command identity, kind, phase, current "
      + "revision, actor identity, and action identity from chase.context."
    ),
  };
}

function projectSanityBoutCommandSchema(
  schema: JsonSchema,
  binding: SanityBoutBindingCard,
): void {
  if (!isPlainObject(schema.properties)) return;
  schema.properties.command = {
    oneOf: binding.candidates.map((candidate) => ({
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          const: candidate.action,
          description: (
            candidate.action === "tick"
              ? "Advance the current Keeper-controlled bout by one round."
              : "End the current Keeper-controlled bout now."
          ),
        },
      },
      required: ["action"],
    })),
    description: (
      "Choose only the semantic action for the current active bout. The host "
      + "binds the exact pending choice, revision, command, bout, and "
      + "idempotency identities from authoritative sanity state."
    ),
  };
}

function projectReviewedAgencyClaimsSchema(
  schema: JsonSchema,
  binding: ReviewedAgencyBinding,
): void {
  if (!isPlainObject(schema.properties)) return;
  const spanValues = binding.spans.map((row) => row.reviewed_span);
  const authorityBranches: JsonSchema[] = binding.authorities.map((row) => ({
    type: "object",
    additionalProperties: false,
    properties: {
      reviewed_span: {
        type: "string",
        enum: spanValues,
        description: (
          "Choose one host-reviewed semantic span ordinal. The host restores "
          + "the exact accepted-draft excerpt; never copy prose here."
        ),
      },
      claim_type: {
        type: "string",
        enum: [...row.claim_types],
      },
      authority: {
        type: "string",
        const: row.authority,
        description: (
          "Choose this semantic authority. The host binds the exact PC, "
          + "player input, physiology contract, or active override receipt."
        ),
      },
    },
    required: ["reviewed_span", "claim_type", "authority"],
  }));
  schema.properties.agency_claims = {
    type: "array",
    maxItems: 64,
    items: authorityBranches.length === 1
      ? authorityBranches[0]
      : { oneOf: authorityBranches },
    description: (
      "Semantic agency selections for the accepted review. Submit [] when "
      + "the reviewed draft contains no authorized PC proposition. Exact "
      + "draft excerpts and canonical sources are host-bound."
    ),
  };
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!required.includes("agency_claims")) {
    schema.required = [...required, "agency_claims"];
  }
}

function projectReviewedCoverageSchema(
  schema: JsonSchema,
  binding: ReviewedAgencyBinding,
): void {
  if (!isPlainObject(schema.properties)) return;
  const branches: JsonSchema[] = binding.coverage_obligations.map((row) => {
    const concealed = row.realization === "concealed_no_player_visible_beat";
    const semanticField = concealed
      ? { type: "null", const: null }
      : { type: "string", minLength: 1 };
    return {
      type: "object",
      additionalProperties: false,
      description: [
        `source_kind=${row.source_kind}`,
        `visibility=${row.visibility}`,
        ...(row.npc_display_name === null ? [] : [`npc=${row.npc_display_name}`]),
        ...(row.skill === null ? [] : [`skill=${row.skill}`]),
        ...(row.goal === null ? [] : [`goal=${row.goal}`]),
        ...(row.outcome === null ? [] : [`outcome=${row.outcome}`]),
        `placement=${row.placement_mode}`,
      ].join("; "),
      properties: {
        obligation_ref: {
          type: "string",
          const: row.obligation_ref,
          description: (
            "Choose this semantic obligation reference. The host restores "
            + "the exact canonical finalizer join key."
          ),
        },
        reviewed_span: concealed
          ? { type: "null", const: null }
          : {
              type: "string",
              enum: [...row.allowed_reviewed_spans],
              description: (
                "Choose one exact accepted-review structural span. The host "
                + "restores its hidden exact excerpt and safe placement."
              ),
            },
        realization: { type: "string", const: row.realization },
        action_realization: semanticField,
        response: semanticField,
        causal_explanation: semanticField,
        persona_fit: semanticField,
        player_input_handling: concealed
          ? { type: "string", const: "not_applicable" }
          : {
              type: "string",
              enum: ["abstract_completed", "not_applicable", "specific_preserved"],
            },
        exceptional_beat: concealed
          ? { type: "null", const: null }
          : row.exceptional_required
            ? { type: "string", minLength: 1 }
            : { type: ["string", "null"] },
      },
      required: [
        "obligation_ref", "reviewed_span", "realization",
        "action_realization", "response", "causal_explanation", "persona_fit",
        "player_input_handling", "exceptional_beat",
      ],
    };
  });
  schema.properties.coverage = {
    type: "array",
    minItems: branches.length,
    maxItems: branches.length,
    items: branches.length === 0
      ? { type: "object", not: {} }
      : branches.length === 1
        ? branches[0]
        : { oneOf: branches },
    description: (
      "Exactly one semantic row per accepted-review obligation. Select an "
      + "obligation_ref and reviewed_span; never submit verbatim prose, "
      + "canonical ids, hidden draft text, or mechanics placement indices."
    ),
  };
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!required.includes("coverage")) schema.required = [...required, "coverage"];
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
  if (
    valid.operation === "turn.finalize"
    && valid.reviewed_agency_binding !== undefined
  ) {
    projectReviewedCoverageSchema(cloned, valid.reviewed_agency_binding);
    projectReviewedAgencyClaimsSchema(cloned, valid.reviewed_agency_binding);
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
  if (valid.operation === "combat.resolve") {
    const pending = valid.candidates[0].invocation_mode === "pending_defense";
    if (valid.candidates.length > 1) {
      setEnumProperty(
        cloned,
        "candidate_id",
        valid.candidates.map((candidate) => candidate.candidate_id),
        "Choose one current semantic combat route; the host binds its exact canonical invocation mode.",
      );
    }
    if (isPlainObject(cloned.properties)) {
      if (pending) {
        delete cloned.properties.action_kind;
        delete cloned.properties.goal;
        delete cloned.properties.weapon_id;
        delete cloned.properties.weapon_effect_ids;
        const candidate = valid.candidates[0];
        if (candidate.invocation_mode !== "pending_defense") {
          throw new ToolContractProjectionError(
            "binding_context_invalid",
            "pending combat projection lost its sole defense candidate",
            { operation: valid.operation },
          );
        }
        setEnumProperty(
          cloned,
          "defense_kind",
          candidate.allowed_defenses,
          "Choose exactly one defense allowed by the current pending attack. This is not a new attack.",
        );
      } else {
        delete cloned.properties.defense_kind;
        setEnumProperty(
          cloned,
          "action_kind",
          ["attack", "aim", "reload", "maneuver", "flee"],
          "Choose one explicit CombatSession action. Attack and maneuver use a current target candidate; aim/reload/flee are actor-local actions.",
        );
        cloned.properties.goal = {
          type: "string",
          enum: ["disarm", "ongoing_disadvantage", "escape", "push"],
          description: "Choose one rulebook maneuver goal when action_kind is maneuver; omit for every other action.",
        };
        if (isPlainObject(cloned.properties.weapon_id)) {
          cloned.properties.weapon_id = {
            ...cloned.properties.weapon_id,
            minLength: 1,
            description: "Exact semantically selected owned weapon handle. Use literal unarmed for fists, kicks, or other unarmed attacks; never omit this field and never substitute another owned weapon.",
          };
        }
      }
    }
  }
  if (valid.operation === "chase.execute") {
    projectChaseCommandSchema(cloned, valid);
  }
  if (valid.operation === "sanity.execute") {
    projectSanityBoutCommandSchema(cloned, valid);
  }
  if (
    (valid.operation === "rules.social_adjudicate"
      || valid.operation === "rules.psychology_observe")
    && valid.candidates.length > 1
  ) {
    setEnumProperty(
      cloned,
      "candidate_id",
      valid.candidates.map((candidate) => candidate.candidate_id),
      "Choose one current scene/NPC-query target; the host binds exact canonical identity.",
    );
    const required = Array.isArray(cloned.required) ? cloned.required : [];
    if (!required.includes("candidate_id")) {
      cloned.required = [...required, "candidate_id"];
    }
  }
  if (valid.operation === "rules.psychology_observe") {
    const factRefs = valid.candidates.flatMap((candidate) => (
      candidate.validated_fact_refs
    ));
    if (factRefs.length > 1 && isPlainObject(cloned.properties)) {
      cloned.properties.fact_refs = {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", enum: factRefs },
        description: "Choose one or more exact facts returned by the current npc.query target; the host validates target ownership and restores canonical refs.",
      };
      const required = Array.isArray(cloned.required) ? cloned.required : [];
      if (!required.includes("fact_refs")) cloned.required = [...required, "fact_refs"];
    }
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
  if (
    valid.operation === "rules.social_adjudicate"
    || valid.operation === "rules.psychology_observe"
  ) {
    const candidate = selectedInteractionCandidate(valid, modelInput);
    delete result.candidate_id;
    result.investigator = candidate.investigator;
    result.npc_id = candidate.npc_id;
    result.conversation_window_id = candidate.conversation_window_id;
    if (valid.operation === "rules.psychology_observe") {
      const psychologyCandidate = candidate as PsychologyObserveBindingCard["candidates"][number];
      const realize = modelInput.action === "realize";
      result.decision_id = realize
        ? valid.realize_decision_id
        : valid.decision_id;
      result.observation_revision = psychologyCandidate.observation_revision;
      result.observer_scope = psychologyCandidate.observer_scope;
      const factRefs = valid.candidates.flatMap((row) => row.validated_fact_refs);
      const selectedRefs = factRefs.length === 1
        ? [factRefs[0]]
        : Array.isArray(modelInput.fact_refs)
          ? modelInput.fact_refs
          : [];
      delete result.fact_refs;
      if (!realize) {
        if (
          selectedRefs.length === 0
          || selectedRefs.some((ref) => (
            typeof ref !== "string"
            || !psychologyCandidate.validated_fact_refs.includes(ref)
          ))
          || new Set(selectedRefs).size !== selectedRefs.length
        ) {
          throw new ToolContractProjectionError(
            "semantic_candidate_stale",
            "selected Psychology facts are absent or belong to another current NPC",
            { operation, candidate_field: "fact_refs" },
          );
        }
        result.observable_fact_refs = [...selectedRefs];
      }
    }
  }
  if (
    valid.operation === "turn.finalize"
    && valid.reviewed_agency_binding !== undefined
  ) {
    const rawCoverage = modelInput.coverage;
    if (
      !Array.isArray(rawCoverage)
      || rawCoverage.length !== valid.reviewed_agency_binding.coverage_obligations.length
    ) {
      throw new ToolContractProjectionError(
        "reviewed_coverage_invalid",
        "accepted-review coverage must contain exactly one semantic row per obligation",
        { operation, field: "coverage" },
      );
    }
    const coverageByRef = new Map(
      valid.reviewed_agency_binding.coverage_obligations.map(
        (row) => [row.obligation_ref, row],
      ),
    );
    const spanByName = new Map(
      valid.reviewed_agency_binding.spans.map((row) => [row.reviewed_span, row]),
    );
    const seenCoverage = new Set<string>();
    const coverageFields = [
      "obligation_ref", "reviewed_span", "realization", "action_realization",
      "response", "causal_explanation", "persona_fit",
      "player_input_handling", "exceptional_beat",
    ];
    const semanticString = (
      value: unknown,
      field: string,
    ): string => {
      if (typeof value !== "string" || !value.trim()) {
        throw new ToolContractProjectionError(
          "reviewed_coverage_invalid",
          `${field} must be a non-empty semantic explanation`,
          { operation, field },
        );
      }
      return value;
    };
    const normalizedCoverage = rawCoverage.map((raw, index) => {
      if (!isPlainObject(raw) || !exactObjectKeys(raw, coverageFields)) {
        throw new ToolContractProjectionError(
          "reviewed_coverage_invalid",
          `coverage[${index}] must use the closed semantic reviewed-span schema`,
          { operation, field: `coverage[${index}]` },
        );
      }
      const obligationRef = typeof raw.obligation_ref === "string"
        ? raw.obligation_ref
        : "";
      const obligation = coverageByRef.get(obligationRef);
      if (obligation === undefined || seenCoverage.has(obligationRef)) {
        throw new ToolContractProjectionError(
          "reviewed_coverage_obligation_stale",
          "selected coverage obligation is absent, stale, or duplicated",
          { operation, field: `coverage[${index}].obligation_ref` },
        );
      }
      seenCoverage.add(obligationRef);
      const concealed = obligation.realization === "concealed_no_player_visible_beat";
      if (raw.realization !== obligation.realization) {
        throw new ToolContractProjectionError(
          "reviewed_coverage_invalid",
          "coverage realization does not match the retained obligation visibility",
          { operation, field: `coverage[${index}].realization` },
        );
      }
      if (concealed) {
        if (
          raw.reviewed_span !== null
          || raw.action_realization !== null
          || raw.response !== null
          || raw.causal_explanation !== null
          || raw.persona_fit !== null
          || raw.exceptional_beat !== null
          || raw.player_input_handling !== "not_applicable"
        ) {
          throw new ToolContractProjectionError(
            "reviewed_coverage_invalid",
            "concealed coverage cannot cite or describe player-visible prose",
            { operation, field: `coverage[${index}]` },
          );
        }
        return {
          obligation_id: obligation.obligation_id,
          realization: obligation.realization,
          action_realization: null,
          response: null,
          causal_explanation: null,
          persona_fit: null,
          player_input_handling: "not_applicable",
          exact_excerpt: null,
          exceptional_beat: null,
        };
      }
      const reviewedSpan = typeof raw.reviewed_span === "string"
        ? raw.reviewed_span
        : "";
      if (!obligation.allowed_reviewed_spans.includes(reviewedSpan)) {
        throw new ToolContractProjectionError(
          "reviewed_coverage_span_stale",
          "selected reviewed span is not safe for this current obligation",
          { operation, field: `coverage[${index}].reviewed_span` },
        );
      }
      const span = spanByName.get(reviewedSpan);
      if (span === undefined) {
        throw new ToolContractProjectionError(
          "reviewed_coverage_span_stale",
          "selected reviewed span is absent from the current accepted review",
          { operation, field: `coverage[${index}].reviewed_span` },
        );
      }
      const handling = raw.player_input_handling;
      if (![
        "abstract_completed", "not_applicable", "specific_preserved",
      ].includes(String(handling))) {
        throw new ToolContractProjectionError(
          "reviewed_coverage_invalid",
          "coverage player_input_handling is outside the closed canonical enum",
          { operation, field: `coverage[${index}].player_input_handling` },
        );
      }
      const exceptionalBeat = raw.exceptional_beat;
      if (
        obligation.exceptional_required
          ? typeof exceptionalBeat !== "string" || !exceptionalBeat.trim()
          : exceptionalBeat !== null
            && (typeof exceptionalBeat !== "string" || !exceptionalBeat.trim())
      ) {
        throw new ToolContractProjectionError(
          "reviewed_coverage_invalid",
          "coverage exceptional_beat does not match the retained obligation",
          { operation, field: `coverage[${index}].exceptional_beat` },
        );
      }
      return {
        obligation_id: obligation.obligation_id,
        realization: obligation.realization,
        action_realization: semanticString(
          raw.action_realization,
          `coverage[${index}].action_realization`,
        ),
        response: semanticString(raw.response, `coverage[${index}].response`),
        causal_explanation: semanticString(
          raw.causal_explanation,
          `coverage[${index}].causal_explanation`,
        ),
        persona_fit: semanticString(
          raw.persona_fit,
          `coverage[${index}].persona_fit`,
        ),
        player_input_handling: handling,
        exact_excerpt: span.exact_excerpt,
        exceptional_beat: exceptionalBeat,
      };
    });
    result.coverage = normalizedCoverage.sort((left, right) => (
      String(left.obligation_id).localeCompare(String(right.obligation_id))
    ));
    const hasAgencyClaims = Object.hasOwn(modelInput, "agency_claims");
    const rawClaims = hasAgencyClaims ? modelInput.agency_claims : [];
    if (!Array.isArray(rawClaims) || rawClaims.length > 64) {
      throw new ToolContractProjectionError(
        "reviewed_agency_claim_invalid",
        "accepted-review agency_claims must be a bounded semantic selection array",
        { operation, field: "agency_claims" },
      );
    }
    const spans = new Map(
      valid.reviewed_agency_binding.spans.map((row) => [row.reviewed_span, row]),
    );
    const authorities = new Map(
      valid.reviewed_agency_binding.authorities.map((row) => [row.authority, row]),
    );
    const seen = new Set<string>();
    const normalizedClaims = rawClaims.map((raw, index) => {
      if (
        !isPlainObject(raw)
        || !exactObjectKeys(raw, ["reviewed_span", "claim_type", "authority"])
      ) {
        throw new ToolContractProjectionError(
          "reviewed_agency_claim_invalid",
          `agency_claims[${index}] must use the closed semantic reviewed-span schema`,
          { operation, field: `agency_claims[${index}]` },
        );
      }
      const reviewedSpan = typeof raw.reviewed_span === "string"
        ? raw.reviewed_span
        : "";
      const claimType = typeof raw.claim_type === "string"
        ? raw.claim_type
        : "";
      const authorityName = typeof raw.authority === "string"
        ? raw.authority
        : "";
      const span = spans.get(reviewedSpan);
      if (span === undefined) {
        throw new ToolContractProjectionError(
          "reviewed_agency_claim_stale",
          "selected reviewed span is not in the current accepted review",
          { operation, field: `agency_claims[${index}].reviewed_span` },
        );
      }
      const authority = authorities.get(authorityName);
      if (
        authority === undefined
        || !authority.claim_types.includes(claimType as ReviewedAgencyClaimType)
      ) {
        throw new ToolContractProjectionError(
          "reviewed_agency_authority_mismatch",
          "selected claim type is not authorized by the current reviewed authority",
          { operation, field: `agency_claims[${index}].authority` },
        );
      }
      const identity = `${reviewedSpan}\u0000${claimType}`;
      if (seen.has(identity)) {
        throw new ToolContractProjectionError(
          "reviewed_agency_claim_invalid",
          "accepted-review semantic agency selections must be unique",
          { operation, field: `agency_claims[${index}]` },
        );
      }
      seen.add(identity);
      const semanticPart = (value: string): string => value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 96);
      return {
        claim_id: (
          `agency-reviewed:${semanticPart(reviewedSpan)}:${semanticPart(claimType)}`
        ),
        claim_type: claimType,
        exact_excerpt: span.exact_excerpt,
        override_id: authority.override_id,
        source_ref: authority.source_ref,
        subject_ref: authority.subject_ref,
      };
    });
    if (hasAgencyClaims) result.agency_claims = normalizedClaims;
    else delete result.agency_claims;
  }
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
    const pending = valid.candidates[0].invocation_mode === "pending_defense";
    if (pending) {
      const candidate = valid.candidates[0];
      const defenseKind = typeof modelInput.defense_kind === "string"
        ? modelInput.defense_kind
        : "";
      if (
        !candidate.allowed_defenses.includes(defenseKind as CombatDefenseKind)
        || Object.hasOwn(modelInput, "action_kind")
        || Object.hasOwn(modelInput, "weapon_id")
        || Object.hasOwn(modelInput, "weapon_effect_ids")
      ) {
        throw new ToolContractProjectionError(
          "semantic_candidate_stale",
          "pending combat defense must use one currently allowed defense and cannot substitute a new weapon/action",
          { operation, candidate_field: "defense_kind" },
        );
      }
      result.action_kind = "defend";
    } else {
      const actionKind = typeof modelInput.action_kind === "string"
        ? modelInput.action_kind
        : "";
      const weaponId = typeof modelInput.weapon_id === "string"
        ? modelInput.weapon_id.trim()
        : "";
      if (
        !["attack", "aim", "reload", "maneuver", "flee"].includes(actionKind)
        || (actionKind === "attack" && !weaponId)
        || Object.hasOwn(modelInput, "defense_kind")
      ) {
        throw new ToolContractProjectionError(
          "semantic_candidate_stale",
          "combat action must use an allowed explicit action; attacks require an exact selected weapon and cannot substitute a defense",
          { operation, candidate_field: "action_kind" },
        );
      }
      const needsCandidate = actionKind === "attack" || actionKind === "maneuver";
      const candidateId = valid.candidates.length === 1
        ? valid.candidates[0].candidate_id
        : typeof result.candidate_id === "string" ? result.candidate_id : "";
      const candidate = valid.candidates.find((row) => row.candidate_id === candidateId);
      if (needsCandidate && !candidate) {
        throw new ToolContractProjectionError(
          "semantic_candidate_stale",
          "selected combat route is not in the current retained semantic candidates",
          { operation, candidate_field: "candidate_id" },
        );
      }
      if (actionKind === "maneuver" && typeof modelInput.goal !== "string") {
        throw new ToolContractProjectionError(
          "semantic_candidate_stale",
          "combat maneuver requires one structured goal",
          { operation, candidate_field: "goal" },
        );
      }
      if (candidate?.invocation_mode === "target_npc_id") {
        result.target_npc_id = candidate.target_npc_id;
      } else if (candidate?.invocation_mode === "affordance_id") {
        result.affordance_id = candidate.affordance_id;
      }
    }
    delete result.candidate_id;
  }
  if (valid.operation === "chase.execute") {
    const command = isPlainObject(modelInput.command)
      ? modelInput.command
      : null;
    if (command === null) {
      throw new ToolContractProjectionError(
        "semantic_candidate_stale",
        "chase command must select one current semantic actor and action",
        { operation, candidate_field: "command" },
      );
    }
    const actor = typeof command.actor === "string" ? command.actor : "";
    const action = typeof command.action === "string" ? command.action : "";
    if (!exactObjectKeys(command, ["actor", "action"])) {
      throw new ToolContractProjectionError(
        "semantic_candidate_stale",
        "chase command must use the closed semantic actor/action schema",
        { operation, candidate_field: "command" },
      );
    }
    const candidate = valid.candidates.find((row) => (
      row.actor_handle === actor
      && row.action_handle === action
    ));
    if (candidate === undefined) {
      throw new ToolContractProjectionError(
        "semantic_candidate_stale",
        "selected chase actor/action is absent or stale in the current snapshot",
        { operation, candidate_field: "command" },
      );
    }
    result.command = {
      command_id: valid.decision_id,
      kind: candidate.kind,
      phase: "resolve",
      payload: {
        decision_id: valid.decision_id,
        revision: valid.chase_revision,
        actor_id: candidate.actor_id,
        action_id: candidate.action_id,
      },
    };
  }
  if (valid.operation === "sanity.execute") {
    const command = isPlainObject(modelInput.command)
      ? modelInput.command
      : null;
    if (
      command === null
      || !exactObjectKeys(command, ["action"])
      || (command.action !== "tick" && command.action !== "end")
    ) {
      throw new ToolContractProjectionError(
        "semantic_candidate_stale",
        "sanity bout command must select exactly one current tick/end action",
        { operation, candidate_field: "command.action" },
      );
    }
    const candidate = valid.candidates.find((row) => (
      row.action === command.action
    ));
    if (candidate === undefined) {
      throw new ToolContractProjectionError(
        "semantic_candidate_stale",
        "selected sanity bout action is absent or stale in the current choice",
        { operation, candidate_field: "command.action" },
      );
    }
    result.decision_id = candidate.decision_id;
    result.command = {
      command_id: candidate.command_id,
      kind: candidate.kind,
      phase: "resolve",
      payload: {
        choice_id: valid.choice_id,
        responder: "keeper",
        revision: valid.choice_revision,
        action: candidate.action,
        terminal_command_ids: [candidate.command_id],
        decision_id: candidate.decision_id,
        request_index: 1,
      },
    };
  }
  return result;
}

/**
 * Return only the independently validated host-owned values for a retained
 * binding. Recovery lanes use this when the semantic model payload is already
 * sealed elsewhere; it must not manufacture an empty model call merely to
 * discover host arguments (coverage/agency validation belongs to the normal
 * bindRetainedTypedToolArguments path).
 */
export function retainedTypedToolHostArguments(
  operation: string,
  binding: TypedToolBindingCard | null | undefined,
  currentHostContext: CurrentTypedToolHostContext | null | undefined,
): Record<string, unknown> {
  const valid = validateBindingCard(operation, binding, currentHostContext);
  return bindingValues(valid);
}

/**
 * Pi-only finalize absence overlay: zero presented obligations are
 * represented structurally as `coverage: []`. The canonical archive is not
 * changed; only the presented schema names the structural empty form so a
 * no-obligation turn is never filled with a placeholder row or sentinel id.
 */
function overlayFinalizeCoverageAbsenceForm(schema: JsonSchema): void {
  if (!isPlainObject(schema.properties)) return;
  const coverage = schema.properties.coverage;
  if (!isPlainObject(coverage)) return;
  const absenceSentence = "when turn.output_context presents no obligations "
    + "(required_obligation_ids empty), submit an empty array — never a "
    + "placeholder row or invented obligation id";
  const current = typeof coverage.description === "string"
    ? coverage.description.trim()
    : "";
  coverage.description = current
    ? `${current.replace(/\.+$/, ".")} ${absenceSentence}.`
    : `${absenceSentence}.`;
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
  if (operation === "sanity.execute") {
    const cloned = handleOverlayed;
    if (!isPlainObject(cloned.properties)) return cloned;
    const sanityPayload = {
      type: "object",
      additionalProperties: false,
      properties: {
        source: { type: "string" },
        reason: { type: "string" },
        trigger_id: { type: "string" },
        san_loss_success: {
          oneOf: [{ type: "integer", minimum: 0 }, { type: "string" }],
        },
        san_loss_fail_expr: { type: "string" },
        involuntary_kind: {
          type: "string",
          enum: [
            "jump_in_fright",
            "cry_out",
            "involuntary_movement",
            "involuntary_combat_action",
            "freeze",
          ],
        },
        involuntary_summary: { type: "string" },
        alone: { type: "boolean" },
        creature_type: { type: "string" },
        module_bout_override: { type: "object", additionalProperties: true },
      },
      required: ["source", "san_loss_fail_expr"],
    };
    const boutBranch = (action: "tick" | "end") => ({
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", const: action },
      },
      required: ["action"],
    });
    cloned.properties.command = {
      description: (
        "Semantic sanity command. For a pending sanity check, provide only "
        + "the meaningful payload; the host binds kind, phase, command, and "
        + "idempotency identity. Bout continuation keeps its explicit kind."
      ),
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: { payload: sanityPayload },
          required: ["payload"],
        },
        boutBranch("tick"),
        boutBranch("end"),
      ],
    };
    overlayClosedIdentityGrammarDescriptions(cloned);
    return cloned;
  }
  if (operation === "turn.finalize") {
    overlayFinalizeCoverageAbsenceForm(handleOverlayed);
  }
  if (operation !== "rules.social_adjudicate") {
    overlayClosedIdentityGrammarDescriptions(handleOverlayed);
    return handleOverlayed;
  }
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
  overlayClosedIdentityGrammarDescriptions(cloned);
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
  "transaction_sha256",
  "record_digest",
]);

/**
 * Operation-declared output identity projection registry. Each entry adds
 * operation-local handling for identity/integrity-bearing fields whose
 * disposition differs from the shared closed model-facing identity grammar:
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
 * tables. Model-authored decisions, composed ids, and exact handles already
 * classified by the closed grammar stay semantic on canonical result paths;
 * operation-local host-only and integrity dispositions take precedence.
 * Echoed entity/provenance fields remain operation-local. Any other
 * identity/integrity-like path — including plausible semantic slugs under an
 * unknown field name — fails closed with exact path diagnostics. There is no
 * open field-name or value-shape fallback and no silent deletion.
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
 * Authored RuleGraph identities carried by every model-visible
 * RuleDecisionCard. These are meaning-bearing graph node ids, not registry
 * handles: the model copies `decision_ref` into rules.settle while
 * `capability_ref` remains explanatory card context. The same declaration is
 * reused by direct scene context, exact rules context, and the identical
 * scene-context sub-document embedded by session.resume.
 */
const RULE_DECISION_CARD_SEMANTIC_IDENTITY_FIELDS = [
  "decision_ref", "capability_ref", "rule_refs", "effect_refs",
  "possible_continuations",
] as const;

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
  ...RULE_DECISION_CARD_SEMANTIC_IDENTITY_FIELDS,
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
      "campaign_id", "clue_id", "deflect_id", "fact_id", "known_fact_ids", "npc_id",
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
  ["director.advise", declaredIdentityTable(
    [
      "active_scene_id", "clock_id", "front_id", "id", "location_id",
      "npc_id", "san_trigger_id",
    ],
    [],
    ["decision_id", "monster_ref"],
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
    [
      "attempt_id", "decision_id", "npc_id", "original_check_decision_id",
      "rule_ref", "scene_id",
    ],
    [],
    ["social_adjudication_ref", "social_goal_key"],
  )],
  ["rules.push", declaredIdentityTable(
    ["attempt_id", "decision_id", "original_check_decision_id", "scene_id"],
    ["integrity_digest"],
  )],
  ["rules.luck_spend", declaredIdentityTable(
    ["decision_id", "rule_ref"],
    ["integrity_digest"],
  )],
  ["rules.damage", declaredIdentityTable(
    [],
    [],
    ["roll_id"],
  )],
  ["rules.build_scale", declaredIdentityTable(
    [],
    [],
    ["rule_ref"],
  )],
  ["rules.social_adjudicate", declaredIdentityTable(
    ["npc_id", "commitment_id"],
    ["record_digest", "source_digest", "request_digest"],
    ["conversation_window_id", "social_adjudication_ref", "source_ref"],
  )],
  ["rules.psychology_observe", declaredIdentityTable(
    ["source_ref"],
    ["record_digest", "request_digest"],
    ["insight_id", "conversation_window_id"],
  )],
  ["rules.catalog_search", declaredIdentityTable(
    ["entity_id", "price_id", "ruleset_id"],
    [],
  )],
  ["magic.cast", declaredIdentityTable(
    [],
    [],
    ["operation_id"],
  )],
  ["magic.learn", declaredIdentityTable(
    [],
    [],
    ["completion_trigger_id", "operation_id"],
  )],
  ["rules.skill_describe", declaredIdentityTable(
    ["catalog_skill_ids", "id"],
    [],
  )],
  ["rules.context", declaredIdentityTable(
    RULE_DECISION_CARD_SEMANTIC_IDENTITY_FIELDS,
    [],
  )],
  ["rules.settle", declaredIdentityTable(
    [
      "actor_id", "capability_ref", "caregiver_id", "day_id", "decision_ref",
      "rescuer_id", "rule_ref", "rule_refs", "wound_id",
    ],
    ["request_digest"],
    ["command_id", "roll_id", "source_command_id", "state_refs"],
  )],
  ["state.advance_time", declaredIdentityTable(
    ["civil_segment_id", "location_id", "source_ref"],
    [],
  )],
  ["state.exceptional_effect", declaredIdentityTable(
    ["scene_id", "subject_id", "restriction_id", "target_id"],
    ["integrity_digest"],
    ["event_id"],
  )],
  ["mechanics.ensure", declaredIdentityTable(
    ["actor_id", "affordance_id", "stable_id", "subject_id"],
    ["content_sha256"],
    ["monster_ref"],
  )],
  ["rules.sanity_check", declaredIdentityTable(
    ["trigger_id", "rule_ref"],
    [],
    ["active_bout_id", "bout_id", "command_id", "decision_id", "event_id"],
  )],
  ["sanity.execute", declaredIdentityTable(
    ["san_trigger_id", "rule_ref"],
    [],
    [
      "bout_id", "choice_id", "command_id", "decision_id", "event_id",
      "source_command_id", "state_refs", "trigger_id",
    ],
  )],
  ["sanity.context", declaredIdentityTable(
    ["rule_ref"],
    [],
    [
      "active_bout_id", "bout_id", "choice_id", "command_id", "event_id",
      "state_refs", "trigger_id",
    ],
  )],
  ["combat.resolve", declaredIdentityTable(
    [
      "actor_id", "combat_id", "id", "investigator_id", "rule_ref",
      "scene_ref", "source_actor_id", "target_actor_id",
    ],
    ["transaction_sha256"],
    [
      "command_id", "damage_roll_id", "event_id", "executor_id",
      "attack_command_id", "opposed_roll_id", "resolution_command_id", "skill_owner_id",
      "source_command_id", "source_turn_id", "state_refs", "turn_id",
    ],
  )],
  ["combat.end", declaredIdentityTable(
    [],
    ["projection_sha256"],
  )],
  ["combat.context", declaredIdentityTable(
    ["actor_id", "combat_id", "scene_ref", "target_actor_id"],
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
  ["state.journal", declaredIdentityTable(
    ["decision_id", "item_id", "thread_id"],
    [],
  )],
  ["state.end_session", declaredIdentityTable(
    ["scene_id", "rule_ref", "scenario_san_reward_rule_ref"],
    [],
  )],
  ["turn.output_context", declaredIdentityTable(
    [
      "authorized_entity_refs", "authorized_route_ids", "clock_id", "clue_id",
      "decision_id", "family_id", "front_id", "last_storylet_id",
      "location_id", "npc_id", "required_obligation_ids", "run_segment_id",
      "restriction_id", "scene_id", "source_ref", "storylet_id",
      "subject_id", "target_id", "trope_id",
    ],
    ["contract_projection_sha256", "mechanics_bundle_sha256", "source_digest", "text_sha256"],
    ["event_id", "source_decision_id", "source_id", "source_receipt_id"],
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
 * Globally declared host-semantic fields whose meaning is operation-neutral:
 * contract ids may appear in any bounded fault receipt, and civil segment ids
 * are the canonical time-coordinate vocabulary shared by state mutations.
 * Values still pass the closed semantic grammar; unknown namespaced or
 * entropy-bearing values fail closed.
 */
const GLOBAL_SEMANTIC_IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  "contract_id",
  "civil_segment_id",
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
  if (operation !== null) {
    const declarations = OPERATION_IDENTITY_DECLARATIONS.get(operation);
    // Operation-local privacy/integrity rules override the shared semantic
    // grammar. For example, npc.query source_ref remains host-only even
    // though source_ref is a closed model-facing semantic field elsewhere.
    if (declarations?.hostOnly.has(field)) return "host_only";
    if (declarations?.integrity.has(field)) return "integrity";
    if (declarations?.semantic.has(field)) return "semantic";
  }
  if (GLOBAL_SEMANTIC_IDENTITY_FIELDS.has(field)) return "semantic";
  // One classifier already inventories identities authored by the model.
  // Composed ids, decisions, and exact semantic handles remain the same
  // contract when the canonical result nests them, so reuse that classifier
  // instead of duplicating the field under every emitting operation. Echoed
  // canonical entity/provenance/vocabulary fields remain operation-local and
  // registry-backed; this does not open the path boundary for scene/item/etc.
  const modelGrammar = closedIdentityGrammarSpec(field);
  if (
    modelGrammar?.kind === "decision"
    || modelGrammar?.kind === "composed"
    || modelGrammar?.kind === "handle_only"
  ) return "semantic";
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
  if (
    field === "subject_ref"
    && typeof value === "string"
    && value.startsWith("pc:")
  ) {
    return { action: "keep", value: CURRENT_PC_SUBJECT_HANDLE };
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
  // rules.skill_describe uses the canonical skill names themselves as its
  // catalog identities (for example "Library Use" and
  // "Firearms (Rifle/Shotgun)"). They are meaning-bearing rule vocabulary,
  // not generic slug-shaped entity ids, so validate them against the opaque
  // identity boundary without forcing the generic slug grammar.
  if (
    operation === "rules.skill_describe"
    && field === "catalog_skill_ids"
  ) {
    if (!Array.isArray(value)) {
      diagnostics?.unmapped.push({
        field,
        parentField,
        domain: "skill_catalog",
        path: fieldPath,
      });
      return { action: "drop" };
    }
    const members: string[] = [];
    for (const entry of value) {
      const safe = typeof entry === "string"
        && entry.length > 0
        && entry.length <= 160
        && entry === entry.trim()
        && !RAW_REJECTED_PREFIXES.some((prefix) => entry.startsWith(prefix))
        && !violatesSemanticIdentityGrammar(entry);
      if (safe) {
        members.push(entry);
      } else {
        diagnostics?.unmapped.push({
          field,
          parentField,
          domain: "skill_catalog",
          path: fieldPath,
        });
      }
    }
    return { action: "keep", value: members };
  }
  // Closed field classification: an identity/integrity-bearing path that is
  // neither operation-local nor part of the shared model-authored grammar is
  // unknown STRING evidence — it fails closed regardless of value shape. A
  // semantic-looking slug under an unclassified field name is still
  // undeclared. Non-string values (counts, nested objects) recurse as before;
  // host-rewritten current-entity handles skip only this declaration gate.
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
  ["investigator_roll_id", "roll:"],
  ["opponent_roll_id", "roll:"],
  ["check_roll_id", "roll:"],
  ["int_roll_id", "roll:"],
  ["bout_duration_roll_id", "roll:"],
  ["bout_table_roll_id", "roll:"],
  ["bout_rounds_roll_id", "roll:"],
  ["mania_roll_id", "roll:"],
  ["phobia_roll_id", "roll:"],
  ["loss_roll_id", "roll:"],
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
  ["session_roll_ids", "roll:"],
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
  "first-impression:", "sanity_bout:",
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
    operation === "rules.psychology_observe"
    && parentField === "observable_fact_refs"
    && field === "source_ref"
    && typeof value === "string"
  ) {
    if (isNpcFactEvidenceRef(value)) return { action: "keep", value };
    diagnostics?.unmapped.push({ field, parentField, domain: "evidence" });
    return { action: "drop" };
  }
  // continuation_delta.do_not_repeat[].item_id names a semantic memory note,
  // not an inventory entity. Keep that operation-owned journal identity in
  // the closed grammar instead of consulting the live item registry.
  if (
    operation === "state.journal"
    && parentField === "do_not_repeat"
    && field === "item_id"
  ) {
    return null;
  }
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
/** Evidence-bound RuleGraph source span: semantic page/block coordinates. */
const RULE_SOURCE_SPAN_REF = /^span-[a-z0-9]+(?:-[a-z0-9]+)+$/;
const PROVENANCE_SOURCE_NAMESPACES = stringSet(["pdf:", "module:", "source:", "handout:"]);
const RULE_DECISION_REF_NAMESPACE = stringSet(["decision:"]);
const RULE_CAPABILITY_REF_NAMESPACE = stringSet(["capability:"]);
const RULE_RULE_REF_NAMESPACE = stringSet(["rule:"]);
const RULE_EFFECT_REF_NAMESPACE = stringSet(["effect:"]);

function projectProvenanceMember(member: unknown): unknown {
  if (typeof member === "string") {
    return (
      PDF_PAGE_REF.test(member)
      || (
        RULE_SOURCE_SPAN_REF.test(member)
        && !violatesSemanticIdentityGrammar(member)
      )
    ) ? member : null;
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
 * Apply the closed source-ref grammar specifically to RuleDecisionCards.
 * Generic provenance projections may safely omit mixed host audit members;
 * a RuleDecisionCard is different because its source refs are part of the
 * model-facing evidence contract. One malformed card source therefore emits
 * a bounded diagnostic and makes the gateway fail closed rather than quietly
 * presenting a source-less decision.
 */
function projectRuleDecisionCard(
  card: unknown,
  diagnostics: ProjectionIdentityDiagnostics | null,
  path: string,
): unknown {
  if (!isPlainObject(card)) return card;
  const projected = { ...card };
  for (const [field, namespaces] of [
    ["decision_ref", RULE_DECISION_REF_NAMESPACE],
    ["capability_ref", RULE_CAPABILITY_REF_NAMESPACE],
  ] as const) {
    const value = card[field];
    if (
      typeof value === "string"
      && isNamespacedSemantic(value, namespaces)
    ) continue;
    diagnostics?.unmapped.push({
      field,
      parentField: "cards",
      domain: field === "decision_ref" ? "decision" : "capability",
      path: `${path}.${field}`,
    });
    delete projected[field];
  }
  for (const [field, namespaces, domain] of [
    ["rule_refs", RULE_RULE_REF_NAMESPACE, "rule"],
    ["effect_refs", RULE_EFFECT_REF_NAMESPACE, "effect"],
    ["possible_continuations", RULE_DECISION_REF_NAMESPACE, "decision"],
  ] as const) {
    if (!Object.hasOwn(card, field)) continue;
    const values = card[field];
    if (!Array.isArray(values)) {
      diagnostics?.unmapped.push({
        field,
        parentField: "cards",
        domain,
        path: `${path}.${field}`,
      });
      delete projected[field];
      continue;
    }
    const safeValues: string[] = [];
    for (const value of values) {
      if (
        typeof value === "string"
        && isNamespacedSemantic(value, namespaces)
      ) {
        safeValues.push(value);
        continue;
      }
      diagnostics?.unmapped.push({
        field,
        parentField: "cards",
        domain,
        path: `${path}.${field}`,
      });
    }
    projected[field] = safeValues;
  }
  if (!Object.hasOwn(card, "source_refs")) return projected;
  const sourceRefs = card.source_refs;
  if (!Array.isArray(sourceRefs)) {
    diagnostics?.unmapped.push({
      field: "source_refs",
      parentField: "cards",
      domain: "provenance",
      path: `${path}.source_refs`,
    });
    delete projected.source_refs;
    return projected;
  }
  const safeRefs: unknown[] = [];
  for (const sourceRef of sourceRefs) {
    const safe = typeof sourceRef === "string"
      && (
        PDF_PAGE_REF.test(sourceRef)
        || RULE_SOURCE_SPAN_REF.test(sourceRef)
        || isNamespacedSemantic(sourceRef, PROVENANCE_SOURCE_NAMESPACES)
      )
      && !violatesSemanticIdentityGrammar(sourceRef)
        ? sourceRef
        : null;
    if (safe === null) {
      diagnostics?.unmapped.push({
        field: "source_refs",
        parentField: "cards",
        domain: "provenance",
        path: `${path}.source_refs`,
      });
      continue;
    }
    safeRefs.push(safe);
  }
  projected.source_refs = safeRefs;
  return projected;
}

function projectRuleDecisionCardBlock(
  block: Record<string, unknown>,
  diagnostics: ProjectionIdentityDiagnostics | null,
  path: string,
): Record<string, unknown> {
  if (!Array.isArray(block.cards)) return { ...block };
  return {
    ...block,
    cards: block.cards.map((card, index) =>
      projectRuleDecisionCard(card, diagnostics, `${path}.cards[${index}]`)
    ),
  };
}

/**
 * Structured recursive model-content sanitizer: drops wire/integrity/cache/
 * archive/job/packet/receipt identity fields and rewrites current-entity
 * references to semantic handles. Semantic substance passes unchanged.
 * Operation-aware: identity/integrity-bearing paths are judged against the
 * shared closed model-authored grammar plus operation-local overrides;
 * unclassified paths fail closed with exact path diagnostics regardless of
 * their value shape.
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
    if (
      operation === "session.resume"
      && parentField === "recent_summaries"
      && (field === "source_ref" || field === "summary_sha256")
    ) continue;
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
    // explicit projectors above declined must be classified by the shared
    // model-authored grammar or an operation-local override AND pass the closed
    // semantic value grammar. Host-rewritten current-entity handles are the
    // closed projector output and skip only the field-classification gate.
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
  "after a clear Pi review, select reviewed_span + claim_type + authority "
    + "from the refreshed finalize binding; the host attaches the frozen "
    + "draft and exact agency evidence",
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
 * Closed model view of the canonical Social adjudication receipt. The exact
 * goal key is a host-owned correlation into the one canonical social roll;
 * the Keeper consumes the goal, approach, feasibility, and difficulty, never
 * the digest-backed lookup key.
 */
function projectSocialAdjudicationData(
  value: Record<string, unknown>,
  semanticIds: SemanticIdMap | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
  fieldPath = "",
): Record<string, unknown> {
  const view = { ...value };
  delete view.goal_key;
  return stripOpaqueModelIdentity(
    view,
    null,
    semanticIds,
    diagnostics,
    "rules.social_adjudicate",
    fieldPath,
  ) as Record<string, unknown>;
}

/**
 * RuleGraph composes a Social adjudication and its already-executed bound
 * D100 under `rules.settle`. Project each embedded canonical family through
 * its own closed identity contract instead of judging the whole composite as
 * flat rules.settle output. The machine-derived bound-check plan is internal:
 * after settlement it has no model consumer and exposing it would invite a
 * duplicate roll. Unknown identity fields in the retained branches still run
 * through the normal V4 fail-closed discovery path.
 */
function projectSocialRulesSettleData(
  data: Record<string, unknown>,
  semanticIds: SemanticIdMap | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
): Record<string, unknown> {
  const settlement = isPlainObject(data.settlement) ? data.settlement : null;
  const result = settlement !== null && isPlainObject(settlement.result)
    ? settlement.result
    : null;
  const adjudication = result !== null && isPlainObject(result.adjudication)
    ? result.adjudication
    : null;
  const boundCheck = result !== null && isPlainObject(result.bound_check)
    ? result.bound_check
    : null;
  if (settlement === null || result === null || adjudication === null) {
    return sanitizeEnvelopeBranch(
      data,
      semanticIds,
      diagnostics,
      "rules.settle",
    ) as Record<string, unknown>;
  }

  const genericResult: Record<string, unknown> = { ...result };
  delete genericResult.adjudication;
  delete genericResult.bound_check;
  // The plan has already been consumed by the host-owned adapter. Outer
  // next_decisions carries any remaining semantic continuation.
  delete genericResult.bound_check_plan;
  const genericData: Record<string, unknown> = {
    ...data,
    settlement: {
      ...settlement,
      result: genericResult,
    },
  };
  const projected = sanitizeEnvelopeBranch(
    genericData,
    semanticIds,
    diagnostics,
    "rules.settle",
  ) as Record<string, unknown>;
  const projectedSettlement = isPlainObject(projected.settlement)
    ? projected.settlement
    : null;
  const projectedResult = projectedSettlement !== null
    && isPlainObject(projectedSettlement.result)
    ? projectedSettlement.result
    : null;
  if (projectedSettlement === null || projectedResult === null) return projected;

  const settledAdjudication: Record<string, unknown> = { ...adjudication };
  // This instruction produced bound_check and is no longer actionable.
  delete settledAdjudication.roll_operation;
  projectedResult.adjudication = projectSocialAdjudicationData(
    settledAdjudication,
    semanticIds,
    diagnostics,
    "settlement.result.adjudication",
  );
  if (boundCheck !== null) {
    const boundCheckView: Record<string, unknown> = { ...boundCheck };
    // The bound check is already complete. Its canonical roll identity is
    // retained in host details; later semantic continuations come from the
    // outer next_decisions rather than by relaying this opaque id.
    delete boundCheckView.roll_id;
    projectedResult.bound_check = stripOpaqueModelIdentity(
      boundCheckView,
      null,
      semanticIds,
      diagnostics,
      "rules.roll",
      "settlement.result.bound_check",
    );
  }
  projectedSettlement.result = projectedResult;
  projected.settlement = projectedSettlement;
  return projected;
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
  "journal_context",
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

function selectedFields(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields.filter((field) => field in source).map((field) => [field, source[field]]),
  );
}

function projectDevelopmentMechanics(value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null;
  const projected = selectedFields(value, [
    "schema_version", "rendered_lines", "rendered_text", "complete",
  ]);
  if (Array.isArray(value.required_roll_ids)) {
    projected.required_roll_count = value.required_roll_ids.length;
  }
  if (Array.isArray(value.missing_roll_ids)) {
    projected.missing_roll_count = value.missing_roll_ids.length;
  }
  return projected;
}

/** Closed state.end_session view: ending disposition plus public settlement. */
function projectEndSessionData(
  data: Record<string, unknown>,
  semanticIds: SemanticIdMap | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
): Record<string, unknown> {
  const view = selectedFields(
    data,
    ["session_ending", "kind", "reason", "scene_id", "player_visible", "status"],
  );
  const development = isPlainObject(data.development) ? data.development : null;
  if (development !== null) {
    const developmentView = selectedFields(development, ["status"]);
    if (Array.isArray(development.settlements)) {
      developmentView.settlements = development.settlements.flatMap((entry) => {
        if (!isPlainObject(entry)) return [];
        const settlement = selectedFields(
          entry,
          ["investigator_id", "status", "attempts"],
        );
        const receipt = isPlainObject(entry.receipt) ? entry.receipt : null;
        if (receipt === null) return [settlement];
        const receiptView = selectedFields(
          receipt,
          ["schema_version", "status", "kind"],
        );
        const result = isPlainObject(receipt.result) ? receipt.result : null;
        if (result !== null) {
          const resultView = selectedFields(result, [
            "skills_checked", "san_reward_expr", "san_reward_planned_delta",
            "scenario_san_reward_expr", "scenario_san_reward_planned_delta",
            "scenario_san_reward_applied", "merge_policy",
          ]);
          for (const field of ["improvement_checks", "skills_improved"] as const) {
            if (Array.isArray(result[field])) {
              resultView[field] = result[field].flatMap((row) =>
                isPlainObject(row)
                  ? [selectedFields(row, [
                    "skill", "check_roll", "gain", "value_before",
                    "planned_value_after", "current_value_before_apply",
                    "applied_delta", "value_after", "improved", "merge_policy",
                  ])]
                  : []
              );
            }
          }
          for (const field of [
            "san_reward", "san_reward_roll", "development_san_reward",
            "scenario_san_reward", "scenario_san_reward_roll",
          ] as const) {
            if (isPlainObject(result[field])) {
              resultView[field] = selectedFields(result[field], [
                "expression", "rolls", "total", "planned_san_before",
                "planned_san_delta", "san_before", "san_gained", "san_after",
                "san_max", "value_before", "applied_delta", "value_after",
                "replayed", "rule_ref",
              ]);
            }
          }
          if (isPlainObject(result.luck_recovery)) {
            resultView.luck_recovery = selectedFields(result.luck_recovery, [
              "roll", "success", "gained", "luck_before", "luck_after",
              "planned_luck_before", "planned_luck_after", "planned_gained",
              "current_luck_before_apply", "applied_delta", "merge_policy",
              "rule_ref",
            ]);
          }
          const endingEvidence = isPlainObject(result.ending_evidence)
            ? result.ending_evidence
            : null;
          if (
            endingEvidence !== null
            && typeof endingEvidence.scenario_san_reward_rule_ref === "string"
          ) {
            resultView.scenario_san_reward_rule_ref =
              endingEvidence.scenario_san_reward_rule_ref;
          }
          const mechanics = projectDevelopmentMechanics(
            result.player_facing_mechanics,
          );
          if (mechanics !== null) resultView.player_facing_mechanics = mechanics;
          receiptView.result = resultView;
        }
        const mechanics = projectDevelopmentMechanics(
          receipt.player_facing_mechanics,
        );
        if (mechanics !== null) receiptView.player_facing_mechanics = mechanics;
        settlement.receipt = receiptView;
        return [settlement];
      });
    }
    view.development = developmentView;
  }
  return sanitizeEnvelopeBranch(
    view,
    semanticIds,
    diagnostics,
    "state.end_session",
  ) as Record<string, unknown>;
}

function projectOutputContextContractProjection(data: Record<string, unknown>): unknown {
  const raw = isPlainObject(data.contract_projection)
    ? data.contract_projection
    : {};
  const narrowed: Record<string, unknown> = {};
  const playerInput = isPlainObject(raw.player_input)
    ? raw.player_input
    : null;
  if (playerInput !== null && typeof playerInput.text === "string") {
    // Exact player semantics are needed when a fresh host resumes a settled
    // but unfinished turn. Source identity and text digest remain host-only.
    narrowed.player_input_text = playerInput.text;
  }
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

/**
 * One recovery-card model view, driven by the same host-owned argument table
 * and model-call split used by the invoke-time binder. Canonical cards stay
 * untouched in gateway `details`; this view retains only model-owned
 * prefilled/missing arguments plus the names of fields the host will attach.
 * No recovery caller maintains a second per-field identity list.
 */
function projectRecoveryOperationCard(
  card: unknown,
  modelCall: unknown,
): Record<string, unknown> | null {
  if (!isPlainObject(card) || typeof card.operation !== "string") return null;
  const operation = card.operation;
  const hostOwned = new Set(
    (HOST_OWNED_FIELDS as Record<string, readonly string[] | undefined>)[operation]
      ?? [],
  );
  const call = isPlainObject(modelCall) ? modelCall : null;
  const declaredHostBound = Array.isArray(call?.host_bound_auto_attached_arguments)
    ? call.host_bound_auto_attached_arguments.filter(
        (field): field is string => typeof field === "string" && field.length > 0,
      )
    : [];
  for (const field of declaredHostBound) hostOwned.add(field);
  const prefilled = isPlainObject(card.prefilled_arguments)
    ? card.prefilled_arguments
    : {};
  const modelPrefilled: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(prefilled)) {
    if (!hostOwned.has(field)) modelPrefilled[field] = structuredClone(value);
  }
  const missing = Array.isArray(card.missing_arguments)
    ? card.missing_arguments.filter(
        (field): field is string => typeof field === "string" && !hostOwned.has(field),
      )
    : [];
  const projected: Record<string, unknown> = {
    operation,
    ...(typeof card.invoke_via === "string" ? { invoke_via: card.invoke_via } : {}),
    prefilled_arguments: modelPrefilled,
    missing_arguments: missing,
    host_bound_auto_attached_arguments: declaredHostBound.length > 0
      ? [...declaredHostBound]
      : [...hostOwned].sort(),
  };
  for (const field of [
    "discovery_required",
    "authority",
    "hard_gate",
    "hard_gate_scope",
    "host_state_claim_compiler_required",
    "coverage_contract",
    "span_repairs",
  ]) {
    if (field in card) projected[field] = structuredClone(card[field]);
  }
  return projected;
}

/**
 * Operation-aware session.resume recovery projection. The recovery builder
 * may retain exact canonical cards for host audit/binding; the model view
 * projects every review/finalize card through `projectRecoveryOperationCard`
 * and suppresses accepted-review evidence as an executable review action.
 */
function projectSessionRecoveryGuidance(
  guidance: unknown,
): Record<string, unknown> | null {
  if (!isPlainObject(guidance)) return null;
  const projected = structuredClone(guidance);
  const modelCalls = isPlainObject(projected.model_calls)
    ? projected.model_calls
    : null;
  const reviewRecovery = isPlainObject(projected.review_recovery)
    ? projected.review_recovery
    : null;
  if (reviewRecovery !== null) {
    delete reviewRecovery.revision;
    if (reviewRecovery.card !== undefined) {
      const card = projectRecoveryOperationCard(
        reviewRecovery.card,
        modelCalls?.review,
      );
      if (card === null) delete reviewRecovery.card;
      else reviewRecovery.card = card;
    }
  }
  const then = isPlainObject(projected.then) ? projected.then : null;
  if (then !== null && then.card !== undefined) {
    const card = projectRecoveryOperationCard(then.card, modelCalls?.finalize);
    if (card === null) delete then.card;
    else then.card = card;
  }
  const accepted = isPlainObject(projected.accepted_review)
    ? projected.accepted_review
    : null;
  if (accepted !== null) {
    projected.accepted_review = {
      ...(typeof accepted.status === "string" ? { status: accepted.status } : {}),
      ...(typeof accepted.instruction === "string"
        ? { instruction: accepted.instruction }
        : {}),
    };
    // Accepted review evidence is not another executable review operation.
    delete projected.review_recovery;
    if (then !== null && isPlainObject(then.finalize_input)) {
      const input = then.finalize_input;
      then.finalize_input = {
        ...(typeof input.visibility === "string"
          ? { visibility: input.visibility }
          : {}),
        ...(typeof input.source === "string" ? { source: input.source } : {}),
        ...(typeof input.mode === "string" ? { mode: input.mode } : {}),
        ...(Array.isArray(input.reviewed_spans)
          ? {
              reviewed_spans: input.reviewed_spans.filter(
                (entry): entry is string => typeof entry === "string",
              ),
            }
          : {}),
        ...(Array.isArray(input.authorities)
          ? {
              authorities: input.authorities.flatMap((entry) => {
                const authority = isPlainObject(entry) ? entry : null;
                if (authority === null || typeof authority.authority !== "string") {
                  return [];
                }
                return [{
                  authority: authority.authority,
                  claim_types: Array.isArray(authority.claim_types)
                    ? authority.claim_types.filter(
                        (claim): claim is string => typeof claim === "string",
                      )
                    : [],
                }];
              }),
            }
          : {}),
        ...(Array.isArray(input.coverage_obligations)
          ? {
              coverage_obligations: input.coverage_obligations.flatMap((entry) => {
                const row = isPlainObject(entry) ? entry : null;
                if (row === null || typeof row.obligation !== "string") {
                  return [];
                }
                return [{
                  obligation: row.obligation,
                  ...(typeof row.source_kind === "string"
                    ? { source_kind: row.source_kind }
                    : {}),
                  ...(typeof row.visibility === "string"
                    ? { visibility: row.visibility }
                    : {}),
                  ...(typeof row.npc_display_name === "string"
                    ? { npc_display_name: row.npc_display_name }
                    : {}),
                  ...(typeof row.skill === "string" ? { skill: row.skill } : {}),
                  ...(typeof row.goal === "string" ? { goal: row.goal } : {}),
                  ...(typeof row.outcome === "string" ? { outcome: row.outcome } : {}),
                  ...(typeof row.exceptional_required === "boolean"
                    ? { exceptional_required: row.exceptional_required }
                    : {}),
                  allowed_reviewed_spans: Array.isArray(row.allowed_reviewed_spans)
                    ? row.allowed_reviewed_spans.filter(
                        (span): span is string => typeof span === "string",
                      )
                    : [],
                  ...(typeof row.realization === "string"
                    ? { realization: row.realization }
                    : {}),
                  ...(typeof row.placement_mode === "string"
                    ? { placement_mode: row.placement_mode }
                    : {}),
                }];
              }),
            }
          : {}),
        ...(isPlainObject(input.mechanics_placement)
          ? {
              mechanics_placement: {
                mode: input.mechanics_placement.mode,
                public_check_count: input.mechanics_placement.public_check_count,
                state_delta_count: input.mechanics_placement.state_delta_count,
                exceptional_effect_count:
                  input.mechanics_placement.exceptional_effect_count,
              },
            }
          : {}),
        ...(Array.isArray(input.model_arguments)
          ? {
              model_arguments: input.model_arguments.filter(
                (entry): entry is string => (
                  entry === "coverage" || entry === "agency_claims"
                ),
              ),
            }
          : {}),
        ...(typeof input.instruction === "string"
          ? { instruction: input.instruction }
          : {}),
      };
    }
  }
  return projected;
}

function projectOpenTurnPlayerInput(value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null;
  if (
    value.schema_version !== 1
    || value.kind !== "accepted_player_input"
    || value.audience !== "keeper_only"
    || typeof value.text !== "string"
    || !value.text.trim()
    || value.speaker !== "player"
    || value.intent_source !== "external_player_message"
    || Object.keys(value).some((key) => ![
      "schema_version",
      "kind",
      "audience",
      "text",
      "speaker",
      "intent_source",
    ].includes(key))
  ) return null;
  return {
    schema_version: 1,
    kind: "accepted_player_input",
    audience: "keeper_only",
    text: value.text,
    speaker: "player",
    intent_source: "external_player_message",
  };
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
    ...(declarations?.semantic ?? []),
    ...(declarations?.integrity ?? []),
    ...(declarations?.hostOnly ?? []),
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
    // Candidate factors embed canonical operation results. Project each
    // result through its OWN operation declaration below; walking it as an
    // outer turn.output_context branch would misclassify operation-local
    // identities (for example rules.build_scale rule_ref).
    if (field === "candidate_factors") continue;
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
  if (Array.isArray(data.candidate_factors)) {
    projected.candidate_factors = data.candidate_factors.map((entry) => {
      if (!isPlainObject(entry)) return entry;
      const candidateOperation = typeof entry.tool === "string"
        ? entry.tool
        : null;
      return stripOpaqueModelIdentity(
        entry,
        null,
        semanticIds,
        diagnostics,
        candidateOperation,
      );
    });
  }
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
  if (isPlainObject(data.rule_decision_cards)) {
    view.rule_decision_cards = projectRuleDecisionCardBlock(
      data.rule_decision_cards,
      diagnostics,
      "rule_decision_cards",
    );
  }
  const recovery = isPlainObject(data.recovery) ? data.recovery : null;
  const healing = recovery !== null && isPlainObject(recovery.healing)
    ? recovery.healing
    : null;
  if (recovery !== null && healing !== null) {
    view.recovery = {
      ...recovery,
      healing: projectRuleDecisionCardBlock(
        healing,
        diagnostics,
        "recovery.healing",
      ),
    };
  }
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
  // Campaign 04/05/10 point of use: every actionable route in the model
  // view carries an exact copy-verbatim `affordance_id` handle (the
  // registry's affordance family for the same canonical route id). The
  // `route_id` keeps its own `route:` family for route consumers — the two
  // namespaces stay separate; the KP copies the affordance handle into
  // `actions.advise` matched/selected affordance id fields and the host
  // restores the canonical id before transport. Rows without a live
  // affordance mapping project without the field (fail closed).
  for (const arrayField of ["action_routes", "route_index"]) {
    const rows = Array.isArray(data[arrayField]) ? data[arrayField] : null;
    if (rows === null || rows.length === 0) continue;
    view[arrayField] = rows.map((row) => {
      if (!isPlainObject(row)) return row;
      const routeId = typeof row.route_id === "string" ? row.route_id : "";
      if (!routeId || semanticIds === null) return row;
      const canonical = routeId.startsWith("route:")
        ? routeId.slice("route:".length)
        : routeId;
      const handle = semanticIds.affordances.get(canonical);
      if (handle === undefined) return row;
      return { ...row, affordance_id: handle };
    });
  }
  return sanitizeEnvelopeBranch(
    view,
    semanticIds,
    diagnostics,
    "scene.context",
  ) as Record<string, unknown>;
}

function chaseSemanticHandle(
  prefix: "actor" | "location" | "chase",
  value: unknown,
  diagnostics: ProjectionIdentityDiagnostics | null,
  path: string,
): string | null {
  if (typeof value !== "string" || !isSemanticSlugShape(value)) {
    diagnostics?.unmapped.push({
      field: prefix,
      parentField: prefix,
      domain: "chase",
      path,
    });
    return null;
  }
  return `${prefix}:${value}`;
}

/**
 * Derive the legal next-location action set from one exact active ChaseSession
 * snapshot. Canonical actor/action ids stay in the host binding; only the
 * semantic handles are projected to the model.
 */
export function deriveChaseActionCandidates(
  data: Record<string, unknown>,
  diagnostics: ProjectionIdentityDiagnostics | null = null,
): ChaseActionCandidate[] {
  const snapshot = isPlainObject(data.snapshot) ? data.snapshot : null;
  if (data.active !== true || snapshot?.status !== "active") return [];
  const locations = (Array.isArray(snapshot.location_chain)
    ? snapshot.location_chain
    : []).filter(isPlainObject);
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const location of locations) {
    if (Number.isInteger(location.index)) {
      byIndex.set(Number(location.index), location);
    }
  }
  const candidates: ChaseActionCandidate[] = [];
  const participants = (Array.isArray(snapshot.participants)
    ? snapshot.participants
    : []).filter(isPlainObject);
  for (const participant of participants) {
    if (
      participant.captured === true
      || participant.escaped === true
      || participant.wrecked === true
      || !Number.isInteger(participant.position)
      || !Number.isInteger(participant.movement_actions_remaining)
      || Number(participant.movement_actions_remaining) <= 0
    ) continue;
    const actorId = typeof participant.actor_id === "string"
      ? participant.actor_id
      : "";
    const actorHandle = chaseSemanticHandle(
      "actor",
      actorId,
      diagnostics,
      "snapshot.participants.actor_id",
    );
    const next = byIndex.get(Number(participant.position) + 1) ?? null;
    const label = typeof next?.label === "string" ? next.label : "";
    const locationHandle = chaseSemanticHandle(
      "location",
      label,
      diagnostics,
      "snapshot.location_chain.label",
    );
    if (actorHandle === null || next === null || locationHandle === null) continue;
    if (
      isPlainObject(next.hazard)
      || (isPlainObject(next.barrier) && Number(next.barrier.hp) > 0)
    ) continue;
    candidates.push({
      actor_handle: actorHandle,
      action_handle: "advance",
      actor_id: actorId,
      action_id: "move:advance",
      kind: "chase_move",
      destination_handle: locationHandle,
    });
  }
  return candidates;
}

/** Closed Pi model view for the canonical ChaseSession context. */
function projectChaseContextData(
  data: Record<string, unknown>,
  diagnostics: ProjectionIdentityDiagnostics | null,
): Record<string, unknown> {
  const snapshot = isPlainObject(data.snapshot) ? data.snapshot : null;
  const active = data.active === true && snapshot?.status === "active";
  if (!active || snapshot === null) {
    return {
      active: false,
      snapshot: null,
      pending_choice_count: Array.isArray(data.pending_choices)
        ? data.pending_choices.length
        : 0,
    };
  }
  const candidates = deriveChaseActionCandidates(data, diagnostics);
  const locations = (Array.isArray(snapshot.location_chain)
    ? snapshot.location_chain
    : []).filter(isPlainObject).flatMap((location) => {
      const handle = chaseSemanticHandle(
        "location",
        location.label,
        diagnostics,
        "snapshot.location_chain.label",
      );
      if (handle === null || !Number.isInteger(location.index)) return [];
      return [{
        location: handle,
        index: Number(location.index),
        label: location.label,
        hazard: isPlainObject(location.hazard)
          ? {
              present: true,
              skill: location.hazard.skill ?? null,
              target: location.hazard.target ?? null,
              difficulty: location.hazard.difficulty ?? "regular",
            }
          : null,
        barrier: isPlainObject(location.barrier)
          ? {
              present: true,
              hp: location.barrier.hp ?? null,
              hp_max: location.barrier.hp_max ?? null,
              skill: location.barrier.skill ?? null,
              target: location.barrier.target ?? null,
              difficulty: location.barrier.difficulty ?? "regular",
            }
          : null,
      }];
    });
  const actors = (Array.isArray(snapshot.participants)
    ? snapshot.participants
    : []).filter(isPlainObject).flatMap((participant) => {
      const actor = chaseSemanticHandle(
        "actor",
        participant.actor_id,
        diagnostics,
        "snapshot.participants.actor_id",
      );
      if (actor === null) return [];
      const location = locations.find((row) => row.index === participant.position);
      return [{
        actor,
        side: participant.side ?? null,
        role: participant.role ?? null,
        location: location?.location ?? null,
        movement_actions: participant.movement_actions ?? null,
        movement_actions_remaining: participant.movement_actions_remaining ?? null,
        conditions: Array.isArray(participant.conditions)
          ? participant.conditions
          : [],
        captured: participant.captured === true,
        escaped: participant.escaped === true,
        wrecked: participant.wrecked === true,
      }];
    });
  return {
    active: true,
    snapshot: {
      schema_version: snapshot.schema_version,
      status: "active",
      revision: snapshot.revision,
      round: snapshot.current_round,
      actors,
      locations,
      available_actions: candidates.map((candidate) => ({
        actor: candidate.actor_handle,
        action: candidate.action_handle,
        destination: candidate.destination_handle,
      })),
    },
    pending_choice_count: Array.isArray(data.pending_choices)
      ? data.pending_choices.length
      : 0,
    execute_operation: {
      operation: "chase.execute",
      invoke_via: "coc_chase_execute",
      bound_revision: snapshot.revision,
      model_command_fields: ["actor", "action"],
    },
  };
}

/**
 * Chase mutation disposition: canonical join/path identities remain in
 * host-only details, while the settled event and its mechanical changes stay
 * visible to the Keeper.
 */
function projectChaseExecuteData(
  data: Record<string, unknown>,
  semanticIds: SemanticIdMap | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
): Record<string, unknown> {
  const results = (Array.isArray(data.results) ? data.results : []).map((raw) => {
    if (!isPlainObject(raw)) return raw;
    const events = (Array.isArray(raw.events) ? raw.events : []).map((event) => {
      if (!isPlainObject(event)) return event;
      const {
        chase_id: chaseId,
        source_command_id: _sourceCommandId,
        ...substance
      } = event;
      if (typeof chaseId !== "string") return substance;
      const slug = chaseId.startsWith("chase-")
        ? chaseId.slice("chase-".length)
        : chaseId;
      const chase = chaseSemanticHandle(
        "chase",
        slug,
        diagnostics,
        "results.events.chase_id",
      );
      return chase === null ? substance : { ...substance, chase };
    });
    return {
      ...(typeof raw.kind === "string" ? { kind: raw.kind } : {}),
      ...(typeof raw.status === "string" ? { status: raw.status } : {}),
      events,
      ...(Object.hasOwn(raw, "pending_choice")
        ? { pending_choice: raw.pending_choice }
        : {}),
    };
  });
  return sanitizeEnvelopeBranch(
    {
      ...(Object.hasOwn(data, "schema_version")
        ? { schema_version: data.schema_version }
        : {}),
      ...(typeof data.authority === "string"
        ? { authority: data.authority }
        : {}),
      ...(typeof data.investigator_id === "string"
        ? { investigator: CURRENT_INVESTIGATOR_HANDLE }
        : {}),
      results,
    },
    semanticIds,
    diagnostics,
    "chase.execute",
  ) as Record<string, unknown>;
}

/** Exact-discovery RuleGraph cards share the scene card projection contract. */
function projectRulesContextData(
  data: Record<string, unknown>,
  semanticIds: SemanticIdMap | null,
  diagnostics: ProjectionIdentityDiagnostics | null,
): Record<string, unknown> {
  const view = projectRuleDecisionCardBlock(data, diagnostics, "rules.context");
  return sanitizeEnvelopeBranch(
    view,
    semanticIds,
    diagnostics,
    "rules.context",
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

const OPAQUE_HEX_RUN = /:?[0-9a-f]{16,}/gi;

function rewriteCanonicalIdsInText(
  text: string,
  semanticIds: SemanticIdMap | null,
  stripResidualHex: boolean,
): string {
  if (!text) return text;
  let out = text;
  if (semanticIds !== null) {
    const replacements: Array<{ from: string; to: string }> = [];
    const add = (canonical: string, handle: string) => {
      if (!canonical || !handle || canonical === handle) return;
      replacements.push({ from: canonical, to: handle });
      if (!canonical.startsWith("roll:")) {
        replacements.push({ from: `roll:${canonical}`, to: handle });
      }
      if (!canonical.startsWith("first-impression:")) {
        replacements.push({ from: `first-impression:${canonical}`, to: handle });
      }
    };
    for (const [canonical, handle] of semanticIds.rolls) add(canonical, handle);
    replacements.sort((a, b) => b.from.length - a.from.length);
    for (const { from, to } of replacements) {
      if (from.length < 12) continue;
      if (out.includes(from)) out = out.split(from).join(to);
    }
  }
  if (stripResidualHex) out = out.replace(OPAQUE_HEX_RUN, "");
  return out.replace(/ {2,}/g, " ").replace(/ ,/g, ",").trim();
}

function rewriteCanonicalIdsInError(
  error: unknown,
  semanticIds: SemanticIdMap | null,
): unknown {
  if (!isPlainObject(error)) return error;
  const code = typeof error.code === "string" ? error.code : "";
  const stripResidualHex = (
    code === "missing_obligation" || code === "unknown_obligation"
  );
  const rewritten: Record<string, unknown> = { ...error };
  if (typeof rewritten.message === "string") {
    rewritten.message = rewriteCanonicalIdsInText(
      rewritten.message, semanticIds, stripResidualHex,
    );
  }
  if (Array.isArray(rewritten.violations)) {
    rewritten.violations = rewritten.violations.map((row) => {
      if (!isPlainObject(row) || typeof row.message !== "string") return row;
      return {
        ...row,
        message: rewriteCanonicalIdsInText(
          row.message, semanticIds, stripResidualHex,
        ),
      };
    });
  }
  return rewritten;
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
    } else if (operation === "chase.context") {
      projected.data = projectChaseContextData(data, diagnostics);
    } else if (operation === "chase.execute") {
      projected.data = projectChaseExecuteData(data, semanticIds, diagnostics);
    } else if (operation === "rules.context") {
      projected.data = projectRulesContextData(data, semanticIds, diagnostics);
    } else if (operation === "npc.reaction") {
      projected.data = projectNpcReactionData(data, semanticIds, diagnostics);
    } else if (operation === "state.record_npc_engagement") {
      projected.data = projectNpcEngagementData(data, semanticIds, diagnostics);
    } else if (operation === "state.deliver_handout") {
      projected.data = projectHandoutDeliveryData(data, semanticIds, diagnostics);
    } else if (operation === "rules.social_adjudicate") {
      projected.data = projectSocialAdjudicationData(
        data, semanticIds, diagnostics,
      );
    } else if (operation === "rules.settle" && data.family === "social") {
      projected.data = projectSocialRulesSettleData(
        data, semanticIds, diagnostics,
      );
    } else if (operation === "rules.psychology_observe") {
      const view = { ...data };
      delete view.window_key;
      projected.data = sanitizeEnvelopeBranch(
        view, semanticIds, diagnostics, operationName,
      );
    } else if (operation === "session.resume") {
      const sceneContext = isPlainObject(data.scene_context)
        ? data.scene_context
        : null;
      const currentTurn = isPlainObject(data.current_turn)
        ? data.current_turn
        : null;
      const openTurnPlayerInput = projectOpenTurnPlayerInput(
        currentTurn?.player_input,
      );
      const recoveryGuidance = isPlainObject(data.host_recovery_guidance)
        ? data.host_recovery_guidance
        : null;
      const resumeData: Record<string, unknown> = { ...data };
      delete resumeData.scene_context;
      delete resumeData.host_recovery_guidance;
      // Host recovery cache binding only. The model receives the hydrated
      // semantic player-input card, never the timeline/source anchor or digest.
      delete resumeData.open_turn_anchor;
      const resumeView = sanitizeEnvelopeBranch(
        resumeData,
        semanticIds,
        diagnostics,
        operationName,
      ) as Record<string, unknown>;
      if (openTurnPlayerInput !== null) {
        const projectedCurrentTurn = isPlainObject(resumeView.current_turn)
          ? resumeView.current_turn
          : null;
        if (projectedCurrentTurn !== null) {
          resumeView.current_turn = {
            ...projectedCurrentTurn,
            player_input: openTurnPlayerInput,
          };
        }
      }
      if (sceneContext !== null) {
        resumeView.scene_context = projectSceneContextData(
          sceneContext,
          semanticIds,
          diagnostics,
        );
      }
      if (recoveryGuidance !== null) {
        const projectedGuidance = projectSessionRecoveryGuidance(
          recoveryGuidance,
        );
        if (projectedGuidance !== null) {
          resumeView.host_recovery_guidance = sanitizeEnvelopeBranch(
            projectedGuidance,
            semanticIds,
            diagnostics,
            operationName,
          );
        }
      }
      projected.data = resumeView;
    } else if (operation === "state.end_session") {
      projected.data = projectEndSessionData(data, semanticIds, diagnostics);
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
    projected.error = rewriteCanonicalIdsInError(
      sanitizeEnvelopeBranch(
        projected.error,
        semanticIds,
        diagnostics,
        operationName,
      ),
      semanticIds,
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
export const DECISION_ID_PREFIXES: readonly string[] = [
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
 * Model-visible `decision_id` field description. Generated from
 * `DECISION_ID_PREFIXES` so the presented schema cannot silently drift
 * from the validator. Coverage handles (`roll:…`) are not this field.
 */
export const DECISION_ID_ANY_PREFIX_SENTENCE = (
  "Any listed prefix is valid on any decision_id."
);

export const DECISION_ID_TN_SCOPE_SENTENCE = (
  "`tN-` turn scope applies only to prefixed `{prefix}{slug}` ids, never to "
  + "`quick-start:` / `setup-complete:` colon forms."
);

export const DECISION_ID_FINALIZE_SCOPE_SENTENCE = (
  "`:finalize` is accepted on prefixed `{prefix}{slug}` ids and on "
  + "`quick-start:` / `setup-complete:` colon forms."
);

export const DECISION_ID_FIELD_DESCRIPTION = (
  "Closed decision_id grammar (validator-bound): `{prefix}{slug}` where prefix "
  + `is one of ${DECISION_ID_PREFIXES.join(" | ")}`
  + "; slug is meaning-bearing lowercase/CJK segments joined by -._ . "
  + `${DECISION_ID_ANY_PREFIX_SENTENCE} `
  + `${DECISION_ID_TN_SCOPE_SENTENCE} `
  + `${DECISION_ID_FINALIZE_SCOPE_SENTENCE} `
  + "Colon forms: `quick-start:<slugs>` and `setup-complete:<slugs>` (1–6 segments). "
  + "Coverage obligation handles are not this field. "
  + "RIGHT: roll-persuade-arty-access-v1."
);

/** Prose-doc framing so a WRONG sample cannot be lifted as an example. */
export const CLOSED_IDENTITY_GRAMMAR_WRONG_FRAME = "✗ never";

/** Docs-table heading shared with KP-facing play docs. */
export const CLOSED_IDENTITY_GRAMMAR_TABLE_HEADING = (
  "Closed model-facing identity grammar"
);

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
  const namespace = value.slice(0, idx + 1);
  if (!namespaces.has(namespace)) return false;
  // The namespace scopes the semantics; the remainder still needs a
  // minimal meaning-bearing form (never one-char arbitrary tokens).
  // Host-presented chains may nest colon-scoped segments (e.g.
  // `scene-route:<scene>:<kind>:<ordinal>`); every segment must be
  // meaning-bearing slug material.
  const remainder = value.slice(idx + 1);
  // CJK semantic names are often two characters (猎刀). Roll handles may be
  // host-minted from three-letter CoC characteristics (CON, DEX, POW, SAN,
  // etc.); those exact live handles remain registry-resolved and therefore
  // use a three-character minimum. Other ASCII namespaces keep four.
  const minimum = /[\u3400-\u9fff]/.test(remainder)
    ? 2
    : namespace === "roll:" ? 3 : 4;
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
  ["obligation_id", stringSet(["roll:", "first-impression:", "sanity_bout:"])],
  ["obligation_ids", stringSet(["roll:", "first-impression:", "sanity_bout:"])],
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
  // R3 rules.settle keeper-semantic ids: decision cards and actor refs.
  ["decision_ref", stringSet(["decision:"])],
  ["lookup_ref", stringSet(["decision:"])],
  ["rescuer_ref", stringSet(["npc:", "person:", "actor:"])],
  ["assistant_rescuer_ref", stringSet(["npc:", "person:", "actor:"])],
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

/**
 * Model-facing `*_decision_id` fields besides literal `decision_id`.
 * `isDecisionIdField` also matches host-bound suffix names; those stay in
 * `RAW_NEVER_MODEL_AUTHORED_FIELDS` and are not cataloged. Completeness of
 * this list against the live presented surface is locked by walking typed
 * tool schemas in `tests/pi/decision-id-prefix-consistency.mjs`.
 */
export const MODEL_FACING_SUFFIX_DECISION_ID_FIELDS: readonly string[] = [
  "original_check_decision_id",
];

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
    // Affordance binding fields are closed to the `affordance:` namespace:
    // the exact copy-verbatim handle is the only accepted form (campaign
    // 04/05/10 namespace-guessing ladder fails closed here).
    if (
      field === "matched_affordance_ids" || field === "selected_affordance_ids"
    ) {
      return (value) => isNamespacedSemantic(value, echoed);
    }
    if (field === "weapon_id") {
      // `unarmed` is the ruleset's canonical built-in weapon vocabulary,
      // not an opaque entity id. Keeping this one literal lets a model
      // preserve fists/kicks without inventing a registry handle or silently
      // selecting another owned weapon.
      return (value) => value === "unarmed" || isEchoedSemanticRef(value, echoed);
    }
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

export type ClosedIdentityGrammarKind =
  | "decision"
  | "composed"
  | "echoed"
  | "handle_only"
  | "handle_or_namespace"
  | "provenance"
  | "vocabulary";

export type ClosedIdentityGrammarSpec = {
  field: string;
  kind: ClosedIdentityGrammarKind;
  acceptedForm: string;
  rightExample: string;
  wrongExample: string;
  marker: string;
  description: string;
};

const GRAMMAR_EXAMPLE_SLUG = "example-slug";

function grammarOverlayDescription(
  marker: string,
  acceptedForm: string,
  rightExample: string,
  extra = "",
): string {
  return `${marker} (validator-bound): ${acceptedForm}. `
    + extra
    + `RIGHT: ${rightExample}.`;
}

/**
 * WRONG examples in rejection guidance are deliberately NON-realistic
 * placeholder forms. Campaigns 04/05/10 reproduced models echoing a
 * realistic rejected literal (`route:commission-briefing-8`) straight out
 * of the error text; a bracket-free generic slug teaches the namespace
 * without handing the model a plausible-looking id to echo.
 */
function echoedWrongExample(namespaces: readonly string[]): string {
  if (namespaces.includes("route:")) return "affordance:example-slug";
  return "route:example-slug";
}

function handleOrNamespaceWrongExample(field: string): string {
  if (field === "source_ref") return "player_input:other";
  if (field === "advice_id") return "current-advice";
  return "current-candidate";
}

/**
 * Per-field closed grammar for model-facing identity values. Host-bound
 * never-model-authored fields have no model-facing spec.
 */
export function closedIdentityGrammarSpec(
  field: string,
): ClosedIdentityGrammarSpec | null {
  if (RAW_NEVER_MODEL_AUTHORED_FIELDS.has(field)) return null;
  if (isDecisionIdField(field)) {
    return {
      field,
      kind: "decision",
      acceptedForm: (
        "`{prefix}{slug}` with prefix one of the listed DECISION_ID_PREFIXES; "
        + "or `quick-start:` / `setup-complete:` colon forms; `tN-` on prefixed "
        + "forms only; `:finalize` on prefixed and colon forms"
      ),
      rightExample: "roll-persuade-arty-access-v1",
      wrongExample: "first-impression-arty-wilmot",
      marker: "Closed decision_id grammar",
      description: DECISION_ID_FIELD_DESCRIPTION,
    };
  }
  const composed = RAW_COMPOSED_FIELDS.get(field);
  if (composed !== undefined) {
    const right = field === "claim_id"
      ? "claim-sit-notebook-smoke"
      : `${composed[0]}${GRAMMAR_EXAMPLE_SLUG}`;
    const wrong = field === "claim_id" ? "sit-notebook-smoke" : GRAMMAR_EXAMPLE_SLUG;
    const acceptedForm = `\`{prefix}{slug}\` with prefix ${composed.map((p) => `\`${p}\``).join(", ")}`;
    const marker = `Closed ${field} grammar`;
    return {
      field,
      kind: "composed",
      acceptedForm,
      rightExample: right,
      wrongExample: wrong,
      marker,
      description: grammarOverlayDescription(
        marker,
        acceptedForm,
        right,
        field === "claim_id" ? "No colon namespace. " : "",
      ),
    };
  }
  const echoed = RAW_ECHOED_FIELDS.get(field);
  if (echoed !== undefined) {
    // Campaign-10 point of use: affordance binding fields accept ONLY the
    // exact `affordance_id` handle copied verbatim from scene.context
    // `action_routes` rows. Route-namespace or bare-slug forms are closed —
    // guessing namespaces was the 04/05/10 failure ladder
    // (`route:` → `affordance:` → bare slug).
    if (
      field === "matched_affordance_ids" || field === "selected_affordance_ids"
    ) {
      const acceptedForm = "the exact affordance_id handle copied verbatim "
        + "from scene.context action_routes[*].affordance_id (namespace "
        + "`affordance:`); never synthesized from route_id or any bare "
        + "route id";
      const right = "affordance:example-slug";
      const wrong = echoedWrongExample([...echoed]);
      const marker = `Closed ${field} grammar`;
      return {
        field,
        kind: "echoed",
        acceptedForm,
        rightExample: right,
        wrongExample: wrong,
        marker,
        description: grammarOverlayDescription(
          marker,
          acceptedForm,
          right,
          "No other namespaces. ",
        ),
      };
    }
    const namespaces = [...echoed];
    const nsText = field === "weapon_id"
      ? "literal `unarmed`, a multi-token semantic slug, or namespace `weapon:`, `item:`"
      : namespaces.length > 0
      ? `multi-token semantic slug or namespace ${namespaces.map((n) => `\`${n}\``).join(", ")}`
      : "multi-token semantic slug (no colon namespace)";
    // Campaign-09 point of use: a coverage handle is never authored, it is
    // copied verbatim from the presented output context — and a turn with no
    // presented obligations is represented structurally as `coverage: []`,
    // never filled with a placeholder row ("none" or any invented filler).
    if (field === "obligation_id" || field === "obligation_ids") {
      const acceptedForm = "the exact obligation handle copied verbatim from "
        + "turn.output_context required_obligation_ids (namespace `roll:`, "
        + "`first-impression:`, or `sanity_bout:`); when turn.output_context "
        + "presents no obligations, submit `coverage` as an empty array "
        + "instead of any placeholder row";
      const right = `roll:${GRAMMAR_EXAMPLE_SLUG}`;
      const wrong = echoedWrongExample(namespaces);
      const marker = `Closed ${field} grammar`;
      return {
        field,
        kind: "echoed",
        acceptedForm,
        rightExample: right,
        wrongExample: wrong,
        marker,
        description: grammarOverlayDescription(
          marker,
          acceptedForm,
          right,
          "No other namespaces. ",
        ),
      };
    }
    const right = field === "weapon_id"
      ? "unarmed"
      : namespaces.length > 0
      ? `${namespaces[0]}${GRAMMAR_EXAMPLE_SLUG}`
      : GRAMMAR_EXAMPLE_SLUG;
    const wrong = echoedWrongExample(namespaces);
    const marker = `Closed ${field} grammar`;
    const extra = namespaces.length > 0
      ? "No other namespaces. "
      : "No colon namespace. ";
    return {
      field,
      kind: "echoed",
      acceptedForm: nsText,
      rightExample: right,
      wrongExample: wrong,
      marker,
      description: grammarOverlayDescription(marker, nsText, right, extra),
    };
  }
  const handles = RAW_HANDLE_ONLY.get(field);
  if (handles !== undefined) {
    const handleList = [...handles];
    const right = handleList[0] ?? GRAMMAR_EXAMPLE_SLUG;
    const wrong = field === "investigator" ? "investigator-1" : "pc:inv-other";
    const acceptedForm = `exact handle ${handleList.map((h) => `\`${h}\``).join(", ")}`;
    const marker = `Closed ${field} grammar`;
    return {
      field,
      kind: "handle_only",
      acceptedForm,
      rightExample: right,
      wrongExample: wrong,
      marker,
      description: grammarOverlayDescription(marker, acceptedForm, right),
    };
  }
  const handleOrNs = RAW_HANDLE_OR_NAMESPACE.get(field);
  if (handleOrNs !== undefined) {
    const handleList = [...handleOrNs.handles];
    const nsList = [...handleOrNs.namespaces];
    const right = handleList[0] ?? GRAMMAR_EXAMPLE_SLUG;
    const wrong = handleOrNamespaceWrongExample(field);
    const acceptedForm = `exact handle ${handleList.map((h) => `\`${h}\``).join(", ")}`
      + ` or namespace ${nsList.map((n) => `\`${n}\``).join(", ")}`;
    const marker = `Closed ${field} grammar`;
    return {
      field,
      kind: "handle_or_namespace",
      acceptedForm,
      rightExample: right,
      wrongExample: wrong,
      marker,
      description: grammarOverlayDescription(marker, acceptedForm, right),
    };
  }
  if (RAW_PROVENANCE_FIELDS.has(field)) {
    const acceptedForm = (
      "`pdf_index-<n>` or namespace `pdf:`, `module:`, `source:`, `handout:`"
    );
    const right = "pdf:haunting-full";
    const wrong = "foo";
    const marker = `Closed ${field} grammar`;
    return {
      field,
      kind: "provenance",
      acceptedForm,
      rightExample: right,
      wrongExample: wrong,
      marker,
      description: grammarOverlayDescription(marker, acceptedForm, right),
    };
  }
  if (RAW_VOCABULARY_FIELDS.has(field)) {
    const acceptedForm = (
      "canonical vocabulary token; machine namespaces and opaque tokens rejected"
    );
    const right = "starter";
    const wrong = "job-not-a-pregen";
    const marker = `Closed ${field} grammar`;
    return {
      field,
      kind: "vocabulary",
      acceptedForm,
      rightExample: right,
      wrongExample: wrong,
      marker,
      description: grammarOverlayDescription(marker, acceptedForm, right),
    };
  }
  return null;
}

/** Every model-facing closed-grammar identity field, decision_id first. */
export function closedIdentityGrammarCatalog(): readonly ClosedIdentityGrammarSpec[] {
  const fields = new Set<string>([
    "decision_id",
    ...MODEL_FACING_SUFFIX_DECISION_ID_FIELDS,
    ...RAW_COMPOSED_FIELDS.keys(),
    ...RAW_ECHOED_FIELDS.keys(),
    ...RAW_HANDLE_ONLY.keys(),
    ...RAW_HANDLE_OR_NAMESPACE.keys(),
    ...RAW_PROVENANCE_FIELDS,
    ...RAW_VOCABULARY_FIELDS,
  ]);
  const rows: ClosedIdentityGrammarSpec[] = [];
  for (const field of [...fields].sort((a, b) => {
    if (a === "decision_id") return -1;
    if (b === "decision_id") return 1;
    return a.localeCompare(b);
  })) {
    const spec = closedIdentityGrammarSpec(field);
    if (spec !== null) rows.push(spec);
  }
  return rows;
}

function closedIdentityGrammarError(field: string): string {
  const spec = closedIdentityGrammarSpec(field);
  if (spec === null) {
    return `${field} must use its closed semantic form: meaning-bearing `
      + "slugs, the documented handles, or the field's allowed semantic "
      + "namespaces. Arbitrary, unknown-namespace, or opaque values are rejected.";
  }
  return `${field} must use its closed semantic form: ${spec.acceptedForm}. `
    + `RIGHT: ${spec.rightExample}. WRONG: ${spec.wrongExample}.`;
}

function isStringishIdentitySchema(prop: JsonSchema): boolean {
  const type = prop.type;
  if (type === "string") return true;
  if (Array.isArray(type) && type.includes("string")) return true;
  if (type === "array" || Object.hasOwn(prop, "items")) return true;
  if (Array.isArray(prop.enum) && prop.enum.every((value) => typeof value === "string")) {
    return true;
  }
  return false;
}

function applyClosedIdentityGrammarOverlay(field: string, prop: JsonSchema): void {
  const spec = closedIdentityGrammarSpec(field);
  if (spec === null) return;
  if (!isStringishIdentitySchema(prop)) return;
  const current = typeof prop.description === "string" ? prop.description.trim() : "";
  if (current.includes(spec.marker)) return;
  prop.description = current
    ? `${current.replace(/\.+$/, ".")} ${spec.description}`
    : spec.description;
}

function overlayClosedIdentityGrammarDescriptions(schema: JsonSchema): void {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (!isPlainObject(node)) return;
    if (isPlainObject(node.properties)) {
      for (const [field, prop] of Object.entries(node.properties)) {
        if (!isPlainObject(prop)) continue;
        applyClosedIdentityGrammarOverlay(field, prop);
        visit(prop);
      }
    }
    if (Object.hasOwn(node, "items")) visit(node.items);
    if (isPlainObject(node.additionalProperties)) visit(node.additionalProperties);
    for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
      if (Object.hasOwn(node, key)) visit(node[key]);
    }
  };
  visit(schema);
}

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
          message: closedIdentityGrammarError(field),
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
  resolveAffordance: (handle: string) => string | null;
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
const OBLIGATION_ID_FIELDS: ReadonlySet<string> = new Set([
  "obligation_id", "obligation_ids", "required_obligation_ids",
]);
const PYTHON_OBLIGATION_PREFIXES = [
  "roll:", "first-impression:", "sanity_bout:",
] as const;

/** Coverage join keys must match Python's kind-prefixed obligation_id. */
function toPythonObligationId(canonical: string): string {
  if (PYTHON_OBLIGATION_PREFIXES.some((prefix) => canonical.startsWith(prefix))) {
    return canonical;
  }
  return `roll:${canonical}`;
}
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
      // Copy-verbatim affordance handles: the KP submits the exact
      // `affordance_id` presented on scene.context `action_routes` rows;
      // the host resolves it through the affordance registry family back to
      // the canonical route id. Route-namespace or bare forms never enter
      // this field (grammar rejects them before restoration).
      if (
        (field === "matched_affordance_ids" || field === "selected_affordance_ids")
        && value.startsWith("affordance:")
      ) {
        return "affordance";
      }
      return "";
    };
    const restoreOne = (
      domain: "roll" | "effect" | "item" | "weapon" | "route" | "affordance",
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
        : domain === "route"
        ? resolver.resolveRoute
        : resolver.resolveAffordance;
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
            domain as "roll" | "effect" | "item" | "weapon" | "route" | "affordance",
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
          domain as "roll" | "effect" | "item" | "weapon" | "route" | "affordance",
          value,
        );
        if (!restored.ok) return value;
        if (field !== null && OBLIGATION_ID_FIELDS.has(field) && domain === "roll") {
          return toPythonObligationId(restored.value);
        }
        return restored.value;
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
