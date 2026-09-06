"""Turn capsule (contract §6, §12.7, §13.1) and the single-entity views behind table.look.

All strings here are keeper material copied from the module graph, the world state and
the content graphs; nothing is paraphrased or invented. Nine sections plus `head`,
`turn`, `recent`, `warnings` and `resume`; each section has a byte budget and is trimmed
by item when it overflows, the section name landing in `truncated`."""

from __future__ import annotations

import json
from typing import Any, Callable

from . import director as director_mod, pressures as pressures_mod
from .craft import TextGraph
from .director import DirectorGraph
from .module_graph import NPC_KIND, ModuleGraph, condition_met, describe_condition, record_of  # noqa: F401 - condition helpers re-exported
from .ontology import Ontology
from .rules.graph import semantic_name
from .store import Campaign

#: §6 sections: trimmed by item, oldest first for `recent`; the dict sections also gain
#: `truncated: true` inside (§6), every trimmed section lands in the capsule's `truncated`.
BUDGETS = {"where": 4096, "present": 3072, "known": 3072, "recent": 2048}
#: §12.7 ranked lists that shed their tail, not their head.
SLICE2_BUDGETS = {"memory": 1536, "warnings": 1024}
#: §13.1: the new sections and their budgets. `style` doubles on the first capsule after
#: the process opened the table (§13.6).
SLICE3_BUDGETS = {"pressures": 1024, "obligations": 1024, "director": 1536, "situations": 1024, "style": 1024}
STYLE_FULL_BUDGET = 2048
MEMORY_HITS = 6
RECENT_TURNS = 2
KEEPER_EXCERPT = 200
SKILLS_OF_NOTE = 8
MINUTES_PER_HOUR = 60
MINUTES_PER_DAY = 24 * 60

HEAD = {
    "zh-Hans": ("以下是本回合开始时的全部场面：已含时钟、本场景未发现的线索与门槛、在场者的秘密与议程、来路与出口、"
                "压力与待办、规则层的当前形势、Director 的建议节拍、相关记忆与文风契约。胶囊里有的不必再 look/lookup；"
                "director 是建议不是台词。"),
    "en": ("Everything at the start of this turn: the clock, the undiscovered clues here and their gates, the secrets "
           "and agendas of those present, the way back and the exits, pressures and obligations, the rule-layer "
           "situations, the Director's suggested beat, related memory and the style contract. Do not look/lookup "
           "for what is already here; director is advice, not lines."),
}
ELAPSED = {"zh-Hans": "{hours} 小时 {minutes} 分钟", "en": "{hours} h {minutes} min"}
#: Day parts by hour of day, only when the module declares a start time (§13.1).
DAY_PARTS = ((5, "dawn"), (8, "morning"), (12, "midday"), (14, "afternoon"), (18, "evening"), (22, "night"), (24, "small_hours"))
DAY_PARTS_ZH = {"dawn": "拂晓", "morning": "上午", "midday": "正午", "afternoon": "下午", "evening": "傍晚", "night": "夜晚",
                "small_hours": "深夜"}


def json_size(payload: Any) -> int:
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def _lang(language: str) -> str:
    return language if language in HEAD else "en"


# ---- sections -----------------------------------------------------------------

def scene_label(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any]) -> str:
    """The name the table calls a scene: the label the keeper gave it on `apply move`
    (kept in `world.scene_labels`, player language) or else the graph's display name."""
    labels = world.get("scene_labels") or {}
    return str(labels.get(graph.handle(scene)) or graph.display_name(scene))


def clock_section(graph: ModuleGraph, world: dict[str, Any], language: str) -> dict[str, Any]:
    """`where.clock`: the world minutes, `elapsed` generated from them, and `day_part`
    only when the module node declares a start time (nothing is guessed otherwise)."""
    minutes = int((world.get("clock") or {}).get("minutes") or 0)
    lang = _lang(language)
    clock: dict[str, Any] = {"minutes": minutes,
                             "elapsed": ELAPSED[lang].format(hours=minutes // MINUTES_PER_HOUR, minutes=minutes % MINUTES_PER_HOUR)}
    start = record_of(graph.module_node).get("start_time") if graph.module_node else None
    if isinstance(start, str) and ":" in start:
        try:
            hour, minute = (int(part) for part in start.split(":", 1))
        except ValueError:
            return clock
        at = (hour * MINUTES_PER_HOUR + minute + minutes) % MINUTES_PER_DAY
        part = next(name for bound, name in DAY_PARTS if at < bound * MINUTES_PER_HOUR)
        clock["day_part"] = DAY_PARTS_ZH[part] if lang.startswith("zh") else part
    return clock


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

    back = []
    for handle in reversed([str(h) for h in world.get("scene_trail") or []]):
        try:
            back.append({"to": handle, "display_name": scene_label(graph, world, graph.scene(handle))})
        except Exception:  # noqa: BLE001 - a stale handle in an old world is not a reason to lose the section
            back.append({"to": handle})

    return {
        "scene": graph.handle(scene),
        "display_name": scene_label(graph, world, scene),
        "dramatic_question": record.get("dramatic_question"),
        "pressure_moves": list(record.get("pressure_moves") or []),
        "exits": exits,
        "back": back,
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
        # §13.1: keeper-only material, same law as agenda — never player text.
        for key in ("secret", "fear"):
            value = record.get(key)
            if isinstance(value, str) and value.strip():
                entry[key] = value
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
    first MEMORY_HITS hits (§12.7)."""
    from .memory import EntityIndex, query_candidates  # local: memory imports facts, which imports render
    about = [graph.display_name(n) for n in npcs_present(graph, world, scene)]
    about.extend(str(sheet.get("name")) for sheet in party)
    return query_candidates(campaign, EntityIndex(graph, party, scene_labels=world.get("scene_labels")),
                            about=about, narrow=False, limit=MEMORY_HITS)


# ---- director (§13.3) ---------------------------------------------------------

def director_section(dg: DirectorGraph, ontology: Ontology, graph: ModuleGraph, world: dict[str, Any],
                     scene: dict[str, Any], turn: dict[str, Any], party: list[dict[str, Any]], present: list[dict[str, Any]],
                     records: dict[int, dict[str, Any]], session: dict[str, Any] | None, *, language: str,
                     clock_near_full: bool, memory_rows: list[dict[str, Any]], conditions_of: Callable[[dict[str, Any]], list[str]],
                     sanity_of: Callable[[dict[str, Any]], dict[str, Any] | None]) -> dict[str, Any]:
    undiscovered = [c for c in clues_here(graph, world, scene) if not c["discovered"]]
    sig = director_mod.signals(graph, world, scene, turn, party=party, present=present, undiscovered_here=len(undiscovered),
                               records=records, session=session, clock_near_full=clock_near_full,
                               conditions_of=conditions_of, sanity_of=sanity_of)
    names = [graph.display_name(n) for n in present] + list(world.get("discovered_clues") or [])
    overlap = director_mod.memory_overlap_count(memory_rows, names)
    can_move = bool(graph.scene_exits(scene)) or bool(world.get("scene_trail"))
    scored = director_mod.score(dg, sig, scene, language=language, can_move=can_move, overlap=overlap,
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
                  turn: dict[str, Any], party: list[dict[str, Any]], *, language: str,
                  situations: list[dict[str, Any]], director_graph: DirectorGraph, ontology: Ontology,
                  craft: TextGraph, register: str, style_full: bool = False,
                  resume: dict[str, Any] | None = None) -> dict[str, Any]:
    from .memory import open_promises, read_candidates  # local: memory imports facts, which imports render
    from .rules.healing import read_healing_state
    from .sessions import SessionView, sanity_snapshot  # local: sessions reads capsule.condition_met for chase chains
    from .warn import latest_warnings
    lang = _lang(language)
    scene = graph.scene(world["active_scene"])
    present_nodes = npcs_present(graph, world, scene)
    view = SessionView(campaign.dir, graph, party, world)
    session = view.active_session()
    records = campaign.turn_records_by_number()
    played = director_mod.played_records(records, int(turn["turn"]))
    previous = played[0] if played else None

    where = where_section(graph, world, scene)
    where["clock"] = clock_section(graph, world, language)
    where["session"] = session

    fraction = director_graph.threshold("pressure-clock-near-full-fraction")
    clocks, near_full = pressures_mod.clock_pressures(lang, situations, party, session, tuple(fraction))
    continuations = pressures_mod.unanswered_continuations(previous, list(turn.get("receipts") or []))
    pressures = (clocks + pressures_mod.threat_pressures(lang, graph, scene, present_nodes)
                 + pressures_mod.rule_pressures(lang, continuations))
    obligations = (pressures_mod.choice_obligation(lang, turn.get("pending_choice"))
                   + pressures_mod.session_obligation(lang, session)
                   + pressures_mod.continuation_obligations(lang, continuations)
                   + pressures_mod.quest_obligations(lang, graph, world)
                   + pressures_mod.promise_obligations(lang, open_promises(campaign)))

    def conditions_of(sheet: dict[str, Any]) -> list[str]:
        healing = read_healing_state(campaign.dir, str(sheet.get("id")))
        conditions = healing.get("conditions") if isinstance(healing.get("conditions"), list) else sheet.get("conditions")
        return [str(c) for c in conditions or []]

    director = director_section(director_graph, ontology, graph, world, scene, turn, party, present_nodes, records, session,
                                language=language, clock_near_full=near_full, memory_rows=read_candidates(campaign),
                                conditions_of=conditions_of,
                                sanity_of=lambda sheet: sanity_snapshot(campaign.dir, str(sheet.get("id"))))
    style = craft.style_section(language=language, register=register, beat=director["beat"], full=style_full)

    sections: dict[str, Any] = {
        "where": where,
        "present": present_section(graph, world, scene),
        "known": known_section(graph, world, scene, party),
        "pressures": pressures,
        "obligations": obligations,
        "director": director,
        "situations": situations,
        "memory": memory_section(graph, campaign, world, scene, party),
        "style": style,
        "recent": recent_section(campaign, int(turn["turn"])),
        "warnings": latest_warnings(campaign, int(turn["turn"])),
    }
    truncated = []
    for name, budget in BUDGETS.items():
        if fit_budget(sections[name], budget):
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
    capsule: dict[str, Any] = {
        "head": HEAD[lang],
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
