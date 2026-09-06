"""Cthulhu Mythos tracking and max-SAN coupling (Chapter 8). Ported from coc_mythos.py.

The kernel keeps `cm_value`, `max_san` and `current_san` on the party sheet, so the
persisted variants here mutate the sheet dict the caller then writes; there is no
separate investigator-state file."""

from __future__ import annotations

from typing import Any

FIRST_ENCOUNTER_GAIN = 5
SUBSEQUENT_ENCOUNTER_GAIN = 1
BASE_MAX_SAN = 99


def max_san_for(cm_value: int) -> int:
    """max_san = 99 - cm_value (p.167, F9). Floors at 0."""
    return max(0, BASE_MAX_SAN - int(cm_value))


def gain_mythos(investigator_state: dict[str, Any], *, amount: int | None = None,
                is_first: bool = False) -> dict[str, Any]:
    """Apply a Cthulhu Mythos gain: cm_value rises, max_san drops, current_san clamps."""
    cm_before = int(investigator_state.get("cm_value", 0))
    gain = (FIRST_ENCOUNTER_GAIN if is_first else SUBSEQUENT_ENCOUNTER_GAIN) if amount is None else int(amount)
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
        "event_type": "cthulhu_mythos_gain", "cm_before": cm_before, "cm_gain": gain, "cm_after": cm_after,
        "max_san_before": max_san_before, "max_san_after": max_san_after, "san_clamped": san_clamped,
        "is_first": is_first,
        "summary": (f"Cthulhu Mythos +{gain} ({cm_before}->{cm_after}); max SAN {max_san_before}->{max_san_after}"
                    + (f"; current SAN clamped by {san_clamped}" if san_clamped else "") + "."),
    }


def become_believer(investigator_state: dict[str, Any], *, source: str = "first_hand_encounter",
                    mythos_gain: int | None = None, is_first: bool = False) -> dict[str, Any]:
    """p.179: a first-hand encounter forces belief and costs SAN equal to current CM;
    a tome lets the investigator choose not to believe (CM still rises)."""
    if source not in ("first_hand_encounter", "tome"):
        raise ValueError(f"unsupported believer source: {source!r}")
    cm_before = int(investigator_state.get("cm_value", 0))
    san_before = investigator_state.get("current_san")
    san_before_int = int(san_before) if san_before is not None else None
    san_lost = 0
    permanently_insane = False
    if source == "first_hand_encounter" and san_before_int is not None:
        san_lost = cm_before
        san_before_int = max(0, san_before_int - san_lost)
        investigator_state["current_san"] = san_before_int
        permanently_insane = san_before_int == 0
    gain_event = gain_mythos(investigator_state, amount=mythos_gain, is_first=is_first)
    investigator_state["believer"] = True
    return {
        "event_type": "become_believer", "source": source, "cm_before": cm_before,
        "cm_after": gain_event["cm_after"], "san_lost": san_lost, "san_after": san_before_int,
        "permanently_insane": permanently_insane, "max_san_after": gain_event["max_san_after"],
        "is_first": is_first, "believer": True, "mythos_gain_event": gain_event,
        "rule_ref": "core.mythos.become_believer",
        "summary": (f"Became believer ({source}): CM {cm_before}->{gain_event['cm_after']}, "
                    + (f"SAN -{san_lost}" if san_lost else "no SAN lost (tome, chose not to believe)")
                    + (", permanent insanity" if permanently_insane else "") + "."),
    }
