"""Contract §15.4 (#23): echoes -- what another worldline left behind, here.

An echo is a projection of receipts, never a piece of narration. When the party rewinds
(a `loop` fork) or two lines flow together (a `merge`), the kernel reads the other lines'
turn records straight out of git and writes one row per thing that happened there which
the party could plausibly run into again: a door they went through, a clue they took, a
fight, a death, a handout. The keeper cannot edit an echo -- only decide whether to reveal
it, and how to tell it. Revealing it is an ordinary `apply clue` whose handle is the echo's
id, so the evidence rule holds: an echo the keeper only talked about is not discovered.

Summaries are written here, deterministically, from the receipt alone. They are English
(§16: everything the kernel writes is English; the keeper tells the player in the
campaign's play language).
"""

from __future__ import annotations

import json
from typing import Any

from . import history
from .fileio import read_json, write_json_atomic
from .store import Campaign, now_iso

#: The prefix an echo handle carries everywhere: in its id, in `apply clue`, and in
#: `world.discovered_echoes`. A clue handle can never collide with it (`§2` names are
#: kebab slugs and carry no colon).
PREFIX = "echo:"
#: §15.4's closed list of what an echo can be about.
PRESENCE, CLUE_TAKEN, FIGHT, DEATH, MOVE, HANDOUT = (
    "presence", "clue_taken", "fight", "death", "move", "handout")
KINDS = (PRESENCE, CLUE_TAKEN, FIGHT, DEATH, MOVE, HANDOUT)
SCHEMA = 1
#: §17.3's word for "off the stage": an NPC taken away leaves no trace of standing here.
AWAY = "away"


def is_echo(handle: str) -> bool:
    return isinstance(handle, str) and handle.startswith(PREFIX)


# ---- reading and writing the file -----------------------------------------------------

def read(campaign: Campaign) -> list[dict[str, Any]]:
    path = campaign.echoes_path
    if not path.exists():
        return []
    try:
        data = read_json(path)
    except (OSError, ValueError):
        return []
    rows = data.get("echoes") if isinstance(data, dict) else data
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def write(campaign: Campaign, rows: list[dict[str, Any]]) -> None:
    write_json_atomic(campaign.echoes_path,
                      {"schema": SCHEMA, "echoes": rows, "written_at": now_iso()})


def find(rows: list[dict[str, Any]], echo_id: str) -> dict[str, Any] | None:
    return next((row for row in rows if str(row.get("id")) == echo_id), None)


def merged_into(existing: list[dict[str, Any]], fresh: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Echoes accumulate: a second rewind does not erase what the first loop left. Ids are
    unique per line and turn, so the same echo generated twice replaces itself."""
    by_id = {str(row.get("id")): row for row in existing}
    for row in fresh:
        by_id[str(row.get("id"))] = row
    return [by_id[key] for key in sorted(by_id)]


# ---- generating them from another line's receipts --------------------------------------

def generate(campaign: Campaign, line: str, loop: int) -> list[dict[str, Any]]:
    """Every echo one worldline leaves. The line is read out of git, not checked out: the
    party is standing on another branch while this runs."""
    repo, tree = campaign.repo_dir, campaign.dir
    rows: list[dict[str, Any]] = []
    for path in history.line_tree(repo, tree, line, "turns/"):
        raw = history.line_blob(repo, tree, line, path)
        if raw is None:
            continue
        try:
            record = json.loads(raw)
        except ValueError:
            continue
        if isinstance(record, dict):
            rows.extend(from_record(record, line, loop))
    return rows


def from_record(record: dict[str, Any], line: str, loop: int) -> list[dict[str, Any]]:
    """One turn's receipts, projected. The ordinal `k` is the position among the echoes
    this turn produced, so two runs over the same record write the same ids."""
    turn = record.get("turn")
    if not isinstance(turn, int):
        return []
    snapshot = record.get("world") if isinstance(record.get("world"), dict) else {}
    where = str((snapshot.get("scene") or {}).get("name") or "")
    rows: list[dict[str, Any]] = []
    for receipt in record.get("receipts") or []:
        if not isinstance(receipt, dict):
            continue
        made = _echo_of(receipt, where)
        if made is None:
            continue
        kind, scene, summary, entities = made
        rows.append({
            "id": f"{PREFIX}{line}-t{turn}-{len(rows) + 1}",
            "line": line, "loop": int(loop), "turn": turn, "scene": scene, "kind": kind,
            "summary": summary, "receipts": [str(receipt.get("id"))], "entities": entities,
        })
    return rows


def _echo_of(receipt: dict[str, Any], where: str) -> tuple[str, str, str, list[str]] | None:
    """The one echo a receipt leaves, or None when it leaves none. Rolls that only moved a
    number, time, bookkeeping and the worldline receipts themselves leave nothing: an echo
    is something the party could walk into, not everything that was written down."""
    kind = str(receipt.get("kind") or "")
    if kind == "move":
        to = str(receipt.get("to") or where)
        return (MOVE, to, f"They came here from {receipt.get('from') or 'elsewhere'}.", [])
    if kind == "clue":
        scene = str(receipt.get("scene") or where)
        label = str(receipt.get("label") or receipt.get("clue") or "")
        source = receipt.get("from")
        told = f" {source} gave it to them." if source else ""
        return (CLUE_TAKEN, scene, f"They found {label} here.{told}", [str(source)] if source else [])
    if kind == "handout":
        name = str(receipt.get("label") or receipt.get("name") or receipt.get("handout") or "")
        return (HANDOUT, where, f"They were shown {name} here.", [])
    if kind == "session" and str(receipt.get("family") or "") == "combat":
        return (FIGHT, where, "A fight broke out here.", [])
    if kind == "npc":
        to, name = receipt.get("to"), str(receipt.get("name") or receipt.get("handle") or "")
        if isinstance(to, str) and to and to != AWAY and name:
            return (PRESENCE, to, f"{name} was here.", [name])
        return None
    if kind == "delta" and _is_death(receipt):
        who = str(receipt.get("subject_label") or receipt.get("subject") or "Someone")
        return (DEATH, where, f"{who} died here.", [who])
    return None


def _is_death(receipt: dict[str, Any]) -> bool:
    after = receipt.get("after")
    return str(receipt.get("resource") or "") == "hp" and isinstance(after, int) and after <= 0


# ---- what the capsule and `apply clue` see ---------------------------------------------

def here(rows: list[dict[str, Any]], scene: str, discovered: list[str] | None = None) -> list[dict[str, Any]]:
    """The echoes standing in this scene that the party has not been shown yet, oldest
    line and turn first, so the keeper is offered the same three every time."""
    seen = {str(handle) for handle in (discovered or [])}
    return sorted((row for row in rows
                   if str(row.get("scene") or "") == scene and str(row.get("id")) not in seen),
                  key=lambda row: (str(row.get("line")), int(row.get("turn") or 0), str(row.get("id"))))
