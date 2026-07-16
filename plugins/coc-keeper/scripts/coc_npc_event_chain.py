#!/usr/bin/env python3
"""Source-owned NPC engagement receipts and canonical event-chain loading.

Identity bindings prove *which* authored NPC was selected.  This module adds
the independent persistence proof required before an engagement can count as
canonical coverage: a source receipt bound to campaign, run, decision, scene,
stable event identity, and the exact append-only event row.

The capability returned by :func:`load_canonical_chain` is intentionally
opaque.  Public adherence APIs never accept event rows or this capability;
only the internal campaign loader constructs it from on-disk artifacts.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any


RECEIPT_DOCUMENT_SCHEMA_VERSION = 1
RECEIPT_SCHEMA_VERSION = 1
RECEIPT_FILENAME = "npc-engagement-receipts.json"
EVENT_TYPES = frozenset({"npc_engagement", "npc_agency"})


def canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def file_digest(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def resolve_campaign_id(campaign_dir: Path) -> str:
    campaign = Path(campaign_dir)
    meta_path = campaign / "campaign.json"
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            meta = {}
        if isinstance(meta, dict) and isinstance(meta.get("campaign_id"), str):
            value = meta["campaign_id"].strip()
            if value:
                return value
    return campaign.name


def resolve_run_id(
    campaign_dir: Path,
    *,
    structured_source: dict[str, Any] | None = None,
) -> str:
    """Resolve a stable structured run binding without interpreting prose."""
    source = structured_source if isinstance(structured_source, dict) else {}
    turn_input = source.get("turn_input")
    turn_input = turn_input if isinstance(turn_input, dict) else {}
    for candidate in (
        source.get("run_id"),
        source.get("session_id"),
        turn_input.get("run_id"),
        turn_input.get("session_id"),
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    for path in (
        Path(campaign_dir) / "campaign.json",
        Path(campaign_dir) / "save" / "world-state.json",
    ):
        if not path.is_file():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        for key in ("run_id", "session_id", "logical_session_id"):
            candidate = payload.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
    return f"campaign:{resolve_campaign_id(Path(campaign_dir))}"


def stable_event_id(
    *,
    producer: str,
    campaign_id: str,
    run_id: str,
    decision_id: str,
    scene_id: str,
    npc_id: str,
    event_type: str,
    ordinal: int,
) -> str:
    encoded = json.dumps(
        [
            "npc-engagement-v1",
            str(producer),
            str(campaign_id),
            str(run_id),
            str(decision_id),
            str(scene_id),
            str(npc_id),
            str(event_type),
            int(ordinal),
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"npc-engagement-v1:{hashlib.sha256(encoded).hexdigest()[:40]}"


def new_receipt(
    *,
    producer: str,
    campaign_id: str,
    run_id: str,
    decision_id: str,
    scene_id: str,
    npc_id: str,
    event_type: str,
    ordinal: int,
    operation: dict[str, Any],
    event: dict[str, Any],
) -> dict[str, Any]:
    receipt = {
        "schema_version": RECEIPT_SCHEMA_VERSION,
        "producer": str(producer),
        "campaign_id": str(campaign_id),
        "run_id": str(run_id),
        "decision_id": str(decision_id),
        "scene_id": str(scene_id),
        "npc_id": str(npc_id),
        "event_type": str(event_type),
        "ordinal": int(ordinal),
        "operation": deepcopy(operation),
        "operation_digest": canonical_digest(operation),
        "event_id": str(event.get("event_id") or ""),
        "event": deepcopy(event),
    }
    receipt["integrity_digest"] = canonical_digest(receipt)
    return receipt


def valid_receipt(receipt: Any) -> bool:
    if not isinstance(receipt, dict) or set(receipt) != {
        "schema_version",
        "producer",
        "campaign_id",
        "run_id",
        "decision_id",
        "scene_id",
        "npc_id",
        "event_type",
        "ordinal",
        "operation",
        "operation_digest",
        "event_id",
        "event",
        "integrity_digest",
    }:
        return False
    if receipt.get("schema_version") != RECEIPT_SCHEMA_VERSION:
        return False
    strings = (
        "producer", "campaign_id", "run_id", "decision_id", "scene_id",
        "npc_id", "event_type", "event_id",
    )
    if any(
        not isinstance(receipt.get(key), str)
        or not receipt[key]
        or receipt[key] != receipt[key].strip()
        for key in strings
    ):
        return False
    if receipt["event_type"] not in EVENT_TYPES:
        return False
    ordinal = receipt.get("ordinal")
    if isinstance(ordinal, bool) or not isinstance(ordinal, int) or ordinal < 0:
        return False
    operation = receipt.get("operation")
    event = receipt.get("event")
    if not isinstance(operation, dict) or not isinstance(event, dict):
        return False
    expected_event_id = stable_event_id(
        producer=receipt["producer"],
        campaign_id=receipt["campaign_id"],
        run_id=receipt["run_id"],
        decision_id=receipt["decision_id"],
        scene_id=receipt["scene_id"],
        npc_id=receipt["npc_id"],
        event_type=receipt["event_type"],
        ordinal=ordinal,
    )
    if (
        receipt.get("operation_digest") != canonical_digest(operation)
        or receipt.get("event_id") != expected_event_id
        or event.get("event_id") != expected_event_id
        or event.get("event_type") != receipt["event_type"]
        or event.get("producer") != receipt["producer"]
        or event.get("campaign_id") != receipt["campaign_id"]
        or event.get("run_id") != receipt["run_id"]
        or event.get("decision_id") != receipt["decision_id"]
        or event.get("scene_id") != receipt["scene_id"]
        or event.get("npc_id") != receipt["npc_id"]
        or event.get("source_receipt_schema_version") != RECEIPT_SCHEMA_VERSION
    ):
        return False
    body = {
        key: deepcopy(value)
        for key, value in receipt.items()
        if key != "integrity_digest"
    }
    return receipt.get("integrity_digest") == canonical_digest(body)


def empty_document(campaign_id: str) -> dict[str, Any]:
    return {
        "schema_version": RECEIPT_DOCUMENT_SCHEMA_VERSION,
        "campaign_id": str(campaign_id),
        "receipts": {},
    }


def load_receipt_document(campaign_dir: Path) -> dict[str, Any]:
    campaign = Path(campaign_dir)
    campaign_id = resolve_campaign_id(campaign)
    path = campaign / "save" / RECEIPT_FILENAME
    if not path.is_file():
        return empty_document(campaign_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("NPC engagement receipt source is unreadable") from exc
    if (
        not isinstance(payload, dict)
        or set(payload) != {"schema_version", "campaign_id", "receipts"}
        or payload.get("schema_version") != RECEIPT_DOCUMENT_SCHEMA_VERSION
        or payload.get("campaign_id") != campaign_id
        or not isinstance(payload.get("receipts"), dict)
    ):
        raise ValueError("NPC engagement receipt source has an invalid document contract")
    for event_id, receipt in payload["receipts"].items():
        if str(event_id) != str((receipt or {}).get("event_id") or "") or not valid_receipt(receipt):
            raise ValueError("NPC engagement source receipt failed integrity validation")
    return payload


def put_receipt(document: dict[str, Any], receipt: dict[str, Any]) -> bool:
    if not valid_receipt(receipt):
        raise ValueError("cannot store an invalid NPC engagement receipt")
    receipts = document.get("receipts")
    if not isinstance(receipts, dict):
        raise ValueError("NPC engagement receipt map is invalid")
    event_id = str(receipt["event_id"])
    prior = receipts.get(event_id)
    if prior is not None:
        if prior != receipt:
            raise ValueError(f"NPC engagement event '{event_id}' has a conflicting source receipt")
        return False
    receipts[event_id] = deepcopy(receipt)
    return True


_CAPABILITY_TOKEN = object()


class _CanonicalNpcEventChain:
    """Opaque, loader-owned capability consumed only by adherence internals."""

    __slots__ = ("_rows", "_trusted_rows", "_manifest", "_token")

    def __init__(
        self,
        token: object,
        *,
        rows: list[dict[str, Any]],
        trusted_rows: list[dict[str, Any]],
        manifest: dict[str, Any],
    ) -> None:
        if token is not _CAPABILITY_TOKEN:
            raise TypeError("canonical NPC event-chain capabilities are loader-owned")
        self._token = token
        self._rows = tuple(deepcopy(rows))
        self._trusted_rows = tuple(deepcopy(trusted_rows))
        self._manifest = deepcopy(manifest)


def is_canonical_capability(value: Any) -> bool:
    return isinstance(value, _CanonicalNpcEventChain) and value._token is _CAPABILITY_TOKEN


def capability_rows(
    capability: _CanonicalNpcEventChain,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    if not is_canonical_capability(capability):
        raise TypeError("invalid canonical NPC event-chain capability")
    return (
        deepcopy(list(capability._rows)),
        deepcopy(list(capability._trusted_rows)),
        deepcopy(capability._manifest),
    )


def load_canonical_chain(campaign_dir: Path) -> _CanonicalNpcEventChain:
    """Load and verify the actual campaign event chain and source receipts."""
    campaign = Path(campaign_dir).resolve()
    campaign_id = resolve_campaign_id(campaign)
    events_path = campaign / "logs" / "events.jsonl"
    try:
        raw = events_path.read_bytes() if events_path.is_file() else b""
    except OSError as exc:
        raise ValueError("canonical campaign events are unreadable") from exc
    rows: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(raw.decode("utf-8").splitlines(), start=1):
        if not raw_line.strip():
            continue
        try:
            row = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"canonical campaign event line {line_number} is malformed"
            ) from exc
        if not isinstance(row, dict):
            raise ValueError(f"canonical campaign event line {line_number} is not an object")
        rows.append(row)

    document = load_receipt_document(campaign)
    receipt_map = document["receipts"]
    by_event_id: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        event_id = row.get("event_id")
        if isinstance(event_id, str) and event_id:
            by_event_id.setdefault(event_id, []).append(row)

    trusted_rows: list[dict[str, Any]] = []
    bound_run_ids: set[str] = set()
    for event_id, receipt in receipt_map.items():
        if receipt.get("campaign_id") != campaign_id:
            raise ValueError("NPC engagement receipt campaign binding mismatch")
        matches = by_event_id.get(str(event_id), [])
        if len(matches) != 1 or matches[0] != receipt["event"]:
            raise ValueError(
                f"NPC engagement receipt '{event_id}' has missing, duplicate, or conflicting canonical event evidence"
            )
        trusted_rows.append(deepcopy(matches[0]))
        bound_run_ids.add(str(receipt["run_id"]))

    relative = events_path.relative_to(campaign).as_posix()
    manifest = {
        "schema_version": 1,
        "source_path": relative,
        "source_digest": file_digest(raw),
        "line_count": len(raw.decode("utf-8").splitlines()),
        "event_object_count": len(rows),
        "campaign_id": campaign_id,
        "run_ids": sorted(bound_run_ids),
        "receipt_source_path": f"save/{RECEIPT_FILENAME}",
        "receipt_count": len(receipt_map),
    }
    return _CanonicalNpcEventChain(
        _CAPABILITY_TOKEN,
        rows=rows,
        trusted_rows=trusted_rows,
        manifest=manifest,
    )
