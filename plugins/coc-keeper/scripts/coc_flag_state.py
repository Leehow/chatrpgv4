#!/usr/bin/env python3
"""Shared structured flag mutation contract.

Both the Keeper toolbox and the deterministic director persist world flags.
This module keeps their producer fields, causal order, live provenance, and
entity-head integrity identical without interpreting narrative prose.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import hashlib
import json
from typing import Any


FLAG_MUTATION_SCHEMA_VERSION = 1
FLAG_HEAD_SCHEMA_VERSION = 1
FLAG_DOCUMENT_SCHEMA_VERSION = 3
FLAG_DOCUMENT_FIELDS = frozenset({
    "schema_version",
    "campaign_id",
    "scenario_id",
    "clues_found",
    "decisions",
    "spoiler_reveals",
    "flags",
    "flag_provenance",
    "flag_heads",
    "flag_source_sequence",
    "operation_receipts",
    "director_flag_receipts",
})
DIRECTOR_FLAG_RECEIPTS_KEY = "director_flag_receipts"
DIRECTOR_FLAG_RECEIPT_SCHEMA_VERSION = 1
TIME_MARKER_SCHEMA_VERSION = 1


def canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def positive_sequence(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        sequence = int(value)
    except (TypeError, ValueError):
        return None
    return sequence if sequence > 0 else None


def new_flag_document(
    *, campaign_id: str | None, scenario_id: str | None = None
) -> dict[str, Any]:
    """Create the only supported flag persistence document."""
    return {
        "schema_version": FLAG_DOCUMENT_SCHEMA_VERSION,
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "clues_found": {},
        "decisions": [],
        "spoiler_reveals": [],
        "flags": {},
        "flag_provenance": {},
        "flag_heads": {},
        "flag_source_sequence": 0,
        "operation_receipts": {},
        DIRECTOR_FLAG_RECEIPTS_KEY: {},
    }


def valid_flag_document_structure(value: Any) -> bool:
    """Validate the exact current document shape without migrating old data."""
    if (
        not isinstance(value, dict)
        or set(value) != set(FLAG_DOCUMENT_FIELDS)
        or value.get("schema_version") != FLAG_DOCUMENT_SCHEMA_VERSION
        or (
            value.get("campaign_id") is not None
            and not isinstance(value.get("campaign_id"), str)
        )
        or (
            value.get("scenario_id") is not None
            and not isinstance(value.get("scenario_id"), str)
        )
        or not isinstance(value.get("clues_found"), dict)
        or not isinstance(value.get("decisions"), list)
        or not isinstance(value.get("spoiler_reveals"), list)
        or not isinstance(value.get("flags"), dict)
        or not isinstance(value.get("flag_provenance"), dict)
        or not isinstance(value.get("flag_heads"), dict)
        or not isinstance(value.get("operation_receipts"), dict)
        or not isinstance(value.get(DIRECTOR_FLAG_RECEIPTS_KEY), dict)
    ):
        return False
    sequence = value.get("flag_source_sequence")
    return bool(
        isinstance(sequence, int)
        and not isinstance(sequence, bool)
        and sequence >= 0
    )


def _valid_optional_text(value: Any) -> bool:
    return value is None or isinstance(value, str)


def _valid_required_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _valid_iso_datetime(value: Any, *, optional: bool = False) -> bool:
    if value is None:
        return optional
    if not _valid_required_text(value):
        return False
    try:
        datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def valid_time_marker_payload(
    marker: Any,
    *,
    marker_id: str,
    decision_id: str,
    producer: str,
    source_sequence: int,
) -> bool:
    """Validate every current marker field, not merely its causal identifiers."""
    if not isinstance(marker, dict):
        return False
    status = marker.get("status")
    expected = {
        "schema_version",
        "marker_id",
        "label",
        "status",
        "revision",
        "due_at",
        "created_at",
        "updated_at",
        "decision_id",
        "reason",
        "source_sequence",
        "producer",
    }
    if status == "cleared":
        expected.add("cleared_at")
    if set(marker) != expected:
        return False
    revision = marker.get("revision")
    due_at = marker.get("due_at")
    if (
        marker.get("schema_version") != TIME_MARKER_SCHEMA_VERSION
        or str(marker.get("marker_id") or "") != str(marker_id)
        or str(marker.get("decision_id") or "") != str(decision_id)
        or str(marker.get("producer") or "") != str(producer)
        or positive_sequence(marker.get("source_sequence"))
        != positive_sequence(source_sequence)
        or status not in {"active", "cleared"}
        or not _valid_required_text(marker.get("label"))
        or isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 1
        or not _valid_iso_datetime(marker.get("created_at"))
        or not _valid_iso_datetime(marker.get("updated_at"))
        or not _valid_optional_text(marker.get("reason"))
        or not isinstance(due_at, dict)
        or set(due_at) != {"elapsed_minutes", "local_datetime", "display"}
        or isinstance(due_at.get("elapsed_minutes"), bool)
        or not isinstance(due_at.get("elapsed_minutes"), int)
        or due_at["elapsed_minutes"] < 0
        or not _valid_iso_datetime(due_at.get("local_datetime"), optional=True)
        or not _valid_optional_text(due_at.get("display"))
    ):
        return False
    if status == "cleared" and not _valid_iso_datetime(marker.get("cleared_at")):
        return False
    return True


def flag_live_record(flags_doc: dict[str, Any], flag_id: str) -> dict[str, Any]:
    flag_map = flags_doc.get("flags")
    provenance_map = flags_doc.get("flag_provenance")
    flag_map = flag_map if isinstance(flag_map, dict) else {}
    provenance_map = provenance_map if isinstance(provenance_map, dict) else {}
    present = str(flag_id) in flag_map
    return {
        "schema_version": 1,
        "flag_id": str(flag_id),
        "present": present,
        "value": deepcopy(flag_map.get(str(flag_id))) if present else None,
        "provenance": deepcopy(provenance_map.get(str(flag_id)))
        if isinstance(provenance_map.get(str(flag_id)), dict)
        else None,
    }


def entity_head(
    *,
    entity_kind: str,
    entity_id: str,
    decision_id: str,
    source_sequence: int,
    producer: str,
    live_record: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": FLAG_HEAD_SCHEMA_VERSION,
        "entity_kind": str(entity_kind),
        "entity_id": str(entity_id),
        "decision_id": str(decision_id),
        "source_sequence": int(source_sequence),
        "producer": str(producer),
        "live_record": deepcopy(live_record),
        "live_record_digest": canonical_digest(live_record),
    }


def valid_entity_head(
    head: Any,
    *,
    entity_kind: str | None = None,
    entity_id: str | None = None,
) -> bool:
    if not isinstance(head, dict) or set(head) != {
        "schema_version",
        "entity_kind",
        "entity_id",
        "decision_id",
        "source_sequence",
        "producer",
        "live_record",
        "live_record_digest",
    }:
        return False
    if head.get("schema_version") != FLAG_HEAD_SCHEMA_VERSION:
        return False
    if not str(head.get("entity_id") or "") or not str(
        head.get("decision_id") or ""
    ) or not str(head.get("producer") or ""):
        return False
    if entity_kind is not None and str(head.get("entity_kind")) != str(entity_kind):
        return False
    if entity_id is not None and str(head.get("entity_id")) != str(entity_id):
        return False
    if positive_sequence(head.get("source_sequence")) is None:
        return False
    live_record = head.get("live_record")
    if not isinstance(live_record, dict):
        return False
    stable_kind = str(head.get("entity_kind") or "")
    stable_id = str(head.get("entity_id") or "")
    if stable_kind == "flag":
        if set(live_record) != {
            "schema_version", "flag_id", "present", "value", "provenance",
        }:
            return False
        if (
            live_record.get("schema_version") != 1
            or str(live_record.get("flag_id") or "") != stable_id
            or type(live_record.get("present")) is not bool
        ):
            return False
        if live_record["present"] is True:
            if type(live_record.get("value")) is not bool:
                return False
            provenance = live_record.get("provenance")
            if not isinstance(provenance, dict):
                return False
            if (
                str(provenance.get("decision_id") or "")
                != str(head.get("decision_id") or "")
                or str(provenance.get("producer") or "")
                != str(head.get("producer") or "")
                or positive_sequence(provenance.get("source_sequence"))
                != positive_sequence(head.get("source_sequence"))
            ):
                return False
        elif live_record.get("value") is not None or live_record.get("provenance") is not None:
            return False
    elif stable_kind == "time_marker":
        if set(live_record) != {
            "schema_version", "marker_id", "present", "marker",
        }:
            return False
        if (
            live_record.get("schema_version") != 1
            or str(live_record.get("marker_id") or "") != stable_id
            or type(live_record.get("present")) is not bool
        ):
            return False
        marker = live_record.get("marker")
        if live_record["present"] is True:
            if not valid_time_marker_payload(
                marker,
                marker_id=stable_id,
                decision_id=str(head.get("decision_id") or ""),
                producer=str(head.get("producer") or ""),
                source_sequence=int(head.get("source_sequence") or 0),
            ):
                return False
        elif marker is not None:
            return False
    else:
        return False
    return bool(
        str(head.get("live_record_digest") or "") == canonical_digest(live_record)
    )


def director_flag_event_id(decision_id: str, flag_id: str) -> str:
    """Stable identity for one director-owned flag transition."""
    encoded = json.dumps(
        ["coc_director_apply.flag", str(decision_id), str(flag_id)],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"director-flag-v1:{hashlib.sha256(encoded).hexdigest()[:32]}"


def director_flag_receipt_key(decision_id: str, flag_id: str) -> str:
    return json.dumps(
        [str(decision_id), str(flag_id)],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def new_director_flag_receipt(
    *,
    decision_id: str,
    flag_id: str,
    value: bool,
    reason: str | None,
    event: dict[str, Any],
    entity_head: dict[str, Any],
) -> dict[str, Any]:
    receipt = {
        "schema_version": DIRECTOR_FLAG_RECEIPT_SCHEMA_VERSION,
        "producer": "coc_director_apply",
        "decision_id": str(decision_id),
        "flag_id": str(flag_id),
        "operation": {"value": bool(value), "reason": reason},
        "event_id": director_flag_event_id(decision_id, flag_id),
        "event": deepcopy(event),
        "entity_head": deepcopy(entity_head),
    }
    receipt["integrity_digest"] = canonical_digest(receipt)
    return receipt


def valid_director_flag_receipt(
    receipt: Any,
    *,
    decision_id: str | None = None,
    flag_id: str | None = None,
) -> bool:
    """Validate the complete source-owned director flag receipt."""
    if not isinstance(receipt, dict) or set(receipt) != {
        "schema_version",
        "producer",
        "decision_id",
        "flag_id",
        "operation",
        "event_id",
        "event",
        "entity_head",
        "integrity_digest",
    }:
        return False
    if (
        receipt.get("schema_version") != DIRECTOR_FLAG_RECEIPT_SCHEMA_VERSION
        or receipt.get("producer") != "coc_director_apply"
    ):
        return False
    stable_decision = str(receipt.get("decision_id") or "")
    stable_flag = str(receipt.get("flag_id") or "")
    if not stable_decision or not stable_flag:
        return False
    if decision_id is not None and stable_decision != str(decision_id):
        return False
    if flag_id is not None and stable_flag != str(flag_id):
        return False
    operation = receipt.get("operation")
    if (
        not isinstance(operation, dict)
        or set(operation) != {"value", "reason"}
        or type(operation.get("value")) is not bool
        or operation.get("reason") is not None
        and not isinstance(operation.get("reason"), str)
    ):
        return False
    stable_event_id = director_flag_event_id(stable_decision, stable_flag)
    event = receipt.get("event")
    head = receipt.get("entity_head")
    live_record = head.get("live_record") if isinstance(head, dict) else None
    provenance = (
        live_record.get("provenance") if isinstance(live_record, dict) else None
    )
    if (
        str(receipt.get("event_id") or "") != stable_event_id
        or not isinstance(event, dict)
        or str(event.get("event_id") or "") != stable_event_id
        or event.get("event_type") != "flag_set"
        or event.get("flag_mutation_schema_version")
        != FLAG_MUTATION_SCHEMA_VERSION
        or str(event.get("decision_id") or "") != stable_decision
        or str(event.get("flag_id") or "") != stable_flag
        or event.get("value") is not operation.get("value")
        or event.get("reason") != operation.get("reason")
        or event.get("producer") != "coc_director_apply"
        or not valid_entity_head(head, entity_kind="flag", entity_id=stable_flag)
        or str(head.get("decision_id") or "") != stable_decision
        or str(head.get("producer") or "") != "coc_director_apply"
        or positive_sequence(event.get("source_sequence"))
        != positive_sequence(head.get("source_sequence"))
        or not isinstance(live_record, dict)
        or live_record.get("present") is not True
        or live_record.get("value") is not operation.get("value")
        or not isinstance(provenance, dict)
        or provenance.get("source") != "coc_director_apply"
        or provenance.get("producer") != "coc_director_apply"
        or str(provenance.get("decision_id") or "") != stable_decision
        or provenance.get("reason") != operation.get("reason")
        or provenance.get("previous_value") != event.get("previous_value")
        or provenance.get("changed_at") != event.get("ts")
        or positive_sequence(provenance.get("source_sequence"))
        != positive_sequence(head.get("source_sequence"))
        or str(event.get("live_head_digest") or "") != canonical_digest(head)
    ):
        return False
    body = {key: deepcopy(value) for key, value in receipt.items() if key != "integrity_digest"}
    return str(receipt.get("integrity_digest") or "") == canonical_digest(body)


def valid_director_flag_receipt_map(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    return all(
        valid_director_flag_receipt(receipt)
        and str(key)
        == director_flag_receipt_key(
            str(receipt.get("decision_id") or ""),
            str(receipt.get("flag_id") or ""),
        )
        for key, receipt in value.items()
    )


def apply_live_record(flags_doc: dict[str, Any], record: dict[str, Any]) -> None:
    flag_id = str(record.get("flag_id") or "")
    if not flag_id or record.get("schema_version") != 1:
        raise ValueError("invalid flag live record")
    flag_map = flags_doc.setdefault("flags", {})
    provenance_map = flags_doc.setdefault("flag_provenance", {})
    if not isinstance(flag_map, dict) or not isinstance(provenance_map, dict):
        raise ValueError("invalid canonical flag maps")
    if record.get("present") is True:
        flag_map[flag_id] = deepcopy(record.get("value"))
        provenance = record.get("provenance")
        if isinstance(provenance, dict):
            provenance_map[flag_id] = deepcopy(provenance)
        else:
            provenance_map.pop(flag_id, None)
    elif record.get("present") is False:
        flag_map.pop(flag_id, None)
        provenance_map.pop(flag_id, None)
    else:
        raise ValueError("invalid flag live record presence")


def commit_flag_mutation(
    flags_doc: dict[str, Any],
    *,
    flag_id: str,
    value: bool,
    decision_id: str,
    producer: str,
    changed_at: str,
    reason: str | None,
    source_ref: str,
    source_sequence: int,
    event_id: str | None = None,
    investigator_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Apply one flag transition and return event, provenance, entity head."""
    if not valid_flag_document_structure(flags_doc):
        raise ValueError("flag mutation requires the exact current document schema")
    stable_flag_id = str(flag_id)
    sequence = positive_sequence(source_sequence)
    if not stable_flag_id or sequence is None:
        raise ValueError("flag mutation requires a stable id and positive sequence")
    flag_map = flags_doc.setdefault("flags", {})
    provenance_map = flags_doc.setdefault("flag_provenance", {})
    head_map = flags_doc.setdefault("flag_heads", {})
    if not all(isinstance(value_map, dict) for value_map in (
        flag_map, provenance_map, head_map
    )):
        raise ValueError("invalid canonical flag maps")
    for stored_id, stored_head in head_map.items():
        if not valid_entity_head(
            stored_head, entity_kind="flag", entity_id=str(stored_id)
        ):
            raise ValueError("invalid canonical flag entity head")

    previous_value = deepcopy(flag_map.get(stable_flag_id))
    provenance = {
        "source": str(producer),
        "producer": str(producer),
        "source_ref": str(source_ref),
        "decision_id": str(decision_id),
        "changed_at": str(changed_at),
        "reason": reason,
        "previous_value": previous_value,
        "source_sequence": sequence,
    }
    flag_map[stable_flag_id] = bool(value)
    provenance_map[stable_flag_id] = deepcopy(provenance)
    flags_doc["schema_version"] = FLAG_DOCUMENT_SCHEMA_VERSION
    flags_doc["flag_source_sequence"] = sequence

    live_record = flag_live_record(flags_doc, stable_flag_id)
    head = entity_head(
        entity_kind="flag",
        entity_id=stable_flag_id,
        decision_id=str(decision_id),
        source_sequence=sequence,
        producer=str(producer),
        live_record=live_record,
    )
    head_map[stable_flag_id] = deepcopy(head)
    event = {
        "flag_mutation_schema_version": FLAG_MUTATION_SCHEMA_VERSION,
        "event_type": "flag_set",
        "flag_id": stable_flag_id,
        "value": bool(value),
        "previous_value": previous_value,
        "producer": str(producer),
        "reason": reason,
        "decision_id": str(decision_id),
        "ts": str(changed_at),
        "source_sequence": sequence,
        "live_head_digest": canonical_digest(head),
    }
    if event_id:
        event["event_id"] = str(event_id)
    if investigator_id:
        event["investigator_id"] = str(investigator_id)
    return event, provenance, head
