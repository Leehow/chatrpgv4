#!/usr/bin/env python3
"""Canonical, source-owned NPC first-impression receipts.

One investigator/NPC pair owns exactly one receipt for the campaign lifetime.
Schema-v2 receipts freeze one public D100 check against max(APP, Credit Rating)
and leave the context-sensitive realization to the Keeper.  Schema-v1 receipts
remain readable so an in-progress campaign is never forced to reroll an old
concealed/override first impression.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any


DOCUMENT_SCHEMA_VERSION = 1
LEGACY_RECEIPT_SCHEMA_VERSION = 1
RECEIPT_SCHEMA_VERSION = 2
FILENAME = "npc-first-impressions.json"
LEGACY_SETTLEMENT_MODES = frozenset({
    "concealed_roll", "authored_override", "relationship_override",
})
GOVERNING_ATTRIBUTES = frozenset({"app", "credit_rating"})
ACHIEVED_LEVELS = frozenset({
    "critical", "extreme", "hard", "regular", "failure", "fumble",
})
REACTION_TIERS = {
    "critical": "breakthrough",
    "extreme": "strongly_favorable",
    "hard": "favorable",
    "regular": "open",
    "failure": "guarded",
    "fumble": "actively_adverse",
}
DISPOSITIONS = {
    "critical": "helpful",
    "extreme": "helpful",
    "hard": "helpful",
    "regular": "neutral",
    "failure": "neutral",
    "fumble": "hostile",
}
CONTEXT_FIELDS = frozenset({
    "player_conduct", "scene_constraints",
    "authored_or_relationship_boundary", "semantic_reason",
})
REALIZATION_FIELDS = frozenset({
    "observable_manner", "causal_explanation", "boundary_preserved",
    "opportunity_or_friction",
})
V2_RECEIPT_FIELDS = frozenset({
    "schema_version", "receipt_id", "campaign_id", "run_id", "decision_id",
    "investigator_id", "npc_id", "npc_display_name", "app", "credit_rating",
    "governing_attribute", "governing_value", "roll_id", "roll_record",
    "required_level", "achieved_level", "outcome", "passed",
    "surplus_levels", "reaction_tier", "disposition", "context", "rule_ref",
    "integrity_digest",
})
V1_RECEIPT_FIELDS = frozenset({
    "schema_version", "receipt_id", "campaign_id", "run_id",
    "decision_id", "investigator_id", "npc_id", "app",
    "credit_rating", "governing_attribute", "governing_value",
    "settlement_mode", "override_type", "concealed_roll",
    "disposition", "observable_manner", "rule_ref", "integrity_digest",
})


def canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def document_path(campaign_dir: Path) -> Path:
    return Path(campaign_dir) / "save" / FILENAME


def pair_key(investigator_id: str, npc_id: str) -> str:
    # Keep the v1 pair identity so legacy and v2 receipts share one uniqueness
    # domain and can never roll the same pair twice after an upgrade.
    return canonical_digest(["npc-first-impression-pair-v1", investigator_id, npc_id])


def receipt_id(campaign_id: str, investigator_id: str, npc_id: str) -> str:
    """Legacy deterministic receipt id (retained for schema-v1 validation)."""
    digest = canonical_digest([
        "npc-first-impression-v1", campaign_id, investigator_id, npc_id,
    ]).split(":", 1)[1]
    return f"npc-first-impression-v1:{digest[:40]}"


def current_receipt_id(campaign_id: str, investigator_id: str, npc_id: str) -> str:
    digest = canonical_digest([
        "npc-first-impression-v2", campaign_id, investigator_id, npc_id,
    ]).split(":", 1)[1]
    return f"npc-first-impression-v2:{digest[:40]}"


def current_roll_id(campaign_id: str, investigator_id: str, npc_id: str) -> str:
    digest = canonical_digest([
        "npc-first-impression-roll-v2", campaign_id, investigator_id, npc_id,
    ]).split(":", 1)[1]
    return f"npc-first-impression-roll-v2:{digest[:40]}"


def empty_document(campaign_id: str) -> dict[str, Any]:
    return {
        "schema_version": DOCUMENT_SCHEMA_VERSION,
        "campaign_id": str(campaign_id),
        "receipts": {},
    }


def _valid_identity_and_stats(receipt: dict[str, Any]) -> bool:
    for key in (
        "receipt_id", "campaign_id", "run_id", "decision_id",
        "investigator_id", "npc_id", "rule_ref",
    ):
        value = receipt.get(key)
        if not isinstance(value, str) or not value or value != value.strip():
            return False
    if receipt.get("schema_version") == RECEIPT_SCHEMA_VERSION:
        display_name = receipt.get("npc_display_name")
        if (
            not isinstance(display_name, str)
            or not display_name.strip()
            or display_name != display_name.strip()
            or display_name == receipt.get("npc_id")
        ):
            return False
    if receipt.get("governing_attribute") not in GOVERNING_ATTRIBUTES:
        return False
    for key in ("app", "credit_rating", "governing_value"):
        value = receipt.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
            return False
    governing = receipt[receipt["governing_attribute"]]
    return bool(
        receipt.get("governing_value") == governing
        and receipt.get("governing_value") == max(receipt["app"], receipt["credit_rating"])
    )


def _valid_v1_receipt(receipt: dict[str, Any]) -> bool:
    if set(receipt) != V1_RECEIPT_FIELDS or receipt.get("schema_version") != 1:
        return False
    if not _valid_identity_and_stats(receipt):
        return False
    if receipt.get("settlement_mode") not in LEGACY_SETTLEMENT_MODES:
        return False
    for key in ("disposition", "observable_manner"):
        if not isinstance(receipt.get(key), str) or not receipt[key].strip():
            return False
    concealed = receipt.get("concealed_roll")
    if receipt["settlement_mode"] == "concealed_roll":
        if isinstance(concealed, bool) or not isinstance(concealed, int) or not 1 <= concealed <= 100:
            return False
        if receipt.get("override_type") is not None:
            return False
    elif concealed is not None or not isinstance(receipt.get("override_type"), str):
        return False
    if receipt.get("receipt_id") != receipt_id(
        receipt["campaign_id"], receipt["investigator_id"], receipt["npc_id"]
    ):
        return False
    body = {key: deepcopy(value) for key, value in receipt.items() if key != "integrity_digest"}
    return receipt.get("integrity_digest") == canonical_digest(body)


def _valid_context(value: Any) -> bool:
    return bool(
        isinstance(value, dict)
        and set(value) == CONTEXT_FIELDS
        and all(
            isinstance(value.get(key), str)
            and bool(value[key].strip())
            and value[key] == value[key].strip()
            for key in CONTEXT_FIELDS
        )
    )


def valid_realization(value: Any) -> bool:
    return bool(
        isinstance(value, dict)
        and set(value) == REALIZATION_FIELDS
        and all(
            isinstance(value.get(key), str)
            and bool(value[key].strip())
            and value[key] == value[key].strip()
            for key in REALIZATION_FIELDS
        )
    )


def _valid_v2_roll(receipt: dict[str, Any]) -> bool:
    record = receipt.get("roll_record")
    payload = record.get("payload") if isinstance(record, dict) else None
    if not isinstance(record, dict) or not isinstance(payload, dict):
        return False
    expected = {
        "roll_id": receipt["roll_id"],
        "investigator_id": receipt["investigator_id"],
        "npc_id": receipt["npc_id"],
        "npc_display_name": receipt["npc_display_name"],
        "app": receipt["app"],
        "credit_rating": receipt["credit_rating"],
        "governing_attribute": receipt["governing_attribute"],
        "governing_value": receipt["governing_value"],
        "roll": record.get("roll"),
        "base_target": receipt["governing_value"],
        "target": receipt["governing_value"],
        "required_level": "regular",
        "achieved_level": receipt["achieved_level"],
        "passed": receipt["passed"],
        "success": receipt["passed"],
        "surplus_levels": receipt["surplus_levels"],
        "outcome": receipt["outcome"],
        "reaction_tier": receipt["reaction_tier"],
    }
    return bool(
        record.get("roll_id") == receipt["roll_id"]
        and record.get("event_type") == "roll"
        and record.get("type") == "roll"
        and record.get("kind") == "npc_first_impression"
        and record.get("skill") == "First Impression"
        and record.get("display_skill") == "初印象"
        and record.get("actor") == receipt["investigator_id"]
        and record.get("visibility") == "public"
        and record.get("source") == "keeper_toolbox"
        and isinstance(record.get("ts"), str)
        and bool(record["ts"])
        and isinstance(record.get("roll"), int)
        and not isinstance(record.get("roll"), bool)
        and 1 <= record["roll"] <= 100
        and all(record.get(key) == value for key, value in expected.items())
        and all(payload.get(key) == value for key, value in expected.items())
        and payload.get("required_target") == record.get("required_target")
        and payload.get("effective_target") == record.get("effective_target")
        and payload.get("difficulty") == "regular"
    )


def _valid_v2_receipt(receipt: dict[str, Any]) -> bool:
    if set(receipt) != V2_RECEIPT_FIELDS or receipt.get("schema_version") != 2:
        return False
    if not _valid_identity_and_stats(receipt) or not _valid_context(receipt.get("context")):
        return False
    if receipt.get("receipt_id") != current_receipt_id(
        receipt["campaign_id"], receipt["investigator_id"], receipt["npc_id"]
    ) or receipt.get("roll_id") != current_roll_id(
        receipt["campaign_id"], receipt["investigator_id"], receipt["npc_id"]
    ):
        return False
    achieved = receipt.get("achieved_level")
    if (
        receipt.get("required_level") != "regular"
        or achieved not in ACHIEVED_LEVELS
        or receipt.get("reaction_tier") != REACTION_TIERS.get(achieved)
        or receipt.get("disposition") != DISPOSITIONS.get(achieved)
        or not isinstance(receipt.get("passed"), bool)
        or receipt["passed"] != (achieved not in {"failure", "fumble"})
        or isinstance(receipt.get("surplus_levels"), bool)
        or not isinstance(receipt.get("surplus_levels"), int)
        or receipt["surplus_levels"] < 0
        or receipt.get("outcome") != (
            achieved if receipt["passed"] else achieved
        )
        or not _valid_v2_roll(receipt)
    ):
        return False
    body = {key: deepcopy(value) for key, value in receipt.items() if key != "integrity_digest"}
    return receipt.get("integrity_digest") == canonical_digest(body)


def valid_receipt(receipt: Any) -> bool:
    if not isinstance(receipt, dict):
        return False
    if receipt.get("schema_version") == LEGACY_RECEIPT_SCHEMA_VERSION:
        return _valid_v1_receipt(receipt)
    if receipt.get("schema_version") == RECEIPT_SCHEMA_VERSION:
        return _valid_v2_receipt(receipt)
    return False


def load_document(campaign_dir: Path, campaign_id: str) -> dict[str, Any]:
    path = document_path(campaign_dir)
    if not path.is_file():
        return empty_document(campaign_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("NPC first-impression receipt source is unreadable") from exc
    if (
        not isinstance(payload, dict)
        or set(payload) != {"schema_version", "campaign_id", "receipts"}
        or payload.get("schema_version") != DOCUMENT_SCHEMA_VERSION
        or payload.get("campaign_id") != str(campaign_id)
        or not isinstance(payload.get("receipts"), dict)
    ):
        raise ValueError("NPC first-impression source has an invalid current contract")
    for key, receipt in payload["receipts"].items():
        if not valid_receipt(receipt) or key != pair_key(
            receipt["investigator_id"], receipt["npc_id"]
        ):
            raise ValueError("NPC first-impression receipt failed integrity validation")
    return payload


def find_by_pair(
    document: dict[str, Any], investigator_id: str, npc_id: str
) -> dict[str, Any] | None:
    receipt = (document.get("receipts") or {}).get(pair_key(investigator_id, npc_id))
    if receipt is None:
        return None
    if not valid_receipt(receipt):
        raise ValueError("NPC first-impression receipt is invalid")
    return deepcopy(receipt)


def find_by_ref(document: dict[str, Any], ref: str) -> dict[str, Any] | None:
    matches = [
        receipt for receipt in (document.get("receipts") or {}).values()
        if isinstance(receipt, dict) and receipt.get("receipt_id") == ref
    ]
    if len(matches) > 1:
        raise ValueError("NPC first-impression ref is duplicated")
    if not matches:
        return None
    if not valid_receipt(matches[0]):
        raise ValueError("NPC first-impression ref is invalid")
    return deepcopy(matches[0])


def find_by_decision(document: dict[str, Any], decision_id: str) -> dict[str, Any] | None:
    matches = [
        receipt for receipt in (document.get("receipts") or {}).values()
        if isinstance(receipt, dict) and receipt.get("decision_id") == decision_id
    ]
    if len(matches) > 1:
        raise ValueError("NPC first-impression decision is duplicated")
    if matches and not valid_receipt(matches[0]):
        raise ValueError("NPC first-impression decision receipt is invalid")
    return deepcopy(matches[0]) if matches else None


def new_receipt(
    *,
    campaign_id: str,
    run_id: str,
    decision_id: str,
    investigator_id: str,
    npc_id: str,
    npc_display_name: str,
    app: int,
    credit_rating: int,
    roll_record: dict[str, Any],
    achieved_level: str,
    outcome: str,
    passed: bool,
    surplus_levels: int,
    context: dict[str, str],
) -> dict[str, Any]:
    governing_attribute = "credit_rating" if credit_rating > app else "app"
    receipt = {
        "schema_version": RECEIPT_SCHEMA_VERSION,
        "receipt_id": current_receipt_id(campaign_id, investigator_id, npc_id),
        "campaign_id": str(campaign_id),
        "run_id": str(run_id),
        "decision_id": str(decision_id),
        "investigator_id": str(investigator_id),
        "npc_id": str(npc_id),
        "npc_display_name": str(npc_display_name),
        "app": int(app),
        "credit_rating": int(credit_rating),
        "governing_attribute": governing_attribute,
        "governing_value": int(max(app, credit_rating)),
        "roll_id": current_roll_id(campaign_id, investigator_id, npc_id),
        "roll_record": deepcopy(roll_record),
        "required_level": "regular",
        "achieved_level": str(achieved_level),
        "outcome": str(outcome),
        "passed": bool(passed),
        "surplus_levels": int(surplus_levels),
        "reaction_tier": REACTION_TIERS.get(str(achieved_level)),
        "disposition": DISPOSITIONS.get(str(achieved_level)),
        "context": deepcopy(context),
        "rule_ref": "keeper-rulebook p.191; percentile levels",
        "integrity_digest": "",
    }
    receipt["integrity_digest"] = canonical_digest({
        key: deepcopy(value)
        for key, value in receipt.items()
        if key != "integrity_digest"
    })
    if not valid_receipt(receipt):
        raise ValueError("cannot create invalid NPC first-impression receipt")
    return receipt


def put_receipt(document: dict[str, Any], receipt: dict[str, Any]) -> bool:
    if not valid_receipt(receipt):
        raise ValueError("cannot store invalid NPC first-impression receipt")
    key = pair_key(receipt["investigator_id"], receipt["npc_id"])
    prior = document["receipts"].get(key)
    if prior is not None:
        if prior != receipt:
            raise ValueError("investigator/NPC pair already owns a different first impression")
        return False
    document["receipts"][key] = deepcopy(receipt)
    return True


def player_context_effect(
    receipt: dict[str, Any], realization: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not valid_receipt(receipt):
        raise ValueError("cannot project invalid NPC first-impression receipt")
    if receipt["schema_version"] == LEGACY_RECEIPT_SCHEMA_VERSION:
        context_basis = {
            "concealed_roll": "自然形成",
            "relationship_override": "既有关系",
            "authored_override": "既定立场",
        }[receipt["settlement_mode"]]
        return {
            "schema_version": 1,
            "category": "context_effect",
            "effect_id": f"context:{receipt['receipt_id']}",
            "source_receipt_id": receipt["receipt_id"],
            "effect_kind": "npc_first_impression",
            "contract_version": "legacy-v1",
            "investigator_id": receipt["investigator_id"],
            "npc_id": receipt["npc_id"],
            "app": receipt["app"],
            "credit_rating": receipt["credit_rating"],
            "governing_attribute": receipt["governing_attribute"],
            "governing_value": receipt["governing_value"],
            "context_basis": context_basis,
            "observable_manner": receipt["observable_manner"],
        }
    if not valid_realization(realization):
        raise ValueError("schema-v2 first impression requires an exact causal realization")
    return {
        "schema_version": 2,
        "category": "context_effect",
        "effect_id": f"context:{receipt['receipt_id']}",
        "source_receipt_id": receipt["receipt_id"],
        "source_roll_id": receipt["roll_id"],
        "effect_kind": "npc_first_impression",
        "contract_version": "public-roll-v2",
        "investigator_id": receipt["investigator_id"],
        "npc_id": receipt["npc_id"],
        "npc_display_name": receipt["npc_display_name"],
        "reaction_tier": receipt["reaction_tier"],
        "achieved_level": receipt["achieved_level"],
        "observable_manner": realization["observable_manner"],
        "causal_explanation": realization["causal_explanation"],
        "boundary_preserved": realization["boundary_preserved"],
        "opportunity_or_friction": realization["opportunity_or_friction"],
    }
