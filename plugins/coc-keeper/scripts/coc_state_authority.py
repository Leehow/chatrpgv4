"""Closed player-state claim bindings for the Pi narration review boundary."""
from __future__ import annotations

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


class StateAuthorityError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


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
