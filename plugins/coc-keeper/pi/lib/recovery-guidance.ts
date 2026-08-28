/**
 * Structured host guidance for an open recovered turn.
 *
 * Consumer: pi-coc play KP, attached onto a successful session.resume tool
 * result. This is host instruction, never player-visible fiction and never a
 * second narrative engine.
 */
import type { JsonObject } from "./runtime.ts";

export const OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT =
  "coc.pi-open-turn-recovery-guidance.v1";
export const OPEN_TURN_RECOVERY_GUIDANCE_AUDIT =
  "coc-open-turn-recovery-guidance";

export const PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT =
  "coc.pi-pending-finalization-recovery-guidance.v1";
export const PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT =
  "coc-pending-finalization-recovery-guidance";

const NON_RECOVERY_RESUME_MODES = new Set([
  "table_opening",
  "awaiting_player",
  "pending_finalization",
  "already_acknowledged",
]);

export const OPEN_TURN_RECOVERY_CLOSURE_SEQUENCE = [
  {
    operation: "turn.output_context",
    when: "always",
    purpose: "required_closures_and_finalize_card",
  },
  {
    operation: "state.journal",
    when: "if_unrealized",
    purpose: "realize_recovered_turn",
  },
  {
    operation: "turn.finalize",
    when: "always",
    purpose: "rule4_hash_bound_settled_output",
  },
] as const;

export const OPEN_TURN_RECOVERY_FORBIDDEN_UNTIL_CLOSED = [
  "state.move_scene",
  "scene_progression",
  "new_rules_rolls",
  "new_state_mutation",
] as const;

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Canonical operation-card identities, exactly as fixed by the producers:
 * the kernel output-context builder (coc_operation_turn_output.py) and the
 * pending projection (coc_mcp_wire.py). The review card is always
 * narration.review via coc_narration_review; the finalize card is
 * turn.finalize via coc_turn_finalize when agency review is required and
 * via coc_invoke otherwise.
 */
const CANONICAL_REVIEW_OPERATION_IDENTITY = {
  operation: "narration.review",
  invokeVia: ["coc_narration_review"],
} as const;
const CANONICAL_FINALIZE_OPERATION_IDENTITY = {
  operation: "turn.finalize",
  invokeVia: ["coc_turn_finalize", "coc_invoke"],
} as const;

/**
 * Canonical operation-card shape as produced by the kernel/wire layers
 * (typed tool + prefilled + missing arguments), bound to its expected
 * operation and invocation identity. Anything else — including a
 * structurally valid card with a wrong or swapped operation/invoke_via — is
 * treated as absent: the adapter never repairs, completes, fabricates, or
 * relays a card whose identity does not match its canonical slot.
 */
function isOperationCard(
  value: unknown,
  identity: { operation: string; invokeVia: readonly string[] },
): value is JsonObject {
  return isPlainObject(value)
    && value.operation === identity.operation
    && typeof value.invoke_via === "string"
    && identity.invokeVia.includes(value.invoke_via)
    && isPlainObject(value.prefilled_arguments)
    && Array.isArray(value.missing_arguments)
    && value.missing_arguments.every(
      (entry) => typeof entry === "string",
    );
}

/** Exact structural copy; the projection must never alias canonical data. */
function deepCopyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCopyValue);
  if (isPlainObject(value)) {
    const copy: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = deepCopyValue(entry);
    }
    return copy;
  }
  return value;
}

function nextOperationsOf(data: JsonObject): unknown[] {
  return Array.isArray(data.next_operations) ? data.next_operations : [];
}

export function isPendingFinalizationResume(value: unknown): boolean {
  if (!isPlainObject(value) || value.ok !== true) return false;
  if (value.tool !== "session.resume") return false;
  const data = isPlainObject(value.data) ? value.data : null;
  const nextOperations = data === null ? [] : nextOperationsOf(data);
  return data !== null
    && data.schema_version === 1
    && typeof data.campaign_id === "string"
    && data.campaign_id.length > 0
    && data.mode === "pending_finalization"
    && nextOperations.length === 1
    && nextOperations[0] === "turn.finalize";
}

export function applyPendingFinalizationRecoveryGuidance(
  value: unknown,
  invocation: { root: string; campaign: string },
  options?: { reviewRecoveryArmed?: boolean; revision?: number },
): {
  attached: boolean;
  envelope: unknown;
  audit: JsonObject | null;
} {
  if (
    !isPendingFinalizationResume(value)
    || !isPlainObject(value)
    || !invocation.root
    || !invocation.campaign
  ) {
    return { attached: false, envelope: value, audit: null };
  }
  const data = isPlainObject(value.data) ? value.data : {};
  if (data.campaign_id !== invocation.campaign) {
    return { attached: false, envelope: value, audit: null };
  }
  const outputContextCall = {
    tool: "coc_turn_output_context",
    arguments: {
      root: invocation.root,
      campaign: invocation.campaign,
    },
  };
  // Exact canonical operation cards, projected verbatim when the canonical
  // resume payload supplies a well-formed card. Missing or malformed cards
  // stay missing (fail closed); the adapter invents no argument, id, or
  // ordering data. The fresh turn.output_context call remains the live
  // authority for both cards.
  const pendingContext = isPlainObject(data.pending_output_context)
    ? data.pending_output_context
    : null;
  const reviewCard = pendingContext !== null
    && isOperationCard(
      pendingContext.agency_review_operation,
      CANONICAL_REVIEW_OPERATION_IDENTITY,
    )
    ? deepCopyValue(pendingContext.agency_review_operation) as JsonObject
    : null;
  const finalizeCard = pendingContext !== null
    && isOperationCard(
      pendingContext.finalize_operation,
      CANONICAL_FINALIZE_OPERATION_IDENTITY,
    )
    ? deepCopyValue(pendingContext.finalize_operation) as JsonObject
    : null;
  const guidance = {
    schema_version: 1,
    contract_id: PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT,
    audience: "keeper_only",
    mode: "pending_finalization",
    status: "journaled_settled_pending_finalization",
    next_call: outputContextCall,
    ...((reviewCard !== null || finalizeCard !== null)
      ? {
          card_projection: {
            source: "session.resume.pending_output_context",
            authoritative_copy: "coc_turn_output_context",
            instruction: (
              "The card fields inlined below are exact session.resume "
              + "snapshots. The mandatory next_call coc_turn_output_context "
              + "returns the live cards; when they differ, the fresh cards "
              + "are authoritative. Merge each card's prefilled_arguments "
              + "unchanged and supply only its missing_arguments, in the "
              + "order review_recovery before then."
            ),
          },
        }
      : {}),
    review_recovery: {
      tool: "coc_narration_review",
      exact_card_path: "coc_turn_output_context.data.agency_review_operation",
      ...(reviewCard !== null ? { card: reviewCard } : {}),
      armed: options?.reviewRecoveryArmed === true,
      revision: Number.isInteger(options?.revision) ? options.revision : null,
      instruction: (
        "If agency_review_operation is present, use its prefilled_arguments "
        + "exactly, including the host-provided revision on this card and on "
        + "the operation. Draft new player-visible prose over the same output "
        + "context using only that frozen revision. Never invent or assume a "
        + "revision number. Never supply state_claim_compilation or any host "
        + "compiler receipt field. Do not rerun rules, state writes, or "
        + "state.journal. Revision 2 remains only for an accepted-undelivered "
        + "draft repair."
      ),
    },
    then: {
      tool: "coc_turn_finalize",
      exact_card_path: "coc_turn_output_context.data.finalize_operation",
      ...(finalizeCard !== null ? { card: finalizeCard } : {}),
      instruction: (
        "Use the returned finalize_operation prefilled_arguments exactly, "
        + "supply only its missing_arguments, and do not construct, infer, "
        + "or reuse turn.finalize arguments from prior transcript history."
      ),
    },
    after_success: "echo only the returned rendered_text exactly",
    forbidden: [
      "reroll",
      "repeat_state_writes",
      "reopen_scene_discovery",
      "hand_construct_finalize_arguments",
      "accept_new_player_action_before_finalization",
    ],
  };
  return {
    attached: true,
    envelope: {
      ...value,
      data: {
        schema_version: 1,
        campaign_id: data.campaign_id,
        mode: "pending_finalization",
        next_operations: nextOperationsOf(data),
        host_recovery_guidance: guidance,
        pending_output_context: {
          status: "read_via_exact_typed_call",
          next_call: outputContextCall,
        },
      },
    },
    audit: {
      schema_version: 1,
      contract_id: PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT,
      campaign_id: data.campaign_id,
      mode: "pending_finalization",
      operation_cards: {
        agency_review_operation: reviewCard !== null,
        finalize_operation: finalizeCard !== null,
      },
    },
  };
}

export function isOpenTurnRecoveryResume(value: unknown): boolean {
  if (!isPlainObject(value) || value.ok !== true) return false;
  if (value.tool !== "session.resume") return false;
  const data = isPlainObject(value.data) ? value.data : null;
  if (data === null) return false;
  if (typeof data.mode === "string" && NON_RECOVERY_RESUME_MODES.has(data.mode)) {
    return false;
  }
  if (data.mode === "open_turn_recovery") return true;
  return nextOperationsOf(data).includes("continue_current_turn_from_receipts");
}

export function buildOpenTurnRecoveryGuidance(data: JsonObject): JsonObject {
  const nextOperations = nextOperationsOf(data);
  return {
    schema_version: 1,
    contract_id: OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT,
    audience: "keeper_only",
    mode: "open_turn_recovery",
    next_operations: nextOperations.includes("continue_current_turn_from_receipts")
      ? nextOperations
      : ["continue_current_turn_from_receipts", ...nextOperations],
    current_acl_supersedes_prior_denials: true,
    closure_sequence: OPEN_TURN_RECOVERY_CLOSURE_SEQUENCE.map((row) => ({
      ...row,
    })),
    after_closure: "adjudicate_unsettled_player_action",
    forbidden_until_closed: [...OPEN_TURN_RECOVERY_FORBIDDEN_UNTIL_CLOSED],
    keep: ["kp_semantic_judgment", "rule4"],
    do_not: [
      "fixed_narrative_template",
      "keyword_matching",
      "host_authored_fiction",
    ],
  };
}

export function applyOpenTurnRecoveryGuidance(value: unknown): {
  attached: boolean;
  envelope: unknown;
  audit: JsonObject | null;
} {
  if (!isOpenTurnRecoveryResume(value) || !isPlainObject(value)) {
    return { attached: false, envelope: value, audit: null };
  }
  const data = isPlainObject(value.data) ? value.data : {};
  const guidance = buildOpenTurnRecoveryGuidance(data);
  const rest = { ...data };
  delete rest.host_recovery_guidance;
  return {
    attached: true,
    envelope: {
      ...value,
      data: {
        host_recovery_guidance: guidance,
        ...rest,
      },
    },
    audit: {
      schema_version: 1,
      contract_id: OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT,
      campaign_id: typeof data.campaign_id === "string" ? data.campaign_id : null,
      mode: "open_turn_recovery",
    },
  };
}
