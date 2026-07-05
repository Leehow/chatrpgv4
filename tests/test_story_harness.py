"""Tests for coc_story_harness: GM-quality assertion engine."""
import importlib.util
import json
from pathlib import Path

import pytest

def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

coc_story_harness = _load("coc_story_harness", "plugins/coc-keeper/scripts/coc_story_harness.py")
coc_story_director = _load("coc_story_director", "plugins/coc-keeper/scripts/coc_story_director.py")


def _make_campaign_with_fumble(tmp_path, fumble=False):
    """Reuse a minimal campaign; reuse test_story_director's helper pattern."""
    camp = tmp_path / "campaigns" / "h"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "scenario").mkdir(parents=True)
    (camp / "save" / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version":1,"campaign_id":"h","investigator_id":"inv1",
        "current_hp":12,"current_san":55,"current_mp":11,"conditions":[],"skill_checks_earned":[]}))
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version":1,"campaign_id":"h","scenario_id":"m","status":"active",
        "active_scene_id":"s1","active_subsystem":"play","current_phase":"mid",
        "discovered_clue_ids":[],"major_decisions":[]}))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version":1,"tension_level":"low","lethal_chances_used":0,"recent_intent_classes":[]}))
    (camp / "save" / "flags.json").write_text(json.dumps({"schema_version":1,"clues_found":{},"decisions":[]}))
    (camp / "scenario" / "module-meta.json").write_text(json.dumps(
        {"schema_version":1,"scenario_id":"m","structure_type":"branching_investigation","era":"1920s","content_flags":[],"win_condition":"x"}))
    (camp / "scenario" / "story-graph.json").write_text(json.dumps({"scenes":[
        {"scene_id":"s1","scene_type":"investigation","dramatic_question":"q?",
         "entry_conditions":[],"exit_conditions":[],"available_clues":["c1"],
         "npc_ids":[],"pressure_moves":[],"tone":[],"allowed_improvisation":[]}]}))
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps({"conclusions":[]}))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({"npcs":[]}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({"fronts":[]}))
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps({"pacing_curve":[]}))
    (camp / "scenario" / "improvisation-boundaries.json").write_text(json.dumps(
        {"invent_allowed":[],"never_invent":[],"keeper_secrets":["secret-1"]}))
    cdir = tmp_path / "investigators" / "inv1"; cdir.mkdir(parents=True)
    (cdir / "character.json").write_text(json.dumps({
        "schema_version":1,"id":"inv1","occupation":"Antiquarian","era":"1920s",
        "characteristics":{"APP":45,"LUCK":55},"derived":{"HP":12,"SAN":55},
        "skills":{"Credit Rating":50,"Spot Hidden":60},"backstory":{}}))
    return camp, cdir / "character.json"


def test_assert_keeper_secret_not_revealed(tmp_path):
    camp, char = _make_campaign_with_fumble(tmp_path)
    import random
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "d1")
    findings = coc_story_harness.assert_plan(plan)
    # secret-1 must be in must_not_reveal
    assert findings["safety_keeper_secret_isolated"]["passed"] is True

def test_assert_fumble_produces_pressure(tmp_path):
    camp, char = _make_campaign_with_fumble(tmp_path)
    import random
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate", rng=random.Random(42))
    ctx["rule_signals"]["last_roll_fumble"] = True
    plan = coc_story_director.generate_director_plan(ctx, "d2")
    findings = coc_story_harness.assert_plan(plan)
    assert findings["agency_fumble_pressure"]["passed"] is True

def test_assert_rules_fidelity_dying(tmp_path):
    camp, char = _make_campaign_with_fumble(tmp_path)
    inv = json.loads((camp/"save"/"investigator-state"/"inv1.json").read_text())
    inv["current_hp"] = 0; inv["conditions"] = ["major_wound","dying"]
    (camp/"save"/"investigator-state"/"inv1.json").write_text(json.dumps(inv))
    import random
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "d3")
    findings = coc_story_harness.assert_plan(plan)
    assert findings["rules_fidelity_override"]["passed"] is True
