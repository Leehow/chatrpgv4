"""Tests for coc_director_apply: persists DirectorPlan effects to save/logs/memory."""
import importlib.util
import json
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_director_apply = _load("coc_director_apply", "plugins/coc-keeper/scripts/coc_director_apply.py")


def _campaign(tmp_path):
    camp = tmp_path / "campaigns" / "test"
    (camp / "save").mkdir(parents=True)
    (camp / "save" / "investigator-state").mkdir()
    (camp / "logs").mkdir(parents=True)
    (camp / "memory" / "cards" / "player-safe").mkdir(parents=True)
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "test", "discovered_clue_ids": [],
        "active_scene_id": "scene-1"}))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "low", "lethal_chances_used": 0,
        "recent_intent_classes": [], "turn_number": 0, "luck_spent_last": 0}))
    (camp / "logs" / "events.jsonl").write_text("")
    return camp


def test_apply_reveal_adds_clue_to_discovered(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d1", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"]},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}}
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-A" in world["discovered_clue_ids"]
    assert any("clue-A" in e.get("summary", "") or "reveal" in e.get("event_type", "") for e in events)


def test_apply_pressure_updates_pacing_turn(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d2", "scene_action": "PRESSURE",
            "clue_policy": {"reveal": []},
            "pressure_moves": [{"clock_id": "cult-alert", "tick": 1, "visible_symptom": "黑车出现"}],
            "memory_writes": [], "rule_signals": {},
            "narrative_directives": {"horror_escalation_stage": "pattern"}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing["turn_number"] == 1
    assert pacing["tension_level"] == "medium"  # low + 1 pressure tick -> medium


def test_apply_writes_event_to_logs(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d3", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-X"]},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    events_text = (camp / "logs" / "events.jsonl").read_text().strip()
    assert events_text  # non-empty
    assert "clue-X" in events_text


def test_apply_memory_write_creates_card(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d4", "scene_action": "CHARACTER",
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [{"type": "player_interest", "privacy": "player_safe",
                               "salience": 0.7, "entities": ["npc-knott"],
                               "tags": ["npc_relationship"], "summary": "玩家信任诺特",
                               "reactivation_cues": ["knott"]}],
            "rule_signals": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    cards = list((camp / "memory" / "cards" / "player-safe").glob("*.md"))
    assert len(cards) >= 1
    assert "玩家信任诺特" in cards[0].read_text(encoding="utf-8")
