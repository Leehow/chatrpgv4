from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


def _load():
    path = Path("plugins/coc-keeper/scripts/coc_playtest_coverage.py")
    spec = importlib.util.spec_from_file_location("coc_playtest_coverage_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coverage = _load()


def _write(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def _scenario(tmp_path: Path) -> Path:
    root = tmp_path / "scenario"
    root.mkdir()
    _write(root / "module-meta.json", {
        "schema_version": 1,
        "scenario_id": "coverage-demo",
        "conclusion_rewards": [{
            "reward_id": "survival",
            "conclusion_id": "truth",
            "reward_kind": "survival",
            "source": "conclusion_rewards",
        }],
    })
    _write(root / "story-graph.json", {
        "schema_version": 1,
        "scenes": [
            {
                "scene_id": "start",
                "is_start": True,
                "scene_edges": [{"edge_id": "to-end", "to": "end", "kind": "lead"}],
                "affordances": [{"id": "search", "route_type": "investigation", "clue_id": "clue-a"}],
            },
            {
                "scene_id": "end",
                "scene_edges": [],
                "conclusion_contract": {"conclusion_id": "truth"},
            },
        ],
    })
    _write(root / "clue-graph.json", {
        "schema_version": 1,
        "conclusions": [{
            "conclusion_id": "truth",
            "minimum_routes": 1,
            "clues": [{"clue_id": "clue-a", "delivery_kind": "automatic"}],
        }],
    })
    _write(root / "npc-agendas.json", {
        "schema_version": 1,
        "npcs": [{"npc_id": "witness"}],
    })
    return root


def _observation(plan: dict, *, run_id: str, status: str) -> dict:
    row = {
        "schema_version": 1,
        "kind": coverage.OBSERVATION_KIND,
        "purpose": "post_run_test_observation",
        "narrative_gate": False,
        "plan_sha256": plan["plan_sha256"],
        "scenario_id": plan["scenario"]["scenario_id"],
        "source_bundle_sha256": plan["scenario"]["source_bundle_sha256"],
        "run": {
            "run_id": run_id,
            "run_evidence_sha256": "a" * 64,
            "evidence_files": [],
        },
        "target_observations": {
            category: [
                {
                    "target_id": target["target_id"],
                    "status": status,
                    "evidence_refs": [] if status != "observed" else ["fixture#1"],
                }
                for target in plan["targets"][category]
            ]
            for category in coverage.TARGET_CATEGORIES
        },
    }
    row["observation_sha256"] = coverage._canonical_sha256(row)
    return row


def test_plan_is_private_evaluator_only_and_structured(tmp_path: Path):
    plan = coverage.generate_plan(_scenario(tmp_path))

    assert plan["kind"] == coverage.PLAN_KIND
    assert plan["narrative_gate"] is False
    assert plan["live_turn_integration"] is False
    assert plan["scenario"]["scenario_id"] == "coverage-demo"
    assert {row["scene_id"] for row in plan["targets"]["scenes"]} == {"start", "end"}
    assert plan["targets"]["side_branches"][0]["affordance_id"] == "search"
    assert plan["targets"]["clue_routes"][0]["clue_id"] == "clue-a"


def test_incomplete_aggregate_is_evidence_not_a_narrative_gate(tmp_path: Path):
    plan = coverage.generate_plan(_scenario(tmp_path))
    aggregate = coverage.aggregate_observations(
        plan, [_observation(plan, run_id="lane-1", status="not_observed")]
    )

    assert aggregate["kind"] == coverage.AGGREGATE_KIND
    assert aggregate["narrative_gate"] is False
    assert aggregate["complete"] is False
    assert aggregate["uncovered_reachable_target_ids"]


def test_coverage_contract_rejects_stale_schema_without_migration(tmp_path: Path):
    plan = coverage.generate_plan(_scenario(tmp_path))
    plan["schema_version"] = 0
    with pytest.raises(coverage.CoverageContractError, match="unsupported coverage schema"):
        coverage.aggregate_observations(
            plan, [_observation(plan, run_id="lane-1", status="observed")]
        )
