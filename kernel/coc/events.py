"""events.jsonl (contract §7, §12.1): {seq, turn, type, at, call_id?, receipt?, data}.

A closed enumeration -- eighteen types in §12.1, plus the two §15 worldline transitions.
Anything else is a kernel defect (ValueError), never a keeper error."""

from __future__ import annotations

from typing import Any

from .fileio import append_jsonl
from .store import Campaign, now_iso

EVENT_TYPES = frozenset({
    "turn-started",
    "player-declared",
    "roll-resolved",
    "scene-moved",
    "clue-discovered",
    "time-advanced",
    "turn-finalized",
    # slice 1: one per resource delta receipt, one per settled RuleGraph decision
    "resource-changed",
    "decision-settled",
    # slice 2: one per session receipt, one per ask, one per accepted memory.submit
    "session-changed",
    "choice-asked",
    "memory-written",
    # slice 4 (§14.7, §14.8): the setup handoff and a handout shown to the player
    "setup-completed",
    "handout-shown",
    # #19: an item reaching (or leaving) an investigator's sheet; cash rides resource-changed
    "item-transferred",
    # §18 (#27): the keeper's bookkeeping -- a world flag, a continuity note, a table ruling
    "flag-set",
    "note-written",
    "ruling-made",
    # §17.3 (#29): a person moved on or off the stage, or the keeper set where they stand
    "npc-changed",
    # §15 (#23): a worldline forked, resumed or merged, appended after that turn's commit
    "worldline-forked",
    "worldline-switched",
    "worldline-merged",
})


def next_seq(campaign: Campaign) -> int:
    path = campaign.events_path
    if not path.exists():
        return 1
    with open(path, "rb") as handle:
        return sum(1 for line in handle if line.strip()) + 1


def append_event(campaign: Campaign, turn: int, event_type: str, data: dict[str, Any], *,
                 call_id: str | None = None, receipt: str | None = None) -> dict[str, Any]:
    if event_type not in EVENT_TYPES:
        raise ValueError(f"unknown event type {event_type!r}")
    event: dict[str, Any] = {"seq": next_seq(campaign), "turn": turn, "type": event_type,
                             "at": now_iso()}
    if call_id is not None:
        event["call_id"] = call_id
    if receipt is not None:
        event["receipt"] = receipt
    event["data"] = data
    append_jsonl(campaign.events_path, event)
    return event
