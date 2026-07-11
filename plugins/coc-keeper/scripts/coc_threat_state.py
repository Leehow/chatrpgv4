#!/usr/bin/env python3
"""Persistent threat-clock state for the Story Director.

Threat clocks (defined in ``threat-fronts.json`` as scenario data) track
escalating danger — a siege door being breached, an entity's curiosity
exhausting, etc.  The scenario file is an immutable definition; this module
owns the **runtime** progress in ``save/threat-state.json``.

This closes the gap where ``current_segments`` was read by the director
(``coc_story_director._clock_segments``) but never written anywhere, so
clocks were perpetually at 0 and ``on_full`` consequences never fired.
"""
from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
from typing import Any

_SCRIPT_DIR = Path(__file__).resolve().parent


def _load_fileio():
    spec = importlib.util.spec_from_file_location("coc_fileio", _SCRIPT_DIR / "coc_fileio.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_fileio()

THREAT_STATE_FILENAME = "threat-state.json"
THREAT_STATE_SCHEMA_VERSION = 2
_GENESIS_HASH = "0" * 64
_TRANSACTION_LEDGER = "threat-transactions.jsonl"
_PENDING_TRANSACTION = "threat-state.pending.json"


def _empty_state() -> dict[str, Any]:
    return {
        "schema_version": THREAT_STATE_SCHEMA_VERSION,
        "clocks": {},
        "applied_effects": {},
        "transitions": [],
        "ledger_head": _GENESIS_HASH,
    }


def _transition_hash(transition: dict[str, Any]) -> str:
    material = {key: value for key, value in transition.items() if key != "transition_hash"}
    return hashlib.sha256(
        json.dumps(material, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _append_transition(
    state: dict[str, Any], *, kind: str, clock_id: str, segments: int,
    ticks: int, source_id: str,
) -> dict[str, Any]:
    clock = state["clocks"].get(clock_id, {"current_segments": 0, "full": False})
    before = int(clock.get("current_segments", 0))
    before_full = bool(clock.get("full", False)) or before >= segments
    after = before if before_full else min(segments, before + ticks)
    after_full = after >= segments
    transitions = state["transitions"]
    transition = {
        "transition_id": f"clock-transition:{len(transitions) + 1}",
        "kind": kind,
        "clock_id": clock_id,
        "segments": segments,
        "ticks": ticks,
        "effect_id": source_id,
        "before_segments": before,
        "before_full": before_full,
        "after_segments": after,
        "after_full": after_full,
        "became_full": not before_full and after_full,
        "previous_hash": state["ledger_head"],
    }
    transition["transition_hash"] = _transition_hash(transition)
    transitions.append(transition)
    state["ledger_head"] = transition["transition_hash"]
    state["clocks"][clock_id] = {
        "current_segments": after,
        "full": after_full,
    }
    return transition


def _migrate_v1(data: dict[str, Any]) -> dict[str, Any]:
    receipts = data.get("applied_effects") or {}
    if receipts:
        raise ValueError(
            "legacy threat effect receipts cannot be migrated with verifiable transitions"
        )
    clocks = data.get("clocks") or {}
    if not isinstance(clocks, dict):
        raise ValueError("legacy threat-state clocks must be an object")
    migrated = _empty_state()
    for clock_id in sorted(clocks):
        clock = clocks[clock_id]
        if not isinstance(clock_id, str) or not clock_id or not isinstance(clock, dict):
            raise ValueError("legacy threat-state clock has an invalid contract")
        current = clock.get("current_segments", 0)
        full = clock.get("full", False)
        if isinstance(current, bool) or not isinstance(current, int) or current < 0:
            raise ValueError("legacy threat-state clock has invalid segments")
        if not isinstance(full, bool):
            raise ValueError("legacy threat-state clock has invalid full flag")
        if current == 0 and not full:
            continue
        # A one-time, hashed bootstrap receipt preserves pre-v2 state. All
        # subsequent mutations use ordinary/effect transitions.
        segments = max(1, current if full else current + 1)
        transition = _append_transition(
            migrated, kind="bootstrap", clock_id=clock_id,
            segments=segments, ticks=max(1, current),
            source_id=f"legacy-bootstrap:{clock_id}",
        )
        migrated["applied_effects"][transition["effect_id"]] = _transition_receipt(
            transition
        )
        if transition["after_segments"] != current or transition["after_full"] != full:
            raise ValueError("legacy threat-state clock cannot be migrated exactly")
    return migrated


def _validate_state(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("threat-state root must be an object")
    if data.get("schema_version") == 1:
        data = _migrate_v1(data)
    expected_root = {
        "schema_version", "clocks", "applied_effects", "transitions", "ledger_head",
    }
    if data.get("schema_version") != THREAT_STATE_SCHEMA_VERSION or set(data) != expected_root:
        raise ValueError("unsupported or malformed threat-state schema")
    clocks = data["clocks"]
    receipts = data["applied_effects"]
    transitions = data["transitions"]
    if not isinstance(clocks, dict) or not isinstance(receipts, dict) or not isinstance(transitions, list):
        raise ValueError("threat-state indexes must be objects and transitions a list")
    replay: dict[str, dict[str, Any]] = {}
    by_id: dict[str, dict[str, Any]] = {}
    previous_hash = _GENESIS_HASH
    transition_keys = {
        "transition_id", "kind", "clock_id", "segments", "ticks", "effect_id",
        "before_segments", "before_full", "after_segments", "after_full",
        "became_full", "previous_hash", "transition_hash",
    }
    for index, transition in enumerate(transitions, 1):
        if not isinstance(transition, dict) or set(transition) != transition_keys:
            raise ValueError("threat transition has an invalid contract")
        transition_id = f"clock-transition:{index}"
        if transition.get("transition_id") != transition_id:
            raise ValueError("threat transition sequence is non-canonical")
        kind = transition.get("kind")
        clock_id = transition.get("clock_id")
        segments = transition.get("segments")
        ticks = transition.get("ticks")
        effect_id = transition.get("effect_id")
        if kind not in {"bootstrap", "tick", "effect"}:
            raise ValueError("threat transition kind is unsupported")
        if not isinstance(clock_id, str) or not clock_id:
            raise ValueError("threat transition clock_id is invalid")
        if isinstance(segments, bool) or not isinstance(segments, int) or segments < 1:
            raise ValueError("threat transition segments are invalid")
        if isinstance(ticks, bool) or not isinstance(ticks, int) or ticks < 1:
            raise ValueError("threat transition ticks are invalid")
        if not isinstance(effect_id, str) or not effect_id:
            raise ValueError("threat transition lacks a stable source/effect ID")
        prior = replay.get(clock_id, {"current_segments": 0, "full": False})
        before = int(prior["current_segments"])
        before_full = bool(prior["full"]) or before >= segments
        after = before if before_full else min(segments, before + ticks)
        after_full = after >= segments
        expected_values = {
            "before_segments": before,
            "before_full": before_full,
            "after_segments": after,
            "after_full": after_full,
            "became_full": not before_full and after_full,
            "previous_hash": previous_hash,
        }
        if any(transition.get(key) != value for key, value in expected_values.items()):
            raise ValueError("threat transition does not match its persisted clock transition")
        if transition.get("transition_hash") != _transition_hash(transition):
            raise ValueError("threat transition hash is invalid")
        if kind == "bootstrap" and clock_id in replay:
            raise ValueError("bootstrap transition must be the first clock transition")
        replay[clock_id] = {"current_segments": after, "full": after_full}
        previous_hash = transition["transition_hash"]
        by_id[transition_id] = transition
    if data["ledger_head"] != previous_hash:
        raise ValueError("threat transition ledger head is invalid")
    if clocks != replay:
        raise ValueError("persisted clock state diverges from transition ledger")
    receipt_keys = {
        "clock_id", "segments", "ticks", "transition_id", "transition_hash",
        "before_segments", "after_segments", "became_full",
    }
    for effect_id, receipt in receipts.items():
        if not isinstance(effect_id, str) or not effect_id or not isinstance(receipt, dict):
            raise ValueError("threat effect receipt is invalid")
        if set(receipt) != receipt_keys:
            raise ValueError("threat effect receipt has an invalid contract")
        transition = by_id.get(receipt.get("transition_id"))
        expected = None if transition is None else {
            "clock_id": transition["clock_id"],
            "segments": transition["segments"],
            "ticks": transition["ticks"],
            "transition_id": transition["transition_id"],
            "transition_hash": transition["transition_hash"],
            "before_segments": transition["before_segments"],
            "after_segments": transition["after_segments"],
            "became_full": transition["became_full"],
        }
        if transition is None or transition.get("effect_id") != effect_id or receipt != expected:
            raise ValueError("threat effect receipt does not match its transition")
    effect_transitions = {transition["effect_id"] for transition in transitions}
    if effect_transitions != set(receipts):
        raise ValueError("threat effect transition lacks an exact receipt")
    return data


def _state_path(save_dir: Path) -> Path:
    return save_dir / THREAT_STATE_FILENAME


def _ledger_path(save_dir: Path) -> Path:
    return save_dir.parent / "logs" / _TRANSACTION_LEDGER


def _pending_path(save_dir: Path) -> Path:
    return save_dir / _PENDING_TRANSACTION


def _transition_receipt(transition: dict[str, Any]) -> dict[str, Any]:
    return {
        "clock_id": transition["clock_id"],
        "segments": transition["segments"],
        "ticks": transition["ticks"],
        "transition_id": transition["transition_id"],
        "transition_hash": transition["transition_hash"],
        "before_segments": transition["before_segments"],
        "after_segments": transition["after_segments"],
        "became_full": transition["became_full"],
    }


def _read_transaction_ledger(save_dir: Path) -> list[dict[str, Any]]:
    path = _ledger_path(save_dir)
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    except (OSError, ValueError) as exc:
        raise ValueError(f"independent threat transaction ledger is invalid: {exc}") from exc
    return rows


def _validate_transaction_ledger(save_dir: Path, state: dict[str, Any]) -> None:
    rows = _read_transaction_ledger(save_dir)
    transitions = state["transitions"]
    if not rows and not transitions:
        return
    if len(rows) != len(transitions):
        raise ValueError("independent threat transaction ledger length diverges")
    previous = _GENESIS_HASH
    for index, (row, transition) in enumerate(zip(rows, transitions), 1):
        expected = {
            "record_type": "threat_clock_transaction",
            "sequence": index,
            "source_id": transition["effect_id"],
            "previous_receipt_hash": previous,
            "transition": transition,
        }
        material = json.dumps(expected, sort_keys=True, separators=(",", ":"))
        receipt_hash = hashlib.sha256(material.encode("utf-8")).hexdigest()
        expected["receipt_hash"] = receipt_hash
        if row != expected:
            raise ValueError("independent threat transaction receipt diverges")
        previous = receipt_hash


def load_threat_state(save_dir: Path) -> dict[str, Any]:
    """Load threat-state.json, returning a well-formed shell if absent."""
    path = _state_path(save_dir)
    if not path.is_file():
        return _empty_state()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"could not load threat-state: {exc}") from exc
    legacy_v1 = data.get("schema_version") == 1 if isinstance(data, dict) else False
    state = _validate_state(data)
    if legacy_v1:
        # One-time migration establishes the independent receipt ledger before
        # ordinary writes begin. Legacy state had no trustworthy source IDs.
        ledger = _ledger_path(save_dir)
        if ledger.exists():
            raise ValueError("legacy threat state conflicts with transaction ledger")
        previous = _GENESIS_HASH
        ledger.parent.mkdir(parents=True, exist_ok=True)
        with ledger.open("w", encoding="utf-8") as handle:
            for index, transition in enumerate(state["transitions"], 1):
                record = {
                    "record_type": "threat_clock_transaction",
                    "sequence": index,
                    "source_id": transition["effect_id"],
                    "previous_receipt_hash": previous,
                    "transition": transition,
                }
                material = json.dumps(record, sort_keys=True, separators=(",", ":"))
                record["receipt_hash"] = hashlib.sha256(material.encode("utf-8")).hexdigest()
                handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
                previous = record["receipt_hash"]
            handle.flush()
            os.fsync(handle.fileno())
        coc_fileio.write_json_atomic(
            _state_path(save_dir), state, indent=2, ensure_ascii=False, trailing_newline=True
        )
    pending = _pending_path(save_dir)
    if pending.exists():
        try:
            marker = json.loads(pending.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError(f"invalid threat transaction journal: {exc}") from exc
        rows = _read_transaction_ledger(save_dir)
        transitions = state["transitions"]
        if len(rows) == len(transitions) + 1:
            row = rows[-1]
            transition = row.get("transition") if isinstance(row, dict) else None
            if (
                row.get("receipt_hash") != marker.get("receipt_hash")
                or not isinstance(transition, dict)
                or transition.get("transition_hash") != marker.get("transition_hash")
                or transition.get("previous_hash") != state["ledger_head"]
                or transition.get("transition_id") != f"clock-transition:{len(rows)}"
            ):
                raise ValueError("incomplete threat transaction journal diverges")
            state["transitions"].append(transition)
            state["ledger_head"] = transition["transition_hash"]
            state["clocks"][transition["clock_id"]] = {
                "current_segments": transition["after_segments"],
                "full": transition["after_full"],
            }
            state["applied_effects"][transition["effect_id"]] = _transition_receipt(
                transition
            )
            state = _validate_state(state)
            coc_fileio.write_json_atomic(
                _state_path(save_dir), state, indent=2,
                ensure_ascii=False, trailing_newline=True,
            )
            pending.unlink()
        elif len(rows) == len(transitions):
            # Marker-before-append is a safe abort; marker-after-state is a
            # completed transaction whose final cleanup was interrupted.
            pending.unlink()
        else:
            raise ValueError("incomplete threat transaction sequence diverges")
    _validate_transaction_ledger(save_dir, state)
    return state


def _save_state(save_dir: Path, state: dict[str, Any]) -> None:
    state = _validate_state(state)
    existing = _read_transaction_ledger(save_dir)
    transitions = state["transitions"]
    if len(transitions) < len(existing) or len(transitions) > len(existing) + 1:
        raise ValueError("threat transaction sequence cannot skip or roll back")
    if existing:
        # Validate the existing prefix against its independent receipts without
        # pretending the derived clock/head fields belong to that prefix.
        for row, transition in zip(existing, transitions):
            if row.get("transition") != transition:
                raise ValueError("independent threat transaction prefix diverges")
    marker = None
    if len(transitions) == len(existing) + 1:
        transition = transitions[-1]
        previous_receipt = existing[-1]["receipt_hash"] if existing else _GENESIS_HASH
        record = {
            "record_type": "threat_clock_transaction",
            "sequence": len(transitions),
            "source_id": transition["effect_id"],
            "previous_receipt_hash": previous_receipt,
            "transition": transition,
        }
        material = json.dumps(record, sort_keys=True, separators=(",", ":"))
        record["receipt_hash"] = hashlib.sha256(material.encode("utf-8")).hexdigest()
        marker = {"transition_hash": transition["transition_hash"], "receipt_hash": record["receipt_hash"]}
        coc_fileio.write_json_atomic(
            _pending_path(save_dir), marker, indent=2, ensure_ascii=False, trailing_newline=True
        )
        ledger = _ledger_path(save_dir)
        ledger.parent.mkdir(parents=True, exist_ok=True)
        with ledger.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
    path = _state_path(save_dir)
    coc_fileio.write_json_atomic(
        path, state, indent=2, ensure_ascii=False, trailing_newline=True
    )
    if marker is not None:
        _pending_path(save_dir).unlink()


def init_threat_state(save_dir: Path) -> None:
    """Create an empty threat-state.json if one does not exist."""
    path = _state_path(save_dir)
    if not path.is_file():
        _save_state(
            save_dir,
            _empty_state(),
        )


def get_clock_segments(save_dir: Path, clock_id: str) -> int:
    """Return the live ``current_segments`` for a clock, or 0 if unrecorded."""
    state = load_threat_state(save_dir)
    clock = state["clocks"].get(clock_id, {})
    try:
        return int(clock.get("current_segments", 0))
    except (TypeError, ValueError):
        return 0


def tick_clock(
    save_dir: Path, clock_id: str, segments: int, *, source_id: str
) -> bool:
    """Advance a clock by one segment and persist.

    Returns True if the clock **became full** as a result of this tick
    (i.e. it was not full before and reached ``segments`` now).  Ticking an
    already-full clock is a no-op returning False.
    """
    if not isinstance(source_id, str) or not source_id:
        raise ValueError("source_id must be a stable non-empty ID")
    state = load_threat_state(save_dir)
    existing = state["applied_effects"].get(source_id)
    if existing is not None:
        if any(existing.get(key) != value for key, value in {
            "clock_id": clock_id, "segments": segments, "ticks": 1,
        }.items()):
            raise ValueError("threat source ID was reused with different content")
        return False
    transition = _append_transition(
        state, kind="tick", clock_id=clock_id, segments=segments,
        ticks=1, source_id=source_id,
    )
    state["applied_effects"][source_id] = _transition_receipt(transition)
    _save_state(save_dir, state)
    return bool(transition["became_full"])


def apply_clock_effect_once(
    save_dir: Path,
    clock_id: str,
    segments: int,
    *,
    ticks: int,
    effect_id: str,
) -> tuple[bool, bool]:
    """Atomically advance a clock and record a durable idempotency receipt.

    The clock update and receipt share one atomic JSON replacement.  A caller
    that crashes after this write can safely retry: an identical receipt is a
    no-op, while reuse of the same effect ID with different content fails
    closed.

    Returns ``(applied, became_full)``.
    """
    if not isinstance(effect_id, str) or not effect_id:
        raise ValueError("effect_id must be non-empty")
    if isinstance(ticks, bool) or not isinstance(ticks, int) or ticks < 1:
        raise ValueError("ticks must be a positive integer")
    if isinstance(segments, bool) or not isinstance(segments, int) or segments < 1:
        raise ValueError("segments must be a positive integer")
    state = load_threat_state(save_dir)
    receipts = state.setdefault("applied_effects", {})
    if not isinstance(receipts, dict):
        raise ValueError("threat-state applied_effects must be an object")
    existing = receipts.get(effect_id)
    if existing is not None:
        if any(existing.get(key) != value for key, value in {
            "clock_id": clock_id, "segments": segments, "ticks": ticks,
        }.items()):
            raise ValueError("threat effect ID was reused with different content")
        return False, False
    transition = _append_transition(
        state, kind="effect", clock_id=clock_id, segments=segments,
        ticks=ticks, source_id=effect_id,
    )
    receipts[effect_id] = _transition_receipt(transition)
    state["applied_effects"] = receipts
    _save_state(save_dir, state)
    return True, bool(transition["became_full"])


def get_clock_effect_receipt(save_dir: Path, effect_id: str) -> dict[str, Any]:
    """Return an exact verified effect transition receipt."""
    state = load_threat_state(save_dir)
    receipt = state["applied_effects"].get(effect_id)
    if not isinstance(receipt, dict):
        raise ValueError(f"unknown threat effect receipt: {effect_id}")
    return json.loads(json.dumps(receipt))


def is_clock_full(save_dir: Path, clock_id: str) -> bool:
    """Check whether a clock has reached its segment total."""
    state = load_threat_state(save_dir)
    return bool(state["clocks"].get(clock_id, {}).get("full", False))
