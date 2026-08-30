/**
 * Structured host guidance for an open recovered turn.
 *
 * Consumer: pi-coc play KP, attached onto a successful session.resume tool
 * result. This is host instruction, never player-visible fiction and never a
 * second narrative engine.
 */
import { createHash } from "node:crypto";
import type { JsonObject } from "./runtime.ts";
import { canonicalDigest } from "./state-claim-compiler.ts";
import {
  getOperationContract,
  loadOperationContracts,
  type JsonSchema,
} from "./operation-contracts.ts";
import {
  projectModelCallArguments,
  type ModelCallArgumentProjection,
  type ReviewedAgencyBinding,
} from "./tool-contract-projection.ts";

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

/** Canonical keeper-only frozen narration draft receipt produced by the
 * `turn.output_context` producer (`data.frozen_narration_draft`). The exact
 * binding fields are machine-checked against the validated live chain; the
 * draft text is the exact bytes the review must re-submit. The receipt
 * revision is the reviewed draft's own revision and is never relabeled. */
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function nonEmptyStringField(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sha256DigestField(value: unknown): value is string {
  return typeof value === "string" && SHA256_DIGEST_RE.test(value);
}

/**
 * True only when `digest` is the exact canonical digest of the draft text
 * (SHA-256 over its stable JSON serialization, matching the kernel's
 * `_canonical_digest` convention) — never a format-only acceptance.
 */
function digestMatchesTextBytes(digest: string, text: string): boolean {
  return canonicalDigest(text) === digest;
}

/** Exact UTF-8 byte length of the draft text (kernel `draft_utf8_bytes`). */
function draftUtf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Non-empty bounded UTF-8 string (never a bare truthy acceptance). */
function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.trim().length > 0
    && Buffer.byteLength(value, "utf8") <= maxBytes;
}

/** Closed receipt field set — exactly the canonical producer schema. */
const FROZEN_RECEIPT_FIELDS = new Set([
  "schema_version", "kind", "secrecy", "campaign_id", "receipt_id",
  "review_decision_id", "review_id", "turn_id", "source_digest",
  "revision", "draft_sha256", "draft_text", "draft_utf8_bytes",
  "review_digest", "request_digest", "producer_kind", "source_operation",
  "materialization_decision_id", "provenance", "receipt_digest",
]);
const FROZEN_DRAFT_MAX_UTF8_BYTES = 8192;
const FROZEN_DRAFT_MAX_PROVENANCE_ROWS = 8;

/**
 * Bounded, closed provenance validation per producer kind. A normal
 * submission carries only its kind marker; an audit materialization
 * carries the bounded corroboration binding (fixed field set, deterministic
 * row count cap, primary row digest, and canonical aggregate digest).
 */
function validFrozenDraftProvenance(value: JsonObject): boolean {
  const provenance = value.provenance;
  if (!isPlainObject(provenance)) return false;
  const keys = Object.keys(provenance).sort();
  const sameKeys = (expected: readonly string[]) =>
    keys.length === expected.length && expected.every((key) => key in provenance);
  if (value.producer_kind === "narration_review_submission") {
    return sameKeys(["kind"]) && provenance.kind === "direct_review_submission";
  }
  if (value.producer_kind === "toolbox_audit_recovery") {
    if (!sameKeys([
      "kind", "source_path", "source_row_count", "primary_row_digest",
      "corroboration_digest",
    ])) return false;
    const rowCount = provenance.source_row_count;
    return provenance.kind === "verified_toolbox_audit_recovery"
      && provenance.source_path === "logs/toolbox-calls.jsonl"
      && Number.isInteger(rowCount)
      && rowCount >= 1 && rowCount <= FROZEN_DRAFT_MAX_PROVENANCE_ROWS
      && sha256DigestField(provenance.primary_row_digest)
      && sha256DigestField(provenance.corroboration_digest);
  }
  return false;
}

/**
 * Recompute the receipt integrity digest over the canonical payload with
 * only the digest field excluded — the exact Python `_canonical_digest`
 * convention over the stored receipt (which never carries `ts` here).
 */
function receiptDigestMatches(value: JsonObject): boolean {
  const payload: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== "receipt_digest") payload[key] = entry;
  }
  return canonicalDigest(payload) === value.receipt_digest;
}

/**
 * Canonical excerpt-only revision repair evidence: the producer attaches
 * `span_repairs` to the review card exactly when a prior revision's span
 * repair is actionable, which is the only canonical basis for a frozen
 * receipt one revision behind the actionable cards.
 *
 * Closed bounded contract (coc.span-repairs.v1), byte-for-byte the same
 * rules as the kernel producer validator (`_valid_span_repairs` in
 * coc_operation_turn_output.py): exact field sets, non-empty bounded
 * strings, canonical repair action, no duplicate (excerpt, kind) pair, each
 * excerpt occurring in the frozen baseline when one is given, and
 * deterministic count and aggregate excerpt-byte caps.
 */
const SPAN_REPAIRS_CONTRACT_ID = "coc.span-repairs.v1";
const SPAN_REPAIRS_MODE = "excerpt_only";
const SPAN_REPAIRS_REPAIR_ACTION = "rephrase_or_remove";
const SPAN_REPAIRS_FIELDS = new Set([
  "schema_version", "contract_id", "mode", "spans", "instruction",
]);
const SPAN_REPAIRS_ENTRY_FIELDS = new Set([
  "exact_excerpt", "claim_kind", "reason", "repair",
]);
const SPAN_REPAIRS_MAX_SPANS = 16;
const SPAN_REPAIRS_MAX_EXCERPT_UTF8_BYTES = 2048;
const SPAN_REPAIRS_MAX_CLAIM_KIND_UTF8_BYTES = 128;
const SPAN_REPAIRS_MAX_REASON_UTF8_BYTES = 1024;
const SPAN_REPAIRS_MAX_INSTRUCTION_UTF8_BYTES = 512;
const SPAN_REPAIRS_MAX_AGGREGATE_EXCERPT_UTF8_BYTES = 4096;

function validateSpanRepairs(value: unknown, baselineText: string | null): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== SPAN_REPAIRS_FIELDS.size) return false;
  for (const key of keys) {
    if (!SPAN_REPAIRS_FIELDS.has(key)) return false;
  }
  if (value.schema_version !== 1) return false;
  if (value.contract_id !== SPAN_REPAIRS_CONTRACT_ID) return false;
  if (value.mode !== SPAN_REPAIRS_MODE) return false;
  if (!boundedString(value.instruction, SPAN_REPAIRS_MAX_INSTRUCTION_UTF8_BYTES)) {
    return false;
  }
  const spans = value.spans;
  if (
    !Array.isArray(spans)
    || spans.length < 1
    || spans.length > SPAN_REPAIRS_MAX_SPANS
  ) return false;
  const seen = new Set<string>();
  let aggregateExcerptBytes = 0;
  for (const raw of spans) {
    if (!isPlainObject(raw)) return false;
    const entryKeys = Object.keys(raw);
    if (entryKeys.length !== SPAN_REPAIRS_ENTRY_FIELDS.size) return false;
    for (const key of entryKeys) {
      if (!SPAN_REPAIRS_ENTRY_FIELDS.has(key)) return false;
    }
    const excerpt = raw.exact_excerpt;
    const claimKind = raw.claim_kind;
    if (!boundedString(excerpt, SPAN_REPAIRS_MAX_EXCERPT_UTF8_BYTES)) return false;
    if (!boundedString(claimKind, SPAN_REPAIRS_MAX_CLAIM_KIND_UTF8_BYTES)) return false;
    if (!boundedString(raw.reason, SPAN_REPAIRS_MAX_REASON_UTF8_BYTES)) return false;
    if (raw.repair !== SPAN_REPAIRS_REPAIR_ACTION) return false;
    const dedupeKey = `${excerpt}\u0000${claimKind}`;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    if (baselineText !== null && !baselineText.includes(excerpt)) return false;
    aggregateExcerptBytes += draftUtf8Bytes(excerpt);
    if (aggregateExcerptBytes > SPAN_REPAIRS_MAX_AGGREGATE_EXCERPT_UTF8_BYTES) {
      return false;
    }
  }
  return true;
}

function cardCarriesSpanRepairEvidence(card: JsonObject): boolean {
  return Object.hasOwn(card, "span_repairs")
    && validateSpanRepairs(card.span_repairs, null);
}

/** How the frozen baseline relates to the actionable review card. */
export type FrozenDraftMode = "exact_replay" | "excerpt_only_repair";

/**
 * The frozen receipt binds its own exact review revision and is accepted
 * only when it is either the actionable card revision (clear/active same
 * revision) or exactly card revision-1 with canonical span-repair evidence.
 * The receipt is never relabeled to match the cards.
 */
function frozenDraftRevisionAccepted(
  frozenDraft: JsonObject,
  cardRevision: number,
  evidenceCard: JsonObject,
): boolean {
  const revision = frozenDraft.revision;
  if (!Number.isInteger(revision) || revision < 1) return false;
  if (revision === cardRevision) return true;
  if (revision === cardRevision - 1) {
    return cardCarriesSpanRepairEvidence(evidenceCard);
  }
  return false;
}

function frozenDraftModeOf(
  frozenDraft: JsonObject,
  cardRevision: number,
): FrozenDraftMode | null {
  if (frozenDraft.revision === cardRevision) return "exact_replay";
  if (frozenDraft.revision === cardRevision - 1) return "excerpt_only_repair";
  return null;
}

/**
 * Validate the canonical `frozen_narration_draft` receipt against the exact
 * live turn/source chain and return it as an exact deep copy, or `null`
 * when anything is missing, extra, stale, divergent, or malformed.
 * Requires the complete closed producer schema: kind, semantic receipt_id,
 * all identity fields, both review/request digests, exact canonical
 * draft_sha256 over the text, exact `draft_utf8_bytes` within the 8192-byte
 * bound, allowed producer/source kinds, bounded closed provenance per
 * producer kind, and a recomputed `receipt_digest`. The receipt's own
 * revision (1 or 2 only) is carried verbatim (never relabeled). Pure.
 */
export function validateFrozenNarrationDraft(
  value: unknown,
  binding: { turnId: string; sourceDigest: string; campaignId?: string },
): JsonObject | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== FROZEN_RECEIPT_FIELDS.size) return null;
  for (const key of keys) {
    if (!FROZEN_RECEIPT_FIELDS.has(key)) return null;
  }
  if (value.schema_version !== 1) return null;
  if (value.kind !== "pending_narration_draft") return null;
  if (value.secrecy !== "keeper_only") return null;
  if (!nonEmptyStringField(value.campaign_id)) return null;
  // Campaign identity binding: when the validator knows the current
  // resume/output-context campaign, the receipt's campaign_id must equal
  // it exactly — never merely be present.
  if (binding.campaignId !== undefined && value.campaign_id !== binding.campaignId) {
    return null;
  }
  if (!nonEmptyStringField(value.review_decision_id)) return null;
  if (!nonEmptyStringField(value.review_id)) return null;
  if (value.turn_id !== binding.turnId) return null;
  if (value.source_digest !== binding.sourceDigest) return null;
  if (
    !Number.isInteger(value.revision)
    || value.revision < 1
    || value.revision > 2
  ) return null;
  if (
    value.receipt_id
      !== `pending-narration-draft:${value.review_decision_id}:revision-${value.revision}`
  ) return null;
  if (value.source_operation !== "narration.review") return null;
  if (
    value.producer_kind !== "narration_review_submission"
    && value.producer_kind !== "toolbox_audit_recovery"
  ) return null;
  if (!nonEmptyStringField(value.materialization_decision_id)) return null;
  // Producer-specific materialization identity: a direct review submission
  // materializes under the review's own decision id; an audit recovery
  // materializes under its own distinct recovery decision id. Truthy
  // acceptance of either relationship is not valid.
  if (value.producer_kind === "narration_review_submission") {
    if (value.materialization_decision_id !== value.review_decision_id) return null;
  } else if (value.materialization_decision_id === value.review_decision_id) {
    return null;
  }
  if (!sha256DigestField(value.draft_sha256)) return null;
  if (!nonEmptyStringField(value.draft_text)) return null;
  // NUL parity with the canonical Python validator: a draft containing
  // U+0000 is invalid even when its draft and receipt digests recompute.
  if (value.draft_text.includes("\u0000")) return null;
  if (!digestMatchesTextBytes(value.draft_sha256, value.draft_text)) return null;
  if (
    !Number.isInteger(value.draft_utf8_bytes)
    || value.draft_utf8_bytes !== draftUtf8Bytes(value.draft_text)
    || value.draft_utf8_bytes > FROZEN_DRAFT_MAX_UTF8_BYTES
    || value.draft_utf8_bytes < 1
  ) return null;
  if (!sha256DigestField(value.review_digest)) return null;
  if (!sha256DigestField(value.request_digest)) return null;
  if (!validFrozenDraftProvenance(value)) return null;
  if (!sha256DigestField(value.receipt_digest)) return null;
  if (!receiptDigestMatches(value)) return null;
  return deepCopyValue(value) as JsonObject;
}

const ACCEPTED_REVIEW_EVIDENCE_CONTRACT =
  "coc.accepted-review-evidence.v1";
const ACCEPTED_REVIEW_EVIDENCE_FIELDS = new Set([
  "schema_version", "contract_id", "visibility", "review_id", "turn_id",
  "source_digest", "revision", "draft_sha256", "review_digest",
  "pending_draft_receipt_digest", "contract_projection_sha256",
  "verification", "state_authority_review", "player_input_source_ref",
  "agency_authority", "control_overrides", "evidence_sha256",
]);
const ACCEPTED_REVIEW_VERIFICATION_FIELDS = new Set([
  "agency_gate", "state_authority_gate",
]);
const ACCEPTED_STATE_REVIEW_FIELDS = new Set([
  "disposition", "reason", "claims",
]);
const ACCEPTED_STATE_CLAIM_FIELDS = new Set([
  "claim_id", "subject_ref", "claim_kind", "exact_excerpt",
  "source_effect_id", "reason",
]);
const ACCEPTED_STATE_CLAIM_KINDS = new Set([
  "cash", "item", "purchase", "assets_liquidate", "scalar",
  "loaded_ammunition", "condition", "time", "time_appearance", "rest",
]);

function hasExactFields(value: JsonObject, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function acceptedEvidenceDigestMatches(value: JsonObject): boolean {
  const payload: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== "evidence_sha256") payload[key] = entry;
  }
  return canonicalDigest(payload) === value.evidence_sha256;
}

function validAcceptedStateReview(
  value: unknown,
  draft: string,
  pcSubjectRefs: readonly string[],
): value is JsonObject {
  if (!isPlainObject(value) || !hasExactFields(value, ACCEPTED_STATE_REVIEW_FIELDS)) {
    return false;
  }
  const disposition = value.disposition;
  const claims = value.claims;
  if (
    (disposition !== "no_player_state_change_claimed"
      && disposition !== "claims_listed")
    || !boundedString(value.reason, 4096)
    || !Array.isArray(claims)
    || claims.length > 64
    || (disposition === "no_player_state_change_claimed" && claims.length !== 0)
    || (disposition === "claims_listed" && claims.length === 0)
  ) return false;
  const seenClaims = new Set<string>();
  const seenEffects = new Set<string>();
  for (const raw of claims) {
    if (!isPlainObject(raw) || !hasExactFields(raw, ACCEPTED_STATE_CLAIM_FIELDS)) {
      return false;
    }
    if (
      !boundedString(raw.claim_id, 256)
      || seenClaims.has(raw.claim_id)
      || !nonEmptyStringField(raw.subject_ref)
      || !pcSubjectRefs.includes(raw.subject_ref)
      || typeof raw.claim_kind !== "string"
      || !ACCEPTED_STATE_CLAIM_KINDS.has(raw.claim_kind)
      || !boundedString(raw.exact_excerpt, FROZEN_DRAFT_MAX_UTF8_BYTES)
      || !draft.includes(raw.exact_excerpt)
      || !boundedString(raw.source_effect_id, 512)
      || seenEffects.has(raw.source_effect_id)
      || !boundedString(raw.reason, 4096)
    ) return false;
    seenClaims.add(raw.claim_id);
    seenEffects.add(raw.source_effect_id);
  }
  return true;
}

/**
 * Validate the canonical host-only accepted-review bridge against three
 * independent sources already present in the same live context: the frozen
 * draft receipt, the current contract projection, and the output-context
 * identity. A self-consistent mutation of the evidence block alone is never
 * enough. The returned copy is safe for host-side binding only; model
 * projection deliberately has no route for this field.
 */
function validateAcceptedReviewEvidence(
  value: unknown,
  binding: {
    turnId: string;
    sourceDigest: string;
    revision: number;
    frozenDraft: JsonObject;
    contractProjection: JsonObject;
    contractProjectionSha256: unknown;
  },
): JsonObject | null {
  if (!isPlainObject(value) || !hasExactFields(value, ACCEPTED_REVIEW_EVIDENCE_FIELDS)) {
    return null;
  }
  const verification = isPlainObject(value.verification)
    ? value.verification
    : null;
  const agencyAuthority = isPlainObject(value.agency_authority)
    ? value.agency_authority
    : null;
  const canonicalAuthority = isPlainObject(
    binding.contractProjection.agency_authority,
  ) ? binding.contractProjection.agency_authority : null;
  const playerInput = isPlainObject(binding.contractProjection.player_input)
    ? binding.contractProjection.player_input
    : null;
  const canonicalOverrides = Array.isArray(
    binding.contractProjection.control_overrides,
  ) ? binding.contractProjection.control_overrides : null;
  const pcSubjectRefs = agencyAuthority !== null
    && Array.isArray(agencyAuthority.pc_subject_refs)
    ? agencyAuthority.pc_subject_refs.filter(
      (entry): entry is string => nonEmptyStringField(entry),
    )
    : [];
  if (
    value.schema_version !== 1
    || value.contract_id !== ACCEPTED_REVIEW_EVIDENCE_CONTRACT
    || value.visibility !== "host_only"
    || value.review_id !== binding.frozenDraft.review_id
    || value.turn_id !== binding.turnId
    || value.source_digest !== binding.sourceDigest
    || value.revision !== binding.revision
    || value.revision !== binding.frozenDraft.revision
    || value.draft_sha256 !== binding.frozenDraft.draft_sha256
    || value.review_digest !== binding.frozenDraft.review_digest
    || value.pending_draft_receipt_digest !== binding.frozenDraft.receipt_digest
    || !sha256DigestField(value.draft_sha256)
    || !sha256DigestField(value.review_digest)
    || !sha256DigestField(value.pending_draft_receipt_digest)
    || !sha256DigestField(value.contract_projection_sha256)
    || !sha256DigestField(value.evidence_sha256)
    || value.contract_projection_sha256 !== binding.contractProjectionSha256
    || value.contract_projection_sha256
      !== canonicalDigest(binding.contractProjection)
    || verification === null
    || !hasExactFields(verification, ACCEPTED_REVIEW_VERIFICATION_FIELDS)
    || verification.agency_gate !== "clear"
    || verification.state_authority_gate !== "clear"
    || agencyAuthority === null
    || canonicalAuthority === null
    || pcSubjectRefs.length !== 1
    || canonicalDigest(agencyAuthority) !== canonicalDigest(canonicalAuthority)
    || !nonEmptyStringField(value.player_input_source_ref)
    || playerInput === null
    || value.player_input_source_ref !== playerInput.source_ref
    || !Array.isArray(value.control_overrides)
    || canonicalOverrides === null
    || canonicalDigest(value.control_overrides) !== canonicalDigest(canonicalOverrides)
    || typeof binding.frozenDraft.draft_text !== "string"
    || !validAcceptedStateReview(
      value.state_authority_review,
      binding.frozenDraft.draft_text,
      pcSubjectRefs,
    )
    || !acceptedEvidenceDigestMatches(value)
  ) return null;
  return deepCopyValue(value) as JsonObject;
}

/**
 * Actual typed input schemas for the two recovery model-call surfaces,
 * loaded once from the canonical MCP operation contract archive. The
 * model-call projection is derived from these schemas — never from a
 * duplicated hand list. `null` (archive unusable) fails closed.
 */
let recoveryTypedSchemasCache: {
  review: JsonSchema;
  finalize: JsonSchema;
} | null | undefined;

function recoveryTypedSchemas(): {
  review: JsonSchema;
  finalize: JsonSchema;
} | null {
  if (recoveryTypedSchemasCache !== undefined) return recoveryTypedSchemasCache;
  try {
    const catalog = loadOperationContracts();
    recoveryTypedSchemasCache = {
      review: getOperationContract(catalog, "narration.review").inputSchema,
      finalize: getOperationContract(catalog, "turn.finalize").inputSchema,
    };
  } catch {
    recoveryTypedSchemasCache = null;
  }
  return recoveryTypedSchemasCache;
}

/**
 * Separate model-call projection for the live recovery path, derived from
 * the actual typed tool schemas with the exact card invoke_via surfaces.
 * Review is present only when the review card is; the finalize projection
 * supports both canonical card invoke_via surfaces (coc_turn_finalize when
 * agency review is required, coc_invoke when not). Returns `null` when the
 * typed contracts cannot be loaded — the caller fails closed to pointer
 * guidance rather than projecting a guessed argument list.
 */
function buildRecoveryModelCalls(
  reviewCard: JsonObject | null,
  finalizeCard: JsonObject,
): {
  review?: ModelCallArgumentProjection;
  finalize: ModelCallArgumentProjection;
} | null {
  const schemas = recoveryTypedSchemas();
  if (schemas === null) return null;
  try {
    const finalizeInvokeVia = typeof finalizeCard.invoke_via === "string"
      ? finalizeCard.invoke_via
      : "";
    const finalize = projectModelCallArguments(
      "turn.finalize",
      finalizeInvokeVia,
      schemas.finalize,
    );
    if (reviewCard === null) return { finalize };
    const reviewInvokeVia = typeof reviewCard.invoke_via === "string"
      ? reviewCard.invoke_via
      : "";
    return {
      review: projectModelCallArguments(
        "narration.review",
        reviewInvokeVia,
        schemas.review,
      ),
      finalize,
    };
  } catch {
    return null;
  }
}

function buildAcceptedReviewFinalizeModelCall(
  finalizeCard: JsonObject,
): ModelCallArgumentProjection | null {
  const ordinary = buildRecoveryModelCalls(null, finalizeCard)?.finalize;
  if (ordinary === undefined) return null;
  const prefilled = isPlainObject(finalizeCard.prefilled_arguments)
    ? finalizeCard.prefilled_arguments
    : {};
  const missing = Array.isArray(finalizeCard.missing_arguments)
    ? finalizeCard.missing_arguments
    : [];
  if (
    !Object.hasOwn(prefilled, "coverage")
      && !missing.includes("coverage")
    || !missing.includes("agency_claims")
    || !missing.includes("draft")
  ) return null;
  return {
    ...ordinary,
    model_owned_required_arguments: ["coverage", "agency_claims"],
    model_owned_optional_arguments: [],
    host_bound_auto_attached_arguments: [
      ...new Set([
        ...ordinary.host_bound_auto_attached_arguments,
        "draft",
      ]),
    ].sort(),
  };
}

function projectAcceptedReviewBindingForModel(
  binding: ReviewedAgencyBinding,
): JsonObject {
  return {
    visibility: "keeper_only",
    source: "turn.output_context.data.accepted_review_evidence",
    mode: "accepted_review_semantic",
    reviewed_spans: binding.spans.map((row) => row.reviewed_span),
    authorities: binding.authorities.map((row) => ({
      authority: row.authority,
      claim_types: [...row.claim_types],
    })),
    model_arguments: ["coverage", "agency_claims"],
    instruction: (
      "Call turn.finalize with coverage and semantic agency_claims only. "
      + "Choose reviewed_span, claim_type, and authority from this card; "
      + "the host restores the accepted draft and exact evidence."
    ),
  };
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

/** The pending resume's own campaign id, when it carries one. Accepts the
 * full resume envelope or its `data` object (both appear as callers). */
function resumeCampaignIdOf(resumeData: unknown): string {
  if (!isPlainObject(resumeData)) return "";
  const direct = resumeData.campaign_id;
  if (typeof direct === "string" && direct) return direct;
  const data = isPlainObject(resumeData.data) ? resumeData.data : null;
  const campaignId = data === null ? undefined : data.campaign_id;
  return typeof campaignId === "string" && campaignId ? campaignId : "";
}

export type LiveOutputContextCards = {
  agencyReviewRequired: boolean;
  reviewCard: JsonObject | null;
  finalizeCard: JsonObject;
  revision: number;
  turnId: string;
  sourceDigest: string;
  /** Host-injected journal decision id from the validated receipt, if any. */
  journalDecisionId: string | null;
  /**
   * Exact deep copy of the canonical `data.frozen_narration_draft` receipt
   * when the live context carries one. Present exactly when a frozen draft
   * was validated; review-required live recovery additionally requires it.
   */
  frozenDraft: JsonObject | null;
  /**
   * How the frozen baseline relates to the actionable review card:
   * `exact_replay` — the receipt is the current card revision (submit it
   * unchanged, or semantically complete it per the review contract);
   * `excerpt_only_repair` — the receipt is the rejected card revision-1
   * baseline and the model MUST edit only the listed span-repair excerpts.
   */
  frozenDraftMode: FrozenDraftMode | null;
  /**
   * Closed canonical evidence that the frozen draft already passed the
   * active review. Exact excerpts and authority facts remain host-only.
   */
  acceptedReviewEvidence: JsonObject | null;
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
  options?: {
    /**
     * Recovery hydration mode: a live chain for a review-required pending
     * turn is usable only with the exact canonical frozen draft. A missing
     * or divergent receipt fails the whole chain closed (pointer guidance,
     * no review card). Explicit canonical `turn.output_context` calls keep
     * the ordinary live-turn behavior and only validate a draft when the
     * producer supplies one.
     */
    requireFrozenDraft?: boolean;
    /**
     * The current campaign id, when the caller knows it. When omitted it
     * is derived from the pending resume's own campaign_id; a frozen-draft
     * receipt's campaign_id must equal the resolved campaign exactly.
     */
    campaignId?: string;
  },
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
  // A present frozen-draft receipt must validate exactly: any stale,
  // divergent, or malformed value fails the whole chain closed in every
  // mode. Its own revision is never relabeled: it must be either the
  // actionable card revision or exactly card revision-1 with canonical
  // span-repair evidence on the applicable card. Campaign identity binds
  // exactly when known: from the explicit option, otherwise from the
  // pending resume's own campaign_id (verified against the invocation by
  // the caller). An absent receipt fails closed only when recovery
  // hydration requires it for a review-required pending chain.
  const expectedCampaignId = options?.campaignId
    ?? resumeCampaignIdOf(resumeData);
  const hasFrozenDraftField = Object.hasOwn(data, "frozen_narration_draft");
  const frozenDraft = hasFrozenDraftField
    ? validateFrozenNarrationDraft(data.frozen_narration_draft, {
        turnId,
        sourceDigest,
        ...(expectedCampaignId ? { campaignId: expectedCampaignId } : {}),
      })
    : null;
  if (hasFrozenDraftField && frozenDraft === null) return null;
  const frozenDraftMode = frozenDraft !== null
    ? frozenDraftModeOf(frozenDraft, finalizeRevision)
    : null;
  if (frozenDraft !== null && frozenDraftMode === null) return null;
  if (
    frozenDraft !== null
    && !frozenDraftRevisionAccepted(
      frozenDraft,
      finalizeRevision,
      reviewCard ?? finalizeCard,
    )
  ) return null;
  // Repair evidence on the applicable card is fully validated against the
  // frozen baseline: structural closedness/bounds always, and in the
  // excerpt_only_repair mode every listed excerpt must occur exactly in
  // the frozen revision-1 baseline text. Anything else fails closed.
  if (frozenDraft !== null) {
    const evidenceCard: JsonObject = reviewCard ?? finalizeCard;
    if (Object.hasOwn(evidenceCard, "span_repairs")) {
      const baseline = frozenDraftMode === "excerpt_only_repair"
        && typeof frozenDraft.draft_text === "string"
        ? frozenDraft.draft_text
        : null;
      if (!validateSpanRepairs(evidenceCard.span_repairs, baseline)) return null;
    }
  }
  if (
    options?.requireFrozenDraft === true
    && agencyReviewRequired
    && frozenDraft === null
  ) return null;
  const hasAcceptedReviewEvidence = Object.hasOwn(
    data,
    "accepted_review_evidence",
  );
  let acceptedReviewEvidence: JsonObject | null = null;
  if (hasAcceptedReviewEvidence) {
    if (
      !agencyReviewRequired
      || frozenDraft === null
      || frozenDraftMode !== "exact_replay"
    ) return null;
    acceptedReviewEvidence = validateAcceptedReviewEvidence(
      data.accepted_review_evidence,
      {
        turnId,
        sourceDigest,
        revision: finalizeRevision,
        frozenDraft,
        contractProjection,
        contractProjectionSha256: data.contract_projection_sha256,
      },
    );
    if (acceptedReviewEvidence === null) return null;
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
    journalDecisionId: typeof data.journal_decision_id === "string"
      && data.journal_decision_id
      ? data.journal_decision_id
      : null,
    frozenDraft,
    frozenDraftMode,
    acceptedReviewEvidence,
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

function settledSemanticRecoveryContext(data: JsonObject): JsonObject | null {
  const capsule = isPlainObject(data.semantic_capsule)
    ? data.semantic_capsule
    : null;
  if (capsule === null) return null;
  const projectRows = (
    value: unknown,
    fields: readonly string[],
  ): JsonObject[] => Array.isArray(value)
    ? value.filter(isPlainObject).map((row) => {
        const projected: JsonObject = {};
        for (const field of fields) {
          if (field in row) projected[field] = deepCopyValue(row[field]);
        }
        return projected;
      })
    : [];
  const confirmedDecisions = projectRows(
    capsule.confirmed_decisions,
    ["summary", "reason"],
  );
  const openThreads = projectRows(
    capsule.threads,
    ["summary", "reason", "status"],
  );
  const doNotRepeat = projectRows(
    capsule.do_not_repeat,
    ["instruction", "reason"],
  );
  const styleCommitments = Array.isArray(capsule.style_commitments)
    ? capsule.style_commitments.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  if (
    confirmedDecisions.length === 0
    && openThreads.length === 0
    && doNotRepeat.length === 0
    && styleCommitments.length === 0
  ) return null;
  return {
    source: "settled_semantic_capsule",
    confirmed_decisions: confirmedDecisions,
    open_threads: openThreads,
    do_not_repeat: doNotRepeat,
    style_commitments: styleCommitments,
  };
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
    /**
     * The host validated the exact frozen draft plus the canonical accepted-
     * review evidence and rebuilt the normal semantic reviewed-agency binding.
     * Presence suppresses review as an executable recovery step; null/absent
     * keeps the existing review or pointer path fail-closed.
     */
    acceptedReviewBinding?: ReviewedAgencyBinding | null;
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
  const recoveryContext = settledSemanticRecoveryContext(data);
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
  let liveFrozenDraft: JsonObject | null = null;
  let liveFrozenDraftMode: FrozenDraftMode | null = null;
  let liveProjectionDropped = false;
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
    liveFrozenDraft = liveHydration.cards.frozenDraft === null
      ? null
      : deepCopyValue(liveHydration.cards.frozenDraft) as JsonObject;
    liveFrozenDraftMode = liveHydration.cards.frozenDraftMode;
    // A live review chain without the exact canonical frozen draft is
    // unusable: fail closed to card-free pointer guidance with no review
    // card. The host never reconstructs a draft from transcript history.
    if (reviewCard !== null && liveFrozenDraft === null) {
      reviewCard = null;
      finalizeCard = null;
      liveRevision = null;
      liveProjectionDropped = true;
    } else {
      // excerpt_only_repair additionally requires bounded canonical repair
      // evidence on the live review card; without span_repairs the repair
      // scope would be invented, so the chain fails closed instead.
      if (
        reviewCard !== null
        && liveFrozenDraftMode === "excerpt_only_repair"
        && !cardCarriesSpanRepairEvidence(reviewCard)
      ) {
        reviewCard = null;
        finalizeCard = null;
        liveFrozenDraft = null;
        liveFrozenDraftMode = null;
        liveRevision = null;
        liveProjectionDropped = true;
      } else {
        liveProjected = true;
      }
    }
  }
  // Separate model-call projection, derived from the actual typed tool
  // schemas (canonical MCP operation contract archive) with the exact card
  // invoke_via surfaces. If the typed contracts are unavailable the live
  // path degrades to card-free pointer guidance rather than regressing to
  // a guessed argument allowlist.
  const modelCalls = liveProjected && finalizeCard !== null
    ? buildRecoveryModelCalls(reviewCard, finalizeCard)
    : null;
  if (liveProjected && modelCalls === null) {
    reviewCard = null;
    finalizeCard = null;
    liveRevision = null;
    liveFrozenDraft = null;
    liveFrozenDraftMode = null;
    liveProjected = false;
    liveProjectionDropped = true;
  }
  let acceptedReview = (
    liveProjected
    && options?.acceptedReviewBinding != null
    && reviewCard !== null
    && finalizeCard !== null
    && liveFrozenDraft !== null
    && liveFrozenDraftMode === "exact_replay"
    && liveHydration.status === "success"
    && liveHydration.cards.acceptedReviewEvidence !== null
    && nonEmptyStringField(liveFrozenDraft.review_id)
  );
  // `modelCalls` was initially derived above to validate the complete live
  // chain. Once the host proves the accepted review binding is armed, derive
  // the actionable projection again without a review call: the review card
  // remains host-only evidence, never another 154-second model action.
  const actionableModelCalls = acceptedReview && finalizeCard !== null
    ? (() => {
        const finalize = buildAcceptedReviewFinalizeModelCall(finalizeCard);
        return finalize === null ? null : { finalize };
      })()
    : modelCalls;
  if (acceptedReview && actionableModelCalls === null) {
    acceptedReview = false;
    reviewCard = null;
    finalizeCard = null;
    liveRevision = null;
    liveFrozenDraft = null;
    liveFrozenDraftMode = null;
    liveProjected = false;
    liveProjectionDropped = true;
  }
  const actionableReviewCard = acceptedReview ? null : reviewCard;
  const nextFirstCard = liveProjected && actionableReviewCard !== null
    ? actionableReviewCard
    : liveProjected
      ? finalizeCard
      : null;
  const guidance: JsonObject = {
    schema_version: 1,
    contract_id: PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT,
    audience: "keeper_only",
    mode: "pending_finalization",
    status: acceptedReview
      ? "review_accepted_pending_finalization"
      : "journaled_settled_pending_finalization",
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
              ? acceptedReview
                ? (
                  "The host validated the live output context and armed "
                  + "turn.finalize from the already accepted frozen review. "
                  + "Call only the finalize tool named by next_call, supply "
                  + "only its model-owned arguments, and never call "
                  + "narration.review again or echo host-bound identity."
                )
                : (
                "The host already ingested the validated live context through "
                + "the canonical compiler and binding path. The exact cards "
                + "inlined in review_recovery.card and then.card are the only "
                + "action authority for operation identity and prefilled "
                + "arguments. For each call supply exactly the "
                + "model_owned_arguments listed in model_calls, following "
                + "review_recovery.review_input.mode for the review draft — "
                + "and never echo, invent, or construct "
                + "host_bound_auto_attached_arguments; the host attaches "
                + "them. Call review_recovery before then."
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
    ...(actionableModelCalls !== null
      ? {
          model_calls: {
            contract_source: "mcp_operation_contracts.inputSchema",
            audience: "keeper_only",
            ...(actionableModelCalls.review !== undefined
              ? {
                  review: {
                    ...actionableModelCalls.review,
                    instruction: (
                      "Supply exactly the model_owned_required_arguments (plus "
                      + "any model_owned_optional_arguments you semantically "
                      + "judge) to the typed tool. draft_text follows "
                      + "review_recovery.review_input: for exact_replay submit "
                      + "the supplied baseline_draft_text unchanged, or "
                      + "semantically complete it as the review contract "
                      + "allows; for excerpt_only_repair submit your EDITED "
                      + "revision-2 text produced from baseline_draft_text by "
                      + "changing only the excerpts listed in span_repairs — "
                      + "never resubmit the unchanged baseline. Where the "
                      + "review card already prefills a model-owned argument, "
                      + "keep its exact value. Never echo, invent, or modify "
                      + "any host_bound_auto_attached_arguments (decision, "
                      + "review, turn, source, revision identities and the "
                      + "state_claim_compilation compiler receipt); the host "
                      + "attaches them to the call."
                    ),
                  },
                }
              : {}),
            finalize: {
              ...actionableModelCalls.finalize,
              instruction: (
                "After an accepted review, supply exactly the "
                + "model_owned_required_arguments (plus any "
                + "model_owned_optional_arguments you semantically judge), keeping "
                + "any model-owned argument the then.card already prefills at "
                + "its exact card value. Invoke through the projection's real "
                + "surface: for invocation_shape generic_envelope call "
                + actionableModelCalls.finalize.invoke_via
                + " with {operation: \"turn.finalize\", arguments: {"
                + "...model-owned arguments...}}; for typed_flat pass the "
                + "model-owned arguments directly to the typed tool. Never "
                + "echo, invent, or construct any "
                + "host_bound_auto_attached_arguments (decision, revision, and "
                + "review identities); the host attaches them to the call."
              ),
            },
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
      ...(liveProjected && reviewCard !== null && liveFrozenDraft !== null
        ? {
            review_input: {
              visibility: "keeper_only",
              source: "turn.output_context.data.frozen_narration_draft",
              mode: liveFrozenDraftMode,
              baseline_draft_text: liveFrozenDraft.draft_text,
              baseline_draft_sha256: liveFrozenDraft.draft_sha256,
              ...(liveFrozenDraftMode === "excerpt_only_repair"
                ? {
                    span_repairs: deepCopyValue(
                      reviewCard.span_repairs,
                    ),
                  }
                : {}),
              instruction: liveFrozenDraftMode === "excerpt_only_repair"
                ? (
                  "The baseline_draft_text is the rejected revision the "
                  + "span_repairs belong to. Produce the revision-2 draft by "
                  + "editing ONLY the excerpts listed in span_repairs; keep "
                  + "every other sentence byte-stable and never regenerate "
                  + "the scene. Never resubmit the unchanged baseline."
                )
                : (
                  "The baseline_draft_text is the reviewed frozen revision. "
                  + "Submit it unchanged as draft_text, or semantically "
                  + "complete it as the narration.review contract allows."
                ),
            },
          }
        : {}),
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
      ...(acceptedReview && liveFrozenDraft !== null
        ? {
            finalize_input: projectAcceptedReviewBindingForModel(
              options!.acceptedReviewBinding!,
            ),
          }
        : {}),
      instruction: (
        acceptedReview
          ? (
            "Use the accepted-review semantic card and coverage, call "
            + "turn.finalize once, and never repeat review; the host restores "
            + "the accepted draft and exact evidence."
          )
          : (
            "Use the returned finalize_operation prefilled_arguments exactly, "
            + "supply only its missing_arguments, and do not construct, infer, "
            + "or reuse turn.finalize arguments from prior transcript history."
          )
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
  if (acceptedReview && reviewCard !== null && liveFrozenDraft !== null) {
    guidance.accepted_review = {
      status: "accepted",
      // Exact host-only evidence. The session.resume model projector reduces
      // this to status/instruction and never exposes the card or review id.
      card: reviewCard,
      review_id: liveFrozenDraft.review_id,
      revision: liveFrozenDraft.revision,
      instruction: (
        "This frozen draft already has an accepted narration review. Do not "
        + "call narration.review again; continue directly with next_call."
      ),
    };
    delete guidance.review_recovery;
  }
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
        ...(recoveryContext === null
          ? {}
          : { recovery_context: recoveryContext }),
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
        : liveProjectionDropped
          ? "host_refreshed_live_unusable_card_free"
          : liveProjected
            ? "host_refreshed_turn_output_context"
            : "session.resume.pending_output_context",
      operation_cards: {
        agency_review_operation: reviewCard !== null,
        finalize_operation: finalizeCard !== null,
      },
      ...(liveProjected
        ? {
            frozen_draft_review_input: reviewCard !== null,
            model_call_projection: {
              review: modelCalls?.review !== undefined,
              finalize: true,
            },
          }
        : {}),
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

// ---------------------------------------------------------------------------
// Draft-shape recovery card (run-02 paragraph-zero placement chain)
//
// Consumer: pi-coc play KP. When canonical `turn.finalize` rejects the frozen
// draft with `default_mechanics_placement_unavailable` (the consequence prose
// of a public roll sits in paragraph zero, or no paragraph carries the
// coverage excerpt), the host builds this executable card from the exact
// failed call plus the retained frozen-turn identities, persists it in the
// session, and re-presents it after agent end or in a fresh play session —
// even when `session.resume` lifecycle is already acknowledged.
//
// Invariants (fail closed at every step):
// - The card preserves the complete model-owned frozen finalize payload
//   (draft, full coverage rows, agency_claims, optional mechanics_placements).
//   A recovery retry may change only the draft's paragraph shape; every other
//   model-owned argument is replayed byte-for-byte from the card. Host-bound
//   identities (root/campaign/turn/source/revision/review/decision) are
//   machine-injected at call time and never relayed through the model.
// - A card exists only after its durable session entry append succeeded;
//   persistence failure leaves the original canonical error and no
//   recoverable claim.
// - Rehydration authenticates the card against host-owned accepted-review
//   evidence and never re-arms a card retired by a successful finalize.
// Pure module; no host state.
// ---------------------------------------------------------------------------

export const DRAFT_SHAPE_RECOVERY_CARD_CONTRACT =
  "coc.pi-draft-shape-recovery-card.v1";
/** Model-visible semantic projection contract (never carries opaque ids). */
export const DRAFT_SHAPE_RECOVERY_GUIDANCE_CONTRACT =
  "coc.pi-draft-shape-recovery-guidance.v1";
export const DRAFT_SHAPE_RECOVERY_CARD_AUDIT = "coc-draft-shape-recovery-card";
/** Durable machine-internal payload seal written beside each card append. */
export const DRAFT_SHAPE_RECOVERY_SEAL_AUDIT = "coc-draft-shape-recovery-seal";
/** Durable tombstone written only by an accepted `turn.finalize` receipt. */
export const DRAFT_SHAPE_RECOVERY_COMPLETE_AUDIT =
  "coc-draft-shape-recovery-complete";
/** Durable host-owned evidence written by an accepted `narration.review`. */
export const NARRATION_REVIEW_EVIDENCE_AUDIT = "coc-narration-review-accepted";
export const DRAFT_SHAPE_PLACEMENT_ERROR_CODE =
  "default_mechanics_placement_unavailable";
export const DRAFT_SHAPE_RECOVERY_NEXT_ACTION =
  "split_action_and_consequence_paragraphs";

/** Python-finalizer-exact split (coc_turn_finalization._draft_paragraphs). */
export function canonicalDraftParagraphs(draft: string): string[] {
  return draft.split("\n\n");
}

export function isDraftShapePlacementFailure(value: unknown): boolean {
  if (!isPlainObject(value) || value.ok !== false) return false;
  if (value.tool !== "turn.finalize") return false;
  const error = isPlainObject(value.error) ? value.error : null;
  return error?.code === DRAFT_SHAPE_PLACEMENT_ERROR_CODE;
}

/** Offending public-roll source ids, parsed from the canonical error message. */
export function placementFailureRollIds(message: string): string[] {
  const ids: string[] = [];
  const pattern =
    /public roll (\S+?) (?:consequence is in paragraph zero|has no safe preceding paragraph)/gu;
  for (const match of message.matchAll(pattern)) {
    if (match[1] && !ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Canonical host-owned `turn.finalize` argument names. Every key in this set
 * is machine-injected by the host binding and must never enter the frozen
 * model payload — including optional identities that a given binding may not
 * currently carry (repair_finalization_id). Runtime-injected keys are
 * subtracted in addition, so future host-binding identities stay excluded.
 */
export const HOST_BOUND_FINALIZE_ARGUMENTS: readonly string[] = [
  "root",
  "campaign",
  "decision_id",
  "revision",
  "narration_review_id",
  "repair_finalization_id",
];

/**
 * Recursive canonical JSON: object keys sorted at every depth, array order
 * preserved, exact JSON value normalization. Equivalent objects with
 * reordered keys serialize identically.
 */
export function canonicalJsonOf(value: unknown): string {
  if (
    value === null
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return JSON.stringify(value) ?? "null";
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonOf(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as JsonObject;
    const keys = Object.keys(record).sort();
    return `{${
      keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonOf(record[key])}`).join(",")
    }}`;
  }
  return "null";
}

/**
 * Machine-internal canonical digest of one frozen finalize payload. The
 * digest is host-computed, stored only in the durable seal and tombstone
 * entries, and never a model relay obligation.
 */
export function draftShapePayloadDigest(payload: unknown): string {
  return `sha256:${
    createHash("sha256").update(canonicalJsonOf(payload), "utf8").digest("hex")
  }`;
}

/**
 * Call-time recovery enforcement: for an armed recovery card, every actual
 * model-owned finalize argument except `draft` must canonical-equal the
 * frozen payload, and the key sets must match exactly (a field dropped or
 * added by the model is a mismatch). Only the draft's paragraph shape may
 * differ. Returns the offending field name, or null when the call exactly
 * replays the frozen payload.
 */
export function draftShapeRecoveryPayloadMismatch(
  card: JsonObject,
  finalizeArguments: JsonObject | null,
  modelOwnedFields: readonly string[],
): string | null {
  const payload = card.frozen_finalize_payload;
  if (!isFrozenFinalizePayload(payload)) return "frozen_finalize_payload";
  if (finalizeArguments === null) return "arguments";
  // Key-set union: a schema field dropped from the call, or an unexpected
  // field added to it, is as much a mutation as a changed value.
  const fields = new Set<string>([
    ...modelOwnedFields,
    ...Object.keys(finalizeArguments),
    ...Object.keys(payload),
  ]);
  for (const field of fields) {
    if (field === "draft") continue;
    const inCall = Object.hasOwn(finalizeArguments, field);
    const inPayload = Object.hasOwn(payload, field);
    if (inCall !== inPayload) return field;
    if (
      inCall
      && canonicalJsonOf(finalizeArguments[field]) !== canonicalJsonOf(payload[field])
    ) return field;
  }
  return null;
}

/**
 * Host-side pre-transport replay authentication for a recovered finalize.
 * Every model-owned argument except `draft` must be present on both sides
 * and deep-canonical-equal to the frozen payload: a mutated coverage row,
 * agency claim, mechanics placement, advisory uptake, an added field, or a
 * dropped field rejects the whole replay. Only the draft's paragraph shape
 * may differ; the canonical finalizer still owns its consequence, excerpt,
 * and mechanics checks. Pure.
 */
export function isDraftShapeRecoveryReplayUnchanged(
  modelOwnedArguments: JsonObject,
  frozenPayload: JsonObject,
): boolean {
  return draftShapeRecoveryPayloadMismatch(
    { frozen_finalize_payload: frozenPayload },
    modelOwnedArguments,
    Object.keys(frozenPayload),
  ) === null;
}

/**
 * Structural validation of the model-owned frozen finalize payload. Exactly
 * the fields the model supplies on a finalize retry; host-bound identity
 * fields are deliberately absent here.
 */
export function isFrozenFinalizePayload(value: unknown): value is JsonObject {
  if (!isPlainObject(value)) return false;
  if (!nonEmptyString(value.draft)) return false;
  if (!Array.isArray(value.coverage) || value.coverage.length === 0) return false;
  for (const row of value.coverage) {
    if (!isPlainObject(row) || !nonEmptyString(row.obligation_id)) return false;
  }
  if (!Array.isArray(value.agency_claims)) return false;
  if (
    value.mechanics_placements !== undefined
    && !Array.isArray(value.mechanics_placements)
  ) return false;
  return true;
}

export function isDraftShapeRecoveryCard(value: unknown): value is JsonObject {
  if (!isPlainObject(value)) return false;
  if (value.schema_version !== 1) return false;
  if (value.contract_id !== DRAFT_SHAPE_RECOVERY_CARD_CONTRACT) return false;
  if (value.kind !== "draft_shape_recovery") return false;
  if (typeof value.campaign_id !== "string" || !value.campaign_id) return false;
  if (typeof value.turn_id !== "string" || !value.turn_id) return false;
  if (typeof value.source_digest !== "string" || !value.source_digest) {
    return false;
  }
  if (!positiveInteger(value.revision)) return false;
  if (typeof value.narration_review_id !== "string") return false;
  if (!value.narration_review_id) return false;
  if (!isPlainObject(value.diagnosis)) return false;
  if (!nonEmptyString(value.payload_sha256)) return false;
  return isFrozenFinalizePayload(value.frozen_finalize_payload);
}

export type DraftShapeRecoveryCardInput = {
  root: string;
  campaign: string;
  facts: {
    turnId: string;
    sourceDigest: string;
    revision: number;
    narrationReviewId: string;
  } | null;
  finalizeArguments: JsonObject | null;
  failureEnvelope: JsonObject;
  /**
   * Model-owned argument whitelist derived from the canonical typed
   * `turn.finalize` schema minus the host-injected identity fields. Every
   * listed field present in the failed call is preserved verbatim; anything
   * outside the list is dropped and never becomes a model relay obligation.
   */
  modelOwnedFields: readonly string[] | null;
};

/**
 * Build the executable recovery card from the exact failed finalize call.
 * Fail-closed: any missing or mismatching identity, empty draft/coverage/
 * agency claims, coverage row without a usable exact_excerpt, or
 * unparseable error message returns null — the host invents nothing.
 */
export function buildDraftShapeRecoveryCard(
  input: DraftShapeRecoveryCardInput,
): JsonObject | null {
  if (!isDraftShapePlacementFailure(input.failureEnvelope)) return null;
  const facts = input.facts;
  if (facts === null) return null;
  if (!facts.turnId || !facts.sourceDigest || !facts.narrationReviewId) {
    return null;
  }
  if (!positiveInteger(facts.revision)) return null;
  if (!input.campaign || !input.root) return null;
  const modelOwnedFields = input.modelOwnedFields ?? [];
  // Without the canonical typed-schema whitelist the host cannot derive the
  // exact model-owned payload: fail closed rather than hand-pick fields.
  if (
    !modelOwnedFields.includes("draft")
    || !modelOwnedFields.includes("coverage")
    || !modelOwnedFields.includes("agency_claims")
  ) return null;
  const error = isPlainObject(input.failureEnvelope.error)
    ? input.failureEnvelope.error
    : null;
  const message = typeof error?.message === "string" ? error.message : "";
  const rollIds = placementFailureRollIds(message);
  if (rollIds.length === 0) return null;
  const args = input.finalizeArguments;
  if (args === null) return null;
  // The frozen call must be the same frozen turn the host retained: a
  // revision or review id that diverges from the retained facts is a stale
  // or mixed invocation and freezes no card.
  if (args.revision !== facts.revision) return null;
  if (args.narration_review_id !== facts.narrationReviewId) return null;
  const draft = typeof args.draft === "string" ? args.draft : "";
  if (!draft.trim()) return null;
  const coverage = Array.isArray(args.coverage) ? args.coverage : null;
  if (coverage === null || coverage.length === 0) return null;
  if (!Array.isArray(args.agency_claims)) return null;
  const paragraphs = canonicalDraftParagraphs(draft);
  const coverageRows: JsonObject[] = [];
  let paragraphZero = false;
  for (const rollId of rollIds) {
    // The coverage obligation id arrives as the model-presented handle
    // (`roll:<handle>`) or, after registry restoration, as the exact
    // canonical id; both name the same frozen obligation.
    const obligationId = `roll:${rollId}`;
    const row = coverage.find((candidate) => (
      isPlainObject(candidate)
      && (candidate.obligation_id === obligationId
        || candidate.obligation_id === rollId)
    ));
    const excerpt = isPlainObject(row) && typeof row.exact_excerpt === "string"
      ? row.exact_excerpt
      : "";
    // A card must direct an exact paragraph repair: an offending roll
    // without a usable coverage excerpt cannot, so no card is frozen.
    if (!excerpt) return null;
    const excerptParagraphIndex = paragraphs.findIndex((paragraph) =>
      paragraph.includes(excerpt));
    if (excerptParagraphIndex === 0) paragraphZero = true;
    coverageRows.push({
      obligation_id: obligationId,
      exact_excerpt: excerpt,
      excerpt_paragraph_index: excerptParagraphIndex,
    });
  }
  // Preserve EVERY model-owned schema field present in the failed call —
  // draft, coverage, agency_claims, mechanics_placements, advisory_uptake,
  // validate_only, and any future optional model-owned validation field —
  // verbatim from the canonical whitelist. Host-bound identities are never
  // copied: the host re-injects them at call time.
  const frozenPayload: JsonObject = {};
  for (const field of modelOwnedFields) {
    if (!Object.hasOwn(args, field)) continue;
    frozenPayload[field] = deepCopyValue(args[field]);
  }
  const payloadDigest = draftShapePayloadDigest(frozenPayload);
  const card: JsonObject = {
    schema_version: 1,
    contract_id: DRAFT_SHAPE_RECOVERY_CARD_CONTRACT,
    kind: "draft_shape_recovery",
    audience: "keeper_only",
    error_code: DRAFT_SHAPE_PLACEMENT_ERROR_CODE,
    next_action: DRAFT_SHAPE_RECOVERY_NEXT_ACTION,
    campaign_id: input.campaign,
    root: input.root,
    turn_id: facts.turnId,
    source_digest: facts.sourceDigest,
    revision: facts.revision,
    narration_review_id: facts.narrationReviewId,
    frozen_finalize_payload: frozenPayload,
    payload_sha256: payloadDigest,
    diagnosis: {
      offending_roll_ids: rollIds,
      coverage_rows: coverageRows,
      draft_paragraph_count: paragraphs.length,
      verdict: paragraphZero
        ? "consequence_paragraph_zero"
        : "consequence_excerpt_missing",
    },
    preserved_bindings: {
      public_rolls: "unchanged",
      state_writes: "unchanged",
      journal: "unchanged",
      narration_review: {
        review_id: facts.narrationReviewId,
        revision: facts.revision,
      },
    },
    finalize_replay: {
      operation: "turn.finalize",
      invoke_via: "coc_turn_finalize",
      replay_arguments_from: "frozen_finalize_payload",
      adjust_arguments: {
        draft: DRAFT_SHAPE_INSTRUCTION,
      },
      host_bound_arguments: [
        "root",
        "campaign",
        "decision_id",
        "revision",
        "narration_review_id",
      ],
    },
    instruction: DRAFT_SHAPE_INSTRUCTION,
    forbidden: [
      "reroll",
      "repeat_state_writes",
      "rerun_state_journal",
      "rerun_narration_review",
      "edit_agency_claims_or_coverage",
      "placeholder_prose",
      "accept_new_player_action_before_finalization",
    ],
  };
  return card;
}

const DRAFT_SHAPE_INSTRUCTION = (
  "Insert one separate action/setup paragraph immediately before the "
  + "consequence paragraph of every listed public roll: the consequence "
  + "excerpt must not sit in paragraph zero, and each exact_excerpt must "
  + "appear verbatim in exactly one non-zero paragraph of the revised "
  + "draft. The host keeps the exact frozen coverage, agency claims, and "
  + "all identities and reattaches them at transport — your recovery call "
  + "carries only the corrected draft. Never substitute placeholder prose, "
  + "never rerun rules/state/journal/review, and never accept a new player "
  + "action before this turn finalizes. Recovery ends only at the real "
  + "finalize result."
);

/** Model-visible semantic instruction (no opaque identifiers inside). */
const DRAFT_SHAPE_RECOVERY_MODEL_INSTRUCTION = (
  "Repair the draft's paragraph shape only: insert one separate action/"
  + "setup paragraph immediately before the consequence paragraph of every "
  + "listed public roll so no consequence excerpt sits in paragraph zero, "
  + "and keep each listed consequence excerpt verbatim in exactly one "
  + "non-zero paragraph. Then resubmit through next_call with the corrected "
  + "draft alone — the host automatically reattaches the frozen coverage, "
  + "agency claims, and every identity; do not add, copy, or echo any other "
  + "argument, identifier, or digest. Never substitute placeholder prose, "
  + "never rerun rules/state/journal/review, and never accept a new player "
  + "action before this turn finalizes. Recovery ends only at the real "
  + "finalize result."
);

/**
 * Full recovery identity: pending-turn identity plus the exact payload
 * seal. Chronological folding keys on this; two different payloads under
 * one pending turn are conflicting identities, never silently deduplicated.
 */
function cardFullIdentity(card: JsonObject): string {
  return JSON.stringify([
    card.turn_id,
    card.source_digest,
    card.revision,
    card.narration_review_id,
    card.payload_sha256,
  ]);
}

function cardPendingTurnIdentity(card: JsonObject): string {
  return JSON.stringify([
    card.turn_id,
    card.source_digest,
    card.revision,
    card.narration_review_id,
  ]);
}

function isRecoverySealRow(value: JsonObject, campaign: string): boolean {
  return value.campaign_id === campaign
    && nonEmptyString(value.turn_id)
    && nonEmptyString(value.source_digest)
    && positiveInteger(value.revision)
    && nonEmptyString(value.narration_review_id)
    && nonEmptyString(value.payload_sha256);
}

function isCompletionTombstoneRow(
  value: JsonObject,
  campaign: string,
): boolean {
  return value.campaign_id === campaign
    && nonEmptyString(value.turn_id)
    && nonEmptyString(value.source_digest)
    && positiveInteger(value.revision)
    && nonEmptyString(value.narration_review_id)
    && nonEmptyString(value.payload_sha256);
}

/**
 * True when the session entries carry durable host-owned accepted-review
 * evidence for this exact recovery identity.
 */
export function hasReviewEvidenceEntry(
  entries: unknown,
  identity: {
    campaign: string;
    turnId: string;
    sourceDigest: string;
    revision: number;
    narrationReviewId: string;
  },
): boolean {
  if (!Array.isArray(entries)) return false;
  for (const entry of entries) {
    const evidence = entryDataOf(entry, NARRATION_REVIEW_EVIDENCE_AUDIT);
    if (evidence === null) continue;
    if (!isReviewEvidenceRow(evidence, identity.campaign)) continue;
    if (
      evidence.turn_id === identity.turnId
      && evidence.source_digest === identity.sourceDigest
      && evidence.revision === identity.revision
      && evidence.review_id === identity.narrationReviewId
    ) return true;
  }
  return false;
}

function entryDataOf(entry: unknown, customType: string): JsonObject | null {
  if (!isPlainObject(entry)) return null;
  if (entry.customType !== customType) return null;
  return isPlainObject(entry.data) ? entry.data : null;
}

function isReviewEvidenceRow(value: JsonObject, campaign: string): boolean {
  return value.campaign_id === campaign
    && nonEmptyString(value.turn_id)
    && nonEmptyString(value.source_digest)
    && positiveInteger(value.revision)
    && nonEmptyString(value.review_id);
}

/**
 * Authenticated recovery-card selection from session entries, folded per
 * full recovery identity.
 *
 * - any card-typed entry for the campaign that is malformed, partial, or
 *   fails structural validation is tamper evidence → null;
 * - every card's payload digest is recomputed and must equal the attached
 *   `payload_sha256`, and a durable machine-internal seal entry must
 *   authenticate the exact payload — structurally valid edits of draft,
 *   coverage, claims, placements, advisory uptake, or any preserved field
 *   fail closed before any hydration or probe;
 * - the card's narration review identity must be authenticated by at least
 *   one host-owned accepted-review evidence row with the exact
 *   campaign/turn/source/revision/review_id — card JSON alone is never
 *   trusted;
 * - an exact tombstone (full identity plus payload seal) retires its own
 *   identity only: a completed historical turn never suppresses a later
 *   unrelated recovery in the same campaign; partial, foreign, stale, or
 *   mismatched tombstones retire nothing;
 * - exactly one unresolved authenticated identity must remain — more than
 *   one is ambiguous → null; identical-identity refreshes dedupe to the
 *   newest entry.
 */
export function selectRecoverableDraftShapeCard(
  entries: unknown,
  campaign: string,
): JsonObject | null {
  if (!Array.isArray(entries) || !campaign) return null;
  // Chronological per-full-identity fold of the append-only stream. Cards
  // and exact tombstones are applied in entry order; seals and review
  // evidence authenticate the selected identity without ordering.
  interface IdentityState {
    newestCard: JsonObject | null;
    retired: boolean;
  }
  const states = new Map<string, IdentityState>();
  const stateFor = (fullIdentity: string): IdentityState => {
    let state = states.get(fullIdentity);
    if (state === undefined) {
      state = { newestCard: null, retired: false };
      states.set(fullIdentity, state);
    }
    return state;
  };
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue;
    if (entry.customType === DRAFT_SHAPE_RECOVERY_CARD_AUDIT) {
      const card = entry.data;
      const entryCampaign = isPlainObject(card) ? card.campaign_id : undefined;
      if (
        typeof entryCampaign === "string"
        && entryCampaign
        && entryCampaign !== campaign
      ) continue; // a clearly foreign campaign's card never blocks this one
      if (
        !isDraftShapeRecoveryCard(card)
        || card.campaign_id !== campaign
      ) {
        // A card-typed entry attributable to this campaign that fails
        // validation is tamper or corruption evidence: fail closed.
        return null;
      }
      const state = stateFor(cardFullIdentity(card));
      if (state.retired) {
        // Chronological reopen: only a card appended after its identity's
        // tombstone is live again.
        state.retired = false;
        state.newestCard = card;
      } else if (state.newestCard !== null) {
        // One pending turn admits exactly one sealed payload: a different
        // payload under the same pending-turn identity is a conflict and
        // fails closed; only a byte-identical refresh updates the record.
        if (
          cardPendingTurnIdentity(card)
            !== cardPendingTurnIdentity(state.newestCard)
        ) return null;
        if (
          canonicalJsonOf(card) !== canonicalJsonOf(state.newestCard)
        ) return null;
        state.newestCard = card;
      } else {
        state.newestCard = card;
      }
      continue;
    }
    if (entry.customType === DRAFT_SHAPE_RECOVERY_COMPLETE_AUDIT) {
      const completion = entryDataOf(entry, DRAFT_SHAPE_RECOVERY_COMPLETE_AUDIT);
      if (completion === null) continue;
      const completionCampaign = completion.campaign_id;
      if (
        typeof completionCampaign === "string"
        && completionCampaign
        && completionCampaign !== campaign
      ) continue; // a foreign campaign's tombstone never blocks this one
      if (!isCompletionTombstoneRow(completion, campaign)) continue;
      // An exact tombstone retires exactly its own full identity, applied
      // in order: cards appended earlier are retired, later cards reopen.
      const tombstoneFullIdentity = JSON.stringify([
        completion.turn_id,
        completion.source_digest,
        completion.revision,
        completion.narration_review_id,
        completion.payload_sha256,
      ]);
      stateFor(tombstoneFullIdentity).retired = true;
    }
  }
  // Seal and evidence indexes authenticate identities without ordering.
  const seals: JsonObject[] = [];
  for (const entry of entries) {
    const seal = entryDataOf(entry, DRAFT_SHAPE_RECOVERY_SEAL_AUDIT);
    if (seal === null) continue;
    const sealCampaign = seal.campaign_id;
    if (
      typeof sealCampaign === "string"
      && sealCampaign
      && sealCampaign !== campaign
    ) continue; // a foreign campaign's seal never blocks this one
    if (!isRecoverySealRow(seal, campaign)) {
      // A malformed seal attributable to this campaign is corruption
      // evidence: fail closed.
      return null;
    }
    seals.push(seal);
  }
  const isSealed = (card: JsonObject): boolean => seals.some((seal) =>
    seal.turn_id === card.turn_id
    && seal.source_digest === card.source_digest
    && seal.revision === card.revision
    && seal.narration_review_id === card.narration_review_id
    && seal.payload_sha256 === card.payload_sha256);
  const isEvidenced = (card: JsonObject): boolean => entries.some((entry) => {
    const evidence = entryDataOf(entry, NARRATION_REVIEW_EVIDENCE_AUDIT);
    if (evidence === null) return false;
    if (!isReviewEvidenceRow(evidence, campaign)) return false;
    return evidence.turn_id === card.turn_id
      && evidence.source_digest === card.source_digest
      && evidence.revision === card.revision
      && evidence.review_id === card.narration_review_id;
  });
  // Exactly one unresolved authenticated identity may remain.
  const unresolved: JsonObject[] = [];
  for (const state of states.values()) {
    if (state.retired || state.newestCard === null) continue;
    const card = state.newestCard;
    if (draftShapePayloadDigest(card.frozen_finalize_payload) !== card.payload_sha256) {
      continue; // payload drift: this identity is unrecoverable
    }
    if (!isSealed(card) || !isEvidenced(card)) continue;
    unresolved.push(card);
  }
  if (unresolved.length !== 1) return null;
  return deepCopyValue(unresolved[0]) as JsonObject;
}

/**
 * Attach the authenticated recovery card onto an `already_acknowledged`
 * `session.resume` result so a fresh play session re-arms the preserved
 * pending turn instead of receiving a bare no-op. The canonical lifecycle
 * fields (schema_version, campaign_id, mode, next_operations) are preserved
 * untouched; only `data.host_recovery_guidance` is added. Pure.
 */
/**
 * Model-visible projection of an armed recovery card. The durable card is a
 * host-only record: every opaque identity (turn/source digests, review and
 * decision ids, payload seals) and the entire frozen non-draft payload stay
 * internal. The model receives only the semantic repair instruction, the
 * frozen draft text, and the human-readable consequence excerpts it must
 * repair around. Pure; returns null for a structurally invalid card.
 */
export function projectDraftShapeRecoveryForModel(
  card: JsonObject,
): JsonObject | null {
  if (!isDraftShapeRecoveryCard(card)) return null;
  const payload = card.frozen_finalize_payload;
  const rows = Array.isArray(card.diagnosis.coverage_rows)
    ? card.diagnosis.coverage_rows
    : [];
  const consequenceExcerpts = rows
    .filter((row) => typeof row.exact_excerpt === "string" && row.exact_excerpt)
    .map((row) => row.exact_excerpt as string);
  return {
    schema_version: 1,
    contract_id: DRAFT_SHAPE_RECOVERY_GUIDANCE_CONTRACT,
    kind: "draft_shape_recovery",
    audience: "keeper_only",
    recovery_kind: card.diagnosis.verdict === "consequence_paragraph_zero"
      ? "consequence_paragraph_zero"
      : "consequence_excerpt_missing",
    next_action: DRAFT_SHAPE_RECOVERY_NEXT_ACTION,
    draft: payload.draft,
    consequence_excerpts: consequenceExcerpts,
    instruction: DRAFT_SHAPE_RECOVERY_MODEL_INSTRUCTION,
    next_call: {
      tool: "coc_invoke",
      operation: "turn.finalize",
      arguments_shape: {
        draft: "仅重发修正段落形状后的完整草稿；其余参数由宿主自动附加",
      },
    },
    forbidden: [
      "reroll",
      "repeat_state_writes",
      "rerun_state_journal",
      "rerun_narration_review",
      "supplying_coverage_or_claims_or_identities",
      "echoing_hash_or_opaque_ids",
      "placeholder_prose",
      "accept_new_player_action_before_finalization",
    ],
  };
}

export function applyAcknowledgedResumeRecoveryGuidance(
  value: unknown,
  card: JsonObject,
  invocation: { root: string; campaign: string },
): {
  attached: boolean;
  envelope: unknown;
  audit: JsonObject | null;
} {
  if (!isPlainObject(value) || value.ok !== true) {
    return { attached: false, envelope: value, audit: null };
  }
  if (value.tool !== "session.resume") {
    return { attached: false, envelope: value, audit: null };
  }
  const data = isPlainObject(value.data) ? value.data : null;
  if (
    data === null
    || data.mode !== "already_acknowledged"
    || data.campaign_id !== invocation.campaign
    || !invocation.campaign
  ) {
    return { attached: false, envelope: value, audit: null };
  }
  if (!isDraftShapeRecoveryCard(card)) {
    return { attached: false, envelope: value, audit: null };
  }
  const projection = projectDraftShapeRecoveryForModel(card);
  if (projection === null) {
    return { attached: false, envelope: value, audit: null };
  }
  const guidance = {
    schema_version: 1,
    contract_id: DRAFT_SHAPE_RECOVERY_CARD_CONTRACT,
    audience: "keeper_only",
    mode: "pending_finalization_recovery",
    status: "journaled_settled_pending_finalization",
    // Semantic model-visible projection only: the durable card, its frozen
    // payload, and every opaque identity stay host-internal. The model
    // repairs draft shape and resubmits the draft; the host reconstructs
    // and injects everything else at transport.
    recovery: projection,
    instruction: (
      "A settled player turn from an earlier session is still preserved and "
      + "unfinalized. Follow recovery: repair only the draft's paragraph "
      + "shape as its instruction and consequence excerpts direct, then call "
      + "turn.finalize via next_call with the corrected draft alone. Every "
      + "other argument and every identity is reconstructed and injected by "
      + "the host — never relay, echo, or invent one. Recovery ends only at "
      + "the real finalize result; never claim completion in prose."
    ),
  };
  return {
    attached: true,
    envelope: {
      ...value,
      data: {
        ...data,
        host_recovery_guidance: guidance,
      },
    },
    audit: {
      schema_version: 1,
      contract_id: DRAFT_SHAPE_RECOVERY_CARD_CONTRACT,
      campaign_id: invocation.campaign,
      mode: "already_acknowledged",
      card_source: "session_entry",
      card_turn_id: card.turn_id,
      card_revision: card.revision,
    },
  };
}
