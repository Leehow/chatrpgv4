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


RECEIPT_DOCUMENT_SCHEMA_VERSION = 2
LEGACY_RECEIPT_DOCUMENT_SCHEMA_VERSION = 1
RECEIPT_SCHEMA_VERSION = 1
DECISION_SET_RECEIPT_SCHEMA_VERSION = 1
RECEIPT_FILENAME = "npc-engagement-receipts.json"
EVENT_TYPES = frozenset({"npc_engagement", "npc_agency"})


class NpcOperationSetConflict(ValueError):
    """One run/decision attempted a different immutable NPC operation set."""

    code = "idempotency_conflict"


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


def decision_set_receipt_id(
    *,
    producer: str,
    campaign_id: str,
    run_id: str,
    decision_id: str,
) -> str:
    """Stable source key intentionally independent of NPC/event payload."""
    encoded = json.dumps(
        [
            "npc-operation-set-v1",
            str(producer),
            str(campaign_id),
            str(run_id),
            str(decision_id),
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"npc-operation-set-v1:{hashlib.sha256(encoded).hexdigest()[:40]}"


def new_decision_set_receipt(
    *,
    producer: str,
    campaign_id: str,
    run_id: str,
    decision_id: str,
    operations: list[dict[str, Any]],
) -> dict[str, Any]:
    receipt = {
        "schema_version": DECISION_SET_RECEIPT_SCHEMA_VERSION,
        "receipt_id": decision_set_receipt_id(
            producer=producer,
            campaign_id=campaign_id,
            run_id=run_id,
            decision_id=decision_id,
        ),
        "producer": str(producer),
        "campaign_id": str(campaign_id),
        "run_id": str(run_id),
        "decision_id": str(decision_id),
        "operations": deepcopy(operations),
        "operation_set_digest": canonical_digest(operations),
    }
    receipt["integrity_digest"] = canonical_digest(receipt)
    return receipt


def valid_decision_set_receipt(receipt: Any) -> bool:
    if not isinstance(receipt, dict) or set(receipt) != {
        "schema_version",
        "receipt_id",
        "producer",
        "campaign_id",
        "run_id",
        "decision_id",
        "operations",
        "operation_set_digest",
        "integrity_digest",
    }:
        return False
    if receipt.get("schema_version") != DECISION_SET_RECEIPT_SCHEMA_VERSION:
        return False
    for key in ("receipt_id", "producer", "campaign_id", "run_id", "decision_id"):
        value = receipt.get(key)
        if not isinstance(value, str) or not value or value != value.strip():
            return False
    expected_id = decision_set_receipt_id(
        producer=receipt["producer"],
        campaign_id=receipt["campaign_id"],
        run_id=receipt["run_id"],
        decision_id=receipt["decision_id"],
    )
    operations = receipt.get("operations")
    if receipt.get("receipt_id") != expected_id or not isinstance(operations, list):
        return False
    for ordinal, operation in enumerate(operations):
        if not isinstance(operation, dict) or set(operation) != {
            "event_type", "ordinal", "scene_id", "npc_id", "payload"
        }:
            return False
        if operation.get("event_type") not in EVENT_TYPES:
            return False
        if operation.get("ordinal") != ordinal:
            return False
        npc_id = operation.get("npc_id")
        scene_id = operation.get("scene_id")
        if (
            not isinstance(npc_id, str)
            or not npc_id.strip()
            or not isinstance(scene_id, str)
            or not scene_id.strip()
        ):
            return False
        if not isinstance(operation.get("payload"), dict):
            return False
    if receipt.get("operation_set_digest") != canonical_digest(operations):
        return False
    body = {
        key: deepcopy(value)
        for key, value in receipt.items()
        if key != "integrity_digest"
    }
    return receipt.get("integrity_digest") == canonical_digest(body)


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
        "decision_sets": {},
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
    if not isinstance(payload, dict) or payload.get("campaign_id") != campaign_id:
        raise ValueError("NPC engagement receipt source has an invalid document contract")
    if payload.get("schema_version") == LEGACY_RECEIPT_DOCUMENT_SCHEMA_VERSION:
        if set(payload) != {"schema_version", "campaign_id", "receipts"}:
            raise ValueError("NPC engagement receipt source has an invalid legacy contract")
        payload = {
            "schema_version": RECEIPT_DOCUMENT_SCHEMA_VERSION,
            "campaign_id": campaign_id,
            "receipts": payload.get("receipts"),
            "decision_sets": {},
        }
    elif (
        payload.get("schema_version") != RECEIPT_DOCUMENT_SCHEMA_VERSION
        or set(payload) != {
            "schema_version", "campaign_id", "receipts", "decision_sets"
        }
    ):
        raise ValueError("NPC engagement receipt source has an invalid document contract")
    if not isinstance(payload.get("receipts"), dict) or not isinstance(
        payload.get("decision_sets"), dict
    ):
        raise ValueError("NPC engagement receipt source has invalid receipt maps")
    for event_id, receipt in payload["receipts"].items():
        if str(event_id) != str((receipt or {}).get("event_id") or "") or not valid_receipt(receipt):
            raise ValueError("NPC engagement source receipt failed integrity validation")
    for receipt_id, receipt in payload["decision_sets"].items():
        if (
            str(receipt_id) != str((receipt or {}).get("receipt_id") or "")
            or not valid_decision_set_receipt(receipt)
        ):
            raise ValueError("NPC operation-set receipt failed integrity validation")
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


def put_decision_set_receipt(
    document: dict[str, Any], receipt: dict[str, Any]
) -> bool:
    if not valid_decision_set_receipt(receipt):
        raise ValueError("cannot store an invalid NPC operation-set receipt")
    decision_sets = document.get("decision_sets")
    if not isinstance(decision_sets, dict):
        raise ValueError("NPC operation-set receipt map is invalid")
    receipt_id = str(receipt["receipt_id"])
    prior = decision_sets.get(receipt_id)
    if prior is not None:
        if prior != receipt:
            raise NpcOperationSetConflict(
                f"decision_id '{receipt['decision_id']}' was already applied to a different ordered NPC operation set"
            )
        return False
    decision_sets[receipt_id] = deepcopy(receipt)
    return True


_CAPABILITY_TOKEN = object()
ARTIFACT_BINDING_SCHEMA_VERSION = 1


class NpcCapabilityBindingError(ValueError):
    """Canonical chain does not belong to the evaluated play artifact."""

    code = "NON_COMPARABLE"


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


def _canonical_chain_material(
    campaign_dir: Path,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any],
]:
    campaign = Path(campaign_dir).resolve()
    campaign_id = resolve_campaign_id(campaign)
    events_path = campaign / "logs" / "events.jsonl"
    try:
        raw = events_path.read_bytes() if events_path.is_file() else b""
    except OSError as exc:
        raise ValueError("canonical campaign events are unreadable") from exc
    try:
        event_text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("canonical campaign events are not UTF-8") from exc
    rows: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(event_text.splitlines(), start=1):
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

    receipt_path = campaign / "save" / RECEIPT_FILENAME
    try:
        receipt_raw = receipt_path.read_bytes() if receipt_path.is_file() else b""
        receipt_text = receipt_raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ValueError("canonical NPC receipt source is unreadable") from exc
    source_manifest = {
        "source_path": events_path.relative_to(campaign).as_posix(),
        "source_digest": file_digest(raw),
        "source_line_count": len(event_text.splitlines()),
        "event_object_count": len(rows),
        "campaign_id": campaign_id,
        "event_run_ids": sorted(bound_run_ids),
        "receipt_source_path": f"save/{RECEIPT_FILENAME}",
        "receipt_source_digest": file_digest(receipt_raw),
        "receipt_source_line_count": len(receipt_text.splitlines()),
        "receipt_count": len(receipt_map),
        "decision_set_count": len(document.get("decision_sets") or {}),
    }
    return rows, trusted_rows, source_manifest


def _artifact_binding_body(binding: Any) -> dict[str, Any] | None:
    if not isinstance(binding, dict) or set(binding) != {
        "schema_version",
        "campaign_id",
        "artifact_run_id",
        "cumulative_run_ids",
        "source_path",
        "source_digest",
        "source_line_count",
        "event_object_count",
        "event_run_ids",
        "receipt_source_path",
        "receipt_source_digest",
        "receipt_source_line_count",
        "receipt_count",
        "decision_set_count",
        "integrity_digest",
    }:
        return None
    if binding.get("schema_version") != ARTIFACT_BINDING_SCHEMA_VERSION:
        return None
    for key in (
        "campaign_id", "artifact_run_id", "source_path", "source_digest",
        "receipt_source_path", "receipt_source_digest",
    ):
        value = binding.get(key)
        if not isinstance(value, str) or not value or value != value.strip():
            return None
    cumulative = binding.get("cumulative_run_ids")
    event_runs = binding.get("event_run_ids")
    if (
        not isinstance(cumulative, list)
        or not cumulative
        or any(not isinstance(value, str) or not value for value in cumulative)
        or cumulative != list(dict.fromkeys(cumulative))
        or cumulative[-1] != binding.get("artifact_run_id")
        or not isinstance(event_runs, list)
        or any(not isinstance(value, str) or not value for value in event_runs)
        or event_runs != sorted(set(event_runs))
    ):
        return None
    for key in (
        "source_line_count", "event_object_count", "receipt_source_line_count",
        "receipt_count", "decision_set_count",
    ):
        value = binding.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            return None
    body = {
        key: deepcopy(value)
        for key, value in binding.items()
        if key != "integrity_digest"
    }
    if binding.get("integrity_digest") != canonical_digest(body):
        return None
    return body


def build_artifact_binding(
    campaign_dir: Path,
    *,
    artifact_run_id: str,
    cumulative_run_ids: list[str],
) -> dict[str, Any]:
    """Bind a play artifact identity to the exact canonical source snapshot."""
    run_id = str(artifact_run_id).strip()
    cumulative = [str(value).strip() for value in cumulative_run_ids]
    if (
        not run_id
        or not cumulative
        or any(not value for value in cumulative)
        or cumulative != list(dict.fromkeys(cumulative))
        or cumulative[-1] != run_id
    ):
        raise ValueError("artifact run binding is invalid")
    _rows, _trusted, source = _canonical_chain_material(Path(campaign_dir))
    body = {
        "schema_version": ARTIFACT_BINDING_SCHEMA_VERSION,
        **source,
        "artifact_run_id": run_id,
        "cumulative_run_ids": cumulative,
    }
    body["integrity_digest"] = canonical_digest(body)
    return body


def capability_matches_artifact_binding(
    capability: _CanonicalNpcEventChain,
    binding: dict[str, Any],
) -> bool:
    if not is_canonical_capability(capability):
        return False
    body = _artifact_binding_body(binding)
    if body is None:
        return False
    _rows, _trusted, manifest = capability_rows(capability)
    return (
        manifest.get("schema_version") == 2
        and manifest.get("artifact_binding") == body
        and manifest.get("binding_integrity_digest")
        == binding.get("integrity_digest")
    )


def load_canonical_chain(
    campaign_dir: Path,
    *,
    expected_campaign_id: str,
    expected_artifact_run_id: str,
    expected_cumulative_run_ids: list[str],
    expected_binding: dict[str, Any],
) -> _CanonicalNpcEventChain:
    """Load a canonical chain only when it matches the evaluated play."""
    binding_body = _artifact_binding_body(expected_binding)
    expected_campaign = str(expected_campaign_id).strip()
    expected_run = str(expected_artifact_run_id).strip()
    expected_cumulative = [str(value).strip() for value in expected_cumulative_run_ids]
    if (
        binding_body is None
        or not expected_campaign
        or not expected_run
        or not expected_cumulative
        or binding_body.get("campaign_id") != expected_campaign
        or binding_body.get("artifact_run_id") != expected_run
        or binding_body.get("cumulative_run_ids") != expected_cumulative
    ):
        raise NpcCapabilityBindingError(
            "NPC event-chain binding does not match the evaluated play identity"
        )
    rows, trusted_rows, source_manifest = _canonical_chain_material(
        Path(campaign_dir)
    )
    if any(
        binding_body.get(key) != value
        for key, value in source_manifest.items()
    ):
        raise NpcCapabilityBindingError(
            "NPC event-chain source path, digest, cardinality, campaign, or run binding changed"
        )
    manifest = {
        "schema_version": 2,
        "artifact_binding": deepcopy(binding_body),
        "binding_integrity_digest": expected_binding["integrity_digest"],
    }
    return _CanonicalNpcEventChain(
        _CAPABILITY_TOKEN,
        rows=rows,
        trusted_rows=trusted_rows,
        manifest=manifest,
    )
