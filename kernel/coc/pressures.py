"""`pressures` and `obligations` (contract §13.2): every row comes from a structural
source — a rule clock the situations already surfaced, a module `threat`/`quest` node
and its relations, the pending choice, the live session, an unanswered continuation, an
open `promise` candidate. Nothing here reads prose to decide anything.

Rows are English sentences built from closed templates (§16.1); the `cue` is the author's
pressure move or the rule's next decision, never an invented one."""

from __future__ import annotations

from typing import Any

from .module_graph import CLUE_KIND, ModuleGraph, record_of
from .text import normalize

#: Rule clocks (§13.2): the situation decision that surfaces each one and how its state
#: is read. `segments` is (elapsed, total) when the clock has a countable length.
WOUND_HOUR_MINUTES = 60

TEMPLATES = {
    "wound_hour": "the hour after the wound", "wound_state": "{elapsed}/{total} minutes gone", "wound_due": "first-aid window closes in {left} min",
    "dying_hour": "dying (stabilized, hour clock)", "dying_round": "dying (unstabilized, CON per round)", "dying_state": "HP {hp}",
    "bout": "bout of madness", "bout_state": "{left}/{total} rounds left", "bout_due": "{left} rounds",
    "weekly": "weekly major-wound recovery", "weekly_state": "due this week",
    "threat_clock": "{current}/{total}", "threat_no_clock": "no clock; {dangers} danger(s)",
    "rule_state": "left by last turn, unanswered", "continuation_cue": "needs action.{fields}",
    "choice_state": "pending", "session_state": "round {round}, {who} to act",
    "quest_not_started": "not started", "quest_in_progress": "in progress ({found}/{total} clues)", "quest_closable": "can close ({total}/{total} clues)",
    "quest_no_clues": "not started (no clue markers)",
    "promise_state": "{statement}",
}

CLOCK_DECISIONS = {
    "healing:first-aid-ordinary": "wound_hour",
    "healing:dying-hour-clock": "dying_hour",
    "healing:dying-round-clock": "dying_round",
    "healing:first-aid-stabilization": "dying_round",
    "healing:weekly-major-wound-recovery": "weekly",
    "sanity:bout-tick": "bout",
}
PROMISE_STATEMENT_CHARS = 120


def _t(key: str, **fields: Any) -> str:
    table = TEMPLATES
    return table[key].format(**fields)


# ---- pressures ------------------------------------------------------------------------------

def _fact(situation: dict[str, Any], path: str) -> Any:
    for line in situation.get("because") or []:
        head, _, value = str(line).partition(" = ")
        if head == path:
            try:
                return int(value)
            except ValueError:
                return value.strip("'\"")
    return None


def clock_pressures(situations: list[dict[str, Any]], party: list[dict[str, Any]],
                    session: dict[str, Any] | None, fraction: tuple[int, int]) -> tuple[list[dict[str, Any]], bool]:
    """One row per rule clock the situations surface; returns (rows, any clock near full).
    Near full = elapsed segments >= total * num/den, the fraction being the Director
    graph's `pressure-clock-near-full-fraction`."""
    num, den = int(fraction[0]), int(fraction[1])
    rows: list[dict[str, Any]] = []
    near_full = False
    seen: set[tuple[str, str]] = set()
    sheets = {str(s.get("id")): s for s in party}
    for situation in situations:
        kind = CLOCK_DECISIONS.get(str(situation.get("decision")))
        if kind is None:
            continue
        who = str(situation.get("investigator"))
        key = (kind, who)
        if key in seen:
            continue
        seen.add(key)
        sheet = sheets.get(who) or {}
        row: dict[str, Any] = {"kind": "clock", "cue": situation.get("decision")}
        segments: tuple[int, int] | None = None
        if kind == "wound_hour":
            elapsed = _fact(situation, "time.minutes_since_injury")
            elapsed = int(elapsed) if isinstance(elapsed, int) else 0
            row["name"] = _t("wound_hour")
            row["state"] = _t("wound_state", elapsed=elapsed, total=WOUND_HOUR_MINUTES)
            row["due"] = _t("wound_due", left=max(0, WOUND_HOUR_MINUTES - elapsed))
            segments = (elapsed, WOUND_HOUR_MINUTES)
        elif kind in ("dying_hour", "dying_round"):
            row["name"] = _t(kind)
            row["state"] = _t("dying_state", hp=sheet.get("current_hp"))
            near_full = True  # a dying clock is always at the edge
        elif kind == "weekly":
            row["name"] = _t("weekly")
            row["state"] = _t("weekly_state")
        elif kind == "bout":
            bout = (session or {}).get("bout") if (session or {}).get("kind") == "sanity_bout" else None
            total = int((bout or {}).get("duration_rounds") or 0)
            left = int((bout or {}).get("rounds_remaining") or 0)
            row["name"] = _t("bout")
            row["state"] = _t("bout_state", left=left, total=total)
            row["due"] = _t("bout_due", left=left)
            if total > 0:
                segments = (total - left, total)
        if segments is not None:
            row["name"] = row["name"]
            elapsed, total = segments
            if total > 0 and elapsed * den >= total * num:
                near_full = True
        if len(sheets) > 1:
            row["who"] = str(sheet.get("name") or who)
        rows.append(row)
    return rows, near_full


def _danger_names(threat: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for danger in record_of(threat).get("dangers") or []:
        if not isinstance(danger, dict):
            continue
        for key in ("monster_ref", "id", "npc_id"):
            value = danger.get(key)
            if isinstance(value, str) and value:
                names.append(value)
    return names


def _related_to_scene(graph: ModuleGraph, threat: dict[str, Any], scene: dict[str, Any], present: list[dict[str, Any]]) -> bool:
    """A threat counts here when a `present-in` / `located-in` / `contains` relation reaches
    the scene or a present NPC from it (either direction), or a danger names a present NPC."""
    targets = {scene["node_id"], *(n["node_id"] for n in present)}
    for rel in graph.out_rel.get(threat["node_id"], []):
        if rel.get("relation_kind") in ("present-in", "located-in", "contains") and rel.get("to_node_id") in targets:
            return True
    for rel in graph.in_rel.get(threat["node_id"], []):
        if rel.get("relation_kind") in ("present-in", "located-in", "contains") and rel.get("from_node_id") in targets:
            return True
    present_keys: set[str] = set()
    for node in present:
        present_keys.update(normalize(k) for k in (graph.handle(node), graph.display_name(node), node["node_id"], node.get("name") or ""))
    return any(normalize(name) in present_keys for name in _danger_names(threat))


def threat_pressures(graph: ModuleGraph, scene: dict[str, Any], present: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    moves = [str(m) for m in record_of(scene).get("pressure_moves") or []]
    for threat in graph.by_kind.get("threat", []):
        if not _related_to_scene(graph, threat, scene, present):
            continue
        record = record_of(threat)
        clocks = [c for c in record.get("clocks") or [] if isinstance(c, dict)]
        if clocks:
            clock = clocks[0]
            state = _t("threat_clock", current=clock.get("current_segments", 0), total=clock.get("segments", "?"))
        else:
            state = _t("threat_no_clock", dangers=len(record.get("dangers") or []))
        row: dict[str, Any] = {"kind": "threat", "name": graph.handle(threat), "state": state}
        if moves:
            row["cue"] = "; ".join(moves)
        rows.append(row)
    return rows


def unanswered_continuations(previous: dict[str, Any] | None, current_receipts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Continuations the previous turn's resolve results listed whose source roll nobody
    continued (no receipt anywhere since with `source_receipt` on it, no `continued_by`)."""
    if previous is None:
        return []
    later = [*(previous.get("receipts") or []), *current_receipts]
    continued = {str(r.get("source_receipt")) for r in later if isinstance(r, dict) and r.get("source_receipt")}
    rows: list[dict[str, Any]] = []
    for call in (previous.get("calls") or {}).values():
        result = (call or {}).get("result") or {}
        continuations = result.get("continuations") or []
        if not continuations:
            continue
        source = result.get("receipt")
        source_receipt = next((r for r in previous.get("receipts") or [] if isinstance(r, dict) and r.get("id") == source), None)
        if source in continued or (source_receipt or {}).get("continued_by"):
            continue
        for continuation in continuations:
            if isinstance(continuation, dict) and continuation.get("decision") and not continuation.get("executed"):
                rows.append({"decision": str(continuation["decision"]), "source": source,
                             "needs": [str(n) for n in continuation.get("action") or continuation.get("needs") or []]})
    return rows


def rule_pressures(continuations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for row in continuations:
        entry = {"kind": "rule", "name": row["decision"], "state": _t("rule_state")}
        if row.get("needs"):
            entry["cue"] = _t("continuation_cue", fields="/".join(row["needs"]))
        rows.append(entry)
    return rows


# ---- obligations ----------------------------------------------------------------------------

def quest_obligations(graph: ModuleGraph, world: dict[str, Any]) -> list[dict[str, Any]]:
    discovered = set(world.get("discovered_clues") or [])
    rows = []
    for quest in graph.by_kind.get("quest", []):
        clues: list[str] = []
        for rel in graph.out_rel.get(quest["node_id"], []):
            if rel.get("relation_kind") not in ("supports", "may-lead-to"):
                continue
            target = graph.nodes.get(rel.get("to_node_id"))
            if target and target["node_kind"] == CLUE_KIND:
                clues.append(graph.handle(target))
        for rel in graph.in_rel.get(quest["node_id"], []):
            if rel.get("relation_kind") == "supports":
                source = graph.nodes.get(rel.get("from_node_id"))
                if source and source["node_kind"] == CLUE_KIND:
                    clues.append(graph.handle(source))
        clues = sorted(set(clues))
        found = [c for c in clues if c in discovered]
        if not clues:
            state = _t("quest_no_clues")
        elif not found:
            state = _t("quest_not_started")
        elif len(found) < len(clues):
            state = _t("quest_in_progress", found=len(found), total=len(clues))
        else:
            state = _t("quest_closable", total=len(clues))
        record = record_of(quest)
        row: dict[str, Any] = {"kind": "quest", "name": str(record.get("title") or graph.display_name(quest)), "state": state}
        giver = record.get("giver")
        if isinstance(giver, dict) and isinstance(giver.get("ref_id"), str) and giver["ref_id"] in graph.nodes:
            row["who"] = graph.display_name(graph.nodes[giver["ref_id"]])
        importance = record.get("importance")
        if isinstance(importance, str):
            row["cue"] = importance
        rows.append(row)
    return rows


def choice_obligation(pending: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not pending:
        return []
    row: dict[str, Any] = {"kind": "choice", "name": str(pending.get("name")), "who": str(pending.get("for") or "player"),
                           "state": _t("choice_state")}
    if pending.get("prompt"):
        row["cue"] = str(pending["prompt"])
    return [row]


def session_obligation(session: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not session or session.get("status") != "active":
        return []
    who = session.get("turn_of")
    label = next((p.get("label") or p.get("name") for p in session.get("participants") or [] if p.get("name") == who), who)
    row: dict[str, Any] = {"kind": "session", "name": str(session.get("kind")), "who": str(label or "-"),
                           "state": _t("session_state", round=session.get("round"), who=label or "-")}
    actions = [str(a.get("decision")) for a in session.get("actions") or [] if isinstance(a, dict) and a.get("decision")]
    if actions:
        row["cue"] = ", ".join(dict.fromkeys(actions))
    return [row]


def continuation_obligations(continuations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for row in continuations:
        entry = {"kind": "continuation", "name": row["decision"], "who": "player", "state": _t("rule_state")}
        if row.get("needs"):
            entry["cue"] = _t("continuation_cue", fields="/".join(row["needs"]))
        rows.append(entry)
    return rows


def promise_obligations(promises: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for promise in promises:
        statement = str(promise.get("statement") or "")[:PROMISE_STATEMENT_CHARS]
        row: dict[str, Any] = {"kind": "promise", "name": str(promise.get("id")), "who": str(promise.get("subject")),
                               "state": _t("promise_state", statement=statement)}
        entities = [str(e) for e in promise.get("entities") or []]
        if entities:
            row["cue"] = ", ".join(entities)
        rows.append(row)
    return rows

