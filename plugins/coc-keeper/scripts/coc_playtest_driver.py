#!/usr/bin/env python3
"""Multi-turn playtest driver — runs continuous player→director→rules→apply loops.

Drives a full play session from a sequence of player choices, advancing the
campaign state each turn. Does NOT call an LLM for narration (the DirectorPlan's
narrative_directives are the narrator contract; prose quality is tested separately).
This validates: autonomous scene progression, clue coverage, fail-forward rule
resolution, and tension curve.

Usage:
    python3 coc_playtest_driver.py <campaign_dir> <character_path> <investigator_id> --choices <choices.json>
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import random
import sys
import time
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

_SUCCESS_OUTCOMES = {"critical", "extreme", "hard", "regular", "success",
                     # legacy aliases (some callers may emit *_success forms)
                     "extreme_success", "hard_success", "regular_success"}


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _record_intent_class(campaign_dir: Path, intent_class: str, keep: int = 8) -> None:
    """Persist recent intent classes so stalled_turns is meaningful in drivers."""
    pacing_path = campaign_dir / "save" / "pacing-state.json"
    pacing = apply_mod._read_json(pacing_path, {"tension_level": "low", "turn_number": 0})
    recent = pacing.get("recent_intent_classes", [])
    if not isinstance(recent, list):
        recent = []
    recent.append(intent_class)
    pacing["recent_intent_classes"] = recent[-keep:]
    _write_json(pacing_path, pacing)


def _target_for_request(character: dict[str, Any], request: dict[str, Any]) -> int:
    skill = str(request.get("skill", ""))
    skills = character.get("skills", {}) if isinstance(character.get("skills"), dict) else {}
    characteristics = character.get("characteristics", {}) if isinstance(character.get("characteristics"), dict) else {}
    if skill in skills:
        return int(skills[skill])
    if skill in characteristics:
        return int(characteristics[skill])
    if request.get("kind") == "sanity_check":
        derived = character.get("derived", {}) if isinstance(character.get("derived"), dict) else {}
        return int(derived.get("SAN", characteristics.get("POW", 50)))
    return 50


def _execute_rules_requests(
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    plan: dict[str, Any],
    rng: random.Random,
) -> list[dict[str, Any]]:
    """Execute DirectorPlan.rules_requests and append roll rows.

    This closes the director→rules→apply loop used by D1: apply_plan can now
    decide whether an obscured clue is committed, withheld, or converted into a
    fail-forward cost using actual rule results.
    """
    requests = plan.get("rules_requests", [])
    if not requests:
        return []
    character = json.loads(character_path.read_text(encoding="utf-8"))
    results: list[dict[str, Any]] = []
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rolls_path = campaign_dir / "logs" / "rolls.jsonl"

    for idx, request in enumerate(requests, start=1):
        kind = request.get("kind")
        if kind not in {"skill_check", "characteristic_check", "sanity_check"}:
            continue
        target = _target_for_request(character, request)
        difficulty = str(request.get("difficulty", "regular"))
        bonus_penalty = int(request.get("bonus_penalty_dice", 0) or 0)
        bonus = max(0, bonus_penalty)
        penalty = max(0, -bonus_penalty)
        roll = coc_roll.percentile_check(
            target,
            difficulty=difficulty,
            bonus=bonus,
            penalty=penalty,
            rng=rng,
        )
        payload = {
            "roll_id": f"{plan.get('decision_id', 'turn')}-rule-{idx}",
            "decision_id": plan.get("decision_id"),
            "kind": kind,
            "skill": request.get("skill"),
            "target": target,
            "difficulty": difficulty,
            "reason": request.get("reason"),
            "bonus_penalty_dice": bonus_penalty,
            "roll": roll.get("roll"),
            "effective_target": roll.get("effective_target"),
            "outcome": roll.get("outcome"),
            "success": roll.get("outcome") in _SUCCESS_OUTCOMES,
        }
        results.append(payload)
        _append_jsonl(rolls_path, {
            "type": "roll",
            "actor": investigator_id,
            "payload": payload,
            "ts": ts,
        })
    return results
_OUTCOME_ZH = {
    "critical": "大成功", "extreme": "极限成功", "hard": "困难成功",
    "regular": "常规成功", "failure": "失败", "fumble": "大失败",
}


def _build_narration_skeleton(
    plan: dict[str, Any], rule_results: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a structured narration skeleton from the plan + roll results.

    Surfaces the narrator contract (tone/beats/anchors/roll-weaving/constraints)
    so D3 (narrative immersion) is evaluable even without LLM prose. The
    failure_consequence field (set by backfill_rule_results) is passed through
    separately by the caller; this helper handles the success/general case.
    """
    nd = plan.get("narrative_directives", {})
    action = plan.get("scene_action", "")
    clue_policy = plan.get("clue_policy", {}) or plan.get("resolved_clue_policy", {})
    beats: list[str] = []

    reveal = clue_policy.get("committed_reveals") or clue_policy.get("reveal", [])
    if action == "REVEAL" and reveal:
        anchors = nd.get("must_include", [])
        for i, cid in enumerate(reveal):
            anchor = anchors[i] if i < len(anchors) else ""
            beats.append(f"揭示线索 {cid}：{anchor}" if anchor else f"揭示线索 {cid}")
    elif action == "PRESSURE":
        for mv in plan.get("pressure_moves", []):
            beats.append(f"施压：{mv.get('visible_symptom', 'tension rises')}")
    elif action == "CHARACTER":
        for nm in plan.get("npc_moves", []):
            beats.append(f"NPC {nm.get('npc_id', '?')}：{nm.get('agenda', '?')}，语气 {nm.get('emotional_tone', '?')}")
    elif action == "RECOVER":
        fallback = clue_policy.get("fallback_routes", [])
        beats.append(f"扶手：建议方向 {fallback}" if fallback else "扶手：玩家卡住，给方向")
    elif action == "SUBSYSTEM":
        for req in plan.get("rules_requests", []):
            beats.append(f"规则事件：{req.get('skill', req.get('kind', '?'))} 检定")
    elif action == "CHOICE":
        leads = clue_policy.get("leads", [])
        beats.append(f"给选择：{leads}" if leads else "给玩家方向选择")
    elif action == "CUT":
        beats.append("转场到下一场景")
    elif action == "DEEPEN":
        beats.append("深化谜团但不给结论")

    embedded_rolls = []
    for r in rule_results:
        if not isinstance(r, dict) or r.get("skipped") or "roll" not in r:
            continue
        embedded_rolls.append({
            "skill": r.get("skill", "?"),
            "roll": r["roll"],
            "target": r.get("target"),
            "outcome": r.get("outcome", "?"),
            "narration_hook": f"{r.get('skill', '?')} 检定 {r['roll']}/{r.get('target', '?')} {_OUTCOME_ZH.get(r.get('outcome', ''), r.get('outcome', ''))}",
        })

    return {
        "tone": nd.get("tone", []),
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
    """Run a multi-turn session. Each turn: build context → director plan → rules → apply → record.

    player_choices is a list of {intent, intent_class, signal_overrides?}. If fewer
    choices than max_turns, the last choice repeats. If more, extra are ignored.

    Returns:
        {
            "turns": [{"turn": N, "scene_id": ..., "action": ..., "clue_revealed": ...,
                       "rule_results": [...], "resolved_clue_policy": {...},
                       "failure_consequence": {...}, "tension": ..., "events": [...]}],
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
        choice = player_choices[min(turn_num - 1, len(player_choices) - 1)]
        intent_class = choice.get("intent_class", "investigate")
        _record_intent_class(campaign_dir, str(intent_class))
        ctx = director.build_director_context(
            campaign_dir=campaign_dir, character_path=character_path,
            investigator_id=investigator_id,
            player_intent=choice.get("intent", "..."),
            player_intent_class=str(intent_class),
            rng=rng,
        )
        for k, v in choice.get("signal_overrides", {}).items():
            ctx["rule_signals"][k] = v

        plan = director.generate_director_plan(ctx, decision_id=f"turn-{turn_num:03d}")
        rule_results = _execute_rules_requests(campaign_dir, character_path, investigator_id, plan, rng)
        resolved_plan = apply_mod.backfill_rule_results(plan, rule_results)
        events = apply_mod.apply_plan(campaign_dir, resolved_plan, investigator_id, rules_results=rule_results)

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
        directives = resolved_plan.get("narrative_directives", {})
        narration = _build_narration_skeleton(resolved_plan, rule_results)
        # merge failure_consequence (set by backfill_rule_results) into narration
        if directives.get("failure_consequence"):
            narration["failure_consequence"] = directives["failure_consequence"]

        turns.append({
            "turn": turn_num,
            "scene_id": current_scene,
            "action": resolved_plan["scene_action"],
            "clue_revealed": [e.get("clue_id") for e in events if e.get("event_type") == "clue_reveal"],
            "rule_results": rule_results,
            "resolved_clue_policy": resolved_plan.get("resolved_clue_policy", {}),
            "failure_consequence": directives.get("failure_consequence"),
            "narration": narration,
            "tension": tension,
            "horror_stage": directives.get("horror_escalation_stage"),
            "events_count": len(events),
            "event_types": [e.get("event_type") for e in events],
            "scene_transition": any(e.get("event_type") == "scene_transition" for e in events),
            "dramatic_question": resolved_plan.get("dramatic_question", ""),
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
