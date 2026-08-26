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
  narration_review_id: string;
  repair_finalization_id?: string;
};

export type TypedToolBindingCard =
  | StateJournalBindingCard
  | NarrationReviewBindingCard
  | TurnFinalizeBindingCard;

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
};

const SCHEMA_CODES = new Set([
  "missing_param",
  "invalid_param",
  "missing_parameters",
  "invalid_arguments",
  "invalid_param_type",
]);

const DYNAMIC_CANDIDATE_ACTIONS: Record<string, readonly PiAllowedNextAction[]> = {
  unknown_combat_target: [{
    operation: "combat.context",
    reason: "refresh the current canonical combat targets before choosing again",
    host_bound: true,
  }],
  unknown_scene_route: [{
    operation: "scene.context",
    reason: "refresh the current source-authored scene routes before choosing again",
    host_bound: true,
  }],
  scene_not_adjacent: [{
    operation: "scene.context",
    reason: "refresh the current source-authored scene routes before choosing again",
    host_bound: true,
  }],
};

const BUSINESS_PRECONDITION_ACTIONS: Record<string, readonly PiAllowedNextAction[]> = {
  no_unfinalized_journal: [{
    operation: "state.journal",
    reason: "journal the settled turn before requesting its output context",
    host_bound: true,
  }],
  turn_pending_finalization: [{
    operation: "turn.output_context",
    reason: "continue the exact pending turn settlement before any new mutation",
    host_bound: true,
  }],
  turn_finalization_pending: [{
    operation: "turn.output_context",
    reason: "continue the exact pending turn settlement before another journal",
    host_bound: true,
  }],
  narration_review_required: [{
    operation: "narration.review",
    reason: "review the retained draft and frozen settlement before finalizing",
    host_bound: true,
  }],
  state_authority_review_blocked: [{
    operation: "narration.review",
    reason: "revise narration only against the same frozen settlement",
    host_bound: true,
  }],
  default_mechanics_placement_unavailable: [{
    operation: "turn.finalize",
    reason: "supply a complete causal mechanics placement revision without rerunning state",
    host_bound: true,
  }],
};

const HOST_BINDING_REFRESH_CODES = new Set([
  "idempotency_conflict",
]);

const STALE_BINDING_CODES = new Set([
  "narration_review_mismatch",
  "source_digest_mismatch",
  "stale_revision",
  "stale_binding_context",
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

function validateBindingCard(
  operation: string,
  binding: TypedToolBindingCard | null | undefined,
  currentBindingRevision: string,
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
  const retainedRevision = nonEmptyString(binding.binding_revision, "binding_revision");
  const currentRevision = nonEmptyString(currentBindingRevision, "current_binding_revision");
  if (retainedRevision !== currentRevision) {
    throw new ToolContractProjectionError(
      "binding_context_stale",
      `retained host binding for ${operation} is stale`,
      {
        operation,
        retained_revision: retainedRevision,
        current_revision: currentRevision,
      },
    );
  }
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
  } else {
    requirePositiveRevision(binding.revision, "revision");
    nonEmptyString(binding.narration_review_id, "narration_review_id");
    if (binding.repair_finalization_id !== undefined) {
      nonEmptyString(binding.repair_finalization_id, "repair_finalization_id");
    }
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

/**
 * Remove host-owned fields only after the exact retained binding is validated
 * against the current canonical binding revision.
 */
export function projectBoundTypedToolParameters(
  operation: string,
  inputSchema: JsonSchema,
  binding: TypedToolBindingCard | null | undefined,
  currentBindingRevision: string,
): JsonSchema {
  const valid = validateBindingCard(operation, binding, currentBindingRevision);
  const cloned = structuredClone(inputSchema);
  const owned = HOST_OWNED_FIELDS[valid.operation];
  cloned.required = Array.isArray(cloned.required)
    ? cloned.required.filter((field) => typeof field !== "string" || !owned.includes(field))
    : cloned.required;
  if (isPlainObject(cloned.properties)) {
    for (const field of owned) delete cloned.properties[field];
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
  currentBindingRevision: string,
): Record<string, unknown> {
  const valid = validateBindingCard(operation, binding, currentBindingRevision);
  const owned = HOST_OWNED_FIELDS[valid.operation];
  const forged = owned.filter((field) => Object.hasOwn(modelInput, field));
  if (forged.length) {
    throw new ToolContractProjectionError(
      "forged_host_argument",
      `model input for ${operation} contains host-owned fields: ${forged.join(", ")}`,
      { operation, fields: forged },
    );
  }
  return {
    ...structuredClone(modelInput),
    ...bindingValues(valid),
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

function nextActionForSameOperation(operation: string): PiAllowedNextAction[] {
  return operation
    ? [{
      operation,
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
    operation === "state.move_scene" && code === "invalid_param"
  )
    ? DYNAMIC_CANDIDATE_ACTIONS.unknown_scene_route
    : (
      SCHEMA_CODES.has(code)
      && hasDynamicCandidateDetails(error)
      && operation.startsWith("combat.")
    )
      ? DYNAMIC_CANDIDATE_ACTIONS.unknown_combat_target
      : null;
  if (dynamicActions || inferredDynamicActions) {
    return {
      class: "dynamic_candidate",
      recoverable_by: "model_next_action",
      allowed_next_actions: structuredClone(dynamicActions ?? inferredDynamicActions ?? []),
    };
  }
  if (
    SCHEMA_CODES.has(code)
    || (operation === "state.advance_time" && code === "invalid_request")
  ) {
    return {
      class: "schema_validation",
      recoverable_by: "model_next_action",
      allowed_next_actions: nextActionForSameOperation(operation),
    };
  }
  const businessActions = BUSINESS_PRECONDITION_ACTIONS[code];
  if (businessActions) {
    return {
      class: "business_precondition",
      recoverable_by: "model_next_action",
      allowed_next_actions: structuredClone(businessActions),
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
