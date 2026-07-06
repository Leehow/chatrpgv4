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
coc_roll = _load_sibling("coc_roll", "coc_roll.py")


def _execute_rules_requests(plan: dict, character: dict, rng: random.Random) -> list[dict]:
    """Execute skill_check rules_requests from the plan. Returns roll records.

    For each {kind: "skill_check", skill: "Spot Hidden", difficulty: "regular"}:
    - read the skill value from character["skills"] as target
    - call coc_roll.percentile_check(target, difficulty, rng)
    - record {skill, target, difficulty, roll, outcome, success}

    Skills not found in character default to target 50 (competent amateur).
    Non-skill_check requests (e.g. sanity_check) are skipped (recorded as {kind, skipped: True}).
    """
    results = []
    for req in plan.get("rules_requests", []):
        kind = req.get("kind", "")
        skill = req.get("skill", "")
        if kind == "skill_check":
            skills = character.get("skills", {})
            target = skills.get(skill, 50)
            difficulty = req.get("difficulty", "regular")
            roll_result = coc_roll.percentile_check(target, difficulty=difficulty, rng=rng)
            results.append({
                "kind": "skill_check",
                "skill": skill,
                "target": target,
                "difficulty": difficulty,
                "roll": roll_result["roll"],
                "outcome": roll_result["outcome"],
                "success": roll_result["outcome"] not in ("failure", "fumble"),
                "reason": req.get("reason", ""),
            })
        else:
            results.append({"kind": kind, "skill": skill, "skipped": True,
                            "reason": "non-skill_check not yet wired in driver"})
    return results


def _outcome_zh(outcome: str) -> str:
    """Map outcome enum to Chinese narration hint."""
    return {
        "critical": "大成功",
        "extreme": "极限成功",
        "hard": "困难成功",
        "regular": "常规成功",
        "failure": "失败",
        "fumble": "大失败",
    }.get(outcome, outcome)


def _build_narration_skeleton(plan: dict, roll_results: list[dict]) -> dict:
    """Build a structured narration skeleton from the plan's directives + roll results.

    This is NOT prose — it's the narrator's input contract made visible, so D3
    (narrative immersion) becomes evaluable: can an LLM narrator write good prose
    from this skeleton? Does it have tone/anchors/constraints/roll-weaving?

    Returns:
        {
            "tone": [...],                    # scene atmosphere cues
            "dramatic_question": str,         # scene purpose
            "beats": [str, ...],              # action-driven narration beats
            "must_include": [...],            # anchors narrator must surface
            "must_not_reveal_count": int,     # keeper secrets (count only, don't list)
            "content_constraints": [...],     # safety flags passed through
            "horror_stage": str,
            "embedded_rolls": [...],          # roll results woven into narrative position
        }
    """
    nd = plan.get("narrative_directives", {})
    action = plan.get("scene_action", "")
    beats = []

    # action-driven beats
    clue_policy = plan.get("clue_policy", {})
    if action == "REVEAL" and clue_policy.get("reveal"):
        anchors = nd.get("must_include", [])
        for i, clue_id in enumerate(clue_policy["reveal"]):
            anchor = anchors[i] if i < len(anchors) else "(no anchor)"
            beats.append(f"揭示线索 {clue_id}：{anchor}")
    elif action == "PRESSURE":
        for mv in plan.get("pressure_moves", []):
            beats.append(f"施压：{mv.get('visible_symptom', 'tension rises')}")
    elif action == "CHARACTER":
        for nm in plan.get("npc_moves", []):
            beats.append(f"NPC {nm.get('npc_id','?')}：{nm.get('agenda','?')}，语气 {nm.get('emotional_tone','?')}")
    elif action == "RECOVER":
        fallback = clue_policy.get("fallback_routes", [])
        beats.append(f"扶手：建议方向 {fallback}" if fallback else "扶手：玩家卡住，给方向")
    elif action == "SUBSYSTEM":
        for req in plan.get("rules_requests", []):
            beats.append(f"规则事件：{req.get('skill', req.get('kind','?'))} 检定")
    elif action == "CHOICE":
        leads = clue_policy.get("leads", [])
        beats.append(f"给选择：{leads}" if leads else "给玩家方向选择")
    elif action == "CUT":
        beats.append("转场到下一场景")
    elif action == "DEEPEN":
        beats.append("深化谜团但不给结论")

    # embedded rolls — weave results into narrative-ready format
    embedded_rolls = []
    for r in roll_results:
        if r.get("skipped"):
            continue
        embedded_rolls.append({
            "skill": r["skill"],
            "roll": r["roll"],
            "target": r["target"],
            "outcome": r["outcome"],
            "narration_hook": f"{r['skill']} 检定 {r['roll']}/{r['target']} {_outcome_zh(r['outcome'])}",
        })

    return {
        "tone": nd.get("tone", []),
        "dramatic_question": plan.get("dramatic_question", ""),
        "beats": beats,
        "must_include": nd.get("must_include", []),
        "must_not_reveal_count": len(nd.get("must_not_reveal", [])),
        "content_constraints": nd.get("content_constraints", []),
        "horror_stage": nd.get("horror_escalation_stage", ""),
        "embedded_rolls": embedded_rolls,
    }


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

    # load character once for rules execution (skill values are static per session)
    character = apply_mod._read_json(character_path, {})

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

        # execute rules layer (D1) — roll any skill_check requests
        roll_results = _execute_rules_requests(plan, character, rng)

        # build narration skeleton (D3) — make narrator contract visible
        narration = _build_narration_skeleton(plan, roll_results)

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
            "events_detail": events,  # full events, not just count (D5)
            "scene_transition": any(e.get("event_type") == "scene_transition" for e in events),
            "dramatic_question": plan.get("dramatic_question", ""),  # no truncation (D5 fix)
            "rules_executed": roll_results,  # dice/outcomes (D1)
            "narration": narration,  # narration skeleton (D3)
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
