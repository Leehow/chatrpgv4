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
  const guidance = {
    schema_version: 1,
    contract_id: PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT,
    audience: "keeper_only",
    mode: "pending_finalization",
    status: "journaled_settled_pending_finalization",
    next_call: outputContextCall,
    then: {
      tool: "coc_turn_finalize",
      exact_card_path: "coc_turn_output_context.data.finalize_operation",
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
