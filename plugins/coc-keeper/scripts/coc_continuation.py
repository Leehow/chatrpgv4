#!/usr/bin/env python3
"""Versioned, rebuildable Keeper continuation checkpoints.

Model context is an expendable cache.  This module publishes one immutable
checkpoint after every finalized turn and reconstructs a bounded resume bundle
from canonical campaign state, exact transcript receipts, and KP-authored
semantic deltas.  Checkpoints never replace rules/state truth.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Iterable

import coc_fileio


SCHEMA_VERSION = 1
CHECKPOINT_KIND = "coc_continuation_checkpoint"
LATEST_KIND = "coc_continuation_latest"
SEMANTIC_KIND = "coc_continuation_semantic_capsule"
DELIVERY_KIND = "coc_delivery_receipt"

CONTINUATION_DIR = Path("save") / "continuation"
CHECKPOINT_DIR = CONTINUATION_DIR / "checkpoints"
LATEST_PATH = CONTINUATION_DIR / "latest.json"
DELIVERY_LOG = CONTINUATION_DIR / "delivery-receipts.jsonl"
FINALIZATION_LOG = Path("logs") / "turn-finalizations.jsonl"
TRANSCRIPT_LOG = Path("logs") / "table-transcript.jsonl"
SUMMARY_LOG = Path("memory") / "session-summaries.jsonl"

# Continuation checkpoints are rebuildable acceleration data, not campaign
# history.  Canonical finalizations, transcript rows, and session summaries
# remain append-only; keeping a small rollback ring prevents a long campaign
# from accumulating one cache file forever.
CHECKPOINT_RETENTION = 16

LATEST_FIELDS = frozenset({
    "schema_version", "kind", "campaign_id", "checkpoint_id",
    "checkpoint_path", "checkpoint_sha256", "turn_number",
    "finalization_id", "updated_at",
})
CHECKPOINT_FIELDS = frozenset({
    "schema_version", "kind", "campaign_id", "checkpoint_id",
    "turn_number", "status", "created_at", "source",
    "canonical_projection", "transcript_tail", "semantic_capsule",
    "refs", "content_sha256",
})
CHECKPOINT_SOURCE_FIELDS = frozenset({
    "finalization_id", "journal_decision_id", "rendered_sha256",
    "source_digest", "integrity_digest",
})
DELIVERY_FIELDS = frozenset({
    "schema_version", "kind", "delivery_id", "campaign_id",
    "finalization_id", "rendered_sha256", "status", "ack_kind",
    "source_id", "created_at",
})
SEMANTIC_FIELDS = frozenset({
    "schema_version", "kind", "recent_summaries", "unresolved_intent",
    "threads", "confirmed_decisions", "do_not_repeat",
    "style_commitments", "updated_from_turn",
})
SEMANTIC_DELTA_FIELDS = frozenset({
    "unresolved_intent", "clear_unresolved_intent", "open_threads",
    "confirmed_decisions", "do_not_repeat", "style_commitments",
})

DEFAULT_STYLE_COMMITMENTS = (
    "保持 KP 的场景塑造、NPC 能动性和因果叙事，不退化成骰子解释器。",
    "情境允许时保留桌边调侃、轻微讽刺和玩家友好的玩笑。",
    "玩家可见文本始终使用 campaign play_language。",
)


class ContinuationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _read_object(path: Path, *, code: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ContinuationError(code, f"{path.name} is unreadable") from exc
    if not isinstance(payload, dict):
        raise ContinuationError(code, f"{path.name} must be an object")
    return payload


def _optional_object(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ContinuationError(
            "state_corrupt", f"canonical state {path.name} is unreadable"
        ) from exc
    if not isinstance(payload, dict):
        raise ContinuationError(
            "state_corrupt", f"canonical state {path.name} must be an object"
        )
    return payload


def _tail_lines(path: Path, limit: int, *, block_size: int = 8192) -> list[str]:
    """Read at most ``limit`` final non-empty UTF-8 lines without a full scan."""
    if limit <= 0 or not path.is_file():
        return []
    try:
        with path.open("rb") as handle:
            handle.seek(0, 2)
            position = handle.tell()
            chunks: list[bytes] = []
            newline_count = 0
            while position > 0 and newline_count <= limit:
                take = min(block_size, position)
                position -= take
                handle.seek(position)
                chunk = handle.read(take)
                chunks.append(chunk)
                newline_count += chunk.count(b"\n")
    except OSError as exc:
        raise ContinuationError(
            "state_corrupt", f"{path.name} cannot be read"
        ) from exc
    raw_text = b"".join(reversed(chunks))
    if position > 0:
        # The first block can begin in the middle of both a JSONL row and a
        # multibyte UTF-8 code point. Discard that partial row as bytes before
        # decoding the complete tail.
        newline = raw_text.find(b"\n")
        raw_text = raw_text[newline + 1 :] if newline >= 0 else b""
    try:
        text = raw_text.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ContinuationError(
            "state_corrupt", f"{path.name} is not valid UTF-8"
        ) from exc
    return [line for line in text.splitlines() if line.strip()][-limit:]


def _tail_jsonl(path: Path, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw in _tail_lines(path, limit):
        try:
            row = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ContinuationError(
                "state_corrupt", f"{path.name} has malformed tail JSON"
            ) from exc
        if not isinstance(row, dict):
            raise ContinuationError(
                "state_corrupt", f"{path.name} tail row must be an object"
            )
        rows.append(row)
    return rows


def _all_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    try:
        raw_lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise ContinuationError(
            "state_corrupt", f"{path.name} cannot be read"
        ) from exc
    rows: list[dict[str, Any]] = []
    for line_number, raw in enumerate(raw_lines, start=1):
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ContinuationError(
                "state_corrupt",
                f"{path.name} line {line_number} is malformed",
            ) from exc
        if not isinstance(row, dict):
            raise ContinuationError(
                "state_corrupt",
                f"{path.name} line {line_number} must be an object",
            )
        rows.append(row)
    return rows


def _validate_text(value: Any, *, field: str, max_length: int = 4000) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContinuationError("invalid_param", f"{field} must be non-empty text")
    clean = value.strip()
    if len(clean) > max_length:
        raise ContinuationError(
            "invalid_param", f"{field} exceeds {max_length} characters"
        )
    return clean


def _normalize_named_rows(
    value: Any,
    *,
    collection: str,
    id_field: str,
    text_field: str,
    turn_number: int,
    statuses: set[str] | None = None,
) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ContinuationError("invalid_param", f"{collection} must be an array")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, row in enumerate(value):
        if not isinstance(row, dict):
            raise ContinuationError(
                "invalid_param", f"{collection}[{index}] must be an object"
            )
        allowed = {id_field, text_field, "reason"}
        if statuses is not None:
            allowed.add("status")
        if not set(row) <= allowed:
            unknown = sorted(set(row) - allowed)
            raise ContinuationError(
                "invalid_param",
                f"{collection}[{index}] has unknown fields: {', '.join(unknown)}",
            )
        item_id = _validate_text(
            row.get(id_field), field=f"{collection}[{index}].{id_field}", max_length=160
        )
        if item_id in seen:
            raise ContinuationError(
                "invalid_param", f"{collection} duplicates {id_field} '{item_id}'"
            )
        seen.add(item_id)
        item = {
            id_field: item_id,
            text_field: _validate_text(
                row.get(text_field),
                field=f"{collection}[{index}].{text_field}",
            ),
            "reason": _validate_text(
                row.get("reason"), field=f"{collection}[{index}].reason"
            ),
            "source_turn": int(turn_number),
        }
        if statuses is not None:
            status = str(row.get("status") or "")
            if status not in statuses:
                raise ContinuationError(
                    "invalid_param",
                    f"{collection}[{index}].status must be one of {sorted(statuses)}",
                )
            item["status"] = status
        normalized.append(item)
    return normalized


def normalize_semantic_delta(value: Any, *, turn_number: int) -> dict[str, Any]:
    """Validate one KP-authored semantic continuation delta.

    The KP supplies meaning.  Runtime code only validates structured identity,
    lifecycle enums, and bounded size; it never infers meaning from prose.
    """
    if value in (None, {}):
        return {}
    if not isinstance(value, dict):
        raise ContinuationError("invalid_param", "continuation must be an object")
    if not set(value) <= SEMANTIC_DELTA_FIELDS:
        unknown = sorted(set(value) - SEMANTIC_DELTA_FIELDS)
        raise ContinuationError(
            "invalid_param", f"continuation has unknown fields: {', '.join(unknown)}"
        )
    normalized: dict[str, Any] = {}
    if value.get("clear_unresolved_intent") not in (None, False, True):
        raise ContinuationError(
            "invalid_param", "continuation.clear_unresolved_intent must be boolean"
        )
    if value.get("clear_unresolved_intent") is True:
        normalized["clear_unresolved_intent"] = True
    if value.get("unresolved_intent") is not None:
        normalized["unresolved_intent"] = _validate_text(
            value["unresolved_intent"], field="continuation.unresolved_intent"
        )
    normalized["open_threads"] = _normalize_named_rows(
        value.get("open_threads"),
        collection="continuation.open_threads",
        id_field="thread_id",
        text_field="summary",
        turn_number=turn_number,
        statuses={"active", "deferred", "resolved", "archived"},
    )
    normalized["confirmed_decisions"] = _normalize_named_rows(
        value.get("confirmed_decisions"),
        collection="continuation.confirmed_decisions",
        id_field="decision_id",
        text_field="summary",
        turn_number=turn_number,
    )
    normalized["do_not_repeat"] = _normalize_named_rows(
        value.get("do_not_repeat"),
        collection="continuation.do_not_repeat",
        id_field="item_id",
        text_field="instruction",
        turn_number=turn_number,
    )
    styles = value.get("style_commitments")
    if styles is not None:
        if not isinstance(styles, list):
            raise ContinuationError(
                "invalid_param", "continuation.style_commitments must be an array"
            )
        clean_styles: list[str] = []
        for index, style in enumerate(styles):
            clean = _validate_text(
                style,
                field=f"continuation.style_commitments[{index}]",
                max_length=1000,
            )
            if clean not in clean_styles:
                clean_styles.append(clean)
        normalized["style_commitments"] = clean_styles[:16]
    return normalized


def _default_semantic_capsule() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": SEMANTIC_KIND,
        "recent_summaries": [],
        "unresolved_intent": None,
        "threads": [],
        "confirmed_decisions": [],
        "do_not_repeat": [],
        "style_commitments": list(DEFAULT_STYLE_COMMITMENTS),
        "updated_from_turn": None,
    }


def empty_semantic_capsule() -> dict[str, Any]:
    """Public initial projection for a campaign with no finalized turn yet."""
    return _default_semantic_capsule()


def _valid_semantic_capsule(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == SEMANTIC_FIELDS
        and value.get("schema_version") == SCHEMA_VERSION
        and value.get("kind") == SEMANTIC_KIND
        and isinstance(value.get("recent_summaries"), list)
        and isinstance(value.get("threads"), list)
        and isinstance(value.get("confirmed_decisions"), list)
        and isinstance(value.get("do_not_repeat"), list)
        and isinstance(value.get("style_commitments"), list)
    )


def _merge_by_id(
    prior: Iterable[dict[str, Any]],
    delta: Iterable[dict[str, Any]],
    *,
    id_field: str,
    limit: int,
) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for row in prior:
        if isinstance(row, dict) and isinstance(row.get(id_field), str):
            merged[row[id_field]] = deepcopy(row)
    for row in delta:
        merged[str(row[id_field])] = deepcopy(row)
    ordered = sorted(
        merged.values(),
        key=lambda row: (int(row.get("source_turn") or 0), str(row.get(id_field))),
    )
    return ordered[-limit:]


def merge_semantic_capsule(
    prior: Any,
    *,
    summary_row: dict[str, Any] | None,
    turn_number: int,
) -> dict[str, Any]:
    capsule = deepcopy(prior) if _valid_semantic_capsule(prior) else _default_semantic_capsule()
    summary_row = summary_row if isinstance(summary_row, dict) else {}
    summary_text = summary_row.get("summary")
    if isinstance(summary_text, str) and summary_text.strip():
        summary_entry = {
            "turn_number": int(turn_number),
            "summary": summary_text.strip(),
            "summary_sha256": canonical_digest(summary_text.strip()),
            "source_ref": f"memory/session-summaries.jsonl#turn-{int(turn_number)}",
        }
        summaries = [
            deepcopy(row)
            for row in capsule["recent_summaries"]
            if isinstance(row, dict) and row.get("turn_number") != int(turn_number)
        ]
        summaries.append(summary_entry)
        capsule["recent_summaries"] = summaries[-6:]

    delta = summary_row.get("continuation_delta")
    if not isinstance(delta, dict):
        delta = {}
    if delta.get("clear_unresolved_intent") is True:
        capsule["unresolved_intent"] = None
    if isinstance(delta.get("unresolved_intent"), str):
        capsule["unresolved_intent"] = delta["unresolved_intent"]
    capsule["threads"] = _merge_by_id(
        capsule["threads"], delta.get("open_threads") or [],
        id_field="thread_id", limit=32,
    )
    capsule["confirmed_decisions"] = _merge_by_id(
        capsule["confirmed_decisions"], delta.get("confirmed_decisions") or [],
        id_field="decision_id", limit=32,
    )
    capsule["do_not_repeat"] = _merge_by_id(
        capsule["do_not_repeat"], delta.get("do_not_repeat") or [],
        id_field="item_id", limit=32,
    )
    for style in delta.get("style_commitments") or []:
        if style not in capsule["style_commitments"]:
            capsule["style_commitments"].append(style)
    capsule["style_commitments"] = capsule["style_commitments"][-24:]
    capsule["updated_from_turn"] = int(turn_number)
    return capsule


def rebuild_semantic_capsule(
    campaign_dir: Path, *, through_turn: int
) -> dict[str, Any]:
    """Cold-path rebuild from canonical per-turn summary deltas."""
    capsule = _default_semantic_capsule()
    for row in _all_jsonl(Path(campaign_dir) / SUMMARY_LOG):
        turn = row.get("turn_number")
        if isinstance(turn, bool) or not isinstance(turn, int) or turn < 0:
            raise ContinuationError(
                "state_corrupt", "session summary has an invalid turn_number"
            )
        if turn > int(through_turn):
            continue
        try:
            capsule = merge_semantic_capsule(
                capsule, summary_row=row, turn_number=turn
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ContinuationError(
                "state_corrupt", "session summary continuation delta is invalid"
            ) from exc
    return capsule


def _validate_checkpoint(payload: Any, campaign_id: str) -> dict[str, Any]:
    if (
        not isinstance(payload, dict)
        or set(payload) != CHECKPOINT_FIELDS
        or payload.get("schema_version") != SCHEMA_VERSION
        or payload.get("kind") != CHECKPOINT_KIND
        or payload.get("campaign_id") != campaign_id
        or not isinstance(payload.get("checkpoint_id"), str)
        or not payload["checkpoint_id"]
        or isinstance(payload.get("turn_number"), bool)
        or not isinstance(payload.get("turn_number"), int)
        or payload["turn_number"] < 0
        or payload.get("status") != "awaiting_player"
        or not isinstance(payload.get("source"), dict)
        or set(payload["source"]) != CHECKPOINT_SOURCE_FIELDS
        or any(
            not isinstance(payload["source"].get(key), str)
            or not payload["source"][key]
            for key in CHECKPOINT_SOURCE_FIELDS
        )
        or not isinstance(payload.get("canonical_projection"), dict)
        or not isinstance(payload.get("transcript_tail"), list)
        or not isinstance(payload.get("refs"), dict)
        or not _valid_semantic_capsule(payload.get("semantic_capsule"))
    ):
        raise ContinuationError(
            "continuation_cache_corrupt", "continuation checkpoint shape is invalid"
        )
    expected = canonical_digest({
        key: value for key, value in payload.items() if key != "content_sha256"
    })
    if payload.get("content_sha256") != expected:
        raise ContinuationError(
            "continuation_cache_corrupt", "continuation checkpoint hash mismatch"
        )
    keeper_rows = [
        row for row in payload["transcript_tail"]
        if isinstance(row, dict) and row.get("role") == "keeper"
    ]
    keeper_text = keeper_rows[0].get("text") if keeper_rows else None
    keeper_projection_valid = bool(
        keeper_rows
        and (
            (
                isinstance(keeper_text, str)
                and canonical_digest(keeper_text)
                == payload["source"]["rendered_sha256"]
            )
            or (
                keeper_text is None
                and isinstance(keeper_rows[0].get("text_ref"), str)
                and bool(keeper_rows[0]["text_ref"])
                and isinstance(keeper_rows[0].get("text_char_count"), int)
                and keeper_rows[0]["text_char_count"] >= 0
                and isinstance(keeper_rows[0].get("text_byte_count"), int)
                and keeper_rows[0]["text_byte_count"] >= 0
            )
        )
    )
    if (
        len(keeper_rows) != 1
        or keeper_rows[0].get("finalization_id")
        != payload["source"]["finalization_id"]
        or keeper_rows[0].get("text_sha256")
        != payload["source"]["rendered_sha256"]
        or not keeper_projection_valid
    ):
        raise ContinuationError(
            "continuation_cache_corrupt",
            "continuation transcript does not match its finalization source",
        )
    return payload


def _validate_latest(payload: Any, campaign_id: str) -> dict[str, Any]:
    if (
        not isinstance(payload, dict)
        or set(payload) != LATEST_FIELDS
        or payload.get("schema_version") != SCHEMA_VERSION
        or payload.get("kind") != LATEST_KIND
        or payload.get("campaign_id") != campaign_id
        or not isinstance(payload.get("checkpoint_path"), str)
        or not payload["checkpoint_path"]
        or not isinstance(payload.get("checkpoint_sha256"), str)
        or not isinstance(payload.get("checkpoint_id"), str)
        or not payload["checkpoint_id"]
        or not isinstance(payload.get("finalization_id"), str)
        or not payload["finalization_id"]
        or not isinstance(payload.get("updated_at"), str)
        or isinstance(payload.get("turn_number"), bool)
        or not isinstance(payload.get("turn_number"), int)
        or payload["turn_number"] < 0
    ):
        raise ContinuationError(
            "continuation_cache_corrupt", "continuation latest pointer is invalid"
        )
    return payload


def load_latest_checkpoint(campaign_dir: Path) -> dict[str, Any] | None:
    campaign_dir = Path(campaign_dir)
    pointer_path = campaign_dir / LATEST_PATH
    if not pointer_path.is_file():
        return None
    pointer = _validate_latest(
        _read_object(pointer_path, code="continuation_cache_corrupt"),
        campaign_dir.name,
    )
    relative_path = Path(pointer["checkpoint_path"])
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ContinuationError(
            "continuation_cache_corrupt", "checkpoint path escapes campaign"
        )
    checkpoint_path = campaign_dir / relative_path
    checkpoint = _validate_checkpoint(
        _read_object(checkpoint_path, code="continuation_cache_corrupt"),
        campaign_dir.name,
    )
    if (
        checkpoint["checkpoint_id"] != pointer["checkpoint_id"]
        or checkpoint["content_sha256"] != pointer["checkpoint_sha256"]
        or checkpoint["turn_number"] != pointer["turn_number"]
        or checkpoint["source"].get("finalization_id") != pointer["finalization_id"]
    ):
        raise ContinuationError(
            "continuation_cache_corrupt",
            "continuation pointer and checkpoint disagree",
        )
    return checkpoint


def _prune_checkpoint_ring(campaign_dir: Path, *, keep_path: Path) -> None:
    """Best-effort pruning for immutable, rebuildable checkpoint cache files.

    The latest pointer is validated before this runs.  Failure to remove an old
    cache file must never make a finalized turn unavailable, so filesystem
    errors are deliberately non-fatal and can be repaired by a later publish.
    """
    checkpoint_dir = Path(campaign_dir) / CHECKPOINT_DIR
    if not checkpoint_dir.is_dir():
        return
    try:
        candidates = sorted(
            (
                path for path in checkpoint_dir.glob("turn-*.json")
                if path.is_file()
            ),
            key=lambda path: path.name,
            reverse=True,
        )
    except OSError:
        return
    protected = keep_path.resolve(strict=False)
    retained = 0
    for path in candidates:
        resolved = path.resolve(strict=False)
        if resolved == protected or retained < CHECKPOINT_RETENTION:
            retained += 1
            continue
        try:
            path.unlink()
        except OSError:
            continue


def _latest_finalization(campaign_dir: Path) -> dict[str, Any] | None:
    rows = _tail_jsonl(Path(campaign_dir) / FINALIZATION_LOG, 2)
    if not rows:
        return None
    receipt = rows[-1]
    required = (
        "finalization_id", "journal_decision_id", "rendered_sha256",
        "rendered_text", "integrity_digest", "source_digest",
    )
    if any(not isinstance(receipt.get(key), str) or not receipt[key] for key in required):
        raise ContinuationError(
            "state_corrupt", "latest finalization receipt is incomplete"
        )
    if canonical_digest(receipt["rendered_text"]) != receipt["rendered_sha256"]:
        raise ContinuationError(
            "state_corrupt", "latest finalization rendered hash mismatch"
        )
    body = {key: value for key, value in receipt.items() if key != "integrity_digest"}
    if canonical_digest(body) != receipt["integrity_digest"]:
        raise ContinuationError(
            "state_corrupt", "latest finalization integrity digest mismatch"
        )
    return receipt


def _matching_transcript_tail(
    campaign_dir: Path, receipt: dict[str, Any]
) -> list[dict[str, Any]]:
    rows = _tail_jsonl(Path(campaign_dir) / TRANSCRIPT_LOG, 8)
    journal_id = receipt["journal_decision_id"]
    matched = [
        deepcopy(row) for row in rows
        if row.get("journal_decision_id") == journal_id
        and row.get("role") in {"player", "keeper"}
    ]
    keeper_rows = [row for row in matched if row.get("role") == "keeper"]
    if len(keeper_rows) != 1:
        raise ContinuationError(
            "state_corrupt",
            "finalized turn does not have exactly one Keeper transcript row",
        )
    keeper = keeper_rows[0]
    if (
        keeper.get("finalization_id") != receipt["finalization_id"]
        or keeper.get("text_sha256") != receipt["rendered_sha256"]
        or keeper.get("text") != receipt["rendered_text"]
    ):
        raise ContinuationError(
            "state_corrupt", "Keeper transcript does not match finalization receipt"
        )
    return matched[-2:]


def _checkpoint_transcript_projection(
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep transcript identity in cache without duplicating canonical prose."""
    projected: list[dict[str, Any]] = []
    for row in rows:
        copy = {
            key: deepcopy(value)
            for key, value in row.items()
            if key != "text"
        }
        text = str(row.get("text") or "")
        copy.update({
            "text_ref": (
                "logs/table-transcript.jsonl#" + str(row.get("entry_id") or "")
            ),
            "text_char_count": len(text),
            "text_byte_count": len(text.encode("utf-8")),
        })
        projected.append(copy)
    return projected


def _summary_for_turn(campaign_dir: Path, turn_number: int) -> dict[str, Any] | None:
    rows = _tail_jsonl(Path(campaign_dir) / SUMMARY_LOG, 8)
    for row in reversed(rows):
        if row.get("turn_number") == int(turn_number):
            return row
    return None


def _canonical_projection(
    campaign_dir: Path,
    *,
    revision_vector: dict[str, int] | None,
    revision_token: str | None,
) -> dict[str, Any]:
    campaign_dir = Path(campaign_dir)
    campaign = _optional_object(campaign_dir / "campaign.json")
    world = _optional_object(campaign_dir / "save" / "world-state.json")
    pacing = _optional_object(campaign_dir / "save" / "pacing-state.json")
    active_scene = _optional_object(campaign_dir / "save" / "active-scene.json")
    time_state = _optional_object(campaign_dir / "save" / "time-state.json")
    party = _optional_object(campaign_dir / "party.json")
    return {
        "campaign": {
            "status": campaign.get("status"),
            "play_language": campaign.get("play_language"),
            "active_scenario_id": campaign.get("active_scenario_id"),
        },
        "world": {
            "status": world.get("status"),
            "active_scene_id": world.get("active_scene_id"),
            "active_subsystem": world.get("active_subsystem"),
            "current_status": world.get("current_status"),
            "terminal_state": deepcopy(world.get("terminal_state")),
            "discovered_clue_count": len(world.get("discovered_clue_ids") or []),
        },
        "pacing": {
            "turn_number": pacing.get("turn_number"),
            "tension_level": pacing.get("tension_level"),
            "recent_intent_classes": list(pacing.get("recent_intent_classes") or []),
        },
        "active_scene": {
            "scene_id": active_scene.get("scene_id"),
            "summary": active_scene.get("summary"),
            "pending_choices": deepcopy(active_scene.get("pending_choices")),
        },
        "time": deepcopy(time_state.get("clock") or {}),
        "party_ids": list(party.get("investigator_ids") or []),
        "state_revision_vector": dict(revision_vector or {}),
        "state_revision_token": revision_token,
    }


def publish_finalized_checkpoint(
    campaign_dir: Path,
    receipt: dict[str, Any],
    *,
    revision_vector: dict[str, int] | None = None,
    revision_token: str | None = None,
) -> dict[str, Any]:
    """Atomically publish one immutable checkpoint for a finalized turn."""
    campaign_dir = Path(campaign_dir)
    if not isinstance(receipt, dict):
        raise ContinuationError("invalid_param", "finalization receipt must be an object")
    for key in (
        "finalization_id", "journal_decision_id", "rendered_sha256",
        "rendered_text", "source_digest", "integrity_digest",
    ):
        if not isinstance(receipt.get(key), str) or not receipt[key]:
            raise ContinuationError(
                "state_corrupt", f"finalization receipt {key} is invalid"
            )
    if canonical_digest(receipt["rendered_text"]) != receipt["rendered_sha256"]:
        raise ContinuationError(
            "state_corrupt", "finalization rendered text does not match its hash"
        )
    try:
        current_checkpoint = load_latest_checkpoint(campaign_dir)
    except ContinuationError:
        current_checkpoint = None
    if (
        current_checkpoint is not None
        and current_checkpoint["source"]["finalization_id"]
        == receipt["finalization_id"]
    ):
        return current_checkpoint
    transcript_tail = _matching_transcript_tail(campaign_dir, receipt)
    keeper_row = next(
        row for row in transcript_tail if row.get("role") == "keeper"
    )
    turn_value = keeper_row.get("turn")
    if (
        isinstance(turn_value, bool)
        or not isinstance(turn_value, int)
        or turn_value < 0
    ):
        raise ContinuationError(
            "state_corrupt",
            "finalized Keeper transcript has an invalid turn number",
        )
    turn_number = turn_value
    summary_row = _summary_for_turn(campaign_dir, turn_number)
    prior_checkpoint = current_checkpoint
    prior_semantic = (
        prior_checkpoint.get("semantic_capsule")
        if isinstance(prior_checkpoint, dict)
        else None
    )
    semantic = (
        merge_semantic_capsule(
            prior_semantic,
            summary_row=summary_row,
            turn_number=turn_number,
        )
        if prior_checkpoint is not None
        else rebuild_semantic_capsule(campaign_dir, through_turn=turn_number)
    )
    created_at = _now_iso()
    body: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "kind": CHECKPOINT_KIND,
        "campaign_id": campaign_dir.name,
        "turn_number": turn_number,
        "status": "awaiting_player",
        "created_at": created_at,
        "source": {
            "finalization_id": receipt["finalization_id"],
            "journal_decision_id": receipt["journal_decision_id"],
            "rendered_sha256": receipt["rendered_sha256"],
            "source_digest": receipt["source_digest"],
            "integrity_digest": receipt["integrity_digest"],
        },
        "canonical_projection": _canonical_projection(
            campaign_dir,
            revision_vector=revision_vector,
            revision_token=revision_token,
        ),
        "transcript_tail": _checkpoint_transcript_projection(transcript_tail),
        "semantic_capsule": semantic,
        "refs": {
            "campaign": "campaign.json",
            "world": "save/world-state.json",
            "pending_turn": "save/pending-turn.json",
            "turn_cursor": "save/turn-source-cursor.json",
            "finalization": (
                "logs/turn-finalizations.jsonl#"
                + str(receipt["finalization_id"])
            ),
            "transcript": "logs/table-transcript.jsonl",
            "session_summaries": "memory/session-summaries.jsonl",
        },
    }
    body_digest = canonical_digest(body)
    checkpoint_id = (
        "continuation-v1-"
        + hashlib.sha256(str(receipt["finalization_id"]).encode("utf-8")).hexdigest()[:12]
        + "-"
        + body_digest.split(":", 1)[1][:16]
    )
    checkpoint = {
        **body,
        "checkpoint_id": checkpoint_id,
    }
    checkpoint["content_sha256"] = canonical_digest(checkpoint)
    checkpoint_path = (
        campaign_dir
        / CHECKPOINT_DIR
        / f"turn-{turn_number:06d}-{checkpoint_id.rsplit('-', 1)[-1]}.json"
    )
    if checkpoint_path.is_file():
        existing = _validate_checkpoint(
            _read_object(checkpoint_path, code="continuation_cache_corrupt"),
            campaign_dir.name,
        )
        if existing != checkpoint:
            raise ContinuationError(
                "continuation_cache_corrupt",
                "immutable continuation checkpoint conflicts with existing file",
            )
    else:
        coc_fileio.write_json_atomic(
            checkpoint_path,
            checkpoint,
            indent=2,
            ensure_ascii=False,
            trailing_newline=True,
        )
    pointer_path = campaign_dir / LATEST_PATH
    prior_turn = -1
    if pointer_path.is_file():
        try:
            prior_pointer = _validate_latest(
                _read_object(pointer_path, code="continuation_cache_corrupt"),
                campaign_dir.name,
            )
            prior_turn = int(prior_pointer["turn_number"])
        except ContinuationError:
            prior_turn = -1
    if turn_number >= prior_turn:
        pointer = {
            "schema_version": SCHEMA_VERSION,
            "kind": LATEST_KIND,
            "campaign_id": campaign_dir.name,
            "checkpoint_id": checkpoint_id,
            "checkpoint_path": checkpoint_path.relative_to(campaign_dir).as_posix(),
            "checkpoint_sha256": checkpoint["content_sha256"],
            "turn_number": turn_number,
            "finalization_id": receipt["finalization_id"],
            "updated_at": created_at,
        }
        coc_fileio.write_json_atomic(
            pointer_path,
            pointer,
            indent=2,
            ensure_ascii=False,
            trailing_newline=True,
        )
        # Never prune until the atomically replaced pointer and its target have
        # been reloaded and hash-validated together.
        published = load_latest_checkpoint(campaign_dir)
        if (
            published is None
            or published.get("checkpoint_id") != checkpoint_id
            or published.get("content_sha256") != checkpoint["content_sha256"]
        ):
            raise ContinuationError(
                "continuation_cache_corrupt",
                "published continuation checkpoint could not be revalidated",
            )
        _prune_checkpoint_ring(campaign_dir, keep_path=checkpoint_path)
    return checkpoint


def ensure_latest_checkpoint(
    campaign_dir: Path,
    *,
    revision_vector: dict[str, int] | None = None,
    revision_token: str | None = None,
) -> tuple[dict[str, Any] | None, list[str]]:
    """Load the latest checkpoint, rebuilding a broken/missing cache if possible."""
    campaign_dir = Path(campaign_dir)
    warnings: list[str] = []
    try:
        checkpoint = load_latest_checkpoint(campaign_dir)
    except ContinuationError as exc:
        warnings.append(f"ignored invalid continuation cache ({exc.code}); rebuilt from canonical receipts")
        checkpoint = None
    receipt = _latest_finalization(campaign_dir)
    if checkpoint is not None and (
        receipt is None
        or checkpoint["source"]["finalization_id"] == receipt["finalization_id"]
    ):
        return checkpoint, warnings
    if receipt is None:
        return checkpoint, warnings
    if checkpoint is not None:
        warnings.append(
            "continuation pointer lagged the canonical finalization log; published the latest turn"
        )
    checkpoint = publish_finalized_checkpoint(
        campaign_dir,
        receipt,
        revision_vector=revision_vector,
        revision_token=revision_token,
    )
    return checkpoint, warnings


def _delivery_rows(campaign_dir: Path) -> list[dict[str, Any]]:
    rows = _tail_jsonl(Path(campaign_dir) / DELIVERY_LOG, 128)
    for row in rows:
        if (
            set(row) != DELIVERY_FIELDS
            or row.get("schema_version") != SCHEMA_VERSION
            or row.get("kind") != DELIVERY_KIND
            or row.get("campaign_id") != Path(campaign_dir).name
            or row.get("status") != "confirmed"
            or row.get("ack_kind")
            not in {"displayed", "player_response", "replayed"}
            or not isinstance(row.get("source_id"), str)
            or not row["source_id"]
            or not isinstance(row.get("created_at"), str)
        ):
            raise ContinuationError(
                "state_corrupt", "delivery receipt tail is invalid"
            )
    return rows


def delivery_projection(
    campaign_dir: Path, checkpoint: dict[str, Any] | None
) -> dict[str, Any]:
    if checkpoint is None:
        return {
            "status": "none",
            "finalization_id": None,
            "rendered_sha256": None,
            "exact_text": None,
        }
    source = checkpoint["source"]
    finalization_id = source["finalization_id"]
    matching = [
        row for row in _delivery_rows(campaign_dir)
        if row.get("finalization_id") == finalization_id
    ]
    keeper_rows = [
        row for row in checkpoint["transcript_tail"] if row.get("role") == "keeper"
    ]
    exact_text = keeper_rows[-1].get("text") if keeper_rows else None
    if exact_text is None:
        latest = _latest_finalization(Path(campaign_dir))
        if (
            isinstance(latest, dict)
            and latest.get("finalization_id") == finalization_id
            and latest.get("rendered_sha256") == source["rendered_sha256"]
        ):
            exact_text = latest.get("rendered_text")
    return {
        "status": "confirmed" if matching else "unconfirmed",
        "finalization_id": finalization_id,
        "rendered_sha256": source["rendered_sha256"],
        "exact_text": exact_text if not matching else None,
        "exact_text_ref": (
            "logs/turn-finalizations.jsonl#" + str(finalization_id)
            if exact_text is not None
            else None
        ),
        "ack_kind": matching[-1]["ack_kind"] if matching else None,
        "instruction": (
            "The exact output was confirmed delivered; do not replay or regenerate it."
            if matching
            else "Delivery is unconfirmed. If the player cannot see it, replay exact_text byte-for-byte; never reroll, reapply state, or regenerate prose."
        ),
    }


def classify_host_input(
    campaign_dir: Path, host_input: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Mark transport input as already journaled or still uncommitted.

    This is an identity comparison only.  The runtime never infers whether the
    text means an in-fiction action, a meta request, or anything else.
    """
    if not isinstance(host_input, dict):
        return None
    projected = deepcopy(host_input)
    recent_players = [
        row for row in _tail_jsonl(Path(campaign_dir) / TRANSCRIPT_LOG, 8)
        if row.get("role") == "player"
    ]
    projected["disposition"] = (
        "already_journaled"
        if any(
            row.get("text_sha256") == host_input.get("text_sha256")
            for row in recent_players
        )
        else "uncommitted_unclassified"
    )
    return projected


def acknowledge_delivery(
    campaign_dir: Path,
    *,
    finalization_id: str,
    rendered_sha256: str,
    ack_kind: str,
    source_id: str,
) -> dict[str, Any]:
    """Append one idempotent delivery acknowledgement outside narrative state."""
    campaign_dir = Path(campaign_dir)
    if ack_kind not in {"displayed", "player_response", "replayed"}:
        raise ContinuationError(
            "invalid_param", "ack_kind must be displayed, player_response, or replayed"
        )
    checkpoint = load_latest_checkpoint(campaign_dir)
    if checkpoint is None:
        raise ContinuationError("no_finalized_turn", "no continuation checkpoint exists")
    source = checkpoint["source"]
    if (
        finalization_id != source.get("finalization_id")
        or rendered_sha256 != source.get("rendered_sha256")
    ):
        raise ContinuationError(
            "delivery_conflict", "delivery acknowledgement does not match latest output"
        )
    delivery_id = "delivery-v1-" + hashlib.sha256(
        json.dumps(
            [campaign_dir.name, finalization_id, rendered_sha256],
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:32]
    for row in _delivery_rows(campaign_dir):
        if row.get("delivery_id") == delivery_id:
            return deepcopy(row)
    receipt = {
        "schema_version": SCHEMA_VERSION,
        "kind": DELIVERY_KIND,
        "delivery_id": delivery_id,
        "campaign_id": campaign_dir.name,
        "finalization_id": finalization_id,
        "rendered_sha256": rendered_sha256,
        "status": "confirmed",
        "ack_kind": ack_kind,
        "source_id": _validate_text(source_id, field="delivery source_id", max_length=240),
        "created_at": _now_iso(),
    }
    path = campaign_dir / DELIVERY_LOG
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(receipt, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    return receipt


def acknowledge_latest_from_player_response(
    campaign_dir: Path, *, player_text: str, source_journal_decision_id: str
) -> dict[str, Any] | None:
    """A later exact player reply proves the preceding output was delivered."""
    if not isinstance(player_text, str) or not player_text.strip():
        return None
    checkpoint, _warnings = ensure_latest_checkpoint(Path(campaign_dir))
    if checkpoint is None:
        return None
    delivery = delivery_projection(Path(campaign_dir), checkpoint)
    if delivery["status"] == "confirmed":
        return None
    return acknowledge_delivery(
        Path(campaign_dir),
        finalization_id=str(delivery["finalization_id"]),
        rendered_sha256=str(delivery["rendered_sha256"]),
        ack_kind="player_response",
        source_id=source_journal_decision_id,
    )
