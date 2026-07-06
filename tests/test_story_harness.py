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

def test_memory_continuity_recalls_earlier_interest(tmp_path):
    """Director writes a memory card in turn 1, recalls it in turn 2 when entity matches.

    End-to-end memory continuity drill: the apply layer (coc_director_apply)
    persists a memory_write to disk in turn 1, and the director's memory
    retrieval (wired in Task 4) surfaces it as a memory_read in turn 2 when
    the query entities/cues overlap.
    """
    import importlib.util, random
    # load apply + memory
    spec_mem = importlib.util.spec_from_file_location("coc_memory_apply", "plugins/coc-keeper/scripts/coc_memory.py")
    coc_memory = importlib.util.module_from_spec(spec_mem); spec_mem.loader.exec_module(coc_memory)
    spec_apply = importlib.util.spec_from_file_location("coc_apply", "plugins/coc-keeper/scripts/coc_director_apply.py")
    coc_director_apply = importlib.util.module_from_spec(spec_apply); spec_apply.loader.exec_module(coc_director_apply)

    camp, char_path = _make_campaign_with_fumble(tmp_path)
    # ensure memory dirs
    (camp / "memory" / "cards" / "player-safe").mkdir(parents=True, exist_ok=True)

    # turn 1: director plan with a memory_write about a door
    plan1 = {"decision_id": "turn-1", "scene_action": "REVEAL",
             "clue_policy": {"reveal": []}, "pressure_moves": [],
             "memory_writes": [{"type": "player_interest", "privacy": "player_safe",
                                "salience": 0.8, "entities": ["front-door"],
                                "tags": ["player_interest"], "summary": "玩家关注门划痕",
                                "reactivation_cues": ["door"]}],
             "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan1, investigator_id="inv1")

    # turn 2: director asked about a door -> should recall
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="检查后门", player_intent_class="investigate", rng=random.Random(7))
    ctx["memory_query_entities"] = ["front-door"]
    ctx["memory_query_cues"] = ["door"]
    plan2 = coc_story_director.generate_director_plan(ctx, "turn-2")
    assert len(plan2["memory_reads"]) >= 1
    # The recalled card must be the door-interest card written in turn 1.
    # memory_reads carries {memory_id, path, reason, use}; confirm the card
    # file on disk actually contains the door entity we wrote.
    recalled_paths = [r.get("path") for r in plan2["memory_reads"] if r.get("path")]
    recalled_bodies = [Path(p).read_text(encoding="utf-8") for p in recalled_paths]
    assert any("front-door" in body and "门" in body for body in recalled_bodies), \
        f"recalled card did not contain door entity: {recalled_bodies}"


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


def test_safety_content_boundary_missing_field_fails(tmp_path):
    """A plan whose narrative_directives lacks content_constraints FAILS the
    safety_content_boundary check (the field should always exist)."""
    plan = {"scene_action": "REVEAL", "rule_signals": {},
            "narrative_directives": {"must_not_reveal": []},
            "clue_policy": {"reveal": []}}
    findings = coc_story_harness.assert_plan(plan)
    assert findings["safety_content_boundary"]["passed"] is False
    assert "MISSING" in findings["safety_content_boundary"]["detail"]


def test_safety_content_boundary_empty_list_passes(tmp_path):
    """A plan with content_constraints=[] (low-content module) PASSES — the
    structural contract is that the field exists, even if empty."""
    plan = {"scene_action": "REVEAL", "rule_signals": {},
            "narrative_directives": {"must_not_reveal": [], "content_constraints": []},
            "clue_policy": {"reveal": []}}
    findings = coc_story_harness.assert_plan(plan)
    assert findings["safety_content_boundary"]["passed"] is True
    assert "present" in findings["safety_content_boundary"]["detail"]


def test_safety_content_boundary_director_plan_carries_field(tmp_path):
    """End-to-end: a plan generated by the director always carries the
    content_constraints field, so safety_content_boundary passes."""
    camp, char = _make_campaign_with_fumble(tmp_path)
    import random
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "cc-field")
    assert "content_constraints" in plan["narrative_directives"]
    findings = coc_story_harness.assert_plan(plan)
    assert findings["safety_content_boundary"]["passed"] is True
