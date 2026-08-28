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
 * turn.finalize via coc_turn_finalize exactly when agency review is
 * required and via coc_invoke exactly when it is not (wire projection
 * sets invoke_via only for the review-required surface). Snapshot slots
 * accept either finalize surface because the resume snapshot carries no
 * agency mode; the strict live validator below enforces the mode-specific
 * surface.
 */
const CANONICAL_REVIEW_OPERATION_IDENTITY = {
  operation: "narration.review",
  invokeVia: ["coc_narration_review"],
} as const;
const CANONICAL_FINALIZE_OPERATION_IDENTITY = {
  operation: "turn.finalize",
  invokeVia: ["coc_turn_finalize", "coc_invoke"],
} as const;
const CANONICAL_REVIEW_REQUIRED_FINALIZE_IDENTITY = {
  operation: "turn.finalize",
  invokeVia: ["coc_turn_finalize"],
} as const;
const CANONICAL_DIRECT_FINALIZE_IDENTITY = {
  operation: "turn.finalize",
  invokeVia: ["coc_invoke"],
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

/** Positive integer card revision bound to its slot operation. */
function operationCardRevisionOf(card: JsonObject): number | null {
  const prefilled = isPlainObject(card.prefilled_arguments)
    ? card.prefilled_arguments
    : null;
  const revision = prefilled?.revision;
  if (typeof revision !== "number") return null;
  return Number.isInteger(revision) && revision > 0 ? revision : null;
}

export type LiveOutputContextCards = {
  agencyReviewRequired: boolean;
  reviewCard: JsonObject | null;
  finalizeCard: JsonObject;
  revision: number;
  turnId: string;
  sourceDigest: string;
};

export type PendingFinalizationHydration =
  | { status: "not_attempted" }
  | { status: "unavailable" }
  | { status: "superseded" }
  | { status: "success"; cards: LiveOutputContextCards };

/**
 * Atomically validate a live `turn.output_context` receipt for host-side
 * recovery hydration. Mirrors the gateway acceptance contract for an
 * explicit canonical call (complete receipt fields, explicit agency-review
 * mode, complete matching card chain) plus the strict producer-defined
 * card surfaces: the review card must carry turn_id, source_digest, and
 * revision identities exactly equal to the receipt; the finalize card must
 * use the mode-specific invoke_via surface (coc_turn_finalize when agency
 * review is required, coc_invoke otherwise); the agency authority subject
 * refs the state-claim compiler requires must be present. Resume pending
 * turn/source/revision fields correlate exactly whenever present. Any
 * stale, mixed, identity-less, malformed, or mode-inconsistent value fails
 * as a whole: the host never repairs, completes, or projects a partial
 * chain. Pure; no host state.
 */
export function validateLiveOutputContext(
  value: unknown,
  resumeData: unknown,
): LiveOutputContextCards | null {
  if (!isPlainObject(value) || value.ok !== true) return null;
  if (value.tool !== "turn.output_context") return null;
  const data = isPlainObject(value.data) ? value.data : null;
  if (data === null) return null;
  const turnId = typeof data.turn_id === "string" ? data.turn_id : "";
  const sourceDigest = typeof data.source_digest === "string"
    ? data.source_digest
    : "";
  if (
    !turnId
    || !sourceDigest
    || typeof data.settlement_snapshot_id !== "string"
    || !data.settlement_snapshot_id
    || typeof data.mechanics_bundle_sha256 !== "string"
    || !data.mechanics_bundle_sha256
  ) return null;
  const contractProjection = isPlainObject(data.contract_projection)
    ? data.contract_projection
    : null;
  if (contractProjection === null) return null;
  const agencyReviewRequired = contractProjection.agency_review_required;
  if (agencyReviewRequired !== true && agencyReviewRequired !== false) {
    return null;
  }
  const reviewCardPresent = Object.hasOwn(data, "agency_review_operation");
  if (agencyReviewRequired !== reviewCardPresent) return null;
  const finalizeCard = isOperationCard(
    data.finalize_operation,
    agencyReviewRequired
      ? CANONICAL_REVIEW_REQUIRED_FINALIZE_IDENTITY
      : CANONICAL_DIRECT_FINALIZE_IDENTITY,
  )
    ? deepCopyValue(data.finalize_operation) as JsonObject
    : null;
  if (finalizeCard === null) return null;
  const finalizeRevision = operationCardRevisionOf(finalizeCard);
  if (finalizeRevision === null) return null;
  let reviewCard: JsonObject | null = null;
  if (agencyReviewRequired) {
    // The state-claim compiler observation requires non-empty agency
    // subject refs; prevalidate them so a validated receipt cannot make
    // the observer throw.
    const agencyAuthority = isPlainObject(contractProjection.agency_authority)
      ? contractProjection.agency_authority
      : null;
    const subjectRefs = agencyAuthority !== null
      && Array.isArray(agencyAuthority.pc_subject_refs)
      ? agencyAuthority.pc_subject_refs
      : null;
    if (
      subjectRefs === null
      || subjectRefs.length === 0
      || subjectRefs.some((ref) => typeof ref !== "string" || !ref)
    ) return null;
    reviewCard = isOperationCard(
      data.agency_review_operation,
      CANONICAL_REVIEW_OPERATION_IDENTITY,
    )
      ? deepCopyValue(data.agency_review_operation) as JsonObject
      : null;
    if (reviewCard === null) return null;
    const reviewPrefilled = isPlainObject(reviewCard.prefilled_arguments)
      ? reviewCard.prefilled_arguments
      : null;
    if (reviewPrefilled === null) return null;
    if (operationCardRevisionOf(reviewCard) !== finalizeRevision) return null;
    // Review identities are mandatory and exact: a missing or divergent
    // turn/source identity is a stale or mixed chain, never a valid one.
    if (typeof reviewPrefilled.turn_id !== "string" || reviewPrefilled.turn_id !== turnId) {
      return null;
    }
    if (
      typeof reviewPrefilled.source_digest !== "string"
      || reviewPrefilled.source_digest !== sourceDigest
    ) return null;
  }
  const pendingContext = isPlainObject(resumeData)
    && isPlainObject((resumeData as JsonObject).pending_output_context)
    ? (resumeData as JsonObject).pending_output_context
    : null;
  if (pendingContext !== null) {
    if (
      typeof pendingContext.turn_id === "string"
      && pendingContext.turn_id
      && pendingContext.turn_id !== turnId
    ) return null;
    if (
      typeof pendingContext.source_digest === "string"
      && pendingContext.source_digest
      && pendingContext.source_digest !== sourceDigest
    ) return null;
    if (
      Number.isInteger(pendingContext.revision)
      && pendingContext.revision !== finalizeRevision
    ) return null;
  }
  return {
    agencyReviewRequired,
    reviewCard,
    finalizeCard,
    revision: finalizeRevision,
    turnId,
    sourceDigest,
  };
}

/**
 * True when the canonical resume snapshot alone already projects the
 * complete applicable card chain (a valid finalize card, plus a valid
 * review card whenever a review card is offered at all). This is the
 * host-hydration trigger's "valid inline cards are absent" test.
 */
export function pendingFinalizationInlineCardsComplete(value: unknown): boolean {
  if (!isPendingFinalizationResume(value) || !isPlainObject(value)) return false;
  const data = isPlainObject(value.data) ? value.data : null;
  const pendingContext = data !== null
    && isPlainObject(data.pending_output_context)
    ? data.pending_output_context
    : null;
  if (pendingContext === null) return false;
  if (
    !isOperationCard(
      pendingContext.finalize_operation,
      CANONICAL_FINALIZE_OPERATION_IDENTITY,
    )
  ) return false;
  const reviewSlot = pendingContext.agency_review_operation;
  if (reviewSlot === undefined || reviewSlot === null) return true;
  return isOperationCard(reviewSlot, CANONICAL_REVIEW_OPERATION_IDENTITY);
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
  options?: {
    reviewRecoveryArmed?: boolean;
    revision?: number;
    /**
     * Host-owned live-context hydration outcome. `not_attempted` (or
     * absent) keeps the ordinary snapshot behavior; `unavailable` means
     * the host attempted and lost the live refresh — no card of any
     * provenance may then be projected, only the card-free pointer
     * guidance; `success` carries the module-validated exact live cards,
     * which are authoritative over any resume snapshot chain.
     */
    liveHydration?: PendingFinalizationHydration;
  },
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
  // resume payload supplies a well-formed card and the host has not lost a
  // live refresh. Missing or malformed cards stay missing (fail closed);
  // the adapter invents no argument, id, or ordering data.
  const pendingContext = isPlainObject(data.pending_output_context)
    ? data.pending_output_context
    : null;
  let reviewCard = pendingContext !== null
    && isOperationCard(
      pendingContext.agency_review_operation,
      CANONICAL_REVIEW_OPERATION_IDENTITY,
    )
    ? deepCopyValue(pendingContext.agency_review_operation) as JsonObject
    : null;
  let finalizeCard = pendingContext !== null
    && isOperationCard(
      pendingContext.finalize_operation,
      CANONICAL_FINALIZE_OPERATION_IDENTITY,
    )
    ? deepCopyValue(pendingContext.finalize_operation) as JsonObject
    : null;
  const liveHydration = options?.liveHydration ?? { status: "not_attempted" };
  let liveRevision: number | null = null;
  let liveProjected = false;
  if (
    liveHydration.status === "unavailable"
    || liveHydration.status === "superseded"
  ) {
    // The host attempted a live refresh and lost it: no snapshot card may
    // masquerade as live authority. The card-free pointer guidance is the
    // complete fallback.
    reviewCard = null;
    finalizeCard = null;
  } else if (liveHydration.status === "success") {
    reviewCard = liveHydration.cards.reviewCard === null
      ? null
      : deepCopyValue(liveHydration.cards.reviewCard) as JsonObject;
    finalizeCard = deepCopyValue(liveHydration.cards.finalizeCard) as JsonObject;
    liveRevision = liveHydration.cards.revision;
    liveProjected = true;
  }
  const nextFirstCard = liveProjected && reviewCard !== null
    ? reviewCard
    : liveProjected
      ? finalizeCard
      : null;
  const guidance = {
    schema_version: 1,
    contract_id: PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT,
    audience: "keeper_only",
    mode: "pending_finalization",
    status: "journaled_settled_pending_finalization",
    ...(liveProjected
      ? {
          output_context_status: "host_refreshed_live",
          // The exact card lives once, in review_recovery.card (or then.card
          // for direct finalize); next_call names the next model action only.
          next_call: {
            tool: nextFirstCard !== null && typeof nextFirstCard.invoke_via === "string"
              ? nextFirstCard.invoke_via
              : "coc_narration_review",
          },
        }
      : { next_call: outputContextCall }),
    ...((reviewCard !== null || finalizeCard !== null)
      ? {
          card_projection: {
            source: liveProjected
              ? "host_refreshed_live_context"
              : "session.resume.pending_output_context",
            ...(!liveProjected
              ? { authoritative_copy: "coc_turn_output_context" }
              : {}),
            instruction: liveProjected
              ? (
                "The host already ingested the validated live context through "
                + "the canonical compiler and binding path. The exact cards "
                + "inlined in review_recovery.card and then.card are the only "
                + "action authority. Merge each card's prefilled_arguments "
                + "unchanged and supply only its missing_arguments, in the "
                + "order review_recovery before then."
              )
              : (
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
      tool: reviewCard !== null && typeof reviewCard.invoke_via === "string"
        ? reviewCard.invoke_via
        : "coc_narration_review",
      ...(!liveProjected
        ? { exact_card_path: "coc_turn_output_context.data.agency_review_operation" }
        : {}),
      ...(reviewCard !== null ? { card: reviewCard } : {}),
      armed: options?.reviewRecoveryArmed === true,
      revision: Number.isInteger(options?.revision)
        ? options.revision
        : liveRevision,
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
      tool: finalizeCard !== null && typeof finalizeCard.invoke_via === "string"
        ? finalizeCard.invoke_via
        : "coc_turn_finalize",
      ...(!liveProjected
        ? { exact_card_path: "coc_turn_output_context.data.finalize_operation" }
        : {}),
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
        pending_output_context: liveProjected
          ? { status: "host_refreshed_live" }
          : {
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
      card_source: liveHydration.status === "unavailable"
        ? "host_refresh_unavailable_card_free"
        : liveProjected
          ? "host_refreshed_turn_output_context"
          : "session.resume.pending_output_context",
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
