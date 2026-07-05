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


def _read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def build_director_context(
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    player_intent: str,
    player_intent_class: str,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """Assemble DirectorContext: rule signals + active scene + scenario graph.

    Read-only. Pulls investigator-state, character, world-state, flags,
    pacing-state, and the 7 scenario story-graph files.
    """
    rng = rng or random.Random()
    save = campaign_dir / "save"
    scenario = campaign_dir / "scenario"

    inv_state = _read_json(save / "investigator-state" / f"{investigator_id}.json", {})
    character = _read_json(character_path, {})
    world = _read_json(save / "world-state.json", {})
    pacing = _read_json(save / "pacing-state.json", {})
    module_meta = _read_json(scenario / "module-meta.json", {})
    story_graph = _read_json(scenario / "story-graph.json", {"scenes": []})

    # --- rule signals ---
    char_derived = character.get("derived", {})
    char_chars = character.get("characteristics", {})
    char_skills = character.get("skills", {})
    conditions = inv_state.get("conditions", []) or []
    current_hp = inv_state.get("current_hp", char_derived.get("HP", 10))
    max_hp = char_derived.get("HP", 10)
    current_san = inv_state.get("current_san", char_derived.get("SAN", 50))
    max_san = 99  # simplified; spec's believer-bomb is v2
    credit_rating = char_skills.get("Credit Rating", 0)
    app = char_chars.get("APP", 50)
    luck = char_chars.get("LUCK", 50)

    recent_intents = pacing.get("recent_intent_classes", [])
    rule_signals = {
        "hp_state": coc_rule_signals.read_hp_state(current_hp, max_hp, conditions),
        "sanity_state": coc_rule_signals.read_sanity_state(
            current_san, max_san,
            bout_active="bout_active" in conditions,
            lost_this_event=inv_state.get("san_lost_this_event", 0),
        ),
        "credit_tier": coc_rule_signals.read_credit_tier(credit_rating),
        "npc_reaction_roll": None,  # populated per-NPC at scoring time
        "luck_level": coc_rule_signals.read_luck_signal(luck, pacing.get("luck_spent_last", 0))[0],
        "luck_spent_last": pacing.get("luck_spent_last", 0) > 0,
        "last_roll_critical": False,
        "last_roll_fumble": False,
        "active_conditions": conditions,
        "stalled_turns": coc_rule_signals.read_stalled_turns(recent_intents),
        "tension_clock": coc_rule_signals.read_tension_clock(
            pacing.get("tension_level", "low"), pacing.get("lethal_chances_used", 0),
        ),
        "bout_active": "bout_active" in conditions,
    }

    # --- active scene ---
    active_scene_id = world.get("active_scene_id")
    scenes = story_graph.get("scenes", [])
    active_scene = next((s for s in scenes if s["scene_id"] == active_scene_id), None)

    return {
        "campaign_dir": campaign_dir,
        "investigator_id": investigator_id,
        "player_intent": player_intent,
        "player_intent_class": player_intent_class,
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
        "rng": rng,
        "turn_number": pacing.get("turn_number", 0),
    }


def write_director_plan(plan: dict[str, Any], artifacts_dir: Path) -> Path:
    """Persist DirectorPlan to artifacts/<decision_id>.json. Returns path."""
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / f"{plan['decision_id']}.json"
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out
