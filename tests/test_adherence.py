"""Tests for narrative adherence checklist (SENNA / Narrative Adherence paper)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HAUNTING = ROOT / "plugins/coc-keeper/references/starter-scenarios/the-haunting"


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_adherence = _load("coc_adherence", "plugins/coc-keeper/scripts/coc_adherence.py")


def test_generate_adherence_checklist_from_haunting():
    checklist = coc_adherence.generate_adherence_checklist(HAUNTING)
    assert checklist, "expected non-empty checklist from the-haunting"
    kinds = {s["kind"] for s in checklist}
    assert "required" in kinds
    assert "optional" in kinds

    by_criterion = {}
    for stmt in checklist:
        assert "statement_id" in stmt
        assert "description" in stmt
        assert stmt["kind"] in {"required", "optional"}
        assert isinstance(stmt["criterion"], dict)
        key = next(iter(stmt["criterion"]))
        by_criterion.setdefault(key, []).append(stmt)

    # Required: conclusion minimum_routes coverage
    conclusion_stmts = [
        s for s in checklist
        if s["kind"] == "required" and "conclusion_id" in s["criterion"]
    ]
    assert conclusion_stmts
    assert any(
        s["criterion"].get("conclusion_id") == "corbitt-buried-in-basement"
        for s in conclusion_stmts
    )

    # Required: reach a terminal/final scene
    terminal_stmts = [
        s for s in checklist
        if s["kind"] == "required" and s["criterion"].get("scene_id")
        and s.get("statement_id", "").startswith("terminal")
    ]
    assert terminal_stmts
    assert any(
        s["criterion"]["scene_id"] == "corbitt-confrontation" for s in terminal_stmts
    )

    # Required: threat-front clock integrity
    clock_stmts = [
        s for s in checklist
        if s["kind"] == "required" and "front_id" in s["criterion"]
    ]
    assert clock_stmts
    assert any(
        s["criterion"].get("front_id") == "corbitt-haunting" for s in clock_stmts
    )

    # Optional: scenes / bonus / npc
    assert any(s["kind"] == "optional" and "scene_id" in s["criterion"] for s in checklist)
    assert any(s["kind"] == "optional" and "bonus_clue_id" in s["criterion"] for s in checklist)
    assert any(s["kind"] == "optional" and "npc_id" in s["criterion"] for s in checklist)


def test_evaluate_adherence_against_synthetic_play_record():
    checklist = coc_adherence.generate_adherence_checklist(HAUNTING)
    # Partial play: some basement-burial clues, no terminal, clocks ok, one optional NPC.
    play = {
        "discovered_clue_ids": [
            "clue-basement-burial-lawsuit",
            "clue-will-executor-chapel",
            "clue-chapel-journal-burial",
        ],
        "visited_scene_ids": [
            "commission-briefing",
            "newspaper-morgue",
            "hall-of-records",
        ],
        "clocks": {
            "corbitt-awareness": {"current_segments": 1, "full": False},
            "landlord-impatience": {"current_segments": 0, "full": False},
        },
        "bonus_rolls_engaged": [],
        "engaged_npc_ids": ["npc-steven-knott"],
    }
    result = coc_adherence.evaluate_adherence(checklist, play)
    assert "statements" in result
    assert "required_coverage" in result
    statements = {s["statement_id"]: s for s in result["statements"]}

    burial = next(
        s for s in result["statements"]
        if s["criterion"].get("conclusion_id") == "corbitt-buried-in-basement"
    )
    assert burial["satisfied"] is True  # 3 clues >= minimum_routes 3

    terminal = next(
        s for s in result["statements"]
        if s["statement_id"].startswith("terminal")
    )
    assert terminal["satisfied"] is False

    knott = next(
        s for s in result["statements"]
        if s["criterion"].get("npc_id") == "npc-steven-knott"
    )
    assert knott["satisfied"] is True

    required = [s for s in result["statements"] if s["kind"] == "required"]
    satisfied_req = sum(1 for s in required if s["satisfied"])
    assert result["required_coverage"] == pytest.approx(satisfied_req / len(required))
    assert 0.0 <= result["required_coverage"] < 1.0


def test_evaluate_adherence_accepts_session_result_shape():
    checklist = [
        {
            "statement_id": "conclusion:c1",
            "kind": "required",
            "criterion": {"conclusion_id": "c1", "clue_ids": ["a", "b"], "minimum_routes": 2},
            "description": "Reach conclusion c1",
        },
        {
            "statement_id": "terminal:end",
            "kind": "required",
            "criterion": {"scene_id": "end"},
            "description": "Reach ending",
        },
    ]
    session_result = {
        "clue_coverage": {"discovered": ["a", "b"]},
        "scene_path": ["start", "end"],
        "final_state": {"discovered_clues": ["a", "b"]},
    }
    result = coc_adherence.evaluate_adherence(checklist, session_result)
    by_id = {s["statement_id"]: s for s in result["statements"]}
    assert by_id["conclusion:c1"]["satisfied"] is True
    assert by_id["terminal:end"]["satisfied"] is True
    assert result["required_coverage"] == 1.0
