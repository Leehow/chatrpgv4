#!/usr/bin/env python3
"""JSONL store facade for authoritative cross-timeline transfer events.

Canonical persistence beside the existing ``memory/temporal/*.jsonl``
facades: one contract-valid authoritative transfer record per line in
``memory/temporal/transfers.jsonl`` (same generation
``temporal-memory-1``; the store is rebuildable advisory evidence, never a
migration target). Git tracks the file like its siblings.

Laws owned here (everything else stays in the reviewed cores):

- Only contract-valid transfer records are ever appended.
  ``timeline.transfer`` produces them through
  ``coc_timeline_memory_transfer.build_transfer_event``.
- One ordered campaign/from/to pair has exactly one authoritative event:
  re-appending a canonically identical record is a no-op returning the
  stored row (idempotent replay); divergent content under the same
  ``transfer_id`` fails closed. Derived echo assertions themselves are
  recorded by the caller through ``coc_temporal_memory.record_assertion``
  so each echo keeps its own independent lifecycle.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Mapping

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_temporal_memory as temporal_memory
import coc_temporal_memory_contract as contract

SCHEMA_GENERATION = contract.SCHEMA_GENERATION
AUTHORITY = temporal_memory.AUTHORITY
TRANSFERS_FILENAME = "transfers.jsonl"


class TransferStoreError(ValueError):
    """Store-level failure (divergent duplicate, unwritable path)."""


def transfers_path(campaign_dir: Path | str) -> Path:
    return temporal_memory.temporal_dir(campaign_dir) / TRANSFERS_FILENAME


def _read_rows(path: Path) -> list[dict[str, Any]]:
    """Read the JSONL store; same canonical format as the sibling facades."""
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text:
            continue
        payload = json.loads(text)
        if isinstance(payload, dict):
            rows.append(payload)
    return rows


def load_transfers(campaign_dir: Path | str) -> list[dict[str, Any]]:
    """All persisted authoritative transfer events, in append order."""
    return _read_rows(transfers_path(campaign_dir))


def lookup_transfer(
    campaign_dir: Path | str, transfer_id: str
) -> dict[str, Any] | None:
    """One persisted event by its semantic transfer id, or None."""
    for row in _read_rows(transfers_path(campaign_dir)):
        if row.get("transfer_id") == transfer_id:
            return row
    return None


def append_transfer(
    campaign_dir: Path | str, event_record: Mapping[str, Any]
) -> dict[str, Any]:
    """Append one authoritative transfer event. Idempotent on replay.

    The record must be contract-valid before it can touch disk. A stored
    event under the same ``transfer_id`` must be canonically identical
    (replay returns the stored row without appending); any divergence is a
    hard error, never an overwrite.
    """
    camp = temporal_memory._require_campaign_dir(campaign_dir)
    payload = dict(event_record)
    try:
        contract.validate_transfer(payload)
    except contract.TemporalMemoryContractError as exc:
        raise TransferStoreError(
            f"refusing to persist an invalid transfer event: {exc}"
        ) from exc
    path = transfers_path(camp)
    for existing in _read_rows(path):
        if existing.get("transfer_id") != payload["transfer_id"]:
            continue
        if contract.record_digest(existing) == contract.record_digest(payload):
            return existing
        raise TransferStoreError(
            f"transfer {payload['transfer_id']!r} is already persisted "
            "with different content; one ordered campaign/from/to pair "
            "has exactly one authoritative transfer event"
        )
    temporal_memory.ensure_store(camp)
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    return payload
