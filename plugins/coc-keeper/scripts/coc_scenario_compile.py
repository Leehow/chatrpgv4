#!/usr/bin/env python3
"""Story-graph structure validator (compilation Layer 2).

Validates that LLM-compiled scenario story-graph files meet the structural
requirements the director depends on. Run after coc-scenario-import compiles
a module. Reports errors (must fix) and warnings (soft).

Spec: docs/superpowers/specs/2026-07-05-story-director-design.md
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

VALID_STRUCTURE_TYPES = {
    "linear_acts", "time_loop", "branching_investigation", "hub_sandbox",
    "multi_faction", "campaign_sequel", "hybrid_mega",
}
REQUIRED_FILES = [
    "module-meta.json", "story-graph.json", "clue-graph.json",
    "npc-agendas.json", "threat-fronts.json", "pacing-map.json",
    "improvisation-boundaries.json",
]
NON_FRAGILE_DELIVERY_KINDS = {
    "obvious",
    "handout",
    "environmental",
    "npc_dialogue",
    "social",
    "direct",
}


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _is_non_fragile_clue_route(clue: dict[str, Any]) -> bool:
    kind = clue.get("delivery_kind")
    if kind in NON_FRAGILE_DELIVERY_KINDS:
        return True
    if kind == "skill_check":
        return False
    if clue.get("fallback_route") or clue.get("recoverable") is True:
        return True
    return False


def _has_recoverable_fallback(conclusion: dict[str, Any]) -> bool:
    if conclusion.get("fallback_policy"):
        return True
    for key in ("fallback_routes", "recover_routes"):
        if conclusion.get(key):
            return True
    return any(
        clue.get("fallback_route") or clue.get("recoverable") is True
        for clue in conclusion.get("clues", [])
        if isinstance(clue, dict)
    )


def validate_scenario(scenario_dir: Path) -> dict[str, list[str]]:
    """Validate a compiled story-graph. Returns {'errors': [...], 'warnings': [...]}."""
    errors: list[str] = []
    warnings: list[str] = []

    for fname in REQUIRED_FILES:
        if not (scenario_dir / fname).exists():
            errors.append(f"missing required file: {fname}")
    if errors:
        return {"errors": errors, "warnings": warnings}

    meta = _read(scenario_dir / "module-meta.json")
    if meta.get("structure_type") not in VALID_STRUCTURE_TYPES:
        errors.append(f"module-meta.structure_type '{meta.get('structure_type')}' not in {sorted(VALID_STRUCTURE_TYPES)}")

    story = _read(scenario_dir / "story-graph.json")
    for scene in story.get("scenes", []):
        if not scene.get("dramatic_question"):
            errors.append(f"scene '{scene.get('scene_id')}' missing dramatic_question")
        if not scene.get("scene_id"):
            errors.append("scene missing scene_id")
        # 软警告：social/investigation 场景宜有多路线 affordances（P0-1 数据引导）
        scene_type = str(scene.get("scene_type") or "")
        if scene_type in ("social", "investigation"):
            affordances = scene.get("affordances") or []
            if not isinstance(affordances, list) or len(affordances) < 2:
                warnings.append(
                    f"scene '{scene.get('scene_id')}' ({scene_type}) has fewer than 2 "
                    f"affordances; multi-route fork hints recommended so players have choices"
                )
        # on_enter warnings: validate structure when present (soft, backward-compat).
        on_enter = scene.get("on_enter")
        if isinstance(on_enter, dict):
            for trig in (on_enter.get("san_triggers") or []):
                if isinstance(trig, dict) and not trig.get("san_loss_fail_expr"):
                    warnings.append(f"scene '{scene.get('scene_id')}' san_trigger missing san_loss_fail_expr")
            for ct in (on_enter.get("clock_ticks") or []):
                if isinstance(ct, dict) and not ct.get("clock_id"):
                    warnings.append(f"scene '{scene.get('scene_id')}' clock_tick missing clock_id")

    clue_graph = _read(scenario_dir / "clue-graph.json")
    for concl in clue_graph.get("conclusions", []):
        if concl.get("importance") == "critical":
            min_routes = concl.get("minimum_routes", 3)
            actual = len(concl.get("clues", []))
            if actual < min_routes:
                errors.append(f"conclusion '{concl.get('conclusion_id')}' critical but only {actual} routes (need >={min_routes})")
            non_fragile = [clue for clue in concl.get("clues", []) if _is_non_fragile_clue_route(clue)]
            if not non_fragile and not _has_recoverable_fallback(concl):
                errors.append(
                    f"conclusion '{concl.get('conclusion_id')}' critical but has no non-fragile route or RECOVER fallback"
                )
            for clue in concl.get("clues", []):
                if not clue.get("delivery_kind"):
                    warnings.append(
                        f"clue '{clue.get('clue_id')}' in critical conclusion '{concl.get('conclusion_id')}' uses legacy delivery without delivery_kind"
                    )

    npcs = _read(scenario_dir / "npc-agendas.json")
    for npc in npcs.get("npcs", []):
        if not npc.get("agenda"):
            errors.append(f"npc '{npc.get('npc_id')}' missing agenda")

    fronts_data = _read(scenario_dir / "threat-fronts.json")
    improv = _read(scenario_dir / "improvisation-boundaries.json")
    secrets = set(improv.get("keeper_secrets", []))
    # check secrets don't leak into player-safe clue visibility
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("visibility") == "player-safe" and clue.get("clue_id") in secrets:
                errors.append(f"clue '{clue.get('clue_id')}' marked player-safe but is a keeper_secret")

    # --- Structured delivery field warnings (clue-graph) ---
    # These are warnings (not errors) so old clue-graphs without the new
    # delivery_kind / source_refs fields still validate cleanly. Only flag
    # scenarios that opt into the structured fields but fill them in malformed.
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            dk = clue.get("delivery_kind")
            if dk == "skill_check" and not clue.get("skill"):
                warnings.append(f"clue '{clue.get('clue_id')}' has delivery_kind=skill_check but no skill")
            for ref in clue.get("source_refs", []) or []:
                if not ref.get("path") or not isinstance(ref.get("page"), int):
                    warnings.append(f"clue '{clue.get('clue_id')}' source_ref missing path or integer page")

    # source_refs warnings on scenes/npcs/fronts
    for scene in story.get("scenes", []):
        for ref in scene.get("source_refs", []) or []:
            if not ref.get("path") or not isinstance(ref.get("page"), int):
                warnings.append(f"scene '{scene.get('scene_id')}' source_ref missing path or integer page")
    for npc in npcs.get("npcs", []):
        for ref in npc.get("source_refs", []) or []:
            if not ref.get("path") or not isinstance(ref.get("page"), int):
                warnings.append(f"npc '{npc.get('npc_id')}' source_ref missing path or integer page")
    for front in fronts_data.get("fronts", []):
        for ref in front.get("source_refs", []) or []:
            if not ref.get("path") or not isinstance(ref.get("page"), int):
                warnings.append(f"front '{front.get('front_id')}' source_ref missing path or integer page")

    # horror_stage monotonicity check on pacing-map.pacing_curve.
    # Stages should broadly advance ordinary->wrongness->pattern->revelation.
    # A scene may stay at the same stage or advance; a minor dip of 1 is
    # acceptable, but a regression of more than 1 from the max rank reached
    # so far (e.g. revelation back to ordinary) is an error.
    stage_rank = {"ordinary": 0, "wrongness": 1, "pattern": 2, "revelation": 3}
    pacing_path = scenario_dir / "pacing-map.json"
    if pacing_path.exists():
        pacing = _read(pacing_path)
        curve = pacing.get("pacing_curve")
        if isinstance(curve, list):
            max_rank = -1
            max_stage = None
            for entry in curve:
                stage = entry.get("horror_stage")
                rank = stage_rank.get(stage)
                if rank is None:
                    continue  # unknown stage; not this check's concern
                if max_rank >= 0 and rank < max_rank - 1:
                    errors.append(
                        f"pacing-map horror_stage regressed: scene '{entry.get('scene_id')}' "
                        f"is '{stage}' after reaching '{max_stage}'"
                    )
                if rank > max_rank:
                    max_rank = rank
                    max_stage = stage

    return {"errors": errors, "warnings": warnings}


def _main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        prog="coc_scenario_compile.py",
        description="Validate a compiled scenario story-graph (compilation Layer 2).",
    )
    parser.add_argument("scenario_dir", help="path to the compiled scenario directory")
    parser.add_argument(
        "--validate",
        action="store_true",
        help="always validates (accepted for documentation consistency with SKILL.md)",
    )
    args = parser.parse_args()

    result = validate_scenario(Path(args.scenario_dir))
    errors = result.get("errors", [])
    warnings = result.get("warnings", [])

    for w in warnings:
        print(f"WARNING: {w}")
    for e in errors:
        print(f"ERROR: {e}")

    if errors:
        return 1
    print("OK: scenario story-graph valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
