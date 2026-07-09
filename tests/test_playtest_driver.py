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
    (camp / "logs").mkdir(parents=True)
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


def test_driver_failed_obscured_roll_does_not_reveal_exact_clue(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    # Make the first clue obscured. With rng_seed=42, the first percentile roll is 82,
    # so Spot Hidden 60 fails and apply_plan must withhold the exact clue.
    cg = {"conclusions": [{"conclusion_id": "cc1", "importance": "critical", "minimum_routes": 3,
        "clues": [
            {"clue_id":"c1","delivery":"Spot Hidden","delivery_kind":"skill_check",
             "skill":"Spot Hidden","difficulty":"regular","visibility":"player-safe"},
            {"clue_id":"c2","delivery":"y","visibility":"player-safe"},
            {"clue_id":"c3","delivery":"z","visibility":"player-safe"}],
        "fallback_policy": ""}]}
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(cg))
    result = driver.run_full_session(
        camp, char_path, "inv1",
        player_choices=[{"intent": "search", "intent_class": "investigate"}],
        max_turns=1,
        rng_seed=42,
    )
    turn = result["turns"][0]
    assert result["clue_coverage"]["discovered_count"] == 0
    assert turn["rule_results"][0]["outcome"] == "failure"
    assert "clue_withheld" in turn["event_types"]
    assert turn["resolved_clue_policy"]["withheld_reveals"] == ["c1"]
    assert turn["failure_consequence"]["narration_mode"] == "withhold_exact_clue_with_cost"


def test_driver_roll_payload_preserves_roll_contract(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    clue_graph = json.loads((camp / "scenario" / "clue-graph.json").read_text())
    clue_graph["conclusions"][0]["clues"][0].update({
        "delivery_kind": "skill_check",
        "skill": "Spot Hidden",
        "difficulty": "regular",
    })
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(clue_graph))

    result = driver.run_full_session(
        camp,
        char_path,
        "inv1",
        player_choices=[{"intent": "search", "intent_class": "investigate"}],
        max_turns=1,
        rng_seed=42,
    )

    payload = result["turns"][0]["rule_results"][0]
    assert payload["roll_contract"]["failure_outcome_mode"] == "clue_with_cost"
    assert payload["roll_contract"]["roll_density_group"] == "clue:c1"


def test_driver_stalled_recover_surfaces_fallback_route(tmp_path):
    """Unmentioned missed clue: free Idea recovery (no roll) still advances play."""
    camp, char_path = _build_mini_campaign(tmp_path)
    # Ensure INT exists so a future idea_roll path can resolve against it.
    char = json.loads(char_path.read_text())
    char["characteristics"]["INT"] = 70
    char_path.write_text(json.dumps(char))
    result = driver.run_full_session(
        camp, char_path, "inv1",
        player_choices=[{"intent": "不知道该做什么", "intent_class": "idle"}] * 3,
        max_turns=3,
    )
    turn = result["turns"][-1]
    assert result["clue_coverage"]["discovered_count"] >= 1
    assert "idea_roll_recovery" in turn["event_types"]
    assert turn["resolved_clue_policy"]["fallback_recovered"]
    assert turn["failure_consequence"]["narration_mode"] == "recover_clean"
    assert not any(r.get("kind") == "idea_roll" for r in turn.get("rule_results", []))


def test_driver_stalled_recover_rolls_idea_when_signposted(tmp_path):
    """Mentioned missed clue: live path executes a real Idea Roll vs INT."""
    camp, char_path = _build_mini_campaign(tmp_path)
    char = json.loads(char_path.read_text())
    char["characteristics"]["INT"] = 70
    char_path.write_text(json.dumps(char))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    # Signpost the first available clue so RECOVER must roll (Regular).
    world["clue_signposts"] = {"c1": "mentioned"}
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    result = driver.run_full_session(
        camp, char_path, "inv1",
        player_choices=[{"intent": "不知道该做什么", "intent_class": "idle"}] * 3,
        max_turns=3,
        rng_seed=7,
    )
    idea_turns = [
        turn for turn in result["turns"]
        if any(r.get("kind") == "idea_roll" for r in turn.get("rule_results", []))
    ]
    assert idea_turns, "expected at least one live Idea Roll on a signposted RECOVER"
    turn = idea_turns[0]
    idea_rolls = [r for r in turn.get("rule_results", []) if r.get("kind") == "idea_roll"]
    assert len(idea_rolls) == 1
    assert idea_rolls[0]["skill"] == "INT"
    assert idea_rolls[0]["difficulty"] == "regular"
    assert turn["resolved_clue_policy"]["fallback_recovered"]
    assert turn["failure_consequence"]["narration_mode"] in {
        "recover_clean",
        "recover_with_cost",
    }
    assert result["clue_coverage"]["discovered_count"] >= 1


def test_driver_choice_leads_auto_signpost_then_recover_rolls_idea(tmp_path):
    """Live path: offering clue leads writes mentioned signposts; later RECOVER rolls Idea."""
    camp, char_path = _build_mini_campaign(tmp_path)
    char = json.loads(char_path.read_text())
    char["characteristics"]["INT"] = 70
    char_path.write_text(json.dumps(char))

    # Scene needs ≥2 available clues so CHOICE can surface leads.
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["available_clues"] = ["c1", "c2"]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))

    # Turn 1: ambiguous/idle with multiple leads → CHOICE should signpost.
    # Later idle turns stall into RECOVER, which must roll Idea vs INT (Regular).
    result = driver.run_full_session(
        camp,
        char_path,
        "inv1",
        player_choices=[
            {"intent": "我该先查哪边？", "intent_class": "ambiguous"},
            {"intent": "不知道该做什么", "intent_class": "idle"},
            {"intent": "还是不知道", "intent_class": "idle"},
            {"intent": "完全卡住了", "intent_class": "idle"},
        ],
        max_turns=4,
        rng_seed=11,
    )

    world = json.loads((camp / "save" / "world-state.json").read_text())
    signposts = world.get("clue_signposts") or {}
    assert signposts.get("c1") in {"mentioned", "obvious"} or signposts.get("c2") in {
        "mentioned",
        "obvious",
    }, f"expected auto signpost from offered leads, got {signposts}"

    idea_turns = [
        turn for turn in result["turns"]
        if any(r.get("kind") == "idea_roll" for r in turn.get("rule_results", []))
    ]
    assert idea_turns, (
        "expected RECOVER to roll Idea after auto-signposted leads; "
        f"signposts={signposts} actions={[t.get('action') for t in result['turns']]}"
    )
    assert idea_turns[0]["rule_results"][0]["difficulty"] in {"regular", "extreme"}


def test_driver_applies_narrative_enrichment_and_persists_storylet_ledger(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    # Make the active scene rich enough for choice_frame, NPC reactions, and
    # storylet binding to show up in the actual driver result.
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0].update({
        "scene_type": "investigation",
        "npc_ids": ["npc-archivist"],
        "affordances": [
            {"id": "dusty-ledger", "cue": "登记簿边缘有新鲜灰尘断痕", "promise": "可能找到线索"},
            {"id": "side-door", "cue": "侧门缝里有冷风", "risk": "可能暴露行踪"},
        ],
    })
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({"npcs": [{
        "npc_id": "npc-archivist",
        "agenda": "keep the archives safe",
        "desire": "avoid trouble",
        "reaction_triggers": [{"when": "target_entity:guard", "move": "warn_about_guard"}],
    }]}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({
        "fronts": [{"front_id": "cult-watch", "clocks": [{"clock_id": "cult-alert"}]}]
    }))
    choices = [{
        "intent": "我翻登记簿，同时让档案员盯着警卫",
        "intent_class": "investigate",
        "player_intent_rich": {
            "primary_intent": "investigate",
            "secondary_intents": ["coordinate_ally"],
            "target_entities": ["guard"],
            "risk_posture": "cautious",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "proposal": {
                "mode": "yes_but",
                "accepted_goal": "coordinate with the archivist while checking the ledger",
                "visible_cost_or_risk": "the guard may notice the delay",
                "next_contract": "request_roll",
            },
            "action_atoms": [
                {"id": "read-ledger", "verb": "翻登记簿", "skill": "Library Use", "stakes": "失败则耗费时间"},
                {"id": "block-guard", "verb": "挡住警卫", "skill": "Fighting (Brawl)", "opposed_by": "guard", "depends_on": "read-ledger"},
            ],
        },
        "storylet_policy": {"conflict_level": "low", "seed": "driver-test", "max_storylets": 1, "force_storylet": True},
    }]

    result = driver.run_full_session(camp, char_path, "inv1", player_choices=choices, max_turns=1)

    turn = result["turns"][0]
    assert turn["choice_frame"]["route_count"] == 2
    assert turn["storylet_moves"]
    assert turn["narrative_enrichment"]["storylet_moves"] == 1
    assert turn["proposal_transform"]["mode"] == "yes_but"
    assert turn["proposal_transform"]["accepted_goal"] == "coordinate with the archivist while checking the ledger"
    assert turn["narrative_directives"]["proposal_transform"] == turn["proposal_transform"]
    assert "scene_exit_pressure" in turn
    assert "idea_roll_plan" in turn
    assert "roll_density_decisions" in turn
    assert any(req.get("source") == "player_intent_rich.action_atoms" for req in turn["rules_requests"])
    assert any(r.get("reason") == "翻登记簿" for r in turn["rule_results"])
    assert any(r.get("kind") == "opposed_check" and r.get("reason") == "挡住警卫" for r in turn["rule_results"])
    assert turn["npc_moves"][0]["active_reactions"][0]["move"] == "warn_about_guard"

    ledger = json.loads((camp / "save" / "storylet-ledger.json").read_text())
    assert ledger["last_storylet_id"] == turn["storylet_moves"][0]["storylet_id"]
    assert ledger["used_storylets"]


def test_driver_records_roll_density_decisions_for_debugging(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    choices = [{
        "intent": "我把桌面和抽屉都搜一遍",
        "intent_class": "investigate",
        "player_intent_rich": {
            "primary_intent": "investigate",
            "action_atoms": [
                {"id": "search-desk", "verb": "搜桌面", "skill": "Spot Hidden", "roll_density_group": "same-room"},
                {"id": "search-drawer", "verb": "搜抽屉", "skill": "Spot Hidden", "roll_density_group": "same-room"},
            ],
        },
    }]

    result = driver.run_full_session(camp, char_path, "inv1", player_choices=choices, max_turns=1)

    turn = result["turns"][0]
    assert len(turn["rules_requests"]) == 1
    assert turn["roll_density_decisions"][0]["mode"] == "merged_roll"
    assert turn["roll_density_decisions"][0]["merged_atom_ids"] == ["search-desk", "search-drawer"]
    assert turn["narrative_directives"]["roll_density_decisions"] == turn["roll_density_decisions"]


def test_driver_continues_decision_ids_across_repeated_live_invocations(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    choices = [{
        "intent": "我先整理一下思绪。",
        "intent_class": "reflect",
        "player_intent_rich": {"primary_intent": "reflect", "action_atoms": []},
    }]

    driver.run_full_session(camp, char_path, "inv1", player_choices=choices, max_turns=1)
    driver.run_full_session(camp, char_path, "inv1", player_choices=choices, max_turns=1)

    rows = [
        json.loads(line)
        for line in (camp / "logs" / "events.jsonl").read_text().splitlines()
        if line.strip()
    ]
    decision_ids = [row.get("decision_id") for row in rows if row.get("decision_id")]

    assert "turn-001" in decision_ids
    assert "turn-002" in decision_ids
    assert decision_ids[-1] == "turn-002"


def test_driver_writes_battle_report_with_gameplay_evidence(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    (camp / "campaign.json").write_text(json.dumps({
        "campaign_id": "driver-report-campaign",
        "title": "Driver Report Campaign",
        "scenario_id": "driver-report-scenario",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "play_language": "zh-Hans",
    }))
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0].update({
        "scene_type": "investigation",
        "npc_ids": ["npc-archivist"],
        "affordances": [
            {"id": "dusty-ledger", "cue": "登记簿边缘有新鲜灰尘断痕", "promise": "可能找到线索"},
            {"id": "side-door", "cue": "侧门缝里有冷风", "risk": "可能暴露行踪"},
        ],
    })
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({"npcs": [{
        "npc_id": "npc-archivist",
        "name": "档案员",
        "agenda": "keep the archives safe",
        "desire": "avoid trouble",
        "fear": "guard attention",
        "reaction_triggers": [{
            "when": "target_entity:guard",
            "move": "warn_about_guard",
            "line_seed": "别看他的手，看登记簿。",
        }],
    }]}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({
        "fronts": [{"front_id": "cult-watch", "clocks": [{"clock_id": "cult-alert"}]}]
    }))
    choices = [{
        "intent": "我翻登记簿，同时让档案员盯着警卫",
        "intent_class": "investigate",
        "player_intent_rich": {
            "primary_intent": "investigate",
            "secondary_intents": ["coordinate_ally"],
            "target_entities": ["guard"],
            "risk_posture": "cautious",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [
                {"id": "read-ledger", "verb": "翻登记簿", "skill": "Library Use", "stakes": "失败则耗费时间"},
                {"id": "block-guard", "verb": "挡住警卫", "skill": "Fighting (Brawl)", "opposed_by": "guard", "depends_on": "read-ledger"},
            ],
        },
        "storylet_policy": {"conflict_level": "low", "seed": "driver-report-test", "max_storylets": 1, "force_storylet": True},
    }]
    result = driver.run_full_session(camp, char_path, "inv1", player_choices=choices, max_turns=1)

    battle_path = driver.write_playtest_artifacts(
        tmp_path / ".coc" / "playtests" / "driver-report",
        camp,
        char_path,
        "inv1",
        choices,
        result,
        metadata={"play_language": "zh-Hans", "audit_profile": "narrative_storylet_driver"},
    )
    battle_text = battle_path.read_text()

    assert "## 实际跑团回放" in battle_text
    assert "战役 ID: driver-report-campaign" in battle_text
    assert "我翻登记簿，同时让档案员盯着警卫" in battle_text
    assert "KP:" in battle_text
    assert "裁定: 揭示线索" in battle_text
    assert "裁定: REVEAL" not in battle_text
    assert "档案员低声提醒" in battle_text
    assert "别看他的手，看登记簿。" in battle_text
    assert "剧情片段：" in battle_text
    assert "线索：" in battle_text
    assert "Library Use" in battle_text
    assert "结果regular" not in battle_text
    assert "结果hard" not in battle_text
    assert "npc-archivist" not in battle_text
    assert "No actual play events recorded" not in battle_text
    assert "No transcript events recorded" not in battle_text
    assert "No character sheets recorded" not in battle_text
    assert "No major decisions recorded" not in battle_text
    assert "No clues recorded" not in battle_text
    assert "Session ending not recorded" not in battle_text
    assert "event: unknown" not in battle_text
    assert "Driver playtest executed" not in battle_text
    assert "场景路径 archive-room" not in battle_text
    assert "本次驱动实测收束" in battle_text
