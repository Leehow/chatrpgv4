"""Closed player-state claim bindings for the Pi narration review boundary."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable


REVIEW_FIELDS = frozenset({"disposition", "reason", "claims"})
CLAIM_FIELDS = frozenset({
    "claim_id", "subject_ref", "claim_kind", "exact_excerpt",
    "source_effect_id", "reason",
})
CLAIM_KINDS = frozenset({
    "cash", "item", "purchase", "assets_liquidate", "scalar",
    "loaded_ammunition", "condition", "time", "time_appearance", "rest",
})
COMPILER_RECEIPT_FIELDS = frozenset({
    "schema_version", "contract_id", "status", "compiler_contract_id",
    "requested_model", "response_model", "semantic_input_digest",
    "semantic_result_digest", "binding", "result", "binding_digest",
})
COMPILER_CONTRACT_ID = "coc.pi-state-claim-compilation-receipt.v1"
COMPILER_MAX_CLAIMS = 64
COMPILER_MAX_REASON_LENGTH = 600


class StateAuthorityError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _draft_paragraphs(draft: str) -> list[str]:
    paragraphs: list[str] = []
    lines: list[str] = []
    for line in draft.split("\n"):
        if line.strip():
            lines.append(line)
        elif lines:
            paragraphs.append("\n".join(lines))
            lines = []
    if lines:
        paragraphs.append("\n".join(lines))
    return paragraphs


def normalize_compiler_receipt(
    raw: Any,
    *,
    draft: str,
    settled: dict[str, Any],
    party_ids: Iterable[str],
    turn_id: str,
    source_digest: str,
    revision: int,
    kp_review: dict[str, Any] | None,
    required: bool,
) -> tuple[dict[str, Any] | None, str]:
    """Validate the independent Pi-host semantic compiler's exact receipt."""
    if raw is None:
        if required:
            raise StateAuthorityError(
                "state_claim_compiler_required",
                "Pi play narration.review requires an independent state-claim compiler receipt",
            )
        return None, "advisory"
    if not isinstance(raw, dict) or set(raw) != COMPILER_RECEIPT_FIELDS:
        raise StateAuthorityError(
            "state_claim_compiler_malformed",
            "state-claim compiler receipt must use the exact closed schema",
        )
    if (
        raw.get("schema_version") != 1
        or raw.get("contract_id") != COMPILER_CONTRACT_ID
        or raw.get("status") != "completed"
        or raw.get("compiler_contract_id") != "coc.pi-state-claim-compiler.v1"
    ):
        raise StateAuthorityError(
            "state_claim_compiler_malformed",
            "state-claim compiler receipt identity or authority scope is invalid",
        )
    for model_field in ("requested_model", "response_model"):
        model = raw.get(model_field)
        if (
            not isinstance(model, dict)
            or set(model) != {"provider", "id", "api"}
            or any(
                not isinstance(model.get(key), str) or not model[key].strip()
                for key in ("provider", "id", "api")
            )
        ):
            raise StateAuthorityError(
                "state_claim_compiler_malformed",
                f"state-claim compiler {model_field} must identify the exact provider/model/api",
            )
    binding = raw.get("binding")
    if not isinstance(binding, dict) or set(binding) != {
        "turn_id", "source_digest", "revision", "draft_sha256",
        "kp_review_digest", "settlement_snapshot_id",
        "mechanics_bundle_sha256",
    }:
        raise StateAuthorityError(
            "state_claim_compiler_malformed",
            "state-claim compiler binding must use the exact closed schema",
        )
    expected_binding = {
        "turn_id": turn_id,
        "source_digest": source_digest,
        "revision": revision,
        "draft_sha256": _canonical_digest(draft),
        "kp_review_digest": _canonical_digest(kp_review),
        "settlement_snapshot_id": settled.get("settlement_snapshot_id"),
        "mechanics_bundle_sha256": settled.get("mechanics_bundle_sha256"),
    }
    if binding != expected_binding:
        raise StateAuthorityError(
            "state_claim_compiler_stale",
            "state-claim compiler receipt does not bind the current turn/source/revision/draft/review/settlement",
        )
    digest_payload = dict(raw)
    binding_digest = digest_payload.pop("binding_digest", None)
    if not isinstance(binding_digest, str) or binding_digest != _canonical_digest(
        digest_payload
    ):
        raise StateAuthorityError(
            "state_claim_compiler_malformed",
            "state-claim compiler receipt digest is invalid",
        )
    pc_subject_refs = sorted(f"pc:{value}" for value in party_ids)
    kp_claims = (kp_review or {}).get("claims") or []
    candidates = sorted(
        [
            {
                "claim_id": claim["claim_id"],
                "subject_ref": claim["subject_ref"],
                "claim_kind": claim["claim_kind"],
                "exact_excerpt": claim["exact_excerpt"],
            }
            for claim in kp_claims
        ],
        key=lambda value: json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ),
    )
    paragraphs = [
        {"paragraph_index": index, "paragraph_sha256": _canonical_digest(text)}
        for index, text in enumerate(_draft_paragraphs(draft))
    ]
    semantic_input = {
        "schema_version": 1,
        "contract_id": "coc.pi-state-claim-compiler-input.v1",
        "draft_text": draft,
        "pc_subject_refs": pc_subject_refs,
        "candidate_claims": candidates,
        "paragraphs": paragraphs,
    }
    if raw.get("semantic_input_digest") != _canonical_digest(semantic_input):
        raise StateAuthorityError(
            "state_claim_compiler_stale",
            "state-claim compiler semantic input digest is stale",
        )
    result = raw.get("result")
    if not isinstance(result, dict) or set(result) != {
        "schema_version", "contract_id", "disposition", "reason", "claims",
        "paragraph_coverage",
    } or raw.get("semantic_result_digest") != _canonical_digest(result):
        raise StateAuthorityError(
            "state_claim_compiler_malformed",
            "state-claim compiler result or digest is invalid",
        )
    claims = result.get("claims")
    if (
        result.get("schema_version") != 1
        or result.get("contract_id") != "coc.pi-state-claim-compiler-result.v1"
        or not isinstance(result.get("reason"), str)
        or not result["reason"].strip()
        or len(result["reason"]) > COMPILER_MAX_REASON_LENGTH
        or not isinstance(claims, list)
        or len(claims) > COMPILER_MAX_CLAIMS
        or result.get("disposition")
        != ("claims_detected" if claims else "no_claims_detected")
    ):
        raise StateAuthorityError(
            "state_claim_compiler_malformed",
            "state-claim compiler result shape is invalid",
        )
    kp_by_id = {claim["claim_id"]: claim for claim in kp_claims}
    matched_ids: set[str] = set()
    compiler_claim_ids: set[str] = set()
    compiler_identities: set[tuple[str, str, str, str | None]] = set()
    compiled_claims: list[dict[str, Any]] = []
    gate = "clear"
    for index, claim in enumerate(claims):
        if not isinstance(claim, dict) or set(claim) != {
            "compiler_claim_id", "subject_ref", "claim_kind",
            "exact_excerpt", "matched_review_claim_id", "reason",
        }:
            raise StateAuthorityError(
                "state_claim_compiler_malformed",
                f"state-claim compiler result claims[{index}] is malformed",
            )
        subject_ref = str(claim.get("subject_ref") or "")
        claim_kind = str(claim.get("claim_kind") or "")
        excerpt = str(claim.get("exact_excerpt") or "")
        matched_id = claim.get("matched_review_claim_id")
        reason = str(claim.get("reason") or "")
        if matched_id is not None and not isinstance(matched_id, str):
            raise StateAuthorityError(
                "state_claim_compiler_malformed",
                f"state-claim compiler result claims[{index}] match is invalid",
            )
        identity = (subject_ref, claim_kind, excerpt, matched_id)
        expected_id = "compiled:" + _canonical_digest(
            list(identity)
        )[7:47]
        if (
            claim.get("compiler_claim_id") != expected_id
            or expected_id in compiler_claim_ids
            or identity in compiler_identities
            or subject_ref not in pc_subject_refs
            or claim_kind not in CLAIM_KINDS
            or not excerpt.strip()
            or excerpt not in draft
            or not reason.strip()
            or len(reason) > COMPILER_MAX_REASON_LENGTH
        ):
            raise StateAuthorityError(
                "state_claim_compiler_malformed",
                f"state-claim compiler result claims[{index}] is invalid",
            )
        compiler_claim_ids.add(expected_id)
        compiler_identities.add(identity)
        matched = kp_by_id.get(matched_id) if isinstance(matched_id, str) else None
        if (
            matched is None
            or matched["subject_ref"] != subject_ref
            or matched["claim_kind"] != claim_kind
            or matched.get("source_effect_id") is None
        ):
            gate = "rewrite_required"
        else:
            if matched_id in matched_ids:
                raise StateAuthorityError(
                    "state_claim_compiler_malformed",
                    "state-claim compiler matched one KP claim more than once",
                )
            matched_ids.add(matched_id)
        compiled_claims.append(dict(claim))
    if matched_ids != set(kp_by_id):
        gate = "rewrite_required"

    coverage = result.get("paragraph_coverage")
    draft_parts = _draft_paragraphs(draft)
    if not isinstance(coverage, list) or len(coverage) != len(draft_parts):
        raise StateAuthorityError(
            "state_claim_compiler_malformed",
            "state-claim compiler paragraph coverage is incomplete",
        )
    covered: set[int] = set()
    for index, row in enumerate(coverage):
        if not isinstance(row, dict) or set(row) != {
            "paragraph_index", "paragraph_sha256", "claim_indices"
        } or row.get("paragraph_index") != index or row.get(
            "paragraph_sha256"
        ) != _canonical_digest(draft_parts[index]) or not isinstance(
            row.get("claim_indices"), list
        ):
            raise StateAuthorityError(
                "state_claim_compiler_malformed",
                "state-claim compiler paragraph coverage is invalid",
            )
        for claim_index in row["claim_indices"]:
            if (
                isinstance(claim_index, bool)
                or not isinstance(claim_index, int)
                or claim_index < 0
                or claim_index >= len(compiled_claims)
                or claim_index in covered
                or compiled_claims[claim_index]["exact_excerpt"]
                not in draft_parts[index]
            ):
                raise StateAuthorityError(
                    "state_claim_compiler_malformed",
                    "state-claim compiler paragraph claim coverage is invalid",
                )
            covered.add(claim_index)
    if covered != set(range(len(compiled_claims))):
        raise StateAuthorityError(
            "state_claim_compiler_malformed",
            "state-claim compiler claim coverage is incomplete",
        )
    normalized = dict(raw)
    normalized["result"] = {**result, "claims": compiled_claims}
    return normalized, gate


def normalize_review(
    raw: Any,
    *,
    draft: str,
    settled: dict[str, Any],
    party_ids: Iterable[str],
    required: bool,
) -> tuple[dict[str, Any] | None, str]:
    """Validate KP semantic claims against the exact frozen mechanics bundle."""
    if raw is None:
        if required:
            raise StateAuthorityError(
                "invalid_param",
                "Pi play narration.review requires state_authority_review",
            )
        return None, "advisory"
    if not isinstance(raw, dict) or set(raw) != REVIEW_FIELDS:
        raise StateAuthorityError(
            "invalid_param",
            "state_authority_review must use the exact closed schema",
        )
    disposition = str(raw.get("disposition") or "").strip()
    reason = str(raw.get("reason") or "").strip()
    claims = raw.get("claims")
    if disposition not in {"no_player_state_change_claimed", "claims_listed"}:
        raise StateAuthorityError(
            "invalid_param", "state_authority_review disposition is invalid"
        )
    if not reason or not isinstance(claims, list):
        raise StateAuthorityError(
            "invalid_param",
            "state_authority_review requires a semantic reason and claims array",
        )
    if (
        disposition == "no_player_state_change_claimed" and claims
    ) or (
        disposition == "claims_listed" and not claims
    ):
        raise StateAuthorityError(
            "state_authority_disposition_mismatch",
            "state_authority_review disposition does not match its claims",
        )

    bundle = settled.get("mechanics_bundle")
    bundle = bundle if isinstance(bundle, dict) else {}
    effects: dict[str, list[dict[str, Any]]] = {}
    for bucket in ("state_delta", "asset_delta"):
        for effect in bundle.get(bucket) or []:
            if not isinstance(effect, dict):
                continue
            effect_id = str(effect.get("effect_id") or "").strip()
            if effect_id:
                effects.setdefault(effect_id, []).append(effect)
    pc_subject_refs = {f"pc:{value}" for value in party_ids}
    seen_claim_ids: set[str] = set()
    seen_effect_ids: set[str] = set()
    normalized_claims: list[dict[str, Any]] = []
    unbound = False
    for index, raw_claim in enumerate(claims):
        if not isinstance(raw_claim, dict) or set(raw_claim) != CLAIM_FIELDS:
            raise StateAuthorityError(
                "invalid_param",
                f"state_authority_review.claims[{index}] must use the exact closed schema",
            )
        claim_id = str(raw_claim.get("claim_id") or "").strip()
        subject_ref = str(raw_claim.get("subject_ref") or "").strip()
        claim_kind = str(raw_claim.get("claim_kind") or "").strip()
        exact_excerpt = str(raw_claim.get("exact_excerpt") or "")
        claim_reason = str(raw_claim.get("reason") or "").strip()
        source_value = raw_claim.get("source_effect_id")
        if not claim_id or claim_id in seen_claim_ids:
            raise StateAuthorityError(
                "state_authority_claim_duplicate",
                f"state_authority_review claim_id {claim_id!r} is empty or duplicated",
            )
        if subject_ref not in pc_subject_refs:
            raise StateAuthorityError(
                "state_authority_subject_mismatch",
                f"state_authority_review claim {claim_id!r} must name a current PC",
            )
        if claim_kind not in CLAIM_KINDS:
            raise StateAuthorityError(
                "invalid_param",
                f"state_authority_review claim {claim_id!r} has an invalid claim_kind",
            )
        if not exact_excerpt.strip() or exact_excerpt not in draft:
            raise StateAuthorityError(
                "state_authority_excerpt_mismatch",
                f"state_authority_review claim {claim_id!r} excerpt is not in the exact draft",
            )
        if not claim_reason:
            raise StateAuthorityError(
                "invalid_param",
                f"state_authority_review claim {claim_id!r} requires a semantic reason",
            )
        source_effect_id: str | None
        if source_value is None:
            source_effect_id = None
            unbound = True
        else:
            source_effect_id = str(source_value).strip()
            matches = effects.get(source_effect_id) if source_effect_id else None
            if not matches:
                raise StateAuthorityError(
                    "state_authority_source_unknown",
                    f"state_authority_review claim {claim_id!r} names no current frozen effect",
                )
            if len(matches) != 1 or source_effect_id in seen_effect_ids:
                raise StateAuthorityError(
                    "state_authority_claim_duplicate",
                    f"state_authority_review source effect {source_effect_id!r} is ambiguous or duplicated",
                )
            effect = matches[0]
            if str(effect.get("effect_kind") or "") != claim_kind:
                raise StateAuthorityError(
                    "state_authority_kind_mismatch",
                    f"state_authority_review claim {claim_id!r} does not match its effect kind",
                )
            effect_investigator = str(effect.get("investigator_id") or "").strip()
            if effect_investigator and subject_ref != f"pc:{effect_investigator}":
                raise StateAuthorityError(
                    "state_authority_subject_mismatch",
                    f"state_authority_review claim {claim_id!r} does not match its effect investigator",
                )
            seen_effect_ids.add(source_effect_id)
        seen_claim_ids.add(claim_id)
        normalized_claims.append({
            "claim_id": claim_id,
            "subject_ref": subject_ref,
            "claim_kind": claim_kind,
            "exact_excerpt": exact_excerpt,
            "source_effect_id": source_effect_id,
            "reason": claim_reason,
        })
    normalized = {
        "disposition": disposition,
        "reason": reason,
        "claims": normalized_claims,
    }
    if not required:
        return normalized, "advisory"
    return normalized, "rewrite_required" if unbound else "clear"
