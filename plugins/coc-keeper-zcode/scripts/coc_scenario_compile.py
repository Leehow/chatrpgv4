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


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


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

    clue_graph = _read(scenario_dir / "clue-graph.json")
    for concl in clue_graph.get("conclusions", []):
        if concl.get("importance") == "critical":
            min_routes = concl.get("minimum_routes", 3)
            actual = len(concl.get("clues", []))
            if actual < min_routes:
                errors.append(f"conclusion '{concl.get('conclusion_id')}' critical but only {actual} routes (need >={min_routes})")

    npcs = _read(scenario_dir / "npc-agendas.json")
    for npc in npcs.get("npcs", []):
        if not npc.get("agenda"):
            errors.append(f"npc '{npc.get('npc_id')}' missing agenda")

    improv = _read(scenario_dir / "improvisation-boundaries.json")
    secrets = set(improv.get("keeper_secrets", []))
    # check secrets don't leak into player-safe clue visibility
    clue_graph = _read(scenario_dir / "clue-graph.json")
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("visibility") == "player-safe" and clue.get("clue_id") in secrets:
                errors.append(f"clue '{clue.get('clue_id')}' marked player-safe but is a keeper_secret")

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
