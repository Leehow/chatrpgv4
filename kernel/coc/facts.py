"""Deterministic sentences over receipts and world state (contract §12.2, §12.3, §12.5).

Everything here is a template filled from a receipt or a graph record. Nothing reads
prose to decide anything: the facts list is what the receipts say, in the system
language (English, §16.1), and the keeper-only list is what the graph marks as
undiscovered or secret. Names inside the sentences (skills, scenes, clues, people) are
data carried on the receipt, never translated here."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from .module_graph import ModuleGraph, record_of

KEEPER_ONLY_BUDGET = 2048
HEAD_CHARS = 60
DEFAULT_LANGUAGE = "zh-Hans"

#: Session families (§11.6): the words for entering and leaving one.
SESSION_WORDS = {"combat": ("Combat begins", "Combat ends"), "chase": ("Chase begins", "Chase ends"),
                 "sanity_bout": ("Bout of madness begins", "Bout of madness ends")}

TEMPLATES: dict[str, str] = {
    "roll": "{actor}'s {skill} check {verdict} ({level})",
    "roll_hidden": "{actor}'s {skill} check {verdict} ({level}; hidden)",
    "dice": "{actor} rolls {skill} {expression}: {total}",
    "move": "Scene: {from_} -> {to}",
    "move_minutes": "Scene: {from_} -> {to} ({minutes} min)",
    "clue": "Clue found: {clue}",
    "delta": "{label}: {subject} {before} -> {after}",
    "time": "Time advances {minutes} min",
    "item_gain": "Item: {subject} gains {name}{count}",
    "item_loss": "Item: {subject} loses {name}{count}",
    "choice": "Player chose: {option}",
    "declared": "Player declared: {text}",
    "session_start": "{start}",
    "session_start_summary": "{start}: {summary}",
    "session_end": "{end}: {outcome}",
    "session_end_plain": "{end}",
    "session_round": "{family} enters round {round}",
    "place": "Location: {scene}",
    "present": "Present: {names}",
    "present_none": "Present: nobody",
    "passed": "passed",
    "failed": "failed",
    "undiscovered_clue": "Undiscovered clue: {name} -- {summary}",
    "npc_secret": "{name}'s secret -- agenda: {agenda}; secret: {secret}",
    "module_secret": "Module secret: {name} -- {summary}",
    "one_line": "Turn {turn}: {scene}, {clock}, {session}; last turn: {head}",
    "clock": "clock {minutes} min",
    "no_session": "no session",
    "session_label": "{family} in progress (round {round})",
    "no_head": "(no delivery)",
    "instruction": (
        "Write only what is new this turn: facts, knowledge, beliefs, relationships, player assertions. "
        "Use names from known_entities as subjects, or the reserved subjects world, party, keeper, player; "
        "no numbers or dice; do not repeat what prior already holds. Each candidate has kind (one of world_event, "
        "knowledge, belief, relationship, player_assertion, player_preference, keeper_correction, promise), subject and "
        "statement; a world_event's subject must be world; a relationship names exactly one entity in entities. "
        "When someone promised something with a deadline or a condition, write a promise: subject is the one who "
        "promised, entities the one promised to and what it concerns, statement the condition or deadline. "
        "When an NPC learned something, took a position or gave their word this turn, say so with them in it: a "
        "knowledge or belief whose knowers include them, or a promise whose subject is them -- that is what puts it "
        "on their account, and the keeper reads it back the next time they are in the room. "
        "Write every statement in the campaign's play language ({language}): the keeper reads it back and the player "
        "may see it through recall. Never write ids, turn numbers, receipts or any machine key."
    ),
}


def language_of(meta: dict[str, Any] | None) -> str:
    """The campaign's play_language tag as recorded (default zh-Hans). The kernel writes
    nothing in it (§16.1); it is data for the keeper, the craft table, the extractor, and
    the delivery script check (§16.3)."""
    return str((meta or {}).get("play_language") or DEFAULT_LANGUAGE)


def t(key: str, **fields: Any) -> str:
    return TEMPLATES[key].format(**fields)


def prose_of(rendered_text: str | None) -> str:
    """The delivery as prose: since §16 the kernel inserts nothing, so this is the text
    with blank-line runs collapsed."""
    if not rendered_text:
        return ""
    return re.sub(r"\n{3,}", "\n\n", rendered_text).strip("\n")


def head_of(rendered_text: str | None, chars: int = HEAD_CHARS) -> str:
    return " ".join(prose_of(rendered_text).split())[:chars]


def json_size(payload: Any) -> int:
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


# ---- committed ----------------------------------------------------------------------------

def committed_facts(receipts: list[dict[str, Any]], snapshot: dict[str, Any],
                    label_of: Callable[[str], str], player_text: str | None = None) -> list[str]:
    """The player's declaration first (the verifier must know what the player actually said
    before judging agency), then one sentence per receipt, then the place and who is
    present. `snapshot` is the turn record's `world` block; `label_of` maps an actor id
    to its display name."""
    facts: list[str] = []
    if isinstance(player_text, str) and player_text.strip():
        facts.append(t("declared", text=" ".join(player_text.split())))
    for receipt in receipts:
        kind = receipt.get("kind")
        if kind == "roll":
            actor = receipt.get("actor_label") or label_of(str(receipt.get("actor")))
            skill = receipt.get("skill")
            if receipt.get("form") == "dice":
                facts.append(t("dice", actor=actor, skill=skill, expression=receipt.get("expression"),
                               total=receipt.get("total")))
                continue
            verdict = t("passed" if receipt.get("passed") else "failed")
            key = "roll_hidden" if receipt.get("visibility") == "keeper" else "roll"
            facts.append(t(key, actor=actor, skill=skill, verdict=verdict, level=str(receipt.get("level"))))
        elif kind == "move":
            minutes = int(receipt.get("minutes") or 0)
            key = "move_minutes" if minutes > 0 else "move"
            facts.append(t(key, from_=receipt.get("from_label") or receipt.get("from"),
                           to=receipt.get("to_label") or receipt.get("to"), minutes=minutes))
        elif kind == "clue":
            facts.append(t("clue", clue=receipt.get("label") or receipt.get("clue")))
        elif kind in ("delta", "cash"):
            # #19: a cash receipt is a resource change too (resource cash, before -> after)
            facts.append(t("delta", label=receipt.get("resource"),
                           subject=receipt.get("subject_label") or receipt.get("subject"),
                           before=receipt.get("before"), after=receipt.get("after")))
        elif kind == "item":
            quantity = int(receipt.get("quantity") or 1)
            facts.append(t("item_loss" if quantity < 0 else "item_gain",
                           subject=receipt.get("subject_label") or receipt.get("subject"),
                           name=receipt.get("label") or receipt.get("name"),
                           count=f" x{abs(quantity)}" if abs(quantity) > 1 else ""))
        elif kind == "time":
            facts.append(t("time", minutes=int(receipt.get("minutes") or 0)))
        elif kind == "choice":
            facts.append(t("choice", option=receipt.get("option")))
        elif kind == "session":
            family = str(receipt.get("family"))
            start, end = SESSION_WORDS.get(family, (family, family))
            transition = receipt.get("transition")
            if transition == "start":
                summary = receipt.get("summary")
                facts.append(t("session_start_summary", start=start, summary=summary) if summary
                             else t("session_start", start=start))
            elif transition == "end":
                outcome = receipt.get("summary") or receipt.get("outcome")
                key = "session_end" if outcome else "session_end_plain"
                facts.append(t(key, end=end, outcome=outcome))
            else:
                facts.append(t("session_round", family=start, round=receipt.get("round")))
    scene = snapshot.get("scene") or {}
    facts.append(t("place", scene=scene.get("display_name") or scene.get("name")))
    present = [str(n) for n in snapshot.get("present") or []]
    facts.append(t("present", names=", ".join(present)) if present else t("present_none"))
    return facts


# ---- keeper only --------------------------------------------------------------------------

def keeper_only_facts(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any],
                      present: list[dict[str, Any]], budget: int = KEEPER_ONLY_BUDGET) -> list[str]:
    """Undiscovered clues here, present NPCs' agenda and secret, then the module secrets.
    Secrets carry no scene relation in the graph, so they come last and are the first to
    go when the budget trims (12.9)."""
    discovered = set(world.get("discovered_clues") or [])
    items: list[str] = []
    for clue_id in graph.scene_clue_ids(scene):
        node = graph.nodes[clue_id]
        handle = graph.handle(node)
        if handle in discovered:
            continue
        items.append(t("undiscovered_clue", name=handle, summary=graph.summary(node)))
    for node in present:
        record = record_of(node)
        if not record.get("agenda") and not record.get("secret"):
            continue
        items.append(t("npc_secret", name=graph.display_name(node), agenda=record.get("agenda") or "-",
                       secret=record.get("secret") or "-"))
    for node in graph.by_kind.get("secret", []):
        items.append(t("module_secret", name=graph.handle(node), summary=graph.summary(node)))
    while items and json_size(items) > budget:
        items.pop()
    return items


# ---- continuation -------------------------------------------------------------------------

def one_line(turn: int, scene_display: str, clock_minutes: int,
             session: dict[str, Any] | None, rendered_text: str | None) -> str:
    if session:
        session_label = t("session_label", family=session.get("kind"), round=session.get("round"))
    else:
        session_label = t("no_session")
    head = head_of(rendered_text) or t("no_head")
    return t("one_line", turn=turn, scene=scene_display, clock=t("clock", minutes=clock_minutes),
             session=session_label, head=head)


def instruction(language: str) -> str:
    """The extractor's standing instruction (§12.3), English, naming the play language
    the statements must be written in."""
    return t("instruction", language=language)
