#!/usr/bin/env python3
"""Cthulhu Mythos (CM) tracking for Call of Cthulhu 7e -- Chapter 8 (Sanity).

Owns the structured Cthulhu Mythos skill score and the derived maximum Sanity
for one investigator. CM and SAN max are tightly coupled (Keeper Rulebook
p.167, F9): ``max_san = 99 - cm_value``.

Rulebook basis (7e 40th Anniversary):
- First Mythos encounter grants +5 Cthulhu Mythos (p.167).
- Subsequent Mythos encounters grant +1 each (p.167).
- Maximum Sanity = 99 minus current Cthulhu Mythos skill (p.167, F9).
- When CM rises, the investigator's max SAN drops; current SAN in excess of
  the new max is lost (clamped to the new max).

This module mirrors the coc_mp / coc_healing pattern: it merges ``cm_value``
and ``max_san`` into save/investigator-state/<id>.json and emits structured
events to logs/events.jsonl. It is deterministic given its inputs.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


# --------------------------------------------------------------------------- #
# Rule constants (mirrors sanity.json max_san block + Chapter 8 first-encounter)
# --------------------------------------------------------------------------- #
FIRST_ENCOUNTER_GAIN = 5      # p.167: first Mythos encounter -> +5 CM
SUBSEQUENT_ENCOUNTER_GAIN = 1  # p.167: subsequent encounters -> +1 CM
BASE_MAX_SAN = 99             # p.167 F9: max SAN starts at 99


def max_san_for(cm_value: int) -> int:
    """Return the derived maximum Sanity for a given Cthulhu Mythos score.

    max_san = 99 - cm_value (p.167, F9). Floors at 0.
    """
    return max(0, BASE_MAX_SAN - int(cm_value))


# --------------------------------------------------------------------------- #
# Investigator-state read/write (merge cm_value/max_san/current_san)
# --------------------------------------------------------------------------- #
def _inv_state_path(campaign_dir: Path, investigator_id: str) -> Path:
    return campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"


def _read_inv_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = _inv_state_path(campaign_dir, investigator_id)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_inv_state(campaign_dir: Path, investigator_id: str, data: dict[str, Any]) -> None:
    path = _inv_state_path(campaign_dir, investigator_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _append_event(campaign_dir: Path, event: dict[str, Any]) -> None:
    path = campaign_dir / "logs" / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------- #
# Core: gain_mythos
# --------------------------------------------------------------------------- #
def gain_mythos(
    investigator_state: dict[str, Any],
    *,
    amount: int | None = None,
    is_first: bool = False,
) -> dict[str, Any]:
    """Apply a Cthulhu Mythos gain to an investigator (p.167).

    Parameters:
        investigator_state: mutable dict carrying at least ``cm_value``
            (defaulting to 0 if absent) and optionally ``current_san`` /
            ``max_san``. The dict is updated in place.
        amount: explicit CM gain. When None, the gain is derived from
            ``is_first`` (+5 first encounter, +1 subsequent).
        is_first: True for the investigator's first Mythos encounter (+5).

    Returns the event record describing the gain and any max-SAN adjustment.

    Side effects on ``investigator_state``:
        - ``cm_value`` increases by the gain.
        - ``max_san`` is recomputed (99 - cm_value).
        - ``current_san`` is clamped down to the new max when it exceeds it.
    """
    cm_before = int(investigator_state.get("cm_value", 0))
    if amount is None:
        gain = FIRST_ENCOUNTER_GAIN if is_first else SUBSEQUENT_ENCOUNTER_GAIN
    else:
        gain = int(amount)
    cm_after = cm_before + gain

    max_san_before = int(investigator_state.get("max_san", BASE_MAX_SAN - cm_before))
    max_san_after = max_san_for(cm_after)
    san_clamped = 0
    current_san = investigator_state.get("current_san")
    if current_san is not None:
        current_san = int(current_san)
        if current_san > max_san_after:
            san_clamped = current_san - max_san_after
            current_san = max_san_after
        investigator_state["current_san"] = current_san

    investigator_state["cm_value"] = cm_after
    investigator_state["max_san"] = max_san_after

    return {
        "event_type": "cthulhu_mythos_gain",
        "cm_before": cm_before,
        "cm_gain": gain,
        "cm_after": cm_after,
        "max_san_before": max_san_before,
        "max_san_after": max_san_after,
        "san_clamped": san_clamped,
        "is_first": is_first,
        "summary": (
            f"Cthulhu Mythos +{gain} ({cm_before}->{cm_after}); "
            f"max SAN {max_san_before}->{max_san_after}"
            + (f"; current SAN clamped by {san_clamped}" if san_clamped else "")
            + "."
        ),
    }


# --------------------------------------------------------------------------- #
# Persistence helpers (campaign-level)
# --------------------------------------------------------------------------- #
def gain_mythos_persisted(
    campaign_dir: Path,
    investigator_id: str,
    *,
    is_first: bool = False,
    amount: int | None = None,
) -> dict[str, Any]:
    """Load investigator-state, apply a CM gain, persist, and log the event.

    Returns the event record. Convenience wrapper combining gain_mythos with
    investigator-state read/write + events.jsonl append.
    """
    data = _read_inv_state(campaign_dir, investigator_id)
    event = gain_mythos(data, amount=amount, is_first=is_first)
    event["investigator_id"] = investigator_id
    _write_inv_state(campaign_dir, investigator_id, data)
    _append_event(campaign_dir, event)
    return event


# --------------------------------------------------------------------------- #
# Becoming a believer (p.179)
# --------------------------------------------------------------------------- #
def become_believer(
    investigator_state: dict[str, Any],
    *,
    source: str = "first_hand_encounter",
    mythos_gain: int | None = None,
    is_first: bool = False,
) -> dict[str, Any]:
    """Resolve becoming a believer in the Mythos (Keeper Rulebook p.179).

    Two paths:
      - ``source="first_hand_encounter"`` (default): a first-hand Mythos
        encounter *forces* belief. The investigator loses SAN equal to their
        current Cthulhu Mythos skill (the "believer bomb", F3), then gains CM
        and their max SAN drops accordingly.
      - ``source="tome"``: reading a tome may let the investigator *choose* not
        to believe. They still gain CM and lose max SAN, but lose no SAN points.

    Parameters:
        investigator_state: mutable dict carrying ``cm_value`` (default 0),
            ``current_san`` (optional), and ``max_san`` (optional). Updated
            in place.
        source: "first_hand_encounter" or "tome".
        mythos_gain: explicit CM gain; None derives from ``is_first`` (+5/+1).
        is_first: True for the investigator's first Mythos encounter.

    Returns the event record.
    """
    if source not in ("first_hand_encounter", "tome"):
        raise ValueError(f"unsupported believer source: {source!r}")

    cm_before = int(investigator_state.get("cm_value", 0))
    san_before = investigator_state.get("current_san")
    san_before_int = int(san_before) if san_before is not None else None

    # The believer bomb: first-hand encounter costs SAN = current CM.
    san_lost = 0
    permanently_insane = False
    if source == "first_hand_encounter" and san_before_int is not None:
        san_lost = cm_before
        san_before_int = max(0, san_before_int - san_lost)
        investigator_state["current_san"] = san_before_int
        permanently_insane = san_before_int == 0

    # Then gain CM (which drops max SAN and may clamp current SAN further).
    gain_event = gain_mythos(investigator_state, amount=mythos_gain, is_first=is_first)

    return {
        "event_type": "become_believer",
        "source": source,
        "cm_before": cm_before,
        "cm_after": gain_event["cm_after"],
        "san_lost": san_lost,
        "san_after": san_before_int,
        "permanently_insane": permanently_insane,
        "max_san_after": gain_event["max_san_after"],
        "is_first": is_first,
        "mythos_gain_event": gain_event,
        "rule_ref": "core.mythos.become_believer",
        "summary": (
            f"Became believer ({source}): CM {cm_before}->{gain_event['cm_after']}, "
            + (f"SAN -{san_lost}" if san_lost else "no SAN lost (tome, chose not to believe)")
            + (", permanent insanity" if permanently_insane else "")
            + "."
        ),
    }


def become_believer_persisted(
    campaign_dir: Path,
    investigator_id: str,
    *,
    source: str = "first_hand_encounter",
    mythos_gain: int | None = None,
    is_first: bool = False,
) -> dict[str, Any]:
    """Load investigator-state, apply become_believer, persist, and log."""
    data = _read_inv_state(campaign_dir, investigator_id)
    event = become_believer(data, source=source, mythos_gain=mythos_gain,
                            is_first=is_first)
    event["investigator_id"] = investigator_id
    _write_inv_state(campaign_dir, investigator_id, data)
    _append_event(campaign_dir, event)
    return event
