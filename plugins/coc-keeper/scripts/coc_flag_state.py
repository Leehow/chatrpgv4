#!/usr/bin/env python3
"""Shared structured flag mutation contract.

Both the Keeper toolbox and the deterministic director persist world flags.
This module keeps their producer fields, causal order, live provenance, and
entity-head integrity identical without interpreting narrative prose.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from typing import Any, Iterable


FLAG_MUTATION_SCHEMA_VERSION = 1
FLAG_HEAD_SCHEMA_VERSION = 1
FLAG_DOCUMENT_SCHEMA_VERSION = 3


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


def next_source_sequence(
    flags_doc: dict[str, Any],
    event_rows: Iterable[dict[str, Any]] = (),
) -> int:
    stored = positive_sequence(flags_doc.get("flag_source_sequence")) or 0
    event_max = max(
        (
            positive_sequence(row.get("source_sequence")) or 0
            for row in event_rows
            if isinstance(row, dict) and row.get("event_type") == "flag_set"
        ),
        default=0,
    )
    head_map = flags_doc.get("flag_heads")
    head_max = max(
        (
            positive_sequence(head.get("source_sequence")) or 0
            for head in (head_map or {}).values()
            if isinstance(head, dict)
        ),
        default=0,
    ) if isinstance(head_map, dict) else 0
    return max(stored, event_max, head_max) + 1


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
    return bool(
        isinstance(live_record, dict)
        and str(head.get("live_record_digest") or "")
        == canonical_digest(live_record)
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
    flags_doc["schema_version"] = max(
        int(flags_doc.get("schema_version") or 1), FLAG_DOCUMENT_SCHEMA_VERSION
    )
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


def project_flag_event(row: dict[str, Any], *, source_ref: str) -> dict[str, Any]:
    """Project current and genuine legacy flag_set rows without prose inference."""
    structured = row.get("flag_mutation_schema_version") == FLAG_MUTATION_SCHEMA_VERSION
    has_value = isinstance(row.get("value"), bool)
    # Legacy ``flag_set`` has explicit structured set semantics even though its
    # producer predated a value field.  It therefore means True, never
    # ``bool(None) == False``.
    value = bool(row.get("value")) if has_value else True
    producer = str(row.get("producer") or (
        "legacy.flag_set" if not structured else "unknown.flag_producer"
    ))
    return {
        "flag_id": str(row.get("flag_id")),
        "value": value,
        "provenance": {
            "source": producer,
            "producer": producer,
            "source_ref": source_ref,
            "decision_id": row.get("decision_id"),
            "changed_at": row.get("ts"),
            "reason": row.get("reason"),
            "previous_value": row.get("previous_value"),
            "source_sequence": row.get("source_sequence"),
            "legacy_compatibility": not structured,
        },
    }
