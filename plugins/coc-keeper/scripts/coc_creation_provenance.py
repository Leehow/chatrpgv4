#!/usr/bin/env python3
"""Authoritative generated-investigator dice provenance verification.

This dependency-lower owner verifies immutable rules receipts and roll-log
rows.  It deliberately does not decide campaign handoff timing; the turn
manifest owns that separate source-boundary fact.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from typing import Any

import coc_character
import coc_roll


class CreationProvenanceError(ValueError):
    """A generated creation references non-authoritative dice evidence."""


_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_ROLL_RECEIPT_FIELDS = frozenset({
    "schema_version", "tool", "decision_id", "fingerprint", "operation",
    "resolution", "roll_id", "roll_record", "data", "warnings", "hints",
    "log_prefix_size", "log_prefix_sha256", "integrity_digest",
})


def _id(value: Any, label: str) -> str:
    text = str(value or "")
    if not _SAFE_ID.fullmatch(text):
        raise CreationProvenanceError(
            f"{label} must be a stable safe id matching "
            f"^[A-Za-z0-9][A-Za-z0-9._:-]{{0,127}}$; got {text!r}"
        )
    return text


def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CreationProvenanceError(f"unreadable JSON object: {path}") from exc
    if not isinstance(value, dict):
        raise CreationProvenanceError(f"JSON value must be an object: {path}")
    return value


def _target_kind_is_safe(coc_root: Path, path: Path) -> bool:
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
    return not path.is_symlink() and path.is_file()


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _reissue_roll_guidance(
    campaign_id: str, expression: str, purpose: str | None,
) -> str:
    arguments: dict[str, Any] = {
        "expression": expression,
        "decision_id": "<new-unique-decision-id>",
    }
    if purpose is not None:
        arguments["purpose"] = purpose
    return json.dumps(
        {
            "operation": "rules.roll_dice",
            "campaign": campaign_id,
            "arguments": arguments,
        },
        ensure_ascii=False,
    )


def _describe_failure(
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
    suffix = (
        f" Re-issue the authoritative roll on campaign '{campaign_id}' first: "
        + _reissue_roll_guidance(campaign_id, expression, purpose)
    )
    if not isinstance(receipt, dict):
        return (
            f"{label} roll receipt is unavailable: no rules.roll_dice receipt is "
            f"recorded for decision_id '{decision_id}' on campaign '{campaign_id}'."
            + suffix
        )
    if operation != expected_operation:
        detail = (
            f" (the recorded roll carries no purpose; it must be purpose='{purpose}')"
            if isinstance(operation, dict)
            and purpose is not None
            and "purpose" not in operation
            else ""
        )
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


def authoritative_dice_roll_total(
    root: Path,
    reference: Any,
    *,
    current_campaign_id: str,
    expression: str,
    purpose: str | None,
    label: str,
) -> int:
    if not isinstance(reference, dict) or set(reference) != {
        "campaign_id", "decision_id", "roll_id",
    }:
        raise CreationProvenanceError(
            f"{label} roll receipt requires exactly campaign_id, decision_id, and roll_id"
        )
    campaign_id = _id(
        reference.get("campaign_id"), f"{label}_roll_receipt.campaign_id",
    )
    if campaign_id != current_campaign_id:
        raise CreationProvenanceError(
            f"{label} roll receipt campaign_id must equal the declared current campaign_id"
        )
    decision_id = reference.get("decision_id")
    roll_id = reference.get("roll_id")
    if not isinstance(decision_id, str) or not decision_id.strip():
        raise CreationProvenanceError(
            f"{label} roll receipt decision_id must be non-empty"
        )
    if not isinstance(roll_id, str) or not roll_id.strip():
        raise CreationProvenanceError(f"{label} roll receipt roll_id must be non-empty")
    normalized_expression = expression.strip().upper()
    match = coc_roll.ROLL_PATTERN.fullmatch(normalized_expression)
    if match is None:
        raise CreationProvenanceError(f"{label} dice expression is invalid")
    expected_resolution = {
        "expression": normalized_expression,
        "count": int(match.group("count")),
        "sides": int(match.group("sides")),
        "modifier": int(match.group("modifier") or 0),
    }
    campaign_dir = Path(root) / ".coc" / "campaigns" / campaign_id
    campaign_path = campaign_dir / "campaign.json"
    receipt_path = campaign_dir / "save" / "roll-operation-receipts.json"
    rolls_path = campaign_dir / "logs" / "rolls.jsonl"
    coc_root = Path(root) / ".coc"
    if any(
        not path.is_file() or not _target_kind_is_safe(coc_root, path)
        for path in (campaign_path, receipt_path, rolls_path)
    ):
        raise CreationProvenanceError(
            f"{label} source receipt is unavailable for campaign: {campaign_id}"
        )
    document = _read_object(receipt_path)
    if (
        set(document) != {
            "schema_version", "receipts", "pending_side_effects", "luck_spends",
        }
        or document.get("schema_version") != 6
        or not isinstance(document.get("receipts"), dict)
        or not isinstance(document.get("pending_side_effects"), dict)
        or not isinstance(document.get("luck_spends"), dict)
    ):
        raise CreationProvenanceError(f"{label} source receipt document is invalid")
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
    candidates = (data, record, payload)
    purpose_matches = (
        all(candidate.get("purpose") == purpose for candidate in candidates)
        if purpose is not None and all(isinstance(candidate, dict) for candidate in candidates)
        else purpose is None and all(
            isinstance(candidate, dict) and "purpose" not in candidate
            for candidate in (operation, *candidates)
        )
    )
    reason_matches = (
        all(candidate.get("reason") == reason for candidate in candidates)
        if isinstance(reason, str) and all(isinstance(candidate, dict) for candidate in candidates)
        else reason is None and all(
            isinstance(candidate, dict) and "reason" not in candidate
            for candidate in candidates
        )
    )
    valid = bool(
        isinstance(receipt, dict)
        and set(receipt) == set(_ROLL_RECEIPT_FIELDS)
        and receipt.get("schema_version") == 5
        and receipt.get("tool") == "rules.roll_dice"
        and receipt.get("decision_id") == decision_id
        and receipt.get("roll_id") == roll_id
        and operation == expected_operation
        and resolution == expected_resolution
        and receipt.get("fingerprint") == _canonical_sha256({
            "tool": "rules.roll_dice", "operation": expected_operation,
        })
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
        raise CreationProvenanceError(_describe_failure(
            label=label,
            campaign_id=campaign_id,
            decision_id=decision_id,
            roll_id=roll_id,
            receipt=receipt,
            operation=operation,
            expected_operation=expected_operation,
            expression=normalized_expression,
            purpose=purpose,
        ))
    try:
        roll_rows = [
            json.loads(line)
            for line in rolls_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CreationProvenanceError(f"{label} roll log is unreadable") from exc
    if [row for row in roll_rows if row.get("roll_id") == roll_id] != [record]:
        raise CreationProvenanceError(
            f"{label} roll log does not contain exactly the referenced authoritative roll"
        )
    return int(data["total"])


def require_generated_age_dice_assertions(
    sheet: dict[str, Any], creation: dict[str, Any],
) -> None:
    input_mode = creation.get("input_mode")
    if input_mode == "import_complete_sheet":
        return
    age_present = "age" in sheet
    bundle_present = any(
        field in creation for field in (
            "edu_improvement_rolls", "luck_roll_candidates",
            "characteristic_reductions",
        )
    )
    if input_mode == coc_character.ERA_ADAPTIVE_INPUT_MODE and not bundle_present:
        return
    if not age_present and not bundle_present:
        return
    age = sheet.get("age")
    if isinstance(age, bool) or not isinstance(age, int):
        raise CreationProvenanceError("age must be an integer when supplied")
    try:
        required_edu = coc_character.required_edu_improvement_checks(age)
        keep = coc_character.chargen_luck_rolls_keep_highest(age)
    except ValueError as exc:
        raise CreationProvenanceError(str(exc)) from exc
    rolls = creation.get("edu_improvement_rolls")
    if not isinstance(rolls, list) or len(rolls) != required_edu:
        raise CreationProvenanceError(
            f"generated create with age={age} asserts {required_edu} EDU "
            "improvement check receipt(s); omit sheet.age or attach "
            "edu_improvement_rolls. import_complete_sheet must omit this bundle"
        )
    if keep > 1:
        candidates = creation.get("luck_roll_candidates")
        if not isinstance(candidates, list) or len(candidates) != keep:
            raise CreationProvenanceError(
                f"generated create with age={age} asserts {keep} Luck receipts "
                "(keep highest); omit sheet.age or attach luck_roll_candidates"
            )


def validate_quick_fire_luck_receipt(
    root: Path,
    creation: dict[str, Any] | None,
    *,
    current_campaign_id: str,
) -> None:
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
        raise CreationProvenanceError(
            "deterministic Quick Fire creation requires luck_roll_receipt "
            "with exactly campaign_id, decision_id, and roll_id"
        )
    campaign_id = _id(reference.get("campaign_id"), "luck_roll_receipt.campaign_id")
    if campaign_id != current_campaign_id:
        raise CreationProvenanceError(
            "luck_roll_receipt.campaign_id must equal the declared current campaign_id"
        )
    try:
        total = authoritative_dice_roll_total(
            root,
            reference,
            current_campaign_id=current_campaign_id,
            expression="3D6",
            purpose="investigator_creation_luck",
            label="Quick Fire Luck",
        )
    except CreationProvenanceError as exc:
        raise CreationProvenanceError(
            "Quick Fire Luck source receipt does not match the exact campaign, "
            f"3D6 recipe, roll_id, and luck_roll_total: {exc}"
        ) from exc
    if total != luck_total:
        raise CreationProvenanceError(
            "Quick Fire Luck source receipt does not match the exact campaign, "
            f"3D6 recipe, roll_id, and luck_roll_total: the authoritative 3D6 "
            f"total is {total}, but the payload luck_roll_total is {luck_total!r}"
        )


def validate_chargen_age_dice_receipts(
    root: Path,
    creation: dict[str, Any],
    *,
    current_campaign_id: str,
) -> None:
    rolls = creation.get("edu_improvement_rolls")
    if isinstance(rolls, list):
        for index, record in enumerate(rolls):
            if not isinstance(record, dict):
                raise CreationProvenanceError(
                    "edu_improvement_rolls entries must be objects"
                )
            total = authoritative_dice_roll_total(
                root,
                record.get("check_receipt"),
                current_campaign_id=current_campaign_id,
                expression="1D100",
                purpose="investigator_creation_characteristic",
                label=f"chargen EDU check {index}",
            )
            if total != record.get("roll"):
                raise CreationProvenanceError(
                    f"edu_improvement_rolls[{index}].roll does not match its rules receipt"
                )
            has_roll = "improvement_roll" in record
            has_receipt = "improve_receipt" in record
            if has_roll != has_receipt:
                raise CreationProvenanceError(
                    f"edu_improvement_rolls[{index}] must pair improvement_roll with improve_receipt"
                )
            if has_roll:
                improve_total = authoritative_dice_roll_total(
                    root,
                    record.get("improve_receipt"),
                    current_campaign_id=current_campaign_id,
                    expression="1D10",
                    purpose="investigator_creation_characteristic",
                    label=f"chargen EDU improve {index}",
                )
                if improve_total != record.get("improvement_roll"):
                    raise CreationProvenanceError(
                        f"edu_improvement_rolls[{index}].improvement_roll does not match its rules receipt"
                    )
    candidates = creation.get("luck_roll_candidates")
    if isinstance(candidates, list):
        for index, row in enumerate(candidates):
            if not isinstance(row, dict):
                raise CreationProvenanceError(
                    "luck_roll_candidates entries must be objects"
                )
            total = authoritative_dice_roll_total(
                root,
                row.get("receipt"),
                current_campaign_id=current_campaign_id,
                expression="3D6",
                purpose="investigator_creation_luck",
                label=f"chargen Luck candidate {index}",
            )
            if total != row.get("total"):
                raise CreationProvenanceError(
                    f"luck_roll_candidates[{index}].total does not match its rules receipt"
                )


def validate_kp_guided_characteristic_roll_receipts(
    root: Path,
    sheet: dict[str, Any],
    creation: dict[str, Any],
    *,
    current_campaign_id: str,
) -> None:
    method = coc_character.characteristic_generation_methods().get(
        creation.get("method")
    )
    if not isinstance(method, dict) or method.get("requires_rolls") is not True:
        return
    references = creation.get("characteristic_roll_receipts")
    expressions = coc_character.characteristic_roll_expressions()
    expected_keys = {*coc_character.REQUIRED_CHARACTERISTICS, "Luck"}
    if (
        not isinstance(references, dict)
        or set(references) != expected_keys
        or set(expressions) != expected_keys
    ):
        raise CreationProvenanceError(
            "KP-guided characteristic roll recipe is incomplete"
        )
    try:
        multiplier = coc_character.characteristic_generation_multiplier()
    except ValueError as exc:
        raise CreationProvenanceError(str(exc)) from exc
    characteristics = sheet.get("characteristics")
    derived = sheet.get("derived")
    if not isinstance(characteristics, dict) or not isinstance(derived, dict):
        raise CreationProvenanceError(
            "KP-guided characteristic roll binding requires complete characteristics and derived values"
        )
    for characteristic in coc_character.REQUIRED_CHARACTERISTICS:
        total = authoritative_dice_roll_total(
            root,
            references[characteristic],
            current_campaign_id=current_campaign_id,
            expression=expressions[characteristic],
            purpose=None,
            label=f"KP-guided {characteristic}",
        )
        if characteristics.get(characteristic) != total * multiplier:
            raise CreationProvenanceError(
                f"KP-guided {characteristic} must equal its authoritative "
                f"{expressions[characteristic]} total times {multiplier}"
            )
    if references["Luck"] != creation.get("luck_roll_receipt"):
        raise CreationProvenanceError(
            "KP-guided Luck characteristic_roll_receipts entry must equal luck_roll_receipt"
        )
    roll_ids = [
        reference.get("roll_id") if isinstance(reference, dict) else None
        for reference in references.values()
    ]
    if (
        any(not isinstance(roll_id, str) or not roll_id.strip() for roll_id in roll_ids)
        or len(set(roll_ids)) != len(expected_keys)
    ):
        raise CreationProvenanceError(
            "KP-guided characteristic roll receipts must use distinct authoritative roll_id values"
        )
    if derived.get("Luck") != creation.get("luck_roll_total") * multiplier:
        raise CreationProvenanceError(
            f"KP-guided derived Luck must equal its authoritative total times {multiplier}"
        )


def _chargen_public_dice(
    creation: dict[str, Any],
) -> tuple[list[str], dict[str, str]]:
    roll_ids: list[str] = []
    decisions: dict[str, str] = {}

    def add(reference: Any) -> None:
        if not isinstance(reference, dict):
            return
        roll_id = reference.get("roll_id")
        decision_id = reference.get("decision_id")
        if isinstance(roll_id, str) and roll_id.strip():
            if roll_id not in roll_ids:
                roll_ids.append(roll_id)
            if isinstance(decision_id, str):
                decisions[roll_id] = decision_id

    candidates = creation.get("luck_roll_candidates")
    if isinstance(candidates, list) and candidates:
        for row in candidates:
            if isinstance(row, dict):
                add(row.get("receipt"))
    else:
        add(creation.get("luck_roll_receipt"))
    for record in creation.get("edu_improvement_rolls") or []:
        if not isinstance(record, dict):
            continue
        add(record.get("check_receipt"))
        if "improve_receipt" in record:
            add(record.get("improve_receipt"))
    return roll_ids, decisions


def validated_creation_roll_references(
    root: Path,
    sheet: dict[str, Any],
    creation: dict[str, Any],
    *,
    current_campaign_id: str,
) -> dict[str, str]:
    """Return trusted roll_id -> decision_id for generated creation dice."""
    input_mode = creation.get("input_mode")
    if input_mode not in {
        "guided_quick_fire", coc_character.ERA_ADAPTIVE_INPUT_MODE,
    }:
        raise CreationProvenanceError(
            "creation roll provenance is available only for generated Quick Fire or KP-guided era-adaptive creation"
        )
    require_generated_age_dice_assertions(sheet, creation)
    validate_quick_fire_luck_receipt(
        root, creation, current_campaign_id=current_campaign_id,
    )
    validate_chargen_age_dice_receipts(
        root, creation, current_campaign_id=current_campaign_id,
    )
    if input_mode == coc_character.ERA_ADAPTIVE_INPUT_MODE:
        validate_kp_guided_characteristic_roll_receipts(
            root,
            sheet,
            creation,
            current_campaign_id=current_campaign_id,
        )
    roll_ids, decisions = _chargen_public_dice(creation)
    if input_mode == coc_character.ERA_ADAPTIVE_INPUT_MODE:
        method = coc_character.characteristic_generation_methods().get(
            creation.get("method")
        )
        references = creation.get("characteristic_roll_receipts")
        if isinstance(method, dict) and method.get("requires_rolls") is True:
            assert isinstance(references, dict)
            for reference in references.values():
                roll_id = str(reference["roll_id"])
                if roll_id not in roll_ids:
                    roll_ids.append(roll_id)
                decisions[roll_id] = str(reference["decision_id"])
    if set(roll_ids) != set(decisions):
        raise CreationProvenanceError(
            "creation roll references must bind every trusted roll to one decision"
        )
    return decisions


def validated_creation_roll_ids(
    root: Path,
    sheet: dict[str, Any],
    creation: dict[str, Any],
    *,
    current_campaign_id: str,
) -> set[str]:
    return set(validated_creation_roll_references(
        root,
        sheet,
        creation,
        current_campaign_id=current_campaign_id,
    ))
