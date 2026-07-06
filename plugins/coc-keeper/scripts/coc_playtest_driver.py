#!/usr/bin/env python3
"""Multi-turn playtest driver — runs continuous player→director→apply loops.

Drives a full play session from a sequence of player choices, advancing the
campaign state each turn. Does NOT call an LLM for narration (the DirectorPlan's
narrative_directives are the narrator contract; prose quality is tested separately).
This validates: autonomous scene progression, clue coverage, tension curve.

Usage:
    python3 coc_playtest_driver.py <campaign_dir> <character_path> <investigator_id> --choices <choices.json>
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import random
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    m = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(m)
    return m


director = _load_sibling("coc_story_director", "coc_story_director.py")
apply_mod = _load_sibling("coc_director_apply", "coc_director_apply.py")


def run_full_session(
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    player_choices: list[dict[str, Any]],
    max_turns: int = 20,
    rng_seed: int = 42,
) -> dict[str, Any]:
    """Run a multi-turn session. Each turn: build context → director plan → apply → record.

    player_choices is a list of {intent, intent_class, signal_overrides?}. If fewer
    choices than max_turns are given, remaining turns use idle intent (so the stalled
    recovery valve can engage). If more, extra are ignored.

    Returns:
        {
            "turns": [{"turn": N, "scene_id": ..., "action": ..., "clue_revealed": ...,
                       "tension": ..., "events": [...], "narrative_directives": {...}}],
            "final_state": {"active_scene": ..., "discovered_clues": [...], "tension": ...},
            "clue_coverage": {"discovered_count": N, "total_in_graph": M},
            "tension_curve": [list of tension per turn],
            "scene_path": [list of scene_id visited in order],
            "reached_terminal": bool,
        }
    """
    rng = random.Random(rng_seed)
    turns = []
    tension_curve = []
    scene_path = []

    # count total clues in graph for coverage stat
    story = apply_mod._read_json(campaign_dir / "scenario" / "story-graph.json", {"scenes": []})
    clue_graph = apply_mod._read_json(campaign_dir / "scenario" / "clue-graph.json", {"conclusions": []})
    total_clues = set()
    for concl in clue_graph.get("conclusions", []):
        for cl in concl.get("clues", []):
            total_clues.add(cl.get("clue_id"))
    scene_ids = [s["scene_id"] for s in story.get("scenes", [])]

    for turn_num in range(1, max_turns + 1):
        if turn_num - 1 < len(player_choices):
            choice = player_choices[turn_num - 1]
        else:
            choice = {"intent": "(no further instruction)", "intent_class": "idle"}
        ctx = director.build_director_context(
            campaign_dir=campaign_dir, character_path=character_path,
            investigator_id=investigator_id,
            player_intent=choice.get("intent", "..."),
            player_intent_class=choice.get("intent_class", "investigate"),
            rng=rng,
        )
        for k, v in choice.get("signal_overrides", {}).items():
            ctx["rule_signals"][k] = v

        plan = director.generate_director_plan(ctx, decision_id=f"turn-{turn_num:03d}")
        events = apply_mod.apply_plan(campaign_dir, plan, investigator_id)

        # record
        current_scene = ctx.get("active_scene_id", "?")
        if not scene_path or scene_path[-1] != current_scene:
            scene_path.append(current_scene)

        # read post-apply state
        world = apply_mod._read_json(campaign_dir / "save" / "world-state.json", {})
        pacing = apply_mod._read_json(campaign_dir / "save" / "pacing-state.json", {})
        discovered = world.get("discovered_clue_ids", [])
        tension = pacing.get("tension_level", "low")
        tension_curve.append(tension)

        turns.append({
            "turn": turn_num,
            "scene_id": current_scene,
            "intent_class": choice.get("intent_class", "investigate"),
            "action": plan["scene_action"],
            "clue_revealed": plan.get("clue_policy", {}).get("reveal", []),
            "tension": tension,
            "horror_stage": plan.get("narrative_directives", {}).get("horror_escalation_stage"),
            "events_count": len(events),
            "scene_transition": any(e.get("event_type") == "scene_transition" for e in events),
            "dramatic_question": plan.get("dramatic_question", "")[:80],
        })

        # check terminal: reached last scene
        active = world.get("active_scene_id")
        if scene_ids and active == scene_ids[-1]:
            # on last scene; if its clues exhausted or it's aftermath-type, done
            last_scene = next((s for s in story.get("scenes", []) if s["scene_id"] == active), {})
            last_clues = last_scene.get("available_clues", [])
            if not last_clues or all(c in discovered for c in last_clues):
                break

    discovered_final = apply_mod._read_json(campaign_dir / "save" / "world-state.json", {}).get("discovered_clue_ids", [])
    return {
        "turns": turns,
        "final_state": {
            "active_scene": apply_mod._read_json(campaign_dir / "save" / "world-state.json", {}).get("active_scene_id"),
            "discovered_clues": discovered_final,
            "tension": apply_mod._read_json(campaign_dir / "save" / "pacing-state.json", {}).get("tension_level"),
        },
        "clue_coverage": {
            "discovered_count": len(discovered_final),
            "total_in_graph": len(total_clues),
            "discovered": discovered_final,
        },
        "tension_curve": tension_curve,
        "scene_path": scene_path,
        "reached_terminal": scene_path[-1] == scene_ids[-1] if scene_path and scene_ids else False,
    }


def _main() -> int:
    ap = argparse.ArgumentParser(description="Multi-turn playtest driver")
    ap.add_argument("campaign_dir", help="path to campaign directory")
    ap.add_argument("character_path", help="path to character.json")
    ap.add_argument("investigator_id", help="investigator id")
    ap.add_argument("--choices", required=True, help="JSON file with player choices list")
    ap.add_argument("--max-turns", type=int, default=20)
    ap.add_argument("--rng-seed", type=int, default=42)
    ap.add_argument("-o", "--output", help="write session report JSON to this path")
    args = ap.parse_args()

    choices = json.loads(Path(args.choices).read_text(encoding="utf-8"))
    result = run_full_session(
        Path(args.campaign_dir), Path(args.character_path), args.investigator_id,
        choices, max_turns=args.max_turns, rng_seed=args.rng_seed,
    )

    if args.output:
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote session report to {args.output}", file=sys.stderr)

    # print summary
    print(f"Turns: {len(result['turns'])}")
    print(f"Scene path: {' → '.join(result['scene_path'])}")
    print(f"Clue coverage: {result['clue_coverage']['discovered_count']}/{result['clue_coverage']['total_in_graph']}")
    print(f"Tension curve: {result['tension_curve']}")
    print(f"Reached terminal: {result['reached_terminal']}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
