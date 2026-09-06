"""Continuation checkpoint (contract §12.2): `save/continuation/latest.json`.

The checkpoint is a rebuildable cache of the last committed turn, never history. The
turn record under `turns/` and the git commit are the truth; when the two disagree
(the process died between the commit and this file) the checkpoint is rebuilt from
HEAD's turn record and nobody is told it was ever missing."""

from __future__ import annotations

from typing import Any

from . import history
from .facts import one_line
from .fileio import canonical_json, read_json, sha256_text, write_json_atomic
from .store import Campaign, fresh_turn, now_iso

SCHEMA = 1


def receipts_digest(receipts: list[dict[str, Any]]) -> str:
    return sha256_text(canonical_json(receipts))


def read_checkpoint(campaign: Campaign) -> dict[str, Any] | None:
    """None when the file is missing or unreadable; a broken cache is the same as no cache."""
    path = campaign.checkpoint_path
    if not path.exists():
        return None
    try:
        data = read_json(path)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("turn"), int) or not data.get("commit"):
        return None
    return data


def checkpoint_from_record(campaign_id: str, record: dict[str, Any],
                           fallback_snapshot: dict[str, Any]) -> dict[str, Any]:
    """The checkpoint a committed turn record implies. `record["world"]` is the snapshot
    narrate wrote at close; a record without one (never written by this kernel) takes
    the caller's current snapshot."""
    snapshot = record.get("world") if isinstance(record.get("world"), dict) else fallback_snapshot
    scene = snapshot.get("scene") or {}
    clock = snapshot.get("clock") or {"minutes": 0}
    session = snapshot.get("session")
    return {
        "schema": SCHEMA,
        "campaign": campaign_id,
        "turn": int(record["turn"]),
        "commit": record.get("commit"),
        "at": now_iso(),
        "scene": {"name": scene.get("name"), "display_name": scene.get("display_name")},
        "clock": {"minutes": int(clock.get("minutes") or 0)},
        "investigators": list(snapshot.get("investigators") or []),
        "session": ({"kind": session.get("kind"), "status": session.get("status"), "round": session.get("round")}
                    if isinstance(session, dict) else None),
        "pending_choice": snapshot.get("pending_choice", record.get("pending_choice")),
        "receipts_digest": receipts_digest(list(record.get("receipts") or [])),
        "one_line": one_line(int(record["turn"]), str(scene.get("display_name") or scene.get("name")),
                             int(clock.get("minutes") or 0), session, record.get("rendered_text")),
    }


def write_checkpoint(campaign: Campaign, checkpoint: dict[str, Any]) -> None:
    write_json_atomic(campaign.checkpoint_path, checkpoint)


def sync_checkpoint(campaign: Campaign, fallback_snapshot: dict[str, Any]) -> tuple[dict[str, Any] | None, bool]:
    """Make the checkpoint agree with HEAD. Returns (checkpoint, rebuilt). HEAD ahead of
    the checkpoint (or no checkpoint at all while HEAD has a turn) rebuilds it from
    HEAD's turn record; no narrate commit yet leaves whatever is there."""
    checkpoint = read_checkpoint(campaign)
    head = history.head_sha(campaign.repo_dir, campaign.dir)
    head_turn = history.head_turn(campaign.repo_dir, campaign.dir)
    if head is None or head_turn is None:
        return checkpoint, False
    if checkpoint is not None and checkpoint.get("commit") == head and checkpoint.get("turn") == head_turn:
        return checkpoint, False
    record = campaign.read_turn_record(head_turn)
    if record is None or record.get("closed_by") != "narrate":
        return checkpoint, False
    if record.get("commit") != head:
        # Died after the commit, before the record learned its sha.
        record["commit"] = head
        campaign.write_turn_record(record)
    checkpoint = checkpoint_from_record(campaign.id, record, fallback_snapshot)
    write_checkpoint(campaign, checkpoint)
    return checkpoint, True


def readable_turn(campaign: Campaign) -> dict[str, Any] | None:
    """turn.json as a dict when it is intact; None when missing or corrupt."""
    if not campaign.turn_json.exists():
        return None
    try:
        data = read_json(campaign.turn_json)
    except (OSError, ValueError):
        return None
    if (not isinstance(data, dict) or not isinstance(data.get("turn"), int)
            or not isinstance(data.get("state"), str)):
        return None
    return data


def rebuild_turn(campaign: Campaign, checkpoint: dict[str, Any] | None) -> dict[str, Any] | None:
    """A lost turn.json becomes `fresh_turn(checkpoint.turn + 1)` — or, when a later turn
    was closed by `ask`, that turn in `asked` with its pending choice, so the player's
    answer still lands. Before the first narrate commit there is nothing but turn 0."""
    records = campaign.turn_records_by_number()
    if checkpoint is None:
        if records or history.head_turn(campaign.repo_dir, campaign.dir) is not None:
            return None
        turn = fresh_turn(0)
        campaign.write_turn(turn)
        return turn
    base = int(checkpoint["turn"])
    asked = [r for n, r in sorted(records.items()) if n > base and r.get("closed_by") == "ask"]
    if asked:
        last = asked[-1]
        turn = fresh_turn(int(last["turn"]), "asked", last.get("pending_choice"))
    else:
        turn = fresh_turn(base + 1)
    campaign.write_turn(turn)
    return turn


def resume_view(checkpoint: dict[str, Any] | None, rebuilt: bool) -> dict[str, Any] | None:
    if checkpoint is None:
        return None
    return {
        "turn": checkpoint["turn"],
        "commit": checkpoint["commit"],
        "scene": checkpoint.get("scene"),
        "clock": checkpoint.get("clock"),
        "session": checkpoint.get("session"),
        "one_line": checkpoint.get("one_line"),
        "rebuilt": bool(rebuilt),
    }

