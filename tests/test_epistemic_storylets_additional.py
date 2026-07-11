"""Additional schema and compatibility coverage for cognitive storylets."""
import importlib.util
import json
from pathlib import Path

import pytest


def _load(name: str, relative_path: str):
    spec = importlib.util.spec_from_file_location(name, relative_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_storylets = _load(
    "coc_storylets_epistemic_additional_tests",
    "plugins/coc-keeper/scripts/coc_storylets.py",
)


def _base_storylet() -> dict:
    return {
        "storylet_id": "legacy-card",
        "family_id": "legacy",
        "trope_id": "ambient",
        "conflict_level": "low",
        "base_weight": 1.0,
        "serves": {"mainline": True},
        "requires": {},
    }


def test_library_rejects_unknown_question_layer(tmp_path: Path):
    storylet = _base_storylet()
    storylet["epistemic_functions"] = ["confirm"]
    storylet["question_layers"] = ["cosmic_vibes"]
    path = tmp_path / "library.json"
    path.write_text(
        json.dumps({"schema_version": 1, "storylets": [storylet]}),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="question_layers"):
        coc_storylets.load_storylet_library(path)


def test_generic_storylet_remains_eligible_without_epistemic_contract():
    storylet = _base_storylet()
    plan = {
        "scene_action": "REVEAL",
        "clue_policy": {"reveal": ["clue-a"]},
        "narrative_directives": {"horror_escalation_stage": "wrongness"},
        "rule_signals": {},
    }
    ctx = {
        "storylet_policy": {
            "allow_unanchored_storylets": True,
            "lower_conflict_window": 1,
        },
        "active_scene": {
            "scene_type": "investigation",
            "available_clues": ["clue-a"],
        },
        "world_state": {"discovered_clue_ids": []},
        "structure_type": "branching_investigation",
        "module_meta": {},
    }

    assert coc_storylets._matches_context(storylet, plan, ctx, "low") is False
    ctx["storylet_policy"]["ignore_story_need"] = True
    assert coc_storylets._matches_context(storylet, plan, ctx, "low") is True
