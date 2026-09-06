"""Turn capsule (contract §6) and the single-entity views behind table.look.

All strings here are keeper material copied from the module graph and the
world state; nothing is paraphrased or invented."""

from __future__ import annotations

import json
from typing import Any

from .fileio import canonical_json
from .module_graph import CLUE_KIND, NPC_KIND, ModuleGraph, record_of
from .store import Campaign
from .text import strip_prefix

BUDGETS = {"where": 4096, "present": 3072, "known": 3072, "recent": 2048}
RECENT_TURNS = 2
KEEPER_EXCERPT = 200
SKILLS_OF_NOTE = 8


def json_size(payload: Any) -> int:
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


# ---- conditions ---------------------------------------------------------------

def condition_met(when: Any, world: dict[str, Any]) -> bool:
    if not isinstance(when, dict):
        return False
    kind = when.get("kind")
    if kind == "always":
        return True
    if kind == "clue_discovered":
        clue = strip_prefix(str(when.get("clue_id", "")), CLUE_KIND)
        return clue in (world.get("discovered_clues") or [])
    return False


def describe_condition(when: Any) -> str:
    if isinstance(when, dict) and when.get("kind") == "clue_discovered":
        return f"clue_discovered: {strip_prefix(str(when.get('clue_id', '')), CLUE_KIND)}"
    return canonical_json(when)


# ---- sections -----------------------------------------------------------------

def where_section(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any]) -> dict[str, Any]:
    record = record_of(scene)
    exits = []
    for exit_ in graph.scene_exits(scene):
        entry: dict[str, Any] = {"to": exit_["to"]}
        if "travel_minutes" in exit_:
            entry["travel_minutes"] = exit_["travel_minutes"]
        when = exit_.get("when")
        if when and not condition_met(when, world):
            entry["unlock_when"] = describe_condition(when)
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

    return {
        "scene": graph.handle(scene),
        "display_name": graph.display_name(scene),
        "dramatic_question": record.get("dramatic_question"),
        "pressure_moves": list(record.get("pressure_moves") or []),
        "exits": exits,
        "affordances": affordances,
        "keeper_notes": keeper_notes,
        "assets": graph.scene_assets(scene),
    }


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


def present_section(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any]) -> list[dict[str, Any]]:
    present = []
    attitudes = world.get("npc_attitude") or {}
    for node in npcs_present(graph, world, scene):
        record = record_of(node)
        entry: dict[str, Any] = {
            "name": graph.display_name(node),
            "relationship": record.get("relationship_to_investigators"),
            "agenda": record.get("agenda"),
            "voice": record.get("voice"),
            "known_facts": known_facts(graph, world, record),
        }
        attitude = attitudes.get(graph.handle(node))
        if attitude is not None:
            entry["attitude"] = attitude
        present.append(entry)
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
    }
    if party:
        section["investigator"] = investigator_summary(party[0])
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


def fit_budget(section: Any, budget: int) -> bool:
    """Trim by item until the section fits: innermost non-empty lists first (an NPC's
    known_facts before the NPC itself), oldest turn first for `recent`. Returns whether
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
        if victim is section and all(isinstance(item, dict) and "turn" in item for item in victim):
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


def build_capsule(graph: ModuleGraph, campaign: Campaign, world: dict[str, Any],
                  turn: dict[str, Any], party: list[dict[str, Any]]) -> dict[str, Any]:
    scene = graph.scene(world["active_scene"])
    sections: dict[str, Any] = {
        "where": where_section(graph, world, scene),
        "present": present_section(graph, world, scene),
        "known": known_section(graph, world, scene, party),
        "recent": recent_section(campaign, int(turn["turn"])),
    }
    truncated = []
    for name, budget in BUDGETS.items():
        if fit_budget(sections[name], budget):
            truncated.append(name)
            if isinstance(sections[name], dict):
                sections[name]["truncated"] = True
    capsule: dict[str, Any] = {
        "turn": {
            "number": turn["turn"],
            "state": turn["state"],
            "pending_choice": turn.get("pending_choice"),
            "player_text": turn.get("player_text"),
        },
        **sections,
    }
    if truncated:
        capsule["truncated"] = truncated
    return capsule


# ---- single-entity views ------------------------------------------------------

def npc_view(graph: ModuleGraph, world: dict[str, Any], node: dict[str, Any]) -> dict[str, Any]:
    record = record_of(node)
    handle = graph.handle(node)
    view: dict[str, Any] = {
        "kind": "npc",
        "name": graph.display_name(node),
        "id": handle,
        "scene": (world.get("npc_presence") or {}).get(handle),
        "summary": node.get("summary"),
        "visibility": node.get("visibility"),
    }
    if record:
        view.update({
            "agenda": record.get("agenda"),
            "fear": record.get("fear"),
            "secret": record.get("secret"),
            "voice": record.get("voice"),
            "relationship": record.get("relationship_to_investigators"),
            "keeper_note": record.get("keeper_note"),
            "social_role": record.get("social_role"),
            "known_facts": known_facts(graph, world, record),
            "deflect_options": record.get("deflect_options") or [],
            "lie_options": record.get("lie_options") or [],
            "availability": record.get("availability"),
            "mechanics": record.get("mechanics"),
        })
    else:
        view["properties"] = node.get("properties") or {}
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
