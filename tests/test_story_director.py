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
    assert authority_move["move_id"] == "assert_responsibility"
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
    """Old clue-graph without delivery_kind falls back to string heuristic."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # default _make_minimal_campaign clues have no delivery_kind -> fallback
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "dk-fallback")
    # clue-1 delivery is "investigate" -> heuristic says obscured
    assert plan["clue_policy"]["clue_type"] == "obscured"


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
