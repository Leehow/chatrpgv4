"""Tests for coc_playtest_driver: multi-turn session runner."""
import importlib.util
import json
import shutil
from pathlib import Path

import pytest

def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

driver = _load("coc_playtest_driver", "plugins/coc-keeper/scripts/coc_playtest_driver.py")


def _build_mini_campaign(tmp_path):
    """Build a 3-scene campaign for multi-turn testing."""
    camp = tmp_path / "campaigns" / "drive"
    scn = camp / "scenario"; save = camp / "save"
    save.mkdir(parents=True); (save / "investigator-state").mkdir(); scn.mkdir(parents=True)
    (save / "world-state.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "drive", "active_scene_id": "scene-1",
        "discovered_clue_ids": [], "major_decisions": []}))
    (save / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "low", "lethal_chances_used": 0,
        "recent_intent_classes": [], "turn_number": 0, "luck_spent_last": 0}))
    (save / "flags.json").write_text(json.dumps({"schema_version": 1, "clues_found": {}, "decisions": []}))
    (save / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "drive", "investigator_id": "inv1",
        "current_hp": 12, "current_san": 55, "current_mp": 11, "conditions": [], "skill_checks_earned": []}))
    char_dir = tmp_path / "investigators" / "inv1"; char_dir.mkdir(parents=True)
    (char_dir / "character.json").write_text(json.dumps({
        "schema_version": 1, "id": "inv1", "occupation": "Antiquarian", "era": "1920s",
        "characteristics": {"APP":45,"LUCK":55}, "derived": {"HP":12,"SAN":55},
        "skills": {"Credit Rating":50,"Spot Hidden":60,"Library Use":55}, "backstory": {}}))
    # 3 scenes, each with 1 clue
    (scn / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "scene-1", "available_clues": ["c1"], "dramatic_question": "q1",
         "entry_conditions": [], "exit_conditions": [], "tone": ["tense"], "allowed_improvisation": []},
        {"scene_id": "scene-2", "available_clues": ["c2"], "dramatic_question": "q2",
         "entry_conditions": [], "exit_conditions": [], "tone": ["tense"], "allowed_improvisation": []},
        {"scene_id": "scene-3", "available_clues": ["c3"], "dramatic_question": "q3",
         "entry_conditions": [], "exit_conditions": [], "tone": ["tense"], "allowed_improvisation": []},
    ]}))
    (scn / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "cc1", "importance": "critical", "minimum_routes": 3,
         "clues": [{"clue_id":"c1","delivery":"x","visibility":"player-safe"},
                   {"clue_id":"c2","delivery":"y","visibility":"player-safe"},
                   {"clue_id":"c3","delivery":"z","visibility":"player-safe"}],
         "fallback_policy": ""}]}))
    (scn / "npc-agendas.json").write_text(json.dumps({"npcs": []}))
    (scn / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (scn / "pacing-map.json").write_text(json.dumps({"pacing_curve": [
        {"scene_id": "scene-1", "tension_target": "low", "horror_stage": "ordinary"},
        {"scene_id": "scene-2", "tension_target": "medium", "horror_stage": "wrongness"},
        {"scene_id": "scene-3", "tension_target": "high", "horror_stage": "revelation"}]}))
    (scn / "improvisation-boundaries.json").write_text(json.dumps(
        {"invent_allowed": [], "never_invent": [], "keeper_secrets": ["secret-1"]}))
    (scn / "module-meta.json").write_text(json.dumps(
        {"schema_version":1,"scenario_id":"drive","structure_type":"linear_acts","era":"1920s","content_flags":[],"win_condition":"x"}))
    return camp, char_dir / "character.json"


def test_driver_advances_through_scenes(tmp_path):
    """Driver should advance scene-1 → scene-2 → scene-3 as clues get discovered."""
    camp, char_path = _build_mini_campaign(tmp_path)
    result = driver.run_full_session(
        camp, char_path, "inv1",
        player_choices=[{"intent": "search", "intent_class": "investigate"}] * 10,
        max_turns=10,
    )
    assert len(result["scene_path"]) >= 2  # advanced at least once
    assert result["scene_path"][0] == "scene-1"
    assert result["reached_terminal"] is True  # reached scene-3


def test_driver_records_clue_coverage(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    result = driver.run_full_session(
        camp, char_path, "inv1",
        player_choices=[{"intent": "search", "intent_class": "investigate"}] * 10,
        max_turns=10,
    )
    assert result["clue_coverage"]["discovered_count"] >= 1
    assert result["clue_coverage"]["total_in_graph"] == 3


def test_driver_tension_curve_recorded(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    result = driver.run_full_session(
        camp, char_path, "inv1",
        player_choices=[{"intent": "search", "intent_class": "investigate"}] * 5,
        max_turns=5,
    )
    assert len(result["tension_curve"]) == len(result["turns"])
    assert all(t in ("low", "medium", "high", "climax") for t in result["tension_curve"])
