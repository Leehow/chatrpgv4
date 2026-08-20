#!/usr/bin/env python3
"""Canonical non-turn operations shared by plugin hosts and the Pi runtime.

Normal player input still enters through ``coc_live_turn_runner.run_live_turn``.
This module owns typed operations that are not ordinary player prose so Codex,
Cursor, Claude Code, and ``runtime.sdk`` cannot grow host-specific behavior.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import random
import re
import secrets
import shutil
import tempfile
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
SCHEMA_VERSION = 1
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_chapter_switch = _load_sibling("coc_chapter_switch_runtime_ops", "coc_chapter_switch.py")
coc_api = _load_sibling("coc_api_runtime_ops", "coc_api.py")
coc_character = _load_sibling("coc_character_runtime_ops", "coc_character.py")
coc_character_card = _load_sibling(
    "coc_character_card_runtime_ops", "coc_character_card.py"
)
coc_character_creation_briefing = _load_sibling(
    "coc_character_creation_briefing_runtime_ops",
    "coc_character_creation_briefing.py",
)
coc_development = _load_sibling("coc_development_runtime_ops", "coc_development.py")
coc_fileio = _load_sibling("coc_fileio_runtime_ops", "coc_fileio.py")
coc_investigator_guard = _load_sibling(
    "coc_investigator_guard_runtime_ops", "coc_investigator_guard.py"
)
coc_hazards = _load_sibling("coc_hazards_runtime_ops", "coc_hazards.py")
coc_magic = _load_sibling("coc_magic_runtime_ops", "coc_magic.py")
coc_mythos = _load_sibling("coc_mythos_runtime_ops", "coc_mythos.py")
coc_module_assets = _load_sibling(
    "coc_module_assets_runtime_ops", "coc_module_assets.py"
)
coc_module_project = _load_sibling(
    "coc_module_project_runtime_ops", "coc_module_project.py"
)
coc_pdf_bundle = _load_sibling("coc_pdf_bundle_runtime_ops", "coc_pdf_bundle.py")
coc_roll = _load_sibling("coc_roll_runtime_ops", "coc_roll.py")
coc_rules = _load_sibling("coc_rules_runtime_ops", "coc_rules.py")
coc_sanity = _load_sibling("coc_sanity_runtime_ops", "coc_sanity.py")
coc_scenario = _load_sibling("coc_scenario_runtime_ops", "coc_scenario.py")
coc_scenario_hydration = _load_sibling(
    "coc_scenario_hydration_runtime_ops", "coc_scenario_hydration.py"
)
coc_starter = _load_sibling("coc_starter_runtime_ops", "coc_starter.py")
coc_state = _load_sibling("coc_state_runtime_ops", "coc_state.py")
coc_tomes = _load_sibling("coc_tomes_runtime_ops", "coc_tomes.py")
coc_turn_finalization = _load_sibling(
    "coc_turn_finalization_runtime_ops", "coc_turn_finalization.py"
)


SESSION_OPERATION_KINDS = frozenset({
    "scenario.ensure", "scenario.repair", "magic.cast", "magic.learn",
    "chapter.switch", "tome.read", "hazard.apply", "hazard.suffocation.start",
    "hazard.suffocation.tick", "hazard.suffocation.end", "hazard.poison",
    "development.settle",
})
SETUP_OPERATION_KINDS = frozenset({
    "onboarding.inspect", "rules.inspect", "campaign.create",
    "campaign.quick_start", "scenario.bind_pdf", "campaign.render_briefing",
    "actor.create", "investigator.create", "investigator.render_card",
    "investigator.contract", "campaign.link_investigator",
    "campaign.adopt_source_facts", "campaign.complete",
    "setup.chargen_run",
})


class RuntimeOperationError(ValueError):
    """Stable validation failure for the shared operation protocol."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


def validate_semantic_route(value: Any) -> dict[str, Any]:
    """Validate an LLM/host semantic route without inspecting player prose."""
    if not isinstance(value, dict) or set(value) != {
        "schema_version", "route", "reason", "operation"
    }:
        raise RuntimeOperationError(
            "semantic route must contain schema_version, route, reason, operation"
        )
    if value.get("schema_version") != 1:
        raise RuntimeOperationError("semantic route schema_version must be 1")
    if value.get("route") not in {"ordinary_turn", "operation"}:
        raise RuntimeOperationError("semantic route must be ordinary_turn or operation")
    reason = value.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise RuntimeOperationError("semantic route requires a non-empty reason")
    operation = value.get("operation")
    if value["route"] == "ordinary_turn":
        if operation is not None:
            raise RuntimeOperationError("ordinary_turn route operation must be null")
    else:
        _operation(operation)
    return json.loads(json.dumps(value, ensure_ascii=False))


def record_semantic_route(
    campaign_dir: Path | str,
    semantic_route: dict[str, Any],
    *,
    player_text: str,
    provenance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist semantic routing evidence without retaining raw player prose."""
    route = validate_semantic_route(semantic_route)
    if not isinstance(player_text, str) or not player_text:
        raise RuntimeOperationError("semantic route player_text must be non-empty")
    encoded = player_text.encode("utf-8")
    import hashlib
    receipt = {
        "schema_version": 1,
        "event_type": "runtime_operation_route",
        "route": route["route"],
        "reason": route["reason"],
        "operation_kind": (
            route["operation"].get("kind")
            if isinstance(route.get("operation"), dict) else None
        ),
        "player_text_sha256": hashlib.sha256(encoded).hexdigest(),
        "provenance": json.loads(json.dumps(provenance or {}, ensure_ascii=False)),
        "recorded_at": _now(),
    }
    _append_jsonl(Path(campaign_dir) / "logs" / "operation-routes.jsonl", receipt)
    return receipt


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _id(value: Any, label: str) -> str:
    text = str(value or "")
    if not _SAFE_ID.fullmatch(text):
        raise RuntimeOperationError(
            f"{label} must be a stable safe id matching "
            f"^[A-Za-z0-9][A-Za-z0-9._:-]{{0,127}}$; got {text!r}. "
            f"Use a slug like 'amaranthine-desire' (ASCII letters, digits, "
            f"hyphen, dot, colon, underscore only; no spaces or CJK)."
        )
    return text


def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeOperationError(f"unreadable JSON object: {path}") from exc
    if not isinstance(value, dict):
        raise RuntimeOperationError(f"JSON value must be an object: {path}")
    return value


_QUICK_FIRE_ROLL_RECEIPT_FIELDS = frozenset({
    "schema_version",
    "tool",
    "decision_id",
    "fingerprint",
    "operation",
    "resolution",
    "roll_id",
    "roll_record",
    "data",
    "warnings",
    "hints",
    "log_prefix_size",
    "log_prefix_sha256",
    "integrity_digest",
})


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _reissue_roll_guidance(campaign_id: str, expression: str, purpose: str | None) -> str:
    """Exact corrected rules.roll_dice call for a receipt that failed verification."""
    arguments: dict[str, Any] = {
        "expression": expression,
        "decision_id": "<new-unique-decision-id>",
    }
    if purpose is not None:
        arguments["purpose"] = purpose
    return json.dumps(
        {"operation": "rules.roll_dice", "campaign": campaign_id, "arguments": arguments},
        ensure_ascii=False,
    )


def _describe_receipt_verification_failure(
    *,
    label: str,
    campaign_id: str,
    decision_id: str,
    roll_id: str,
    receipt: Any,
    operation: Any,
    expected_operation: dict[str, Any],
    expression: str,
    purpose: str | None,
) -> str:
    """Name the dominant receipt mismatch instead of a blanket failure.

    The blanket form hid the actual cause (most often a roll recorded without
    the required closed purpose), which forced blind retries.
    """
    suffix = f" Re-issue the authoritative roll on campaign '{campaign_id}' first: " + _reissue_roll_guidance(
        campaign_id, expression, purpose,
    )
    if not isinstance(receipt, dict):
        return (
            f"{label} roll receipt is unavailable: no rules.roll_dice receipt is "
            f"recorded for decision_id '{decision_id}' on campaign '{campaign_id}'."
            + suffix
        )
    if operation != expected_operation:
        recorded = operation if isinstance(operation, dict) else None
        if isinstance(recorded, dict):
            missing_purpose = (
                purpose is not None and "purpose" not in recorded
            )
            detail = (
                f" (the recorded roll carries no purpose; it must be "
                f"purpose='{purpose}')"
                if missing_purpose
                else ""
            )
        else:
            detail = ""
        return (
            f"{label} recorded roll operation {operation!r} does not match the "
            f"required {expected_operation!r} for decision_id '{decision_id}'."
            + detail + suffix
        )
    if receipt.get("roll_id") != roll_id:
        return (
            f"{label} receipt roll_id {receipt.get('roll_id')!r} does not match "
            f"the referenced roll_id {roll_id!r}."
        )
    return (
        f"{label} source receipt does not match the exact campaign, "
        f"{expression} recipe, and roll_id: recorded receipt failed integrity "
        f"or cross-record consistency against the required operation "
        f"{expected_operation!r}."
    )


def _authoritative_dice_roll_total(
    root: Path,
    reference: Any,
    *,
    current_campaign_id: str,
    expression: str,
    purpose: str | None,
    label: str,
) -> int:
    """Verify one existing campaign dice receipt and return its authoritative total."""
    if not isinstance(reference, dict) or set(reference) != {
        "campaign_id", "decision_id", "roll_id",
    }:
        raise RuntimeOperationError(
            f"{label} roll receipt requires exactly campaign_id, decision_id, and roll_id"
        )
    campaign_id = _id(reference.get("campaign_id"), f"{label}_roll_receipt.campaign_id")
    if campaign_id != current_campaign_id:
        raise RuntimeOperationError(
            f"{label} roll receipt campaign_id must equal the declared current campaign_id"
        )
    decision_id = reference.get("decision_id")
    roll_id = reference.get("roll_id")
    if not isinstance(decision_id, str) or not decision_id.strip():
        raise RuntimeOperationError(f"{label} roll receipt decision_id must be non-empty")
    if not isinstance(roll_id, str) or not roll_id.strip():
        raise RuntimeOperationError(f"{label} roll receipt roll_id must be non-empty")
    normalized_expression = expression.strip().upper()
    match = coc_roll.ROLL_PATTERN.fullmatch(normalized_expression)
    if match is None:
        raise RuntimeOperationError(f"{label} dice expression is invalid")
    expected_resolution = {
        "expression": normalized_expression,
        "count": int(match.group("count")),
        "sides": int(match.group("sides")),
        "modifier": int(match.group("modifier") or 0),
    }
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    campaign_path = campaign_dir / "campaign.json"
    receipt_path = campaign_dir / "save" / "roll-operation-receipts.json"
    rolls_path = campaign_dir / "logs" / "rolls.jsonl"
    coc_root = root / ".coc"
    if (
        not campaign_path.is_file()
        or not _target_kind_is_safe(coc_root, campaign_path)
        or not receipt_path.is_file()
        or not _target_kind_is_safe(coc_root, receipt_path)
        or not rolls_path.is_file()
        or not _target_kind_is_safe(coc_root, rolls_path)
    ):
        raise RuntimeOperationError(f"{label} source receipt is unavailable for campaign: {campaign_id}")
    document = _read_object(receipt_path)
    if (
        set(document) != {"schema_version", "receipts", "pending_side_effects", "luck_spends"}
        or document.get("schema_version") != 6
        or not isinstance(document.get("receipts"), dict)
        or not isinstance(document.get("pending_side_effects"), dict)
        or not isinstance(document.get("luck_spends"), dict)
    ):
        raise RuntimeOperationError(f"{label} source receipt document is invalid")
    by_tool = document["receipts"].get("rules.roll_dice")
    receipt = by_tool.get(decision_id) if isinstance(by_tool, dict) else None
    operation = receipt.get("operation") if isinstance(receipt, dict) else None
    resolution = receipt.get("resolution") if isinstance(receipt, dict) else None
    data = receipt.get("data") if isinstance(receipt, dict) else None
    record = receipt.get("roll_record") if isinstance(receipt, dict) else None
    payload = record.get("payload") if isinstance(record, dict) else None
    rolls = data.get("rolls") if isinstance(data, dict) else None
    reason = operation.get("reason") if isinstance(operation, dict) else None
    expected_operation = {"expression": normalized_expression, "reason": reason}
    if purpose is not None:
        expected_operation["purpose"] = purpose
    receipt_body = (
        {key: deepcopy(value) for key, value in receipt.items() if key != "integrity_digest"}
        if isinstance(receipt, dict) else None
    )
    purpose_matches = (
        all(candidate.get("purpose") == purpose for candidate in (data, record, payload))
        if purpose is not None and all(isinstance(candidate, dict) for candidate in (data, record, payload))
        else purpose is None and all(
            isinstance(candidate, dict) and "purpose" not in candidate
            for candidate in (operation, data, record, payload)
        )
    )
    reason_matches = (
        all(candidate.get("reason") == reason for candidate in (data, record, payload))
        if isinstance(reason, str) and all(isinstance(candidate, dict) for candidate in (data, record, payload))
        else reason is None and all(
            isinstance(candidate, dict) and "reason" not in candidate
            for candidate in (data, record, payload)
        )
    )
    valid = bool(
        isinstance(receipt, dict)
        and set(receipt) == set(_QUICK_FIRE_ROLL_RECEIPT_FIELDS)
        and receipt.get("schema_version") == 5
        and receipt.get("tool") == "rules.roll_dice"
        and receipt.get("decision_id") == decision_id
        and receipt.get("roll_id") == roll_id
        and operation == expected_operation
        and resolution == expected_resolution
        and receipt.get("fingerprint") == _canonical_sha256({"tool": "rules.roll_dice", "operation": expected_operation})
        and receipt.get("integrity_digest") == _canonical_sha256(receipt_body)
        and isinstance(data, dict)
        and isinstance(record, dict)
        and isinstance(payload, dict)
        and data.get("expression") == normalized_expression
        and data.get("count") == expected_resolution["count"]
        and data.get("sides") == expected_resolution["sides"]
        and data.get("modifier") == expected_resolution["modifier"]
        and reason_matches
        and purpose_matches
        and data.get("roll_id") == roll_id
        and isinstance(rolls, list)
        and len(rolls) == expected_resolution["count"]
        and all(
            isinstance(face, int) and not isinstance(face, bool)
            and 1 <= face <= expected_resolution["sides"]
            for face in rolls
        )
        and isinstance(data.get("total"), int)
        and not isinstance(data.get("total"), bool)
        and data.get("total") == sum(rolls) + expected_resolution["modifier"]
        and record.get("roll_id") == roll_id
        and record.get("visibility") == "public"
        and record.get("event_type") == "roll"
        and all(record.get(key) == value for key, value in data.items())
        and all(payload.get(key) == value for key, value in data.items())
        and payload.get("die_expression") == normalized_expression
        and payload.get("individual_faces") == rolls
        and payload.get("final_total") == data.get("total")
        and payload.get("roll") == data.get("total")
    )
    if not valid:
        raise RuntimeOperationError(
            _describe_receipt_verification_failure(
                label=label,
                campaign_id=campaign_id,
                decision_id=decision_id,
                roll_id=roll_id,
                receipt=receipt,
                operation=operation,
                expected_operation=expected_operation,
                expression=normalized_expression,
                purpose=purpose,
            )
        )
    try:
        roll_rows = [
            json.loads(line) for line in rolls_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeOperationError(f"{label} roll log is unreadable") from exc
    if [row for row in roll_rows if row.get("roll_id") == roll_id] != [record]:
        raise RuntimeOperationError(f"{label} roll log does not contain exactly the referenced authoritative roll")
    return int(data["total"])


def _validate_quick_fire_luck_receipt(
    root: Path,
    creation: dict[str, Any] | None,
    *,
    current_campaign_id: str,
) -> None:
    """Bind deterministic Quick Fire Luck to the shared authoritative dice verifier."""
    if not isinstance(creation, dict):
        return
    assignment = creation.get("characteristic_assignment_order")
    luck_total = creation.get("luck_roll_total")
    if assignment is None and luck_total is None:
        return
    reference = creation.get("luck_roll_receipt")
    if not isinstance(reference, dict) or set(reference) != {
        "campaign_id", "decision_id", "roll_id",
    }:
        raise RuntimeOperationError(
            "deterministic Quick Fire creation requires luck_roll_receipt "
            "with exactly campaign_id, decision_id, and roll_id"
        )
    campaign_id = _id(reference.get("campaign_id"), "luck_roll_receipt.campaign_id")
    if campaign_id != current_campaign_id:
        raise RuntimeOperationError(
            "luck_roll_receipt.campaign_id must equal the declared current campaign_id"
        )
    if not isinstance(reference.get("decision_id"), str) or not reference["decision_id"].strip():
        raise RuntimeOperationError("luck_roll_receipt.decision_id must be a non-empty string")
    if not isinstance(reference.get("roll_id"), str) or not reference["roll_id"].strip():
        raise RuntimeOperationError("luck_roll_receipt.roll_id must be a non-empty string")
    try:
        total = _authoritative_dice_roll_total(
            root, reference, current_campaign_id=current_campaign_id,
            expression="3D6", purpose="investigator_creation_luck", label="Quick Fire Luck",
        )
    except RuntimeOperationError as exc:
        raise RuntimeOperationError(
            "Quick Fire Luck source receipt does not match the exact campaign, "
            f"3D6 recipe, roll_id, and luck_roll_total: {exc}"
        ) from exc
    if total != luck_total:
        raise RuntimeOperationError(
            "Quick Fire Luck source receipt does not match the exact campaign, "
            f"3D6 recipe, roll_id, and luck_roll_total: the authoritative 3D6 "
            f"total is {total}, but the payload luck_roll_total is {luck_total!r}"
        )


def _quick_fire_luck_is_auto_roll(creation: dict[str, Any]) -> bool:
    luck = creation.get("luck")
    return isinstance(luck, dict) and luck.get("mode") == "auto_roll"


def _apply_quick_fire_auto_luck_roll(
    root: Path,
    creation: dict[str, Any],
    *,
    campaign_id: str,
    investigator_id: str,
) -> None:
    """Fill luck_roll_total/receipt from the canonical 3D6 Luck roll."""
    if not _quick_fire_luck_is_auto_roll(creation):
        return
    if creation.get("luck_roll_total") is not None or creation.get(
        "luck_roll_receipt"
    ) is not None:
        raise RuntimeOperationError(
            "creation.luck auto_roll cannot be combined with "
            "luck_roll_total or luck_roll_receipt"
        )
    import coc_toolbox
    decision_id = f"chargen-luck-{campaign_id}-{investigator_id}"
    result = coc_toolbox.run_tool(
        "rules.roll_dice",
        root,
        campaign_id,
        {
            "expression": "3D6",
            "decision_id": decision_id,
            "purpose": "investigator_creation_luck",
            "reason": "Quick Fire Luck auto_roll",
        },
    )
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise RuntimeOperationError(
            "Quick Fire Luck auto_roll failed: "
            + str((result or {}).get("error") or result)
        )
    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    total = data.get("total")
    roll_id = data.get("roll_id")
    if (
        isinstance(total, bool)
        or not isinstance(total, int)
        or not isinstance(roll_id, str)
        or not roll_id.strip()
    ):
        raise RuntimeOperationError(
            "Quick Fire Luck auto_roll did not return a usable 3D6 receipt"
        )
    creation["luck_roll_total"] = total
    creation["luck_roll_receipt"] = {
        "campaign_id": campaign_id,
        "decision_id": decision_id,
        "roll_id": roll_id,
    }


def _validate_kp_guided_characteristic_roll_receipts(
    root: Path,
    sheet: dict[str, Any],
    creation: dict[str, Any],
    *,
    current_campaign_id: str,
) -> None:
    """Bind rolled KP-guided characteristics to the shared dice verifier."""
    method_id = creation.get("method")
    method = coc_character.characteristic_generation_methods().get(method_id)
    if not isinstance(method, dict) or method.get("requires_rolls") is not True:
        return
    references = creation.get("characteristic_roll_receipts")
    expressions = coc_character.characteristic_roll_expressions()
    expected_keys = {*coc_character.REQUIRED_CHARACTERISTICS, "Luck"}
    if not isinstance(references, dict) or set(references) != expected_keys or set(expressions) != expected_keys:
        raise RuntimeOperationError("KP-guided characteristic roll recipe is incomplete")
    try:
        multiplier = coc_character.characteristic_generation_multiplier()
    except ValueError as exc:
        raise RuntimeOperationError(str(exc)) from exc
    characteristics = sheet.get("characteristics")
    derived = sheet.get("derived")
    if not isinstance(characteristics, dict) or not isinstance(derived, dict):
        raise RuntimeOperationError("KP-guided characteristic roll binding requires complete characteristics and derived values")
    for characteristic in coc_character.REQUIRED_CHARACTERISTICS:
        total = _authoritative_dice_roll_total(
            root, references[characteristic], current_campaign_id=current_campaign_id,
            expression=expressions[characteristic], purpose=None, label=f"KP-guided {characteristic}",
        )
        if characteristics.get(characteristic) != total * multiplier:
            raise RuntimeOperationError(
                f"KP-guided {characteristic} must equal its authoritative "
                f"{expressions[characteristic]} total times {multiplier}"
            )
    if references["Luck"] != creation.get("luck_roll_receipt"):
        raise RuntimeOperationError("KP-guided Luck characteristic_roll_receipts entry must equal luck_roll_receipt")
    roll_ids = [
        reference.get("roll_id") if isinstance(reference, dict) else None
        for reference in references.values()
    ]
    if (
        any(not isinstance(roll_id, str) or not roll_id.strip() for roll_id in roll_ids)
        or len(set(roll_ids)) != len(expected_keys)
    ):
        raise RuntimeOperationError(
            "KP-guided characteristic roll receipts must use distinct authoritative roll_id values"
        )
    if derived.get("Luck") != creation.get("luck_roll_total") * multiplier:
        raise RuntimeOperationError(f"KP-guided derived Luck must equal its authoritative total times {multiplier}")


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())


def _operation(value: Any) -> tuple[str, dict[str, Any]]:
    if not isinstance(value, dict) or set(value) != {"schema_version", "kind", "payload"}:
        raise RuntimeOperationError(
            "operation must contain exactly schema_version, kind, and payload"
        )
    if value.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeOperationError("operation schema_version must be 1")
    kind = value.get("kind")
    payload = value.get("payload")
    if kind not in SESSION_OPERATION_KINDS:
        raise RuntimeOperationError("unsupported runtime operation kind")
    if not isinstance(payload, dict):
        raise RuntimeOperationError("operation payload must be an object")
    return str(kind), payload


def _setup_operation(value: Any) -> tuple[str, dict[str, Any]]:
    if not isinstance(value, dict) or set(value) != {"schema_version", "kind", "payload"}:
        raise RuntimeOperationError(
            "setup operation must contain exactly schema_version, kind, and payload"
        )
    if value.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeOperationError("setup operation schema_version must be 1")
    kind = value.get("kind")
    payload = value.get("payload")
    if kind not in SETUP_OPERATION_KINDS:
        raise RuntimeOperationError("unsupported setup operation kind")
    if not isinstance(payload, dict):
        raise RuntimeOperationError("setup operation payload must be an object")
    return str(kind), payload


OPENING_FAST_FACTS_CONTRACT_ID = "coc.opening-fast-facts.v1"
# The fixed question set the fast source parse must answer before a player can
# build an investigator. Every question needs an explicit answer; "unresolved"
# is an honest answer and is never harder to submit than a fabricated one.
_OPENING_FAST_FACT_QUESTIONS: tuple[tuple[str, str], ...] = (
    ("era", "str"),
    ("place", "str"),
    ("investigator_hook", "str"),
    ("investigator_constraints", "str"),
    ("player_safe_summary", "str"),
    ("content_flags", "list"),
)
# Only these two decide occupation, skills, money, gear, language, and names,
# so only these two hold character creation closed when unresolved.
_OPENING_FAST_FACT_GATES: tuple[str, ...] = ("era", "place")


def _validated_source_refs(value: Any, field: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise RuntimeOperationError(
            f"opening fast fact {field!r} requires non-empty source evidence"
        )
    refs: list[dict[str, Any]] = []
    allowed = {
        "source_id",
        "pdf_index",
        "text_sha256",
        "bundle_sha256s",
        "bundle_sha256",
        "file_sha256",
        "review_state",
        "parse_confidence",
        "grep_anchors",
        "grep_anchor",
        "ocr_revision",
        "structured_data",
        "printed_page",
        "printed_label",
    }
    for ref in value:
        if (
            not isinstance(ref, dict)
            or not {"source_id", "pdf_index"} <= set(ref)
            or bool(set(ref) - allowed)
            or not isinstance(ref.get("source_id"), str)
            or not ref["source_id"].strip()
            or not isinstance(ref.get("pdf_index"), int)
            or isinstance(ref.get("pdf_index"), bool)
            or int(ref["pdf_index"]) < 0
        ):
            raise RuntimeOperationError(
                f"opening fast fact {field!r} source evidence entries require "
                "source_id and a zero-based pdf_index"
            )
        normalized = deepcopy(ref)
        normalized["source_id"] = ref["source_id"].strip()
        normalized["pdf_index"] = int(ref["pdf_index"])
        refs.append(normalized)
    return refs


def _validated_opening_fast_facts(value: Any) -> dict[str, Any]:
    """Validate one closed answer set from the fast source parse.

    The shape is deliberately uniform: each question answers `source` with a
    value plus page refs, or `unresolved` with neither. Nothing here judges
    whether the answer is *correct* — that stays with the reading agent — only
    that every question was actually asked and that a claim carries a citation.
    """
    if not isinstance(value, dict):
        raise RuntimeOperationError("facts must be an object")
    expected = {"schema_version", "contract_id", *(
        name for name, _ in _OPENING_FAST_FACT_QUESTIONS
    )}
    if set(value) != expected:
        missing = sorted(expected - set(value))
        unsupported = sorted(set(value) - expected)
        details = []
        if missing:
            details.append("missing: " + ", ".join(missing))
        if unsupported:
            details.append("unsupported: " + ", ".join(unsupported))
        raise RuntimeOperationError(
            f"facts must answer every {OPENING_FAST_FACTS_CONTRACT_ID} question "
            "exactly once (" + "; ".join(details) + ")"
        )
    if value.get("schema_version") != 1:
        raise RuntimeOperationError("facts schema_version must be 1")
    if value.get("contract_id") != OPENING_FAST_FACTS_CONTRACT_ID:
        raise RuntimeOperationError(
            f"facts contract_id must be {OPENING_FAST_FACTS_CONTRACT_ID}"
        )
    validated: dict[str, Any] = {
        "schema_version": 1,
        "contract_id": OPENING_FAST_FACTS_CONTRACT_ID,
    }
    for name, value_kind in _OPENING_FAST_FACT_QUESTIONS:
        answer = value.get(name)
        if not isinstance(answer, dict) or "status" not in answer:
            raise RuntimeOperationError(
                f"opening fast fact {name!r} must be an object with a status"
            )
        status = answer.get("status")
        if status == "unresolved":
            if set(answer) != {"status", "inspected_source_refs"}:
                raise RuntimeOperationError(
                    f"opening fast fact {name!r} is unresolved and requires "
                    "exactly status and inspected_source_refs"
                )
            validated[name] = {
                "status": "unresolved",
                "inspected_source_refs": _validated_source_refs(
                    answer.get("inspected_source_refs"), name
                ),
            }
            continue
        if status != "source":
            raise RuntimeOperationError(
                f"opening fast fact {name!r} status must be source or unresolved"
            )
        if set(answer) != {"status", "value", "source_refs"}:
            raise RuntimeOperationError(
                f"opening fast fact {name!r} with status 'source' requires "
                "exactly status, value, and source_refs"
            )
        raw = answer.get("value")
        if value_kind == "list":
            if (
                not isinstance(raw, list)
                or not raw
                or any(
                    not isinstance(item, str) or not item.strip() for item in raw
                )
            ):
                raise RuntimeOperationError(
                    f"opening fast fact {name!r} value must be a non-empty list "
                    "of non-empty strings"
                )
            normalized_value: Any = [item.strip() for item in raw]
            if len(normalized_value) != len(set(normalized_value)):
                raise RuntimeOperationError(
                    f"opening fast fact {name!r} value must contain unique strings"
                )
        else:
            if not isinstance(raw, str) or not raw.strip():
                raise RuntimeOperationError(
                    f"opening fast fact {name!r} value must be a non-empty string"
                )
            normalized_value = raw.strip()
        validated[name] = {
            "status": "source",
            "value": normalized_value,
            "source_refs": _validated_source_refs(
                answer.get("source_refs"), name
            ),
        }
    return validated


def _canonicalize_opening_fast_facts(
    root: Path,
    campaign_id: str,
    facts: dict[str, Any],
) -> dict[str, Any]:
    try:
        source_root = coc_module_project.resolve_opening_preparation_root(
            root, campaign_id
        )
        canonical = deepcopy(facts)
        for name, _value_kind in _OPENING_FAST_FACT_QUESTIONS:
            answer = canonical[name]
            refs_key = (
                "source_refs"
                if answer["status"] == "source"
                else "inspected_source_refs"
            )
            supplied_refs = answer[refs_key]
            selectors = [
                {
                    "source_id": ref["source_id"],
                    "pdf_index": ref["pdf_index"],
                }
                for ref in supplied_refs
            ]
            current_refs = coc_module_assets.canonical_campaign_source_refs(
                root,
                source_root["asset_root_id"],
                source_root["bundle_sha256"],
                selectors,
                field=f"source_fast_facts.{name}.{refs_key}",
            )
            projected_refs: list[dict[str, Any]] = []
            for supplied, selector, current in zip(
                supplied_refs, selectors, current_refs, strict=True
            ):
                # grep anchors prove that bundle extraction/review was valid,
                # but they are snippets of source content rather than campaign
                # provenance. Validate against the live canonical bundle, then
                # retain only identity and review metadata in campaign/public
                # facts. Accept already-projected records on revalidation and
                # full current records long enough to safely project them.
                projected = {
                    key: deepcopy(value)
                    for key, value in current.items()
                    if key not in {"grep_anchors", "grep_anchor"}
                }
                if supplied not in (selector, current, projected):
                    raise RuntimeOperationError(
                        "opening fast facts source evidence is stale or does "
                        "not match the current source cache"
                    )
                projected_refs.append(projected)
            answer[refs_key] = projected_refs
        return canonical
    except (
        coc_module_project.OpeningPreparationError,
        coc_module_assets.ModuleAssetsError,
        OSError,
        ValueError,
    ) as exc:
        raise RuntimeOperationError(
            f"opening fast facts source evidence is invalid: {exc}"
        ) from exc


_OPENING_SOURCE_FACTS_TRANSPORT_CONTRACT_ID = (
    "coc.opening-source-facts-transport.v1"
)
_OPENING_SOURCE_FACTS_TRANSPORT_FIELDS = {
    "schema_version", "contract_id", "status", "campaign_id",
    "scenario_id", "opening_review_generation", "source_id",
    "file_sha256", "bundle_sha256", "review_receipt_sha256",
    "facts_sha256", "facts",
}


def _validate_opening_source_facts_transport(
    workspace: Path | str,
    campaign_id: str,
    record: Any | None = None,
) -> dict[str, Any] | None:
    """Validate the closed pending Pi facts packet against current source."""
    root = Path(workspace).resolve()
    campaign = _id(campaign_id, "campaign_id")
    campaign_dir = root / ".coc" / "campaigns" / campaign
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    if record is None and not scenario_path.exists():
        # An unbound campaign has no pending transport. Let the established
        # source-binding validator below produce its canonical error; do not
        # create or infer scenario state here. Existing malformed files remain
        # fail-closed through _read_object.
        return None
    scenario = _read_object(scenario_path)
    transport = (
        scenario.get("opening_source_facts_transport")
        if record is None else record
    )
    if transport is None:
        return None
    if (
        not isinstance(transport, dict)
        or set(transport) != _OPENING_SOURCE_FACTS_TRANSPORT_FIELDS
        or transport.get("schema_version") != 1
        or transport.get("contract_id")
        != _OPENING_SOURCE_FACTS_TRANSPORT_CONTRACT_ID
        or transport.get("status") != "pending_public_adoption"
        or transport.get("campaign_id") != campaign
        or transport.get("scenario_id") != scenario.get("scenario_id")
    ):
        raise RuntimeOperationError(
            "opening source facts transport authority is invalid"
        )
    task = _validate_opening_review_task(
        scenario, expected_status="fulfilled",
    )
    receipt = _validate_opening_source_review_fulfillment(
        root,
        scenario.get("opening_source_review_receipt"),
        expected_status="reviewed",
    )
    source = (
        scenario.get("source")
        if isinstance(scenario.get("source"), dict) else {}
    )
    expected_binding = {
        "scenario_id": task["scenario_id"],
        "opening_review_generation": task["generation"],
        "source_id": str(source.get("source_id") or ""),
        "file_sha256": str(source.get("file_sha256") or ""),
        "bundle_sha256": str(source.get("bundle_sha256") or ""),
        "review_receipt_sha256": _opening_review_receipt_digest(receipt),
    }
    if any(transport.get(key) != value for key, value in expected_binding.items()):
        raise RuntimeOperationError(
            "opening source facts transport source binding is stale"
        )
    facts = _validated_opening_fast_facts(transport.get("facts"))
    if (
        transport.get("facts") != facts
        or transport.get("facts_sha256") != _canonical_sha256(facts)
    ):
        raise RuntimeOperationError(
            "opening source facts transport digest is invalid"
        )
    # Validate selectors against the current bundle/cache, but deliberately
    # retain only the producer's minimal two-field selectors in this record.
    _canonicalize_opening_fast_facts(root, campaign, facts)
    return deepcopy(transport)


# L0 is a private source-review product, separate from ``source_fast_facts``.
# The latter is deliberately player-safe; putting title/appendix-derived pregen
# and Keeper-facing creation material there would destroy that boundary.
_MODULE_INIT_DOCUMENT_SCHEMA_VERSION = 1
_MODULE_INIT_L0_SCHEMA_VERSION = 1
_MODULE_INIT_STATE_FILENAME = "module-init.json"
_MODULE_INIT_SECRECY = "keeper_only"
_MODULE_INIT_DOCUMENT_FIELDS = frozenset({
    "schema_version", "campaign_id", "secrecy", "source_binding",
    "l0_sha256", "l0", "created_at",
})
_MODULE_INIT_SOURCE_BINDING_FIELDS = frozenset({
    "scenario_id", "source_id", "file_sha256", "bundle_sha256",
    "opening_review_generation", "review_receipt_sha256",
})
_MODULE_INIT_L0_REQUIRED_FIELDS = frozenset({
    "schema_version", "secrecy", "module_meta", "pregens",
    "opening_hooks", "chargen_deltas", "opening_handouts",
})
_MODULE_INIT_META_REQUIRED_FIELDS = frozenset({
    "title_zh", "title_en", "authors", "translator", "era", "locale",
    "party_size", "duration_hint", "tone_tags", "mythos_entities",
    "campaign_hooks", "warnings", "safety_notes", "structure_type",
})
_MODULE_INIT_PREGEN_REQUIRED_FIELDS = frozenset({
    "name", "age", "occupation", "hooks_to_plot", "backstory_blocks",
    "stats_ref",
})
_MODULE_INIT_HOOK_REQUIRED_FIELDS = frozenset({
    "id", "audience", "text", "variant_of",
})
_MODULE_INIT_HANDOUT_REQUIRED_FIELDS = frozenset({
    "id", "title", "when_to_give",
})


def _module_init_path(campaign_dir: Path) -> Path:
    return Path(campaign_dir) / "save" / _MODULE_INIT_STATE_FILENAME


def _module_init_json_copy(value: Any, label: str) -> Any:
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise RuntimeOperationError(f"{label} must be JSON-serializable") from exc


def _module_init_text_or_none(value: Any, label: str, *, maximum: int = 4_000) -> None:
    if value is not None and (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > maximum
    ):
        raise RuntimeOperationError(f"{label} must be a non-empty string or null")


def _module_init_text_list(value: Any, label: str, *, maximum: int = 128) -> None:
    if (
        not isinstance(value, list)
        or len(value) > maximum
        or any(
            not isinstance(item, str)
            or not item.strip()
            or len(item) > 4_000
            for item in value
        )
    ):
        raise RuntimeOperationError(f"{label} must be an array of non-empty strings")


def _module_init_text_or_list_or_none(value: Any, label: str) -> None:
    if value is None:
        return
    if isinstance(value, str):
        _module_init_text_or_none(value, label)
        return
    _module_init_text_list(value, label)


def _validate_module_init_l0(value: Any) -> dict[str, Any]:
    """Validate the required L0 floor while preserving authored extensions.

    This is intentionally a thin schema: all named fields are structural
    obligations, but module_meta and every entity record may carry additional
    source-specific properties without a migration or a second schema owner.
    """
    data = _module_init_json_copy(value, "module-init L0")
    if (
        not isinstance(data, dict)
        or not _MODULE_INIT_L0_REQUIRED_FIELDS <= set(data)
        or data.get("schema_version") != _MODULE_INIT_L0_SCHEMA_VERSION
        or data.get("secrecy") != _MODULE_INIT_SECRECY
    ):
        raise RuntimeOperationError(
            "module-init L0 must contain the current schema_version, keeper_only "
            "secrecy, module_meta, pregens, opening_hooks, chargen_deltas, and "
            "opening_handouts"
        )
    meta = data.get("module_meta")
    if (
        not isinstance(meta, dict)
        or not _MODULE_INIT_META_REQUIRED_FIELDS <= set(meta)
    ):
        raise RuntimeOperationError(
            "module-init L0 module_meta is missing required creation fields"
        )
    for field in (
        "title_zh", "title_en", "era", "locale", "duration_hint",
        "structure_type",
    ):
        _module_init_text_or_none(meta[field], f"module_meta.{field}")
    party_size = meta["party_size"]
    if party_size is not None and (
        (not isinstance(party_size, (str, int))) or isinstance(party_size, bool)
    ):
        raise RuntimeOperationError(
            "module_meta.party_size must be a string, integer, or null"
        )
    for field in ("authors", "translator", "safety_notes"):
        _module_init_text_or_list_or_none(meta[field], f"module_meta.{field}")
    for field in ("tone_tags", "mythos_entities", "campaign_hooks", "warnings"):
        _module_init_text_list(meta[field], f"module_meta.{field}")

    pregens = data.get("pregens")
    if not isinstance(pregens, list) or len(pregens) > 128:
        raise RuntimeOperationError("module-init L0 pregens must be an array")
    for index, pregen in enumerate(pregens):
        label = f"pregens[{index}]"
        if not isinstance(pregen, dict):
            raise RuntimeOperationError(f"{label} must be an object")
        missing = sorted(_MODULE_INIT_PREGEN_REQUIRED_FIELDS - set(pregen))
        if missing:
            raise RuntimeOperationError(
                f"{label} is missing required field(s): {', '.join(missing)}"
            )
        _module_init_text_or_none(pregen["name"], f"{label}.name")
        _module_init_text_or_none(pregen["occupation"], f"{label}.occupation")
        age = pregen["age"]
        if age is not None and (
            not isinstance(age, (str, int)) or isinstance(age, bool)
        ):
            raise RuntimeOperationError(f"{label}.age must be a string, integer, or null")
        _module_init_text_list(pregen["hooks_to_plot"], f"{label}.hooks_to_plot")
        blocks = pregen["backstory_blocks"]
        if blocks is not None and not isinstance(blocks, (str, list, dict)):
            raise RuntimeOperationError(
                f"{label}.backstory_blocks must be a string, object, array, or null"
            )
        stats_ref = pregen["stats_ref"]
        if stats_ref is not None and not isinstance(stats_ref, (str, dict)):
            raise RuntimeOperationError(
                f"{label}.stats_ref must be a string, object, or null"
            )

    opening_hooks = data.get("opening_hooks")
    if not isinstance(opening_hooks, list) or len(opening_hooks) > 128:
        raise RuntimeOperationError("module-init L0 opening_hooks must be an array")
    for index, hook in enumerate(opening_hooks):
        label = f"opening_hooks[{index}]"
        if not isinstance(hook, dict):
            raise RuntimeOperationError(f"{label} must be an object")
        missing = sorted(_MODULE_INIT_HOOK_REQUIRED_FIELDS - set(hook))
        if missing:
            raise RuntimeOperationError(
                f"{label} is missing required field(s): {', '.join(missing)}"
            )
        if not isinstance(hook["id"], str) or not hook["id"].strip():
            raise RuntimeOperationError(f"{label}.id must be a non-empty string")
        if hook["audience"] not in {"player", "keeper"}:
            raise RuntimeOperationError(
                f"{label}.audience must be one of: player, keeper"
            )
        if (
            not isinstance(hook["text"], str)
            or not hook["text"].strip()
            or len(hook["text"]) > 20_000
        ):
            raise RuntimeOperationError(
                f"{label}.text must be a non-empty string up to 20000 characters"
            )
        _module_init_text_or_none(hook["variant_of"], f"{label}.variant_of")

    deltas = data.get("chargen_deltas")
    if (
        not isinstance(deltas, list)
        or len(deltas) > 128
        or any(not isinstance(delta, dict) for delta in deltas)
    ):
        raise RuntimeOperationError("module-init L0 chargen_deltas must be an array of objects")

    handouts = data.get("opening_handouts")
    if not isinstance(handouts, list) or len(handouts) > 128:
        raise RuntimeOperationError("module-init L0 opening_handouts must be an array")
    for index, handout in enumerate(handouts):
        label = f"opening_handouts[{index}]"
        if not isinstance(handout, dict):
            raise RuntimeOperationError(f"{label} must be an object")
        missing = sorted(_MODULE_INIT_HANDOUT_REQUIRED_FIELDS - set(handout))
        if missing:
            raise RuntimeOperationError(
                f"{label} is missing required field(s): {', '.join(missing)}"
            )
        if not isinstance(handout["id"], str) or not handout["id"].strip():
            raise RuntimeOperationError(f"{label}.id must be a non-empty string")
        _module_init_text_or_none(handout["title"], f"{label}.title")
        _module_init_text_or_none(handout["when_to_give"], f"{label}.when_to_give")
    return data


def _module_init_source_binding(
    scenario: dict[str, Any], review_receipt: dict[str, Any],
) -> dict[str, Any]:
    source = scenario.get("source") if isinstance(scenario.get("source"), dict) else {}
    binding = {
        "scenario_id": str(scenario.get("scenario_id") or ""),
        "source_id": str(source.get("source_id") or ""),
        "file_sha256": str(source.get("file_sha256") or ""),
        "bundle_sha256": str(source.get("bundle_sha256") or ""),
        "opening_review_generation": review_receipt.get("opening_review_generation"),
        "review_receipt_sha256": _opening_review_receipt_digest(review_receipt),
    }
    if (
        not all(
            isinstance(binding[key], str) and binding[key]
            for key in ("scenario_id", "source_id")
        )
        or any(
            re.fullmatch(r"[0-9a-f]{64}", str(binding[key])) is None
            for key in ("file_sha256", "bundle_sha256")
        )
        or not isinstance(binding["opening_review_generation"], int)
        or isinstance(binding["opening_review_generation"], bool)
        or binding["opening_review_generation"] < 1
        or re.fullmatch(
            r"sha256:[0-9a-f]{64}", str(binding["review_receipt_sha256"])
        ) is None
    ):
        raise RuntimeOperationError("module-init source binding is invalid")
    return binding


def _validate_module_init_document(
    value: Any, campaign_id: str,
) -> dict[str, Any]:
    data = _module_init_json_copy(value, "module-init state")
    if (
        not isinstance(data, dict)
        or set(data) != _MODULE_INIT_DOCUMENT_FIELDS
        or data.get("schema_version") != _MODULE_INIT_DOCUMENT_SCHEMA_VERSION
        or data.get("campaign_id") != campaign_id
        or data.get("secrecy") != _MODULE_INIT_SECRECY
        or not isinstance(data.get("source_binding"), dict)
        or set(data["source_binding"]) != _MODULE_INIT_SOURCE_BINDING_FIELDS
        or not isinstance(data.get("created_at"), str)
        or not data["created_at"].strip()
    ):
        raise RuntimeOperationError("module-init state document is invalid")
    binding = data["source_binding"]
    if (
        not all(
            isinstance(binding.get(key), str) and binding[key]
            for key in ("scenario_id", "source_id")
        )
        or any(
            re.fullmatch(r"[0-9a-f]{64}", str(binding.get(key) or "")) is None
            for key in ("file_sha256", "bundle_sha256")
        )
        or not isinstance(binding.get("opening_review_generation"), int)
        or isinstance(binding["opening_review_generation"], bool)
        or binding["opening_review_generation"] < 1
        or re.fullmatch(
            r"sha256:[0-9a-f]{64}", str(binding.get("review_receipt_sha256") or "")
        ) is None
    ):
        raise RuntimeOperationError("module-init state source binding is invalid")
    l0 = _validate_module_init_l0(data.get("l0"))
    if data.get("l0_sha256") != _canonical_sha256(l0):
        raise RuntimeOperationError("module-init state L0 digest is invalid")
    return data


def _write_module_init_l0(
    campaign_dir: Path,
    campaign_id: str,
    scenario: dict[str, Any],
    review_receipt: dict[str, Any],
    l0: dict[str, Any],
) -> dict[str, Any]:
    validated_l0 = _validate_module_init_l0(l0)
    document = {
        "schema_version": _MODULE_INIT_DOCUMENT_SCHEMA_VERSION,
        "campaign_id": campaign_id,
        "secrecy": _MODULE_INIT_SECRECY,
        "source_binding": _module_init_source_binding(scenario, review_receipt),
        "l0_sha256": _canonical_sha256(validated_l0),
        "l0": validated_l0,
        "created_at": _now(),
    }
    document = _validate_module_init_document(document, campaign_id)
    coc_fileio.write_json_atomic(
        _module_init_path(campaign_dir), document, indent=2,
        ensure_ascii=False, trailing_newline=True,
    )
    return document


def _pi_source_bound_module_init_required(root: Path, campaign_id: str) -> bool:
    if str(os.environ.get("COC_HOST") or "").lower() != "pi":
        return False
    scenario_path = root / ".coc" / "campaigns" / campaign_id / "scenario" / "scenario.json"
    if not scenario_path.is_file():
        return False
    scenario = _read_object(scenario_path)
    source = scenario.get("source") if isinstance(scenario.get("source"), dict) else {}
    return bool(
        str(source.get("source_id") or "").strip()
        and str(source.get("bundle_sha256") or "").strip()
    )


def _pi_module_init_l0_status(
    root: Path, campaign_id: str,
) -> tuple[bool, str | None, dict[str, Any] | None]:
    if not _pi_source_bound_module_init_required(root, campaign_id):
        return True, None, None
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    path = _module_init_path(campaign_dir)
    if not path.is_file():
        return False, "save/module-init.json is missing", None
    try:
        document = _validate_module_init_document(
            _read_object(path), campaign_id,
        )
        scenario = _read_object(campaign_dir / "scenario" / "scenario.json")
        receipt = _validate_opening_source_review_fulfillment(
            root,
            scenario.get("opening_source_review_receipt"),
            expected_status="reviewed",
        )
        if document["source_binding"] != _module_init_source_binding(scenario, receipt):
            return False, "save/module-init.json is stale for the current source review", None
    except RuntimeOperationError as exc:
        return False, str(exc), None
    return True, None, document


def _require_pi_module_init_l0(
    root: Path, campaign_id: str,
) -> dict[str, Any] | None:
    ready, reason, document = _pi_module_init_l0_status(root, campaign_id)
    if ready:
        return document
    raise RuntimeOperationError(
        f"campaign {campaign_id!r} character creation is blocked until the "
        "source-reviewed coc-module-init L0 package is present and bound to "
        f"the current PDF ({reason or 'L0 is unavailable'}); do not guess "
        "pregens, era adjustments, opening hooks, or handouts"
    )


def _require_established_source_facts(
    root: Path, campaign: dict[str, Any], campaign_id: str
) -> dict[str, Any] | None:
    """Fail closed until the fast source parse has answered the gating questions.

    A raw-PDF campaign is created before anything is known about the module.
    Era decides occupation, skills, money, and equipment; place decides
    language, names, and social position. Both must come from the source parse
    rather than from the placeholder era ``create_campaign`` seeds a clock with.
    Built-in starters and any caller that declared an era pass straight through.
    """
    stored_facts = campaign.get("source_fast_facts")
    if stored_facts is not None:
        validated = _validated_opening_fast_facts(stored_facts)
        _canonicalize_opening_fast_facts(root, campaign_id, validated)
    if not coc_state.campaign_era_is_established(campaign):
        raise RuntimeOperationError(
            f"campaign {campaign_id!r} era is not source-established "
            f"(era_source={coc_state.campaign_era_source(campaign)!r}): "
            "character creation is blocked until the fast source parse answers "
            f"the {OPENING_FAST_FACTS_CONTRACT_ID} era question through "
            "setup.adopt_source_facts; do not guess the era"
        )
    if not coc_state.campaign_place_is_established(campaign):
        # The place question exists only for campaigns whose scenario is
        # PDF source-bound (a fast source parse answered from bundle pages).
        # A built-in starter — or any scenario installed without a PDF
        # bundle — never had a source parse to ask; its scenario files are
        # the source. This mirrors campaign_place_is_established's own
        # contract note and the era exemption starters already enjoy.
        scenario_path = (
            root / ".coc" / "campaigns" / campaign_id / "scenario" / "scenario.json"
        )
        scenario: dict[str, Any] = {}
        if scenario_path.is_file():
            try:
                scenario = _read_object(scenario_path)
            except RuntimeOperationError:
                scenario = {}
        source = scenario.get("source") if isinstance(scenario.get("source"), dict) else {}
        source_bound = bool(
            str(source.get("source_id") or "").strip()
            and str(source.get("bundle_sha256") or "").strip()
        )
        if source_bound:
            raise RuntimeOperationError(
                f"campaign {campaign_id!r} setting place is not source-established: "
                "character creation is blocked until the fast source parse answers "
                f"the {OPENING_FAST_FACTS_CONTRACT_ID} place question through "
                "setup.adopt_source_facts; do not guess the country, city, or "
                "region"
            )
    return _require_pi_module_init_l0(root, campaign_id)


def _character_values(character: dict[str, Any]) -> dict[str, int]:
    characteristics = character.get("characteristics")
    if not isinstance(characteristics, dict):
        characteristics = {}
    return {
        "pow": int(characteristics.get("POW") or 0),
        "int": int(characteristics.get("INT") or 0),
    }


def _magic_state(
    workspace: Path,
    campaign_id: str,
    investigator_id: str,
    character_path: Path,
) -> tuple[Path, dict[str, Any]]:
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    character = read_development_guarded_character(
        campaign_dir, investigator_id, character_path
    )
    path = coc_state.seed_investigator_state_if_missing(
        workspace, campaign_id, investigator_id, sheet=character
    )
    state = coc_state.load_investigator_state(path.parents[2], investigator_id)
    for key, value in _character_values(character).items():
        state.setdefault(key, value)
    magic = state.get("magic")
    if not isinstance(magic, dict):
        magic = {}
    for key in ("cast_spells", "learned_spells"):
        values = magic.get(key)
        magic[key] = list(values) if isinstance(values, list) else []
    state["magic"] = magic
    return path, state


def _validate_spell(payload: dict[str, Any], allowed: set[str]) -> str:
    if set(payload) - allowed:
        raise RuntimeOperationError("magic payload has unsupported fields")
    spell = payload.get("spell")
    if not isinstance(spell, str) or not spell.strip():
        raise RuntimeOperationError("magic payload requires spell")
    try:
        canonical = coc_rules.spell_by_name(spell.strip())
    except KeyError as exc:
        raise RuntimeOperationError(f"unknown spell: {spell.strip()}") from exc
    return str(canonical["name"])


def _magic_operation(
    *,
    workspace: Path,
    campaign_dir: Path,
    campaign_id: str,
    investigator_id: str,
    character_path: Path,
    kind: str,
    payload: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    state_path, state = _magic_state(
        workspace, campaign_id, investigator_id, character_path
    )
    magic = state["magic"]
    if kind == "magic.cast":
        spell = _validate_spell(
            payload, {"spell", "pushed", "interrupted", "is_npc"}
        )
        cast_spells = {str(item) for item in magic["cast_spells"]}
        result = coc_magic.cast_spell(
            spell,
            state,
            is_first_cast=spell not in cast_spells,
            is_npc=payload.get("is_npc") is True,
            pushed=payload.get("pushed") is True,
            interrupted=payload.get("interrupted") is True,
            rng=rng,
        )
        if result.get("success") and spell not in cast_spells:
            magic["cast_spells"].append(spell)
    else:
        spell = _validate_spell(payload, {"spell", "source"})
        source = payload.get("source", "tome")
        if source not in {"tome", "person", "entity"}:
            raise RuntimeOperationError("magic.learn source must be tome|person|entity")
        result = coc_magic.learn_spell(
            spell, state, source=str(source), rng=rng, campaign_dir=campaign_dir
        )
        learned = {str(item) for item in magic["learned_spells"]}
        if result.get("learned") and not result.get("completion_trigger_id") and spell not in learned:
            magic["learned_spells"].append(spell)
    coc_fileio.write_json_atomic(
        state_path, state, indent=2, ensure_ascii=False, trailing_newline=True
    )
    operation_id = f"op-{kind.replace('.', '-')}-{int(rng.random() * 10**12):012d}"
    event = {
        "type": "magic",
        "actor": investigator_id,
        "operation_id": operation_id,
        "payload": result,
        "ts": _now(),
    }
    _append_jsonl(campaign_dir / "logs" / "events.jsonl", event)
    roll = result.get("roll_result")
    if isinstance(roll, dict) and isinstance(roll.get("roll"), int):
        _append_jsonl(campaign_dir / "logs" / "rolls.jsonl", {
            "type": "roll",
            "actor": investigator_id,
            "command_id": operation_id,
            "payload": {
                "roll_id": operation_id,
                "kind": kind,
                "skill": "POW" if kind == "magic.cast" else "INT",
                "target": roll.get("target"),
                "difficulty": "hard",
                "roll": roll.get("roll"),
                "effective_target": roll.get("effective_target"),
                "outcome": roll.get("outcome"),
                "success": bool(result.get("success") or result.get("learned")),
                "visibility": "public",
            },
            "ts": _now(),
        })
    return {
        "schema_version": 1,
        "status": "PASS",
        "kind": kind,
        "operation_id": operation_id,
        "result": result,
        "state_refs": [
            f"save/investigator-state/{investigator_id}.json",
            "logs/events.jsonl",
        ],
    }


def _investigator_state(
    workspace: Path,
    campaign_id: str,
    investigator_id: str,
    character_path: Path,
) -> tuple[Path, dict[str, Any], dict[str, Any]]:
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    character = read_development_guarded_character(
        campaign_dir, investigator_id, character_path
    )
    state_path = coc_state.seed_investigator_state_if_missing(
        workspace, campaign_id, investigator_id, sheet=character
    )
    state = coc_state.load_investigator_state(state_path.parents[2], investigator_id)
    characteristics = character.get("characteristics")
    if not isinstance(characteristics, dict):
        characteristics = {}
    derived = character.get("derived")
    if not isinstance(derived, dict):
        derived = {}
    state.setdefault("investigator_id", investigator_id)
    state.setdefault("current_hp", int(derived.get("HP") or 10))
    state.setdefault("hp_max", int(derived.get("HP") or state["current_hp"]))
    state.setdefault("current_san", int(derived.get("SAN") or characteristics.get("POW") or 50))
    state.setdefault("max_san", 99 - int(state.get("cm_value") or 0))
    state.setdefault("con", int(characteristics.get("CON") or 50))
    state.setdefault("int", int(characteristics.get("INT") or 50))
    state.setdefault("conditions", [])
    return state_path, state, character


def _operation_id(kind: str, rng: random.Random) -> str:
    return f"op-{kind.replace('.', '-')}-{int(rng.random() * 10**12):012d}"


def _write_public_roll(
    campaign_dir: Path,
    *,
    command_id: str,
    actor_id: str,
    kind: str,
    skill: str,
    roll: int,
    die: str,
    die_rolls: list[int],
    target: int | None = None,
    difficulty: str | None = None,
    outcome: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    faces = [int(value) for value in die_rolls]
    total = int(roll)
    payload: dict[str, Any] = {
        "roll_id": command_id,
        "actor_id": actor_id,
        "kind": kind,
        "skill": skill,
        "roll": total,
        "die": die,
        "die_expression": die,
        "expression": die,
        "die_rolls": faces,
        "rolls": faces,
        "individual_faces": faces,
        "dice": {
            "expression": die,
            "raw": faces,
            "total": total,
        },
        "outcome": outcome,
        "visibility": "public",
    }
    if target is not None:
        payload["target"] = int(target)
        payload["effective_target"] = int(target)
        payload["base_target"] = int(target)
    if difficulty is not None:
        payload["difficulty"] = difficulty
    if extra:
        payload.update(extra)
    row = {
        "event_type": "roll",
        "type": "roll",
        "roll_id": command_id,
        "actor": actor_id,
        "visibility": "public",
        "source": "runtime_operation",
        "source_ref": f"logs/rolls.jsonl#{command_id}",
        "command_id": command_id,
        "payload": payload,
        "ts": _now(),
    }
    _append_jsonl(campaign_dir / "logs" / "rolls.jsonl", row)
    return row


def _compose_development_player_facing(
    *,
    investigator_id: str,
    operation_id: str,
    result: dict[str, Any],
    public_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Hard-constrain development public checks into final player output.

    Every improvement check, gain die, Luck recovery, and SAN reward written
    during settlement must appear once in the player-facing mechanics block.
    SAN reward alone is not enough.
    """
    expected_ids: list[str] = []
    for index, check in enumerate(result.get("improvement_checks") or []):
        if not isinstance(check, dict):
            continue
        expected_ids.append(f"{operation_id}:check:{index}")
        if check.get("improved") and isinstance(check.get("gain"), int):
            expected_ids.append(f"{operation_id}:gain:{index}")
    luck = result.get("luck_recovery") or {}
    if isinstance(luck.get("roll"), int):
        expected_ids.append(f"{operation_id}:luck-recovery")
    # Result fields may exist on replay without a new write; only require the
    # rolls that this settlement actually emitted into public_rows.
    written_ids = [
        str(row.get("roll_id") or "")
        for row in public_rows
        if isinstance(row, dict) and row.get("roll_id")
    ]
    required_ids = list(dict.fromkeys([*expected_ids, *written_ids]))
    by_id = {
        str(row.get("roll_id") or ""): row
        for row in public_rows
        if isinstance(row, dict) and row.get("roll_id")
    }
    lines: list[str] = []
    missing: list[str] = []
    for roll_id in required_ids:
        row = by_id.get(roll_id)
        if row is None:
            missing.append(roll_id)
            continue
        flat = dict(row.get("payload") or {})
        for key, value in row.items():
            if key != "payload":
                flat[key] = value
        lines.append(coc_turn_finalization._render_public_roll(flat))
    return {
        "schema_version": 1,
        "investigator_id": investigator_id,
        "operation_id": operation_id,
        "required_roll_ids": required_ids,
        "rendered_lines": lines,
        "rendered_text": "\n".join(lines),
        "complete": not missing and bool(required_ids or not expected_ids),
        "missing_roll_ids": missing,
    }


def _write_sanity_reward_event(
    campaign_dir: Path,
    *,
    actor_id: str,
    operation_id: str,
    roll_id: str,
    source: str,
    san_before: int,
    san_after: int,
    rule_ref: Any = None,
    conclusion_id: Any = None,
) -> None:
    """Emit the canonical reward event consumed by completion/report logic."""
    record: dict[str, Any] = {
        "event_type": "reward",
        "type": "reward",
        "actor": actor_id,
        "actor_id": actor_id,
        "operation_id": operation_id,
        "reward_kind": "sanity",
        "source": source,
        "roll_id": roll_id,
        "san_before": int(san_before),
        "san_delta": int(san_after) - int(san_before),
        "san_after": int(san_after),
        "ts": _now(),
    }
    if isinstance(rule_ref, str) and rule_ref:
        record["rule_ref"] = rule_ref
    if isinstance(conclusion_id, str) and conclusion_id:
        record["conclusion_id"] = conclusion_id
    _append_jsonl(campaign_dir / "logs" / "events.jsonl", record)


def _sanity_session_for_reward(
    campaign_dir: Path,
    investigator_id: str,
    *,
    rng: random.Random,
) -> Any:
    """Load authoritative SAN, seeding a missing snapshot from campaign state."""
    if coc_sanity.sanity_snapshot_path(campaign_dir, investigator_id).is_file():
        return coc_sanity.SanitySession.load(
            campaign_dir, investigator_id, rng=rng
        )

    inv_path = (
        campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    )
    inv_state = _read_object(inv_path)
    if inv_state.get("investigator_id") != investigator_id:
        raise RuntimeOperationError(
            "investigator-state identity does not match development investigator"
        )
    character_path = (
        campaign_dir.parents[1] / "investigators" / investigator_id / "character.json"
    )
    character = read_development_guarded_character(
        campaign_dir, investigator_id, character_path
    )
    characteristics = (
        character.get("characteristics")
        if isinstance(character.get("characteristics"), dict) else {}
    )
    skills = character.get("skills") if isinstance(character.get("skills"), dict) else {}
    derived = character.get("derived") if isinstance(character.get("derived"), dict) else {}
    cm_value = inv_state.get("cm_value", skills.get("Cthulhu Mythos", 0))
    current_san = inv_state.get(
        "current_san", derived.get("SAN", characteristics.get("POW"))
    )
    int_value = characteristics.get("INT", 50)
    if (
        isinstance(cm_value, bool) or not isinstance(cm_value, int)
        or not 0 <= cm_value <= 99
        or isinstance(current_san, bool) or not isinstance(current_san, int)
        or not 0 <= current_san <= 99
        or isinstance(int_value, bool) or not isinstance(int_value, int)
        or not 0 <= int_value <= 150
    ):
        raise RuntimeOperationError("invalid investigator SAN seed state")
    san_max = inv_state.get("max_san", 99 - cm_value)
    if (
        isinstance(san_max, bool) or not isinstance(san_max, int)
        or not 0 <= san_max <= 99
        or current_san > san_max
    ):
        raise RuntimeOperationError("invalid investigator maximum SAN seed state")
    session = coc_sanity.SanitySession(
        investigator_id,
        san_max=san_max,
        int_value=int_value,
        rng=rng,
        campaign_dir=campaign_dir,
        cm_value=cm_value,
    )
    session.san_current = current_san
    session.day_start_san = current_san
    return session


def _tome_operation(
    *,
    workspace: Path,
    campaign_dir: Path,
    campaign_id: str,
    investigator_id: str,
    character_path: Path,
    payload: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    allowed = {
        "tome", "phase", "language_skill", "read_language_ok",
        "plot_critical", "choose_disbelief", "alone",
    }
    if set(payload) - allowed or not {"tome", "phase"} <= set(payload):
        raise RuntimeOperationError("tome.read has unsupported or missing fields")
    tome = payload.get("tome")
    phase = payload.get("phase")
    if not isinstance(tome, str) or not tome.strip():
        raise RuntimeOperationError("tome.read requires tome")
    if phase not in {"skim", "initial", "full", "research"}:
        raise RuntimeOperationError("tome.read phase must be skim|initial|full|research")
    state_path, state, character = _investigator_state(
        workspace, campaign_id, investigator_id, character_path
    )
    snapshot_path = campaign_dir / "save" / "tomes.json"
    if snapshot_path.is_file():
        existing = _read_object(snapshot_path)
        if existing.get("tome_name") != tome.strip():
            raise RuntimeOperationError(
                "another tome study is active; finish or archive it before changing tomes"
            )
        session = coc_tomes.TomeSession.load(
            campaign_dir, investigator_id, rng=rng
        )
    else:
        session = coc_tomes.TomeSession(
            investigator_id,
            tome.strip(),
            rng=rng,
            campaign_dir=campaign_dir,
            language_skill=int(payload.get("language_skill") or 0),
            read_language_ok=payload.get("read_language_ok") is True,
            plot_critical=payload.get("plot_critical") is True,
        )
    result = session.read(
        str(phase), choose_disbelief=payload.get("choose_disbelief") is True
    )
    operation_id = _operation_id("tome.read", rng)
    if result.get("blocked"):
        return {
            "schema_version": 1,
            "status": "INELIGIBLE",
            "kind": "tome.read",
            "operation_id": operation_id,
            "result": result,
            "state_refs": ["save/tomes.json"],
        }

    sanity_result: dict[str, Any] | None = None
    sanity_rolls: list[dict[str, Any]] = []
    loss_expr = result.get("san_loss_expr")
    if isinstance(loss_expr, str) and loss_expr:
        existed = coc_sanity.sanity_snapshot_exists(campaign_dir, investigator_id)
        sanity = coc_sanity.SanitySession.load(
            campaign_dir,
            investigator_id,
            int_value=int(state.get("int") or 50),
            rng=rng,
            cm_value=int(state.get("cm_value") or 0),
        )
        if not existed:
            sanity.san_current = int(state.get("current_san") or sanity.san_current)
            sanity.san_max = int(state.get("max_san") or sanity.san_max)
            sanity.day_start_san = sanity.san_current
        sanity_result = sanity.apply_direct_loss(
            f"read tome:{tome.strip()}",
            loss_expr,
            multiplier=float(result.get("san_loss_multiplier") or 1.0),
            alone=payload.get("alone") is True,
        )
        sanity_rolls = sanity.drain_pending()
        sanity.save(campaign_dir, strict_mirror=True)

    mythos_result: dict[str, Any] | None = None
    cm_gain = result.get("cm_gain")
    if isinstance(cm_gain, int) and not isinstance(cm_gain, bool) and cm_gain > 0:
        with coc_fileio.advisory_file_lock(
            _development_investigator_lock_path(campaign_dir, investigator_id),
            wait_seconds=5.0,
        ):
            marker_path = _development_active_marker_path(
                campaign_dir, investigator_id
            )
            try:
                marker = coc_development.active_development_transaction(
                    campaign_dir, investigator_id
                )
            except ValueError as exc:
                raise DevelopmentRecoveryConflict(
                    "development-writer",
                    [_journal_display_path(campaign_dir, marker_path)],
                ) from exc
            if marker is not None:
                raise DevelopmentRecoveryConflict(
                    str(marker["transaction_id"]),
                    [_journal_display_path(campaign_dir, marker_path)],
                )
            mythos_result = coc_mythos.gain_mythos_persisted(
                campaign_dir, investigator_id, amount=cm_gain
            )
            character = _read_object(character_path)
            character_skills = character.get("skills")
            if not isinstance(character_skills, dict):
                character_skills = {}
                character["skills"] = character_skills
            character_skills["Cthulhu Mythos"] = int(mythos_result["cm_after"])
            coc_fileio.write_json_atomic(
                character_path, character, indent=2, ensure_ascii=False,
                trailing_newline=True,
            )
        # Refresh the already-persisted sanity maximum after the Mythos gain.
        if sanity_result is not None:
            sanity = coc_sanity.SanitySession.load(
                campaign_dir, investigator_id, rng=rng,
                cm_value=int(mythos_result["cm_after"]),
            )
            refreshed = coc_state.load_investigator_state(
                campaign_dir, investigator_id
            )
            sanity.cm_value = int(mythos_result["cm_after"])
            sanity.san_max = int(refreshed.get("max_san") or sanity.san_max)
            sanity.san_current = int(refreshed.get("current_san") or sanity.san_current)
            sanity.save(campaign_dir, strict_mirror=True)

    for event in session.events:
        _append_jsonl(campaign_dir / "logs" / "events.jsonl", {
            "type": "tome",
            "actor": investigator_id,
            "operation_id": operation_id,
            "payload": event,
            "ts": _now(),
        })
    for index, roll in enumerate(sanity_rolls):
        if not isinstance(roll, dict) or not isinstance(roll.get("roll"), int):
            continue
        _write_public_roll(
            campaign_dir,
            command_id=f"{operation_id}:san:{index}",
            actor_id=investigator_id,
            kind="tome_san_loss",
            skill=str(roll.get("skill") or "SAN Loss"),
            roll=int(roll["roll"]),
            die=str(roll.get("die") or loss_expr or "SAN"),
            die_rolls=list(roll.get("die_rolls") or [roll["roll"]]),
            outcome=str(roll.get("outcome") or "sanity_loss"),
            extra={
                key: roll[key]
                for key in ("san_before", "san_loss", "san_after")
                if isinstance(roll.get(key), int)
            },
        )
    if phase == "research" and isinstance(result.get("roll"), dict):
        result["pending_roll_contract"] = dict(result["roll"])
    coc_fileio.write_json_atomic(
        state_path,
        coc_state.load_investigator_state(campaign_dir, investigator_id),
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    return {
        "schema_version": 1,
        "status": "PASS",
        "kind": "tome.read",
        "operation_id": operation_id,
        "result": {
            **result,
            "sanity_result": sanity_result,
            "mythos_result": mythos_result,
        },
        "state_refs": [
            "save/tomes.json",
            f"save/investigator-state/{investigator_id}.json",
            str(character_path.relative_to(workspace)),
            "logs/events.jsonl",
            "logs/rolls.jsonl",
        ],
    }


def _hazard_rolls(
    campaign_dir: Path,
    investigator_id: str,
    operation_id: str,
    kind: str,
    event: dict[str, Any],
) -> None:
    con_roll = event.get("con_roll")
    if isinstance(con_roll, dict) and isinstance(con_roll.get("roll"), int):
        _write_public_roll(
            campaign_dir,
            command_id=f"{operation_id}:con",
            actor_id=investigator_id,
            kind=kind,
            skill="CON",
            roll=int(con_roll["roll"]),
            die="1D100",
            die_rolls=[int(con_roll["roll"])],
            target=int(con_roll.get("target") or 0),
            difficulty=str(event.get("con_difficulty") or "regular"),
            outcome=str(con_roll.get("outcome") or "failure"),
        )
    damage_roll = event.get("damage_roll")
    if isinstance(damage_roll, dict) and isinstance(damage_roll.get("total"), int):
        _write_public_roll(
            campaign_dir,
            command_id=f"{operation_id}:damage",
            actor_id=investigator_id,
            kind=kind,
            skill="HP Damage",
            roll=int(damage_roll["total"]),
            die=str(damage_roll.get("expression") or event.get("damage_expr") or "damage"),
            die_rolls=[int(value) for value in damage_roll.get("rolls") or []],
            outcome="damage_applied",
            extra={
                key: int(event[key])
                for key in ("hp_before", "hp_after", "hp_delta")
                if isinstance(event.get(key), int)
            },
        )


def _hazard_operation(
    *,
    workspace: Path,
    campaign_dir: Path,
    campaign_id: str,
    investigator_id: str,
    character_path: Path,
    kind: str,
    payload: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    _state_path, participant, _character = _investigator_state(
        workspace, campaign_id, investigator_id, character_path
    )
    participant["id"] = investigator_id
    session = coc_hazards.HazardSession.load(campaign_dir, rng=rng)
    if kind == "hazard.apply":
        allowed = {"severity", "hazard_id", "damage_expr", "source", "ignore_major_wound"}
        if set(payload) - allowed or not any(
            payload.get(key) not in (None, "") for key in ("severity", "hazard_id", "damage_expr")
        ):
            raise RuntimeOperationError("hazard.apply requires severity, hazard_id, or damage_expr")
        event = session.apply_other_damage(
            participant,
            severity=payload.get("severity"),
            hazard_id=payload.get("hazard_id"),
            damage_expr=payload.get("damage_expr"),
            source=str(payload.get("source") or "environmental"),
            ignore_major_wound=payload.get("ignore_major_wound") is True,
        )
    elif kind == "hazard.suffocation.start":
        if set(payload) - {"kind", "severity", "exertion"}:
            raise RuntimeOperationError("hazard.suffocation.start has unsupported fields")
        event = session.start_suffocation(
            participant,
            kind=str(payload.get("kind") or "drowning"),
            severity=payload.get("severity"),
            exertion=payload.get("exertion") is True,
        )
    elif kind == "hazard.suffocation.tick":
        if payload:
            raise RuntimeOperationError("hazard.suffocation.tick payload must be empty")
        event = session.suffocation_round(participant)
    elif kind == "hazard.suffocation.end":
        if set(payload) - {"reason"}:
            raise RuntimeOperationError("hazard.suffocation.end has unsupported fields")
        event = session.end_suffocation(
            participant, reason=str(payload.get("reason") or "able_to_breathe")
        )
    else:
        if set(payload) - {"poison_id", "doses", "allow_critical_shake_off"}:
            raise RuntimeOperationError("hazard.poison has unsupported fields")
        poison_id = payload.get("poison_id")
        if not isinstance(poison_id, str) or not poison_id:
            raise RuntimeOperationError("hazard.poison requires poison_id")
        doses = payload.get("doses", 1)
        if isinstance(doses, bool) or not isinstance(doses, int) or doses < 1:
            raise RuntimeOperationError("hazard.poison doses must be a positive integer")
        event = session.apply_poison(
            participant,
            poison_id,
            doses=doses,
            allow_critical_shake_off=payload.get("allow_critical_shake_off") is not False,
        )
    operation_id = _operation_id(kind, rng)
    session.save(campaign_dir, participant=participant)
    session.persist_events(campaign_dir)
    _hazard_rolls(campaign_dir, investigator_id, operation_id, kind, event)
    return {
        "schema_version": 1,
        "status": "PASS",
        "kind": kind,
        "operation_id": operation_id,
        "result": event,
        "state_refs": [
            "save/hazards.json",
            f"save/investigator-state/{investigator_id}.json",
            "logs/events.jsonl",
            "logs/rolls.jsonl",
        ],
    }


def _development_transaction_paths(
    campaign_dir: Path,
    investigator_id: str,
    settlement_path: Path,
    ending: dict[str, Any] | None = None,
) -> tuple[dict[str, Path], dict[str, Path]]:
    coc_root = campaign_dir.parents[1]
    files = {
        "character": coc_root / "investigators" / investigator_id / "character.json",
        "development_events": (
            coc_root / "investigators" / investigator_id / "development.jsonl"
        ),
        "investigator_state": (
            campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
        ),
        "pacing_state": campaign_dir / "save" / "pacing-state.json",
        "sanity_investigator": coc_sanity.sanity_snapshot_path(
            campaign_dir, investigator_id
        ),
        "sanity_legacy": coc_sanity.legacy_sanity_snapshot_path(campaign_dir),
        "settlement_boundaries": (
            coc_development.settlement_boundary_ledger_path(
                campaign_dir, investigator_id
            )
        ),
        "settlement": settlement_path,
    }
    reward_path = _conclusion_reward_receipt_path(
        campaign_dir, investigator_id, ending or {}
    )
    if reward_path is not None:
        files["conclusion_reward"] = reward_path
    logs = {
        "events": campaign_dir / "logs" / "events.jsonl",
        "rolls": campaign_dir / "logs" / "rolls.jsonl",
        # Item grants settle into the shared investigator library sheet and
        # append inventory_settled receipts here; treat as append-only like
        # other development logs so the planner may change it.
        "inventory_history": (
            coc_root / "investigators" / investigator_id / "inventory-history.jsonl"
        ),
    }
    return files, logs


def _random_state_to_json(value: Any) -> Any:
    if isinstance(value, tuple):
        return [_random_state_to_json(item) for item in value]
    return value


def _random_state_from_json(value: Any) -> Any:
    if isinstance(value, list):
        return tuple(_random_state_from_json(item) for item in value)
    return value


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _file_image(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"exists": False, "text": None, "sha256": None}
    text = path.read_text(encoding="utf-8")
    return {
        "exists": True,
        "text": text,
        "sha256": _sha256_bytes(text.encode("utf-8")),
    }


def _log_image(path: Path) -> dict[str, Any]:
    value = path.read_bytes() if path.is_file() else b""
    return {
        "exists": path.is_file(),
        "size": len(value),
        "prefix_sha256": _sha256_bytes(value),
    }


def _target_kind_is_safe(coc_root: Path, path: Path) -> bool:
    """Reject links/non-regular targets and parent escapes before capture."""
    try:
        relative = path.relative_to(coc_root)
        path.resolve(strict=False).relative_to(coc_root.resolve())
    except (OSError, ValueError):
        return False
    current = coc_root
    for part in relative.parts[:-1]:
        current = current / part
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            return False
    return not path.is_symlink() and (not path.exists() or path.is_file())


def _valid_file_image(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {"exists", "text", "sha256"}:
        return False
    exists = value.get("exists")
    if not isinstance(exists, bool):
        return False
    if not exists:
        return value.get("text") is None and value.get("sha256") is None
    text = value.get("text")
    digest = value.get("sha256")
    return bool(
        isinstance(text, str)
        and isinstance(digest, str)
        and digest == _sha256_bytes(text.encode("utf-8"))
    )


def _valid_log_image(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {
        "exists", "size", "prefix_sha256"
    }:
        return False
    exists = value.get("exists")
    size = value.get("size")
    digest = value.get("prefix_sha256")
    return bool(
        isinstance(exists, bool)
        and not isinstance(size, bool)
        and isinstance(size, int)
        and size >= 0
        and isinstance(digest, str)
        and re.fullmatch(r"[0-9a-f]{64}", digest)
        and (exists or size == 0)
    )


def _valid_log_postimage(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {
        "suffix", "suffix_sha256"
    }:
        return False
    suffix = value.get("suffix")
    digest = value.get("suffix_sha256")
    return bool(
        isinstance(suffix, str)
        and isinstance(digest, str)
        and digest == _sha256_bytes(suffix.encode("utf-8"))
    )


def _development_transaction_id(ending_id: str, investigator_id: str) -> str:
    material = f"{ending_id}\0{investigator_id}".encode("utf-8")
    return "development-txn-" + hashlib.sha256(material).hexdigest()[:24]


def _development_investigator_lock_path(
    campaign_dir: Path, investigator_id: str
) -> Path:
    return (
        Path(campaign_dir).parents[1]
        / "locks"
        / "investigators"
        / investigator_id
        / ".investigator.lock"
    )


def _development_active_marker_path(
    campaign_dir: Path, investigator_id: str
) -> Path:
    return coc_development.development_active_transaction_path(
        campaign_dir, investigator_id
    )


def _claim_development_active_marker(
    *,
    campaign_dir: Path,
    investigator_id: str,
    ending_id: str,
    inflight_path: Path,
) -> dict[str, Any]:
    transaction_id = _development_transaction_id(ending_id, investigator_id)
    marker_path = _development_active_marker_path(campaign_dir, investigator_id)
    if not _target_kind_is_safe(campaign_dir.parents[1], marker_path):
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    expected = {
        "schema_version": 2,
        "status": "active",
        "transaction_id": transaction_id,
        "investigator_id": investigator_id,
        "campaign_id": _id(campaign_dir.name, "campaign_id"),
        "ending_id": ending_id,
        "inflight_ref": _journal_display_path(campaign_dir, inflight_path),
        "phase": "creating",
        "journal_sha256": None,
        "next_journal_sha256": None,
        "transition_at": None,
    }
    try:
        current = coc_development.active_development_transaction(
            campaign_dir, investigator_id
        )
    except ValueError as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        ) from exc
    if current is not None:
        identity_keys = {
            "status", "transaction_id", "investigator_id", "campaign_id",
            "ending_id", "inflight_ref",
        }
        if (
            all(current.get(key) == expected[key] for key in identity_keys)
            and current.get("schema_version") == 2
            and current.get("phase") == "creating"
        ):
            return current
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    marker = {**expected, "created_at": _now()}
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(
        marker_path,
        marker,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    return marker


def _development_journal_sha256(path: Path) -> str:
    try:
        payload = Path(path).read_bytes()
    except OSError as exc:
        raise DevelopmentRecoveryConflict(
            "development-journal",
            [str(path)],
        ) from exc
    return _sha256_bytes(payload)


def _development_marker_identity_matches(
    marker: dict[str, Any],
    *,
    campaign_dir: Path,
    investigator_id: str,
    transaction_id: str,
    inflight_path: Path,
) -> bool:
    return bool(
        marker.get("status") == "active"
        and marker.get("transaction_id") == transaction_id
        and marker.get("campaign_id") == campaign_dir.name
        and marker.get("investigator_id") == investigator_id
        and marker.get("inflight_ref")
        == _journal_display_path(campaign_dir, inflight_path)
    )


def _transition_development_active_marker(
    *,
    campaign_dir: Path,
    investigator_id: str,
    inflight_path: Path,
    transaction_id: str,
    expected_phases: set[str],
    phase: str,
    journal_sha256: str,
    next_journal_sha256: str | None = None,
    transition_at: str | None = None,
) -> dict[str, Any]:
    """CAS one durable marker phase while the investigator lock is held."""
    marker_path = _development_active_marker_path(campaign_dir, investigator_id)
    try:
        marker = coc_development.active_development_transaction(
            campaign_dir, investigator_id
        )
    except ValueError as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        ) from exc
    if marker is None or not _development_marker_identity_matches(
        marker,
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        transaction_id=transaction_id,
        inflight_path=inflight_path,
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    if marker.get("schema_version") != 2:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    current_phase = str(marker.get("phase"))
    if current_phase not in expected_phases:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    actual_digest = _development_journal_sha256(inflight_path)
    allowed_digests = {
        value for value in (
            marker.get("journal_sha256"), marker.get("next_journal_sha256")
        ) if isinstance(value, str)
    }
    if current_phase != "creating" and actual_digest not in allowed_digests:
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [
                _journal_display_path(campaign_dir, marker_path),
                _journal_display_path(campaign_dir, inflight_path),
            ],
        )
    if phase in {"journaled", "committed", "recovered"}:
        next_journal_sha256 = None
    if phase == "journaled":
        transition_at = None
    elif not isinstance(transition_at, str) or not transition_at:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    updated = {
        "schema_version": 2,
        "status": "active",
        "transaction_id": transaction_id,
        "investigator_id": investigator_id,
        "campaign_id": campaign_dir.name,
        "ending_id": str(marker["ending_id"]),
        "inflight_ref": _journal_display_path(campaign_dir, inflight_path),
        "created_at": str(marker["created_at"]),
        "phase": phase,
        "journal_sha256": journal_sha256,
        "next_journal_sha256": next_journal_sha256,
        "transition_at": transition_at,
    }
    coc_fileio.write_json_atomic(
        marker_path,
        updated,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    try:
        persisted = coc_development.active_development_transaction(
            campaign_dir, investigator_id
        )
    except ValueError as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        ) from exc
    if persisted != updated:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    return updated


def _mark_development_journal_durable(
    *,
    campaign_dir: Path,
    investigator_id: str,
    inflight_path: Path,
    transaction_id: str,
) -> dict[str, Any]:
    digest = _development_journal_sha256(inflight_path)
    return _transition_development_active_marker(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        inflight_path=inflight_path,
        transaction_id=transaction_id,
        expected_phases={"creating"},
        phase="journaled",
        journal_sha256=digest,
    )


def _release_development_active_marker(
    *,
    campaign_dir: Path,
    investigator_id: str,
    transaction_id: str,
    missing_ok: bool = True,
    expected_phases: set[str] | None = None,
) -> None:
    marker_path = _development_active_marker_path(campaign_dir, investigator_id)
    try:
        marker = coc_development.active_development_transaction(
            campaign_dir, investigator_id
        )
    except ValueError as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        ) from exc
    if marker is None:
        if missing_ok:
            return
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    if (
        marker.get("transaction_id") != transaction_id
        or marker.get("campaign_id") != campaign_dir.name
        or marker.get("investigator_id") != investigator_id
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    if marker.get("schema_version") != 2:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    marker_phase = str(marker.get("phase"))
    if expected_phases is not None and marker_phase not in expected_phases:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    marker_path.unlink()


def _write_development_journal(path: Path, journal: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(
        path,
        journal,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )


def _capture_development_inflight(
    *,
    campaign_dir: Path,
    investigator_id: str,
    ending_id: str,
    settlement_path: Path,
    inflight_path: Path,
    ending: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    files, logs = _development_transaction_paths(
        campaign_dir, investigator_id, settlement_path, ending
    )
    transaction_id = _development_transaction_id(ending_id, investigator_id)
    coc_root = campaign_dir.parents[1]
    unsafe = [
        _journal_display_path(campaign_dir, path)
        for path in [*files.values(), *logs.values()]
        if not _target_kind_is_safe(coc_root, path)
    ]
    if unsafe:
        raise DevelopmentRecoveryConflict(transaction_id, sorted(set(unsafe)))
    try:
        file_preimages = {name: _file_image(path) for name, path in files.items()}
        log_preimages = {name: _log_image(path) for name, path in logs.items()}
    except (OSError, UnicodeError) as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        ) from exc
    if not all(_valid_file_image(image) for image in file_preimages.values()):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    if not all(_valid_log_image(image) for image in log_preimages.values()):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    _claim_development_active_marker(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        ending_id=ending_id,
        inflight_path=inflight_path,
    )
    journal = {
        "schema_version": 2,
        "status": "planning",
        "transaction_id": transaction_id,
        "ending_id": ending_id,
        "investigator_id": investigator_id,
        "conclusion_reward_id": ending.get("conclusion_reward_id"),
        "rng_state": _random_state_to_json(rng.getstate()),
        "file_preimages": file_preimages,
        "log_preimages": log_preimages,
        "prepared_at": _now(),
    }
    _write_development_journal(inflight_path, journal)
    return journal


def _journal_ending(journal: dict[str, Any]) -> dict[str, Any]:
    reward_id = journal.get("conclusion_reward_id")
    return {
        "ending_id": journal.get("ending_id"),
        "conclusion_reward_id": reward_id if isinstance(reward_id, str) else None,
    }


def _journal_display_path(campaign_dir: Path, path: Path) -> str:
    try:
        return path.relative_to(campaign_dir.parents[1]).as_posix()
    except ValueError:
        return str(path)


class DevelopmentRecoveryConflict(RuntimeOperationError):
    """An incomplete settlement diverged from both owned transaction images."""

    code = "RECOVERY_CONFLICT"

    def __init__(self, transaction_id: str, conflicting_paths: list[str]):
        self.transaction_id = transaction_id
        self.conflicting_paths = list(conflicting_paths)
        joined = ", ".join(self.conflicting_paths)
        super().__init__(
            f"RECOVERY_CONFLICT {transaction_id}: foreign divergence at {joined}",
            code=self.code,
        )


def read_development_guarded_character(
    campaign_dir: Path,
    investigator_id: str,
    character_path: Path,
) -> dict[str, Any]:
    """Read shared character state while excluding incomplete settlements."""
    try:
        character = coc_investigator_guard.read_reusable_character(
            Path(campaign_dir).parents[1], investigator_id, character_path
        )
    except coc_investigator_guard.ReusableInvestigatorRecoveryConflict as exc:
        raise DevelopmentRecoveryConflict(
            exc.transaction_id,
            [_journal_display_path(Path(campaign_dir), exc.marker_path)],
        ) from exc
    except ValueError as exc:
        marker_path = _development_active_marker_path(
            Path(campaign_dir), investigator_id
        )
        if marker_path.is_file() or marker_path.is_symlink():
            raise DevelopmentRecoveryConflict(
                "development-reader",
                [_journal_display_path(Path(campaign_dir), marker_path)],
            ) from exc
        raise RuntimeOperationError(str(exc)) from exc
    try:
        coc_character.assert_unique_canonical_skills(character)
    except ValueError as exc:
        raise RuntimeOperationError(str(exc)) from exc
    return character


class DevelopmentTargetConflict(RuntimeOperationError):
    """A settlement invocation does not belong to the ending's frozen party."""

    code = "SETTLEMENT_TARGET_CONFLICT"

    def __init__(self, investigator_id: str, frozen_ids: list[str]):
        self.investigator_id = investigator_id
        self.frozen_ids = list(frozen_ids)
        super().__init__(
            "SETTLEMENT_TARGET_CONFLICT: investigator "
            f"{investigator_id!r} is not in frozen ending targets {frozen_ids!r}"
        )


def _same_file_image(current: dict[str, Any], expected: Any) -> bool:
    return (
        isinstance(expected, dict)
        and set(expected) == {"exists", "text", "sha256"}
        and current == expected
    )


def _development_marker_for_inflight(
    *,
    campaign_dir: Path,
    investigator_id: str,
    inflight_path: Path,
    transaction_id: str,
) -> dict[str, Any] | None:
    marker_path = _development_active_marker_path(campaign_dir, investigator_id)
    try:
        marker = coc_development.active_development_transaction(
            campaign_dir, investigator_id
        )
    except ValueError as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        ) from exc
    if marker is None:
        return None
    if not _development_marker_identity_matches(
        marker,
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        transaction_id=transaction_id,
        inflight_path=inflight_path,
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    return marker


def _development_marker_phase(marker: dict[str, Any] | None) -> str | None:
    if marker is None:
        return None
    if marker.get("schema_version") != 2:
        return None
    return str(marker.get("phase"))


def _recovered_development_journal(
    journal: dict[str, Any], *, recovered_at: str
) -> dict[str, Any]:
    return {
        "schema_version": 2,
        "status": "recovered",
        "transaction_id": journal["transaction_id"],
        "ending_id": journal["ending_id"],
        "investigator_id": journal["investigator_id"],
        "conclusion_reward_id": journal.get("conclusion_reward_id"),
        "rng_state": journal.get("rng_state"),
        "prepared_at": journal.get("prepared_at"),
        "recovered_at": recovered_at,
    }


def _journal_serialized_sha256(journal: dict[str, Any]) -> str:
    text = json.dumps(journal, indent=2, ensure_ascii=False) + "\n"
    return _sha256_bytes(text.encode("utf-8"))


def _recover_development_inflight(
    *,
    campaign_dir: Path,
    investigator_id: str,
    settlement_path: Path,
    inflight_path: Path,
    journal: dict[str, Any],
    dry_run: bool = False,
) -> dict[str, Any]:
    status = journal.get("status")
    transaction_id = str(journal.get("transaction_id") or "unknown-development-txn")
    marker = _development_marker_for_inflight(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        inflight_path=inflight_path,
        transaction_id=transaction_id,
    )
    marker_phase = _development_marker_phase(marker)
    journal_digest = _development_journal_sha256(inflight_path)
    if status == "recovered":
        if (
            journal.get("schema_version") != 2
            or journal.get("investigator_id") != investigator_id
            or not isinstance(journal.get("ending_id"), str)
            or journal.get("transaction_id")
            != _development_transaction_id(str(journal.get("ending_id")), investigator_id)
        ):
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, inflight_path)],
            )
        if marker is not None:
            current_digest = marker.get("journal_sha256")
            next_digest = marker.get("next_journal_sha256")
            if marker_phase == "recovering" and next_digest == journal_digest:
                if not dry_run:
                    marker = _transition_development_active_marker(
                        campaign_dir=campaign_dir,
                        investigator_id=investigator_id,
                        inflight_path=inflight_path,
                        transaction_id=transaction_id,
                        expected_phases={"recovering"},
                        phase="recovered",
                        journal_sha256=journal_digest,
                        transition_at=str(marker["transition_at"]),
                    )
                    marker_phase = "recovered"
            elif marker_phase != "recovered" or current_digest != journal_digest:
                raise DevelopmentRecoveryConflict(
                    transaction_id,
                    [
                        _journal_display_path(
                            campaign_dir,
                            _development_active_marker_path(
                                campaign_dir, investigator_id
                            ),
                        ),
                        _journal_display_path(campaign_dir, inflight_path),
                    ],
                )
        if not dry_run:
            _release_development_active_marker(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                transaction_id=transaction_id,
                expected_phases={"recovered"},
            )
        return {
            "transaction_id": transaction_id,
            "status": "RECOVERED",
            "conflicting_paths": [],
        }
    if (
        journal.get("schema_version") != 2
        or status not in {"planning", "prepared"}
        or journal.get("investigator_id") != investigator_id
        or not isinstance(journal.get("ending_id"), str)
        or journal.get("transaction_id")
        != _development_transaction_id(str(journal.get("ending_id")), investigator_id)
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    if marker_phase in {"journaled", "committed"} and (
        marker is None or marker.get("journal_sha256") != journal_digest
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [
                _journal_display_path(
                    campaign_dir,
                    _development_active_marker_path(campaign_dir, investigator_id),
                ),
                _journal_display_path(campaign_dir, inflight_path),
            ],
        )
    if marker_phase == "recovering" and (
        marker is None or marker.get("journal_sha256") != journal_digest
    ):
        # A recovering marker permits exactly the old prepared journal or the
        # deterministic recovered journal.  The latter is handled above.
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [
                _journal_display_path(
                    campaign_dir,
                    _development_active_marker_path(campaign_dir, investigator_id),
                ),
                _journal_display_path(campaign_dir, inflight_path),
            ],
        )
    if marker_phase == "recovered":
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    files, logs = _development_transaction_paths(
        campaign_dir,
        investigator_id,
        settlement_path,
        _journal_ending(journal),
    )
    file_preimages = journal.get("file_preimages")
    log_preimages = journal.get("log_preimages")
    if (
        not isinstance(file_preimages, dict)
        or set(file_preimages) != set(files)
        or not isinstance(log_preimages, dict)
        or set(log_preimages) != set(logs)
        or not all(_valid_file_image(image) for image in file_preimages.values())
        or not all(_valid_log_image(image) for image in log_preimages.values())
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )

    file_postimages = journal.get("file_postimages")
    log_postimages = journal.get("log_postimages")
    if status == "prepared" and (
        not isinstance(file_postimages, dict)
        or set(file_postimages) != set(files)
        or not isinstance(log_postimages, dict)
        or set(log_postimages) != set(logs)
        or not all(_valid_file_image(image) for image in file_postimages.values())
        or not all(
            _valid_log_postimage(image) for image in log_postimages.values()
        )
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )

    conflicts: list[str] = []
    current_files: dict[str, dict[str, Any]] = {}
    all_preimage = True
    coc_root = campaign_dir.parents[1]
    for name, path in files.items():
        preimage = file_preimages[name]
        if not _target_kind_is_safe(coc_root, path):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        try:
            current = _file_image(path)
        except (OSError, UnicodeError):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        current_files[name] = current
        is_preimage = _same_file_image(current, preimage)
        all_preimage = all_preimage and is_preimage
        owned = is_preimage
        if status == "prepared":
            owned = owned or _same_file_image(current, file_postimages[name])
        if not owned:
            conflicts.append(_journal_display_path(campaign_dir, path))

    current_log_deltas: dict[str, bytes] = {}
    for name, path in logs.items():
        preimage = log_preimages[name]
        if not isinstance(preimage, dict) or set(preimage) != {
            "exists", "size", "prefix_sha256"
        }:
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        size = preimage.get("size")
        pre_exists = preimage.get("exists")
        current_exists = path.is_file() and not path.is_symlink()
        if not _target_kind_is_safe(coc_root, path):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        try:
            current = path.read_bytes() if current_exists else b""
        except OSError:
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        if (
            not isinstance(pre_exists, bool)
            or isinstance(size, bool)
            or not isinstance(size, int)
            or size < 0
            or len(current) < size
            or _sha256_bytes(current[:size]) != preimage.get("prefix_sha256")
        ):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        delta = current[size:]
        current_log_deltas[name] = delta
        all_preimage = bool(
            all_preimage and current_exists == pre_exists and not delta
        )
        allowed_suffix = b""
        if status == "prepared":
            postimage = log_postimages[name]
            suffix = postimage.get("suffix") if isinstance(postimage, dict) else None
            if not isinstance(suffix, str):
                conflicts.append(_journal_display_path(campaign_dir, path))
                continue
            allowed_suffix = suffix.encode("utf-8")
        # Existence is part of the preimage.  The only provably owned
        # transition from absent to present is a non-empty prefix of the exact
        # planned append.  An empty created file is ambiguous (the process may
        # have crashed just after open), so fail closed instead of unlinking it.
        if status == "planning" and current_exists != pre_exists:
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        if status == "prepared" and (
            (pre_exists and not current_exists)
            or (
                not pre_exists
                and current_exists
                and not delta
            )
        ):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        if not allowed_suffix.startswith(delta):
            conflicts.append(_journal_display_path(campaign_dir, path))

    if conflicts:
        raise DevelopmentRecoveryConflict(
            transaction_id, sorted(set(conflicts))
        )

    # Schema-v2 ``creating`` proves application has not been authorized.  A
    # non-preimage target contradicts that durable phase and must remain
    # untouched.
    if marker_phase == "creating" and not all_preimage:
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [
                _journal_display_path(
                    campaign_dir,
                    _development_active_marker_path(campaign_dir, investigator_id),
                )
            ],
        )
    if marker_phase == "committed" and status != "prepared":
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, inflight_path)]
        )

    if status == "prepared":
        settlement_committed = _same_file_image(
            current_files["settlement"], file_postimages["settlement"]
        ) and not _same_file_image(
            current_files["settlement"], file_preimages["settlement"]
        )
        if settlement_committed and marker_phase != "recovering":
            if _settled_receipt_for_ending(
                settlement_path,
                str(journal["ending_id"]),
                investigator_id,
            ) is None:
                raise DevelopmentRecoveryConflict(
                    transaction_id,
                    [_journal_display_path(campaign_dir, settlement_path)],
                )
            incomplete = [
                _journal_display_path(campaign_dir, files[name])
                for name in files
                if not _same_file_image(current_files[name], file_postimages[name])
            ]
            incomplete.extend(
                _journal_display_path(campaign_dir, logs[name])
                for name in logs
                if current_log_deltas.get(name, b"")
                != str(log_postimages[name].get("suffix") or "").encode("utf-8")
            )
            if incomplete:
                raise DevelopmentRecoveryConflict(
                    transaction_id, sorted(set(incomplete))
                )
            if not dry_run:
                if marker_phase == "creating":
                    if not all_preimage:
                        raise DevelopmentRecoveryConflict(
                            transaction_id,
                            [_journal_display_path(campaign_dir, inflight_path)],
                        )
                    marker = _mark_development_journal_durable(
                        campaign_dir=campaign_dir,
                        investigator_id=investigator_id,
                        inflight_path=inflight_path,
                        transaction_id=transaction_id,
                    )
                    marker_phase = "journaled"
                if marker_phase == "journaled":
                    marker = _transition_development_active_marker(
                        campaign_dir=campaign_dir,
                        investigator_id=investigator_id,
                        inflight_path=inflight_path,
                        transaction_id=transaction_id,
                        expected_phases={"journaled"},
                        phase="committed",
                        journal_sha256=journal_digest,
                        transition_at=_now(),
                    )
                    marker_phase = "committed"
                if marker is not None and marker_phase != "committed":
                    raise DevelopmentRecoveryConflict(
                        transaction_id,
                        [_journal_display_path(campaign_dir, inflight_path)],
                    )
                _release_development_active_marker(
                    campaign_dir=campaign_dir,
                    investigator_id=investigator_id,
                    transaction_id=transaction_id,
                    expected_phases={"committed"},
                )
                inflight_path.unlink(missing_ok=True)
            return {
                "transaction_id": transaction_id,
                "status": "COMMITTED",
                "conflicting_paths": [],
            }

    # All current images have been proven to be either the exact prepared
    # preimage or an exact settlement-owned intermediate/postimage.  Validate
    # every target before this point, then roll back as one recovery action.
    if dry_run:
        return {
            "transaction_id": transaction_id,
            "status": "WOULD_ROLL_BACK",
            "conflicting_paths": [],
        }
    if marker is None:
        marker = _claim_development_active_marker(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            ending_id=str(journal["ending_id"]),
            inflight_path=inflight_path,
        )
        marker_phase = _development_marker_phase(marker)
    if marker_phase == "creating":
        _mark_development_journal_durable(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            inflight_path=inflight_path,
            transaction_id=transaction_id,
        )
        marker_phase = "journaled"
    if marker_phase == "journaled":
        recovered_at = _now()
        recovered = _recovered_development_journal(
            journal, recovered_at=recovered_at
        )
        recovered_digest = _journal_serialized_sha256(recovered)
        marker = _transition_development_active_marker(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            inflight_path=inflight_path,
            transaction_id=transaction_id,
            expected_phases={"journaled"},
            phase="recovering",
            journal_sha256=journal_digest,
            next_journal_sha256=recovered_digest,
            transition_at=recovered_at,
        )
        marker_phase = "recovering"
    elif marker_phase == "recovering":
        assert marker is not None
        recovered_at = str(marker["transition_at"])
        recovered = _recovered_development_journal(
            journal, recovered_at=recovered_at
        )
        recovered_digest = _journal_serialized_sha256(recovered)
        if recovered_digest != marker.get("next_journal_sha256"):
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, inflight_path)],
            )
    else:
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    for name, path in files.items():
        preimage = file_preimages[name]
        if preimage["exists"] is True:
            coc_fileio.write_text_atomic(path, str(preimage["text"]))
        else:
            path.unlink(missing_ok=True)
    for name, path in logs.items():
        preimage = log_preimages[name]
        size = int(preimage["size"])
        if preimage["exists"] is True:
            with path.open("r+b") as handle:
                handle.truncate(size)
                handle.flush()
                os.fsync(handle.fileno())
        else:
            path.unlink(missing_ok=True)
    _write_development_journal(inflight_path, recovered)
    marker = _transition_development_active_marker(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        inflight_path=inflight_path,
        transaction_id=transaction_id,
        expected_phases={"recovering"},
        phase="recovered",
        journal_sha256=recovered_digest,
        transition_at=recovered_at,
    )
    _release_development_active_marker(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        transaction_id=transaction_id,
        expected_phases={"recovered"},
    )
    return {
        "transaction_id": transaction_id,
        "status": "ROLLED_BACK",
        "conflicting_paths": [],
    }


def _validate_development_journal_structure(
    *,
    campaign_dir: Path,
    inflight_path: Path,
    journal: dict[str, Any],
) -> tuple[str, str, Path]:
    investigator_id = journal.get("investigator_id")
    ending_id = journal.get("ending_id")
    transaction_id = journal.get("transaction_id")
    if (
        not isinstance(investigator_id, str)
        or _SAFE_ID.fullmatch(investigator_id) is None
        or not isinstance(ending_id, str)
        or _SAFE_ID.fullmatch(ending_id) is None
        or transaction_id != _development_transaction_id(ending_id, investigator_id)
        or journal.get("schema_version") != 2
        or journal.get("status") not in {"planning", "prepared", "recovered"}
    ):
        raise DevelopmentRecoveryConflict(
            str(transaction_id or "unknown-development-txn"),
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    settlement_path = coc_development.ending_settlement_path(
        campaign_dir, ending_id, investigator_id
    )
    canonical_inflight = settlement_path.with_name(f"{investigator_id}.inflight.json")
    if (
        inflight_path != canonical_inflight
        or not _target_kind_is_safe(campaign_dir.parents[1], inflight_path)
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    if journal.get("status") == "recovered":
        return investigator_id, ending_id, settlement_path
    files, logs = _development_transaction_paths(
        campaign_dir,
        investigator_id,
        settlement_path,
        _journal_ending(journal),
    )
    file_preimages = journal.get("file_preimages")
    log_preimages = journal.get("log_preimages")
    if (
        not isinstance(file_preimages, dict)
        or set(file_preimages) != set(files)
        or not all(_valid_file_image(image) for image in file_preimages.values())
        or not isinstance(log_preimages, dict)
        or set(log_preimages) != set(logs)
        or not all(_valid_log_image(image) for image in log_preimages.values())
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    if journal.get("status") == "prepared":
        file_postimages = journal.get("file_postimages")
        log_postimages = journal.get("log_postimages")
        if (
            not isinstance(file_postimages, dict)
            or set(file_postimages) != set(files)
            or not all(_valid_file_image(image) for image in file_postimages.values())
            or not isinstance(log_postimages, dict)
            or set(log_postimages) != set(logs)
            or not all(_valid_log_postimage(image) for image in log_postimages.values())
        ):
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, inflight_path)],
            )
        settlement_image = file_postimages["settlement"]
        if settlement_image.get("exists") is not True:
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, settlement_path)],
            )
        try:
            planned = json.loads(str(settlement_image["text"]))
        except json.JSONDecodeError as exc:
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, settlement_path)],
            ) from exc
        if _settled_receipt_from_value(
            planned, ending_id, investigator_id
        ) is None:
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, settlement_path)],
            )
    return investigator_id, ending_id, settlement_path


def _campaign_reusable_investigator_ids(campaign_dir: Path) -> set[str]:
    """Return safe reusable actors this campaign may read through canonical APIs."""
    values: set[str] = set()
    party_path = campaign_dir / "party.json"
    if party_path.is_file() and not party_path.is_symlink():
        try:
            party = _read_object(party_path)
        except RuntimeOperationError:
            party = {}
        for item in party.get("investigator_ids") or []:
            if isinstance(item, str) and _SAFE_ID.fullmatch(item):
                values.add(item)
    state_root = campaign_dir / "save" / "investigator-state"
    if state_root.is_dir() and not state_root.is_symlink():
        for path in state_root.glob("*.json"):
            candidate = path.stem
            if not path.is_symlink() and _SAFE_ID.fullmatch(candidate):
                values.add(candidate)
    return values


def recover_development_transactions(campaign_dir: Path | str) -> list[dict[str, Any]]:
    """Recover every incomplete settlement under the caller's campaign lock.

    Canonical toolbox/runtime entry points call this before their own reads or
    writes.  Foreign divergence is fail-closed and non-destructive.
    """
    campaign_dir = Path(campaign_dir)
    root = campaign_dir / "save" / "development-settlements"
    paths = sorted(root.rglob("*.inflight.json")) if root.is_dir() else []
    loaded: list[tuple[Path, dict[str, Any], str, str, Path]] = []
    conflicts: list[str] = []
    seen_transactions: dict[str, Path] = {}
    for inflight_path in paths:
        try:
            journal = _read_object(inflight_path)
            investigator_id, ending_id, settlement_path = (
                _validate_development_journal_structure(
                    campaign_dir=campaign_dir,
                    inflight_path=inflight_path,
                    journal=journal,
                )
            )
        except (OSError, RuntimeOperationError, UnicodeError) as exc:
            if isinstance(exc, DevelopmentRecoveryConflict):
                conflicts.extend(exc.conflicting_paths)
            else:
                conflicts.append(_journal_display_path(campaign_dir, inflight_path))
            continue
        transaction_id = str(journal["transaction_id"])
        prior_path = seen_transactions.get(transaction_id)
        if prior_path is not None:
            conflicts.extend([
                _journal_display_path(campaign_dir, prior_path),
                _journal_display_path(campaign_dir, inflight_path),
            ])
        else:
            seen_transactions[transaction_id] = inflight_path
        loaded.append((
            inflight_path, journal, investigator_id, ending_id, settlement_path
        ))
    if conflicts:
        raise DevelopmentRecoveryConflict(
            "development-recovery-set", sorted(set(conflicts))
        )

    recovered: list[dict[str, Any]] = []
    lock_ids = _campaign_reusable_investigator_ids(campaign_dir) | {
        item[2] for item in loaded
    }
    if not lock_ids and not loaded:
        return []
    with ExitStack() as locks:
        # The caller already owns exactly this campaign lock.  Reusable locks
        # are always acquired once, in sorted order, and no foreign campaign
        # lock is ever acquired behind them.
        for investigator_id in sorted(lock_ids):
            locks.enter_context(coc_fileio.advisory_file_lock(
                _development_investigator_lock_path(campaign_dir, investigator_id),
                wait_seconds=5.0,
            ))
        loaded_by_inflight = {item[0]: item for item in loaded}
        orphan_markers: list[tuple[str, str]] = []
        marker_conflicts: list[str] = []
        for investigator_id in sorted(lock_ids):
            marker_path = _development_active_marker_path(
                campaign_dir, investigator_id
            )
            try:
                marker = coc_development.active_development_transaction(
                    campaign_dir, investigator_id
                )
            except ValueError:
                marker_conflicts.append(
                    _journal_display_path(campaign_dir, marker_path)
                )
                continue
            if marker is None:
                continue
            transaction_id = str(marker["transaction_id"])
            if marker.get("campaign_id") != campaign_dir.name:
                # Only the origin campaign may inspect/recover its journal.
                # The foreign caller returns without touching canonical state.
                raise DevelopmentRecoveryConflict(
                    transaction_id,
                    [_journal_display_path(campaign_dir, marker_path)],
                )
            ref = Path(str(marker.get("inflight_ref") or ""))
            referenced = campaign_dir.parents[1] / ref
            loaded_item = loaded_by_inflight.get(referenced)
            if (
                ref.is_absolute()
                or ".." in ref.parts
                or not _target_kind_is_safe(campaign_dir.parents[1], referenced)
            ):
                marker_conflicts.append(
                    _journal_display_path(campaign_dir, marker_path)
                )
            elif loaded_item is None:
                # Only a schema-v2 creating marker proves application was never
                # authorized.  Legacy, journaled, recovering, recovered, and
                # committed markers without their fingerprinted journal are
                # preserved fail-closed.
                if (
                    marker.get("schema_version") == 2
                    and marker.get("phase") == "creating"
                ):
                    orphan_markers.append((investigator_id, transaction_id))
                else:
                    marker_conflicts.append(
                        _journal_display_path(campaign_dir, marker_path)
                    )
            elif (
                str(loaded_item[1].get("transaction_id")) != transaction_id
                or loaded_item[2] != investigator_id
            ):
                marker_conflicts.extend([
                    _journal_display_path(campaign_dir, marker_path),
                    _journal_display_path(campaign_dir, referenced),
                ])
        if marker_conflicts:
            raise DevelopmentRecoveryConflict(
                "development-recovery-set", sorted(set(marker_conflicts))
            )
        # Validate the entire immutable journal set again while all shared
        # investigator locks are held. No canonical target has changed yet.
        for inflight_path, journal, investigator_id, _ending_id, settlement_path in loaded:
            current = _read_object(inflight_path)
            if current != journal:
                raise DevelopmentRecoveryConflict(
                    "development-recovery-set",
                    [_journal_display_path(campaign_dir, inflight_path)],
                )
            _validate_development_journal_structure(
                campaign_dir=campaign_dir,
                inflight_path=inflight_path,
                journal=current,
            )
        # More than one active journal cannot be produced by the canonical
        # campaign-locked path.  They also share append logs and pacing/SAN
        # mirrors, so applying one rollback could invalidate a later journal
        # after the set-level check.  Reject the overlapping set before any
        # mutation instead of attempting an order-dependent partial recovery.
        target_owners: dict[Path, tuple[str, Path]] = {}
        overlap_conflicts: list[str] = []
        for inflight_path, journal, investigator_id, _ending_id, settlement_path in loaded:
            if journal.get("status") == "recovered":
                continue
            files, logs = _development_transaction_paths(
                campaign_dir,
                investigator_id,
                settlement_path,
                _journal_ending(journal),
            )
            transaction_id = str(journal["transaction_id"])
            for target in [*files.values(), *logs.values()]:
                prior = target_owners.get(target)
                if prior is None:
                    target_owners[target] = (transaction_id, inflight_path)
                    continue
                if prior[0] != transaction_id:
                    overlap_conflicts.extend([
                        _journal_display_path(campaign_dir, prior[1]),
                        _journal_display_path(campaign_dir, inflight_path),
                        _journal_display_path(campaign_dir, target),
                    ])
        if overlap_conflicts:
            raise DevelopmentRecoveryConflict(
                "development-recovery-set", sorted(set(overlap_conflicts))
            )
        # Validate every journal against the same locked filesystem snapshot.
        # Only after every dry run succeeds may any rollback/cleanup begin.
        for inflight_path, journal, investigator_id, _ending_id, settlement_path in loaded:
            _recover_development_inflight(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                settlement_path=settlement_path,
                inflight_path=inflight_path,
                journal=journal,
                dry_run=True,
            )
        # No journal or marker in the locked set conflicts.  Origin-only orphan
        # cleanup is now safe and cannot expose another campaign's partial state.
        for investigator_id, transaction_id in orphan_markers:
            _release_development_active_marker(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                transaction_id=transaction_id,
                missing_ok=False,
                expected_phases={"creating"},
            )
        for inflight_path, journal, investigator_id, _ending_id, settlement_path in loaded:
            recovered.append(_recover_development_inflight(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                settlement_path=settlement_path,
                inflight_path=inflight_path,
                journal=journal,
            ))
    return recovered


def _copy_transaction_input(source: Path, target: Path) -> None:
    if not source.is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def _tree_file_hashes(root: Path) -> dict[str, str]:
    if not root.is_dir():
        return {}
    return {
        path.relative_to(root).as_posix(): _sha256_bytes(path.read_bytes())
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def _plan_development_postimages(
    *,
    campaign_dir: Path,
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
    settlement_path: Path,
    ending: dict[str, Any],
    boundary: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    files, logs = _development_transaction_paths(
        campaign_dir, investigator_id, settlement_path, ending
    )
    coc_root = campaign_dir.parents[1]
    with tempfile.TemporaryDirectory(prefix="coc-development-plan-") as tmp:
        sandbox_coc_root = Path(tmp) / ".coc"
        sandbox_campaign = sandbox_coc_root / "campaigns" / campaign_dir.name

        for source in [
            campaign_dir / "campaign.json",
            campaign_dir / "party.json",
            campaign_dir / "scenario" / "story-graph.json",
            campaign_dir / "scenario" / "module-meta.json",
            campaign_dir / "save" / "combat.json",
            *files.values(),
            *logs.values(),
        ]:
            try:
                relative = source.relative_to(coc_root)
            except ValueError as exc:
                raise RuntimeOperationError(
                    "development transaction target escaped .coc"
                ) from exc
            _copy_transaction_input(source, sandbox_coc_root / relative)

        try:
            settlement_relative = settlement_path.relative_to(campaign_dir)
        except ValueError as exc:
            raise RuntimeOperationError(
                "development settlement path escaped its campaign"
            ) from exc
        sandbox_settlement = sandbox_campaign / settlement_relative
        before_tree = _tree_file_hashes(sandbox_coc_root)
        receipt = _development_operation_body(
            campaign_dir=sandbox_campaign,
            investigator_id=investigator_id,
            payload=payload,
            rng=rng,
            ending=ending,
            settlement_path=sandbox_settlement,
            boundary=boundary,
        )
        sandbox_files, sandbox_logs = _development_transaction_paths(
            sandbox_campaign,
            investigator_id,
            sandbox_settlement,
            ending,
        )
        after_tree = _tree_file_hashes(sandbox_coc_root)
        allowed_changes = {
            path.relative_to(sandbox_coc_root).as_posix()
            for path in [*sandbox_files.values(), *sandbox_logs.values()]
        }
        # Guarded shared-character reads create only the persistent lock inode
        # in the isolated planner.  It carries no game state and is not copied
        # back as a transaction postimage.
        allowed_changes.add(
            _development_investigator_lock_path(
                sandbox_campaign, investigator_id
            ).relative_to(sandbox_coc_root).as_posix()
        )
        unexpected_changes = sorted(
            relative
            for relative in set(before_tree) | set(after_tree)
            if before_tree.get(relative) != after_tree.get(relative)
            and relative not in allowed_changes
        )
        if unexpected_changes:
            raise RuntimeOperationError(
                "development planning changed untracked paths: "
                + ", ".join(unexpected_changes)
            )
        file_postimages = {
            name: _file_image(sandbox_files[name]) for name in files
        }
        log_postimages: dict[str, Any] = {}
        for name, source in logs.items():
            before = source.read_bytes() if source.is_file() else b""
            after_path = sandbox_logs[name]
            after = after_path.read_bytes() if after_path.is_file() else b""
            if not after.startswith(before):
                raise RuntimeOperationError(
                    f"development planning rewrote append-only log {name}"
                )
            suffix = after[len(before):].decode("utf-8")
            log_postimages[name] = {
                "suffix": suffix,
                "suffix_sha256": _sha256_bytes(suffix.encode("utf-8")),
            }
        return receipt, file_postimages, log_postimages


def _assert_development_preapply_cas(
    *,
    campaign_dir: Path,
    investigator_id: str,
    settlement_path: Path,
    ending: dict[str, Any],
    journal: dict[str, Any],
) -> None:
    """Validate every target against its captured preimage before any apply."""
    files, logs = _development_transaction_paths(
        campaign_dir, investigator_id, settlement_path, ending
    )
    transaction_id = str(journal.get("transaction_id") or "unknown-development-txn")
    marker = _development_marker_for_inflight(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        inflight_path=settlement_path.with_name(f"{investigator_id}.inflight.json"),
        transaction_id=transaction_id,
    )
    if (
        _development_marker_phase(marker) != "journaled"
        or marker is None
        or marker.get("journal_sha256")
        != _development_journal_sha256(
            settlement_path.with_name(f"{investigator_id}.inflight.json")
        )
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, settlement_path)],
        )
    file_preimages = journal.get("file_preimages")
    log_preimages = journal.get("log_preimages")
    file_postimages = journal.get("file_postimages")
    log_postimages = journal.get("log_postimages")
    conflicts: list[str] = []
    coc_root = campaign_dir.parents[1]
    if (
        not isinstance(file_preimages, dict)
        or set(file_preimages) != set(files)
        or not isinstance(log_preimages, dict)
        or set(log_preimages) != set(logs)
        or not isinstance(file_postimages, dict)
        or set(file_postimages) != set(files)
        or not all(
            _valid_file_image(image) for image in file_postimages.values()
        )
        or not isinstance(log_postimages, dict)
        or set(log_postimages) != set(logs)
        or not all(
            _valid_log_postimage(image) for image in log_postimages.values()
        )
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, settlement_path)],
        )
    for name, path in files.items():
        expected = file_preimages[name]
        if (
            not _target_kind_is_safe(coc_root, path)
            or not _valid_file_image(expected)
        ):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        try:
            current = _file_image(path)
        except (OSError, UnicodeError):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        if current != expected:
            conflicts.append(_journal_display_path(campaign_dir, path))
    for name, path in logs.items():
        expected = log_preimages[name]
        if (
            not _target_kind_is_safe(coc_root, path)
            or not _valid_log_image(expected)
        ):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        try:
            current = _log_image(path)
        except OSError:
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        if current != expected:
            conflicts.append(_journal_display_path(campaign_dir, path))
    if conflicts:
        raise DevelopmentRecoveryConflict(
            transaction_id, sorted(set(conflicts))
        )


def _apply_development_postimages(
    *,
    campaign_dir: Path,
    investigator_id: str,
    settlement_path: Path,
    ending: dict[str, Any],
    journal: dict[str, Any],
) -> None:
    files, logs = _development_transaction_paths(
        campaign_dir, investigator_id, settlement_path, ending
    )
    file_postimages = journal["file_postimages"]
    log_postimages = journal["log_postimages"]
    # The settlement receipt is the commit marker and is deliberately last.
    for name, path in files.items():
        if name == "settlement":
            continue
        postimage = file_postimages[name]
        if postimage["exists"] is True:
            coc_fileio.write_text_atomic(path, str(postimage["text"]))
        else:
            path.unlink(missing_ok=True)
    for name, path in logs.items():
        suffix = str(log_postimages[name]["suffix"]).encode("utf-8")
        if not suffix:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("ab") as handle:
            handle.write(suffix)
            handle.flush()
            os.fsync(handle.fileno())
    settlement_postimage = file_postimages["settlement"]
    if settlement_postimage["exists"] is not True:
        raise RuntimeOperationError("development plan lacks its settlement receipt")
    coc_fileio.write_text_atomic(
        settlement_path, str(settlement_postimage["text"])
    )


def _settled_receipt_from_value(
    settled: Any,
    ending_id: str,
    investigator_id: str,
) -> dict[str, Any] | None:
    if not isinstance(settled, dict):
        return None
    receipt = settled.get("receipt")
    result = receipt.get("result") if isinstance(receipt, dict) else None
    ending = result.get("ending_evidence") if isinstance(result, dict) else None
    refs = receipt.get("state_refs") if isinstance(receipt, dict) else None
    if (
        settled.get("schema_version") != 1
        or settled.get("ending_id") != ending_id
        or settled.get("investigator_id") != investigator_id
        or not isinstance(settled.get("settled_at"), str)
        or not isinstance(receipt, dict)
        or receipt.get("schema_version") != 1
        or receipt.get("status") != "PASS"
        or receipt.get("kind") != "development.settle"
        or not isinstance(receipt.get("operation_id"), str)
        or not isinstance(result, dict)
        or not isinstance(ending, dict)
        or ending.get("ending_id") != ending_id
        or not isinstance(refs, list)
        or f"save/investigator-state/{investigator_id}.json" not in refs
    ):
        return None
    return receipt


def _settled_receipt_for_ending(
    settlement_path: Path,
    ending_id: str,
    investigator_id: str,
) -> dict[str, Any] | None:
    if not settlement_path.is_file():
        return None
    return _settled_receipt_from_value(
        _read_object(settlement_path), ending_id, investigator_id
    )


def _settled_boundary_receipt(
    campaign_dir: Path,
    entry: dict[str, Any],
    investigator_id: str,
) -> dict[str, Any] | None:
    """Load the original receipt frozen by a settled boundary entry."""
    ref = entry.get("receipt_ref") if isinstance(entry, dict) else None
    if not isinstance(ref, str) or not ref:
        return None
    relative = Path(ref)
    if relative.is_absolute() or ".." in relative.parts:
        return None
    path = Path(campaign_dir) / relative
    if not path.is_file():
        return None
    return _settled_receipt_from_value(
        _read_object(path),
        str(entry.get("first_ending_id") or ""),
        investigator_id,
    )


def _conclusion_reward_receipt_path(
    campaign_dir: Path,
    investigator_id: str,
    ending: dict[str, Any],
) -> Path | None:
    reward_id = ending.get("conclusion_reward_id")
    if not isinstance(reward_id, str) or _SAFE_ID.fullmatch(reward_id) is None:
        return None
    return (
        campaign_dir
        / "save"
        / "development-settlements"
        / "conclusion-rewards"
        / investigator_id
        / f"{reward_id}.json"
    )


def _development_operation_body(
    *,
    campaign_dir: Path,
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
    ending: dict[str, Any],
    settlement_path: Path,
    boundary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if payload:
        raise RuntimeOperationError("development.settle payload must be empty")
    if settlement_path.is_file():
        settled = _read_object(settlement_path)
        if settled.get("ending_id") == ending["ending_id"]:
            receipt = settled.get("receipt")
            if isinstance(receipt, dict):
                return receipt
    inputs = ending.get("development_inputs")
    development_input = (
        inputs.get(investigator_id) if isinstance(inputs, dict) else None
    )
    result = coc_development.run_development_phase(
        campaign_dir,
        investigator_id,
        rng=rng,
        ending_evidence=ending,
        development_input=(
            development_input if isinstance(development_input, dict) else None
        ),
    )
    identity = hashlib.sha256(
        f"{ending['ending_id']}\0{investigator_id}".encode("utf-8")
    ).hexdigest()[:12]
    plan_digest = str(
        development_input["deterministic_plan"]["plan_sha256"]
    )[:12]
    operation_id = f"op-development-settle-{identity}-{plan_digest}"
    public_rows: list[dict[str, Any]] = []
    for index, check in enumerate(result.get("improvement_checks") or []):
        public_rows.append(_write_public_roll(
            campaign_dir,
            command_id=f"{operation_id}:check:{index}",
            actor_id=investigator_id,
            kind="development_check",
            skill=str(check["skill"]),
            roll=int(check["check_roll"]),
            die="1D100",
            die_rolls=[int(check["check_roll"])],
            target=int(check["value_before"]),
            difficulty="improvement",
            outcome="improved" if check.get("improved") else "no_improvement",
        ))
        if check.get("improved") and isinstance(check.get("gain"), int):
            public_rows.append(_write_public_roll(
                campaign_dir,
                command_id=f"{operation_id}:gain:{index}",
                actor_id=investigator_id,
                kind="development_gain",
                skill=str(check["skill"]),
                roll=int(check["gain"]),
                die="1D10",
                die_rolls=[int(check["gain"])],
                outcome="skill_increased",
            ))
    luck = result.get("luck_recovery") or {}
    if isinstance(luck.get("roll"), int):
        public_rows.append(_write_public_roll(
            campaign_dir,
            command_id=f"{operation_id}:luck-recovery",
            actor_id=investigator_id,
            kind="luck_recovery",
            skill="Luck",
            roll=int(luck["roll"]),
            die="1D100",
            die_rolls=[int(luck["roll"])],
            target=int(luck.get("luck_before", 0)),
            difficulty="improvement",
            outcome="recovered" if luck.get("success") else "no_recovery",
            extra={
                "luck_before": int(luck.get("luck_before", 0)),
                "luck_gained": int(luck.get("gained", 0)),
                "luck_after": int(luck.get("luck_after", 0)),
            },
        ))
    reward_expr = result.get("san_reward_expr")
    if isinstance(reward_expr, str) and reward_expr:
        frozen_reward = result.get("san_reward_roll")
        rolled = (
            json.loads(json.dumps(frozen_reward, ensure_ascii=False))
            if isinstance(frozen_reward, dict)
            else coc_roll.roll_expression(reward_expr, rng)
        )
        if rolled.get("expression") != reward_expr:
            raise RuntimeOperationError("frozen development SAN reward is invalid")
        sanity = _sanity_session_for_reward(
            campaign_dir, investigator_id, rng=rng
        )
        san_before = int(sanity.san_current)
        frozen_delta = result.get("san_reward_planned_delta")
        planned_delta = (
            int(frozen_delta)
            if isinstance(frozen_delta, int) and not isinstance(frozen_delta, bool)
            else int(rolled["total"])
        )
        sanity.gain_san(planned_delta, source="development")
        san_after = int(sanity.san_current)
        sanity.save(campaign_dir, strict_mirror=True)
        result["san_reward"] = {
            **rolled,
            "planned_san_before": (
                ((result.get("mechanical_baseline") or {}).get("sanity") or {}).get("current")
            ),
            "planned_san_delta": planned_delta,
            "san_before": san_before,
            "san_gained": san_after - san_before,
            "san_after": san_after,
            "san_max": int(sanity.san_max),
        }
        reward_roll_id = f"{operation_id}:san-reward"
        public_rows.append(_write_public_roll(
            campaign_dir,
            command_id=reward_roll_id,
            actor_id=investigator_id,
            kind="development_san_reward",
            skill="SAN Reward",
            roll=int(rolled["total"]),
            die=str(rolled["expression"]),
            die_rolls=[int(value) for value in rolled["rolls"]],
            outcome="sanity_reward",
            extra={
                "reward_kind": "sanity",
                "source": "development",
                "san_before": san_before,
                "planned_san_delta": planned_delta,
                "san_delta": san_after - san_before,
                "san_gained": san_after - san_before,
                "san_after": san_after,
                "san_max": int(sanity.san_max),
            },
        ))
        _write_sanity_reward_event(
            campaign_dir,
            actor_id=investigator_id,
            operation_id=operation_id,
            roll_id=reward_roll_id,
            source="development",
            san_before=san_before,
            san_after=san_after,
        )
    scenario_reward_expr = result.get("scenario_san_reward_expr")
    if isinstance(scenario_reward_expr, str) and scenario_reward_expr:
        reward_receipt_path = _conclusion_reward_receipt_path(
            campaign_dir, investigator_id, ending
        )
        prior_reward: dict[str, Any] | None = None
        if reward_receipt_path is not None and reward_receipt_path.is_file():
            candidate = _read_object(reward_receipt_path)
            if (
                candidate.get("investigator_id") != investigator_id
                or candidate.get("conclusion_reward_id")
                != ending.get("conclusion_reward_id")
                or candidate.get("conclusion_id") != ending.get("conclusion_id")
                or candidate.get("expression") != scenario_reward_expr
                or not isinstance(candidate.get("reward"), dict)
            ):
                raise RuntimeOperationError(
                    "conclusion reward receipt identity is invalid"
                )
            prior_reward = candidate
        if prior_reward is not None:
            result["scenario_san_reward"] = {
                **prior_reward["reward"],
                "replayed": True,
            }
            result["scenario_san_reward_applied"] = False
            result["scenario_san_reward_receipt"] = {
                "conclusion_reward_id": prior_reward["conclusion_reward_id"],
                "original_ending_id": prior_reward["ending_id"],
                "roll_id": prior_reward["roll_id"],
            }
        else:
            if reward_receipt_path is None:
                raise RuntimeOperationError(
                    "scenario conclusion reward lacks a durable identity"
                )
            frozen_reward = result.get("scenario_san_reward_roll")
            rolled = (
                json.loads(json.dumps(frozen_reward, ensure_ascii=False))
                if isinstance(frozen_reward, dict)
                else coc_roll.roll_expression(scenario_reward_expr, rng)
            )
            if rolled.get("expression") != scenario_reward_expr:
                raise RuntimeOperationError("frozen scenario SAN reward is invalid")
            sanity = _sanity_session_for_reward(
                campaign_dir, investigator_id, rng=rng
            )
            san_before = int(sanity.san_current)
            frozen_delta = result.get("scenario_san_reward_planned_delta")
            planned_delta = (
                int(frozen_delta)
                if isinstance(frozen_delta, int)
                and not isinstance(frozen_delta, bool)
                else int(rolled["total"])
            )
            sanity.gain_san(planned_delta, source="scenario_conclusion")
            san_after = int(sanity.san_current)
            sanity.save(campaign_dir, strict_mirror=True)
            baseline_sanity = (
                (result.get("mechanical_baseline") or {}).get("sanity") or {}
            )
            planned_san_before = baseline_sanity.get("current")
            baseline_max = baseline_sanity.get("max")
            development_planned_delta = result.get("san_reward_planned_delta")
            if (
                isinstance(planned_san_before, int)
                and not isinstance(planned_san_before, bool)
                and isinstance(baseline_max, int)
                and not isinstance(baseline_max, bool)
                and isinstance(development_planned_delta, int)
                and not isinstance(development_planned_delta, bool)
            ):
                planned_san_before = min(
                    baseline_max,
                    planned_san_before + max(0, development_planned_delta),
                )
            reward_result = {
                **rolled,
                "planned_san_before": planned_san_before,
                "planned_san_delta": planned_delta,
                "san_before": san_before,
                "san_gained": san_after - san_before,
                "san_after": san_after,
                "san_max": int(sanity.san_max),
            }
            result["scenario_san_reward"] = reward_result
            result["scenario_san_reward_applied"] = True
            scenario_reward_roll_id = f"{operation_id}:scenario-san-reward"
            public_rows.append(_write_public_roll(
                campaign_dir,
                command_id=scenario_reward_roll_id,
                actor_id=investigator_id,
                kind="scenario_san_reward",
                skill="SAN Reward",
                roll=int(rolled["total"]),
                die=str(rolled["expression"]),
                die_rolls=[int(value) for value in rolled["rolls"]],
                outcome="sanity_reward",
                extra={
                    "reward_kind": "sanity",
                    "source": "conclusion_rewards",
                    "conclusion_id": ending.get("conclusion_id"),
                    "conclusion_reward_id": ending.get("conclusion_reward_id"),
                    "rule_ref": ending.get("scenario_san_reward_rule_ref"),
                    "san_before": san_before,
                    "planned_san_delta": planned_delta,
                    "san_delta": san_after - san_before,
                    "san_gained": san_after - san_before,
                    "san_after": san_after,
                    "san_max": int(sanity.san_max),
                },
            ))
            _write_sanity_reward_event(
                campaign_dir,
                actor_id=investigator_id,
                operation_id=operation_id,
                roll_id=scenario_reward_roll_id,
                source="conclusion_rewards",
                san_before=san_before,
                san_after=san_after,
                rule_ref=ending.get("scenario_san_reward_rule_ref"),
                conclusion_id=ending.get("conclusion_id"),
            )
            reward_receipt = {
                "schema_version": 1,
                "conclusion_reward_id": ending["conclusion_reward_id"],
                "scenario_id": ending.get("scenario_id"),
                "conclusion_id": ending.get("conclusion_id"),
                "investigator_id": investigator_id,
                "ending_id": ending["ending_id"],
                "conclusion_evidence": ending.get("conclusion_evidence"),
                "expression": scenario_reward_expr,
                "roll_id": scenario_reward_roll_id,
                "reward": reward_result,
                "applied_at": _now(),
            }
            reward_receipt_path.parent.mkdir(parents=True, exist_ok=True)
            coc_fileio.write_json_atomic(
                reward_receipt_path,
                reward_receipt,
                indent=2,
                ensure_ascii=False,
                trailing_newline=True,
            )
            result["scenario_san_reward_receipt"] = {
                "conclusion_reward_id": ending["conclusion_reward_id"],
                "original_ending_id": ending["ending_id"],
                "roll_id": scenario_reward_roll_id,
            }
    player_facing = _compose_development_player_facing(
        investigator_id=investigator_id,
        operation_id=operation_id,
        result=result,
        public_rows=public_rows,
    )
    if not player_facing["complete"]:
        raise RuntimeOperationError(
            "development public checks missing from final player output: "
            + ", ".join(player_facing["missing_roll_ids"])
        )
    result["player_facing_mechanics"] = player_facing
    if boundary is not None and boundary.get("boundary_id"):
        result["settlement_boundary"] = {
            "boundary_id": str(boundary["boundary_id"]),
            "session_ids": [
                str(item) for item in boundary.get("session_ids") or []
            ],
            "settlement_types": list(coc_development.SETTLEMENT_TYPES),
        }
    _append_jsonl(campaign_dir / "logs" / "events.jsonl", {
        "type": "development",
        "actor": investigator_id,
        "operation_id": operation_id,
        "payload": result,
        "ts": _now(),
    })
    receipt = {
        "schema_version": 1,
        "status": "PASS",
        "kind": "development.settle",
        "operation_id": operation_id,
        "result": result,
        "player_facing_mechanics": player_facing,
        "state_refs": [
            f"save/investigator-state/{investigator_id}.json",
            (
                "save/development-settlements/endings/"
                f"{ending['ending_id']}/{investigator_id}.json"
            ),
            (
                "save/development-settlements/boundaries/"
                f"{investigator_id}.json"
            ),
            f"../../investigators/{investigator_id}/character.json",
            "logs/events.jsonl",
            "logs/rolls.jsonl",
        ],
    }
    if coc_sanity.sanity_snapshot_path(campaign_dir, investigator_id).is_file():
        receipt["state_refs"].append(
            f"save/sanity-state/{investigator_id}.json"
        )
    reward_receipt_path = _conclusion_reward_receipt_path(
        campaign_dir, investigator_id, ending
    )
    if reward_receipt_path is not None and reward_receipt_path.is_file():
        receipt["state_refs"].append(
            reward_receipt_path.relative_to(campaign_dir).as_posix()
        )
    settlement_path.parent.mkdir(parents=True, exist_ok=True)
    settled_at = _now()
    coc_fileio.write_json_atomic(
        settlement_path,
        {
            "schema_version": 1,
            "ending_id": ending["ending_id"],
            "investigator_id": investigator_id,
            "settled_at": settled_at,
            "receipt": receipt,
        },
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    if boundary is not None and boundary.get("boundary_id"):
        coc_development.record_settlement_boundary(
            campaign_dir,
            investigator_id,
            boundary_id=str(boundary["boundary_id"]),
            session_ids=[
                str(item) for item in boundary.get("session_ids") or []
            ],
            ending_id=str(ending["ending_id"]),
            operation_id=operation_id,
            receipt_ref=settlement_path.relative_to(campaign_dir).as_posix(),
            settled_at=settled_at,
        )
    return receipt


def _development_operation_locked(
    *,
    campaign_dir: Path,
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
    ending_id: str | None = None,
) -> dict[str, Any]:
    """Run one crash-recoverable development transaction.

    The completed settlement receipt is the commit marker.  Canonical changes
    are first computed in an isolated mirror; the durable journal then records
    exact pre/post images and append-only suffixes before any canonical write.
    Restart recovery touches state only when every current target is provably
    transaction-owned.  Foreign divergence remains intact and produces a typed
    recovery conflict.
    """
    if payload:
        raise RuntimeOperationError("development.settle payload must be empty")
    ending = coc_development.structured_ending_evidence(
        campaign_dir, ending_id=ending_id
    )
    if ending is None:
        raise RuntimeOperationError(
            "development.settle requires a persisted state.end_session receipt"
        )
    frozen_ids = ending.get("investigator_ids")
    if isinstance(frozen_ids, list) and investigator_id not in frozen_ids:
        raise DevelopmentTargetConflict(investigator_id, frozen_ids)
    exact_ending_id = str(ending["ending_id"])
    settlement_path = coc_development.ending_settlement_path(
        campaign_dir, exact_ending_id, investigator_id
    )
    inflight_path = settlement_path.with_name(f"{investigator_id}.inflight.json")
    coc_root = campaign_dir.parents[1]
    unsafe_paths = [
        _journal_display_path(campaign_dir, path)
        for path in (settlement_path, inflight_path)
        if not _target_kind_is_safe(coc_root, path)
    ]
    if unsafe_paths:
        raise DevelopmentRecoveryConflict(
            _development_transaction_id(exact_ending_id, investigator_id),
            sorted(set(unsafe_paths)),
        )
    unsupported_base_receipt = (
        campaign_dir / "save" / "development-settlements"
        / f"{investigator_id}.json"
    )
    if unsupported_base_receipt.exists() or unsupported_base_receipt.is_symlink():
        raise RuntimeOperationError(
            "unsupported base-layout development settlement receipt"
        )

    journal: dict[str, Any] | None = None
    if inflight_path.is_file():
        journal = _read_object(inflight_path)
        if journal.get("status") != "recovered":
            _recover_development_inflight(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                settlement_path=settlement_path,
                inflight_path=inflight_path,
                journal=journal,
            )
            journal = _read_object(inflight_path) if inflight_path.is_file() else None
        if journal is not None and journal.get("status") == "recovered":
            if journal.get("ending_id") == exact_ending_id:
                try:
                    rng.setstate(_random_state_from_json(journal.get("rng_state")))
                except (TypeError, ValueError) as exc:
                    raise RuntimeOperationError(
                        "development settlement journal RNG state is invalid"
                    ) from exc
            else:
                raise DevelopmentRecoveryConflict(
                    str(journal.get("transaction_id") or "unknown-development-txn"),
                    [_journal_display_path(campaign_dir, inflight_path)],
                )

    receipt = _settled_receipt_for_ending(
        settlement_path, exact_ending_id, investigator_id
    )
    if receipt is not None:
        _release_development_active_marker(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            transaction_id=_development_transaction_id(
                exact_ending_id, investigator_id
            ),
        )
        inflight_path.unlink(missing_ok=True)
        return receipt
    if settlement_path.is_file():
        raise RuntimeOperationError(
            "existing exact development settlement receipt is invalid"
        )

    try:
        boundary = coc_development.settlement_boundary_decision(
            campaign_dir, ending, investigator_id
        )
    except ValueError as exc:
        raise RuntimeOperationError(str(exc)) from exc
    replay_boundary = boundary.get("replay")
    if replay_boundary is not None:
        # One settlement per (session, investigator, settlement_type): this
        # ending closes an already-settled boundary, so replay the original
        # receipt without new rolls or state diffs.
        replay_receipt = _settled_boundary_receipt(
            campaign_dir, replay_boundary, investigator_id
        )
        if replay_receipt is None:
            raise RuntimeOperationError(
                "canonical settlement boundary receipt is invalid"
            )
        replay = dict(replay_receipt)
        replay["replayed"] = True
        replay["replayed_from_boundary_id"] = replay_boundary.get("boundary_id")
        replay["replayed_from_ending_id"] = replay_boundary.get("first_ending_id")
        return replay

    journal = _capture_development_inflight(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        ending_id=exact_ending_id,
        settlement_path=settlement_path,
        inflight_path=inflight_path,
        ending=ending,
        rng=rng,
    )

    try:
        receipt, file_postimages, log_postimages = _plan_development_postimages(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            payload=payload,
            rng=rng,
            settlement_path=settlement_path,
            ending=ending,
            boundary=boundary,
        )
        journal["status"] = "prepared"
        journal["file_postimages"] = file_postimages
        journal["log_postimages"] = log_postimages
        journal["planned_at"] = _now()
        _write_development_journal(inflight_path, journal)
        # Apply only the exact durable journal image that restart recovery
        # would observe; this catches torn/corrupted per-image data before any
        # canonical target changes.
        journal = _read_object(inflight_path)
        marker = _mark_development_journal_durable(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            inflight_path=inflight_path,
            transaction_id=str(journal["transaction_id"]),
        )
        _assert_development_preapply_cas(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            settlement_path=settlement_path,
            ending=ending,
            journal=journal,
        )
        _apply_development_postimages(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            settlement_path=settlement_path,
            ending=ending,
            journal=journal,
        )
        _transition_development_active_marker(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            inflight_path=inflight_path,
            transaction_id=str(journal["transaction_id"]),
            expected_phases={"journaled"},
            phase="committed",
            journal_sha256=_development_journal_sha256(inflight_path),
            transition_at=_now(),
        )
    except Exception:
        if inflight_path.is_file():
            current_journal = _read_object(inflight_path)
            _recover_development_inflight(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                settlement_path=settlement_path,
                inflight_path=inflight_path,
                journal=current_journal,
            )
            inflight_path.unlink(missing_ok=True)
        raise
    _release_development_active_marker(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        transaction_id=_development_transaction_id(
            exact_ending_id, investigator_id
        ),
        expected_phases={"committed"},
    )
    inflight_path.unlink(missing_ok=True)
    return receipt


def _development_operation(
    *,
    campaign_dir: Path,
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
    ending_id: str | None = None,
) -> dict[str, Any]:
    """Serialize shared investigator files after the caller's campaign lock."""
    with coc_fileio.advisory_file_lock(
        _development_investigator_lock_path(campaign_dir, investigator_id),
        wait_seconds=5.0,
    ):
        return _development_operation_locked(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            payload=payload,
            rng=rng,
            ending_id=ending_id,
        )


def settle_development(
    campaign_dir: Path | str,
    investigator_id: str,
    *,
    rng: random.Random | None = None,
    ending_id: str | None = None,
) -> dict[str, Any]:
    """Shared settlement entry for an already campaign-locked host/tool.

    Top-level hosts should continue to use :func:`execute_operation`, which
    acquires the campaign lock.  The canonical toolbox already owns that lock,
    so its post-ending finalizer calls this narrow entry; this helper then
    acquires only the shared investigator lock in the fixed second position.
    """
    return _development_operation(
        campaign_dir=Path(campaign_dir),
        investigator_id=_id(investigator_id, "investigator_id"),
        payload={},
        rng=rng or random.Random(),
        ending_id=ending_id,
    )


def _campaign_summaries(workspace: Path) -> list[dict[str, Any]]:
    campaigns = workspace / ".coc" / "campaigns"
    if not campaigns.is_dir():
        return []
    values: list[dict[str, Any]] = []
    for child in sorted(campaigns.iterdir(), key=lambda item: item.name):
        path = child / "campaign.json"
        if child.is_symlink() or not child.is_dir() or not path.is_file():
            continue
        try:
            campaign = _read_object(path)
        except RuntimeOperationError:
            continue
        values.append({
            "campaign_id": str(campaign.get("campaign_id") or child.name),
            "title": campaign.get("title"),
            "status": campaign.get("status"),
            "era": campaign.get("era"),
            "play_language": campaign.get("play_language"),
            "active_scenario_id": campaign.get("active_scenario_id"),
        })
    return values


def _adopt_source_facts_locked(
    root: Path,
    payload: dict[str, Any],
) -> dict[str, Any]:
    campaign_id = _id(payload.get("campaign_id"), "campaign_id")
    supplied_facts = _validated_opening_fast_facts(payload.get("facts"))
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign_id}")
    campaign_path = campaign_dir / "campaign.json"
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    with coc_fileio.advisory_file_lock(
        campaign_dir / "opening-source-review.lock"
    ):
        # The same lock covers scenario.bind_pdf's source+campaign transition.
        # Validate the current transport only after taking it, before any write.
        pending_transport = _validate_opening_source_facts_transport(
            root, campaign_id,
        )
        if (
            pending_transport is not None
            and (
                pending_transport["facts"] != supplied_facts
                or pending_transport["facts_sha256"]
                != _canonical_sha256(supplied_facts)
            )
        ):
            raise RuntimeOperationError(
                "campaign.adopt_source_facts does not match the current "
                "pending opening source facts transport"
            )
        facts = _canonicalize_opening_fast_facts(
            root, campaign_id, supplied_facts,
        )
        campaign = _read_object(campaign_path)
        era_answer = facts["era"]
        era_resolved = era_answer["status"] == "source"
        era_key = (
            coc_state.normalize_era(str(era_answer["value"]))
            if era_resolved else ""
        )
        prior_era_source = coc_state.campaign_era_source(campaign)
        already = coc_state.campaign_era_is_established(campaign)
        if (
            era_resolved
            and already
            and str(campaign.get("era") or "") != era_key
        ):
            raise RuntimeOperationError(
                f"campaign {campaign_id!r} era is already established as "
                f"{campaign.get('era')!r}; refusing to overwrite it with "
                f"{era_key!r}"
            )
        campaign["source_fast_facts"] = facts
        if (
            not era_resolved
            and prior_era_source == coc_state.ERA_SOURCE_AUTHORED
        ):
            campaign["era_source"] = coc_state.ERA_SOURCE_UNESTABLISHED
        campaign["updated_at"] = _now()
        coc_fileio.write_json_atomic(
            campaign_path, campaign, indent=2, ensure_ascii=False,
            trailing_newline=True,
        )
        briefing_path: str | None = None
        if era_resolved:
            adopted = coc_module_project.adopt_source_era(
                campaign_dir, str(era_answer["value"])
            )
            briefing_path = adopted.get("briefing_path")
            era_key = adopted.get("era") or era_key
        else:
            briefing_path = (
                coc_module_project._refresh_character_creation_briefing_if_stale(
                    campaign_dir
                )
            )
        # Transport removal is the completion marker. If any preceding write or
        # side effect raises/crashes, the pending marker survives and resume
        # replays the exact idempotent public adoption instead of advancing.
        if pending_transport is not None:
            current_transport = _validate_opening_source_facts_transport(
                root, campaign_id,
            )
            if current_transport != pending_transport:
                raise RuntimeOperationError(
                    "opening source facts transport changed during adoption"
                )
            scenario = _read_object(scenario_path)
            scenario.pop("opening_source_facts_transport", None)
            coc_fileio.write_json_atomic(
                scenario_path, scenario, indent=2, ensure_ascii=False,
                trailing_newline=True,
            )
        campaign = _read_object(campaign_path)
        blocking = [
            name for name in _OPENING_FAST_FACT_GATES
            if facts[name]["status"] != "source"
        ]
        module_init_ready, _module_init_reason, module_init_document = (
            _pi_module_init_l0_status(root, campaign_id)
        )
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": "campaign.adopt_source_facts",
            "result": {
                "campaign_id": campaign_id,
                "era": (
                    era_key
                    if coc_state.campaign_era_is_established(campaign)
                    else ""
                ),
                "era_source": coc_state.campaign_era_source(campaign),
                "facts": deepcopy(facts),
                "unresolved_blocking_facts": blocking,
                "module_init_ready": module_init_ready,
                "character_creation_unblocked": (
                    not blocking and module_init_ready
                ),
                "already_established": already,
                "character_creation_briefing_path": briefing_path,
            },
            "state_refs": [
                f".coc/campaigns/{campaign_id}/campaign.json",
                *(
                    [f".coc/campaigns/{campaign_id}/save/module-init.json"]
                    if module_init_document is not None else []
                ),
                *([briefing_path] if briefing_path else []),
            ],
        }


def guided_character_creation_input_mode(campaign_era: str) -> str:
    """Select the sole setup creation input mode for one canonical era."""
    return (
        "guided_quick_fire"
        if str(campaign_era).strip() in coc_character.guided_quick_fire_supported_eras()
        else coc_character.ERA_ADAPTIVE_INPUT_MODE
    )


def kp_guided_cash_semantic_disposition(campaign_era: str) -> dict[str, Any]:
    """Return the non-arithmetic cash route when no era table applies.

    Canonical consumers: the cash-assets failure envelope and the adaptive
    investigator contract. The route records campaign-local fiction; it never
    creates, changes, or substitutes a rules-table cash value.
    """
    return {
        "status": "kp_guided_cash_semantic_available",
        "available": True,
        "operation": "state.cash_semantic",
        "campaign_era": str(campaign_era).strip(),
        "provenance": {"kp_guided": True, "cash_semantic": True},
        "authority": "KP semantic campaign-local bookkeeping only",
        "rules_table_authority": "unavailable_for_campaign_era",
        "forbids": [
            "rules_table_mutation",
            "rule_derived_cash_amount",
        ],
    }


def _kp_guided_era_adaptive_contract(
    campaign_era: str,
    supported_eras: list[str],
) -> dict[str, Any]:
    """Build the sole adaptive route contract, parameterized only by era."""
    methods = coc_character.characteristic_generation_methods()
    rolled_methods = sorted(
        method_id for method_id, spec in methods.items()
        if isinstance(spec, dict) and spec.get("requires_rolls") is True
    )
    characteristics = {
        "type": "object",
        "required": list(coc_character.REQUIRED_CHARACTERISTICS),
        "properties": {
            key: {"type": "integer"}
            for key in coc_character.REQUIRED_CHARACTERISTICS
        },
        "additionalProperties": False,
    }
    derived = {
        "type": "object",
        "required": ["HP", "MP", "SAN", "Luck", "DB", "Build", "MOV"],
        "properties": {
            "HP": {"type": "integer"}, "MP": {"type": "integer"},
            "SAN": {"type": "integer"}, "Luck": {"type": "integer"},
            "DB": {"oneOf": [{"type": "integer"}, {"type": "string", "minLength": 1}]},
            "Build": {"type": "integer"}, "MOV": {"type": "integer"},
        },
        "additionalProperties": False,
    }
    roll_receipt = {
        "type": "object",
        "required": ["campaign_id", "decision_id", "roll_id"],
        "properties": {
            "campaign_id": {"$ref": "#/$defs/safe_id"},
            "decision_id": {"$ref": "#/$defs/name"},
            "roll_id": {"$ref": "#/$defs/name"},
        },
        "additionalProperties": False,
    }
    occupation = {
        "type": "object",
        "required": ["name", "reason", "era_adaptive", "skill_point_formula", "formula_reason"],
        "properties": {
            "name": {"$ref": "#/$defs/name"},
            "reason": {"$ref": "#/$defs/name"},
            "era_adaptive": {"const": True},
            "skill_point_formula": {"$ref": "#/$defs/name"},
            "formula_reason": {"$ref": "#/$defs/name"},
        },
        "additionalProperties": False,
    }
    provenance_entry = {
        "type": "object",
        "required": list(coc_character.ERA_ADAPTIVE_PROVENANCE_REQUIRED),
        "properties": {
            "original_name": {"$ref": "#/$defs/name"},
            "reskinned_name": {"$ref": "#/$defs/name"},
            "era_adaptive": {"const": True},
            "custom": {"type": "boolean"},
        },
        "additionalProperties": False,
    }
    player_skill_row = {
        "type": "object",
        "required": ["key", "label", "value"],
        "properties": {
            "key": {"$ref": "#/$defs/name"},
            "label": {"$ref": "#/$defs/name"},
            "value": {"type": "integer", "minimum": 0},
            "half": {"type": "integer", "minimum": 0},
            "fifth": {"type": "integer", "minimum": 0},
        },
        "additionalProperties": False,
    }
    definitions: dict[str, Any] = {
        "kp_guided_characteristics": characteristics,
        "kp_guided_derived": derived,
        "kp_guided_roll_receipt": roll_receipt,
        "kp_guided_characteristic_roll_receipts": {
            "type": "object",
            "required": [*coc_character.REQUIRED_CHARACTERISTICS, "Luck"],
            "properties": {
                key: {"$ref": "#/$defs/kp_guided_roll_receipt"}
                for key in (*coc_character.REQUIRED_CHARACTERISTICS, "Luck")
            },
            "additionalProperties": False,
        },
        "kp_guided_occupation": occupation,
        "kp_guided_skill_provenance": {
            "type": "object",
            "additionalProperties": provenance_entry,
        },
        "kp_guided_player_skill_row": player_skill_row,
        "kp_guided_player_sheet": {
            "type": "object",
            "required": ["display_name", "skills"],
            "properties": {
                "display_name": {"$ref": "#/$defs/name"},
                "skills": {"type": "array", "items": {"$ref": "#/$defs/kp_guided_player_skill_row"}},
            },
            "additionalProperties": False,
        },
        "kp_guided_era_adaptive_sheet": {
            "type": "object",
            "required": list(coc_character.ERA_ADAPTIVE_SHEET_REQUIRED),
            "properties": {
                "id": {"$ref": "#/$defs/safe_id"},
                "name": {"$ref": "#/$defs/name"},
                "age": {"$ref": "#/$defs/age"},
                "era": {"type": "string", "const": campaign_era},
                "era_adaptive": {"const": True},
                "kp_guided": {"const": True},
                "occupation": {"$ref": "#/$defs/kp_guided_occupation"},
                "characteristics": {"$ref": "#/$defs/kp_guided_characteristics"},
                "derived": {"$ref": "#/$defs/kp_guided_derived"},
                "skills": {"$ref": "#/$defs/skills"},
                "skill_provenance": {"$ref": "#/$defs/kp_guided_skill_provenance"},
                "player_facing_sheet_zh": {"$ref": "#/$defs/kp_guided_player_sheet"},
            },
            "additionalProperties": False,
        },
    }
    creation_schema: dict[str, Any] = {
        "type": "object",
        "required": list(coc_character.ERA_ADAPTIVE_CREATION_REQUIRED),
        "properties": {
            "input_mode": {"const": coc_character.ERA_ADAPTIVE_INPUT_MODE},
            "era": {"type": "string", "const": campaign_era},
            "era_adaptive": {"const": True},
            "kp_guided": {"const": True},
            "method": {"enum": sorted(methods)},
            "luck_roll_total": {"type": "integer", "minimum": 3, "maximum": 18},
            "luck_roll_receipt": {"$ref": "#/$defs/kp_guided_roll_receipt"},
            "characteristic_roll_receipts": {"$ref": "#/$defs/kp_guided_characteristic_roll_receipts"},
            "occupation": {"$ref": "#/$defs/kp_guided_occupation"},
            "skill_budget": {"$ref": "#/$defs/skill_budget"},
        },
        "additionalProperties": False,
    }
    if rolled_methods:
        creation_schema["allOf"] = [{
            "if": {"properties": {"method": {"enum": rolled_methods}}, "required": ["method"]},
            "then": {"required": ["characteristic_roll_receipts"]},
        }]
    definitions["kp_guided_era_adaptive_creation"] = creation_schema
    branch = {
        "title": "KP-guided era-adaptive creation",
        "type": "object",
        "required": ["campaign_id", "investigator_id", "sheet", "creation"],
        "properties": {
            "campaign_id": {"$ref": "#/$defs/safe_id"},
            "investigator_id": {"$ref": "#/$defs/safe_id"},
            "sheet": {"$ref": "#/$defs/kp_guided_era_adaptive_sheet"},
            "creation": {"$ref": "#/$defs/kp_guided_era_adaptive_creation"},
        },
        "additionalProperties": False,
    }
    fallback = {
        "status": "available",
        "available": True,
        "route": coc_character.ERA_ADAPTIVE_INPUT_MODE,
        "input_mode": coc_character.ERA_ADAPTIVE_INPUT_MODE,
        "quick_fire_standard_sheet": {
            "available": False,
            "supported_eras": list(supported_eras),
            "reason": "no_package_owned_standard_sheet_for_campaign_era",
        },
        "rulebook_principles": [
            {"source_ref": "Keeper Rulebook 7e L790", "summary": "The Keeper sets the game period."},
            {"source_ref": "Keeper Rulebook 7e L1640", "summary": "Sample occupations guide creation; occupations need not be listed."},
            {"source_ref": "Keeper Rulebook 7e L1644", "summary": "The Keeper selects skills appropriate to the setting period."},
            {"source_ref": "Keeper Rulebook 7e L2299/L2915", "summary": "Skill names may be period-adapted while mechanics remain usable."},
            {"source_ref": "Keeper Rulebook 7e L2311", "summary": "The Keeper may create a new setting skill."},
        ],
        "cash_assets": {
            "when_no_authoritative_table": kp_guided_cash_semantic_disposition(
                campaign_era
            ),
        },
        "allowed_mechanics": {
            "characteristics": {
                "source": "rules-json/characteristic-dice.json",
                "generation_methods": sorted(methods),
                "rolled_methods_require_receipts": True,
            },
            "occupation": {"semantic_owner": "Keeper", "catalog_membership_required": False},
            "skills": {
                "base_source": "rules-json/skills.json",
                "standard_sheet_required": False,
                "period_omission_allowed": True,
                "reskin_and_custom_provenance_required": True,
            },
        },
        "schema": {
            "branch_title": branch["title"],
            "sheet_ref": "#/$defs/kp_guided_era_adaptive_sheet",
            "creation_ref": "#/$defs/kp_guided_era_adaptive_creation",
        },
        "module_pregen_option": {
            "available": True,
            "when": (
                "the player selects an L0 pregen with a source-backed complete "
                "stats_ref"
            ),
            "read_channel": "existing progressive/lookup read-only channel",
            "new_parser": False,
            "validation_route": "import_complete_sheet",
            "input_mode": "import_complete_sheet",
        },
    }
    return {"definitions": definitions, "branch": branch, "fallback": fallback}


def _install_kp_guided_era_adaptive_contract_branch(
    contract: dict[str, Any],
    adaptive: dict[str, Any],
) -> None:
    """Install the canonical adaptive definitions and replace only Quick Fire."""
    payload_schema = contract["payload_schema"]
    definitions = payload_schema["$defs"]
    definitions.update(deepcopy(adaptive["definitions"]))
    branch = deepcopy(adaptive["branch"])
    payload_schema["oneOf"] = [
        branch if (
            isinstance(candidate, dict)
            and candidate.get("properties", {}).get("creation", {}).get("$ref")
            == "#/$defs/quick_fire_creation"
        ) else candidate
        for candidate in payload_schema["oneOf"]
    ]


def _opening_projection_ref(campaign_dir: Path) -> dict[str, Any] | None:
    receipt = coc_module_project.current_opening_projection_receipt(campaign_dir)
    if isinstance(receipt, dict):
        return {"kind": "opening_projection_receipt", "receipt": deepcopy(receipt)}
    readiness = coc_module_project.opening_source_readiness(campaign_dir)
    return {
        "kind": "opening_source_readiness",
        "state": readiness.get("state"),
        "reason": readiness.get("reason"),
    }


def _lane_interrupted_at_handoff(root: Path, campaign_dir: Path) -> bool:
    """True when source-bound Tier 2/3 progressive work is not terminal."""
    readiness = coc_module_project.opening_source_readiness(campaign_dir)
    if readiness.get("state") == coc_module_project.OPENING_SOURCE_NOT_GATED:
        return False
    scenario = campaign_dir / "scenario" / "scenario.json"
    try:
        payload = json.loads(scenario.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    root_id = str(
        payload.get("progressive_asset_root_id")
        or payload.get("source_cache_asset_root_id")
        or ""
    ).strip()
    if not root_id:
        return False
    try:
        summary = coc_module_assets.host_work_lifecycle_summary(root, root_id)
    except Exception:
        return True
    open_count = int(summary.get("open_host_work_count") or 0)
    parse_tier_max = 0
    try:
        registry = coc_module_assets.load_registry(root)
        entry = (registry.get("modules") or {}).get(root_id) or {}
        parse_tier_max = int(entry.get("parse_tier_max") or 0)
    except Exception:
        parse_tier_max = 0
    return open_count > 0 or parse_tier_max < 3


def _execute_campaign_complete(
    root: Path, payload: dict[str, Any],
) -> dict[str, Any]:
    allowed = {"campaign_id", "decision_id"}
    if set(payload) - allowed or "campaign_id" not in payload or "decision_id" not in payload:
        raise RuntimeOperationError(
            "campaign.complete requires campaign_id and decision_id",
            code="invalid_param",
        )
    campaign_id = _id(payload.get("campaign_id"), "campaign_id")
    raw_decision_id = payload.get("decision_id")
    if not isinstance(raw_decision_id, str) or not raw_decision_id.strip() or raw_decision_id != raw_decision_id.strip():
        raise RuntimeOperationError(
            "campaign.complete requires a stable decision_id",
            code="invalid_param",
        )
    decision_id = raw_decision_id
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise RuntimeOperationError(
            f"unknown campaign: {campaign_id}",
            code="unknown_campaign",
        )
    try:
        campaign = coc_state.load_campaign_state(campaign_dir)
    except coc_state.UnsupportedSaveSchema as exc:
        raise RuntimeOperationError(
            "campaign schema is not the exact current generation",
            code=exc.code,
            details=exc.to_dict(),
        ) from exc
    import coc_toolbox
    if not coc_toolbox._campaign_has_confirmed_investigator(
        campaign_dir, campaign_id,
    ):
        raise RuntimeOperationError(
            "character setup is incomplete; a confirmed investigator is required",
            code="character_setup_incomplete",
        )
    readiness = coc_module_project.opening_source_readiness(campaign_dir)
    state = str(readiness.get("state") or "")
    if state == coc_module_project.OPENING_SOURCE_FAILED:
        raise RuntimeOperationError(
            "the bound source opening failed to parse and project",
            code="opening_source_failed",
            details={"readiness": readiness},
        )
    if state == coc_module_project.OPENING_SOURCE_NOT_PREPARED:
        raise RuntimeOperationError(
            "this campaign is source-bound but no opening projection was ever prepared",
            code="opening_source_not_prepared",
            details={"readiness": readiness},
        )
    if state == coc_module_project.OPENING_SOURCE_PENDING:
        raise RuntimeOperationError(
            "the background source parse has not projected the opening yet",
            code="opening_source_pending",
            details={"readiness": readiness},
        )
    if state not in {
        coc_module_project.OPENING_SOURCE_NOT_GATED,
        coc_module_project.OPENING_SOURCE_READY,
    }:
        raise RuntimeOperationError(
            "the background source parse has not projected the opening yet",
            code="opening_source_pending",
            details={"readiness": readiness},
        )
    party = json.loads((campaign_dir / "party.json").read_text(encoding="utf-8"))
    investigator_ids = [
        value for value in (party.get("investigator_ids") or [])
        if isinstance(value, str) and value
    ]
    try:
        receipt = coc_state.complete_setup_handoff(
            campaign_dir,
            decision_id=decision_id,
            investigator_ids=investigator_ids,
            opening_projection_ref=_opening_projection_ref(campaign_dir),
            lane_interrupted_at_handoff=_lane_interrupted_at_handoff(
                root, campaign_dir,
            ),
        )
    except ValueError as exc:
        raise RuntimeOperationError(str(exc), code="invalid_param") from exc
    return {
        "schema_version": 1,
        "status": "PASS",
        "kind": "campaign.complete",
        "result": {
            "campaign_id": campaign_id,
            "ready_for_table": True,
            "next": "table_opening",
            "handoff": receipt,
        },
        "state_refs": [f".coc/campaigns/{campaign_id}/campaign.json"],
    }


def _party_investigator_ids(party: dict[str, Any]) -> list[str]:
    raw = party.get("investigator_ids")
    if not isinstance(raw, list):
        return []
    return [value for value in raw if isinstance(value, str) and value.strip()]


def _campaigns_linking_investigator(root: Path, investigator_id: str) -> list[str]:
    campaigns_dir = root / ".coc" / "campaigns"
    if not campaigns_dir.is_dir():
        return []
    linked: list[str] = []
    for child in sorted(campaigns_dir.iterdir(), key=lambda path: path.name):
        party_path = child / "party.json"
        if not child.is_dir() or not party_path.is_file():
            continue
        try:
            party = json.loads(party_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(party, dict):
            continue
        party_campaign = party.get("campaign_id")
        if (
            isinstance(party_campaign, str)
            and party_campaign.strip()
            and party_campaign != child.name
        ):
            continue
        if investigator_id in _party_investigator_ids(party):
            linked.append(child.name)
    return linked


def _chargen_revision_decision(
    root: Path,
    *,
    campaign_id: str,
    investigator_id: str,
) -> tuple[bool, str | None]:
    """Return (replace, error). replace is True only for same-campaign setup."""
    character_path = (
        root / ".coc" / "investigators" / investigator_id / "character.json"
    )
    if not character_path.is_file():
        return False, None
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    campaign_path = campaign_dir / "campaign.json"
    if not campaign_path.is_file():
        return False, f"unknown campaign: {campaign_id}"
    try:
        campaign = _read_object(campaign_path)
    except RuntimeOperationError as exc:
        return False, str(exc)
    status = campaign.get("status", "setup")
    if status != "setup" or campaign.get("setup_handoff"):
        return False, (
            "investigator revision is only allowed during unfinished setup"
        )
    linked = _campaigns_linking_investigator(root, investigator_id)
    if linked != [campaign_id]:
        return False, (
            "investigator already exists and is not exclusively this "
            "campaign's setup party"
        )
    return True, None


def _chargen_fail(
    stage: str,
    error: str,
    *,
    expected: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {"ok": False, "stage": stage, "error": error}
    if expected is not None:
        result["expected"] = expected
    if extra:
        result.update(extra)
    return {
        "schema_version": 1,
        "status": "FAIL",
        "kind": "setup.chargen_run",
        "result": result,
        "state_refs": [],
    }


def _execute_chargen_run(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "campaign_id", "investigator_id", "name", "occupation_name",
        "assignment_priority", "occupation_skill_names", "interest_skill_names",
        "occupation_allocations", "interest_allocations", "luck", "age",
    }
    required = {"campaign_id", "investigator_id", "name", "occupation_name"}
    received = set(payload)
    if received - allowed or not required <= received:
        return _chargen_fail(
            "payload",
            "setup.chargen_run has unsupported or missing fields",
            expected={
                "allowed": sorted(allowed),
                "required": sorted(required),
                "received": sorted(received),
            },
        )
    try:
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        investigator_id = _id(payload.get("investigator_id"), "investigator_id")
    except RuntimeOperationError as exc:
        return _chargen_fail("payload", str(exc))
    name = payload.get("name")
    occupation_name = payload.get("occupation_name")
    if not isinstance(name, str) or not name.strip():
        return _chargen_fail("payload", "name must be a non-empty string")
    if not isinstance(occupation_name, str) or not occupation_name.strip():
        return _chargen_fail("occupation", "occupation_name must be a non-empty string")
    assignment = payload.get("assignment_priority")
    if assignment is not None:
        if isinstance(assignment, str):
            assignment = [part.strip() for part in assignment.replace(",", " ").split() if part.strip()]
        if not isinstance(assignment, list):
            return _chargen_fail("assignment", "assignment_priority must be an 8-key list")
    occ_names = payload.get("occupation_skill_names")
    if occ_names is not None and (
        not isinstance(occ_names, list) or any(not isinstance(item, str) for item in occ_names)
    ):
        return _chargen_fail("occupation", "occupation_skill_names must be a list of strings")
    interest_names = payload.get("interest_skill_names")
    if interest_names is not None and (
        not isinstance(interest_names, list)
        or any(not isinstance(item, str) for item in interest_names)
    ):
        return _chargen_fail("interest", "interest_skill_names must be a list of strings")
    luck = payload.get("luck") or {"mode": "auto_roll"}
    if not isinstance(luck, dict) or luck.get("mode") != "auto_roll":
        return _chargen_fail("luck", "luck.mode must be auto_roll")
    age = payload.get("age", 27)
    if isinstance(age, bool) or not isinstance(age, int):
        return _chargen_fail("payload", "age must be an integer")
    occ_alloc = payload.get("occupation_allocations")
    int_alloc = payload.get("interest_allocations")
    if occ_alloc is not None and not isinstance(occ_alloc, dict):
        return _chargen_fail("occupation_allocations", "occupation_allocations must be an object")
    if int_alloc is not None and not isinstance(int_alloc, dict):
        return _chargen_fail("interest_allocations", "interest_allocations must be an object")
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        return _chargen_fail("payload", f"unknown campaign: {campaign_id}")
    try:
        campaign = coc_state.load_campaign_state(campaign_dir)
    except (OSError, ValueError, RuntimeOperationError) as exc:
        return _chargen_fail("payload", str(exc))
    campaign_era = str(campaign.get("era") or "").strip()
    input_mode = guided_character_creation_input_mode(campaign_era)
    try:
        if input_mode == coc_character.ERA_ADAPTIVE_INPUT_MODE:
            luck_creation: dict[str, Any] = {"luck": {"mode": "auto_roll"}}
            try:
                _apply_quick_fire_auto_luck_roll(
                    root,
                    luck_creation,
                    campaign_id=campaign_id,
                    investigator_id=investigator_id,
                )
            except RuntimeOperationError as exc:
                return _chargen_fail("luck", str(exc))
            sheet, creation, meta = coc_character.build_era_adaptive_chargen_payload(
                investigator_id=investigator_id,
                name=name.strip(),
                occupation_name=occupation_name.strip(),
                era=campaign_era,
                luck_roll_total=int(luck_creation["luck_roll_total"]),
                luck_roll_receipt=luck_creation["luck_roll_receipt"],
                assignment_priority=assignment,
                occupation_skill_names=occ_names,
                interest_skill_names=interest_names,
                age=age,
            )
        else:
            sheet, creation, meta = coc_character.build_quick_fire_chargen_payload(
                investigator_id=investigator_id,
                name=name.strip(),
                occupation_name=occupation_name.strip(),
                assignment_priority=assignment,
                occupation_skill_names=occ_names,
                interest_skill_names=interest_names,
                occupation_allocations=occ_alloc,
                interest_allocations=int_alloc,
                age=age,
            )
    except coc_character.ChargenRunError as exc:
        expected = exc.expected if isinstance(exc.expected, dict) else None
        return _chargen_fail(exc.stage, str(exc), expected=expected)
    replace, revision_error = _chargen_revision_decision(
        root,
        campaign_id=campaign_id,
        investigator_id=investigator_id,
    )
    if revision_error:
        return _chargen_fail(
            "revision",
            revision_error,
            extra={"investigator_id": investigator_id},
        )
    create_payload: dict[str, Any] = {
        "campaign_id": campaign_id,
        "investigator_id": investigator_id,
        "sheet": sheet,
        "creation": creation,
    }
    if replace:
        create_payload["replace"] = True
    try:
        created = execute_setup_operation(
            root,
            operation={
                "schema_version": 1,
                "kind": "investigator.create",
                "payload": create_payload,
            },
        )
    except (RuntimeOperationError, FileExistsError, FileNotFoundError, OSError) as exc:
        return _chargen_fail("create", str(exc))
    if created.get("status") != "PASS":
        return _chargen_fail("create", "investigator.create did not pass")
    try:
        linked = execute_setup_operation(
            root,
            operation={
                "schema_version": 1,
                "kind": "campaign.link_investigator",
                "payload": {
                    "campaign_id": campaign_id,
                    "investigator_ids": [investigator_id],
                },
            },
        )
    except (RuntimeOperationError, FileNotFoundError, OSError) as exc:
        return _chargen_fail(
            "link",
            str(exc),
            extra={"investigator_id": investigator_id},
        )
    if linked.get("status") != "PASS":
        return _chargen_fail(
            "link",
            "campaign.link_investigator did not pass",
            extra={"investigator_id": investigator_id},
        )
    try:
        rendered = execute_setup_operation(
            root,
            operation={
                "schema_version": 1,
                "kind": "investigator.render_card",
                "payload": {
                    "campaign_id": campaign_id,
                    "investigator_id": investigator_id,
                },
            },
        )
    except (RuntimeOperationError, FileNotFoundError, OSError) as exc:
        return _chargen_fail(
            "render",
            str(exc),
            extra={"investigator_id": investigator_id},
        )
    render_result = rendered.get("result") if isinstance(rendered.get("result"), dict) else {}
    character_path = (
        root / ".coc" / "investigators" / investigator_id / "character.json"
    )
    try:
        stored = _read_object(character_path)
    except RuntimeOperationError as exc:
        return _chargen_fail("render", str(exc), extra={"investigator_id": investigator_id})
    derived = stored.get("derived") if isinstance(stored.get("derived"), dict) else {}
    skills = stored.get("skills") if isinstance(stored.get("skills"), dict) else {}
    skill_top = sorted(
        (
            {"name": key, "value": int(value)}
            for key, value in skills.items()
            if isinstance(value, int) and not isinstance(value, bool)
        ),
        key=lambda row: (-row["value"], row["name"]),
    )[:8]
    luck_receipt = creation.get("luck_roll_receipt") if isinstance(creation.get("luck_roll_receipt"), dict) else {}
    roll_ids = []
    if isinstance(luck_receipt.get("roll_id"), str) and luck_receipt["roll_id"].strip():
        roll_ids.append(luck_receipt["roll_id"])
    card_path = render_result.get("markdown_path") or render_result.get("card_path")
    return {
        "schema_version": 1,
        "status": "PASS",
        "kind": "setup.chargen_run",
        "result": {
            "ok": True,
            "investigator_id": investigator_id,
            "characteristics": stored.get("characteristics") or meta["characteristics"],
            "derived": {
                "hp": derived.get("HP"),
                "mp": derived.get("MP"),
                "san": derived.get("SAN"),
                "luck": derived.get("Luck"),
            },
            "skill_top": skill_top,
            "card_path": card_path,
            "roll_ids": roll_ids,
        },
        "state_refs": list(created.get("state_refs") or []) + list(
            linked.get("state_refs") or []
        ) + list(rendered.get("state_refs") or []),
    }


def execute_setup_operation(
    workspace: Path | str,
    *,
    operation: dict[str, Any],
) -> dict[str, Any]:
    """Execute one canonical pre-session onboarding operation."""
    root = Path(workspace).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    kind, payload = _setup_operation(operation)
    if kind == "onboarding.inspect":
        if payload:
            raise RuntimeOperationError("onboarding.inspect payload must be empty")
        starters = coc_starter.list_starter_scenarios()
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {
                "workspace_ready": (root / ".coc").is_dir(),
                "campaigns": _campaign_summaries(root),
                "investigators": coc_state.list_investigators(root),
                "starters": [
                    {
                        **starter,
                        "pregens": [
                            {
                                key: pregen[key]
                                for key in ("pregen_id", "name", "occupation")
                                if key in pregen
                            }
                            for pregen in coc_starter.list_pregens(starter["scenario_id"])
                        ],
                    }
                    for starter in starters
                ],
                "characteristic_generation_methods": (
                    coc_character.characteristic_generation_methods()
                ),
                "rule_helper_api": coc_api.api_index(),
                "session_operation_kinds": sorted(SESSION_OPERATION_KINDS),
                "setup_operation_kinds": sorted(SETUP_OPERATION_KINDS),
            },
        }
    if kind == "rules.inspect":
        if payload:
            raise RuntimeOperationError("rules.inspect payload must be empty")
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {"helpers": coc_api.api_index()},
        }
    if kind == "campaign.quick_start":
        allowed = {"scenario_id", "pregen_id", "campaign_id", "title"}
        if set(payload) - allowed or "scenario_id" not in payload:
            raise RuntimeOperationError("campaign.quick_start has unsupported or missing fields")
        result = coc_starter.quick_start(
            root,
            _id(payload.get("scenario_id"), "scenario_id"),
            (
                _id(payload["pregen_id"], "pregen_id")
                if payload.get("pregen_id") is not None
                else None
            ),
            campaign_id=(
                _id(payload["campaign_id"], "campaign_id")
                if payload.get("campaign_id") is not None else None
            ),
            title=(str(payload["title"]) if payload.get("title") else None),
        )
        state_refs = [f".coc/campaigns/{result['campaign_id']}"]
        if result.get("investigator_id"):
            state_refs.append(
                f".coc/investigators/{result['investigator_id']}/character.json"
            )
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": result,
            "state_refs": state_refs,
        }
    if kind == "campaign.create":
        allowed = {
            "campaign_id", "title", "era", "play_language", "start_clock",
            "ruleset_id",
        }
        if set(payload) - allowed or not {"campaign_id", "title"} <= set(payload):
            raise RuntimeOperationError(
                "campaign.create has unsupported or missing fields "
                f"(received: {sorted(payload) or ['none']}; "
                f"missing required: {sorted({'campaign_id', 'title'} - set(payload)) or ['none']}; "
                f"unsupported: {sorted(set(payload) - allowed) or ['none']}; "
                f"allowed: {sorted(allowed)})"
            )
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        title = payload.get("title")
        if not isinstance(title, str) or not title.strip():
            raise RuntimeOperationError("campaign.create title must be non-empty")
        path = root / ".coc" / "campaigns" / campaign_id / "campaign.json"
        if path.exists():
            raise FileExistsError(f"campaign already exists: {campaign_id}")
        ruleset_id = payload.get("ruleset_id")
        if ruleset_id is not None and (
            not isinstance(ruleset_id, str) or not ruleset_id.strip()
        ):
            raise RuntimeOperationError(
                "campaign.create ruleset_id must be a non-empty string"
            )
        try:
            created = coc_state.create_campaign(
                root,
                campaign_id,
                title.strip(),
                # Never manufacture an era here: an omitted era stays
                # unestablished until module source authors one, which is what
                # blocks character creation on a raw-PDF campaign.
                era=payload.get("era"),
                play_language=str(payload.get("play_language") or "zh-Hans"),
                start_clock=payload.get("start_clock"),
                ruleset_id=(
                    ruleset_id.strip()
                    if isinstance(ruleset_id, str)
                    else coc_state.coc_rulesets.DEFAULT_RULESET_ID
                ),
            )
        except ValueError as exc:
            raise RuntimeOperationError(str(exc)) from exc
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {
                "campaign_id": campaign_id,
                "ruleset_id": (
                    ruleset_id.strip()
                    if isinstance(ruleset_id, str)
                    else coc_state.coc_rulesets.DEFAULT_RULESET_ID
                ),
            },
            "state_refs": [str(created.relative_to(root))],
        }
    if kind == "investigator.contract":
        if set(payload) != {"campaign_id"}:
            raise RuntimeOperationError(
                "investigator.contract requires exactly campaign_id"
            )
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        campaign_dir = root / ".coc" / "campaigns" / campaign_id
        if not campaign_dir.is_dir():
            raise FileNotFoundError(f"unknown campaign: {campaign_id}")
        campaign = coc_state.load_campaign_state(campaign_dir)
        ruleset_id = coc_state.coc_rulesets.get_campaign_ruleset_id(campaign)
        resolver = coc_state.coc_rulesets.get_resolver(campaign)
        try:
            advertised = resolver.public_api_index()
        except Exception as exc:
            raise RuntimeOperationError(
                "active ruleset public_api_index failed"
            ) from exc
        capability = "investigator_create_contract"
        provider = getattr(resolver, capability, None)
        if (
            not isinstance(advertised, dict)
            or capability not in advertised
            or not callable(provider)
        ):
            raise RuntimeOperationError(
                f"ruleset {ruleset_id!r} does not support investigator contracts"
            )
        try:
            contract = provider()
        except (OSError, TypeError, ValueError) as exc:
            raise RuntimeOperationError(
                f"ruleset {ruleset_id!r} investigator contract failed"
            ) from exc
        manifest = coc_state.coc_rulesets.load_manifest(ruleset_id)
        versions = manifest.get("schema_versions")
        investigator_version = (
            versions.get("investigator") if isinstance(versions, dict) else None
        )
        if (
            not isinstance(contract, dict)
            or contract.get("schema_version") != 1
            or contract.get("kind") != "investigator_create_payload_contract"
            or contract.get("ruleset_id") != ruleset_id
            or contract.get("ruleset_version") != manifest.get("version")
            or contract.get("investigator_schema_version") != investigator_version
            or not isinstance(contract.get("payload_schema"), dict)
            or not isinstance(contract.get("runtime_authority"), dict)
        ):
            raise RuntimeOperationError(
                f"ruleset {ruleset_id!r} investigator contract identity is invalid"
            )
        campaign_era = str(campaign.get("era") or "").strip()
        if not campaign_era:
            raise RuntimeOperationError(
                f"campaign {campaign_id!r} has no canonical era"
            )
        # This validation is intentionally a gate, not contract payload: the
        # full L0 belongs in keeper-only save/module-init.json. Keeping it out
        # of the hot investigator contract preserves the bounded wire while
        # Pi privately projects it only after this source-bound check passes.
        _require_established_source_facts(root, campaign, campaign_id)
        quick_fire_catalog = contract.get("guided_quick_fire_skill_catalog")
        supported_eras = (
            quick_fire_catalog.get("supported_eras")
            if isinstance(quick_fire_catalog, dict)
            else None
        )
        if (
            not isinstance(supported_eras, list)
            or any(
                not isinstance(value, str) or not value.strip()
                for value in supported_eras
            )
        ):
            raise RuntimeOperationError(
                f"ruleset {ruleset_id!r} investigator contract era policy is invalid"
            )
        campaign_era_supported = (
            guided_character_creation_input_mode(campaign_era)
            == "guided_quick_fire"
        )
        contract["campaign_binding"] = {
            "campaign_id": campaign_id,
            "era": campaign_era,
        }
        adaptive = (
            _kp_guided_era_adaptive_contract(campaign_era, list(supported_eras))
            if not campaign_era_supported else None
        )
        era_contract = {
            "status": (
                "standard_quick_fire_available"
                if campaign_era_supported else "kp_guided_era_adaptive_available"
            ),
            "supported": campaign_era_supported,
            "required_sheet_era": campaign_era,
            "supported_eras": list(supported_eras),
            # A fallback route is usable, so this must not tell legacy consumers
            # that character creation as a whole is terminally unavailable.
            "failure_code": None,
        }
        if adaptive is not None:
            era_contract["legacy_failure_code"] = (
                "guided_quick_fire_unsupported_campaign_era"
            )
            era_contract["fallback"] = deepcopy(adaptive["fallback"])
        contract["guided_quick_fire_campaign_era"] = era_contract
        payload_schema = contract["payload_schema"]
        definitions = payload_schema.get("$defs")
        branches = payload_schema.get("oneOf")
        quick_fire_sheet = (
            definitions.get("quick_fire_sheet")
            if isinstance(definitions, dict)
            else None
        )
        if (
            not isinstance(definitions, dict)
            or not isinstance(branches, list)
            or not isinstance(quick_fire_sheet, dict)
            or not isinstance(quick_fire_sheet.get("properties"), dict)
            or not isinstance(quick_fire_sheet.get("required"), list)
        ):
            raise RuntimeOperationError(
                f"ruleset {ruleset_id!r} investigator contract era schema is invalid"
            )
        quick_fire_sheet["properties"]["era"] = {
            "type": "string",
            "const": campaign_era,
            "description": (
                "Exact canonical campaign era from campaign_binding.era; "
                "the campaign-bound schema requires it and investigator.create "
                "binds omitted legacy input to it while rejecting drift."
            ),
        }
        if "era" not in quick_fire_sheet["required"]:
            quick_fire_sheet["required"].append("era")
        if adaptive is not None:
            _install_kp_guided_era_adaptive_contract_branch(contract, adaptive)
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": deepcopy(contract),
        }
    if kind == "actor.create":
        if set(payload) != {"campaign_id", "actor_id", "sheet"}:
            raise RuntimeOperationError(
                "actor.create requires exactly campaign_id, actor_id, and sheet"
            )
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        actor_id = _id(payload.get("actor_id"), "actor_id")
        sheet = payload.get("sheet")
        if not isinstance(sheet, dict):
            raise RuntimeOperationError("actor.create sheet must be an object")
        campaign_dir = root / ".coc" / "campaigns" / campaign_id
        if not campaign_dir.is_dir():
            raise FileNotFoundError(f"unknown campaign: {campaign_id}")
        campaign = coc_state.load_campaign_state(campaign_dir)
        ruleset_id = coc_state.coc_rulesets.get_campaign_ruleset_id(campaign)
        resolver = coc_state.coc_rulesets.get_resolver(campaign)
        try:
            advertised = resolver.public_api_index()
        except Exception as exc:
            raise RuntimeOperationError(
                "active ruleset public_api_index failed"
            ) from exc
        if (
            not isinstance(advertised, dict)
            or "validate_actor" not in advertised
            or not callable(getattr(resolver, "validate_actor", None))
        ):
            raise RuntimeOperationError(
                f"ruleset {ruleset_id!r} does not support actor.create"
            )
        try:
            normalized = resolver.validate_actor(deepcopy(sheet))
        except (TypeError, ValueError) as exc:
            raise RuntimeOperationError(str(exc)) from exc
        if (
            not isinstance(normalized, dict)
            or set(normalized) != {"sheet", "resources"}
            or not isinstance(normalized.get("sheet"), dict)
            or not isinstance(normalized.get("resources"), dict)
        ):
            raise RuntimeOperationError(
                "ruleset validate_actor must return exactly sheet and resources objects"
            )
        created = coc_state.create_ruleset_actor(
            campaign_dir,
            actor_id,
            sheet=deepcopy(normalized["sheet"]),
            resources=deepcopy(normalized["resources"]),
        )
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {
                "campaign_id": campaign_id,
                "actor_id": actor_id,
                "ruleset_id": ruleset_id,
            },
            "state_refs": [str(created.relative_to(root))],
        }
    if kind == "investigator.create":
        allowed = {"campaign_id", "investigator_id", "sheet", "creation", "replace"}
        required = {"investigator_id", "sheet"}
        received = set(payload)
        if received - allowed or not required <= received:
            raise RuntimeOperationError(
                "investigator.create has unsupported or missing fields "
                f"(received: {sorted(received) or ['none']}; "
                f"missing required: {sorted(required - received) or ['none']}; "
                f"unsupported: {sorted(received - allowed) or ['none']}; "
                f"allowed: {sorted(allowed)})"
            )
        investigator_id = _id(payload.get("investigator_id"), "investigator_id")
        replace_requested = payload.get("replace", False)
        if replace_requested is not False and replace_requested is not True:
            raise RuntimeOperationError("investigator.create replace must be a boolean")
        sheet = payload.get("sheet")
        creation = payload.get("creation")
        if not isinstance(sheet, dict) or not isinstance(creation, dict):
            raise RuntimeOperationError("investigator.create requires object sheet/creation")
        input_mode = creation.get("input_mode")
        quick_fire_inputs = (
            creation.get("characteristic_assignment_order") is not None
            or creation.get("luck_roll_total") is not None
            or _quick_fire_luck_is_auto_roll(creation)
        )
        kp_guided_era_adaptive = (
            input_mode == coc_character.ERA_ADAPTIVE_INPUT_MODE
        )
        if (
            quick_fire_inputs
            and input_mode != "guided_quick_fire"
            and not kp_guided_era_adaptive
        ):
            raise RuntimeOperationError(
                "deterministic Quick Fire investigator.create requires "
                "creation.input_mode=guided_quick_fire"
            )
        quick_fire_materialization = (
            input_mode == "guided_quick_fire" and quick_fire_inputs
        )
        current_campaign_id: str | None = None
        if quick_fire_materialization:
            current_campaign_id = _id(payload.get("campaign_id"), "campaign_id")
            campaign_dir = root / ".coc" / "campaigns" / current_campaign_id
            if not campaign_dir.is_dir():
                raise FileNotFoundError(
                    f"unknown campaign: {current_campaign_id}"
                )
            campaign = coc_state.load_campaign_state(campaign_dir)
            _require_established_source_facts(root, campaign, current_campaign_id)
            campaign_era = str(campaign.get("era") or "").strip()
            submitted_era = sheet.get("era")
            if submitted_era is None:
                sheet = deepcopy(sheet)
                sheet["era"] = campaign_era
            elif submitted_era != campaign_era:
                raise RuntimeOperationError(
                    "guided Quick Fire sheet.era must exactly match campaign "
                    f"era {campaign_era!r}; got {submitted_era!r}"
                )
            supported_eras = coc_character.guided_quick_fire_supported_eras()
            if campaign_era not in supported_eras:
                supported = ", ".join(supported_eras) or "none"
                raise RuntimeOperationError(
                    "guided Quick Fire is unavailable for campaign era "
                    f"{campaign_era!r}; package-owned standard sheet eras: "
                    f"{supported}. Use creation.input_mode="
                    f"{coc_character.ERA_ADAPTIVE_INPUT_MODE!r}."
                )
            _apply_quick_fire_auto_luck_roll(
                root,
                creation,
                campaign_id=current_campaign_id,
                investigator_id=investigator_id,
            )
            _validate_quick_fire_luck_receipt(
                root, creation, current_campaign_id=current_campaign_id,
            )
        elif kp_guided_era_adaptive:
            current_campaign_id = _id(payload.get("campaign_id"), "campaign_id")
            campaign_dir = root / ".coc" / "campaigns" / current_campaign_id
            if not campaign_dir.is_dir():
                raise FileNotFoundError(
                    f"unknown campaign: {current_campaign_id}"
                )
            campaign = coc_state.load_campaign_state(campaign_dir)
            _require_established_source_facts(root, campaign, current_campaign_id)
            campaign_era = str(campaign.get("era") or "").strip()
            if sheet.get("era") != campaign_era:
                raise RuntimeOperationError(
                    "KP-guided era-adaptive sheet.era must exactly match campaign "
                    f"era {campaign_era!r}; got {sheet.get('era')!r}"
                )
            supported_eras = coc_character.guided_quick_fire_supported_eras()
            if campaign_era in supported_eras:
                raise RuntimeOperationError(
                    "KP-guided era-adaptive creation is available only when the "
                    "campaign era has no package-owned guided Quick Fire standard sheet"
                )
            _validate_quick_fire_luck_receipt(
                root, creation, current_campaign_id=current_campaign_id,
            )
        elif "campaign_id" in payload:
            raise RuntimeOperationError(
                "investigator.create campaign_id is supported only for "
                "deterministic Quick Fire or KP-guided era-adaptive creation"
            )
        elif input_mode != "import_complete_sheet":
            raise RuntimeOperationError(
                "complete-sheet investigator.create requires explicit "
                "creation.input_mode=import_complete_sheet"
            )
        try:
            sheet = coc_character.materialize_quick_fire_create_sheet(
                sheet, creation,
            )
        except ValueError as exc:
            raise RuntimeOperationError(
                "invalid investigator sheet: " + str(exc)
            ) from exc
        errors = coc_character.validate_character_create_sheet(sheet, creation)
        if errors:
            raise RuntimeOperationError("invalid investigator sheet: " + "; ".join(errors))
        if kp_guided_era_adaptive:
            assert current_campaign_id is not None
            _validate_kp_guided_characteristic_roll_receipts(
                root,
                sheet,
                creation,
                current_campaign_id=current_campaign_id,
            )
        if str(sheet.get("id")) != investigator_id:
            raise RuntimeOperationError("investigator sheet id must match investigator_id")
        path = root / ".coc" / "investigators" / investigator_id / "character.json"
        try:
            with coc_investigator_guard.guard_reusable_investigators(
                root / ".coc", [investigator_id]
            ):
                pass
        except coc_investigator_guard.ReusableInvestigatorRecoveryConflict as exc:
            raise DevelopmentRecoveryConflict(
                exc.transaction_id,
                [_journal_display_path(
                    root / ".coc" / "campaigns" / "setup", exc.marker_path
                )],
            ) from exc
        if path.exists():
            if not replace_requested:
                raise FileExistsError(f"investigator already exists: {investigator_id}")
            if current_campaign_id is None:
                raise RuntimeOperationError(
                    "investigator.create replace requires a setup campaign_id"
                )
            allowed_replace, revision_error = _chargen_revision_decision(
                root,
                campaign_id=current_campaign_id,
                investigator_id=investigator_id,
            )
            if not allowed_replace:
                raise RuntimeOperationError(
                    revision_error
                    or "investigator revision is not allowed"
                )
        created = coc_state.create_investigator(
            root,
            investigator_id,
            sheet,
            creation=creation,
            replace=bool(path.exists() and replace_requested),
        )
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {"investigator_id": investigator_id},
            "state_refs": [str(created.relative_to(root))],
        }
    if kind == "investigator.render_card":
        allowed = {"campaign_id", "investigator_id", "language", "html_mode"}
        required = {"campaign_id", "investigator_id"}
        if set(payload) - allowed or not required <= set(payload):
            raise RuntimeOperationError(
                "investigator.render_card has unsupported or missing fields"
            )
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        investigator_id = _id(payload.get("investigator_id"), "investigator_id")
        html_mode = payload.get("html_mode", "never")
        if html_mode not in {"never", "auto", "always"}:
            raise RuntimeOperationError(
                "investigator.render_card html_mode must be never|auto|always"
            )
        campaign_dir = root / ".coc" / "campaigns" / campaign_id
        campaign_path = campaign_dir / "campaign.json"
        character_path = (
            root / ".coc" / "investigators" / investigator_id / "character.json"
        )
        if not campaign_path.is_file():
            raise FileNotFoundError(f"unknown campaign: {campaign_id}")
        if not character_path.is_file():
            raise FileNotFoundError(f"unknown investigator: {investigator_id}")
        campaign = _read_object(campaign_path)
        language = str(
            payload.get("language") or campaign.get("play_language") or "zh-Hans"
        )
        try:
            with coc_investigator_guard.guard_reusable_investigators(
                root / ".coc", [investigator_id]
            ):
                character_snapshot = _read_object(character_path)
                rendered = coc_character_card.render_cards(
                    character_path,
                    campaign_path,
                    campaign_dir / "assets" / "character-cards" / investigator_id,
                    repo_root=root,
                    language=language,
                    html_mode=str(html_mode),
                    write_back=False,
                    character_snapshot=character_snapshot,
                )
        except coc_investigator_guard.ReusableInvestigatorRecoveryConflict as exc:
            raise DevelopmentRecoveryConflict(
                exc.transaction_id,
                [_journal_display_path(campaign_dir, exc.marker_path)],
            ) from exc
        refs = [rendered["markdown_path"]]
        if isinstance(rendered.get("html_path"), str):
            refs.append(rendered["html_path"])
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {
                "campaign_id": campaign_id,
                "investigator_id": investigator_id,
                **rendered,
            },
            "state_refs": refs,
        }
    if kind == "campaign.adopt_source_facts":
        if set(payload) != {"campaign_id", "facts"}:
            raise RuntimeOperationError(
                "campaign.adopt_source_facts requires exactly campaign_id and facts"
            )
        return _adopt_source_facts_locked(root, payload)

    if kind == "campaign.link_investigator":
        if set(payload) != {"campaign_id", "investigator_ids"}:
            raise RuntimeOperationError(
                "campaign.link_investigator requires campaign_id and investigator_ids"
            )
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        raw_ids = payload.get("investigator_ids")
        if not isinstance(raw_ids, list) or not raw_ids:
            raise RuntimeOperationError("investigator_ids must be a non-empty list")
        investigator_ids = [_id(value, "investigator_id") for value in raw_ids]
        if len(investigator_ids) != len(set(investigator_ids)):
            raise RuntimeOperationError("investigator_ids must be unique")
        link_campaign_dir = root / ".coc" / "campaigns" / campaign_id
        if not link_campaign_dir.is_dir():
            raise FileNotFoundError(f"unknown campaign: {campaign_id}")
        _require_established_source_facts(
            root,
            coc_state.load_campaign_state(link_campaign_dir),
            campaign_id,
        )
        path = coc_state.link_party(root, campaign_id, investigator_ids)
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {
                "campaign_id": campaign_id,
                "investigator_ids": investigator_ids,
            },
            "state_refs": [str(path.relative_to(root))],
        }

    if kind == "campaign.render_briefing":
        if set(payload) - {"campaign_id", "language"} or "campaign_id" not in payload:
            raise RuntimeOperationError(
                "campaign.render_briefing requires campaign_id and optional language"
            )
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        campaign_dir = root / ".coc" / "campaigns" / campaign_id
        if not (campaign_dir / "campaign.json").is_file():
            raise FileNotFoundError(f"unknown campaign: {campaign_id}")
        rendered = coc_character_creation_briefing.render_briefing_from_campaign(
            campaign_dir,
            repo_root=root,
            language=(str(payload["language"]) if payload.get("language") else None),
            write_back=True,
        )
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {"campaign_id": campaign_id, **rendered},
            "state_refs": [
                f".coc/campaigns/{campaign_id}/campaign.json",
                rendered["briefing_path"],
            ],
        }

    if kind == "setup.chargen_run":
        return _execute_chargen_run(root, payload)

    if kind == "campaign.complete":
        return _execute_campaign_complete(root, payload)

    allowed = {
        "campaign_id", "scenario_id", "title", "source_bundle_path",
        "compile_now",
        # Internal opening-review rebind lane, never part of the public setup
        # contract: the coordinator-owned review transport rebinds the
        # reviewed window against an already-populated cache where the
        # whole-book OCR lane may have registered pages first. Cross-producer
        # cached pages are then referenced by content address instead of
        # failing as text drift; same-pipeline page evidence must still match
        # exactly (mcp-operation-contracts.json intentionally does not
        # advertise this key).
        "reference_cached_pages",
    }
    required = {"campaign_id", "scenario_id", "title", "source_bundle_path"}
    unsupported = sorted(set(payload) - allowed)
    missing = sorted(required - set(payload))
    if unsupported or missing:
        details = []
        if missing:
            details.append("missing: " + ", ".join(missing))
        if unsupported:
            details.append("unsupported: " + ", ".join(unsupported))
        details.append("allowed: " + ", ".join(sorted(allowed)))
        raise RuntimeOperationError(
            "scenario.bind_pdf payload fields invalid (" + "; ".join(details) + ")"
        )
    reference_cached_pages = payload.get("reference_cached_pages")
    if reference_cached_pages is not None and not isinstance(
        reference_cached_pages, bool
    ):
        raise RuntimeOperationError(
            "scenario.bind_pdf reference_cached_pages must be a boolean"
        )
    reference_cached_pages = bool(reference_cached_pages)
    campaign_id = _id(payload.get("campaign_id"), "campaign_id")
    scenario_id = _id(payload.get("scenario_id"), "scenario_id")
    title = payload.get("title")
    if not isinstance(title, str) or not title.strip():
        raise RuntimeOperationError("scenario.bind_pdf title must be non-empty")
    # Public setup callers can register host-reviewed source pages, but cannot
    # assert that those pages are a semantically complete playable opening.
    # Promotion is owned by the unexposed coordinator fulfillment boundary.
    opening_source_provenance = "selection_hint_only_not_provenance"
    source_bundle_path = Path(str(payload.get("source_bundle_path") or "")).expanduser().resolve()
    try:
        host_bundle = coc_pdf_bundle.load_host_bundle(source_bundle_path)
    except coc_pdf_bundle.PdfSourceBundleError as exc:
        raise RuntimeOperationError(
            f"scenario.bind_pdf requires a valid Codex pdf-skill source bundle: {exc}"
        ) from exc
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign_id}")
    # Explicit cold compilation must fail before the progressive source cache,
    # scenario skeleton, or campaign metadata is mutated.
    if (
        payload.get("compile_now") is True
        and not coc_scenario_hydration.COMPILER_ADAPTER_PATH.is_file()
    ):
        raise RuntimeOperationError(
            "scenario.bind_pdf compile_now=true requires the cold scenario "
            "compiler runtime; omit compile_now or pass false for progressive "
            "source-bundle binding"
        )
    source_cache = coc_module_assets.register_source_bundle(
        root,
        host_bundle,
        asset_root_id=scenario_id,
        module_identity={
            "canonical_module_id": scenario_id,
            "canonical_title": title.strip(),
        },
        reference_cached_pages=reference_cached_pages,
    )
    source = {
        **host_bundle["source"],
        "source_bundle_path": str(source_bundle_path),
    }
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    with coc_fileio.advisory_file_lock(
        campaign_dir / "opening-source-review.lock"
    ):
        previous_generation = _current_opening_review_generation(scenario_path)
        coc_scenario.create_scenario_skeleton(
            campaign_dir, scenario_id, title.strip(), source
        )
        scenario = _read_object(scenario_path)
        scenario["resolution_policy"] = "source_first"
        scenario["opening_source_provenance"] = opening_source_provenance
        scenario["opening_source_review_task"] = _new_opening_review_task(
            campaign_id=campaign_id,
            scenario_id=scenario_id,
            source=scenario["source"],
            source_bundle_id=scenario_id,
            allowed_pdf_indices=sorted(
                int(row["pdf_index"]) for row in host_bundle["pages"]
            ),
            generation=previous_generation + 1,
        )
        scenario.pop("opening_source_review_receipt", None)
        scenario.pop("opening_source_review_failure", None)
        scenario.pop("opening_source_facts_transport", None)
        # This locator only means the verified pages are reusable. Cold compile
        # remains valid; progressive play is stamped by explicit projection.
        scenario["source_cache_asset_root_id"] = source_cache["asset_root_id"]
        coc_fileio.write_json_atomic(
            scenario_path, scenario, indent=2, ensure_ascii=False,
            trailing_newline=True,
        )
        campaign_path = campaign_dir / "campaign.json"
        campaign = _read_object(campaign_path)
        campaign.pop("source_fast_facts", None)
        if (
            coc_state.campaign_era_source(campaign)
            == coc_state.ERA_SOURCE_AUTHORED
        ):
            # A source-authored era/place belongs to the previous binding.
            # Preserve explicitly declared eras, but revoke old PDF authority
            # before any new briefing or hydration can consume it.
            campaign["era_source"] = coc_state.ERA_SOURCE_UNESTABLISHED
        campaign["active_scenario_id"] = scenario_id
        campaign["status"] = "setup"
        campaign["active_subsystem"] = "setup"
        campaign["updated_at"] = _now()
        coc_fileio.write_json_atomic(
            campaign_path, campaign, indent=2, ensure_ascii=False,
            trailing_newline=True,
        )
    # S1: after a successful bind, queue the whole-book background parse for
    # this module root.  One full_parse job per asset root, forever: repeated
    # binds (opening-review rebind, cache-hit rebind, second campaign) all
    # coalesce onto the same durable job/queue/host-work lane and never block
    # the opening projection.
    full_parse: dict[str, Any] = {"triggered": False}
    try:
        root_id = str(source_cache.get("asset_root_id") or "")
        if root_id:
            queued = coc_module_assets.enqueue_job(
                root,
                root_id,
                kind="full_parse",
                target_id=root_id,
                priority=5,
                reason="bind_full_parse",
                consumer_refs=[
                    coc_module_assets.campaign_consumer_ref(
                        root,
                        campaign_id,
                        root_id,
                        intent_kind="full_parse",
                    )
                ],
            )
            full_parse = {
                "triggered": True,
                "enqueued": bool(queued.get("enqueued")),
                "deduped": bool(queued.get("deduped")),
                "dedupe_state": str(queued.get("dedupe_state") or ""),
                "job_id": str((queued.get("job") or {}).get("job_id") or ""),
                "worker_kick": queued.get("worker_kick"),
            }
    except Exception as exc:  # noqa: BLE001 — full_parse must never block bind
        full_parse = {
            "triggered": False,
            "error": f"full_parse_enqueue_failed: {type(exc).__name__}: {exc}",
        }
    hydration: dict[str, Any] | None = None
    if payload.get("compile_now") is True:
        try:
            hydration = coc_scenario_hydration.ensure_scenario_ready(campaign_dir)
        except coc_scenario_hydration.ScenarioHydrationError as exc:
            raise RuntimeOperationError(
                f"scenario.bind_pdf cold compilation failed: {exc}"
            ) from exc
        if hydration.get("status") == "PASS":
            campaign = _read_object(campaign_path)
            campaign["status"] = "active"
            campaign["active_subsystem"] = "play"
            campaign["updated_at"] = _now()
            coc_fileio.write_json_atomic(
                campaign_path, campaign, indent=2, ensure_ascii=False,
                trailing_newline=True,
            )
    briefing = coc_character_creation_briefing.render_briefing_from_campaign(
        campaign_dir,
        repo_root=root,
        write_back=True,
    )
    return {
        "schema_version": 1,
        "status": hydration.get("status", "PASS") if hydration else "PASS",
        "kind": kind,
        "result": {
            "campaign_id": campaign_id,
            "scenario_id": scenario_id,
            "source": {
                key: value for key, value in source.items() if key != "path"
            },
            "source_cache": source_cache,
            "full_parse": full_parse,
            "compile": hydration,
            "character_creation_briefing": briefing,
        },
        "state_refs": [
            f".coc/campaigns/{campaign_id}/campaign.json",
            f".coc/campaigns/{campaign_id}/scenario/scenario.json",
            f".coc/campaigns/{campaign_id}/index/source-map.json",
            briefing["briefing_path"],
        ],
    }


_OPENING_REVIEW_CONTRACT_ID = "coc.opening-source-review-fulfillment.v1"
_OPENING_REVIEW_OWNER = "opening_source_coordinator"
_OPENING_REVIEW_TASK_CONTRACT_ID = "coc.opening-source-review-task.v1"
_OPENING_REVIEW_TASK_FIELDS = {
    "schema_version", "contract_id", "status", "generation", "challenge",
    "execution_owner", "coordinator_contract_id", "continuation_contract_id",
    "campaign_id", "scenario_id", "source_bundle_id", "source_bundle_path",
    "source_id", "source_file_sha256", "source_bundle_sha256",
    "allowed_pdf_indices", "max_selected_opening_pages", "result_delivery",
    "task_identity_sha256", "terminal_receipt_sha256",
}
_OPENING_REVIEW_FIELDS = {
    "schema_version", "contract_id", "status",
    "coordinator_task_identity_sha256", "campaign_id", "scenario_id",
    "opening_review_generation", "opening_review_challenge",
    "source_scope", "source_scope_signature", "failure",
}
_OPENING_COORDINATOR_RESULT_FIELDS = {
    "schema_version", "contract_id", "status", "campaign_id", "scenario_id",
    "selected_opening_pdf_indices", "source_bundle_sha256", "opening_job_id",
    "opening_projection_ref", "initial_move_operation",
    "opening_delivery_boundary", "failure_class",
}
_OPENING_DELIVERY_BOUNDARY = {
    "operation": "evidence.table_opening",
    "before_first_player_action": True,
    "empty_presented_roll_ids_valid": True,
}


def _opening_review_task_digest(task: dict[str, Any]) -> str:
    return _canonical_sha256({
        key: value
        for key, value in task.items()
        if key not in {
            "status", "task_identity_sha256", "terminal_receipt_sha256",
        }
    })


def _current_opening_review_generation(scenario_path: Path) -> int:
    if not scenario_path.is_file():
        return 0
    scenario = _read_object(scenario_path)
    task = scenario.get("opening_source_review_task")
    if not isinstance(task, dict):
        return 0
    generation = task.get("generation")
    return (
        generation
        if isinstance(generation, int) and not isinstance(generation, bool)
        and generation >= 1
        else 0
    )


def _new_opening_review_task(
    *,
    campaign_id: str,
    scenario_id: str,
    source: dict[str, Any],
    source_bundle_id: str,
    allowed_pdf_indices: list[int],
    generation: int,
) -> dict[str, Any]:
    task: dict[str, Any] = {
        "schema_version": 1,
        "contract_id": _OPENING_REVIEW_TASK_CONTRACT_ID,
        "status": "pending",
        "generation": generation,
        "challenge": secrets.token_hex(32),
        "execution_owner": _OPENING_REVIEW_OWNER,
        "coordinator_contract_id": "coc.codex-opening-source-task.v1",
        "continuation_contract_id": "coc.opening-source-continue.v1",
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "source_bundle_id": source_bundle_id,
        "source_bundle_path": str(source.get("source_bundle_path") or ""),
        "source_id": str(source.get("source_id") or ""),
        "source_file_sha256": str(source.get("file_sha256") or ""),
        "source_bundle_sha256": str(source.get("bundle_sha256") or ""),
        "allowed_pdf_indices": allowed_pdf_indices,
        "max_selected_opening_pages": 3,
        "result_delivery": "task_return_to_parent",
        "task_identity_sha256": "",
        "terminal_receipt_sha256": None,
    }
    task["task_identity_sha256"] = _opening_review_task_digest(task)
    return task


def _validate_opening_review_task(
    scenario: dict[str, Any],
    *,
    expected_status: str,
) -> dict[str, Any]:
    task = scenario.get("opening_source_review_task")
    if (
        not isinstance(task, dict)
        or set(task) != _OPENING_REVIEW_TASK_FIELDS
        or task.get("schema_version") != 1
        or task.get("contract_id") != _OPENING_REVIEW_TASK_CONTRACT_ID
        or task.get("execution_owner") != _OPENING_REVIEW_OWNER
        or task.get("coordinator_contract_id")
        != "coc.codex-opening-source-task.v1"
        or task.get("continuation_contract_id")
        != "coc.opening-source-continue.v1"
        or task.get("result_delivery") != "task_return_to_parent"
        or task.get("status") != expected_status
        or task.get("task_identity_sha256")
        != _opening_review_task_digest(task)
    ):
        raise RuntimeOperationError(
            "opening source review task authority is invalid"
        )
    source = (
        scenario.get("source")
        if isinstance(scenario.get("source"), dict)
        else {}
    )
    expected = {
        "scenario_id": str(scenario.get("scenario_id") or ""),
        "source_bundle_path": str(source.get("source_bundle_path") or ""),
        "source_id": str(source.get("source_id") or ""),
        "source_file_sha256": str(source.get("file_sha256") or ""),
        "source_bundle_sha256": str(source.get("bundle_sha256") or ""),
    }
    if any(task.get(key) != value for key, value in expected.items()):
        raise RuntimeOperationError(
            "opening source review task source binding is stale"
        )
    if (
        not isinstance(task.get("generation"), int)
        or isinstance(task.get("generation"), bool)
        or int(task["generation"]) < 1
        or re.fullmatch(r"[0-9a-f]{64}", str(task.get("challenge") or ""))
        is None
        or not isinstance(task.get("allowed_pdf_indices"), list)
        or task.get("max_selected_opening_pages") != 3
        or (
            expected_status == "pending"
            and task.get("terminal_receipt_sha256") is not None
        )
        or (
            expected_status in {"fulfilled", "failed"}
            and re.fullmatch(
                r"sha256:[0-9a-f]{64}",
                str(task.get("terminal_receipt_sha256") or ""),
            ) is None
        )
    ):
        raise RuntimeOperationError(
            "opening source review task lifecycle is invalid"
        )
    return deepcopy(task)


def _validate_opening_source_coordinator_ready_result(
    workspace: Path | str,
    *,
    continuation: Any,
    result: Any,
) -> dict[str, Any]:
    """Bind an opening-ready claim to the exact current durable source slice."""
    root = Path(workspace).resolve()
    campaign_id = str(
        continuation.get("campaign_id") if isinstance(continuation, dict) else ""
    )
    scenario_id = str(
        continuation.get("scenario_id") if isinstance(continuation, dict) else ""
    )
    selected = (
        continuation.get("selected_opening_pdf_indices")
        if isinstance(continuation, dict) else None
    )
    if (
        not isinstance(result, dict)
        or set(result) != _OPENING_COORDINATOR_RESULT_FIELDS
        or result.get("schema_version") != 1
        or result.get("contract_id")
        != "coc.opening-source-coordinator-result.v1"
        or result.get("status") != "opening_ready"
        or result.get("failure_class") is not None
        or result.get("campaign_id") != campaign_id
        or result.get("scenario_id") != scenario_id
        or result.get("selected_opening_pdf_indices") != selected
        or not isinstance(selected, list)
        or not selected
    ):
        raise RuntimeOperationError(
            "opening source coordinator ready result shape or binding is invalid"
        )
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            root, campaign_id,
        )
        campaign_dir = root_info["campaign_dir"]
        binding = coc_module_project.current_opening_projection_source_binding(
            campaign_dir,
        )
        source_scope = (
            binding.get("source_scope") if isinstance(binding, dict) else None
        )
        start_location_id = str(
            binding.get("start_location_id")
            if isinstance(binding, dict) else ""
        )
        request = coc_module_assets.get_host_work_request(
            root, root_info["asset_root_id"],
            str(result.get("opening_job_id") or ""),
        )
    except (
        coc_module_project.OpeningPreparationError,
        coc_module_assets.ModuleAssetsError,
    ) as exc:
        raise RuntimeOperationError(
            "opening source coordinator durable binding is invalid"
        ) from exc
    if (
        result.get("source_bundle_sha256") != root_info["bundle_sha256"]
        or not isinstance(binding, dict)
        or binding.get("asset_root_id") != root_info["asset_root_id"]
        or not isinstance(source_scope, dict)
        or source_scope.get("pdf_indices") != selected
        or not start_location_id
        or not coc_module_project.opening_projection_state_is_fresh(
            root,
            campaign_dir,
            root_info["asset_root_id"],
            start_location_id,
            source_scope,
        )
        or not isinstance(request, dict)
        or request.get("status") != "fulfilled"
        or request.get("dispatch_state") != "fulfilled"
        or request.get("asset_root_id") != root_info["asset_root_id"]
        or request.get("kind") != "partial_opening"
        or request.get("target_id") != start_location_id
        or request.get("request_purpose")
        != coc_module_assets.FOREGROUND_OPENING_PURPOSE
        or request.get("requested_source_scope") != source_scope
    ):
        raise RuntimeOperationError(
            "opening source coordinator projection or job is not current"
        )
    expected_move = {
        "operation": "state.move_scene",
        "invoke_via": "coc_invoke",
        "prefilled_arguments": {
            "scene_id": start_location_id,
            "defer_initial_progressive_on_enter": True,
        },
        "missing_arguments": ["decision_id"],
        "authority": "advisory",
        "hard_gate": False,
    }
    projection_ref = (
        f".coc/campaigns/{campaign_id}/scenario/scenario.json"
        "#opening_projection_receipt"
    )
    if (
        result.get("opening_projection_ref") not in {None, projection_ref}
        or (
            result.get("initial_move_operation") is not None
            and result.get("initial_move_operation") != expected_move
        )
        or result.get("opening_delivery_boundary") != _OPENING_DELIVERY_BOUNDARY
    ):
        raise RuntimeOperationError(
            "opening source coordinator delivery boundary is invalid"
        )
    return deepcopy(result)


def _opening_review_receipt_digest(receipt: dict[str, Any]) -> str:
    return _canonical_sha256(receipt)


def _validate_opening_source_review_fulfillment(
    workspace: Path | str,
    receipt: Any,
    *,
    expected_status: str | None = None,
    expected_task_status: str | None = None,
) -> dict[str, Any]:
    """Validate one private coordinator fulfillment against current source.

    This function is intentionally not a setup/toolbox operation.  The future
    host adapter must authenticate the retained coordinator task before calling
    the mutating companion; the receipt then binds that identity to the exact
    campaign, source bundle, and reviewed page scope.
    """
    if not isinstance(receipt, dict):
        raise RuntimeOperationError(
            "opening source review fulfillment must be an object"
        )
    status = str(receipt.get("status") or "")
    if set(receipt) != _OPENING_REVIEW_FIELDS:
        raise RuntimeOperationError(
            "opening source review fulfillment fields are not exact"
        )
    if (
        receipt.get("schema_version") != 1
        or receipt.get("contract_id") != _OPENING_REVIEW_CONTRACT_ID
        or status not in {"reviewed", "failed"}
        or (expected_status is not None and status != expected_status)
    ):
        raise RuntimeOperationError(
            "opening source review fulfillment authority is invalid"
        )
    root = Path(workspace).resolve()
    campaign_id = _id(receipt.get("campaign_id"), "campaign_id")
    scenario_id = _id(receipt.get("scenario_id"), "scenario_id")
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    scenario = _read_object(scenario_path)
    if str(scenario.get("scenario_id") or "") != scenario_id:
        raise RuntimeOperationError(
            "opening source review fulfillment scenario identity mismatch"
        )
    task_status = (
        expected_task_status
        or ("fulfilled" if status == "reviewed" else "failed")
    )
    task = _validate_opening_review_task(
        scenario, expected_status=task_status,
    )
    if (
        receipt.get("campaign_id") != task["campaign_id"]
        or receipt.get("scenario_id") != task["scenario_id"]
        or receipt.get("coordinator_task_identity_sha256")
        != task["task_identity_sha256"]
        or receipt.get("opening_review_generation") != task["generation"]
        or receipt.get("opening_review_challenge") != task["challenge"]
        or (
            task_status != "pending"
            and task.get("terminal_receipt_sha256")
            != _opening_review_receipt_digest(receipt)
        )
    ):
        raise RuntimeOperationError(
            "opening source review fulfillment does not match pending task"
        )
    if status == "failed":
        failure = receipt.get("failure")
        if (
            receipt.get("source_scope") is not None
            or receipt.get("source_scope_signature") is not None
            or not isinstance(failure, dict)
            or set(failure) != {"failure_class", "error_code"}
            or not all(
                isinstance(value, str) and bool(value.strip())
                for value in failure.values()
            )
        ):
            raise RuntimeOperationError(
                "opening source review failure requires bounded failure identity"
            )
        return deepcopy(receipt)

    asset_root_id = str(
        scenario.get("source_cache_asset_root_id")
        or scenario.get("progressive_asset_root_id")
        or ""
    ).strip()
    if not asset_root_id:
        raise RuntimeOperationError(
            "opening source review fulfillment has no source asset root"
        )
    try:
        canonical_scope = coc_module_assets.validate_opening_source_scope(
            root, asset_root_id, receipt.get("source_scope"),
        )
    except coc_module_assets.ModuleAssetsError as exc:
        raise RuntimeOperationError(
            f"opening source review fulfillment scope is invalid: {exc}"
        ) from exc
    expected_signature = coc_module_assets.opening_source_scope_signature(
        canonical_scope
    )
    if (
        receipt.get("source_scope") != canonical_scope
        or receipt.get("source_scope_signature") != expected_signature
        or receipt.get("failure") is not None
        or not set(canonical_scope["pdf_indices"]) <= set(
            task["allowed_pdf_indices"]
        )
        or len(canonical_scope["pdf_indices"])
        > int(task["max_selected_opening_pages"])
    ):
        raise RuntimeOperationError(
            "opening source review fulfillment scope binding mismatch"
        )
    return deepcopy(receipt)


def _build_opening_source_review_fulfillment(
    workspace: Path | str,
    *,
    continuation: dict[str, Any],
    status: str,
    selected_opening_pdf_indices: list[int] | None = None,
    failure_class: str | None = None,
    error_code: str | None = None,
) -> dict[str, Any]:
    """Build the exact receipt for an already-authenticated retained task."""
    continuation_fields = {
        "schema_version", "contract_id", "campaign_id", "scenario_id",
        "selected_opening_pdf_indices", "source_bundle_id",
        "source_bundle_path", "result_delivery",
    }
    if (
        not isinstance(continuation, dict)
        or set(continuation) != continuation_fields
        or continuation.get("schema_version") != 1
        or continuation.get("contract_id") != "coc.opening-source-continue.v1"
        or continuation.get("result_delivery") != "task_return_to_parent"
    ):
        raise RuntimeOperationError(
            "opening source review requires the retained exact continuation"
        )
    campaign_id = _id(continuation.get("campaign_id"), "campaign_id")
    scenario_id = _id(continuation.get("scenario_id"), "scenario_id")
    root = Path(workspace).resolve()
    scenario = _read_object(
        root / ".coc" / "campaigns" / campaign_id
        / "scenario" / "scenario.json"
    )
    task = _validate_opening_review_task(
        scenario, expected_status="pending",
    )
    if (
        campaign_id != task["campaign_id"]
        or scenario_id != task["scenario_id"]
        or continuation.get("source_bundle_id") != task["source_bundle_id"]
        or continuation.get("source_bundle_path")
        != task["source_bundle_path"]
        or continuation.get("selected_opening_pdf_indices")
        != selected_opening_pdf_indices
    ):
        raise RuntimeOperationError(
            "opening source review continuation differs from pending task"
        )
    receipt: dict[str, Any] = {
        "schema_version": 1,
        "contract_id": _OPENING_REVIEW_CONTRACT_ID,
        "status": status,
        "coordinator_task_identity_sha256": task["task_identity_sha256"],
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "opening_review_generation": task["generation"],
        "opening_review_challenge": task["challenge"],
        "source_scope": None,
        "source_scope_signature": None,
        "failure": None,
    }
    if status == "reviewed":
        source = (
            scenario.get("source")
            if isinstance(scenario.get("source"), dict)
            else {}
        )
        asset_root_id = str(
            scenario.get("source_cache_asset_root_id")
            or scenario.get("progressive_asset_root_id")
            or ""
        ).strip()
        try:
            scope = coc_module_assets.validate_opening_source_window(
                root,
                asset_root_id,
                bundle_sha256=str(source.get("bundle_sha256") or ""),
                pdf_indices=selected_opening_pdf_indices,
            )
        except coc_module_assets.ModuleAssetsError as exc:
            raise RuntimeOperationError(
                f"opening source review window is invalid: {exc}"
            ) from exc
        receipt["source_scope"] = scope
        receipt["source_scope_signature"] = (
            coc_module_assets.opening_source_scope_signature(scope)
        )
    elif status == "failed":
        receipt["failure"] = {
            "failure_class": str(failure_class or "").strip(),
            "error_code": str(error_code or "").strip(),
        }
    else:
        raise RuntimeOperationError(
            "opening source review status must be reviewed or failed"
        )
    return _validate_opening_source_review_fulfillment(
        root,
        receipt,
        expected_status=status,
        expected_task_status="pending",
    )


def _build_opening_source_review_transport_failure(
    workspace: Path | str,
    *,
    campaign_id: str,
    scenario_id: str,
    failure_class: str,
    error_code: str,
) -> dict[str, Any]:
    """Build one terminal private failure before a continuation exists.

    The Pi host transport can fail before the Codex coordinator has returned
    its exact continuation.  That transport still owns the pending private
    task, but it must not invent a continuation merely to consume it.  Bind
    the failure directly to the current task identity and challenge instead.
    """
    root = Path(workspace).resolve()
    campaign = _id(campaign_id, "campaign_id")
    scenario_identity = _id(scenario_id, "scenario_id")
    scenario = _read_object(
        root / ".coc" / "campaigns" / campaign
        / "scenario" / "scenario.json"
    )
    task = _validate_opening_review_task(
        scenario, expected_status="pending",
    )
    if (
        task["campaign_id"] != campaign
        or task["scenario_id"] != scenario_identity
    ):
        raise RuntimeOperationError(
            "opening source review transport failure identity mismatch"
        )
    receipt = {
        "schema_version": 1,
        "contract_id": _OPENING_REVIEW_CONTRACT_ID,
        "status": "failed",
        "coordinator_task_identity_sha256": task["task_identity_sha256"],
        "campaign_id": campaign,
        "scenario_id": scenario_identity,
        "opening_review_generation": task["generation"],
        "opening_review_challenge": task["challenge"],
        "source_scope": None,
        "source_scope_signature": None,
        "failure": {
            "failure_class": str(failure_class or "").strip(),
            "error_code": str(error_code or "").strip(),
        },
    }
    return _validate_opening_source_review_fulfillment(
        root,
        receipt,
        expected_status="failed",
        expected_task_status="pending",
    )


def _apply_opening_source_review_fulfillment(
    workspace: Path | str,
    receipt: dict[str, Any],
    *,
    source_facts: dict[str, Any] | None = None,
    module_init_l0: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Private host-adapter mutation; deliberately absent from public tools."""
    root = Path(workspace).resolve()
    campaign_id = _id(
        receipt.get("campaign_id") if isinstance(receipt, dict) else None,
        "campaign_id",
    )
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    scenario_path = (
        campaign_dir / "scenario" / "scenario.json"
    )
    with coc_fileio.advisory_file_lock(
        campaign_dir / "opening-source-review.lock"
    ):
        validated = _validate_opening_source_review_fulfillment(
            root, receipt, expected_task_status="pending",
        )
        scenario = _read_object(scenario_path)
        task = _validate_opening_review_task(
            scenario, expected_status="pending",
        )
        task["status"] = (
            "fulfilled" if validated["status"] == "reviewed" else "failed"
        )
        task["terminal_receipt_sha256"] = (
            _opening_review_receipt_digest(validated)
        )
        scenario["opening_source_review_task"] = task
        source = (
            scenario.get("source")
            if isinstance(scenario.get("source"), dict)
            else {}
        )
        source.pop("opening_source_provenance", None)
        scenario["source"] = source
        if validated["status"] == "reviewed":
            scenario["opening_source_provenance"] = (
                "coordinator_reviewed_playable_opening"
            )
            scenario["opening_source_review_receipt"] = validated
            scenario.pop("opening_source_review_failure", None)
            if module_init_l0 is not None:
                # This is the source-review's private write, not a public
                # source-facts field: L0 contains Keeper-facing material and
                # must remain isolated in save/module-init.json.
                _write_module_init_l0(
                    campaign_dir,
                    campaign_id,
                    scenario,
                    validated,
                    module_init_l0,
                )
            if source_facts is not None:
                facts = _validated_opening_fast_facts(source_facts)
                _canonicalize_opening_fast_facts(root, campaign_id, facts)
                source = (
                    scenario.get("source")
                    if isinstance(scenario.get("source"), dict) else {}
                )
                scenario["opening_source_facts_transport"] = {
                    "schema_version": 1,
                    "contract_id": (
                        _OPENING_SOURCE_FACTS_TRANSPORT_CONTRACT_ID
                    ),
                    "status": "pending_public_adoption",
                    "campaign_id": campaign_id,
                    "scenario_id": task["scenario_id"],
                    "opening_review_generation": task["generation"],
                    "source_id": str(source.get("source_id") or ""),
                    "file_sha256": str(source.get("file_sha256") or ""),
                    "bundle_sha256": str(source.get("bundle_sha256") or ""),
                    "review_receipt_sha256": (
                        _opening_review_receipt_digest(validated)
                    ),
                    "facts_sha256": _canonical_sha256(facts),
                    "facts": facts,
                }
            else:
                scenario.pop("opening_source_facts_transport", None)
        else:
            scenario["opening_source_provenance"] = (
                "selection_hint_only_not_provenance"
            )
            scenario["opening_source_review_failure"] = validated
            scenario.pop("opening_source_review_receipt", None)
            scenario.pop("opening_source_facts_transport", None)
        coc_fileio.write_json_atomic(
            scenario_path,
            scenario,
            indent=2,
            ensure_ascii=False,
            trailing_newline=True,
        )
    return deepcopy(validated)


def execute_operation(
    workspace: Path | str,
    *,
    campaign_id: str,
    investigator_id: str,
    character_path: Path | str,
    operation: dict[str, Any],
    rng_seed: int | str | None = None,
) -> dict[str, Any]:
    """Execute one exact typed operation through the shared host boundary."""
    root = Path(workspace).resolve()
    campaign = _id(campaign_id, "campaign_id")
    investigator = _id(investigator_id, "investigator_id")
    campaign_dir = root / ".coc" / "campaigns" / campaign
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign}")
    character = Path(character_path).resolve()
    try:
        character.relative_to((root / ".coc").resolve())
    except ValueError as exc:
        raise RuntimeOperationError("character_path must remain inside workspace .coc") from exc
    kind, payload = _operation(operation)
    rng = random.Random(rng_seed)
    with coc_fileio.campaign_lock(campaign_dir):
        # Recover an interrupted development transaction before this operation
        # observes or mutates campaign state.  A foreign delta raises a typed,
        # non-destructive integrity conflict.
        recover_development_transactions(campaign_dir)
        if kind == "scenario.ensure":
            if payload:
                raise RuntimeOperationError("scenario.ensure payload must be empty")
            receipt = coc_scenario_hydration.ensure_scenario_ready(campaign_dir)
            return {"schema_version": 1, "status": receipt["status"], "kind": kind, "result": receipt}
        if kind == "scenario.repair":
            request = payload.get("source_resolution_request")
            if set(payload) != {"source_resolution_request"} or not isinstance(request, dict):
                raise RuntimeOperationError(
                    "scenario.repair requires source_resolution_request"
                )
            receipt = coc_scenario_hydration.ensure_scenario_ready(
                campaign_dir,
                force_recompile=True,
                resolution_request=request,
            )
            return {"schema_version": 1, "status": receipt["status"], "kind": kind, "result": receipt}
        if kind in {"magic.cast", "magic.learn"}:
            return _magic_operation(
                workspace=root,
                campaign_dir=campaign_dir,
                campaign_id=campaign,
                investigator_id=investigator,
                character_path=character,
                kind=kind,
                payload=payload,
                rng=rng,
            )
        if kind == "tome.read":
            return _tome_operation(
                workspace=root,
                campaign_dir=campaign_dir,
                campaign_id=campaign,
                investigator_id=investigator,
                character_path=character,
                payload=payload,
                rng=rng,
            )
        if kind.startswith("hazard."):
            return _hazard_operation(
                workspace=root,
                campaign_dir=campaign_dir,
                campaign_id=campaign,
                investigator_id=investigator,
                character_path=character,
                kind=kind,
                payload=payload,
                rng=rng,
            )
        if kind == "development.settle":
            return _development_operation(
                campaign_dir=campaign_dir,
                investigator_id=investigator,
                payload=payload,
                rng=rng,
            )
        if set(payload) != {"target_module_id", "terminal_evidence"}:
            raise RuntimeOperationError(
                "chapter.switch requires target_module_id and terminal_evidence"
            )
        result = coc_chapter_switch.switch_chapter(
            root,
            campaign,
            _id(payload.get("target_module_id"), "target_module_id"),
            payload.get("terminal_evidence"),
        )
        return {"schema_version": 1, "status": "PASS", "kind": kind, "result": result}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one canonical COC runtime operation.")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--setup", action="store_true", help="run a pre-session setup operation")
    parser.add_argument("--campaign")
    parser.add_argument("--investigator")
    parser.add_argument("--character")
    parser.add_argument("--operation-json", help="Exact operation JSON; defaults to stdin")
    parser.add_argument("--rng-seed")
    args = parser.parse_args(argv)
    raw = args.operation_json if args.operation_json is not None else input()
    if args.setup:
        result = execute_setup_operation(
            args.workspace, operation=json.loads(raw)
        )
    else:
        if not args.campaign or not args.investigator or not args.character:
            parser.error("session operations require --campaign, --investigator, and --character")
        result = execute_operation(
            args.workspace,
            campaign_id=args.campaign,
            investigator_id=args.investigator,
            character_path=args.character,
            operation=json.loads(raw),
            rng_seed=args.rng_seed,
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("status") == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
