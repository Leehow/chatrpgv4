#!/usr/bin/env python3
"""Pure JSONL event/receipt extraction for the authority history projection.

Schema generation ``history-projection-2``. This module is a pure function
layer: it consumes one scanner-produced ``commit_record`` (tracked file texts
already in memory) and returns deterministic, insertion-ready rows for the
``events`` / ``receipts`` / ``rolls`` / ``effects`` / ``transactions`` /
``backlog`` tables defined by ``coc_history_projection_schema``. Every row
mapping carries exactly its table's columns — a facade binds and inserts them
verbatim with no field translation or identity invention. The module never
touches the filesystem, Git, or SQLite, and records no wall-clock fields.

Authority contract:

- **Commit-authoritative provenance.** The ``commit_sha``, ``timeline_id`` and
  ``turn_number`` columns always come from the commit record. Payload values
  for those keys never relocate a row to another worldline or turn; they
  survive only verbatim inside ``payload_json``.
- **Canonical identities from structured keys only.** ``roll_id``,
  ``effect_id``, ``transaction_id``, and ``finalization_id``/``receipt_id``
  become the row's primary-key column when present. Rows without a canonical
  identity get a deterministic commit-inclusive source id
  (``hist-<kind>:<sha>:<path>:<ordinal>``), so ids never collide across
  commits or branches. Classification and identity never read narration
  prose; numeric truth stays inside the verbatim payload JSON.
- **Every non-blank source line survives exactly once.** Classified rows keep
  the canonical payload JSON + SHA-256 and source path/ordinal. Malformed
  lines and intra-commit duplicate canonical ids become insertion-ready
  backlog rows carrying the raw evidence — nothing silently disappears.
- **Privacy fields pass through verbatim** inside ``payload_json`` only
  (``visibility`` / ``secret`` / ``player_visible`` / ...); they never
  influence classification, provenance, or identity.

Cross-commit note: append-only logs replay the same canonical roll/receipt
in later commit snapshots, so one campaign scan yields repeated canonical
primary keys across commits. Extraction of a single commit is collision-free
by construction; the facade inserts commits in topo order with
first-occurrence-wins (``INSERT OR IGNORE``) on canonical primary keys.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

SCHEMA_GENERATION = "history-projection-2"

# Tracked log faces this extractor consumes. ``logs`` is a flat directory
# (``logs/<name>.jsonl`` only; ``logs/pending-turns/`` stays an ignore face).
# Temporal memory records may nest under ``memory/temporal/``.
LOGS_PATH_PREFIX = "logs/"
TEMPORAL_PATH_PREFIX = "memory/temporal/"
JSONL_SUFFIX = ".jsonl"

ROW_EVENT = "event"
ROW_RECEIPT = "receipt"
ROW_ROLL = "roll"
ROW_EFFECT = "effect"
ROW_TRANSACTION = "transaction"
ROW_BACKLOG = "backlog"

BACKLOG_REASON_INVALID_JSON = "invalid_json"
BACKLOG_REASON_NOT_OBJECT = "row_not_object"
BACKLOG_KIND_DUPLICATE_CANONICAL_ID = "duplicate_canonical_id"

DEFAULT_EVENT_TYPE = "jsonl_row"
DEFAULT_RECEIPT_TYPE = "receipt"

# Explicit type-marker keys checked for classification and row labeling.
_TYPE_MARKER_KEYS: tuple[str, ...] = (
    "event_type", "type", "kind", "record_type", "record_kind",
)
_ROLL_TYPE_VALUES = frozenset({"roll"})
_RECEIPT_TYPE_VALUES = frozenset(
    {"receipt", "finalization", "turn_finalization", "turn-finalization"}
)
_TRANSACTION_TYPE_VALUES = frozenset({"transaction"})
_EFFECT_TYPE_VALUES = frozenset({"effect"})

# Canonical identity keys per row kind, lifted verbatim from structured
# payload keys only. A receipt's identity is its finalization (or an explicit
# ``receipt_id``); an effect's owning entity is its explicit ``entity_id``,
# else its investigator/NPC reference. Detection is key-membership only;
# values are never mined from prose.
_RECEIPT_ID_KEYS: tuple[str, ...] = ("finalization_id", "receipt_id")
_RECEIPT_TYPE_KEYS: tuple[str, ...] = ("receipt_type", "receipt_kind")
_EFFECT_ENTITY_KEYS: tuple[str, ...] = ("entity_id", "investigator_id", "npc_id")


class EventExtractionError(ValueError):
    """Commit record shape is invalid; extraction cannot proceed fail-closed."""


def canonical_json(value: Any) -> str:
    """Canonical projection JSON: sorted keys, compact separators, no NaN.

    Matches ``coc_history_projection_schema.canonical_json`` so payload
    digests agree with the storage encoding; non-finite floats fail closed.
    """
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def payload_digest(value: Any) -> str:
    """SHA-256 of the canonical JSON — machine-internal integrity evidence."""
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _reject_constant(token: str) -> float:
    raise ValueError(f"non-standard JSON constant: {token}")


def is_extractable_log_path(path: str) -> bool:
    """True for tracked ``logs/<name>.jsonl`` and ``memory/temporal/**.jsonl``."""
    if not isinstance(path, str) or not path.endswith(JSONL_SUFFIX):
        return False
    if path.startswith(LOGS_PATH_PREFIX):
        rest = path[len(LOGS_PATH_PREFIX):]
        return bool(rest) and "/" not in rest
    if path.startswith(TEMPORAL_PATH_PREFIX):
        rest = path[len(TEMPORAL_PATH_PREFIX):]
        return bool(rest) and not rest.endswith("/")
    return False


def _explicit_marker_values(row: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for key in _TYPE_MARKER_KEYS:
        value = row.get(key)
        if isinstance(value, str) and value:
            values.append(value)
    return values


def _has_type_marker(row: dict[str, Any], allowed: frozenset[str]) -> bool:
    return any(value in allowed for value in _explicit_marker_values(row))


def _nonempty_str(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None


def classify_row(row: Any) -> str:
    """Classify one parsed JSONL row from explicit keys/enums only.

    Precedence resolves rows carrying several markers. Rarer structural
    identities outrank the common mechanical one: receipt, then transaction,
    then effect, then roll; anything else is a generic event. An effect row
    referencing its causing ``roll_id`` stays an effect — ``effect_id`` is the
    row's own identity, ``roll_id`` the cross-reference (and vice versa: a
    canonical roll row carries ``roll_id`` and never ``effect_id``). Prose
    never classifies.
    """
    if not isinstance(row, dict):
        return ROW_EVENT
    if (
        _nonempty_str(row.get("finalization_id"))
        or _nonempty_str(row.get("receipt_id"))
        or _nonempty_str(row.get("receipt_type"))
        or _nonempty_str(row.get("receipt_kind"))
        or _has_type_marker(row, _RECEIPT_TYPE_VALUES)
    ):
        return ROW_RECEIPT
    if _nonempty_str(row.get("transaction_id")) or _has_type_marker(
        row, _TRANSACTION_TYPE_VALUES
    ):
        return ROW_TRANSACTION
    if _nonempty_str(row.get("effect_id")) or _has_type_marker(
        row, _EFFECT_TYPE_VALUES
    ):
        return ROW_EFFECT
    if _nonempty_str(row.get("roll_id")) or _has_type_marker(
        row, _ROLL_TYPE_VALUES
    ):
        return ROW_ROLL
    return ROW_EVENT


def _first_nonempty(row: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = _nonempty_str(row.get(key))
        if value is not None:
            return value
    return None


def _canonical_id(row_kind: str, row: dict[str, Any]) -> str | None:
    """Canonical primary-key identity lifted from explicit structured keys."""
    if row_kind == ROW_RECEIPT:
        return _first_nonempty(row, _RECEIPT_ID_KEYS)
    if row_kind == ROW_ROLL:
        return _nonempty_str(row.get("roll_id"))
    if row_kind == ROW_EFFECT:
        return _nonempty_str(row.get("effect_id"))
    if row_kind == ROW_TRANSACTION:
        return _nonempty_str(row.get("transaction_id"))
    return None


def _receipt_type(row: dict[str, Any]) -> str:
    value = _first_nonempty(row, _RECEIPT_TYPE_KEYS)
    if value is not None:
        return value
    markers = _explicit_marker_values(row)
    if markers:
        return markers[0]
    return DEFAULT_RECEIPT_TYPE


def _row_event_type(row: dict[str, Any]) -> str:
    for key in _TYPE_MARKER_KEYS:
        value = _nonempty_str(row.get(key))
        if value is not None:
            return value
    return DEFAULT_EVENT_TYPE


def _effect_entity_id(row: dict[str, Any]) -> str | None:
    return _first_nonempty(row, _EFFECT_ENTITY_KEYS)


def row_event_id(row_kind: str, commit_sha: str, path: str, ordinal: int) -> str:
    """Deterministic semantic source-row id, unique per (commit, path, line).

    Commit identity is part of the id, so the same timeline/path/ordinal in
    another commit or branch can never collide with this row.
    """
    return f"hist-{row_kind}:{commit_sha}:{path}:{ordinal}"


def _validate_commit_record(commit_record: Any) -> dict[str, Any]:
    if not isinstance(commit_record, dict):
        raise EventExtractionError("commit_record must be an object")
    for key in ("sha", "campaign_id"):
        if not _nonempty_str(commit_record.get(key)):
            raise EventExtractionError(f"commit_record.{key} must be a non-empty string")
    timeline_id = commit_record.get("timeline_id")
    if not isinstance(timeline_id, str):
        raise EventExtractionError("commit_record.timeline_id must be a string")
    turn_number = commit_record.get("turn_number")
    if turn_number is not None and (
        isinstance(turn_number, bool) or not isinstance(turn_number, int)
    ):
        raise EventExtractionError(
            "commit_record.turn_number must be an integer or null"
        )
    files = commit_record.get("files", [])
    if not isinstance(files, list):
        raise EventExtractionError("commit_record.files must be a list")
    return commit_record


def _ordered_log_texts(commit_record: dict[str, Any]) -> list[tuple[str, str]]:
    """Extractable file texts, deterministic by path, duplicate paths dropped."""
    entries: list[tuple[str, str, str]] = []
    for index, entry in enumerate(commit_record.get("files", [])):
        if not isinstance(entry, dict):
            continue
        path = entry.get("path")
        text = entry.get("text")
        if not _nonempty_str(path) or not isinstance(text, str):
            continue
        if not is_extractable_log_path(path):
            continue
        blob_sha = entry.get("blob_sha")
        blob_key = blob_sha if isinstance(blob_sha, str) else ""
        entries.append((path, blob_key, text))
    entries.sort(key=lambda item: (item[0], item[1]))
    ordered: list[tuple[str, str]] = []
    seen_paths: set[str] = set()
    for path, _blob_key, text in entries:
        if path in seen_paths:
            continue
        seen_paths.add(path)
        ordered.append((path, text))
    return ordered


def _backlog_row(
    backlog_id: str,
    kind: str,
    commit_sha: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Insertion-ready ``backlog`` row; evidence lives in canonical payload."""
    return {
        "backlog_id": backlog_id,
        "kind": kind,
        "commit_sha": commit_sha,
        "payload_sha256": payload_digest(payload),
        "payload_json": canonical_json(payload),
    }


def _source_provenance(
    path: str, ordinal: int, timeline_id: str, turn_number: int | None
) -> dict[str, Any]:
    return {
        "source_ordinal": ordinal,
        "source_path": path,
        "timeline_id": timeline_id,
        "turn_number": turn_number,
    }


def extract_events(commit_record: dict[str, Any]) -> dict[str, Any]:
    """Project one commit record's JSONL logs into insertion-ready row lists.

    Returns ``{"events", "receipts", "rolls", "effects", "transactions",
    "backlog"}``. Each row mapping carries exactly its schema table's columns
    (generic ``events`` rows carry ``event_id: None`` — SQLite assigns the
    INTEGER primary key deterministically from insertion order, and every
    list is ordered by ``(source_path, source_ordinal)``).

    Indexed provenance (``commit_sha`` / ``timeline_id`` / ``turn_number``)
    always comes from the commit record; conflicting payload values for those
    keys remain only inside the verbatim ``payload_json``. Canonical
    identities (``receipt_id`` / ``roll_id`` / ``effect_id`` /
    ``transaction_id``) are lifted from explicit structured payload keys;
    identity-less rows get deterministic commit-inclusive source ids.

    Every non-blank source line survives exactly once. Lines that fail to
    parse (including non-standard JSON constants) or parse to a non-object,
    and rows repeating a canonical id already claimed within this commit,
    become insertion-ready backlog rows carrying the raw evidence.
    """
    commit = _validate_commit_record(commit_record)
    sha = commit["sha"]
    commit_timeline = commit["timeline_id"]
    commit_turn = commit.get("turn_number")

    rows_by_kind: dict[str, list[dict[str, Any]]] = {
        ROW_EVENT: [],
        ROW_RECEIPT: [],
        ROW_ROLL: [],
        ROW_EFFECT: [],
        ROW_TRANSACTION: [],
        ROW_BACKLOG: [],
    }
    seen_canonical: set[tuple[str, str]] = set()

    def backlog_source_row(
        path: str,
        ordinal: int,
        kind: str,
        payload: dict[str, Any],
    ) -> None:
        rows_by_kind[ROW_BACKLOG].append(
            _backlog_row(
                row_event_id(ROW_BACKLOG, sha, path, ordinal),
                kind,
                sha,
                {
                    **payload,
                    **_source_provenance(
                        path, ordinal, commit_timeline, commit_turn
                    ),
                },
            )
        )

    for path, text in _ordered_log_texts(commit):
        # Split on "\n" (not str.splitlines) so U+2028/U+0085 inside JSON
        # strings can never shift physical line ordinals.
        for ordinal, segment in enumerate(text.split("\n"), start=1):
            if not segment.strip():
                continue
            stripped = segment[:-1] if segment.endswith("\r") else segment
            try:
                # parse_constant rejects NaN/Infinity: the storage encoding
                # (schema canonical JSON) cannot represent them, so such
                # lines are deterministic backlog evidence, not stored data.
                parsed = json.loads(stripped, parse_constant=_reject_constant)
            except ValueError:
                backlog_source_row(
                    path, ordinal, BACKLOG_REASON_INVALID_JSON,
                    {"raw_line": segment},
                )
                continue
            if not isinstance(parsed, dict):
                backlog_source_row(
                    path, ordinal, BACKLOG_REASON_NOT_OBJECT,
                    {"raw_line": segment},
                )
                continue
            try:
                payload_text = canonical_json(parsed)
            except ValueError:
                backlog_source_row(
                    path, ordinal, BACKLOG_REASON_INVALID_JSON,
                    {"raw_line": segment},
                )
                continue
            row_kind = classify_row(parsed)
            canonical = _canonical_id(row_kind, parsed)
            if canonical is not None:
                canonical_key = (row_kind, canonical)
                if canonical_key in seen_canonical:
                    # Same canonical id twice within one commit would collide
                    # on the primary key; the replay becomes backlog evidence
                    # and the first occurrence keeps the canonical identity.
                    backlog_source_row(
                        path, ordinal, BACKLOG_KIND_DUPLICATE_CANONICAL_ID,
                        {"canonical_id": canonical, "row": parsed},
                    )
                    continue
                seen_canonical.add(canonical_key)

            row_id = canonical if canonical is not None else row_event_id(
                row_kind, sha, path, ordinal
            )
            digest = hashlib.sha256(payload_text.encode("utf-8")).hexdigest()
            provenance = {
                "commit_sha": sha,
                "timeline_id": commit_timeline,
                "turn_number": commit_turn,
            }
            if row_kind == ROW_EVENT:
                rows_by_kind[ROW_EVENT].append({
                    "event_id": None,
                    **provenance,
                    "source_path": path,
                    "source_ordinal": ordinal,
                    "event_type": _row_event_type(parsed),
                    "payload_sha256": digest,
                    "payload_json": payload_text,
                })
            elif row_kind == ROW_RECEIPT:
                rows_by_kind[ROW_RECEIPT].append({
                    "receipt_id": row_id,
                    **provenance,
                    "receipt_type": _receipt_type(parsed),
                    "payload_sha256": digest,
                    "payload_json": payload_text,
                })
            elif row_kind == ROW_ROLL:
                rows_by_kind[ROW_ROLL].append({
                    "roll_id": row_id,
                    **provenance,
                    "source_path": path,
                    "payload_sha256": digest,
                    "payload_json": payload_text,
                })
            elif row_kind == ROW_EFFECT:
                rows_by_kind[ROW_EFFECT].append({
                    "effect_id": row_id,
                    **provenance,
                    "entity_id": _effect_entity_id(parsed),
                    "source_path": path,
                    "payload_sha256": digest,
                    "payload_json": payload_text,
                })
            else:
                rows_by_kind[ROW_TRANSACTION].append({
                    "transaction_id": row_id,
                    **provenance,
                    "source_path": path,
                    "payload_sha256": digest,
                    "payload_json": payload_text,
                })

    return {
        "events": rows_by_kind[ROW_EVENT],
        "receipts": rows_by_kind[ROW_RECEIPT],
        "rolls": rows_by_kind[ROW_ROLL],
        "effects": rows_by_kind[ROW_EFFECT],
        "transactions": rows_by_kind[ROW_TRANSACTION],
        "backlog": rows_by_kind[ROW_BACKLOG],
    }
