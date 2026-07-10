#!/usr/bin/env python3
"""Persistent NPC psychological state (G3).

Per-campaign store under ``save/npc-state.json["psych"]`` — namespaced beside
the persona cards the apply layer writes wholesale under ``"npcs"``, so card
overwrites never clobber accumulated psychology.

Each NPC entry:
    {trust: int, fear: int, suspicion: int,          # clamped -5..+5
     known_facts: [fact_id],
     lies_told: [{lie_id, about}],
     promises: [{promise_id, kept: bool|null}]}

``npc_disposition`` derives a stance (hostile|wary|neutral|warm) plus
structured drivers from numeric thresholds only — never from agenda prose
(Semantic Matcher Constitution).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")

NUMERIC_FIELDS = ("trust", "fear", "suspicion")
FIELD_MIN = -5
FIELD_MAX = 5

# Disposition thresholds (structured numeric — see npc_disposition).
HOSTILE_TRUST_MAX = -3      # trust <= -3 -> hostile
HOSTILE_SUSPICION_MIN = 3   # suspicion >= 3 -> hostile
HOSTILE_FEAR_MIN = 4        # fear >= 4 -> cornered-animal hostility
WARM_TRUST_MIN = 3          # trust >= 3 (and no wary/hostile driver) -> warm
WARY_FEAR_MIN = 2           # fear >= 2 -> wary
WARY_SUSPICION_MIN = 1      # suspicion >= 1 -> wary
WARY_TRUST_MAX = -1         # trust <= -1 -> wary


def _state_path(campaign_dir: Path) -> Path:
    return Path(campaign_dir) / "save" / "npc-state.json"


def _default_entry() -> dict[str, Any]:
    return {
        "trust": 0,
        "fear": 0,
        "suspicion": 0,
        "known_facts": [],
        "lies_told": [],
        "promises": [],
    }


def load_npc_state(campaign_dir: Path) -> dict[str, Any]:
    """Load the full npc-state.json document (persona cards + psych)."""
    path = _state_path(campaign_dir)
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    if not isinstance(state, dict):
        state = {}
    state.setdefault("schema_version", 1)
    if not isinstance(state.get("npcs"), dict):
        state["npcs"] = {}
    if not isinstance(state.get("psych"), dict):
        state["psych"] = {}
    return state


def save_npc_state(campaign_dir: Path, state: dict[str, Any]) -> None:
    """Atomically persist the full npc-state.json document."""
    coc_fileio.write_json_atomic(_state_path(campaign_dir), state)


def _psych_entry(state: dict[str, Any], npc_id: str) -> dict[str, Any]:
    psych = state["psych"]
    entry = psych.get(str(npc_id))
    if not isinstance(entry, dict):
        entry = _default_entry()
        psych[str(npc_id)] = entry
    else:
        base = _default_entry()
        for key, default in base.items():
            entry.setdefault(key, default)
    return entry


def get_npc_entry(campaign_dir: Path, npc_id: str) -> dict[str, Any]:
    """Read one NPC's psych entry (defaults when absent). Does not write."""
    state = load_npc_state(campaign_dir)
    entry = state["psych"].get(str(npc_id))
    if not isinstance(entry, dict):
        return _default_entry()
    merged = _default_entry()
    merged.update(entry)
    return merged


def adjust(campaign_dir: Path, npc_id: str, field: str, delta: int) -> int:
    """Adjust a numeric field (clamped to -5..+5) and persist. Returns new value."""
    if field not in NUMERIC_FIELDS:
        raise ValueError(
            f"unknown npc psych field {field!r}; expected one of {NUMERIC_FIELDS}"
        )
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    value = int(entry.get(field, 0) or 0) + int(delta)
    value = max(FIELD_MIN, min(FIELD_MAX, value))
    entry[field] = value
    save_npc_state(campaign_dir, state)
    return value


def record_fact(campaign_dir: Path, npc_id: str, fact_id: str) -> None:
    """Record a fact this NPC now knows (deduplicated by fact_id)."""
    fact = str(fact_id)
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    if fact not in entry["known_facts"]:
        entry["known_facts"].append(fact)
        save_npc_state(campaign_dir, state)


def record_lie(campaign_dir: Path, npc_id: str, lie_id: str, about: str | None = None) -> None:
    """Record a lie this NPC told (deduplicated by lie_id)."""
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    if any(l.get("lie_id") == str(lie_id) for l in entry["lies_told"]):
        return
    entry["lies_told"].append({"lie_id": str(lie_id), "about": about})
    save_npc_state(campaign_dir, state)


def record_promise(
    campaign_dir: Path, npc_id: str, promise_id: str, kept: bool | None = None
) -> None:
    """Record a promise (kept=None while open); re-recording updates kept."""
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    for promise in entry["promises"]:
        if promise.get("promise_id") == str(promise_id):
            promise["kept"] = kept
            save_npc_state(campaign_dir, state)
            return
    entry["promises"].append({"promise_id": str(promise_id), "kept": kept})
    save_npc_state(campaign_dir, state)


def npc_disposition(npc_state_entry: dict[str, Any] | None) -> dict[str, Any]:
    """Derive stance + drivers from numeric thresholds. Pure; no prose.

    Returns {stance: "hostile|wary|neutral|warm", drivers: [{driver, field, value}]}.
    Precedence: hostile > wary > warm > neutral (accumulated suspicion/fear
    is never masked by high trust).
    """
    entry = npc_state_entry if isinstance(npc_state_entry, dict) else {}
    trust = int(entry.get("trust", 0) or 0)
    fear = int(entry.get("fear", 0) or 0)
    suspicion = int(entry.get("suspicion", 0) or 0)

    hostile: list[dict[str, Any]] = []
    wary: list[dict[str, Any]] = []
    warm: list[dict[str, Any]] = []

    if trust <= HOSTILE_TRUST_MAX:
        hostile.append({"driver": "low_trust", "field": "trust", "value": trust})
    if suspicion >= HOSTILE_SUSPICION_MIN:
        hostile.append({"driver": "high_suspicion", "field": "suspicion", "value": suspicion})
    if fear >= HOSTILE_FEAR_MIN:
        hostile.append({"driver": "high_fear", "field": "fear", "value": fear})
    if hostile:
        return {"stance": "hostile", "drivers": hostile}

    if fear >= WARY_FEAR_MIN:
        wary.append({"driver": "moderate_fear", "field": "fear", "value": fear})
    if suspicion >= WARY_SUSPICION_MIN:
        wary.append({"driver": "mild_suspicion", "field": "suspicion", "value": suspicion})
    if trust <= WARY_TRUST_MAX:
        wary.append({"driver": "eroded_trust", "field": "trust", "value": trust})
    if wary:
        return {"stance": "wary", "drivers": wary}

    if trust >= WARM_TRUST_MIN:
        warm.append({"driver": "high_trust", "field": "trust", "value": trust})
    if warm:
        return {"stance": "warm", "drivers": warm}

    return {"stance": "neutral", "drivers": []}


def has_signal(npc_state_entry: dict[str, Any] | None) -> bool:
    """True when the entry carries any accumulated psychology (nonzero numeric
    field or any memory record) — i.e. the persisted stance should drive tone."""
    entry = npc_state_entry if isinstance(npc_state_entry, dict) else {}
    if any(int(entry.get(f, 0) or 0) != 0 for f in NUMERIC_FIELDS):
        return True
    return bool(entry.get("known_facts") or entry.get("lies_told") or entry.get("promises"))
