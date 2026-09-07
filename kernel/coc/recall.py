"""`table.recall` — the transcript and history roads (contract §12.4). The memory road
lives in memory.py next to the store it reads.

Transcript: structured selectors only (turn range, role, an exact {turn, role} locator).
`verified` is the sha256 of the transcript row's text against the turn record's own
copy (`rendered_text` for the keeper, `player_text` for the player): a transcript row
that drifted from what the turn record says is returned anyway, marked false.

History: timeline and diff come from `turns/NNNN.json` alone, never from git objects."""

from __future__ import annotations

from typing import Any

from .errors import invalid_params, unsupported_value
from .events import EVENT_TYPES
from .facts import head_of
from .fileio import sha256_text
from .store import Campaign

TRANSCRIPT_DEFAULT_TURNS = 3
TRANSCRIPT_MAX_CARDS = 40
CARD_HEAD_CHARS = 80
HISTORY_DEFAULT_TURNS = 20
HISTORY_MAX_EVENTS = 200
RECEIPT_KINDS = ("roll", "move", "clue", "delta", "session", "time")
ROLES = ("player", "keeper")


def parse_span(value: Any, current: int, default_turns: int) -> list[int]:
    if value is None:
        return [max(0, current - default_turns + 1), current]
    if (not isinstance(value, list) or len(value) != 2
            or not all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in value) or value[0] > value[1]):
        raise invalid_params("turns must be [from, to] with 0 <= from <= to")
    return [int(value[0]), int(value[1])]


def parse_role(value: Any) -> str | None:
    if value is not None and value not in ROLES:
        raise invalid_params("role must be 'player' or 'keeper'")
    return value


# ---- transcript ---------------------------------------------------------------------------

def record_text(record: dict[str, Any] | None, role: str) -> str | None:
    if record is None:
        return None
    return record.get("rendered_text") if role == "keeper" else record.get("player_text")


def transcript(campaign: Campaign, current: int, params: dict[str, Any]) -> dict[str, Any]:
    read = params.get("read")
    if read is not None:
        return transcript_read(campaign, read)
    span = parse_span(params.get("turns"), current, TRANSCRIPT_DEFAULT_TURNS)
    role = parse_role(params.get("role"))
    entries = [e for e in campaign.read_transcript()
               if span[0] <= int(e["turn"]) <= span[1] and (role is None or e["role"] == role)]
    cards = [{"turn": int(e["turn"]), "role": e["role"], "chars": len(e.get("text") or ""),
              "head": " ".join(str(e.get("text") or "").split())[:CARD_HEAD_CHARS]}
             for e in entries[-TRANSCRIPT_MAX_CARDS:]]
    result: dict[str, Any] = {"what": "transcript", "turns": span, "cards": cards}
    if span[1] - span[0] + 1 <= TRANSCRIPT_DEFAULT_TURNS:
        # slice 0 behaviour kept for short windows: the rows themselves
        result["entries"] = entries
    return result


def transcript_read(campaign: Campaign, read: Any) -> dict[str, Any]:
    if (not isinstance(read, dict) or not isinstance(read.get("turn"), int) or isinstance(read.get("turn"), bool)
            or read.get("role") not in ROLES):
        raise invalid_params("read must be {turn: int, role: player|keeper}")
    turn, role = int(read["turn"]), str(read["role"])
    rows = [e for e in campaign.read_transcript() if int(e["turn"]) == turn and e["role"] == role]
    if not rows:
        available = sorted({(int(e["turn"]), e["role"]) for e in campaign.read_transcript()})
        raise invalid_params(f"no {role} row for turn {turn} in the transcript",
                             fix="pick a card from recall transcript first",
                             details={"turn": turn, "role": role,
                                      "available": [{"turn": t, "role": r} for t, r in available[-TRANSCRIPT_MAX_CARDS:]]})
    text = str(rows[-1].get("text") or "")
    canonical = record_text(campaign.read_turn_record(turn), role)
    verified = canonical is not None and sha256_text(text) == sha256_text(str(canonical))
    return {"what": "transcript", "turn": turn, "role": role, "text": text, "verified": verified}


# ---- history ------------------------------------------------------------------------------

def timeline_row(record: dict[str, Any]) -> dict[str, Any]:
    snapshot = record.get("world") if isinstance(record.get("world"), dict) else {}
    scene = snapshot.get("scene") or {}
    counts = {kind: 0 for kind in RECEIPT_KINDS}
    for receipt in record.get("receipts") or []:
        kind = receipt.get("kind")
        if kind in counts:
            counts[kind] += 1
    return {
        "turn": int(record["turn"]),
        "commit": record.get("commit"),
        "scene": scene.get("name"),
        "clock": (snapshot.get("clock") or {}).get("minutes"),
        "closed_by": record.get("closed_by"),
        "receipts": counts,
        "head": head_of(record.get("rendered_text")),
    }


def history(campaign: Campaign, current: int, params: dict[str, Any]) -> dict[str, Any]:
    span = parse_span(params.get("turns"), current, HISTORY_DEFAULT_TURNS)
    types = params.get("types")
    if types is not None:
        if not isinstance(types, list) or not all(isinstance(t, str) for t in types):
            raise invalid_params("types must be a list of event types")
        unknown = sorted(set(types) - EVENT_TYPES)
        if unknown:
            raise unsupported_value("types", sorted(unknown), sorted(EVENT_TYPES),
                                    message=f"unknown event types {unknown}")
    records = campaign.turn_records_by_number()
    timeline = [timeline_row(records[n]) for n in sorted(records) if span[0] <= n <= span[1]]
    events = [e for e in campaign.read_events()
              if span[0] <= int(e.get("turn", -1)) <= span[1] and (types is None or e.get("type") in types)]
    result: dict[str, Any] = {"what": "history", "turns": span, "timeline": timeline,
                              "events": events[-HISTORY_MAX_EVENTS:]}
    diff = params.get("diff")
    if diff is not None:
        result["diff"] = history_diff(records, diff)
    return result


def worldline_tree(meta: dict[str, Any]) -> dict[str, Any]:
    """§15.6: `recall history {lines: true}`. Every line the campaign has, in fork order:
    where it branched, which circuit of the loop it is, how far it played and whether it
    is the one at the table. Read from the registry alone; no git object is opened."""
    from .worldline import active_name, registry  # local: worldline reads history, which reads nothing here
    lines = registry(meta)
    active = active_name(meta)
    rows = []
    for name in sorted(lines):
        row = lines[name] if isinstance(lines[name], dict) else {}
        forked = row.get("forked_from") if isinstance(row.get("forked_from"), dict) else None
        rows.append({"name": name, "kind": row.get("kind"), "loop": int(row.get("loop") or 0),
                     "status": row.get("status"), "last_turn": row.get("last_turn"),
                     "last_commit": row.get("last_commit"),
                     "forked_from": ({"line": forked.get("line"), "turn": forked.get("turn"),
                                      "commit": forked.get("commit")} if forked else None),
                     "parents": row.get("parents") or [],
                     "active": name == active})
    return {"active": active, "lines": rows}


def history_diff(records: dict[int, dict[str, Any]], diff: Any) -> dict[str, Any]:
    """State at the end of turn a against the end of turn b, accumulated from the receipts
    of turns a+1..b. Only turn records are read."""
    if (not isinstance(diff, list) or len(diff) != 2
            or not all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in diff) or diff[0] > diff[1]):
        raise invalid_params("diff must be [turn_a, turn_b] with 0 <= turn_a <= turn_b")
    a, b = int(diff[0]), int(diff[1])
    missing = [n for n in (a, b) if n not in records]
    if missing:
        raise invalid_params(f"no turn record for {missing}", details={"closed_turns": sorted(records)})

    def snapshot(n: int) -> dict[str, Any]:
        world = records[n].get("world")
        return world if isinstance(world, dict) else {}

    clues: list[str] = []
    resources: dict[tuple[str, str], dict[str, Any]] = {}
    sessions: list[dict[str, Any]] = []
    moves: list[dict[str, Any]] = []
    for n in sorted(records):
        if not a < n <= b:
            continue
        for receipt in records[n].get("receipts") or []:
            kind = receipt.get("kind")
            if kind == "clue":
                name = receipt.get("clue")
                if name not in clues:
                    clues.append(str(name))
            elif kind in ("delta", "cash"):
                # #19: a cash receipt carries resource/subject/before/after like a delta
                key = (str(receipt.get("subject")), str(receipt.get("resource")))
                row = resources.setdefault(key, {"subject": key[0], "resource": key[1], "from": receipt.get("before"),
                                                 "to": receipt.get("after")})
                row["to"] = receipt.get("after")
            elif kind == "session":
                row = {"turn": n, "family": receipt.get("family"), "transition": receipt.get("transition")}
                if receipt.get("outcome") is not None:
                    row["outcome"] = receipt.get("outcome")
                sessions.append(row)
            elif kind == "move":
                moves.append({"turn": n, "from": receipt.get("from"), "to": receipt.get("to")})
    return {
        "from": a, "to": b,
        "scene": [(snapshot(a).get("scene") or {}).get("name"), (snapshot(b).get("scene") or {}).get("name")],
        "clock": [(snapshot(a).get("clock") or {}).get("minutes"), (snapshot(b).get("clock") or {}).get("minutes")],
        "clues_added": clues,
        "resources": list(resources.values()),
        "sessions": sessions,
        "moves": moves,
    }
