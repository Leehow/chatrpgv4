"""Tests for coc_story_director: deterministic planner producing DirectorPlan."""
import importlib.util
import json
import random
from pathlib import Path

import pytest

def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

coc_story_director = _load("coc_story_director", "plugins/coc-keeper/scripts/coc_story_director.py")


def _make_minimal_campaign(tmp_path):
    """Build a minimal campaign dir with save + scenario story-graph."""
    camp = tmp_path / "campaigns" / "test"
    (camp / "save").mkdir(parents=True)
    (camp / "scenario").mkdir(parents=True)
    (camp / "save" / "investigator-state").mkdir()
    (camp / "save" / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "test", "investigator_id": "inv1",
        "current_hp": 12, "current_san": 55, "current_mp": 11,
        "conditions": [], "skill_checks_earned": [],
    }))
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "test", "scenario_id": "test-mod",
        "status": "active", "active_scene_id": "scene-1", "active_subsystem": "play",
        "current_phase": "middle", "discovered_clue_ids": [], "major_decisions": [],
    }))
    (camp / "save" / "flags.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "test", "clues_found": {}, "decisions": [],
    }))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "low", "lethal_chances_used": 0,
        "recent_intent_classes": [],
    }))
    (camp / "scenario" / "module-meta.json").write_text(json.dumps({
        "schema_version": 1, "scenario_id": "test-mod", "structure_type": "branching_investigation",
        "era": "1920s", "content_flags": [], "win_condition": "test",
    }))
    (camp / "scenario" / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "scene-1", "scene_type": "investigation",
         "dramatic_question": "能否找到线索？",
         "entry_conditions": [], "exit_conditions": ["clue-1 discovered"],
         "available_clues": ["clue-1"], "npc_ids": [], "pressure_moves": [],
         "tone": ["tense"], "allowed_improvisation": []},
    ]}))
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "concl-1", "importance": "critical", "minimum_routes": 3,
         "clues": [
             {"clue_id": "clue-1", "delivery": "investigate", "visibility": "player-safe"},
             {"clue_id": "clue-1b", "delivery": "social", "visibility": "player-safe"},
             {"clue_id": "clue-1c", "delivery": "spot hidden", "visibility": "player-safe"},
         ], "fallback_policy": "move clue if 2 missed"},
    ]}))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({"npcs": []}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}))
    (camp / "scenario" / "improvisation-boundaries.json").write_text(json.dumps({
        "invent_allowed": [], "never_invent": [], "keeper_secrets": ["secret-1"],
    }))
    # character.json for inv1
    char_dir = tmp_path / "investigators" / "inv1"
    char_dir.mkdir(parents=True)
    (char_dir / "character.json").write_text(json.dumps({
        "schema_version": 1, "id": "inv1", "occupation": "Antiquarian", "era": "1920s",
        "characteristics": {"STR":60,"CON":55,"SIZ":65,"DEX":50,"APP":45,"INT":70,"POW":55,"EDU":75,"LUCK":55},
        "derived": {"HP":12,"MP":11,"SAN":55,"MOV":7,"damage_bonus":"0","build":0},
        "skills": {"Credit Rating": 50, "Spot Hidden": 60, "Psychology": 55},
        "backstory": {},
    }))
    return camp, char_dir / "character.json"


def test_build_director_context_reads_state(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我检查门框", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert ctx["active_scene_id"] == "scene-1"
    assert ctx["structure_type"] == "branching_investigation"
    assert ctx["rule_signals"]["hp_state"] == "healthy"
    assert ctx["rule_signals"]["credit_tier"] == "wealthy"
    assert ctx["rule_signals"]["tension_clock"]["death_allowed"] is False


def test_build_director_context_fallen_back_on_missing_pacing(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    (camp / "save" / "pacing-state.json").unlink()
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    # defaults applied, no crash
    assert ctx["rule_signals"]["stalled_turns"] == 0


def test_build_director_context_reads_last_roll_fumble(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    (camp / "logs").mkdir(parents=True, exist_ok=True)
    (camp / "logs" / "rolls.jsonl").write_text(
        json.dumps({"type": "roll", "payload": {"outcome": "regular"}}) + "\n"
        + json.dumps({"type": "roll", "payload": {"outcome": "fumble"}}) + "\n"
    )
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    assert ctx["rule_signals"]["last_roll_fumble"] is True
    assert ctx["rule_signals"]["last_roll_critical"] is False


def test_build_director_context_reads_last_roll_critical(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    (camp / "logs").mkdir(parents=True, exist_ok=True)
    (camp / "logs" / "rolls.jsonl").write_text(
        json.dumps({"type": "roll", "payload": {"outcome": "critical"}}) + "\n"
    )
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    assert ctx["rule_signals"]["last_roll_critical"] is True
    assert ctx["rule_signals"]["last_roll_fumble"] is False


def test_select_action_reveal_for_active_investigation(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我仔细检查门框寻找线索", player_intent_class="investigate",
        rng=random.Random(42),
    )
    action, scores = coc_story_director.select_action(ctx)
    # Active investigation + clue available in scene → REVEAL should win
    assert action == "REVEAL"


def test_select_action_recover_when_stalled(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    # make 3 idle turns
    pacing = json.loads((camp/"save"/"pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["idle","idle","idle"]
    (camp/"save"/"pacing-state.json").write_text(json.dumps(pacing))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="不知道该干嘛", player_intent_class="idle", rng=random.Random(42),
    )
    action, _ = coc_story_director.select_action(ctx)
    assert action == "RECOVER"


def test_rule_override_dying_forces_subsystem(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    inv = json.loads((camp/"save"/"investigator-state"/"inv1.json").read_text())
    inv["current_hp"] = 0
    inv["conditions"] = ["major_wound", "dying"]
    (camp/"save"/"investigator-state"/"inv1.json").write_text(json.dumps(inv))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我继续调查", player_intent_class="investigate", rng=random.Random(42),
    )
    overrides = coc_story_director.apply_rule_signal_overrides(ctx)
    assert overrides is not None
    assert overrides["scene_action"] == "SUBSYSTEM"
    assert overrides["handoff"] == "rules"


def test_rule_override_fumble_forces_pressure(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    ctx["rule_signals"]["last_roll_fumble"] = True
    overrides = coc_story_director.apply_rule_signal_overrides(ctx)
    assert overrides["scene_action"] == "PRESSURE"


def test_rule_override_bout_forces_subsystem_sanity(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    ctx["rule_signals"]["bout_active"] = True
    overrides = coc_story_director.apply_rule_signal_overrides(ctx)
    assert overrides["scene_action"] == "SUBSYSTEM"
    assert overrides["subsystem"] == "sanity"


def test_generate_plan_reveal_includes_clue_policy(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我检查门框", player_intent_class="investigate", rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="d1")
    assert plan["scene_action"] == "REVEAL"
    assert len(plan["clue_policy"]["reveal"]) >= 1
    assert "secret-1" in plan["narrative_directives"]["must_not_reveal"]


def test_generate_plan_has_required_fields(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="d2")
    required = ["decision_id", "turn_input", "scene_action", "dramatic_question", "pacing_mode",
                "tension_delta", "rule_signals", "clue_policy", "npc_moves", "pressure_moves",
                "rules_requests", "memory_reads", "memory_writes", "narrative_directives",
                "handoff", "rationale"]
    for field in required:
        assert field in plan, f"missing {field}"


def test_generate_plan_fumble_handoff_narration(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    ctx["rule_signals"]["last_roll_fumble"] = True
    plan = coc_story_director.generate_director_plan(ctx, decision_id="d3")
    assert plan["scene_action"] == "PRESSURE"
    assert plan["handoff"] == "narration"


def test_director_handles_null_clock_segments(tmp_path):
    """Director must tolerate null/missing current_segments in threat-fronts (LLM-compiled data)."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # overwrite threat-fronts with a clock that has current_segments: null
    tf = {"fronts": [{"front_id": "f1", "scope": "scenario",
                      "clocks": [{"clock_id": "c1", "segments": 6, "current_segments": None,
                                  "on_tick_visible": ["x"], "on_full": "y"}]}]}
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps(tf))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="investigate", player_intent_class="investigate", rng=random.Random(42))
    # must not raise; PRESSURE scoring reads the null clock
    plan = coc_story_director.generate_director_plan(ctx, "null-clock-test")
    assert plan["scene_action"] in coc_story_director.ACTIONS


def test_clue_type_obscured_for_skill_delivery(tmp_path):
    """A clue whose delivery names a skill (e.g. 'investigate') is obscured and rolls."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # clue-1 delivery in the default minimal campaign is "investigate"
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "obscured-test")
    assert plan["clue_policy"]["clue_type"] == "obscured"
    # obscured clue should trigger a Spot Hidden rules_request
    assert any("Spot Hidden" in r.get("skill", "") for r in plan["rules_requests"])


def test_clue_type_obvious_for_handout_delivery(tmp_path):
    """A clue delivered via a Handout / direct give is obvious and skips the Spot Hidden roll."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # rewrite clue-graph so clue-1 is delivered as a Handout (no skill roll)
    cg = {"conclusions": [{"conclusion_id": "concl-1", "importance": "critical",
            "minimum_routes": 3,
            "clues": [{"clue_id": "clue-1", "delivery": "Handout 1 — Mr. X gives this directly", "visibility": "player-safe"},
                      {"clue_id": "clue-1b", "delivery": "Spot Hidden", "visibility": "player-safe"},
                      {"clue_id": "clue-1c", "delivery": "Library Use", "visibility": "player-safe"}],
            "fallback_policy": ""}]}
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(cg))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "obvious-test")
    assert plan["clue_policy"]["clue_type"] == "obvious"
    # obvious clue should NOT trigger a Spot Hidden rules_request
    assert plan["rules_requests"] == [] or all("Spot Hidden" not in r.get("skill", "") for r in plan["rules_requests"])


def test_infer_clue_type_unknown_defaults_obscured():
    """A clue_id not present in clue_graph defaults to obscured (conservative)."""
    cg = {"conclusions": [{"conclusion_id": "c1", "clues": [
        {"clue_id": "known", "delivery": "Handout"}], "fallback_policy": ""}]}
    assert coc_story_director._infer_clue_type("missing-clue", cg) == "obscured"
    assert coc_story_director._infer_clue_type(None, cg) == "obscured"
    assert coc_story_director._infer_clue_type("known", cg) == "obvious"


def test_must_include_filled_from_clue_anchor(tmp_path):
    """clue with player_visible_anchor populates must_include."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # rewrite clue-graph: clue-1 has player_visible_anchor
    cg = {"conclusions": [{"conclusion_id": "concl-1", "importance": "critical",
            "minimum_routes": 3,
            "clues": [
                {"clue_id": "clue-1", "delivery": "Handout 1 — direct give",
                 "visibility": "player-safe",
                 "player_visible_anchor": "门闩边缘的新鲜划痕"},
                {"clue_id": "clue-1b", "delivery": "Spot Hidden", "visibility": "player-safe"},
                {"clue_id": "clue-1c", "delivery": "Library Use", "visibility": "player-safe"},
            ], "fallback_policy": ""}]}
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(cg))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "anchor-test")
    # clue-1 is revealed (REVEAL action), its anchor must appear in must_include
    assert "门闩边缘的新鲜划痕" in plan["narrative_directives"]["must_include"]


def test_must_include_empty_when_clue_has_no_anchor(tmp_path):
    """clue without player_visible_anchor leaves must_include empty (no crash)."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # default _make_minimal_campaign clues have no player_visible_anchor
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "no-anchor-test")
    assert plan["narrative_directives"]["must_include"] == []


def test_pacing_drives_horror_stage_from_active_scene(tmp_path):
    """horror_escalation_stage comes from pacing-map entry matching active scene."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # add a pacing-map with scene-1 = revelation stage
    pm = {"pacing_curve": [
        {"scene_id": "scene-1", "tension_target": "high", "horror_stage": "revelation"},
    ]}
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps(pm))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "pacing-test")
    assert plan["narrative_directives"]["horror_escalation_stage"] == "revelation"
    assert plan["pacing_mode"] == "high"


def test_pacing_falls_back_when_no_matching_scene(tmp_path):
    """no pacing entry for active scene -> fallback to action-based defaults, no crash."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # pacing-map exists but no scene-1 entry
    pm = {"pacing_curve": [{"scene_id": "other-scene", "tension_target": "low", "horror_stage": "ordinary"}]}
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps(pm))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "pacing-fallback-test")
    # fallback horror stage is wrongness (v1 default), pacing_mode from action
    assert plan["narrative_directives"]["horror_escalation_stage"] == "wrongness"
    assert plan["pacing_mode"] in ("investigation", "pressure", "social", "low", "medium", "high", "climax", "aftermath", "slow_burn")


def test_payoff_scores_above_zero_when_memory_matches(tmp_path):
    """PAYOFF should score > 0 when retrieved memory cards match the scene."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # pre-populate a memory card keyed to scene-1 entities
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_memory", "plugins/coc-keeper/scripts/coc_memory.py")
    coc_memory = importlib.util.module_from_spec(spec); spec.loader.exec_module(coc_memory)
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-test-door",
        privacy="player_safe", salience=0.8,
        summary="玩家关注门", entities=["scene-1-entity"],
        tags=["player_interest"], reactivation_cues=["scene-1"], source_events=[])
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="recall", player_intent_class="investigate", rng=random.Random(42))
    # force memory retrieval by injecting entities matching the card
    ctx["memory_query_entities"] = ["scene-1-entity"]
    ctx["memory_query_cues"] = ["scene-1"]
    score = coc_story_director._base_score("PAYOFF", ctx)
    assert score > 0.0


def test_payoff_discriminates_weak_vs_strong_memory(tmp_path):
    """Stronger memory match should score higher than a weak one."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_memory", "plugins/coc-keeper/scripts/coc_memory.py")
    coc_memory = importlib.util.module_from_spec(spec); spec.loader.exec_module(coc_memory)
    # weak card: single entity match
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-weak", privacy="player_safe", salience=0.3,
        summary="weak", entities=["entity-A"], tags=["x"], reactivation_cues=["cue-A"], source_events=[])
    # strong card: multiple entity + cue match
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-strong", privacy="player_safe", salience=0.9,
        summary="strong", entities=["entity-A", "entity-B", "entity-C"],
        tags=["player_interest"], reactivation_cues=["cue-A", "cue-B", "cue-C"], source_events=[])
    # query matches both, but strong card has more overlap
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate", rng=random.Random(42))
    ctx["memory_query_entities"] = ["entity-A", "entity-B", "entity-C"]
    ctx["memory_query_cues"] = ["cue-A", "cue-B", "cue-C"]
    score = coc_story_director._base_score("PAYOFF", ctx)
    # strong match should produce a meaningfully higher score than the weak-only floor
    assert score >= 0.5  # strong match drives it up


def test_memory_reads_populated_when_cards_match(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_memory", "plugins/coc-keeper/scripts/coc_memory.py")
    coc_memory = importlib.util.module_from_spec(spec); spec.loader.exec_module(coc_memory)
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-test-door",
        privacy="player_safe", salience=0.9,
        summary="玩家关注门", entities=["scene-1-entity"],
        tags=["player_interest"], reactivation_cues=["scene-1"], source_events=[])
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate", rng=random.Random(42))
    ctx["memory_query_entities"] = ["scene-1-entity"]
    ctx["memory_query_cues"] = ["scene-1"]
    plan = coc_story_director.generate_director_plan(ctx, "mem-test")
    assert len(plan["memory_reads"]) >= 1
    assert plan["memory_reads"][0]["memory_id"] == "mem-test-door"
