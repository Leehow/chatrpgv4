"""Turn capsule (contract §6, §12.7, §13.1) and the single-entity views behind table.look.

All strings here are keeper material copied from the module graph, the world state and
the content graphs; nothing is paraphrased or invented. Nine sections plus `head`,
`turn`, `recent`, `warnings` and `resume`; each section has a byte budget and is trimmed
by item when it overflows, the section name landing in `truncated`."""

from __future__ import annotations

import json
from typing import Any, Callable

from . import (bookkeeping, director as director_mod, npc as npc_lane, pressures as pressures_mod,
               worldline as worldline_mod)
from .craft import TextGraph
from .director import DirectorGraph
from .errors import RpcError
from .library import era_note
from .module_graph import (ASSERTS, BELIEVES, HIDES, NPC_KIND, ModuleGraph,  # noqa: F401 - condition helpers re-exported
                           condition_met, condition_status, describe_condition, module_declaration,
                           record_of)
from .ontology import Ontology
from .rules.graph import semantic_name
from .store import Campaign
from .text import normalize

#: §6 sections: trimmed by item, oldest first for `recent`; the dict sections also gain
#: `truncated: true` inside (§6), every trimmed section lands in the capsule's `truncated`.
BUDGETS = {"where": 4096, "present": 3072, "known": 3072, "recent": 2048}
#: §12.7 ranked lists that shed their tail, not their head.
SLICE2_BUDGETS = {"memory": 1536, "warnings": 1024}
#: §13.1: the new sections and their budgets. `style` doubles on the first capsule after
#: the process opened the table (§13.6).
#: §17.4: how much of one person's dossier and ledger the `present` section carries.
PRESENT_KNOWS = 6
PRESENT_CLAIM_LINES = 3
PRESENT_TIES = 6
PRESENT_PROMISES = 3
#: §17.4: how many past attempts an NPC entry carries, oldest first within the window
PRESENT_ATTEMPTS = 3
BECAUSE_LINES = 3
SLICE3_BUDGETS = {"pressures": 1024, "obligations": 1024, "director": 1536, "situations": 1024, "style": 1024}
#: §15.6: which line this is, its circuit, the anchor, what a rewind leaves standing.
WORLDLINES_BUDGET = worldline_mod.CAPSULE_BUDGET
#: §18.3: the rulings that bind here (a ranked list, newest first, sheds its tail).
RULINGS_BUDGET = bookkeeping.RULINGS_BUDGET
#: §18.1: `known.flags`, most recent writes first, its own budget inside `known`'s.
KNOWN_FLAGS_BUDGET = bookkeeping.KNOWN_FLAGS_BUDGET
STYLE_FULL_BUDGET = 2048
#: #22 (§13.1): the module briefing, only on this process's first turn after open — the
#: same condition as the full `style` — built from the module graph alone.
MODULE_BUDGET = 2048
#: Roster lines are cut to the first length at which the section fits (a roster that
#: names everyone with short lines beats one that names half of them with long ones);
#: only when names alone still overflow does the tail go.
MODULE_LINE_STEPS = (120, 80, 40, 20, 0)
MODULE_LINE_CHARS = MODULE_LINE_STEPS[0]
FACTION_KINDS = ("faction", "organization")
PLACE_KINDS = ("location",)
PEOPLE_KINDS = (NPC_KIND,)
ENDING_KIND = "ending"
CONCLUSION_KIND = "conclusion"
MEMORY_HITS = 6
RECENT_TURNS = 2
KEEPER_EXCERPT = 200
SKILLS_OF_NOTE = 8
MINUTES_PER_HOUR = 60
MINUTES_PER_DAY = 24 * 60

HEAD = ("Everything at the start of this turn: the clock, the undiscovered clues here and their gates, the secrets "
        "and agendas of those present, the way back and the exits, pressures and obligations, the rule-layer "
        "situations, the Director's suggested beat, related memory and the style contract. Do not look/lookup "
        "for what is already here; director is advice, not lines. Truncated place/rule previews are incomplete; "
        "look focus=scene returns their full descriptions. where.material and each exit's material say how "
        "far the book has been read: ready, reading, or missing. An exit's unlock_when.met is true, false, or null "
        "when the kernel cannot tell; a gate never blocks a move. known.flags lists the flags set so far; "
        "obligations of kind note are your own open continuity notes; rulings are your earlier rulings that "
        "bind here, reminders, not rules. worldlines is which line the table is on and which circuit of the "
        "loop, where the anchor is, what a rewind would leave standing and who would remember it; "
        "loop_available true means this scene can be rewound with apply fork mode: loop, which happens after "
        "you narrate this turn.")
#: #22: appended to `head` when the `module` section rides along.
HEAD_MODULE = (" This turn also carries a module section (the table briefing, this once): what the book is about, its era, "
               "the factions, places and people (absent ones included, keeper-only), the ending and conclusion names and "
               "the structure type; do not lookup the book before opening.")
ELAPSED = "{hours} h {minutes} min"
#: Day parts by hour of day, only when the module declares a start time (§13.1); the
#: closed words are the capsule's own vocabulary (§16.1).
DAY_PARTS = ((5, "dawn"), (8, "morning"), (12, "midday"), (14, "afternoon"), (18, "evening"), (22, "night"), (24, "small_hours"))


def json_size(payload: Any) -> int:
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


# ---- sections -----------------------------------------------------------------

def scene_label(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any]) -> str:
    """The name the table calls a scene: the label the keeper gave it on `apply move`
    (kept in `world.scene_labels`, player language) or else the graph's display name."""
    labels = world.get("scene_labels") or {}
    return str(labels.get(graph.handle(scene)) or graph.display_name(scene))


def clue_label(graph: ModuleGraph, world: dict[str, Any], handle: str) -> str:
    """The name the table calls a discovered clue: the label the keeper gave it on
    `apply clue` (kept in `world.clue_labels`, player language) or else the graph's display
    name. A handle the graph does not know -- an echo from another worldline, a clue whose
    module moved -- is its own name; a projection never leaves the player with nothing."""
    label = (world.get("clue_labels") or {}).get(handle)
    if isinstance(label, str) and label.strip():
        return label
    try:
        return str(graph.display_name(graph.clue(handle)))
    except RpcError:
        return handle


def clue_summary(graph: ModuleGraph, handle: str) -> str | None:
    """The clue node's authored summary, or None when the graph does not know the handle or the
    node has none. Whether it says more than the row's label is the caller's comparison -- the
    label lives in the world, not here."""
    try:
        node = graph.clue(handle)
    except RpcError:
        return None
    summary = node.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        return None
    return summary.strip()


def clock_section(graph: ModuleGraph, world: dict[str, Any]) -> dict[str, Any]:
    """`where.clock`: the world minutes, `elapsed` generated from them, and `day_part`
    only when the module node declares a start time (nothing is guessed otherwise)."""
    minutes = int((world.get("clock") or {}).get("minutes") or 0)
    clock: dict[str, Any] = {"minutes": minutes,
                             "elapsed": ELAPSED.format(hours=minutes // MINUTES_PER_HOUR, minutes=minutes % MINUTES_PER_HOUR)}
    start = module_declaration(graph.module_node).get("start_time") if graph.module_node else None
    if isinstance(start, str) and ":" in start:
        try:
            hour, minute = (int(part) for part in start.split(":", 1))
        except ValueError:
            return clock
        at = (hour * MINUTES_PER_HOUR + minute + minutes) % MINUTES_PER_DAY
        part = next(name for bound, name in DAY_PARTS if at < bound * MINUTES_PER_HOUR)
        clock["day_part"] = part
    return clock


def where_section(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any],
                  material_of: Callable[[str], str] | None = None, *, compact: bool = False) -> dict[str, Any]:
    """`material_of(scene_handle)` is the module store's answer for that scene's section
    (§14.6: ready | reading | missing); a starter has no sections, so everything is ready."""
    record = record_of(scene)
    material = material_of or (lambda handle: "ready")
    exits = []
    for exit_ in graph.scene_exits(scene):
        entry: dict[str, Any] = {"to": exit_["to"]}
        if "travel_minutes" in exit_:
            entry["travel_minutes"] = exit_["travel_minutes"]
        when = exit_.get("when")
        if when and not (isinstance(when, dict) and when.get("kind") == "always"):
            # §18.1: three-state -- true / false when the kernel can decide (a clue, a
            # flag), null when it cannot (a narrative cut). Never a reason to refuse a move.
            entry["unlock_when"] = {"condition": describe_condition(when), "met": condition_status(when, world)}
        entry["material"] = material(exit_["to"])
        exits.append(entry)

    affordances = []
    for aff in record.get("affordances") or []:
        entry = {"id": aff.get("id"), "cue": aff.get("cue")}
        clue_id = aff.get("clue_id")
        if isinstance(clue_id, str) and clue_id in graph.nodes:
            entry["clue"] = graph.handle(graph.nodes[clue_id])
        npc_id = (aff.get("npc_interaction") or {}).get("npc_id")
        if isinstance(npc_id, str) and npc_id in graph.nodes:
            entry["npc"] = graph.display_name(graph.nodes[npc_id])
        affordances.append(entry)

    keeper_notes: list[str] = []
    notes = record.get("keeper_notes")
    if isinstance(notes, str):
        keeper_notes.append(notes)
    elif isinstance(notes, list):
        keeper_notes.extend(str(n) for n in notes)
    keeper_notes.extend(str(line) for line in record.get("allowed_improvisation") or [])
    tone = record.get("tone")
    if isinstance(tone, list) and tone:
        keeper_notes.append("tone: " + ", ".join(str(t) for t in tone))
    beat = graph.scene_beat(scene)
    if beat:
        keeper_notes.append(f"pacing: {beat.get('tension_target')} / {beat.get('horror_stage')}"
                            f" — {beat.get('note')}")
    for cond in record.get("exit_conditions") or []:
        keeper_notes.append("exit condition: " + describe_condition(cond))

    back = []
    for handle in reversed([str(h) for h in world.get("scene_trail") or []]):
        try:
            back.append({"to": handle, "display_name": scene_label(graph, world, graph.scene(handle))})
        except Exception:  # noqa: BLE001 - a stale handle in an old world is not a reason to lose the section
            back.append({"to": handle})

    where = {
        "scene": graph.handle(scene),
        "display_name": scene_label(graph, world, scene),
        "summary": scene.get("summary") or graph.prose(scene),
        "dramatic_question": record.get("dramatic_question"),
        "pressure_moves": list(record.get("pressure_moves") or []),
        "exits": exits,
        "back": back,
        "affordances": affordances,
        "keeper_notes": keeper_notes,
        "assets": graph.scene_assets(scene),
        "places": graph.scene_places(scene),
        "rules": graph.scene_rules(scene),
        "endings": graph.scene_endings(scene),
        "material": material(graph.handle(scene)),
    }
    if compact:
        for key, limit, chars in (("places", graph.SCENE_PLACES, graph.SCENE_PLACE_CHARS),
                                  ("rules", graph.SCENE_RULES, graph.SCENE_RULE_CHARS)):
            if len(where[key]) > limit:
                where["truncated"] = True
                where[key] = where[key][:limit]
            for entry in where[key]:
                if len(entry.get("line", "")) > chars:
                    entry["line"] = entry["line"][:chars]
                    entry["truncated"] = True
                    where["truncated"] = True
    return where


def npcs_present(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any]) -> list[dict[str, Any]]:
    scene_handle = graph.handle(scene)
    presence = world.get("npc_presence") or {}
    nodes = []
    for handle, at in presence.items():
        if at != scene_handle:
            continue
        node = graph.find(handle, (NPC_KIND,))
        if node:
            nodes.append(node)
    return nodes


def known_facts(graph: ModuleGraph, world: dict[str, Any], record: dict[str, Any]) -> list[dict[str, Any]]:
    discovered = set(world.get("discovered_clues") or [])
    facts = []
    for fact in record.get("facts") or []:
        clue_id = fact.get("clue_id")
        node = graph.nodes.get(clue_id) if isinstance(clue_id, str) else None
        if not node:
            continue
        handle = graph.handle(node)
        facts.append({"clue": handle, "summary": node.get("summary") or node.get("name"),
                      "discovered": handle in discovered})
    return facts


def _memory_statements(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(row.get("id")): row for row in rows if row.get("id")}


def npc_entry(graph: ModuleGraph, world: dict[str, Any], node: dict[str, Any],
              ledger: dict[str, Any], memories: dict[str, dict[str, Any]],
              across_lines: Callable[[dict[str, Any]], list[dict[str, Any]]] | None = None) -> dict[str, Any]:
    """§17.4: one person as the keeper needs them this turn — the dossier the book wrote
    and the ledger the table wrote, with the causes attached. Every line is copied, never
    paraphrased; the whole entry is keeper-only."""
    profile = graph.npc_profile(node)
    discovered = set(world.get("discovered_clues") or [])
    knows = [{"clue": entry["handle"], "discovered": entry["handle"] in discovered}
             for entry in graph.npc_knows(node)]
    knows.sort(key=lambda row: row["discovered"])
    entry: dict[str, Any] = {"name": graph.display_name(node)}
    for key, field in (("relationship_to_investigators", "role"), ("agenda", "wants"),
                       ("fear", "fears"), ("secret", "hides"), ("voice", "voice")):
        if profile.get(key):
            entry[field] = profile[key]
    if knows:
        entry["knows"] = knows[:PRESENT_KNOWS]
    knowledge = graph.authored_lines(node, "knowledge")[:PRESENT_CLAIM_LINES]
    if knowledge:
        entry["knowledge"] = knowledge
    keeper_note = record_of(node).get("keeper_note")
    if keeper_note:
        entry["keeper_note"] = keeper_note
    believes = graph.npc_beliefs(node)[:PRESENT_CLAIM_LINES]
    if believes:
        entry["believes"] = believes
    lies = graph.npc_would_say(node)[:PRESENT_CLAIM_LINES]
    if lies:
        entry["would_lie_about"] = lies
    ties = _ordered_ties(graph, world, node)
    if ties:
        entry["ties"] = ties
    row = ledger.get(node["node_id"]) or {}
    toward = _toward_party(row)
    if toward:
        entry["toward_party"] = toward
    history = _npc_history(row, memories)
    if history:
        entry["history"] = history
    # §15.5: what this person knows from another circuit or another line. The contract
    # wrote it onto `known_facts`; §17.4 replaced that key with this dossier, and the
    # statements land here, where the keeper reads what they know. Empty for everyone the
    # module did not declare `remembers_across_loops`, whatever the candidates say.
    elsewhere = across_lines(node) if across_lines else []
    if elsewhere:
        entry["from_other_lines"] = elsewhere
    return entry


def _ordered_ties(graph: ModuleGraph, world: dict[str, Any], node: dict[str, Any]) -> list[dict[str, str]]:
    """Ties with the people in the room and the bodies they belong to first: those are the
    ones this scene can act on."""
    presence = world.get("npc_presence") or {}
    here = {handle for handle, at in presence.items() if at == presence.get(graph.handle(node))}

    def rank(tie: dict[str, Any]) -> int:
        other = tie["node"]
        if graph.handle(other) in here:
            return 0
        return 1 if other["node_kind"] in ("faction", "organization") else 2

    ties = sorted(graph.npc_ties(node), key=rank)[:PRESENT_TIES]
    return [{"kind": tie["kind"], "to": tie["to"]} for tie in ties]


def _toward_party(row: dict[str, Any]) -> dict[str, Any] | None:
    """§17.4: where this person stands with the party and why, newest cause last. The
    reason lines are the ledger's own record of what settled, in English (§16.1)."""
    stance = row.get("stance")
    if not isinstance(stance, dict) or not stance.get("value"):
        return None
    because: list[str] = []
    for cause in (stance.get("because") or [])[-BECAUSE_LINES:]:
        turn = cause.get("turn")
        if cause.get("how") == npc_lane.KEEPER_SET:
            line = f"turn {turn}: keeper set {cause.get('stance')}"
            if cause.get("why"):
                line += f": {cause['why']}"
        elif cause.get("how") == "combat":
            line = f"turn {turn}: fought"
        else:
            line = f"turn {turn}: {cause.get('approach')} {cause.get('level')}"
        because.append(line)
    return {"stance": stance["value"], "because": because}


def _exchange_line(item: dict[str, Any]) -> str | None:
    """One exchange as the keeper reads it: a thing by the name the keeper gave it, or money
    by its amount and direction. Both are `apply`'s own words, never a judgement of them."""
    if item.get("item"):
        return f"turn {item.get('turn')}: {item['item']}"
    if item.get("cash") is not None:
        currency = f" {item['currency']}" if item.get("currency") else ""
        return f"turn {item.get('turn')}: {item.get('direction', 'paid')} {item['cash']}{currency}"
    return None


def _attempt_line(item: dict[str, Any]) -> str:
    """One interaction as the keeper reads it: `turn 3: charm failure`. The words are the
    receipt's own -- the approach and the success level -- never a judgement of them."""
    parts = [str(item.get("approach") or item.get("kind") or "")]
    level = item.get("level")
    if isinstance(level, str) and level:
        parts.append(level)
    return f"turn {item.get('turn')}: " + " ".join(p for p in parts if p)


def _npc_history(row: dict[str, Any], memories: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """What this table has already been through with them: how often they were on stage,
    what they handed over, what they promised."""
    seen = row.get("turns_present") if isinstance(row.get("turns_present"), dict) else {}
    disclosed = [str(item.get("clue")) for item in row.get("disclosed") or [] if item.get("clue")]
    promises = []
    for item in (row.get("promises") or [])[-PRESENT_PROMISES:]:
        memory_row = memories.get(str(item.get("memory_id")))
        if memory_row and memory_row.get("status") != "superseded":
            promises.append({"statement": memory_row.get("statement"), "turn": item.get("turn")})
    history: dict[str, Any] = {}
    if seen.get("count"):
        history["met_turns"] = seen["count"]
        history["last_turn"] = seen.get("last")
    if disclosed:
        history["disclosed"] = disclosed
    exchanged = [_exchange_line(item) for item in (row.get("exchanged") or [])[-PRESENT_ATTEMPTS:]]
    exchanged = [line for line in exchanged if line]
    if exchanged:
        history["exchanged"] = exchanged
    if promises:
        history["promises"] = promises
    # §17.4: what this table actually tried on them. The stance's `because` only carries
    # what moved the number, so an attempt the table scores at zero -- a failed Charm, a
    # read of someone's face -- left no trace at all, and the keeper met them again knowing
    # only that they had met. Observed at a live table: two failed approaches on the same
    # newsvendor, and the projection said nothing about either.
    tried = [_attempt_line(item) for item in (row.get("interactions") or [])[-PRESENT_ATTEMPTS:]]
    if tried:
        history["tried"] = tried
    if row.get("dead"):
        history["dead_since_turn"] = (row["dead"] or {}).get("turn")
    return history or None


def _present_rank(entry: dict[str, Any]) -> int:
    """§17.4: who survives a tight budget — someone owed a promise first, then someone this
    table has already dealt with, then someone the book gave a want to."""
    history = entry.get("history") or {}
    if history.get("promises"):
        return 0
    if history.get("met_turns") or entry.get("toward_party"):
        return 1
    return 2 if entry.get("wants") else 3


def present_section(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any],
                    ledger: dict[str, Any] | None = None,
                    memories: list[dict[str, Any]] | None = None,
                    across_lines: Callable[[dict[str, Any]], list[dict[str, Any]]] | None = None
                    ) -> list[dict[str, Any]]:
    ledger = ledger or {}
    by_id = _memory_statements(memories or [])
    present = [npc_entry(graph, world, node, ledger, by_id, across_lines)
               for node in npcs_present(graph, world, scene)]
    present.sort(key=_present_rank)
    return present


def clues_here(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any]) -> list[dict[str, Any]]:
    discovered = set(world.get("discovered_clues") or [])
    out = []
    for clue_id in graph.scene_clue_ids(scene):
        view = graph.clue_view(graph.nodes[clue_id])
        view["discovered"] = view["name"] in discovered
        out.append(view)
    return out


def investigator_summary(sheet: dict[str, Any]) -> dict[str, Any]:
    skills = sorted(((str(k), int(v)) for k, v in (sheet.get("skills") or {}).items()),
                    key=lambda item: (-item[1], item[0]))
    return {
        "id": sheet.get("id"),
        "name": sheet.get("name"),
        "occupation": sheet.get("occupation"),
        "hp": sheet.get("current_hp"),
        "san": sheet.get("current_san"),
        "mp": sheet.get("current_mp"),
        "luck": sheet.get("current_luck"),
        "skills_of_note": [{"name": k, "value": v} for k, v in skills[:SKILLS_OF_NOTE]],
    }


def known_section(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any],
                  party: list[dict[str, Any]]) -> dict[str, Any]:
    section: dict[str, Any] = {
        "discovered_clues": list(world.get("discovered_clues") or []),
        "clues_here": clues_here(graph, world, scene),
        # §18.1: keeper-only; the flags set so far, most recent write first
        "flags": bookkeeping.known_flags(world),
    }
    # §15.4: an echo the keeper revealed is evidence the players have; it belongs here
    # beside the clues, not in the worldlines section, which is what may still be shown.
    if world.get("discovered_echoes"):
        section["discovered_echoes"] = list(world["discovered_echoes"])
    if party:
        section["investigator"] = investigator_summary(party[0])
        # §21.3: a library card built for another era plays unchanged; the keeper is told.
        section["investigator"].update(era_note(graph, party[0]))
    return section


def recent_section(campaign: Campaign, before_turn: int) -> list[dict[str, Any]]:
    records = [r for r in campaign.closed_turns()
               if int(r["turn"]) < before_turn and (r.get("player_text") or r.get("rendered_text"))]
    recent = []
    for record in records[-RECENT_TURNS:]:
        keeper = record.get("rendered_text") or ""
        recent.append({"turn": record["turn"], "player": record.get("player_text"),
                       "keeper": keeper[:KEEPER_EXCERPT]})
    return recent


# ---- budgets ------------------------------------------------------------------

def _lists(payload: Any, acc: list[list]) -> list[list]:
    if isinstance(payload, list):
        acc.append(payload)
        for item in payload:
            _lists(item, acc)
    elif isinstance(payload, dict):
        for value in payload.values():
            _lists(value, acc)
    return acc


def _is_leaf(lst: list) -> bool:
    return not any(nested for item in lst for nested in _lists(item, []))


def fit_budget(section: Any, budget: int, *, drop: str = "oldest") -> bool:
    """Trim by item until the section fits: innermost non-empty lists first (an NPC's
    known_facts before the NPC itself), oldest turn first for `recent`. A ranked list
    (`drop="last"`: memory hits, warnings) sheds its tail instead. Returns whether
    anything was cut."""
    cut = False
    while json_size(section) > budget:
        lists = [lst for lst in _lists(section, []) if lst]
        if not lists:
            break
        leaves = [lst for lst in lists if _is_leaf(lst)]
        victim = max(leaves or lists, key=json_size)
        if victim is section and len(victim) == 1:
            break  # never empty the section; shorten its strings instead
        if (victim is section and drop == "oldest"
                and all(isinstance(item, dict) and "turn" in item for item in victim)):
            victim.pop(0)
        else:
            victim.pop()
        cut = True
    if json_size(section) > budget and isinstance(section, list):
        for item in section:
            for key, value in list(item.items()):
                if isinstance(value, str) and len(value) > KEEPER_EXCERPT:
                    item[key] = value[:KEEPER_EXCERPT]
                    cut = True
    return cut


def memory_section(graph: ModuleGraph, campaign: Campaign, world: dict[str, Any], scene: dict[str, Any],
                   party: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`recall memory` with its default `about` (present NPCs plus the investigators),
    first MEMORY_HITS hits (§12.7), each projected to id/kind/statement/turn (#20)."""
    from .memory import EntityIndex, capsule_hit, query_candidates  # local: memory imports facts, which imports render
    about = [graph.display_name(n) for n in npcs_present(graph, world, scene)]
    about.extend(str(sheet.get("name")) for sheet in party)
    hits = query_candidates(campaign, EntityIndex(graph, party, scene_labels=world.get("scene_labels")),
                            about=about, narrow=False, limit=MEMORY_HITS)
    return [capsule_hit(hit) for hit in hits]


# ---- module briefing (#22, §13.1) ---------------------------------------------

def _one_line(graph: ModuleGraph, node: dict[str, Any], chars: int = MODULE_LINE_CHARS) -> str:
    """One line of keeper material for a roster entry, copied from the graph: the node's
    summary unless it merely repeats the name, else (for a person) relationship and
    agenda, else the record's prose. Cut at `chars`, never paraphrased."""
    if chars <= 0:
        return ""
    record = record_of(node)
    name = graph.display_name(node)
    summary = node.get("summary")
    candidates: list[str] = []
    if isinstance(summary, str) and normalize(summary) != normalize(name):
        candidates.append(summary)
    person = [str(record[key]) for key in ("relationship_to_investigators", "agenda")
              if isinstance(record.get(key), str) and record[key].strip()]
    if person:
        candidates.append("; ".join(person))
    candidates.append(graph.prose(node))
    for text in candidates:
        line = " ".join(str(text).split())
        if line:
            return line[:chars]
    return ""


def module_section(graph: ModuleGraph, line_chars: int = MODULE_LINE_CHARS) -> dict[str, Any]:
    """What this book is, from the module graph alone: the module node's summary and era,
    the factions, places and people (keeper-only, absent ones included) each with one
    line, the ending and conclusion names, and the structure type. A domain the graph
    lacks is an empty list, never a guess."""
    module = graph.module_node or {}
    record = record_of(module) if module else {}

    def roster(kinds: tuple[str, ...]) -> list[dict[str, str]]:
        rows = []
        for kind in kinds:
            for node in graph.by_kind.get(kind, []):
                rows.append({"name": graph.display_name(node), "line": _one_line(graph, node, line_chars)})
        return rows

    section: dict[str, Any] = {"title": graph.title()}
    era = record.get("era")
    if isinstance(era, str) and era.strip():
        section["era"] = era
    section.update({
        "synopsis": " ".join(str(module.get("summary") or "").split()),
        "factions": roster(FACTION_KINDS),
        "places": roster(PLACE_KINDS),
        "people": roster(PEOPLE_KINDS),
        "endings": [graph.display_name(n) for n in graph.by_kind.get(ENDING_KIND, [])],
        "conclusions": [graph.display_name(n) for n in graph.by_kind.get(CONCLUSION_KIND, [])],
        "structure_type": director_mod.structure_type_of(graph),
    })
    return section


def fitted_module_section(graph: ModuleGraph, budget: int = MODULE_BUDGET) -> tuple[dict[str, Any], bool]:
    """The briefing at the longest roster line that fits the budget; names alone if that
    is what fits; tail-dropped only after that. Returns (section, whether it was cut)."""
    section = module_section(graph, MODULE_LINE_STEPS[0])
    cut = False
    for chars in MODULE_LINE_STEPS[1:]:
        if json_size(section) <= budget:
            break
        section = module_section(graph, chars)
        cut = True
    return section, fit_budget(section, budget, drop="last") or cut


# ---- director (§13.3) ---------------------------------------------------------

def director_section(dg: DirectorGraph, ontology: Ontology, graph: ModuleGraph, world: dict[str, Any],
                     scene: dict[str, Any], turn: dict[str, Any], party: list[dict[str, Any]], present: list[dict[str, Any]],
                     records: dict[int, dict[str, Any]], session: dict[str, Any] | None, *,
                     clock_near_full: bool, memory_rows: list[dict[str, Any]], conditions_of: Callable[[dict[str, Any]], list[str]],
                     sanity_of: Callable[[dict[str, Any]], dict[str, Any] | None],
                     worldline: dict[str, Any] | None = None) -> dict[str, Any]:
    undiscovered = [c for c in clues_here(graph, world, scene) if not c["discovered"]]
    sig = director_mod.signals(graph, world, scene, turn, party=party, present=present, undiscovered_here=len(undiscovered),
                               records=records, session=session, clock_near_full=clock_near_full,
                               conditions_of=conditions_of, sanity_of=sanity_of, worldline=worldline)
    names = [graph.display_name(n) for n in present] + list(world.get("discovered_clues") or [])
    overlap = director_mod.memory_overlap_count(memory_rows, names)
    can_move = bool(graph.scene_exits(scene)) or bool(world.get("scene_trail"))
    scored = director_mod.score(dg, sig, scene, can_move=can_move, overlap=overlap,
                                pressure_available=bool(record_of(scene).get("pressure_moves")))
    # Decisions by their §11.3 semantic name (`magic:cast-spell`); rules and effects by
    # their full registry id, so nothing in the list can be mistaken for a decision.
    grounded = ontology.grounded_by(scored.pop("hit_rules"))
    decisions = [g for g in grounded if g.startswith("decision:")]
    names_out = [semantic_name(g) if g.startswith("decision:") else g for g in grounded]
    names_out.extend(ontology.effects_of(decisions))
    section: dict[str, Any] = {"beat": scored["beat"], "reason": scored["reason"], "because": scored["because"],
                               "grounded_by": names_out, "scores": scored["scores"]}
    if scored.get("override"):
        section["override"] = scored["override"]
    if scored["beat"] == "REVEAL":
        section["reveal"] = director_mod.reveal_list(graph, world, scene)
    return section


# ---- assembly -----------------------------------------------------------------

def build_capsule(graph: ModuleGraph, campaign: Campaign, world: dict[str, Any],
                  turn: dict[str, Any], party: list[dict[str, Any]], *, language: str, meta: dict[str, Any],
                  situations: list[dict[str, Any]], director_graph: DirectorGraph, ontology: Ontology,
                  craft: TextGraph, register: str, style_full: bool = False,
                  resume: dict[str, Any] | None = None,
                  material_of: Callable[[str], str] | None = None, module_brief: bool = False) -> dict[str, Any]:
    from .memory import EntityIndex, open_promises, read_candidates  # local: memory imports facts, which imports render
    from .npc import read_ledger
    from .rules.healing import read_healing_state
    from .sessions import SessionView, sanity_snapshot  # local: sessions reads capsule.condition_met for chase chains
    from .warn import latest_warnings
    scene = graph.scene(world["active_scene"])
    present_nodes = npcs_present(graph, world, scene)
    view = SessionView(campaign.dir, graph, party, world)
    session = view.active_session()
    records = campaign.turn_records_by_number()
    played = director_mod.played_records(records, int(turn["turn"]))
    previous = played[0] if played else None

    # §17.4: the people in the room come with the ledger this table wrote about them, and
    # the promises they made read their statements out of the memory candidates.
    ledger = read_ledger(campaign.npc_ledger_path)
    candidates = read_candidates(campaign)

    where = where_section(graph, world, scene, material_of, compact=True)
    where["clock"] = clock_section(graph, world)
    where["session"] = session

    fraction = director_graph.threshold("pressure-clock-near-full-fraction")
    clocks, near_full = pressures_mod.clock_pressures(situations, party, session, tuple(fraction))
    continuations = pressures_mod.unanswered_continuations(previous, list(turn.get("receipts") or []))
    pressures = (clocks + pressures_mod.threat_pressures(graph, scene, present_nodes)
                 + pressures_mod.rule_pressures(continuations))
    present_names = [graph.display_name(n) for n in present_nodes] + [graph.handle(n) for n in present_nodes]
    here = [graph.handle(scene), scene_label(graph, world, scene)]
    # §15.6: the line the table is on. It is computed before the obligations and the
    # Director because both read it: a scene that can rewind owes the keeper a decision,
    # and the loop's three signals ride in `because`.
    worldlines = worldline_mod.capsule_section(graph, campaign, meta, world, scene, present_nodes)
    obligations = (pressures_mod.choice_obligation(turn.get("pending_choice"))
                   + pressures_mod.session_obligation(session)
                   + pressures_mod.continuation_obligations(continuations)
                   + pressures_mod.quest_obligations(graph, world)
                   + pressures_mod.promise_obligations(open_promises(campaign))
                   # §18.2: the keeper's own open notes -- those about someone here first
                   + bookkeeping.note_obligations(bookkeeping.open_notes(campaign), present_names, here)
                   + worldline_mod.loop_obligation(worldlines))
    # §18.3: the rulings that bind here, by identifier equality only
    rulings = bookkeeping.rulings_for_capsule(bookkeeping.active_rulings(campaign), session_kind=(session or {}).get("kind"),
                                              present=[graph.handle(n) for n in present_nodes], scene=graph.handle(scene),
                                              module_id=graph.module_id)

    def conditions_of(sheet: dict[str, Any]) -> list[str]:
        healing = read_healing_state(campaign.dir, str(sheet.get("id")))
        conditions = healing.get("conditions") if isinstance(healing.get("conditions"), list) else sheet.get("conditions")
        return [str(c) for c in conditions or []]

    director = director_section(director_graph, ontology, graph, world, scene, turn, party, present_nodes, records, session,
                                clock_near_full=near_full, memory_rows=candidates,
                                conditions_of=conditions_of,
                                sanity_of=lambda sheet: sanity_snapshot(campaign.dir, str(sheet.get("id"))),
                                worldline=worldline_mod.director_signals(worldlines))
    style = craft.style_section(language=language, register=register, beat=director["beat"], full=style_full)

    sections: dict[str, Any] = {
        "where": where,
        "present": present_section(graph, world, scene, ledger, candidates,
                                   worldline_mod.cross_line_reader(
                                       campaign, graph, meta,
                                       EntityIndex(graph, party, scene_labels=world.get("scene_labels")))),
        "known": known_section(graph, world, scene, party),
        "pressures": pressures,
        "obligations": obligations,
        "director": director,
        "situations": situations,
        "worldlines": worldlines,
        "rulings": rulings,
        "memory": memory_section(graph, campaign, world, scene, party),
        "style": style,
        "recent": recent_section(campaign, int(turn["turn"])),
        "warnings": latest_warnings(campaign, int(turn["turn"])),
    }
    truncated = []
    # §18.1: `known.flags` keeps its own 512B before `known` as a whole is fitted; the
    # list is newest first, so shedding the tail drops the oldest writes.
    if fit_budget(sections["known"]["flags"], KNOWN_FLAGS_BUDGET, drop="last"):
        truncated.append("known.flags")
    for name, budget in BUDGETS.items():
        cut = fit_budget(sections[name], budget)
        if cut or (isinstance(sections[name], dict) and sections[name].get("truncated")):
            truncated.append(name)
            if isinstance(sections[name], dict):
                sections[name]["truncated"] = True
    for name, budget in SLICE2_BUDGETS.items():
        if fit_budget(sections[name], budget, drop="last"):
            truncated.append(name)
    for name, budget in SLICE3_BUDGETS.items():
        if name == "style" and style_full:
            budget = STYLE_FULL_BUDGET
        if fit_budget(sections[name], budget, drop="last"):
            truncated.append(name)
    if fit_budget(sections["rulings"], RULINGS_BUDGET, drop="last"):
        truncated.append("rulings")
    if fit_budget(sections["worldlines"], WORLDLINES_BUDGET, drop="last"):
        truncated.append("worldlines")
    head = HEAD
    if module_brief:
        # #22: the briefing rides once, on the process's first turn after open.
        sections["module"], cut = fitted_module_section(graph)
        if cut:
            truncated.append("module")
        head += HEAD_MODULE
    capsule: dict[str, Any] = {
        "head": head,
        "turn": {
            "number": turn["turn"],
            "state": turn["state"],
            "pending_choice": turn.get("pending_choice"),
            "player_text": turn.get("player_text"),
        },
        **sections,
    }
    if resume is not None:
        capsule["resume"] = resume
    if truncated:
        capsule["truncated"] = truncated
    return capsule


# ---- single-entity views ------------------------------------------------------

def npc_view(graph: ModuleGraph, world: dict[str, Any], node: dict[str, Any],
             ledger: dict[str, Any] | None = None) -> dict[str, Any]:
    """§17.4 `look focus=<npc>`: everything, where the capsule's `present` entry carries
    only what fits — the whole dossier, every claim line, every tie, and the ledger row as
    it stands. Keeper-only, like the capsule it mirrors."""
    handle = graph.handle(node)
    view: dict[str, Any] = {
        "kind": "npc",
        "name": graph.display_name(node),
        "id": handle,
        "node_id": node["node_id"],
        "scene": (world.get("npc_presence") or {}).get(handle),
        "summary": node.get("summary"),
        "visibility": node.get("visibility"),
    }
    view.update({field: value for key, field in (("relationship_to_investigators", "role"),
                                                 ("agenda", "wants"), ("fear", "fears"),
                                                 ("secret", "hides"), ("voice", "voice"))
                 if (value := graph.npc_profile(node).get(key))})
    discovered = set(world.get("discovered_clues") or [])
    knows = [{"clue": entry["handle"], "summary": entry["node"].get("summary") or entry["node"].get("name"),
              "discovered": entry["handle"] in discovered} for entry in graph.npc_knows(node)]
    if knows:
        view["knows"] = knows
    knowledge = graph.authored_lines(node, "knowledge")
    if knowledge:
        view["knowledge"] = knowledge
    beliefs = graph.npc_beliefs(node)
    if beliefs:
        view["believes"] = beliefs
    hidden = graph.npc_claim_lines(node, HIDES)
    if hidden:
        view["hides_claims"] = hidden
    would_say = graph.npc_would_say(node)
    if would_say:
        view["would_lie_about"] = would_say
    ties = graph.npc_ties(node)
    if ties:
        view["ties"] = [{"kind": tie["kind"], "to": tie["to"], "kind_of": tie["node"]["node_kind"]} for tie in ties]
    view["ledger"] = (ledger or {}).get(node["node_id"])
    record = record_of(node)
    if record:
        view.update({
            "keeper_note": record.get("keeper_note"),
            "social_role": record.get("social_role"),
            "deflect_options": record.get("deflect_options") or [],
            "lie_options": record.get("lie_options") or [],
            "availability": record.get("availability"),
            "mechanics": record.get("mechanics"),
        })
    authored = graph.entity_view(node).get("properties") or {}
    if authored:
        view["properties"] = authored
    return view


def investigator_view(sheet: dict[str, Any]) -> dict[str, Any]:
    hidden = {"notes", "schema_version", "current_hp", "current_san", "current_mp", "current_luck"}
    view: dict[str, Any] = {"kind": "investigator"}
    view.update({k: v for k, v in sheet.items() if k not in hidden})
    view.update({
        "hp": sheet.get("current_hp"),
        "san": sheet.get("current_san"),
        "mp": sheet.get("current_mp"),
        "luck": sheet.get("current_luck"),
    })
    return view
