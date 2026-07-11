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
coc_narrative_enrichment = _load(
    "coc_narrative_enrichment",
    "plugins/coc-keeper/scripts/coc_narrative_enrichment.py",
)


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


def _make_legacy_live_campaign(tmp_path):
    """Build a manual/live campaign that predates compiled story-graph files."""
    camp = tmp_path / "campaigns" / "legacy-live"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "scenario").mkdir(parents=True)
    (camp / "save" / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "legacy-live",
        "investigator_id": "inv1",
        "current_hp": 12,
        "current_san": 55,
        "current_mp": 11,
        "conditions": [],
        "skill_checks_earned": [],
    }))
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "legacy-live",
        "scenario_id": "legacy-mod",
        "status": "active",
        "active_scene_id": "stale-opening",
        "active_subsystem": "play",
        "current_phase": "manual_live",
        "discovered_clue_ids": [],
        "major_decisions": [],
    }))
    (camp / "save" / "active-scene.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "legacy-live",
        "scenario_id": "legacy-mod",
        "scene_id": "hospital-short-visit",
        "summary": (
            "调查员抵达医院，医生只允许短暂询问。桑切斯教授清醒但虚弱，"
            "走廊里有警员看守。"
        ),
        "pending_choices": [
            "询问桑切斯教授还能记起什么",
            "观察走廊警员和医护人员的反应",
        ],
        "pressure_moves": [
            "走廊尽头的警员压低声音催促，医生也开始看表。"
        ],
    }))
    (camp / "save" / "flags.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "legacy-live",
        "clues_found": {},
        "decisions": [],
    }))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "legacy-live",
        "tension_level": "low",
        "lethal_chances_used": 0,
        "recent_intent_classes": [],
        "turn_number": 0,
    }))
    (camp / "scenario" / "module-meta.json").write_text(json.dumps({
        "schema_version": 1,
        "scenario_id": "legacy-mod",
        "structure_type": "linear_acts",
        "era": "1920s",
        "content_flags": [],
        "win_condition": "continue live play",
    }))
    (camp / "scenario" / "scenario.json").write_text(json.dumps({
        "schema_version": 1,
        "scenario_id": "legacy-mod",
        "title": "Legacy Live Module",
        "current_phase": "manual_live",
    }))
    # Legacy importer files may exist but contain no compiled story graph data.
    (camp / "scenario" / "clues.json").write_text("[]")
    (camp / "scenario" / "npcs.json").write_text("[]")
    (camp / "scenario" / "locations.json").write_text("[]")

    char_dir = tmp_path / "investigators" / "inv1"
    char_dir.mkdir(parents=True)
    (char_dir / "character.json").write_text(json.dumps({
        "schema_version": 1,
        "id": "inv1",
        "occupation": "Professor",
        "era": "1920s",
        "characteristics": {
            "STR": 50,
            "CON": 55,
            "SIZ": 65,
            "DEX": 60,
            "APP": 70,
            "INT": 80,
            "POW": 55,
            "EDU": 80,
            "LUCK": 55,
        },
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 7},
        "skills": {"Credit Rating": 60, "Spot Hidden": 60, "Psychology": 45},
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


def test_build_director_context_exposes_investigator_skills_for_dialogue_gate(tmp_path):
    """P1-8: the director context must expose the investigator's structured
    skills so narrative enrichment can gate foreign-dialogue translation on
    the actual Language skill value without re-reading the character sheet."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="ask the survivor", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert ctx["investigator_skills"] == {"Credit Rating": 50, "Spot Hidden": 60, "Psychology": 55}


def test_build_context_bridges_legacy_live_active_scene_without_story_graph(tmp_path):
    camp, char_path = _make_legacy_live_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我先观察走廊，再短暂询问教授",
        player_intent_class="investigate",
        rng=random.Random(42),
    )

    assert ctx["active_scene_id"] == "hospital-short-visit"
    assert ctx["active_scene"]["scene_id"] == "hospital-short-visit"
    assert ctx["active_scene"]["scene_type"] == "investigation"
    assert ctx["active_scene"]["dramatic_question"]
    assert len(ctx["active_scene"]["affordances"]) >= 2
    assert max(len(route["cue"]) for route in ctx["active_scene"]["affordances"]) <= 90
    assert "animal_instinct" in ctx["active_scene"]["excluded_storylet_tropes"]
    assert ctx["story_graph"]["scenes"][0]["scene_id"] == "hospital-short-visit"


def test_legacy_live_scene_reaches_narrative_enrichment(tmp_path):
    camp, char_path = _make_legacy_live_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我先观察走廊，再短暂询问教授",
        player_intent_class="investigate",
        rng=random.Random(42),
    )
    ctx["storylet_policy"] = {
        "conflict_level": "low",
        "seed": "legacy-live-test",
        "max_storylets": 1,
        "force_storylet": True,
    }

    plan = coc_story_director.generate_director_plan(ctx, decision_id="legacy-live-turn")
    enriched = coc_narrative_enrichment.enrich_director_plan(plan, ctx)

    assert enriched["choice_frame"]["route_count"] >= 2
    assert enriched["narrative_enrichment"]["choice_frame"] is True
    assert enriched["storylet_moves"]
    assert enriched["storylet_moves"][0]["bound_entities"]["scene_id"] == "hospital-short-visit"


def test_compiled_scene_merges_live_visible_affordances(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    (camp / "save" / "active-scene.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "test",
        "scenario_id": "test-mod",
        "scene_id": "scene-1",
        "summary": "现场已经推进到门口，玩家能看到两个具体切入点。",
        "visible_affordances": [
            {"cue": "门缝里透出一线冷光。", "route": "inspect_cold_door"},
            {"cue": "楼梯扶手上有新鲜泥点。", "route": "check_muddy_rail"},
        ],
    }))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="过去看看",
        player_intent_class="investigate",
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="merged-live-affordance")
    enriched = coc_narrative_enrichment.enrich_director_plan(plan, ctx)

    route_ids = {route["route_id"] for route in enriched["choice_frame"]["routes"]}
    assert "inspect_cold_door" in route_ids
    assert "check_muddy_rail" in route_ids
    assert ctx["active_scene"]["source"] == "live-story-bridge.merged-active-scene"


def test_build_context_preserves_authored_time_profile_from_runtime_active_scene(tmp_path):
    camp, char_path = _make_legacy_live_campaign(tmp_path)
    active_path = camp / "save" / "active-scene.json"
    active = json.loads(active_path.read_text(encoding="utf-8"))
    active["scene_tags"] = ["extreme_cold"]
    active["time_profile"] = {"category": "single_room_search"}
    active_path.write_text(json.dumps(active), encoding="utf-8")

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="I take a quick look.",
        player_intent_class="investigate",
        player_intent_rich={
            "primary_intent": "investigate",
            "intent_detail": "quick_observation",
        },
        rng=random.Random(42),
    )

    assert ctx["active_scene"]["source"] == "live-story-bridge.active-scene"
    assert ctx["active_scene"]["time_profile"] == {"category": "single_room_search"}
    profile = coc_story_director._time_profile_for_action("REVEAL", ctx)
    assert profile["category"] == "single_room_search"
    assert profile["delta_minutes"] == 20


def test_build_context_merges_authored_time_profile_over_compiled_scene(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    (camp / "save" / "active-scene.json").write_text(json.dumps({
        "schema_version": 1,
        "scene_id": "scene-1",
        "time_profile": {"category": "single_room_search"},
    }))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="I take a quick look.",
        player_intent_class="investigate",
        player_intent_rich={
            "primary_intent": "investigate",
            "intent_detail": "quick_observation",
        },
        rng=random.Random(42),
    )

    assert ctx["active_scene"]["source"] == "live-story-bridge.merged-active-scene"
    assert ctx["active_scene"]["time_profile"] == {"category": "single_room_search"}
    assert coc_story_director._time_profile_for_action("REVEAL", ctx)["delta_minutes"] == 20


def test_build_context_does_not_overlay_stale_time_profile_onto_new_compiled_scene(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story_path = camp / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["scenes"].append({
        "scene_id": "scene-2",
        "scene_type": "investigation",
        "dramatic_question": "What is visible here?",
        "entry_conditions": [],
        "exit_conditions": [],
        "available_clues": [],
        "npc_ids": [],
        "pressure_moves": [],
        "tone": ["cold"],
        "allowed_improvisation": [],
    })
    story_path.write_text(json.dumps(story), encoding="utf-8")
    world_path = camp / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = "scene-2"
    world_path.write_text(json.dumps(world), encoding="utf-8")
    (camp / "save" / "active-scene.json").write_text(json.dumps({
        "schema_version": 1,
        "scene_id": "scene-1",
        "time_profile": {"category": "single_room_search"},
    }))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="I take a quick look.",
        player_intent_class="investigate",
        player_intent_rich={
            "primary_intent": "investigate",
            "intent_detail": "quick_observation",
        },
        rng=random.Random(42),
    )

    assert ctx["active_scene_id"] == "scene-2"
    assert "time_profile" not in ctx["active_scene"]
    profile = coc_story_director._time_profile_for_action("REVEAL", ctx)
    assert profile["category"] == "quick_observation"
    assert profile["delta_minutes"] <= 5


def test_invalid_compiled_time_profile_is_dropped_with_context_warning(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story_path = camp / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["scenes"][0]["time_profile"] = {"category": "fast_snowfield_scan"}
    story_path.write_text(json.dumps(story), encoding="utf-8")
    (camp / "logs").mkdir(exist_ok=True)
    coc_story_director.coc_time.initialize_time_state(camp)

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="I take a quick look.",
        player_intent_class="investigate",
        player_intent_rich={
            "primary_intent": "investigate",
            "intent_detail": "quick_observation",
        },
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, "invalid-compiled-time")

    assert "time_profile" not in ctx["active_scene"]
    assert ctx["validation_warnings"] == [{
        "field": "time_profile",
        "source": "compiled_scene",
        "reason_code": "category_not_in_time_cost_catalog",
    }]
    assert plan["time_advance"]["category"] == "quick_observation"
    assert plan["time_advance"]["delta_minutes"] <= 5


def test_invalid_runtime_time_profile_string_delta_falls_back_without_raising(tmp_path):
    camp, char_path = _make_legacy_live_campaign(tmp_path)
    active_path = camp / "save" / "active-scene.json"
    active = json.loads(active_path.read_text(encoding="utf-8"))
    active["time_profile"] = {
        "category": "quick_observation",
        "delta_minutes": "five",
    }
    active_path.write_text(json.dumps(active), encoding="utf-8")
    (camp / "logs").mkdir(exist_ok=True)
    coc_story_director.coc_time.initialize_time_state(camp)

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="I take a quick look.",
        player_intent_class="investigate",
        player_intent_rich={
            "primary_intent": "investigate",
            "intent_detail": "quick_observation",
        },
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, "invalid-runtime-time")

    assert "time_profile" not in ctx["active_scene"]
    assert ctx["validation_warnings"] == [{
        "field": "time_profile",
        "source": "runtime_active_scene",
        "reason_code": "delta_minutes_must_be_integer",
    }]
    assert plan["time_advance"]["category"] == "quick_observation"
    assert plan["time_advance"]["delta_minutes"] <= 5


def test_obscured_clue_rules_request_includes_roll_contract(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    clue_graph = json.loads((camp / "scenario" / "clue-graph.json").read_text())
    clue_graph["conclusions"][0]["clues"][0].update({
        "delivery_kind": "skill_check",
        "skill": "Spot Hidden",
        "difficulty": "regular",
        "player_safe_summary": "门框边缘有新鲜划痕",
    })
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(clue_graph))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我搜查门框",
        player_intent_class="investigate",
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="contract-obscured")

    request = next(req for req in plan["rules_requests"] if req["kind"] == "skill_check")
    contract = request["roll_contract"]
    assert contract["schema_version"] == 1
    assert contract["failure_outcome_mode"] == "clue_with_cost"
    assert contract["push_policy"]["keeper_must_foreshadow_failure"] is True
    assert contract["roll_density_group"] == "clue:clue-1"
    assert "do not reveal exact withheld clue on failure" in contract["must_not"]


def test_adversary_npc_character_move_does_not_use_social_reaction_roll():
    ctx = {
        "active_scene": {"npc_ids": ["npc-survivor"]},
        "npc_agendas": {"npcs": [{
            "npc_id": "npc-survivor",
            "agenda": "Lash out at anything that moves.",
            "fear": "The thing in the tunnel.",
            "relationship_to_investigators": "adversary",
        }]},
        "rule_signals": {"app": 80, "credit_rating": 80, "npc_reaction_roll": None},
        "rng": random.Random(42),
    }

    moves = coc_story_director._build_npc_moves(ctx, "CHARACTER")

    assert moves[0]["emotional_tone"] == "panicked and hostile"
    assert moves[0]["disposition_source"] is None
    assert ctx["rule_signals"]["npc_reaction_roll"] is None


def test_npc_agenda_text_does_not_keyword_force_adversary():
    ctx = {
        "active_scene": {"npc_ids": ["npc-guard"]},
        "npc_agendas": {"npcs": [{
            "npc_id": "npc-guard",
            "agenda": "Lash out at anything that moves.",
            "fear": "Losing control of the checkpoint.",
        }]},
        "rule_signals": {"app": 80, "credit_rating": 80, "npc_reaction_roll": None},
        "rng": random.Random(42),
    }

    moves = coc_story_director._build_npc_moves(ctx, "CHARACTER")

    assert moves[0]["emotional_tone"] in {"warm and cooperative", "guarded but civil", "cold and suspicious"}
    assert moves[0]["disposition_source"] == "rule_signal:npc_reaction_roll"
    assert ctx["rule_signals"]["npc_reaction_roll"] is not None


def test_director_builds_npc_agency_from_abstract_social_role(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["npc_ids"] = ["npc-authority"]
    story["scenes"][0]["scene_tags"] = ["crisis"]
    story["scenes"][0]["authority_demands"] = ["scene_safety"]
    story["scenes"][0]["responsibility_threats"] = ["group_survival"]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({
        "npcs": [{
            "npc_id": "npc-authority",
            "agenda": "keep everyone alive without surrendering the scene",
            "social_role": {
                "authority_scope": ["scene_safety"],
                "responsibility_domains": ["group_survival"],
                "chain_of_command": {"to_pc": "peer", "to_group": "commands"},
                "initiative_style": "decisive",
                "delegation_policy": {
                    "keeps": ["scene_safety"],
                    "delegates": ["specialist_care"],
                },
            },
            "persona_tag_weights": {
                "temperament.impatient": 3,
                "voice.short_orders": 2,
                "stress_response.command": 2,
            },
        }]
    }))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="继续",
        player_intent_class="continue",
        rng=random.Random(7),
    )
    moves = coc_story_director._build_npc_moves(ctx, "CHARACTER")

    authority_move = moves[0]["agency_moves"][0]
    assert authority_move["move_id"] == "take_command"
    assert authority_move["reason"] == "authority_scope_matches_scene"
    assert authority_move["rules_effect"]["actor_role"] == "npc"
    assert moves[0]["persona"]["tags"]
    assert ctx["npc_state_writes"][0]["npc_id"] == "npc-authority"


def test_director_uses_mythos_based_max_san(tmp_path, monkeypatch):
    """Max SAN = 99 - Cthulhu Mythos (p.167 F9), not a hardcoded 99.

    The director must read the investigator's Cthulhu Mythos skill and route
    it through coc_mythos.max_san_for. We stub max_san_for to capture the cm
    value the director passes, proving the wiring (regression guard for the
    former `max_san = 99` literal).
    """
    camp, char_path = _make_minimal_campaign(tmp_path)
    # Add Cthulhu Mythos to the investigator's skills.
    char = json.loads(char_path.read_text())
    char["skills"]["Cthulhu Mythos"] = 10
    char_path.write_text(json.dumps(char))

    captured = {}

    def fake_max_san_for(cm_value):
        captured["cm_value"] = cm_value
        return 99 - int(cm_value)

    monkeypatch.setattr(coc_story_director.coc_mythos, "max_san_for", fake_max_san_for)

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我翻阅禁忌典籍", player_intent_class="investigate",
        rng=random.Random(42),
    )
    # The director read Cthulhu Mythos from the skill list and passed it on.
    assert captured == {"cm_value": 10}
    # And the derived max_san (89) flows into the sanity signal call path
    # without crashing — i.e. the hardcoded-99 path is gone.
    assert ctx["rule_signals"]["sanity_state"] == "stable"


def test_director_defaults_max_san_to_99_without_mythos(tmp_path, monkeypatch):
    """An investigator with no Cthulhu Mythos skill keeps max_san = 99."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    captured = {}

    def fake_max_san_for(cm_value):
        captured["cm_value"] = cm_value
        return 99 - int(cm_value)

    monkeypatch.setattr(coc_story_director.coc_mythos, "max_san_for", fake_max_san_for)

    coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我检查门框", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert captured == {"cm_value": 0}


def test_rich_intent_backward_compatible(tmp_path):
    """Omitting player_intent_rich behaves identically to the legacy path."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx_legacy = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我检查门", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert ctx_legacy["player_intent_rich"] is None
    assert ctx_legacy["player_intent_class"] == "investigate"


def test_rich_intent_derives_class_from_primary(tmp_path):
    """When rich intent is supplied, player_intent_class is derived from it."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    rich = {
        "primary_intent": "social", "secondary_intents": [],
        "target_entities": ["neighbor"], "risk_posture": "neutral",
        "explicit_roll_request": False, "player_hypothesis": None,
    }
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我问邻居", player_intent_class="investigate",  # overridden by rich
        rng=random.Random(42), player_intent_rich=rich,
    )
    assert ctx["player_intent_class"] == "social"  # derived from rich
    assert ctx["player_intent_rich"] == rich


def test_rich_intent_risk_posture_adjusts_pressure(tmp_path):
    """A reckless player's PRESSURE score is higher than a cautious one's."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    base_ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate",
        rng=random.Random(42),
    )
    # Same context, but inject different risk postures via rich intent.
    reckless_ctx = dict(base_ctx)
    reckless_ctx["player_intent_rich"] = {"risk_posture": "reckless"}
    cautious_ctx = dict(base_ctx)
    cautious_ctx["player_intent_rich"] = {"risk_posture": "cautious"}
    neutral_ctx = dict(base_ctx)
    neutral_ctx["player_intent_rich"] = {"risk_posture": "neutral"}

    p_reckless = coc_story_director._base_score("PRESSURE", reckless_ctx)
    p_cautious = coc_story_director._base_score("PRESSURE", cautious_ctx)
    p_neutral = coc_story_director._base_score("PRESSURE", neutral_ctx)
    p_legacy = coc_story_director._base_score("PRESSURE", base_ctx)  # no rich

    assert p_reckless > p_neutral > p_cautious
    assert p_neutral == p_legacy  # neutral rich == no rich (backward compat)


def test_pushed_fail_pending_boosts_pressure_score(tmp_path):
    """p.83-85: pacing pushed_fail_pending raises PRESSURE by +0.1 once."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    base_ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert base_ctx["rule_signals"].get("pushed_fail_pending") is not True
    base_score = coc_story_director._base_score("PRESSURE", base_ctx)

    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["pushed_fail_pending"] = True
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))
    pending_ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert pending_ctx["rule_signals"]["pushed_fail_pending"] is True
    pending_score = coc_story_director._base_score("PRESSURE", pending_ctx)
    assert pending_score == pytest.approx(base_score + 0.1)
    assert pending_score > base_score


def test_fair_warning_downgrades_lethal_before_three_chances(tmp_path):
    """p.209: lethal structured evidence is downgraded to fair_warning while used < 3."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["pressure_moves"] = [{
        "id": "lethal-collapse",
        "visible_symptom": "the floor gives way",
        "tick": 1,
        "lethal": True,
    }]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["lethal_chances_used"] = 1
    pacing["recent_intent_classes"] = ["idle", "idle"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="继续磨蹭", player_intent_class="idle",
        rng=random.Random(42),
    )
    assert ctx["rule_signals"]["tension_clock"]["death_allowed"] is False
    # Force PRESSURE so scene lethal pressure_moves are selected.
    ctx = dict(ctx)
    ctx["rule_signals"] = dict(ctx["rule_signals"])
    ctx["rule_signals"]["low_agency_continue_count"] = 2
    ctx["rule_signals"]["scene_pressure_available"] = True
    plan = coc_story_director.generate_director_plan(ctx, decision_id="fw-1")
    fw = plan["narrative_directives"]["fair_warning"]
    assert fw["warning_number"] == 2
    assert fw["remaining"] == 1
    for move in plan.get("pressure_moves") or []:
        if isinstance(move, dict) and move.get("lethal_downgraded"):
            assert move.get("lethal") is not True
            break
    else:
        # At least one move must have been downgraded, or plan carries fair_warning
        # with no remaining lethal=True outcomes.
        assert not any(
            isinstance(m, dict) and m.get("lethal") is True
            for m in (plan.get("pressure_moves") or [])
        )


def test_fair_warning_allows_lethal_after_three_chances(tmp_path):
    """After 3 fair warnings, death_allowed and lethal outcomes pass through."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["pressure_moves"] = [{
        "id": "lethal-collapse",
        "visible_symptom": "the floor gives way",
        "tick": 1,
        "lethal": True,
    }]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["lethal_chances_used"] = 3
    pacing["recent_intent_classes"] = ["idle", "idle"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="继续磨蹭", player_intent_class="idle",
        rng=random.Random(42),
    )
    assert ctx["rule_signals"]["tension_clock"]["death_allowed"] is True
    ctx = dict(ctx)
    ctx["rule_signals"] = dict(ctx["rule_signals"])
    ctx["rule_signals"]["low_agency_continue_count"] = 2
    ctx["rule_signals"]["scene_pressure_available"] = True
    plan = coc_story_director.generate_director_plan(ctx, decision_id="fw-lethal")
    assert "fair_warning" not in plan["narrative_directives"]
    assert any(
        isinstance(m, dict) and m.get("lethal") is True
        for m in (plan.get("pressure_moves") or [])
    )


def test_pushed_fail_pending_consumed_no_repeat_boost(tmp_path):
    """After apply consumes the flag, the next context no longer boosts PRESSURE."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["pushed_fail_pending"] = True
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert ctx["rule_signals"]["pushed_fail_pending"] is True
    plan = coc_story_director.generate_director_plan(ctx, decision_id="consume-push-fail")
    assert plan["rule_signals"].get("pushed_fail_pending") is True

    coc_director_apply = _load(
        "coc_director_apply_push_consume",
        "plugins/coc-keeper/scripts/coc_director_apply.py",
    )
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1", rules_results=[])

    pacing_after = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing_after.get("pushed_fail_pending") is not True

    ctx2 = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert ctx2["rule_signals"].get("pushed_fail_pending") is not True
    # Same baseline as a fresh campaign without the flag.
    fresh_camp, fresh_char = _make_minimal_campaign(tmp_path / "fresh")
    fresh_ctx = coc_story_director.build_director_context(
        campaign_dir=fresh_camp, character_path=fresh_char, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert coc_story_director._base_score("PRESSURE", ctx2) == (
        coc_story_director._base_score("PRESSURE", fresh_ctx)
    )


def test_rich_intent_indefinite_insane_signal_read(tmp_path):
    """The director surfaces indefinite_insane from investigator-state."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    inv_path = camp / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv["indefinite_insane"] = True
    inv_path.write_text(json.dumps(inv))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert ctx["rule_signals"]["indefinite_insane"] is True


def test_phobia_exposure_signal_when_insane_and_tags_intersect(tmp_path):
    """Scene threat_tags ∩ phobia_tags → phobia_exposure.penalty_die while insane."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["threat_tags"] = ["heights", "cliff_edge", "darkness"]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))

    inv_path = camp / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv["temporary_insane"] = True
    inv["phobia_tags"] = ["heights", "rooftop", "looking_down"]
    inv_path.write_text(json.dumps(inv))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate",
        rng=random.Random(42),
    )
    signal = ctx["rule_signals"]["phobia_exposure"]
    assert signal["penalty_die"] is True
    assert "heights" in signal["matched_tags"]


def test_phobia_exposure_signal_empty_when_sane_or_disjoint(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["threat_tags"] = ["heights", "cliff_edge"]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))

    inv_path = camp / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    # Sane + intersecting tags → no penalty
    inv["phobia_tags"] = ["heights", "rooftop"]
    inv_path.write_text(json.dumps(inv))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert ctx["rule_signals"]["phobia_exposure"]["penalty_die"] is False

    # Insane + disjoint tags → no penalty
    inv["temporary_insane"] = True
    inv["phobia_tags"] = ["spiders", "webs"]
    inv_path.write_text(json.dumps(inv))
    ctx2 = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert ctx2["rule_signals"]["phobia_exposure"]["penalty_die"] is False
    assert ctx2["rule_signals"]["phobia_exposure"]["matched_tags"] == []


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


def test_build_director_context_ignores_npc_fumble_for_player_fumble_signal(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    (camp / "logs").mkdir(parents=True, exist_ok=True)
    (camp / "logs" / "rolls.jsonl").write_text(
        json.dumps({"type": "roll", "payload": {"outcome": "failure"}}) + "\n"
        + json.dumps({
            "type": "roll",
            "payload": {
                "kind": "npc_attack",
                "actor_role": "npc",
                "outcome": "fumble",
            },
        }) + "\n"
    )
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    assert ctx["rule_signals"]["last_roll_fumble"] is False
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


def test_recover_plan_includes_idea_roll_contract(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["idle", "idle", "idle"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="不知道该干嘛",
        player_intent_class="idle",
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="idea-roll")

    idea = plan["narrative_directives"]["idea_roll_plan"]
    assert idea["roll_target"] == "INT"
    assert idea["missed_clue_id"] == "clue-1"
    assert idea["failure_delivery_with_cost"] == "surface the lead in a worse position"
    assert idea["signpost_level"] == "unmentioned"
    assert idea["difficulty"] is None  # never signposted → free delivery, no roll
    assert "target_characteristic" not in idea
    assert "missed_conclusion_id" not in idea
    assert "do not present this as table-level advice" in idea["must_not"]
    # Free recovery still advances via fallback; no idea_roll request.
    assert not any(req.get("kind") == "idea_roll" for req in plan.get("rules_requests", []))


def test_idea_roll_failure_delivers_info_the_worst_way(tmp_path):
    """p.199: Idea Roll failure still advances, but delivers info the worst way."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["idle", "idle", "idle"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))

    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["clue_signposts"] = {"clue-1": "mentioned"}
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="不知道该干嘛",
        player_intent_class="idle",
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="idea-worst")
    idea = plan["narrative_directives"]["idea_roll_plan"]
    assert idea["failure_delivery"] == "worst_possible_way"
    assert isinstance(idea.get("directive"), dict)
    assert idea["directive"]["mode"] == "worst_possible_way"
    # Structured cost channels for narration (cost / exposure / alert).
    channels = set(idea["directive"].get("channels") or [])
    assert {"cost", "exposure", "alert"} <= channels
    assert idea["difficulty"] == "regular"  # mentioned → roll required


def test_idea_roll_difficulty_follows_signpost_level(tmp_path):
    """Rulebook p.199: never mentioned → free; mentioned → Regular; obvious missed → Extreme."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["idle", "idle", "idle"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))

    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["clue_signposts"] = {"clue-1": "mentioned"}
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="不知道该干嘛",
        player_intent_class="idle",
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="idea-mentioned")
    idea = plan["narrative_directives"]["idea_roll_plan"]
    assert idea["signpost_level"] == "mentioned"
    assert idea["difficulty"] == "regular"
    idea_reqs = [req for req in plan["rules_requests"] if req.get("kind") == "idea_roll"]
    assert len(idea_reqs) == 1
    assert idea_reqs[0]["difficulty"] == "regular"
    assert idea_reqs[0]["skill"] == "INT"
    assert plan["handoff"] == "rules"

    world["clue_signposts"] = {"clue-1": "obvious"}
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="不知道该干嘛",
        player_intent_class="idle",
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="idea-obvious")
    idea = plan["narrative_directives"]["idea_roll_plan"]
    assert idea["signpost_level"] == "obvious"
    assert idea["difficulty"] == "extreme"
    idea_reqs = [req for req in plan["rules_requests"] if req.get("kind") == "idea_roll"]
    assert len(idea_reqs) == 1
    assert idea_reqs[0]["difficulty"] == "extreme"


def test_reveal_social_intent_surfaces_structured_npc_dialogue_clue(tmp_path):
    """A social intent may surface clues when structured data says the NPC is the source."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    clue_graph = json.loads((camp / "scenario" / "clue-graph.json").read_text())
    clue_graph["conclusions"][0]["clues"][0]["delivery_kind"] = "npc_dialogue"
    clue_graph["conclusions"][0]["clues"][0]["route_priority"] = 0.9
    clue_graph["conclusions"][0]["clues"][1]["delivery_kind"] = "environmental"
    clue_graph["conclusions"][0]["clues"][1]["route_priority"] = 0.1
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(clue_graph))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我和那个NPC聊聊", player_intent_class="social",
        rng=random.Random(42),
    )

    assert coc_story_director._base_score("REVEAL", ctx) == 0.75

    ctx["player_intent_class"] = "investigate"
    assert coc_story_director._base_score("REVEAL", ctx) == 0.9


def test_social_intent_does_not_reveal_environmental_clue(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    clue_graph = json.loads((camp / "scenario" / "clue-graph.json").read_text())
    for clue in clue_graph["conclusions"][0]["clues"]:
        clue["delivery_kind"] = "environmental"
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(clue_graph))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我向旁边的人问发生了什么",
        player_intent_class="social",
        rng=random.Random(42),
    )

    assert coc_story_director._base_score("REVEAL", ctx) == 0.0



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
    plan = coc_story_director.generate_director_plan(ctx, "dying-decision")
    assert plan["rules_requests"] == [{
        "kind": "dying_tick",
        "clock_kind": "round",
        "reason": "structured death-clock continuation",
    }]


def test_director_emits_typed_defense_for_persisted_pending_attack(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    (camp / "save" / "combat.json").write_text(json.dumps({
        "schema_version": 2, "combat_id": "fight", "status": "active",
        "revision": 4,
        "pending_attack": {
            "attack_command_id": "attack-1", "actor_id": "cultist",
            "target_actor_id": "inv1", "allowed_defenses": ["dodge", "fight_back"],
        },
    }))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="I dodge.", player_intent_class="combat",
        player_intent_rich={
            "primary_intent": "combat",
            "combat_defense": {"kind": "dodge", "attack_command_id": "attack-1"},
        },
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, "defense-decision")
    defense = [row for row in plan["rules_requests"] if row.get("kind") == "combat_defend"]
    assert defense == [{
        "kind": "combat_defend", "revision": 4, "actor_id": "inv1",
        "attack_command_id": "attack-1", "defense_kind": "dodge",
        "reason": "structured player combat defense",
    }]


def test_rule_override_fumble_forces_pressure(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    ctx["rule_signals"]["last_roll_fumble"] = True
    overrides = coc_story_director.apply_rule_signal_overrides(ctx)
    assert overrides["scene_action"] == "PRESSURE"


def test_low_agency_continuation_forces_authored_scene_pressure(tmp_path):
    """Repeated passive continuation yields initiative to the current scene.

    This is the live-play failure mode where "continue/follow the group" kept
    producing scenery instead of an actionable beat. The director should fire
    an authored pressure move only when the active scene actually provides one.
    """
    camp, char_path = _make_minimal_campaign(tmp_path)
    story_graph = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story_graph["scenes"][0]["available_clues"] = []
    story_graph["scenes"][0]["pressure_moves"] = [
        {"id": "shell-hole-rattle", "cue": "前方弹坑里传来一声短促的金属碰响。"}
    ]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story_graph))

    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["move"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))

    rich = {
        "primary_intent": "move",
        "secondary_intents": ["low_agency_continue", "follow_group"],
        "target_entities": ["patrol"],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [],
    }
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我继续跟着队伍走",
        player_intent_class="investigate",
        player_intent_rich=rich,
        rng=random.Random(42),
    )

    assert ctx["rule_signals"]["low_agency_continue_count"] == 2
    overrides = coc_story_director.apply_rule_signal_overrides(ctx)
    assert overrides["scene_action"] == "PRESSURE"

    plan = coc_story_director.generate_director_plan(ctx, decision_id="low-agency-pressure")

    assert plan["scene_action"] == "PRESSURE"
    assert plan["pressure_moves"]
    assert plan["pressure_moves"][0]["source"] == "active_scene.pressure_moves"
    assert "金属碰响" in plan["pressure_moves"][0]["visible_symptom"]


def test_low_agency_follow_adds_compressed_progress_directive(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0].update({
        "available_clues": [],
        "npc_ids": ["npc-authority"],
        "scene_tags": ["patrol", "under_command"],
        "authority_demands": ["scene_safety"],
        "responsibility_threats": ["group_survival"],
        "progress_contract": {
            "kind": "active_scene",
            "compression_budget": {"min_beats": 2, "max_beats": 5, "max_minutes": 8},
            "interrupts": ["threat_approaches", "npc_requests_specialist_judgment"],
        },
    })
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({
        "npcs": [{
            "npc_id": "npc-authority",
            "agenda": "keep the patrol moving while watching for danger",
            "social_role": {
                "authority_scope": ["scene_safety"],
                "responsibility_domains": ["group_survival"],
                "initiative_style": "decisive",
                "delegation_policy": {"keeps": ["scene_safety"], "delegates": ["specialist_care"]},
            },
        }]
    }))
    rich = {
        "primary_intent": "move",
        "secondary_intents": ["low_agency_continue", "follow_group", "yield_initiative"],
        "target_entities": ["patrol", "npc-authority"],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [],
    }

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我跟着班长",
        player_intent_class="move",
        player_intent_rich=rich,
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="compressed-low-agency")

    progress = plan["narrative_directives"]["dramatic_progress"]
    assert progress["mode"] == "compressed_progress"
    assert progress["reason"] == "low_agency_or_routine_posture"
    assert progress["compression_budget"]["max_beats"] == 5
    assert "npc_requests_specialist_judgment" in progress["advance_until"]
    assert "risk_requires_roll" in progress["advance_until"]
    assert "do not ask for another equivalent low-agency action" in progress["must_not"]
    assert progress["must_change_state"] is True


def test_routine_connective_action_adds_compressed_progress_directive(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0].update({
        "available_clues": [],
        "scene_type": "investigation",
        "dramatic_question": "能否整理完这一段资料？",
    })
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    rich = {
        "primary_intent": "investigate",
        "secondary_intents": ["routine_action", "connective_action", "continue_existing_strategy"],
        "target_entities": ["notes"],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [],
    }

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我继续整理这些资料",
        player_intent_class="investigate",
        player_intent_rich=rich,
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="compressed-routine")

    progress = plan["narrative_directives"]["dramatic_progress"]
    assert progress["mode"] == "compressed_progress"
    assert progress["trigger_tags"] == [
        "connective_action",
        "continue_existing_strategy",
        "investigate",
        "notes",
        "routine_action",
    ]
    assert progress["compression_budget"]["min_beats"] == 2
    assert "new_clue_or_obvious_information" in progress["advance_until"]


def test_routine_repetition_emits_scene_exit_pressure(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["available_clues"] = []
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))

    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["investigate", "investigate"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))
    rich = {
        "primary_intent": "investigate",
        "secondary_intents": ["routine_action", "routine_search"],
        "target_entities": ["same_room"],
        "action_atoms": [],
        "explicit_roll_request": False,
    }

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我继续搜这个房间",
        player_intent_class="investigate",
        player_intent_rich=rich,
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="scene-exit-pressure")

    pressure = plan["narrative_directives"]["scene_exit_pressure"]
    assert pressure["state"] in {"compress", "cut", "montage"}
    assert "no_new_axis" in pressure["reasons"]
    assert "low_agency_repetition" not in pressure["reasons"]
    assert "bridge_exhausted" not in pressure["reasons"]
    assert pressure["must_change_state"] is True


def test_low_agency_continue_uses_scene_exit_pressure_v2_reason(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["available_clues"] = []
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["follow", "follow"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))
    rich = {
        "primary_intent": "follow",
        "secondary_intents": ["continue_existing_strategy"],
        "target_entities": ["group"],
        "action_atoms": [],
    }

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我继续跟着",
        player_intent_class="follow",
        player_intent_rich=rich,
        rng=random.Random(42),
    )
    ctx["rule_signals"]["low_agency_continue_count"] = 2
    plan = coc_story_director.generate_director_plan(ctx, decision_id="scene-exit-repetition")

    reasons = plan["narrative_directives"]["scene_exit_pressure"]["reasons"]
    assert "repetition_detected" in reasons
    assert "low_agency_repetition" not in reasons


def test_low_agency_continue_exceeding_max_beats_forces_budget_exceeded(tmp_path):
    """P1-1: when low_agency_continue_count >= compression_budget.max_beats,
    the scene_exit_pressure directive emits a budget_exceeded reason and
    must_change_state (forcing an exit from the indefinite routine loop)."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    # No new clues axis, no pressure, no bridge kind -> isolate the budget cap.
    story["scenes"][0]["available_clues"] = []
    story["scenes"][0].pop("pressure_moves", None)
    story["scenes"][0]["progress_contract"] = {
        "kind": "active_scene",
        "compression_budget": {"min_beats": 1, "max_beats": 2, "max_minutes": 8},
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))

    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["follow", "follow"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))
    rich = {
        "primary_intent": "follow",
        "secondary_intents": ["continue_existing_strategy"],
        "target_entities": ["group"],
        "action_atoms": [],
    }

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我继续跟着",
        player_intent_class="follow",
        player_intent_rich=rich,
        rng=random.Random(42),
    )
    # count (3) >= max_beats (2) -> budget cap fires.
    ctx["rule_signals"]["low_agency_continue_count"] = 3

    plan = coc_story_director.generate_director_plan(
        ctx, decision_id="budget-cap-exceeded"
    )

    pressure = plan["narrative_directives"]["scene_exit_pressure"]
    assert "budget_exceeded" in pressure["internal_reasons"]
    assert pressure["must_change_state"] is True


def test_compression_budget_max_beats_is_not_weakened_by_legacy_max_low_agency_turns(tmp_path):
    """When both fields exist, compression_budget.max_beats is the authoritative
    cap; max_low_agency_turns is only a compatibility fallback."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["available_clues"] = []
    story["scenes"][0].pop("pressure_moves", None)
    story["scenes"][0]["progress_contract"] = {
        "kind": "active_scene",
        "compression_budget": {"min_beats": 1, "max_beats": 2, "max_minutes": 8},
        "max_low_agency_turns": 5,
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))

    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["follow", "follow"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))

    rich = {
        "primary_intent": "follow",
        "secondary_intents": ["continue_existing_strategy"],
        "target_entities": ["group"],
        "action_atoms": [],
    }
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我继续跟着",
        player_intent_class="follow",
        player_intent_rich=rich,
        rng=random.Random(42),
    )

    plan = coc_story_director.generate_director_plan(
        ctx, decision_id="budget-cap-precedence"
    )

    pressure = plan["narrative_directives"]["scene_exit_pressure"]
    assert pressure["low_agency_continue_count"] == 3
    assert pressure["max_beats"] == 2
    assert "budget_exceeded" in pressure["internal_reasons"]


def test_low_agency_continue_below_max_beats_does_not_emit_budget_exceeded(tmp_path):
    """P1-1: below the cap, no budget_exceeded reason is added (no behavior change)."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["available_clues"] = []
    story["scenes"][0].pop("pressure_moves", None)
    story["scenes"][0]["progress_contract"] = {
        "kind": "active_scene",
        "compression_budget": {"min_beats": 1, "max_beats": 4, "max_minutes": 8},
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))

    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["follow"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))
    rich = {
        "primary_intent": "follow",
        "secondary_intents": ["continue_existing_strategy"],
        "target_entities": ["group"],
        "action_atoms": [],
    }

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我继续跟着",
        player_intent_class="follow",
        player_intent_rich=rich,
        rng=random.Random(42),
    )
    # count (2) < max_beats (4) -> cap does not fire.
    ctx["rule_signals"]["low_agency_continue_count"] = 2

    plan = coc_story_director.generate_director_plan(
        ctx, decision_id="budget-cap-not-reached"
    )

    # Repetition reason may still fire (count>=2) but budget_exceeded must not.
    pressure = plan["narrative_directives"].get("scene_exit_pressure")
    if pressure:
        assert "budget_exceeded" not in pressure["internal_reasons"]


def test_dramatic_pacing_does_not_compress_when_roll_is_required(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    rich = {
        "primary_intent": "investigate",
        "secondary_intents": ["routine_action"],
        "target_entities": ["room"],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [],
    }

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我继续搜房间",
        player_intent_class="investigate",
        player_intent_rich=rich,
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="no-compress-roll")

    assert plan["scene_action"] == "REVEAL"
    assert any(req["kind"] == "skill_check" for req in plan["rules_requests"])
    assert "dramatic_progress" not in plan["narrative_directives"]


def test_dramatic_pacing_does_not_compress_meaningful_choice(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["available_clues"] = ["clue-1", "clue-1b"]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我不知道该做什么",
        player_intent_class="idle",
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="no-compress-choice")

    assert plan["scene_action"] == "CHOICE"
    assert "dramatic_progress" not in plan["narrative_directives"]


def test_live_active_scene_preserves_structured_director_fields(tmp_path):
    camp, char_path = _make_legacy_live_campaign(tmp_path)
    active = json.loads((camp / "save" / "active-scene.json").read_text())
    active.update({
        "scene_type": "travel",
        "scene_kind": "bridge",
        "scene_tags": ["travel_under_pressure"],
        "authority_demands": ["scene_safety"],
        "responsibility_threats": ["group_survival"],
        "progress_contract": {
            "kind": "bridge",
            "max_low_agency_turns": 1,
            "fallback_action": "MONTAGE",
            "exit_directive": "cut to the next meaningful decision point",
        },
    })
    (camp / "save" / "active-scene.json").write_text(json.dumps(active))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我继续跟着走",
        player_intent_class="move",
        rng=random.Random(42),
    )

    scene = ctx["active_scene"]
    assert scene["scene_kind"] == "bridge"
    assert scene["scene_tags"] == ["travel_under_pressure"]
    assert scene["authority_demands"] == ["scene_safety"]
    assert scene["responsibility_threats"] == ["group_survival"]
    assert scene["progress_contract"]["fallback_action"] == "MONTAGE"


def test_low_agency_bridge_without_new_axis_forces_montage_cut(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story_graph = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story_graph["scenes"][0].update({
        "scene_type": "travel",
        "scene_kind": "bridge",
        "available_clues": [],
        "exit_conditions": [],
        "pressure_moves": [],
        "progress_contract": {
            "kind": "bridge",
            "max_low_agency_turns": 1,
            "fallback_action": "MONTAGE",
            "exit_directive": "leave the bridge and cut to the next actionable scene",
        },
    })
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story_graph))

    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["move"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))

    rich = {
        "primary_intent": "move",
        "secondary_intents": ["low_agency_continue", "follow_group"],
        "target_entities": ["group"],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [],
    }
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我继续跟着队伍走",
        player_intent_class="move",
        player_intent_rich=rich,
        rng=random.Random(42),
    )

    assert ctx["rule_signals"]["low_agency_continue_count"] == 2
    overrides = coc_story_director.apply_rule_signal_overrides(ctx)
    assert overrides["scene_action"] == "MONTAGE"

    plan = coc_story_director.generate_director_plan(ctx, decision_id="bridge-governor")

    assert plan["scene_action"] == "MONTAGE"
    progress = plan["narrative_directives"]["scene_progress"]
    assert progress["action"] == "force_transition"
    assert progress["reason"] == "low_agency_bridge_exhausted"
    assert progress["exit_directive"] == "leave the bridge and cut to the next actionable scene"


def test_legacy_live_scene_transition_gets_default_bridge_governor(tmp_path):
    camp, char_path = _make_legacy_live_campaign(tmp_path)
    active = json.loads((camp / "save" / "active-scene.json").read_text())
    active.update({
        "source_event_type": "scene_transition",
        "scene_type": "exploration",
        "available_clues": [],
        "pressure_moves": [],
        "progress_contract": {},
    })
    (camp / "save" / "active-scene.json").write_text(json.dumps(active))
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["move"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))

    rich = {
        "primary_intent": "move",
        "secondary_intents": ["low_agency_continue"],
        "target_entities": ["group"],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [],
    }
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="继续",
        player_intent_class="move",
        player_intent_rich=rich,
        rng=random.Random(42),
    )

    plan = coc_story_director.generate_director_plan(ctx, decision_id="legacy-live-bridge")

    assert plan["scene_action"] == "MONTAGE"
    progress = plan["narrative_directives"]["scene_progress"]
    assert progress["reason"] == "low_agency_bridge_exhausted"
    assert progress["scene_kind"] == "live_transition"


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


def test_temp_insane_underlying_does_not_force_subsystem(tmp_path):
    """p.158: during underlying insanity the player retains full control —
    temp_insane alone must not force the sanity subsystem takeover."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    ctx["rule_signals"]["bout_active"] = False
    ctx["rule_signals"]["sanity_state"] = "temp_insane"
    overrides = coc_story_director.apply_rule_signal_overrides(ctx)
    assert overrides is None or overrides.get("subsystem") != "sanity"


def test_bout_subsystem_emits_playout_directive_not_san_roll(tmp_path):
    """p.156-157: a bout is a Keeper-takeover playout, not a SAN roll to
    'regain control' — no such roll exists in the rulebook."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    ctx["rule_signals"]["bout_active"] = True
    ctx["rule_signals"]["sanity_state"] = "bout_active"
    requests = coc_story_director._build_rules_requests(ctx, "SUBSYSTEM")
    kinds = [r.get("kind") for r in requests]
    assert "bout_playout" in kinds
    assert "sanity_check" not in kinds
    playout = next(r for r in requests if r["kind"] == "bout_playout")
    assert playout["keeper_controls_investigator"] is True
    assert "roll_contract" not in playout


def test_generate_plan_reveal_includes_clue_policy(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我检查门框", player_intent_class="investigate", rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="d1")
    assert plan["scene_action"] == "REVEAL"
    assert len(plan["clue_policy"]["reveal"]) >= 1
    mnr_ids = {
        item["id"] if isinstance(item, dict) else item
        for item in plan["narrative_directives"]["must_not_reveal"]
    }
    assert "secret-1" in mnr_ids
    assert all(
        isinstance(item, dict) and set(item.keys()) == {"id", "category"}
        for item in plan["narrative_directives"]["must_not_reveal"]
    )


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


def test_generate_plan_player_style_includes_repetition_compression_policy(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )

    plan = coc_story_director.generate_director_plan(ctx, decision_id="style-policy")
    style = plan["narrative_directives"]["player_facing_style"]

    policy = style["repetition_policy"]
    assert policy["established_fact_mode"] == "compress"
    assert policy["repeat_foreign_dialogue"] == "summarize_unless_new_information"
    assert "semantic_repetition" in style["avoid"]


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
    """A clue with structured delivery_kind=handout is obvious and skips the Spot Hidden roll."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # rewrite clue-graph so clue-1 is delivered as a Handout (no skill roll)
    cg = {"conclusions": [{"conclusion_id": "concl-1", "importance": "critical",
            "minimum_routes": 3,
            "clues": [{"clue_id": "clue-1", "delivery": "Handout 1 — Mr. X gives this directly",
                       "delivery_kind": "handout", "visibility": "player-safe"},
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


def test_resolve_clue_delivery_never_scans_delivery_prose():
    """Without delivery_kind, delivery prose is NEVER keyword-scanned: a
    Handout-looking delivery string still defaults to obscured (Semantic
    Matcher Constitution — conservative structured default, no prose
    inference)."""
    cg = {"conclusions": [{"conclusion_id": "c1", "clues": [
        {"clue_id": "known", "delivery": "Handout"}], "fallback_policy": ""}]}
    assert coc_story_director._resolve_clue_delivery("missing-clue", cg) == ("obscured", None, None)
    assert coc_story_director._resolve_clue_delivery(None, cg) == ("obscured", None, None)
    # legacy heuristic would have said "obvious" for a Handout delivery string;
    # the structured-only path defaults to obscured + delivery warning instead.
    assert coc_story_director._resolve_clue_delivery("known", cg) == ("obscured", None, None)
    assert not hasattr(coc_story_director, "_OBSCURED_DELIVERY_TRIGGERS")
    assert not hasattr(coc_story_director, "_infer_clue_type")


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
    # R1-Z D4: pacing_mode stays action-derived; tension_target is its own field.
    assert plan["pacing_mode"] == "investigation"
    assert plan["tension_target"] == "high"


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
    assert plan["pacing_mode"] in ("investigation", "pressure", "social")
    assert plan.get("tension_target") in (None, "", "low", "medium", "high", "climax")


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


def test_resolve_delivery_structured_skill_check(tmp_path):
    """delivery_kind=skill_check -> obscured + skill + difficulty."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    cg = {"conclusions": [{"conclusion_id": "c1", "importance": "critical", "minimum_routes": 3,
        "clues": [
            {"clue_id": "clue-1", "delivery": "Spot Hidden", "visibility": "player-safe",
             "delivery_kind": "skill_check", "skill": "Spot Hidden", "difficulty": "hard"},
            {"clue_id": "clue-1b", "delivery": "x", "visibility": "player-safe"},
            {"clue_id": "clue-1c", "delivery": "y", "visibility": "player-safe"}],
        "fallback_policy": ""}]}
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(cg))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "dk-skill")
    assert plan["clue_policy"]["clue_type"] == "obscured"
    assert plan["clue_policy"]["skill"] == "Spot Hidden"
    # rules_requests should use the structured skill + difficulty
    rr = plan["rules_requests"]
    assert any(r["skill"] == "Spot Hidden" and r["difficulty"] == "hard" for r in rr)


def test_resolve_delivery_structured_obvious(tmp_path):
    """delivery_kind=handout -> obvious, no rules request."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    cg = {"conclusions": [{"conclusion_id": "c1", "importance": "critical", "minimum_routes": 3,
        "clues": [
            {"clue_id": "clue-1", "delivery": "Handout 1", "visibility": "player-safe",
             "delivery_kind": "handout", "player_safe_summary": "诺特先生给的钥匙和委托"},
            {"clue_id": "clue-1b", "delivery": "x", "visibility": "player-safe"},
            {"clue_id": "clue-1c", "delivery": "y", "visibility": "player-safe"}],
        "fallback_policy": ""}]}
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(cg))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "dk-obvious")
    assert plan["clue_policy"]["clue_type"] == "obvious"
    assert plan["clue_policy"]["skill"] is None
    assert "诺特先生给的钥匙和委托" in plan["narrative_directives"]["must_include"]


def test_resolve_delivery_fallback_when_no_delivery_kind(tmp_path):
    """Old clue-graph without delivery_kind defaults to obscured (no prose scan)."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # default _make_minimal_campaign clues have no delivery_kind -> conservative default
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "dk-fallback")
    # no delivery_kind -> conservative obscured default + delivery warning
    assert plan["clue_policy"]["clue_type"] == "obscured"
    assert any(
        warning.get("fallback_mode") == "conservative_obscured_default"
        for warning in plan["clue_policy"]["delivery_warnings"]
    )


def test_critical_legacy_delivery_fallback_emits_warning(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="search",
        player_intent_class="investigate",
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, "legacy-delivery-warning")

    warnings = plan["clue_policy"]["delivery_warnings"]
    assert warnings
    assert any("legacy delivery" in warning["reason"] for warning in warnings)
    assert any("clue-1" in warning["reason"] for warning in warnings)


def test_resolve_delivery_skill_check_missing_skill_defaults_spot_hidden(tmp_path):
    """delivery_kind=skill_check without skill -> obscured, skill None -> rules request
    falls back to Spot Hidden / regular (validator separately warns)."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    cg = {"conclusions": [{"conclusion_id": "c1", "importance": "critical", "minimum_routes": 3,
        "clues": [
            {"clue_id": "clue-1", "delivery": "x", "visibility": "player-safe",
             "delivery_kind": "skill_check"},  # skill omitted
            {"clue_id": "clue-1b", "delivery": "x", "visibility": "player-safe"},
            {"clue_id": "clue-1c", "delivery": "y", "visibility": "player-safe"}],
        "fallback_policy": ""}]}
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(cg))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "dk-no-skill")
    assert plan["clue_policy"]["clue_type"] == "obscured"
    rr = plan["rules_requests"]
    # falls back to Spot Hidden / regular when skill missing
    assert any(r["skill"] == "Spot Hidden" and r["difficulty"] == "regular" for r in rr)


def test_content_constraints_passed_from_module_meta(tmp_path):
    """content_flags in module-meta reach narrative_directives.content_constraints."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # rewrite module-meta to add content_flags
    mm = json.loads((camp / "scenario" / "module-meta.json").read_text())
    mm["content_flags"] = ["cannibalism", "body_horror"]
    (camp / "scenario" / "module-meta.json").write_text(json.dumps(mm))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "cc-test")
    assert plan["narrative_directives"]["content_constraints"] == ["cannibalism", "body_horror"]


def test_content_constraints_empty_when_no_flags(tmp_path):
    """No content_flags in module-meta -> content_constraints is [] (not missing)."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "cc-empty")
    assert plan["narrative_directives"]["content_constraints"] == []


# =============================================================================
# Lead graph: clue selection by route_priority + CHOICE leads (R2)
# =============================================================================

def test_reveal_picks_highest_priority_clue(tmp_path):
    """REVEAL picks the clue with highest route_priority, not just the first."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # rewrite clue-graph: clue-1 priority 0.3, clue-1b priority 0.9
    # scene-1 available_clues must include both; currently _make_minimal_campaign's scene-1
    # has available_clues ["clue-1"]. We need a scene with 2+ available clues.
    sg = json.loads((camp / "scenario" / "story-graph.json").read_text())
    sg["scenes"][0]["available_clues"] = ["clue-1", "clue-1b"]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    cg = {"conclusions": [{"conclusion_id": "c1", "importance": "critical", "minimum_routes": 3,
        "clues": [
            {"clue_id": "clue-1", "delivery": "x", "visibility": "player-safe", "route_priority": 0.3},
            {"clue_id": "clue-1b", "delivery": "y", "visibility": "player-safe", "route_priority": 0.9},
            {"clue_id": "clue-1c", "delivery": "z", "visibility": "player-safe"}],
        "fallback_policy": ""}]}
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(cg))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "priority-test")
    # REVEAL should pick clue-1b (priority 0.9) not clue-1 (priority 0.3)
    assert plan["clue_policy"]["reveal"] == ["clue-1b"]


def test_reveal_falls_back_to_first_when_no_priority(tmp_path):
    """No route_priority on any clue -> stable order, takes first (backward compat)."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "no-priority")
    # default fixture clue-1 is first available; all default 0.5 -> stable
    assert "clue-1" in plan["clue_policy"]["reveal"]


def test_choice_returns_two_leads(tmp_path):
    """CHOICE action returns 2 leads ranked by priority."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    sg = json.loads((camp / "scenario" / "story-graph.json").read_text())
    sg["scenes"][0]["available_clues"] = ["clue-1", "clue-1b", "clue-1c"]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    cg = {"conclusions": [{"conclusion_id": "c1", "importance": "critical", "minimum_routes": 3,
        "clues": [
            {"clue_id": "clue-1", "delivery": "x", "visibility": "player-safe", "route_priority": 0.3},
            {"clue_id": "clue-1b", "delivery": "y", "visibility": "player-safe", "route_priority": 0.9},
            {"clue_id": "clue-1c", "delivery": "z", "visibility": "player-safe", "route_priority": 0.7}],
        "fallback_policy": ""}]}
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(cg))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="不知道", player_intent_class="idle", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "choice-leads")
    # CHOICE triggers on idle intent; check leads field has 2 entries ranked
    leads = plan["clue_policy"].get("leads", [])
    assert len(leads) == 2
    assert leads[0] == "clue-1b"  # highest priority 0.9
    assert leads[1] == "clue-1c"  # second highest 0.7


def test_low_agency_tags_unified_covers_continue_existing_strategy():
    # continue_existing_strategy previously only in _ROUTINE_PROGRESS_TAGS; now low-agency too
    ctx = {"player_intent_rich": {"secondary_intents": ["continue_existing_strategy"]}}
    assert coc_story_director._is_low_agency_continue(ctx) is True


def test_low_agency_tags_covers_yield_initiative_via_class():
    ctx = {"player_intent_class": "yield_initiative"}
    assert coc_story_director._is_low_agency_continue(ctx) is True


def test_low_agency_tags_unified_is_single_source():
    # _LOW_AGENCY_TAGS is the authority; key members present
    for member in ("move", "continue", "follow", "low_agency_continue",
                   "continue_existing_strategy", "yield_initiative", "passive_follow"):
        assert member in coc_story_director._LOW_AGENCY_TAGS, f"missing {member}"


def test_low_agency_count_accumulates_from_persisted_tags():
    """P0-2b: cross-turn count must accumulate from recent_intent_tags, not just
    recent_intent_classes. Past turns tagged low_agency_continue (even if their
    intent_class was 'investigate') should extend the count."""
    # Build ctx where current turn is low-agency via class 'move'
    ctx = {"player_intent_class": "move"}
    # recent_intents (classes) are non-low-agency 'investigate', but their tags are low-agency
    recent_classes = ["investigate", "investigate"]
    recent_tags = [["low_agency_continue"], ["yield_initiative"]]
    count = coc_story_director._low_agency_continue_count(
        recent_classes, ctx, recent_intent_tags=recent_tags)
    # current (1) + 2 past low-agency-via-tag turns = 3
    assert count == 3


def test_low_agency_count_back_compat_without_tags_param():
    """When recent_intent_tags is not passed (old caller), behavior is unchanged."""
    ctx = {"player_intent_class": "move"}
    count = coc_story_director._low_agency_continue_count(
        ["investigate", "move"], ctx)
    # current 'move' counts (1); walking back: 'move' counts (+1), 'investigate' stops
    assert count == 2


# --------------------------------------------------------------------------- #
# W1-2: personal horror hooks (p.157, p.193-194)
# --------------------------------------------------------------------------- #

def test_build_director_context_exposes_personal_horror_hooks(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    inv_path = camp / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv["personal_horror_hooks"] = [
        {"hook_id": "hook-sister", "backstory_field": "significant_people",
         "summary": "Her sister vanished in 1918.", "woven": False},
    ]
    inv_path.write_text(json.dumps(inv))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我和教授聊聊", player_intent_class="social",
        rng=random.Random(42),
    )
    assert ctx["personal_horror_hooks"][0]["hook_id"] == "hook-sister"


def test_character_action_weaves_unwoven_hook_first():
    hooks = [
        {"hook_id": "h-old", "backstory_field": "traits",
         "summary": "already used", "woven": True},
        {"hook_id": "h-new", "backstory_field": "significant_people",
         "summary": "sister vanished", "woven": False},
    ]
    directive = coc_story_director._personal_horror_directive(
        {"personal_horror_hooks": hooks}, "CHARACTER")
    assert directive["hook_id"] == "h-new"
    assert directive["use"] == "weave"
    assert directive["backstory_field"] == "significant_people"


def test_payoff_action_echoes_woven_hook():
    hooks = [
        {"hook_id": "h-old", "backstory_field": "treasured_possessions",
         "summary": "the watch", "woven": True},
        {"hook_id": "h-new", "backstory_field": "traits",
         "summary": "unused", "woven": False},
    ]
    directive = coc_story_director._personal_horror_directive(
        {"personal_horror_hooks": hooks}, "PAYOFF")
    assert directive["hook_id"] == "h-old"
    assert directive["use"] == "echo"


def test_personal_horror_directive_absent_for_other_actions_or_no_hooks():
    hooks = [{"hook_id": "h", "backstory_field": "traits",
              "summary": "s", "woven": False}]
    assert coc_story_director._personal_horror_directive(
        {"personal_horror_hooks": hooks}, "PRESSURE") is None
    assert coc_story_director._personal_horror_directive(
        {"personal_horror_hooks": []}, "CHARACTER") is None


# --------------------------------------------------------------------------- #
# W1-3: delusion_seed directive (p.162-163)
# --------------------------------------------------------------------------- #

def _underlying_delusion_ctx(hooks=None, bout_active=False, indefinite=True):
    """Minimal ctx for an investigator in the underlying-insanity phase."""
    return {
        "personal_horror_hooks": hooks or [
            {"hook_id": "h-woven", "backstory_field": "significant_people",
             "summary": "sister vanished", "woven": True},
            {"hook_id": "h-new", "backstory_field": "traits",
             "summary": "unused", "woven": False},
        ],
        "rule_signals": {
            "indefinite_insane": indefinite,
            "bout_active": bout_active,
        },
        "sanity_engine_state": {"temporary_insane": False},
    }


def test_delusion_directive_on_deepen_during_underlying():
    seed = coc_story_director._delusion_directive(
        _underlying_delusion_ctx(), "DEEPEN")
    assert seed is not None
    assert seed["hook_id"] == "h-woven"  # prefer woven
    assert seed["backstory_field"] == "significant_people"
    assert "instruction" in seed


def test_delusion_directive_on_pressure_during_underlying():
    seed = coc_story_director._delusion_directive(
        _underlying_delusion_ctx(), "PRESSURE")
    assert seed is not None
    assert seed["hook_id"] == "h-woven"


def test_delusion_directive_suppressed_during_bout():
    assert coc_story_director._delusion_directive(
        _underlying_delusion_ctx(bout_active=True), "DEEPEN") is None


def test_delusion_directive_absent_when_sane():
    ctx = _underlying_delusion_ctx(indefinite=False)
    ctx["rule_signals"]["indefinite_insane"] = False
    ctx["sanity_engine_state"] = {"temporary_insane": False}
    assert coc_story_director._delusion_directive(ctx, "DEEPEN") is None


def test_delusion_directive_absent_for_other_actions():
    assert coc_story_director._delusion_directive(
        _underlying_delusion_ctx(), "CHARACTER") is None
    assert coc_story_director._delusion_directive(
        _underlying_delusion_ctx(), "REVEAL") is None


# --------------------------------------------------------------------------- #
# W1-5: early-horror trope boosts + mythos presentation directive
# --------------------------------------------------------------------------- #

_EARLY_HORROR_TROPES = ("mundane_expectation_break", "cognitive_dissonance")


def test_early_horror_trope_boost_on_ordinary_pressure():
    boosts = coc_story_director._early_horror_trope_boosts("ordinary", "PRESSURE")
    assert boosts is not None
    for trope in _EARLY_HORROR_TROPES:
        assert boosts[trope] > 1.0


def test_early_horror_trope_boost_on_wrongness_deepen():
    boosts = coc_story_director._early_horror_trope_boosts("wrongness", "DEEPEN")
    assert boosts is not None
    for trope in _EARLY_HORROR_TROPES:
        assert boosts[trope] > 1.0


def test_early_horror_trope_boost_absent_at_revelation():
    assert coc_story_director._early_horror_trope_boosts("revelation", "PRESSURE") is None
    assert coc_story_director._early_horror_trope_boosts("revelation", "DEEPEN") is None
    assert coc_story_director._early_horror_trope_boosts("pattern", "PRESSURE") is None
    assert coc_story_director._early_horror_trope_boosts("ordinary", "REVEAL") is None


def test_mythos_presentation_directive_from_structured_monster_id():
    ctx = {
        "active_scene": {"monster_ids": ["Ghoul"]},
        "rng": random.Random(42),
    }
    directive = coc_story_director._mythos_presentation_directive(ctx, "PRESSURE")
    assert directive is not None
    assert directive["monster_id"] == "Ghoul"
    assert directive["never_name_until"] == "revelation"
    assert 1 <= len(directive["sensory_signature_sample"]) <= 2
    assert all(isinstance(s, str) and s for s in directive["sensory_signature_sample"])
    assert directive["horror_stage"] in coc_story_director.VALID_HORROR_STAGES


def test_mythos_presentation_directive_none_without_structured_monster():
    ctx = {
        "active_scene": {"scene_id": "empty-room", "tone": ["quiet"]},
        "threat_fronts": {"fronts": [{"front_id": "awareness"}]},
        "rng": random.Random(42),
    }
    assert coc_story_director._mythos_presentation_directive(ctx, "PRESSURE") is None
    assert coc_story_director._mythos_presentation_directive(ctx, "DEEPEN") is None


# --- R1-Z director quick fixes ---


def test_luck_zero_is_not_replaced_by_default(tmp_path):
    """E1: Luck=0 must not truthiness-fallback to characteristics LUCK."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    char = json.loads(char_path.read_text())
    char["derived"]["Luck"] = 0
    # Leave characteristics.LUCK at 55 — the buggy `or` chain would use it.
    char_path.write_text(json.dumps(char))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42),
    )
    assert ctx["rule_signals"]["luck_level"] == "depleted"


def test_play_language_threads_into_player_facing_style(tmp_path):
    """E2: campaign play_language must reach player_facing_style.language."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    (camp / "campaign.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "test",
        "play_language": "ja-JP",
    }))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42),
    )
    assert ctx["play_language"] == "ja-JP"
    plan = coc_story_director.generate_director_plan(ctx, "lang-test")
    assert plan["narrative_directives"]["player_facing_style"]["language"] == "ja-JP"


def test_npc_secret_limit_never_carries_secret_prose():
    """B1: Chinese (space-less) secret prose must not land in the plan."""
    secret = "他其实是邪教内应并且知道地下室的真相"
    ctx = {
        "active_scene": {"npc_ids": ["npc-cultist"]},
        "npc_agendas": {"npcs": [{
            "npc_id": "npc-cultist",
            "agenda": "mislead investigators",
            "secret": secret,
            "secret_id": "secret-cultist-cover",
        }]},
        "rule_signals": {"app": 50, "credit_rating": 50, "npc_reaction_roll": None},
        "rng": random.Random(42),
    }
    moves = coc_story_director._build_npc_moves(ctx, "CHARACTER")
    assert moves[0]["has_secret"] is True
    assert moves[0]["secret_limit"] == "do not reveal this NPC's secret"
    assert secret not in json.dumps(moves[0], ensure_ascii=False)
    assert moves[0].get("secret_id") == "secret-cultist-cover"


def test_recover_time_profile_is_short_investigation_recovery():
    """D3: RECOVER proposes investigation recovery, not overnight sleep."""
    profile = coc_story_director._ACTION_TIME_PROFILES["RECOVER"]
    assert profile["mode"] == "elapsed"
    assert profile["category"] == "investigation_recovery"
    assert profile["delta_minutes"] == 30

    advance = coc_story_director._derive_time_advance(
        "RECOVER", {"hours_since_last_rest": 2, "time_pressure": "low"},
    )
    assert advance["category"] == "investigation_recovery"
    assert advance["delta_minutes"] == 30
    assert advance["mode"] == "elapsed"


def test_reveal_quick_observation_in_extreme_cold_uses_short_profile():
    ctx = {
        "active_scene": {"scene_tags": ["extreme_cold"]},
        "intent_detail": "quick_observation",
    }

    profile = coc_story_director._time_profile_for_action("REVEAL", ctx)

    assert profile["category"] == "quick_observation"
    assert profile["delta_minutes"] <= 5


def test_authored_room_search_time_profile_wins_over_quick_cold_observation():
    ctx = {
        "active_scene": {
            "scene_tags": ["extreme_cold"],
            "time_profile": {"category": "single_room_search"},
        },
        "intent_detail": "quick_observation",
    }

    profile = coc_story_director._time_profile_for_action("REVEAL", ctx)

    assert profile["category"] == "single_room_search"
    assert profile["delta_minutes"] == 20


def test_reveal_without_structured_time_detail_keeps_room_search_default():
    cold_profile = coc_story_director._time_profile_for_action(
        "REVEAL", {"active_scene": {"scene_tags": ["extreme_cold"]}},
    )
    ordinary_profile = coc_story_director._time_profile_for_action(
        "REVEAL", {"active_scene": {"scene_tags": []}},
    )

    assert cold_profile["category"] == "single_room_search"
    assert cold_profile["delta_minutes"] == 20
    assert ordinary_profile == cold_profile


def test_pacing_mode_stays_action_derived_when_tension_target_present(tmp_path):
    """D4: tension_target must not overwrite pacing_mode."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    pm = {"pacing_curve": [
        {"scene_id": "scene-1", "tension_target": "climax", "horror_stage": "revelation"},
    ]}
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps(pm))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, "pacing-split")
    assert plan["pacing_mode"] == "investigation"
    assert plan["tension_target"] == "climax"
    assert plan["pacing_mode"] not in ("low", "medium", "high", "climax")


# --------------------------------------------------------------------------- #
# Believer → mythos_bleak tone (p.212 / W2-6)
# --------------------------------------------------------------------------- #
def test_believer_injects_mythos_bleak_tone(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    inv_path = camp / "save" / "investigator-state" / "inv1.json"
    state = json.loads(inv_path.read_text(encoding="utf-8"))
    state["believer"] = True
    inv_path.write_text(json.dumps(state), encoding="utf-8")

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42),
    )
    assert ctx.get("believer") is True
    plan = coc_story_director.generate_director_plan(ctx, "believer-tone")
    tone = plan["narrative_directives"]["tone"]
    assert isinstance(tone, list)
    assert "mythos_bleak" in tone
    assert "tense" in tone  # scene tone preserved


def test_non_believer_does_not_inject_mythos_bleak(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    # Default fixture has no believer field
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42),
    )
    assert ctx.get("believer") is not True
    plan = coc_story_director.generate_director_plan(ctx, "no-believer-tone")
    tone = plan["narrative_directives"]["tone"]
    assert "mythos_bleak" not in tone


def test_believer_false_does_not_inject_mythos_bleak(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    inv_path = camp / "save" / "investigator-state" / "inv1.json"
    state = json.loads(inv_path.read_text(encoding="utf-8"))
    state["believer"] = False
    inv_path.write_text(json.dumps(state), encoding="utf-8")

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, "believer-false-tone")
    assert "mythos_bleak" not in plan["narrative_directives"]["tone"]


def test_move_intent_with_unlocked_reachable_target_selects_cut(tmp_path):
    """Acceptance defect: move + unlocked edge target must propose CUT/transition.

    Narrative exit_conditions alone must not block a structured move intent when
    transition_candidates is non-empty (R-3 unlock already landed).
    """
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = {
        "scenes": [
            {
                "scene_id": "mission-briefing",
                "scene_type": "social",
                "dramatic_question": "Will they accept?",
                "entry_conditions": [],
                "exit_conditions": ["orders_received", "patrol_armed_and_briefed"],
                "available_clues": ["clue-briefing"],
                "npc_ids": ["npc-commander"],
                "pressure_moves": [],
                "tone": ["cold"],
                "allowed_improvisation": [],
            },
            {
                "scene_id": "crossing-saddle",
                "scene_type": "exploration",
                "dramatic_question": "Can they cross?",
                "entry_conditions": [],
                "exit_conditions": [],
                "available_clues": ["clue-saddle"],
                "npc_ids": [],
                "pressure_moves": [],
                "tone": ["tense"],
                "allowed_improvisation": [],
            },
        ]
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({
        "npcs": [{"npc_id": "npc-commander", "agenda": "withhold the true objective", "desire": "keep order"}]
    }))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "mission-briefing"
    world["discovered_clue_ids"] = ["clue-briefing"]
    world["unlocked_scene_ids"] = ["mission-briefing", "crossing-saddle"]
    world["visited_scene_ids"] = []
    world["exhausted_scene_ids"] = []
    world["scene_history"] = []
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我们沿鞍部侧脊推进。",
        player_intent_class="move",
        rng=random.Random(42),
    )
    score = coc_story_director._base_score("CUT", ctx)
    assert score >= 0.9
    plan = coc_story_director.generate_director_plan(ctx, decision_id="move-cut-1")
    assert plan["scene_action"] == "CUT"
    assert plan.get("transition_to") == "crossing-saddle"


def test_stalled_turns_raise_cut_score_when_transition_candidates_exist(tmp_path):
    """Existing stalled_turns pacing should raise CUT pressure when a target is open."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"].append({
        "scene_id": "scene-2",
        "scene_type": "investigation",
        "dramatic_question": "next?",
        "entry_conditions": [],
        "exit_conditions": [],
        "available_clues": ["clue-2"],
        "npc_ids": [],
        "pressure_moves": [],
        "tone": ["tense"],
        "allowed_improvisation": [],
    })
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["unlocked_scene_ids"] = ["scene-1", "scene-2"]
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["idle", "idle"]
    (camp / "save" / "pacing-state.json").write_text(json.dumps(pacing))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="……",
        player_intent_class="idle",
        rng=random.Random(42),
    )
    assert ctx["rule_signals"]["stalled_turns"] >= 2
    score = coc_story_director._base_score("CUT", ctx)
    assert score > 0.0


def test_move_intent_target_entities_route_to_matched_scene(tmp_path):
    """Acceptance: target_entities ['corbitt house'] must beat default edge order."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = {
        "scenes": [
            {
                "scene_id": "commission-briefing",
                "is_start": True,
                "scene_type": "social",
                "dramatic_question": "Accept?",
                "entry_conditions": [],
                "exit_conditions": [{"kind": "narrative", "description": "leave"}],
                "available_clues": ["clue-leads"],
                "npc_ids": ["npc-knott"],
                "pressure_moves": [],
                "tone": ["daylight"],
                "allowed_improvisation": [],
                "location_tags": ["briefing", "knott", "委托"],
                "scene_edges": [
                    {
                        "to": "hall-of-records",
                        "kind": "unlock",
                        "when": {"kind": "clue_discovered", "clue_id": "clue-leads"},
                    },
                    {
                        "to": "corbitt-house-ground",
                        "kind": "unlock",
                        "when": {"kind": "clue_discovered", "clue_id": "clue-keys"},
                    },
                ],
            },
            {
                "scene_id": "hall-of-records",
                "scene_type": "investigation",
                "dramatic_question": "Records?",
                "entry_conditions": [],
                "exit_conditions": [],
                "available_clues": ["clue-lawsuit"],
                "npc_ids": [],
                "pressure_moves": [],
                "tone": ["dusty"],
                "allowed_improvisation": [],
                "location_tags": ["hall of records", "archives", "档案厅", "records"],
            },
            {
                "scene_id": "corbitt-house-ground",
                "scene_type": "investigation",
                "dramatic_question": "House?",
                "entry_conditions": [],
                "exit_conditions": [],
                "available_clues": ["clue-diaries"],
                "npc_ids": [],
                "pressure_moves": [],
                "tone": ["abandoned"],
                "allowed_improvisation": [],
                "location_tags": [
                    "corbitt house", "old house", "boarding house", "科比特老宅", "house"
                ],
            },
        ]
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({
        "npcs": [{"npc_id": "npc-knott", "agenda": "hire investigators"}]
    }))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "commission-briefing"
    world["discovered_clue_ids"] = ["clue-leads", "clue-keys"]
    world["unlocked_scene_ids"] = [
        "commission-briefing", "hall-of-records", "corbitt-house-ground"
    ]
    world["visited_scene_ids"] = []
    world["exhausted_scene_ids"] = []
    world["scene_history"] = []
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="去科比特老宅",
        player_intent_class="move",
        player_intent_rich={
            "primary_intent": "move",
            "secondary_intents": [],
            "target_entities": ["corbitt house"],
            "risk_posture": "neutral",
            "explicit_roll_request": False,
            "player_hypothesis": None,
        },
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="move-match-1")
    assert plan["scene_action"] == "CUT"
    assert plan.get("transition_to") == "corbitt-house-ground"
    assert plan.get("matched_target", {}).get("scene_id") == "corbitt-house-ground"
    assert "corbitt house" in plan["matched_target"]["matched_entities"]


def test_move_intent_zero_match_falls_back_to_candidate_order(tmp_path):
    """No location_tags hit → keep deterministic first unlocked candidate."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = {
        "scenes": [
            {
                "scene_id": "commission-briefing",
                "is_start": True,
                "scene_type": "social",
                "dramatic_question": "Accept?",
                "entry_conditions": [],
                "exit_conditions": [{"kind": "narrative", "description": "leave"}],
                "available_clues": ["clue-leads"],
                "npc_ids": [],
                "pressure_moves": [],
                "tone": [],
                "allowed_improvisation": [],
                "location_tags": ["briefing"],
                "scene_edges": [
                    {
                        "to": "hall-of-records",
                        "kind": "unlock",
                        "when": {"kind": "always"},
                    },
                    {
                        "to": "corbitt-house-ground",
                        "kind": "unlock",
                        "when": {"kind": "always"},
                    },
                ],
            },
            {
                "scene_id": "hall-of-records",
                "scene_type": "investigation",
                "dramatic_question": "Records?",
                "entry_conditions": [],
                "exit_conditions": [],
                "available_clues": [],
                "npc_ids": [],
                "pressure_moves": [],
                "tone": [],
                "allowed_improvisation": [],
                "location_tags": ["hall of records", "archives"],
            },
            {
                "scene_id": "corbitt-house-ground",
                "scene_type": "investigation",
                "dramatic_question": "House?",
                "entry_conditions": [],
                "exit_conditions": [],
                "available_clues": [],
                "npc_ids": [],
                "pressure_moves": [],
                "tone": [],
                "allowed_improvisation": [],
                "location_tags": ["corbitt house", "house"],
            },
        ]
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "commission-briefing"
    world["unlocked_scene_ids"] = [
        "commission-briefing", "hall-of-records", "corbitt-house-ground"
    ]
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我们走吧",
        player_intent_class="move",
        player_intent_rich={
            "primary_intent": "move",
            "secondary_intents": [],
            "target_entities": ["somewhere else"],
            "risk_posture": "neutral",
            "explicit_roll_request": False,
            "player_hypothesis": None,
        },
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="move-fallback-1")
    assert plan["scene_action"] == "CUT"
    assert plan.get("transition_to") == "hall-of-records"
    assert "matched_target" not in plan


def test_director_emits_clue_bonus_skill_check_on_investigate_reveal(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    clue_graph = json.loads((camp / "scenario" / "clue-graph.json").read_text())
    clue_graph["conclusions"][0]["clues"][0].update({
        "delivery_kind": "handout",
        "player_safe_summary": "A civil file names the chapel executor.",
        "bonus": {
            "skill": "Library Use",
            "difficulty": "regular",
            "extra_summary": "A marginal note lists the chapel's 1912 closure date.",
            "on_fail_cost": "time",
        },
    })
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(clue_graph))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我在档案厅翻查民事卷宗",
        player_intent_class="investigate",
        rng=random.Random(42),
    )
    # Force REVEAL path with the bonus-bearing clue selected.
    ctx["player_intent_class"] = "investigate"
    plan = coc_story_director.generate_director_plan(ctx, decision_id="bonus-investigate")
    if plan["scene_action"] != "REVEAL":
        # Direct unit path when Layer-2 picks another action under this fixture.
        policy = coc_story_director._select_clue_policy(ctx, "REVEAL")
        requests = coc_story_director._build_rules_requests(ctx, "REVEAL", policy)
    else:
        policy = plan["clue_policy"]
        requests = plan["rules_requests"]

    assert policy.get("reveal") == ["clue-1"]
    assert policy.get("clue_type") == "obvious"
    assert isinstance(policy.get("bonus"), dict)
    bonus_req = next(
        r for r in requests
        if isinstance(r, dict)
        and (r.get("roll_contract") or {}).get("roll_density_group") == "clue-bonus:clue-1"
    )
    assert bonus_req["kind"] == "skill_check"
    assert bonus_req["skill"] == "Library Use"
    assert bonus_req["difficulty"] == "regular"
    assert bonus_req["roll_contract"]["failure_outcome_mode"] != "clue_with_cost"


def test_director_skips_clue_bonus_for_non_investigate_intent(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    clue_graph = json.loads((camp / "scenario" / "clue-graph.json").read_text())
    clue_graph["conclusions"][0]["clues"][0].update({
        "delivery_kind": "handout",
        "player_safe_summary": "A civil file names the chapel executor.",
        "bonus": {
            "skill": "Library Use",
            "difficulty": "regular",
            "extra_summary": "A marginal note lists the chapel's 1912 closure date.",
            "on_fail_cost": "time",
        },
    })
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(clue_graph))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我和档案员闲聊天气",
        player_intent_class="social",
        rng=random.Random(7),
    )
    ctx["player_intent_class"] = "social"
    policy = coc_story_director._select_clue_policy(ctx, "REVEAL")
    requests = coc_story_director._build_rules_requests(ctx, "REVEAL", policy)
    assert not any(
        (r.get("roll_contract") or {}).get("roll_density_group", "").startswith("clue-bonus:")
        for r in requests
        if isinstance(r, dict)
    )


def test_director_still_emits_skill_check_delivery_kind_unchanged(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    clue_graph = json.loads((camp / "scenario" / "clue-graph.json").read_text())
    clue_graph["conclusions"][0]["clues"][0].update({
        "delivery_kind": "skill_check",
        "skill": "Spot Hidden",
        "difficulty": "regular",
        "player_safe_summary": "Scratches on the doorframe.",
    })
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(clue_graph))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我搜查门框",
        player_intent_class="investigate",
        rng=random.Random(3),
    )
    policy = coc_story_director._select_clue_policy(ctx, "REVEAL")
    requests = coc_story_director._build_rules_requests(ctx, "REVEAL", policy)
    gate = next(r for r in requests if r.get("reason") == "obscured clue in scene")
    assert gate["skill"] == "Spot Hidden"
    assert gate["roll_contract"]["failure_outcome_mode"] == "clue_with_cost"
    assert gate["roll_contract"]["roll_density_group"] == "clue:clue-1"


# ---------------------------------------------------------------------------
# Narrative redirection policy (SENNA / Narrative Adherence paper)
# ---------------------------------------------------------------------------

def test_redirection_trigger_predicate_cases():
    """Pure trigger: stuck/ambiguous/meta/target_unmatched/boundary/stalled; not investigate."""
    pred = coc_story_director.redirection_should_trigger
    assert pred(intent_class="stuck") is True
    assert pred(intent_class="ambiguous") is True
    assert pred(intent_class="meta") is True
    assert pred(intent_class="investigate") is False
    assert pred(intent_class="investigate", target_unmatched=True) is True
    assert pred(
        intent_class="investigate",
        boundary_violation={"id": "b1", "consequence_hint": "fallout"},
    ) is True
    assert pred(intent_class="idle", stalled_turns=2) is True
    assert pred(intent_class="idle", stalled_turns=1) is False
    assert pred(intent_class="move") is False


def test_stuck_intent_emits_redirection_npc_influence_when_npc_present(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["npc_ids"] = ["npc-guide"]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({
        "npcs": [{
            "npc_id": "npc-guide",
            "name": "Guide",
            "agenda": "keep the party on the trail",
            "relationship_to_investigators": "ally",
        }],
    }))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我不知道该做什么",
        player_intent_class="stuck",
        rng=random.Random(7),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="redir-stuck-npc")
    redir = plan.get("redirection")
    assert isinstance(redir, dict)
    assert redir["strategy"] == "npc_influence"
    assert redir["reason_code"] == "stuck_player"
    assert redir["strategy"] != "hard_denial"
    grounding = redir["grounding"]
    assert grounding.get("npc_id") == "npc-guide"
    assert grounding.get("display_name") == "Guide"


def test_stuck_intent_emits_more_information_without_npc(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我卡住了",
        player_intent_class="stuck",
        rng=random.Random(7),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="redir-stuck-solo")
    redir = plan.get("redirection")
    assert isinstance(redir, dict)
    assert redir["strategy"] == "more_information"
    assert redir["reason_code"] == "stuck_player"
    assert redir["grounding"].get("scene_id") == "scene-1"


def test_boundary_violation_prefers_in_world_consequences(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["npc_ids"] = ["npc-guide"]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({
        "npcs": [{"npc_id": "npc-guide", "name": "Guide", "agenda": "help"}],
    }))
    (camp / "scenario" / "improvisation-boundaries.json").write_text(json.dumps({
        "invent_allowed": [],
        "never_invent": [],
        "keeper_secrets": [],
        "consequence_boundaries": [{
            "id": "boundary-no-teleport",
            "category": "physics",
            "consequence_hint": "The attempt fails and draws unwanted attention.",
        }],
    }))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我传送进地下室",
        player_intent_class="investigate",
        player_intent_rich={
            "primary_intent": "investigate",
            "boundary_violation": {
                "id": "boundary-no-teleport",
                "category": "physics",
                "consequence_hint": "The attempt fails and draws unwanted attention.",
            },
        },
        rng=random.Random(7),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="redir-boundary")
    redir = plan.get("redirection")
    assert redir["strategy"] == "in_world_consequences"
    assert redir["reason_code"] == "boundary_violation"
    assert redir["grounding"]["boundary_id"] == "boundary-no-teleport"
    assert redir["grounding"]["category"] == "physics"


def test_normal_investigate_turn_has_no_redirection(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我仔细搜查房间",
        player_intent_class="investigate",
        rng=random.Random(7),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="redir-normal")
    assert "redirection" not in plan or plan.get("redirection") is None
