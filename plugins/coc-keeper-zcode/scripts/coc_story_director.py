#!/usr/bin/env python3
"""COC Story Director — deterministic planner.

Each turn, reads rule state + scenario story-graph + player intent, produces
a DirectorPlan JSON guiding coc-keeper-play's narrative direction. Read-only
with respect to rule state; never modifies save/combat/sanity.

Spec: docs/superpowers/specs/2026-07-05-story-director-design.md
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module

coc_rule_signals = _load_sibling("coc_rule_signals", "coc_rule_signals.py")
coc_mythos = _load_sibling("coc_mythos", "coc_mythos.py")

coc_time = None
try:
    coc_time = _load_sibling("coc_time", "coc_time.py")
except Exception:
    coc_time = None  # time layer optional; director degrades gracefully

coc_memory = None
try:
    coc_memory = _load_sibling("coc_memory", "coc_memory.py")
except Exception:
    coc_memory = None  # memory layer optional; director degrades gracefully


def _read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _read_last_roll_outcome(campaign_dir: Path) -> str | None:
    """Read the outcome of the last roll in logs/rolls.jsonl. Returns None if no rolls."""
    rolls_path = campaign_dir / "logs" / "rolls.jsonl"
    if not rolls_path.exists():
        return None
    last_line = None
    for line in rolls_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            last_line = line
    if last_line is None:
        return None
    try:
        record = json.loads(last_line)
        return record.get("payload", {}).get("outcome")
    except (json.JSONDecodeError, AttributeError):
        return None


def _text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _short_text(value: Any, limit: int = 96) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "..."


def _choice_affordance(choice: Any, index: int) -> dict[str, Any] | None:
    if isinstance(choice, dict):
        cue = _text_or_none(
            choice.get("cue")
            or choice.get("label")
            or choice.get("text")
            or choice.get("summary")
            or choice.get("action")
        )
        if not cue:
            return None
        route_id = _text_or_none(choice.get("id") or choice.get("route_id")) or f"live-choice-{index}"
        return {
            "id": route_id,
            "route_type": choice.get("route_type", "live_resume_affordance"),
            "cue": _short_text(cue, 80),
            "promise": choice.get("promise") or choice.get("visible_benefit"),
            "cost": choice.get("cost") or choice.get("visible_cost"),
            "risk": choice.get("risk") or choice.get("visible_risk"),
            "source": "save.active-scene.pending_choices",
        }
    cue = _text_or_none(choice)
    if not cue:
        return None
    return {
        "id": f"live-choice-{index}",
        "route_type": "live_resume_affordance",
        "cue": _short_text(cue, 80),
        "promise": "推进当前场景",
        "source": "save.active-scene.pending_choices",
    }


def _live_scene_affordances(active_scene_state: dict[str, Any], scenario_doc: dict[str, Any]) -> list[dict[str, Any]]:
    affordances: list[dict[str, Any]] = []
    pending = active_scene_state.get("pending_choices")
    if isinstance(pending, list):
        for index, choice in enumerate(pending, start=1):
            route = _choice_affordance(choice, index)
            if route is not None:
                affordances.append(route)
            if len(affordances) >= 3:
                break

    if len(affordances) < 2:
        summary = (
            active_scene_state.get("summary")
            or scenario_doc.get("opening_scene")
            or scenario_doc.get("player_safe_summary")
            or scenario_doc.get("summary")
            or scenario_doc.get("current_phase")
            or "当前场景"
        )
        affordances.append({
            "id": "live-scene-thread",
            "route_type": "live_resume_affordance",
            "cue": "当前场景的核心问题仍未解决。",
            "promise": "沿着当前场景继续推进",
            "visible_benefit": _short_text(summary, 80),
            "source": "save.active-scene.summary",
        })
    if len(affordances) < 2:
        affordances.append({
            "id": "live-investigator-angle",
            "route_type": "live_resume_affordance",
            "cue": "调查员仍可从随身记录、装备、现场人物或既有判断重新切入。",
            "promise": "换一个角度寻找行动入口",
            "risk": "拖延会让局势继续变化",
            "source": "live-story-bridge.default",
        })

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for affordance in affordances:
        cue = str(affordance.get("cue", ""))
        if cue in seen:
            continue
        seen.add(cue)
        deduped.append(affordance)
    return deduped[:3]


def _runtime_scene_from_live_state(
    active_scene_state: dict[str, Any],
    world: dict[str, Any],
    scenario_doc: dict[str, Any],
) -> dict[str, Any] | None:
    scene_id = _text_or_none(active_scene_state.get("scene_id")) or _text_or_none(world.get("active_scene_id"))
    if not scene_id:
        scene_id = _text_or_none(scenario_doc.get("current_phase")) or "live-current-scene"
    summary = (
        active_scene_state.get("summary")
        or scenario_doc.get("opening_scene")
        or scenario_doc.get("player_safe_summary")
        or scenario_doc.get("summary")
        or scene_id
    )
    return {
        "scene_id": scene_id,
        "scene_type": active_scene_state.get("scene_type", "investigation"),
        "dramatic_question": (
            active_scene_state.get("dramatic_question")
            or f"调查员如何推进当前场景：{_short_text(summary)}"
        ),
        "entry_conditions": active_scene_state.get("entry_conditions", []),
        "exit_conditions": active_scene_state.get("exit_conditions", []),
        "available_clues": active_scene_state.get("available_clues", []),
        "npc_ids": active_scene_state.get("npc_ids", []),
        "pressure_moves": active_scene_state.get("pressure_moves", []),
        "tone": active_scene_state.get("tone", ["tense"]),
        "allowed_improvisation": active_scene_state.get("allowed_improvisation", []),
        "affordances": _live_scene_affordances(active_scene_state, scenario_doc),
        "excluded_storylet_tropes": active_scene_state.get("excluded_storylet_tropes", ["animal_instinct"]),
        "source": "live-story-bridge.active-scene",
    }


def _story_graph_with_live_fallback(
    story_graph: dict[str, Any],
    active_scene_state: dict[str, Any],
    world: dict[str, Any],
    scenario_doc: dict[str, Any],
) -> tuple[dict[str, Any], str | None, dict[str, Any] | None]:
    story_graph = dict(story_graph or {"scenes": []})
    scenes = [s for s in story_graph.get("scenes", []) if isinstance(s, dict)]
    world_scene_id = _text_or_none(world.get("active_scene_id"))
    if world_scene_id:
        active_scene = next((s for s in scenes if s.get("scene_id") == world_scene_id), None)
        if active_scene is not None:
            story_graph["scenes"] = scenes
            return story_graph, world_scene_id, active_scene

    live_scene_id = _text_or_none(active_scene_state.get("scene_id"))
    if live_scene_id:
        active_scene = next((s for s in scenes if s.get("scene_id") == live_scene_id), None)
        if active_scene is not None:
            story_graph["scenes"] = scenes
            return story_graph, live_scene_id, active_scene

    runtime_scene = _runtime_scene_from_live_state(active_scene_state, world, scenario_doc)
    if runtime_scene is None:
        story_graph["scenes"] = scenes
        return story_graph, world_scene_id, None

    runtime_id = runtime_scene.get("scene_id")
    scenes = [s for s in scenes if s.get("scene_id") != runtime_id]
    scenes.insert(0, runtime_scene)
    story_graph["schema_version"] = story_graph.get("schema_version", 1)
    story_graph["source"] = story_graph.get("source", "live-story-bridge")
    story_graph["scenes"] = scenes
    return story_graph, str(runtime_id), runtime_scene


def build_director_context(
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    player_intent: str,
    player_intent_class: str,
    rng: random.Random | None = None,
    player_intent_rich: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble DirectorContext: rule signals + active scene + scenario graph.

    Read-only. Pulls investigator-state, character, world-state, flags,
    pacing-state, and the 7 scenario story-graph files.

    ``player_intent_rich`` is an optional enrichment dict (the 6-field
    structure from coc_intent_router.parse_intent: primary_intent,
    secondary_intents, target_entities, risk_posture,
    explicit_roll_request, player_hypothesis). When provided, it augments
    scoring (see ``_base_score``) and memory retrieval; when None, behavior
    is identical to the legacy single-class path.
    """
    rng = rng or random.Random()
    save = campaign_dir / "save"
    # When a rich intent is supplied, derive the legacy single class from it
    # so _base_score's existing branches and turn_input stay consistent.
    if player_intent_rich and "primary_intent" in player_intent_rich:
        player_intent_class = player_intent_rich["primary_intent"]
    scenario = campaign_dir / "scenario"

    inv_state = _read_json(save / "investigator-state" / f"{investigator_id}.json", {})
    character = _read_json(character_path, {})
    world = _read_json(save / "world-state.json", {})
    pacing = _read_json(save / "pacing-state.json", {})
    _last_outcome = _read_last_roll_outcome(campaign_dir)
    module_meta = _read_json(scenario / "module-meta.json", {})
    scenario_doc = _read_json(scenario / "scenario.json", {})
    active_scene_state = _read_json(save / "active-scene.json", {})
    story_graph, active_scene_id, active_scene = _story_graph_with_live_fallback(
        _read_json(scenario / "story-graph.json", {"scenes": []}),
        active_scene_state if isinstance(active_scene_state, dict) else {},
        world if isinstance(world, dict) else {},
        scenario_doc if isinstance(scenario_doc, dict) else {},
    )
    if active_scene_id:
        world = dict(world)
        world["active_scene_id"] = active_scene_id

    # --- rule signals ---
    char_derived = character.get("derived", {})
    char_chars = character.get("characteristics", {})
    char_skills = character.get("skills", {})
    conditions = inv_state.get("conditions", []) or []
    current_hp = inv_state.get("current_hp", char_derived.get("HP", 10))
    max_hp = char_derived.get("HP", 10)
    current_san = inv_state.get("current_san", char_derived.get("SAN", 50))
    # Max SAN = 99 - Cthulhu Mythos (p.167 F9); see coc_mythos.max_san_for.
    cthulhu_mythos = int(char_skills.get("Cthulhu Mythos", 0))
    max_san = coc_mythos.max_san_for(cthulhu_mythos)
    credit_rating = char_skills.get("Credit Rating", 0)
    app = char_chars.get("APP", 50)
    luck = char_derived.get("Luck") or char_chars.get("LUCK", 50)

    recent_intents = pacing.get("recent_intent_classes", [])
    rule_signals = {
        "hp_state": coc_rule_signals.read_hp_state(current_hp, max_hp, conditions),
        "sanity_state": coc_rule_signals.read_sanity_state(
            current_san, max_san,
            bout_active="bout_active" in conditions,
            lost_this_event=inv_state.get("san_lost_this_event", 0),
        ),
        "indefinite_insane": bool(inv_state.get("indefinite_insane", False)),
        "credit_tier": coc_rule_signals.read_credit_tier(credit_rating),
        "credit_rating": credit_rating,  # raw value for roll_npc_reaction
        "app": app,  # raw value for roll_npc_reaction
        "npc_reaction_roll": None,  # populated per-NPC at scoring time
        "luck_level": coc_rule_signals.read_luck_signal(luck, pacing.get("luck_spent_last", 0))[0],
        "luck_spent_last": pacing.get("luck_spent_last", 0) > 0,
        "last_roll_critical": _last_outcome == "critical",
        "last_roll_fumble": _last_outcome == "fumble",
        "active_conditions": conditions,
        "stalled_turns": coc_rule_signals.read_stalled_turns(recent_intents),
        "tension_clock": coc_rule_signals.read_tension_clock(
            pacing.get("tension_level", "low"), pacing.get("lethal_chances_used", 0),
        ),
        "bout_active": "bout_active" in conditions,
    }
    signal_ctx = {
        "player_intent_class": player_intent_class,
        "player_intent_rich": player_intent_rich,
        "active_scene": active_scene,
    }
    rule_signals["low_agency_continue_count"] = _low_agency_continue_count(
        recent_intents, signal_ctx
    )
    rule_signals["scene_pressure_available"] = _scene_pressure_available(signal_ctx)

    # --- time signals (deterministic world-clock layer) ---
    time_signals: dict[str, Any] = {}
    if coc_time is not None:
        time_state = coc_time.read_time_state(campaign_dir)
        if time_state:
            due = coc_time.peek_due_triggers(campaign_dir)
            time_signals = coc_time.build_time_signals(time_state, due)

    # --- engine-state signals (SanitySession / ChaseSession awareness) ---
    sanity_engine_state: dict[str, Any] | None = None
    if hasattr(coc_rule_signals, "read_sanity_engine_state"):
        sanity_engine_state = coc_rule_signals.read_sanity_engine_state(
            campaign_dir, investigator_id
        )
    chase_state: dict[str, Any] | None = None
    if hasattr(coc_rule_signals, "read_chase_state"):
        chase_state = coc_rule_signals.read_chase_state(campaign_dir)

    return {
        "campaign_dir": campaign_dir,
        "investigator_id": investigator_id,
        "player_intent": player_intent,
        "player_intent_class": player_intent_class,
        "player_intent_rich": player_intent_rich,
        "active_scene_id": active_scene_id,
        "active_scene": active_scene,
        "structure_type": module_meta.get("structure_type", "branching_investigation"),
        "module_meta": module_meta,
        "story_graph": story_graph,
        "clue_graph": _read_json(scenario / "clue-graph.json", {"conclusions": []}),
        "npc_agendas": _read_json(scenario / "npc-agendas.json", {"npcs": []}),
        "threat_fronts": _read_json(scenario / "threat-fronts.json", {"fronts": []}),
        "pacing_map": _read_json(scenario / "pacing-map.json", {"pacing_curve": []}),
        "improvisation_boundaries": _read_json(scenario / "improvisation-boundaries.json", {}),
        "world_state": world,
        "rule_signals": rule_signals,
        "time_signals": time_signals,
        "sanity_engine_state": sanity_engine_state,
        "chase_state": chase_state,
        "rng": rng,
        "turn_number": pacing.get("turn_number", 0),
    }


def write_director_plan(plan: dict[str, Any], artifacts_dir: Path) -> Path:
    """Persist DirectorPlan to artifacts/<decision_id>.json. Returns path."""
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / f"{plan['decision_id']}.json"
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


# =============================================================================
# Three-layer scoring engine
# Spec: docs/superpowers/specs/2026-07-05-story-director-design.md
# =============================================================================

RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"


def _load_structure_weights() -> dict[str, Any]:
    return _read_json(RULES_DIR / "structure-weights.json", {"weights": {}, "tiebreak_order": []})


ACTIONS = ["REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT", "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF"]

_LOW_AGENCY_RECENT_CLASSES = {
    "move",
    "continue",
    "follow",
    "follow_group",
    "low_agency_continue",
    "passive_follow",
}
_LOW_AGENCY_CONTINUE_TAGS = {
    "low_agency_continue",
    "continue_without_new_goal",
    "follow_group",
    "keep_following",
    "yield_initiative",
    "move_with_group",
    "passive_follow",
}


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _rich_intent_tags(ctx: dict[str, Any]) -> set[str]:
    rich = ctx.get("player_intent_rich") or {}
    tags = {str(ctx.get("player_intent_class") or "")}
    tags.add(str(rich.get("primary_intent") or ""))
    for key in ("secondary_intents", "target_entities"):
        for value in _as_list(rich.get(key)):
            if value:
                tags.add(str(value))
    return {tag for tag in tags if tag}


def _is_low_agency_continue(ctx: dict[str, Any]) -> bool:
    tags = _rich_intent_tags(ctx)
    if tags & _LOW_AGENCY_CONTINUE_TAGS:
        return True
    return str(ctx.get("player_intent_class") or "") in _LOW_AGENCY_RECENT_CLASSES


def _low_agency_continue_count(recent_intents: list[Any], ctx: dict[str, Any]) -> int:
    count = 1 if _is_low_agency_continue(ctx) else 0
    for item in reversed(recent_intents or []):
        if str(item) not in _LOW_AGENCY_RECENT_CLASSES:
            break
        count += 1
    return count


def _scene_pressure_available(ctx: dict[str, Any]) -> bool:
    scene = ctx.get("active_scene") or {}
    return bool(scene.get("pressure_moves"))


def _player_facing_style(language: str = "zh-Hans") -> dict[str, Any]:
    if language == "zh-Hans":
        return {
            "language": "zh-Hans",
            "register": "natural_tabletop_narration",
            "avoid": ["translationese", "ai_summary_voice", "log_style_summary"],
            "prefer": ["short_sentences", "concrete_sensory_detail", "open_ended_prompt"],
        }
    return {
        "language": language,
        "register": "natural_tabletop_narration",
        "avoid": ["ai_summary_voice", "log_style_summary"],
        "prefer": ["short_sentences", "concrete_sensory_detail", "open_ended_prompt"],
    }


def _clock_segments(clock: dict, key: str, default: int = 0) -> int:
    """Read a clock segment count, tolerating null/missing/non-int values.
    Director consumes LLM-compiled JSON which may have type inconsistencies."""
    val = clock.get(key, default)
    if val is None:
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _base_score(action: str, ctx: dict[str, Any]) -> float:
    """Layer 1: structure-agnostic trigger conditions. Returns 0.0-1.0."""
    scene = ctx.get("active_scene") or {}
    sig = ctx["rule_signals"]
    intent = ctx["player_intent_class"]
    clue_graph = ctx.get("clue_graph", {})
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))

    if action == "REVEAL":
        avail = [c for c in scene.get("available_clues", []) if c not in discovered]
        if not avail:
            return 0.0
        if intent == "investigate":
            return 0.9
        if intent == "social":
            return 0.75
        return 0.0

    if action == "DEEPEN":
        if intent not in ("investigate", "social"):
            return 0.0
        return 0.5 if scene.get("dramatic_question") else 0.0

    if action == "PRESSURE":
        fronts = ctx.get("threat_fronts", {}).get("fronts", [])
        near_full = any(
            any(_clock_segments(c, "current_segments", 0) >= _clock_segments(c, "segments", 6) * 2 / 3
                for c in f.get("clocks", []))
            for f in fronts
        )
        yielded_scene = (
            sig.get("low_agency_continue_count", 0) >= 2
            and sig.get("scene_pressure_available", False)
        )
        base = 0.85 if yielded_scene else (0.8 if (near_full or sig["stalled_turns"] >= 1) else 0.2)
        # Rich-intent risk posture adjustment: a reckless player invites more
        # pressure (clocks tick faster toward them); a cautious player tempers
        # it. No-op when rich intent is absent (legacy single-class path).
        rich = ctx.get("player_intent_rich")
        if rich:
            posture = rich.get("risk_posture", "neutral")
            if posture == "reckless":
                base = min(0.95, base + 0.1)
            elif posture == "cautious":
                base = max(0.05, base - 0.1)
        return base

    if action == "CHARACTER":
        npcs_in_scene = scene.get("npc_ids", [])
        agendas = ctx.get("npc_agendas", {}).get("npcs", [])
        has_agenda_npc = any(n["npc_id"] in npcs_in_scene and n.get("agenda") for n in agendas)
        return 0.7 if has_agenda_npc else 0.0

    if action == "CHOICE":
        if intent not in ("idle", "ambiguous", "stuck"):
            return 0.0
        avail = [c for c in scene.get("available_clues", []) if c not in discovered]
        return 0.7 if len(avail) >= 2 else 0.0

    if action == "CUT":
        # dramatic question answered OR exit condition met
        exit_met = any(_eval_exit(e, ctx) for e in scene.get("exit_conditions", []))
        return 0.8 if exit_met else 0.0

    if action == "MONTAGE":
        return 0.6 if intent == "montage" else 0.0

    if action == "SUBSYSTEM":
        return 0.9 if intent in ("combat", "flee", "cast") else 0.0

    if action == "RECOVER":
        return 0.85 if sig["stalled_turns"] >= 2 else 0.0

    if action == "PAYOFF":
        if coc_memory is None:
            return 0.0
        cards = _retrieve_memory_for_ctx(ctx)
        if not cards:
            return 0.0
        # Discriminative scoring: normalize the raw retrieval score.
        # A single weak match (entity OR cue, top~4-6) should score ~0.3-0.4
        # (below REVEAL's 0.55-0.85, so PAYOFF only wins when memory is clearly relevant).
        # A strong match (multiple entities + cues, top~12+) scores ~0.7-0.85.
        # This keeps PAYOFF from firing on incidental overlap.
        top = max(float(c.get("score", 0)) for c in cards)
        return min(0.85, 0.15 + top * 0.05)

    return 0.0


def _eval_exit(condition: str, ctx: dict[str, Any]) -> bool:
    """Heuristic exit-condition eval. v1 supports 'clue discovered' and 'pressure clock reaches N'."""
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))
    if "discovered" in condition:
        clue_id = condition.split()[0]
        return clue_id in discovered
    if "pressure clock reaches" in condition:
        try:
            n = int(condition.split("reaches")[-1].strip())
            fronts = ctx.get("threat_fronts", {}).get("fronts", [])
            return any(
                any(_clock_segments(c, "current_segments", 0) >= n for c in f.get("clocks", []))
                for f in fronts
            )
        except (ValueError, IndexError):
            return False
    return False


def apply_rule_signal_overrides(ctx: dict[str, Any]) -> dict[str, Any] | None:
    """Layer 3: hard overrides. Returns a forced action dict or None.

    Note on lethal-endings (Spec Layer 3): the "lethal_chances_used < 3 in a
    lethal scene → block lethal ending" rule is currently enforced
    *structurally* — v1's ACTIONS set (see ACTIONS above) contains no
    lethal-ending action, so no plan can ever emit one. When v2 adds a
    death-capable action, an explicit branch must be added here that checks
    rule_signals["tension_clock"]["lethal_chances_used"] and downgrades/blocks
    the lethal action.
    """
    sig = ctx["rule_signals"]
    if sig["bout_active"]:
        return {"scene_action": "SUBSYSTEM", "subsystem": "sanity", "handoff": "rules",
                "rationale": "bout_active forces sanity subsystem"}
    if sig["hp_state"] == "dying":
        return {"scene_action": "SUBSYSTEM", "subsystem": "combat", "handoff": "rules",
                "rationale": "dying forces combat CON-clock + pressure",
                "extra_pressure": True}
    if sig["sanity_state"] == "temp_insane":
        return {"scene_action": "SUBSYSTEM", "subsystem": "sanity", "handoff": "rules",
                "rationale": "temp_insane triggers bout procedure"}
    if sig["last_roll_fumble"]:
        return {"scene_action": "PRESSURE", "handoff": "narration",
                "rationale": "fumble forces immediate misfortune, cannot be pushed off"}
    if sig.get("low_agency_continue_count", 0) >= 2 and sig.get("scene_pressure_available", False):
        return {"scene_action": "PRESSURE", "handoff": "narration",
                "rationale": "repeated low-agency continuation yields initiative to authored scene pressure"}
    if sig["stalled_turns"] >= 3:
        return {"scene_action": "RECOVER", "handoff": "narration",
                "rationale": "3 stalled turns forces Idea Roll recovery valve"}
    return None


def select_action(ctx: dict[str, Any]) -> tuple[str, dict[str, float]]:
    """Three-layer scoring. Returns (chosen_action, scores_dict)."""
    overrides = apply_rule_signal_overrides(ctx)
    if overrides is not None:
        # Layer 3 hit — bypass scoring
        scores = {a: 0.0 for a in ACTIONS}
        scores[overrides["scene_action"]] = 1.0
        scores["_override"] = 1.0  # type: ignore
        return overrides["scene_action"], scores

    weights_cfg = _load_structure_weights()
    stype = ctx["structure_type"]
    weights = weights_cfg.get("weights", {}).get(stype, {})
    tiebreak = weights_cfg.get("tiebreak_order", ACTIONS)

    scores: dict[str, float] = {}
    for action in ACTIONS:
        base = _base_score(action, ctx)
        w = weights.get(action, 1.0)
        scores[action] = round(base * w, 4)

    # pick max; tiebreak by order
    max_score = max(scores.values()) if scores else 0.0
    if max_score <= 0.0:
        return "CHOICE", scores  # no-trigger default

    candidates = [a for a, s in scores.items() if s == max_score]
    if len(candidates) == 1:
        return candidates[0], scores
    for action in tiebreak:
        if action in candidates:
            return action, scores
    return candidates[0], scores


# =============================================================================
# DirectorPlan assembly
# =============================================================================

# Default time deltas (minutes) the director proposes per scene_action when the
# world-clock layer is present. These are conservative proposals that the
# apply layer will still validate/clamp against time-costs.json categories.
_ACTION_TIME_PROFILES: dict[str, dict[str, Any]] = {
    "REVEAL":   {"mode": "elapsed", "category": "single_room_search", "delta_minutes": 20},
    "DEEPEN":   {"mode": "elapsed", "category": "single_room_search", "delta_minutes": 15},
    "PRESSURE": {"mode": "instant", "category": None, "delta_minutes": 1},
    "CHARACTER":{"mode": "elapsed", "category": "speak_briefly",      "delta_minutes": 5},
    "CHOICE":   {"mode": "instant", "category": None, "delta_minutes": 1},
    "CUT":      {"mode": "elapsed", "category": "local_travel",       "delta_minutes": 30},
    "MONTAGE":  {"mode": "downtime","category": "short_rest",         "delta_minutes": 120},
    "SUBSYSTEM":{"mode": "instant", "category": None, "delta_minutes": 1},
    "RECOVER":  {"mode": "downtime","category": "sleep_night",        "delta_minutes": 480},
    "PAYOFF":   {"mode": "instant", "category": None, "delta_minutes": 0},
}


def _derive_time_advance(action: str, time_signals: dict[str, Any]) -> dict[str, Any]:
    """Derive a time_advance proposal for the DirectorPlan.

    Combines the action's default time profile with the live time_signals
    (e.g. escalate to downtime sleep when the investigator is exhausted, or
    suppress advancement for OOC-style actions). Falls back to mode=none when
    the time layer is absent (no time_signals).
    """
    if not time_signals:
        return {"mode": "none", "reason": "time layer not initialized"}

    profile = _ACTION_TIME_PROFILES.get(action, {"mode": "none"})
    mode = profile.get("mode", "none")
    category = profile.get("category")
    delta = int(profile.get("delta_minutes", 0))
    confidence = 0.7
    reason = f"director proposal for {action}"

    # Exhaustion override: if the investigator has not rested in >18h and the
    # action is not already a recovery, propose a long downtime so the apply
    # layer can advance the clock through a sleep period (which fires healing
    # / sanity-day-reset triggers).
    hours_since_rest = float(time_signals.get("hours_since_last_rest", 0) or 0)
    if hours_since_rest > 18 and action not in ("RECOVER", "MONTAGE", "PAYOFF"):
        mode = "downtime"
        category = "sleep_night"
        delta = 480
        confidence = 0.85
        reason = f"exhausted ({hours_since_rest}h since last rest) → propose sleep"

    # High time-pressure: don't propose large jumps when a deadline is imminent.
    if time_signals.get("time_pressure") == "high" and mode == "downtime":
        mode = "elapsed"
        category = "quick_observation"
        delta = 5
        confidence = 0.6
        reason = "deadline imminent; minimal time advance"

    return {
        "mode": mode,
        "category": category,
        "delta_minutes": delta,
        "confidence": round(confidence, 2),
        "reason": reason,
    }




# Skill-name / difficulty-qualifier triggers that mark a clue delivery as
# obscured (i.e. one that requires a die roll to surface). Anything else — a
# Handout, a "directly given", a plain location/event description — is treated
# as obvious and delivered by the narrator without a roll.
_OBSCURED_DELIVERY_TRIGGERS = (
    "spot hidden", "library use", "listen", "medicine", "science", "psychology",
    "luck roll", "tracking", "investigate", "search", "examine",
    # difficulty qualifiers (Hard/Extreme rolls)
    "hard", "extreme",
    # other common CoC skill names that imply a check
    "persuade", "fast talk", "charm", "intimidate", "law", "occult",
    "cthulhu mythos", "pharmacy", "archaeology", "anthropology",
)


def _infer_clue_type(clue_id: str | None, clue_graph: dict[str, Any]) -> str:
    """Infer 'obvious' vs 'obscured' from a clue's delivery description.

    Reads the `delivery` field of the clue with `clue_id` from clue_graph's
    conclusions. If the delivery mentions a skill-name trigger or difficulty
    qualifier (Spot Hidden, Library Use, Hard, Extreme, ...) the clue requires
    a roll and is 'obscured'. Handouts, direct gives, plain location/event
    descriptions are 'obvious'.

    Defaults to 'obscured' (conservative — if we don't know, require a roll).
    """
    if not clue_id:
        return "obscured"
    needle = None
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("clue_id") == clue_id:
                needle = clue.get("delivery")
                break
        if needle is not None:
            break
    if needle is None:
        return "obscured"
    delivery = str(needle).lower()
    if any(trigger in delivery for trigger in _OBSCURED_DELIVERY_TRIGGERS):
        return "obscured"
    return "obvious"


def _find_clue(clue_id: str, clue_graph: dict[str, Any]) -> dict[str, Any] | None:
    """Find a clue dict by id across all conclusions. Returns None if not found."""
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("clue_id") == clue_id:
                return clue
    return None


def _clue_route_priority(clue_id: str | None, clue_graph: dict[str, Any]) -> float:
    """Read a clue's route_priority (default 0.5 if absent). Higher = more direct route."""
    if not clue_id:
        return 0.5
    clue = _find_clue(clue_id, clue_graph)
    if clue is None:
        return 0.5
    try:
        return float(clue.get("route_priority", 0.5))
    except (TypeError, ValueError):
        return 0.5


def _resolve_clue_delivery(clue_id: str | None, clue_graph: dict[str, Any]) -> tuple[str, str | None, str | None]:
    """Resolve a clue's delivery type + skill + difficulty from structured fields, with fallback.

    Returns (clue_type, skill, difficulty):
    - clue_type: "obvious" | "obscured"
    - skill: skill name if clue_type is obscured via skill_check, else None
    - difficulty: "regular"|"hard"|"extreme" or None

    Priority:
    1. Structured `delivery_kind` field on the clue (preferred)
    2. Fallback to `_infer_clue_type` string heuristic (for old clue-graphs without delivery_kind)
    """
    if not clue_id:
        return ("obscured", None, None)
    clue = _find_clue(clue_id, clue_graph)
    if clue is None:
        return ("obscured", None, None)
    delivery_kind = clue.get("delivery_kind")
    if delivery_kind:
        if delivery_kind == "skill_check":
            return ("obscured", clue.get("skill"), clue.get("difficulty", "regular"))
        # obvious, handout, npc_dialogue, environmental -> obvious
        return ("obvious", None, None)
    # Fallback: no structured field, use string heuristic on `delivery`
    clue_type = _infer_clue_type(clue_id, clue_graph)
    return (clue_type, None, None)


def _select_clue_policy(ctx: dict[str, Any], action: str) -> dict[str, Any]:
    """Choose reveal/withhold/fallback/leads per clue-graph.

    Clue selection is priority-aware: clues carry an optional `route_priority`
    (0.0-1.0, higher = more direct/likely route, default 0.5). REVEAL/RECOVER
    pick the highest-priority eligible clue; CHOICE surfaces the top 2 leads
    so the narrator can offer them to an idle/ambiguous player.
    """
    scene = ctx.get("active_scene") or {}
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))
    available = [c for c in scene.get("available_clues", []) if c not in discovered]
    secrets = ctx.get("improvisation_boundaries", {}).get("keeper_secrets", [])
    clue_graph = ctx.get("clue_graph", {})

    # REVEAL: rank eligible clues by route_priority (desc) and take the top one.
    if action == "REVEAL" and available:
        ranked = sorted(available, key=lambda cid: _clue_route_priority(cid, clue_graph), reverse=True)
        reveal = [ranked[0]]
    else:
        reveal = []

    # Resolve obvious vs obscured (+ skill/difficulty) from the first revealed
    # clue's structured delivery_kind, falling back to the delivery string
    # heuristic for old clue-graphs. This gates whether _build_rules_requests
    # emits a skill check (and which skill/difficulty it requests).
    _clue_type, _clue_skill, _clue_diff = _resolve_clue_delivery(
        reveal[0] if reveal else None, clue_graph)

    # fallback: if stalled (RECOVER), pull the highest-priority not-yet-found route.
    fallback = []
    if action == "RECOVER":
        for concl in clue_graph.get("conclusions", []):
            not_found = [c["clue_id"] for c in concl.get("clues", []) if c["clue_id"] not in discovered]
            if not_found:
                not_found_ranked = sorted(not_found, key=lambda cid: _clue_route_priority(cid, clue_graph), reverse=True)
                fallback.append(not_found_ranked[0])
                break

    # leads: for CHOICE (idle/ambiguous intent with ≥2 clues), surface the top 2
    # routes ranked by priority so the narrator can offer them to the player.
    leads: list[str] = []
    if action == "CHOICE":
        ranked = sorted(available, key=lambda cid: _clue_route_priority(cid, clue_graph), reverse=True)
        leads = ranked[:2]

    return {"reveal": reveal, "withhold": list(secrets), "fallback_routes": fallback,
            "clue_type": _clue_type, "skill": _clue_skill, "difficulty": _clue_diff,
            "leads": leads}


def _collect_anchors(clue_ids: list[str], clue_graph: dict[str, Any]) -> list[str]:
    """Collect player-visible anchor strings for given clue ids from clue-graph.
    Used to populate narrative_directives.must_include so the narrator knows
    what concrete visible detail a REVEAL must surface.

    Reads the structured `player_safe_summary` field (preferred) and falls back
    to the legacy `player_visible_anchor` field for old clue-graphs.
    """
    anchors: list[str] = []
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("clue_id") in clue_ids:
                # prefer player_safe_summary (new structured field), fallback to player_visible_anchor
                anchor = clue.get("player_safe_summary") or clue.get("player_visible_anchor")
                if anchor:
                    anchors.append(anchor)
    return anchors


VALID_HORROR_STAGES = {"ordinary", "wrongness", "pattern", "revelation"}


def _current_pacing_entry(ctx: dict[str, Any]) -> dict[str, Any]:
    """Find the pacing-map entry for the active scene. Returns {} if none."""
    active_scene_id = ctx.get("active_scene_id")
    if not active_scene_id:
        return {}
    for entry in ctx.get("pacing_map", {}).get("pacing_curve", []):
        if entry.get("scene_id") == active_scene_id:
            return entry
    return {}


def _retrieve_memory_for_ctx(ctx: dict[str, Any]) -> list[dict[str, Any]]:
    """Retrieve memory cards matching the current scene/intent. Returns [] if no memory layer."""
    if coc_memory is None:
        return []
    campaign_dir = ctx.get("campaign_dir")
    if campaign_dir is None:
        return []
    # query terms: explicit overrides first, else derive from scene + intent
    entities = ctx.get("memory_query_entities") or _derive_memory_entities(ctx)
    cues = ctx.get("memory_query_cues") or [ctx.get("player_intent", "")]
    tags = ctx.get("memory_query_tags") or []
    # Rich-intent enrichment: the player's explicit target entities sharpen
    # memory recall (e.g. "the neighbor" surfaces neighbor-related cards).
    # No-op when rich intent is absent.
    rich = ctx.get("player_intent_rich")
    if rich and not ctx.get("memory_query_entities"):
        for ent in rich.get("target_entities") or []:
            if ent and ent not in entities:
                entities.append(ent)
    cards = coc_memory.retrieve_memory_cards(
        campaign_dir=Path(campaign_dir),
        query_entities=[e for e in entities if e],
        query_cues=[c for c in cues if c],
        query_tags=tags,
        privacy_filter="player_safe",
        limit=5,
    )
    return cards


def _derive_memory_entities(ctx: dict[str, Any]) -> list[str]:
    """Default memory query: active scene id + npc ids + available clue ids."""
    scene = ctx.get("active_scene") or {}
    ents = [ctx.get("active_scene_id", "")]
    ents += scene.get("npc_ids", [])
    ents += scene.get("available_clues", [])
    return [e for e in ents if e]


def _disposition_to_tone(disposition: str) -> str:
    return {"helpful": "warm and cooperative",
            "neutral": "guarded but civil",
            "hostile": "cold and suspicious"}.get(disposition, "neutral")


def _build_npc_moves(ctx: dict[str, Any], action: str) -> list[dict[str, Any]]:
    """Activate NPCs in scene with agenda + disposition from rule signal."""
    scene = ctx.get("active_scene") or {}
    agendas = ctx.get("npc_agendas", {}).get("npcs", [])
    moves = []
    for npc_id in scene.get("npc_ids", []):
        agenda = next((n for n in agendas if n["npc_id"] == npc_id), None)
        if not agenda:
            continue
        reaction = coc_rule_signals.roll_npc_reaction(
            app=ctx["rule_signals"].get("app", 50),
            credit_rating=ctx["rule_signals"].get("credit_rating", 50),
            rng=ctx["rng"],
        ) if action == "CHARACTER" else None
        if reaction is not None and ctx["rule_signals"].get("npc_reaction_roll") is None:
            # Hold the FIRST rolled NPC reaction on the shared rule_signal so the
            # emitted plan reflects at least one reaction (generate_director_plan
            # copies rule_signals verbatim). Per-NPC rolls still live in npc_moves.
            ctx["rule_signals"]["npc_reaction_roll"] = reaction
        moves.append({
            "npc_id": npc_id,
            "agenda": agenda.get("agenda", ""),
            "emotional_tone": _disposition_to_tone(reaction["disposition"]) if reaction else "neutral",
            "secret_limit": f"do not reveal: {', '.join(agenda.get('secret', '').split()[:3])}" if agenda.get("secret") else "",
            "disposition_source": "rule_signal:npc_reaction_roll" if reaction else None,
        })
    return moves


def _build_scene_pressure_move(ctx: dict[str, Any]) -> dict[str, Any] | None:
    scene = ctx.get("active_scene") or {}
    pressure_moves = [move for move in _as_list(scene.get("pressure_moves")) if move]
    if not pressure_moves:
        return None
    count = max(1, int((ctx.get("rule_signals") or {}).get("low_agency_continue_count", 1) or 1))
    raw = pressure_moves[min(count - 1, len(pressure_moves) - 1)]
    if isinstance(raw, dict):
        symptom = (
            raw.get("visible_symptom")
            or raw.get("cue")
            or raw.get("text")
            or raw.get("summary")
            or raw.get("move")
            or "the scene's pressure comes due"
        )
        tick = raw.get("tick", 0)
        try:
            tick = int(tick or 0)
        except (TypeError, ValueError):
            tick = 0
        return {
            "clock_id": raw.get("clock_id"),
            "tick": tick,
            "visible_symptom": _short_text(symptom, 140),
            "reason": "low_agency_scene_pressure",
            "source": "active_scene.pressure_moves",
            "pressure_move_id": raw.get("id"),
        }
    return {
        "clock_id": None,
        "tick": 0,
        "visible_symptom": _short_text(raw, 140),
        "reason": "low_agency_scene_pressure",
        "source": "active_scene.pressure_moves",
    }


def _build_pressure_moves(ctx: dict[str, Any], action: str) -> list[dict[str, Any]]:
    """Tick clocks when PRESSURE or stalled."""
    moves = []
    if action not in ("PRESSURE", "RECOVER") and ctx["rule_signals"]["stalled_turns"] < 1:
        return moves
    if (
        action == "PRESSURE"
        and ctx["rule_signals"].get("low_agency_continue_count", 0) >= 2
        and _scene_pressure_available(ctx)
    ):
        scene_move = _build_scene_pressure_move(ctx)
        if scene_move is not None:
            return [scene_move]
    for front in ctx.get("threat_fronts", {}).get("fronts", []):
        for clock in front.get("clocks", []):
            current = _clock_segments(clock, "current_segments", 0)
            if current < _clock_segments(clock, "segments", 6):
                symptom = clock.get("on_tick_visible", ["tension rises"])
                idx = min(current, len(symptom) - 1) if symptom else 0
                moves.append({
                    "clock_id": clock["clock_id"], "tick": 1,
                    "visible_symptom": symptom[idx] if isinstance(symptom, list) and symptom else "tension rises",
                    "reason": f"stalled_{ctx['rule_signals']['stalled_turns']}_turns" if ctx["rule_signals"]["stalled_turns"] else "pressure_action",
                })
                break
        if moves:
            break
    return moves


def _build_rules_requests(ctx: dict[str, Any], action: str,
                          clue_policy: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Request skill checks only when justified."""
    # Scene-level SAN triggers: when the active scene defines on_enter.san_triggers
    # that haven't fired yet, emit a sanity_check so the driver can settle SAN
    # loss via SanitySession. This makes horror scenes (seeing carnage, witnessing
    # the entity) auto-trigger SAN checks without requiring a stalled player.
    requests: list[dict[str, Any]] = []
    scene = ctx.get("active_scene") or {}
    fired = set(ctx.get("world_state", {}).get("san_triggers_fired", []))
    for trig in (scene.get("on_enter") or {}).get("san_triggers", []) or []:
        if not isinstance(trig, dict):
            continue
        tid = trig.get("trigger_id") or trig.get("source", "")
        if tid and tid in fired:
            continue
        requests.append({
            "kind": "sanity_check", "skill": "SAN",
            "reason": trig.get("source", "scene horror"),
            "difficulty": "regular", "bonus_penalty_dice": 0,
            "san_loss_success": int(trig.get("san_loss_success", 0)),
            "san_loss_fail_expr": str(trig.get("san_loss_fail_expr", "1")),
            "source": trig.get("source", "scene horror"),
            "creature_type": trig.get("creature_type"),
            "san_trigger_id": tid,
        })

    if action == "SUBSYSTEM":
        sig = ctx["rule_signals"]
        if sig["bout_active"] or sig["sanity_state"] == "temp_insane":
            return [{"kind": "sanity_check", "skill": "SAN", "reason": "bout procedure",
                     "difficulty": "regular", "bonus_penalty_dice": 0}]
        if sig["hp_state"] == "dying":
            return [{"kind": "characteristic_check", "skill": "CON", "reason": "death-clock CON roll",
                     "difficulty": "regular", "bonus_penalty_dice": 0}]
    if action == "REVEAL":
        # Only request a skill check when the revealed clue is obscured (its
        # delivery requires a die roll). Obvious clues — Handouts, direct gives,
        # plain location/event descriptions — are delivered by the narrator
        # without a roll. Skill + difficulty come from the structured
        # delivery_kind resolution (falling back to Spot Hidden / regular when
        # the legacy heuristic was used).
        clue_type = (clue_policy or {}).get("clue_type", "obscured")
        if clue_type != "obvious":
            skill = (clue_policy or {}).get("skill") or "Spot Hidden"
            difficulty = (clue_policy or {}).get("difficulty") or "regular"
            requests.append({"kind": "skill_check", "skill": skill, "reason": "obscured clue in scene",
                     "difficulty": difficulty, "bonus_penalty_dice": 0})
    return requests


def generate_director_plan(ctx: dict[str, Any], decision_id: str) -> dict[str, Any]:
    """Produce full DirectorPlan. The core output of the director."""
    action, scores = select_action(ctx)
    overrides = apply_rule_signal_overrides(ctx)
    scene = ctx.get("active_scene") or {}

    # Compute clue_policy once and thread it through to _build_rules_requests so
    # the REVEAL skill-check decision matches the clue_type that lands in the
    # emitted plan (Spec v1.1 gap #1: obvious clues should not roll Spot Hidden).
    clue_policy = _select_clue_policy(ctx, action)
    rules_requests = _build_rules_requests(ctx, action, clue_policy)

    handoff = "narration"
    subsystem = None
    if overrides:
        handoff = overrides.get("handoff", "narration")
        subsystem = overrides.get("subsystem")
    elif action == "SUBSYSTEM":
        handoff = "rules"
    elif action in ("REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT", "MONTAGE", "RECOVER", "PAYOFF"):
        handoff = "rules" if rules_requests else "narration"

    pacing_entry = _current_pacing_entry(ctx)
    # horror stage from pacing-map, validated; fallback to wrongness
    raw_horror = pacing_entry.get("horror_stage", "wrongness")
    horror_stage = raw_horror if raw_horror in VALID_HORROR_STAGES else "wrongness"
    # pacing_mode: prefer pacing-map tension_target; fallback to action-based
    pacing_mode = pacing_entry.get("tension_target")
    if not pacing_mode:
        pacing_mode = "investigation" if action in ("REVEAL", "DEEPEN") else ("pressure" if action == "PRESSURE" else "social")
    # tension_delta: action-driven, but escalation scenes add +1
    tension_delta = 1 if action in ("PRESSURE", "SUBSYSTEM") else (0 if action in ("REVEAL", "DEEPEN", "RECOVER") else -1)
    if pacing_entry.get("tension_target") in ("high", "climax") and action not in ("RECOVER", "MONTAGE"):
        tension_delta = max(tension_delta, 1)

    # Dying (and any future override carrying extra_pressure) forces PRESSURE
    # clock-ticks even though the chosen action is SUBSYSTEM. _build_pressure_moves
    # gates on action ∈ {PRESSURE, RECOVER}, so feed it "PRESSURE" directly here.
    if overrides and overrides.get("extra_pressure"):
        pressure_moves = _build_pressure_moves(ctx, "PRESSURE")
    else:
        pressure_moves = _build_pressure_moves(ctx, action)

    narrative_directives = {
        "tone": scene.get("tone", []),
        "must_include": _collect_anchors(
            clue_policy.get("reveal", []) + clue_policy.get("fallback_routes", []),
            ctx.get("clue_graph", {}),
        ),
        "must_not_reveal": ctx.get("improvisation_boundaries", {}).get("keeper_secrets", []),
        "improvisation_allowed": ctx.get("improvisation_boundaries", {}).get("invent_allowed", []),
        "horror_escalation_stage": horror_stage,
        "content_constraints": ctx.get("module_meta", {}).get("content_flags", []),
        "player_facing_style": _player_facing_style(),
    }

    # v2: populate memory_reads from the memory layer. PAYOFF actions mark the
    # card use as PAYOFF (recalled payoff); everything else is TONE color.
    # memory_writes stays empty here — writeback is decided by the M5 apply layer.
    mem_cards = _retrieve_memory_for_ctx(ctx)
    memory_reads = [
        {"memory_id": c.get("memory_id"), "path": c.get("path"),
         "reason": "entity/scene match", "use": "PAYOFF" if action == "PAYOFF" else "TONE"}
        for c in mem_cards
    ]

    time_advance = _derive_time_advance(action, ctx.get("time_signals", {}))

    return {
        "decision_id": decision_id,
        "turn_input": {
            "player_intent": ctx["player_intent"],
            "player_intent_class": ctx["player_intent_class"],
            "active_scene_id": ctx["active_scene_id"],
            "turn_number": ctx["turn_number"],
        },
        "scene_action": action,
        "subsystem": subsystem,
        "dramatic_question": scene.get("dramatic_question", ""),
        "pacing_mode": pacing_mode,
        "tension_delta": tension_delta,
        "rule_signals": ctx["rule_signals"],
        "time_signals": ctx.get("time_signals", {}),
        "time_advance": time_advance,
        "clue_policy": clue_policy,
        "npc_moves": _build_npc_moves(ctx, action),
        "pressure_moves": pressure_moves,
        "rules_requests": rules_requests,
        "memory_reads": memory_reads,
        "memory_writes": [],
        "narrative_directives": narrative_directives,
        "handoff": handoff,
        "rationale": overrides["rationale"] if overrides else f"top-scored action {action} (score={scores.get(action, 0)})",
    }
