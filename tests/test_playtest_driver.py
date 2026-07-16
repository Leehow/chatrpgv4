"""Tests for coc_playtest_driver: multi-turn session runner."""
import importlib.util
import json
import random
import re
import shutil
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


driver = _load("coc_playtest_driver", "plugins/coc-keeper/scripts/coc_playtest_driver.py")
scene_graph = _load("coc_scene_graph_task2", "plugins/coc-keeper/scripts/coc_scene_graph.py")
coc_memory = _load("coc_memory_task2", "plugins/coc-keeper/scripts/coc_memory.py")
coc_playtest_audit = _load(
    "coc_playtest_audit_task2",
    "plugins/coc-keeper/scripts/coc_playtest_audit.py",
)


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
         "clues": [{"clue_id":"c1","delivery":"x","delivery_kind":"environmental","visibility":"player-safe"},
                   {"clue_id":"c2","delivery":"y","delivery_kind":"environmental","visibility":"player-safe"},
                   {"clue_id":"c3","delivery":"z","delivery_kind":"environmental","visibility":"player-safe"}],
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


def _artifact_result() -> dict:
    return {
        "turns": [],
        "final_state": {"active_scene": "scene-1"},
        "clue_coverage": {"discovered": []},
        "terminal_evidence": {"session_ending": False},
    }


def _creation_evidence(investigator_id: str = "inv1") -> dict:
    return {
        "schema_version": 1,
        "investigator_id": investigator_id,
        "method": "standard_rulebook_chapter_3",
        "characteristics": {
            "LUCK": {
                "formula": "3D6 x 5",
                "roll_total": 11,
                "final": 55,
                "roll_id": "creation-luck",
            },
            "EDU": {
                "formula": "2D6+6 x 5",
                "roll_total": 13,
                "final": 65,
                "roll_id": "creation-edu",
            },
        },
        "age": {
            "years": 42,
            "edu_improvement_checks": [
                {
                    "roll": 77,
                    "target": 65,
                    "improved": True,
                    "improvement_roll": 4,
                    "edu_before": 65,
                    "edu_after": 69,
                    "roll_id": "creation-edu-improvement",
                }
            ],
        },
    }


def test_artifact_writer_packages_selected_reusable_creation_evidence(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    creation = _creation_evidence()
    char_path.with_name("creation.json").write_text(
        json.dumps(creation), encoding="utf-8"
    )
    other_dir = char_path.parents[1] / "inv2"
    other_dir.mkdir()
    (other_dir / "creation.json").write_text(
        json.dumps(_creation_evidence("inv2")), encoding="utf-8"
    )
    roll_ids = {
        "creation-luck",
        "creation-edu",
        "creation-edu-improvement",
    }
    (camp / "logs" / "rolls.jsonl").write_text(
        "".join(
            json.dumps(
                {
                    "type": "character_creation",
                    "actor": "inv1",
                    "visibility": "public",
                    "payload": {"roll_id": roll_id},
                }
            )
            + "\n"
            for roll_id in sorted(roll_ids)
        ),
        encoding="utf-8",
    )

    run_dir = tmp_path / "playtests" / "creation-evidence"
    report_path = driver.write_playtest_artifacts(
        run_dir,
        camp,
        char_path,
        "inv1",
        [],
        _artifact_result(),
        metadata={"audit_profile": "haunting_module"},
    )

    target_dir = run_dir / "sandbox" / ".coc" / "investigators" / "inv1"
    assert json.loads((target_dir / "character.json").read_text()) == json.loads(
        char_path.read_text()
    )
    assert json.loads((target_dir / "creation.json").read_text()) == creation
    assert not (run_dir / "sandbox" / ".coc" / "investigators" / "inv2").exists()
    packaged_rolls = {
        row["payload"]["roll_id"]
        for row in (
            json.loads(line)
            for line in (
                run_dir
                / "sandbox"
                / ".coc"
                / "campaigns"
                / "drive"
                / "logs"
                / "rolls.jsonl"
            ).read_text().splitlines()
            if line.strip()
        )
    }
    creation_rolls = {
        creation["characteristics"]["LUCK"]["roll_id"],
        creation["characteristics"]["EDU"]["roll_id"],
        creation["age"]["edu_improvement_checks"][0]["roll_id"],
    }
    assert creation_rolls <= packaged_rolls
    assert "EDU 65, LUCK 55" in report_path.read_text(encoding="utf-8")
    audit = coc_playtest_audit.audit_run(run_dir)
    creation_findings = [
        finding
        for finding in audit["findings"]
        if finding["code"] == "investigator_creation_missing"
    ]
    assert creation_findings
    assert all(
        "missing creation.json" not in finding["evidence"]
        for finding in creation_findings
    )


def test_artifact_writer_does_not_fabricate_missing_creation_evidence(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    run_dir = tmp_path / "playtests" / "missing-creation"

    report_path = driver.write_playtest_artifacts(
        run_dir,
        camp,
        char_path,
        "inv1",
        [],
        _artifact_result(),
        metadata={"audit_profile": "haunting_module"},
    )

    target = (
        run_dir
        / "sandbox"
        / ".coc"
        / "investigators"
        / "inv1"
        / "creation.json"
    )
    assert not target.exists()
    assert "No investigator creation recorded." in report_path.read_text(encoding="utf-8")
    audit = coc_playtest_audit.audit_run(run_dir)
    assert any(
        finding["code"] == "investigator_creation_missing"
        and "missing creation.json" in finding["evidence"]
        for finding in audit["findings"]
    )


def test_artifact_writer_rejects_stale_target_creation_when_source_is_missing(
    tmp_path,
):
    camp, char_path = _build_mini_campaign(tmp_path)
    run_dir = tmp_path / "playtests" / "stale-creation"
    target = (
        run_dir
        / "sandbox"
        / ".coc"
        / "investigators"
        / "inv1"
        / "creation.json"
    )
    target.parent.mkdir(parents=True)
    stale = _creation_evidence()
    target.write_text(json.dumps(stale), encoding="utf-8")

    with pytest.raises(ValueError, match="absent from reusable investigator"):
        driver.write_playtest_artifacts(
            run_dir,
            camp,
            char_path,
            "inv1",
            [],
            _artifact_result(),
            generate_report=False,
        )

    assert json.loads(target.read_text()) == stale
    assert sorted(path.name for path in target.parent.iterdir()) == ["creation.json"]


@pytest.mark.parametrize(
    "content",
    ["not-json", "[]", '{"investigator_id": "inv2"}'],
)
def test_artifact_writer_fails_closed_for_invalid_creation_evidence(
    tmp_path, content,
):
    camp, char_path = _build_mini_campaign(tmp_path)
    char_path.with_name("creation.json").write_text(content, encoding="utf-8")
    run_dir = tmp_path / "playtests" / "invalid-creation"

    with pytest.raises(ValueError, match="creation record"):
        driver.write_playtest_artifacts(
            run_dir,
            camp,
            char_path,
            "inv1",
            [],
            _artifact_result(),
            generate_report=False,
        )

    assert not run_dir.exists()


def test_artifact_writer_rejects_active_reusable_transaction_before_run_writes(
    tmp_path,
):
    camp, char_path = _build_mini_campaign(tmp_path)
    ending_id = "ending-artifact-guard"
    transaction_id = (
        driver.coc_investigator_guard._expected_transaction_id(
            ending_id, "inv1"
        )
    )
    marker = char_path.with_name("development-active-transaction.json")
    marker.write_text(json.dumps({
        "schema_version": 2,
        "status": "active",
        "transaction_id": transaction_id,
        "investigator_id": "inv1",
        "campaign_id": "foreign-campaign",
        "ending_id": ending_id,
        "inflight_ref": (
            "campaigns/foreign-campaign/save/development-settlements/"
            "endings/ending-artifact-guard/inv1.inflight.json"
        ),
        "created_at": "2026-07-16T00:00:00Z",
        "phase": "creating",
        "journal_sha256": None,
        "next_journal_sha256": None,
        "transition_at": None,
    }), encoding="utf-8")
    run_dir = tmp_path / "playtests" / "guarded-artifact"
    before = {
        char_path: char_path.read_bytes(),
        marker: marker.read_bytes(),
    }

    with pytest.raises(
        driver.coc_investigator_guard.ReusableInvestigatorRecoveryConflict
    ) as exc_info:
        driver.write_playtest_artifacts(
            run_dir,
            camp,
            char_path,
            "inv1",
            [],
            {"turns": [], "final_state": {}, "clue_coverage": {}},
            generate_report=False,
        )

    assert exc_info.value.code == "RECOVERY_CONFLICT"
    assert not run_dir.exists()
    assert {path: path.read_bytes() for path in before} == before


def _persist_driver_bout(camp: Path, char_path: Path) -> dict:
    character = json.loads(char_path.read_text())
    character["characteristics"].update({"POW": 99, "INT": 99})
    character["derived"]["SAN"] = 99
    char_path.write_text(json.dumps(character))
    return driver.subsystem_executor.execute_commands(
        camp,
        char_path,
        "inv1",
        [{
            "command_id": "driver-bout-origin",
            "kind": "sanity_check",
            "phase": "resolve",
            "payload": {
                "decision_id": "driver-bout-decision",
                "roll_id": "driver-bout-roll",
                "san_loss_success": 5,
                "san_loss_fail_expr": "5",
                "source": "driver horror",
                "alone": False,
                "involuntary_kind": "flee",
                "module_bout_override": {"force_mode": "real_time"},
            },
        }],
        rng=random.Random(1),
    )[0]


def test_driver_projection_preserves_live_subsystem_result_without_reexecution():
    subsystem_result = {
        "command_id": "turn-001-rule-1",
        "kind": "skill_check",
        "status": "completed",
        "events": [{"kind": "skill_check", "roll": 42, "success": True}],
        "pending_choice": None,
        "state_refs": ["logs/rolls.jsonl#turn-001-rule-1"],
    }
    live_turn = {
        "decision_id": "turn-001",
        "subsystem_results": [subsystem_result],
        "pending_choice": None,
        "rule_results": subsystem_result["events"],
    }

    projected = driver._project_driver_turn(live_turn, 1)

    assert projected["subsystem_results"] == [subsystem_result]
    assert projected["pending_choice"] is None
    assert projected["rule_results"] == subsystem_result["events"]


def test_driver_continues_keeper_bout_when_next_scripted_responses_are_typed(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    started = _persist_driver_bout(camp, char_path)
    choice = started["pending_choice"]
    result = driver.run_full_session(
        camp,
        char_path,
        "inv1",
        player_choices=[
            {"pending_choice_response": {
                "choice_id": choice["choice_id"],
                "responder": "keeper",
                "revision": 0,
                "action": "tick",
            }},
            {"pending_choice_response": {
                "choice_id": choice["choice_id"],
                "responder": "keeper",
                "revision": 1,
                "action": "end",
            }},
        ],
        max_turns=2,
        rng_seed=119,
    )

    assert [row["kind"] for row in result["subsystem_results"]] == [
        "bout_tick",
        "bout_end",
    ]
    assert result["pending_choice"] is None


def test_driver_advances_through_scenes(tmp_path):
    """Driver advances only after an explicit move following clue settlement."""
    camp, char_path = _build_mini_campaign(tmp_path)
    result = driver.run_full_session(
        camp, char_path, "inv1",
        player_choices=[
            {"intent": "search", "intent_class": "investigate"},
            {"intent": "move on", "intent_class": "move"},
            {"intent": "search", "intent_class": "investigate"},
            {"intent": "move on", "intent_class": "move"},
        ],
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
    # Canonical apply records intent after the turn, so RECOVER (stalled>=3)
    # needs a fourth idle input once the driver no longer pre-writes pacing.
    result = driver.run_full_session(
        camp, char_path, "inv1",
        player_choices=[{"intent": "不知道该做什么", "intent_class": "idle"}] * 4,
        max_turns=4,
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
        player_choices=[{"intent": "不知道该做什么", "intent_class": "idle"}] * 4,
        max_turns=4,
        rng_seed=7,
    )
    idea_turns = [
        turn for turn in result["turns"]
        if any(r.get("kind") == "idea_roll" for r in turn.get("rule_results", []))
    ]
    assert idea_turns, "expected at least one live Idea Roll on a signposted RECOVER"
    recovered = [
        turn for turn in idea_turns
        if turn.get("resolved_clue_policy", {}).get("fallback_recovered")
    ]
    assert recovered, (
        "expected Idea Roll recovery to commit a fallback clue; "
        f"actions={[t.get('action') for t in result['turns']]} "
        f"policies={[t.get('resolved_clue_policy') for t in idea_turns]}"
    )
    turn = recovered[0]
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


def test_driver_turns_come_from_run_live_turn_pipeline(tmp_path):
    """Regression: driver session turns must be produced by run_live_turn."""
    camp, char_path = _build_mini_campaign(tmp_path)
    result = driver.run_full_session(
        camp,
        char_path,
        "inv1",
        player_choices=[{"intent": "search", "intent_class": "investigate"}],
        max_turns=1,
        rng_seed=42,
    )
    assert result["pipeline"] == "run_live_turn"
    assert result["simulation_method"] == "driver_executed_virtual_table_not_live_llm"
    turn = result["turns"][0]
    assert turn["pipeline"] == "run_live_turn"
    assert turn["apply_path"] == "coc_director_apply.apply_plan"
    assert isinstance(turn.get("narration_envelope"), dict)
    assert "approved_reveals" in turn["narration_envelope"] or "schema_version" in turn["narration_envelope"]
    runtime_log = camp / "logs" / "live-turn-runtime.jsonl"
    assert runtime_log.exists()
    receipts = [json.loads(line) for line in runtime_log.read_text().splitlines() if line.strip()]
    assert receipts
    assert receipts[-1]["event_type"] == "live_turn_runtime"


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
            {"intent": "仍然卡住", "intent_class": "idle"},
        ],
        max_turns=5,
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
        "exit_conditions": ["investigators accept the job"],
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
    visible_battle_text = re.sub(r"<!--.*?-->", "", battle_text, flags=re.DOTALL)

    assert "## Verification Replay" in battle_text
    assert "战役 ID: driver-report-campaign" in battle_text
    assert "我翻登记簿，同时让档案员盯着警卫" in battle_text
    assert "KP:" in battle_text
    assert "裁定: 揭示线索" in battle_text
    assert "裁定: REVEAL" not in battle_text
    assert "档案员低声提醒" in battle_text
    assert "别看他的手，看登记簿。" in battle_text
    assert "剧情片段：" in battle_text
    assert "线索：" in battle_text
    assert "图书馆使用" in battle_text
    assert "Library Use" not in visible_battle_text
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
    assert "当前停留在当前地点" in battle_text
    assert "当前停留在场景 scene-1" not in battle_text
    assert "推进到下一处可调查地点" not in battle_text


def test_keeper_turn_text_dedupes_unchanged_affordance_cues():
    """Identical choice_frame routes across turns must not repeat affordance prose."""
    frame = {
        "routes": [
            {"id": "a", "cue": "追问指挥官真实目的"},
            {"id": "b", "cue": "检查装备与补给"},
        ]
    }
    turn1 = {"choice_frame": frame, "clue_revealed": [], "storylet_moves": [], "npc_moves": []}
    turn2 = {"choice_frame": frame, "clue_revealed": [], "storylet_moves": [], "npc_moves": []}
    text1 = driver._keeper_turn_text(turn1, {}, {}, previous_affordance_ids=["__none__"])
    text2 = driver._keeper_turn_text(turn2, {}, {}, previous_affordance_ids=["a", "b"])
    assert "眼下若你愿意，可以" in text1
    assert "现场同时露出这些可行动线索" not in text1
    assert "眼下若你愿意，可以" not in text2


def test_keeper_turn_text_renders_success_instead_of_no_progress_filler():
    turn = {
        "narration_envelope": {"action_outcomes": [{
            "route_id": "gain-access",
            "status": "completed",
            "success": True,
            "player_visible_goal": "说服管理员开放阅览室",
            "player_visible_outcome": "管理员推开门，让你进入阅览室",
        }]},
        "rule_results": [{"success": True, "outcome": "regular"}],
        "choice_frame": {"routes": []},
        "clue_revealed": [],
        "storylet_moves": [],
        "npc_moves": [],
    }

    text = driver._keeper_turn_text(turn, {}, {})

    assert "管理员推开门，让你进入阅览室" in text
    assert "说服管理员开放阅览室" not in text
    assert "没有新的" not in text
    assert "没有新的可见收获" not in text


def test_keeper_turn_text_uses_localized_authored_failure_and_push_preview():
    failed = {
        "success": False,
        "outcome": "failure",
        "roll_contract": {
            "authored_roll_gate": True,
            "failure_outcome_mode": "no_progress",
            "failure_effect": "Arty refuses access.",
            "localized_failure_effects": {"zh-Hans": "阿蒂拒绝放行。"},
        },
    }
    base = {
        "narrative_directives": {"player_facing_style": {"language": "zh-Hans"}},
        "choice_frame": {"routes": []},
        "clue_revealed": [],
        "storylet_moves": [],
        "npc_moves": [],
    }
    failure_text = driver._keeper_turn_text({**base, "rule_results": [failed]}, {}, {})
    assert "阿蒂拒绝放行" in failure_text
    assert "Arty refuses" not in failure_text
    assert "压力仍留在场内" not in failure_text

    fumble = {
        **failed,
        "outcome": "fumble",
        "fumble_consequence": {
            "summary": "Arty bars the route.",
            "localized_summaries": {"zh-Hans": "阿蒂叫人赶走调查员并永久封锁路线。"},
            "effect": {"kind": "route_closed", "route_id": "persuade-arty"},
        },
    }
    fumble_text = driver._keeper_turn_text({**base, "rule_results": [fumble]}, {}, {})
    assert fumble_text.count("阿蒂叫人赶走调查员并永久封锁路线") == 1
    assert "阿蒂拒绝放行" not in fumble_text

    push_text = driver._keeper_turn_text({
        **base,
        "rule_results": [],
        "pending_choice": {
            "kind": "push_confirm",
            "responder": "player",
            "prompt": "是否孤注一掷？若再次失败：阿蒂会永久禁止进入。",
            "options": [
                {"action": "confirm", "label": "确认孤注一掷"},
                {"action": "cancel", "label": "保留原失败"},
            ],
        },
    }, {}, {})
    assert "若再次失败：阿蒂会永久禁止进入" in push_text
    assert "确认孤注一掷" in push_text
    assert "没有新的可见收获" not in push_text


def test_keeper_turn_text_aggregates_multiple_outcomes_and_reveals_once():
    turn = {
        "narration_envelope": {"action_outcomes": [
            {"status": "completed", "success": True, "player_visible_goal": "接过钥匙与宅址", "player_visible_outcome": "Knott 把宅门钥匙和写有地址的纸条交到你手中"},
            {"status": "completed", "success": True, "player_visible_goal": "追问前租客遭遇", "player_visible_outcome": "Knott 说明 Macario 一家曾在宅中遭遇怪事"},
            {"status": "completed", "success": True, "player_visible_goal": "确认委托条款", "player_visible_outcome": "你与 Knott 敲定了调查报酬"},
        ]},
        "rule_results": [],
        "choice_frame": {"routes": []},
        "clue_revealed": ["c1", "c2", "c3"],
        "storylet_moves": [],
        "npc_moves": [],
    }
    clue_names = {"c1": "委托报酬", "c2": "钥匙与预付款", "c3": "Macario 的遭遇"}

    text = driver._keeper_turn_text(turn, clue_names, {})

    assert "这些行动已经落实" not in text
    assert "这次行动成功了" not in text
    assert "你确认了这些新线索" not in text
    assert "接过钥匙与宅址" not in text
    assert "追问前租客遭遇" not in text
    assert "确认委托条款" not in text
    assert "Knott 把宅门钥匙和写有地址的纸条交到你手中" in text
    assert "Knott 说明 Macario 一家曾在宅中遭遇怪事" in text
    assert "你与 Knott 敲定了调查报酬" in text
    assert all(value in text for value in clue_names.values())


def test_keeper_fallback_localizes_generated_action_outcomes_without_losing_evidence():
    goals = [
        "明确接受 Knott 的委托",
        "打听宅子的地址和进入方式",
        "追问前租客遭遇过什么",
    ]
    future_route = "去市立图书馆查阅这栋宅子的旧报纸"
    unsafe_storylet_fact = "地下室里沉睡着玩家尚未发现的怪物"
    turn = {
        "narrative_directives": {
            "player_facing_style": {"language": "zh-Hans"}
        },
        "narration_envelope": {"action_outcomes": [
            {
                "route_id": f"route-{index}",
                "status": "completed",
                "success": True,
                "player_visible_goal": goal,
                "player_visible_outcome": f"Completed public action: {goal}",
            }
            for index, goal in enumerate(goals, start=1)
        ]},
        "rule_results": [],
        "choice_frame": {"routes": [{
            "route_id": "research-newspapers",
            "cue": future_route,
            "status": "open",
            "fork_eligible": True,
        }]},
        "clue_revealed": ["commission-terms"],
        "storylet_moves": [{
            "storylet_id": "unverified-secret",
            "presentation_mode": "existing_route_only",
            "cue": unsafe_storylet_fact,
            "bound_entities": {"route_id": "research-newspapers"},
            "rolled_variants": {},
            "grounding_contract": {"allow_new_actionable_fact": False},
        }],
        "npc_moves": [],
    }

    text = driver._keeper_turn_text(
        turn,
        {"commission-terms": "Knott 说明了报酬和调查范围"},
        {},
    )

    assert "Completed public action" not in text
    assert all(text.count(f"你已经{goal}") == 1 for goal in goals)
    assert "Knott 说明了报酬和调查范围" in text
    assert future_route in text
    assert unsafe_storylet_fact not in text


def test_keeper_turn_text_does_not_claim_success_for_consumed_route_with_cost():
    turn = {
        "narration_envelope": {"action_outcomes": []},
        "rule_results": [{"success": False, "outcome": "fumble"}],
        "choice_frame": {"routes": []},
        "clue_revealed": ["c1"],
        "storylet_moves": [],
        "npc_moves": [],
    }

    text = driver._keeper_turn_text(turn, {"c1": "一份旧剪报"}, {})

    assert "这次行动成功" not in text
    assert "一份旧剪报" in text
    assert "没有完全成功" in text


def test_keeper_fallback_does_not_turn_check_only_success_into_route_success():
    turn = {
        "narration_envelope": {"action_outcomes": [], "rule_results": [{
            "skill": "Persuade",
            "success": True,
            "outcome": "hard",
            "matched_route_ids": ["persuade-arty"],
            "settlement_scope": "check_only",
            "state_change_committed": False,
            "must_not_claim_state_change": True,
        }]},
        "rule_results": [{"success": True, "outcome": "hard"}],
        "choice_frame": {"routes": []},
        "clue_revealed": [],
        "storylet_moves": [],
        "npc_moves": [],
    }

    text = driver._keeper_turn_text(turn, {}, {})

    assert "检定本身通过了" in text
    assert "没有确认新的线索、权限或其他状态变化" in text
    assert "达成了当前这一步的目标" not in text


def test_fumble_clue_fallback_prioritizes_localized_clue_and_structured_cost():
    english_reason = (
        "Searching the newspaper address index directly advances locating records."
    )
    unrelated_route = "说服另一名工作人员开放别处档案"
    turn = {
        "narration_envelope": {"action_outcomes": []},
        "rule_results": [{
            "success": False, "outcome": "fumble", "reason": english_reason,
        }],
        "resolved_clue_policy": {"bonus_cost": "time"},
        "choice_frame": {"routes": [{
            "route_id": "other-route",
            "route_type": "npc_question",
            "cue": unrelated_route,
            "status": "open",
            "fork_eligible": True,
        }]},
        "clue_revealed": ["c1"],
        "storylet_moves": [{
            "presentation_mode": "existing_route_only",
            "cue": unrelated_route,
            "bound_entities": {"route_id": "other-route"},
        }],
        "npc_moves": [],
    }

    text = driver._keeper_turn_text(
        turn,
        {"c1": "一份未刊专题记录了历任住户接连遭遇事故与疾病。"},
        {},
    )

    assert "一份未刊专题记录了历任住户" in text
    assert "额外时间也耗了进去" in text
    assert "眼下若你愿意" not in text
    assert unrelated_route not in text
    assert english_reason not in text
    assert "。。" not in text
    assert ".。" not in text
    assert "这次行动成功" not in text


def test_transcript_omits_repeated_affordance_block(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    # Narrative exit keeps the party in scene-1 so affordance ids stay stable.
    story["scenes"][0].update({
        "exit_conditions": ["investigators accept the job"],
        "affordances": [
            {"id": "dusty-ledger", "cue": "登记簿边缘有新鲜灰尘断痕"},
            {"id": "side-door", "cue": "侧门缝里有冷风"},
        ],
    })
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    choices = [
        {"intent": "我翻登记簿", "intent_class": "investigate"},
        {"intent": "我再看一眼侧门", "intent_class": "investigate"},
    ]
    result = driver.run_full_session(camp, char_path, "inv1", player_choices=choices, max_turns=2)
    assert all(t.get("scene_id") == "scene-1" for t in result["turns"])
    transcript = driver._transcript_from_driver_result(result, choices, camp)
    keeper_texts = [row["text"] for row in transcript if row.get("role") == "keeper_under_test"]
    affordance_hits = sum(1 for t in keeper_texts if "眼下若你愿意，可以" in t)
    assert affordance_hits <= 1
    assert all("现场同时露出这些可行动线索" not in t for t in keeper_texts)


def test_keeper_turn_text_never_leaks_raw_clue_id():
    text = driver._keeper_turn_text(
        {"clue_revealed": ["clue-raw-id-xyz"], "choice_frame": {}, "storylet_moves": [], "npc_moves": []},
        {},
        {},
    )
    assert "clue-raw-id-xyz" not in text
    assert "你注意到一条新的线索" in text
    assert "你确认了线索" not in text


def test_keeper_turn_text_uses_player_safe_summary_not_id():
    text = driver._keeper_turn_text(
        {"clue_revealed": ["c1"], "choice_frame": {}, "storylet_moves": [], "npc_moves": []},
        {"c1": "门框边缘有新鲜划痕"},
        {},
    )
    assert "门框边缘有新鲜划痕" in text
    assert "c1" not in text
    assert "你确认了线索" not in text


def test_keeper_turn_text_rotates_filler_by_turn_number():
    empty = {"clue_revealed": [], "choice_frame": {}, "storylet_moves": [], "npc_moves": []}
    lines = {
        driver._keeper_turn_text({**empty, "turn": n}, {}, {})
        for n in range(6)
    }
    assert len(lines) >= 2
    transition_lines = {
        driver._keeper_turn_text({**empty, "scene_transition": True, "turn": n}, {}, {})
        for n in range(6)
    }
    assert len(transition_lines) >= 2


def test_choice_frame_prose_never_menu_dumps():
    prose = driver._choice_frame_prose(
        {
            "routes": [
                {"id": "a", "cue": "追问钥匙"},
                {"id": "b", "cue": "查看信箱"},
                {"id": "c", "cue": "敲门"},
            ]
        }
    )
    blob = "".join(prose)
    assert "现场同时露出这些可行动线索" not in blob
    assert "眼下若你愿意，可以" in blob
    assert "敲门" not in blob  # only first two cues woven


def test_choice_frame_prose_never_states_available_route_as_completed_action():
    prose = driver._choice_frame_prose({
        "routes": [{
            "id": "accept-commission",
            "cue": "明确接受委托，接过钥匙、宅址与预付现金",
        }]
    })
    blob = "".join(prose)
    assert "可以明确接受委托" in blob
    assert not blob.startswith("你接过")
    assert "。。" not in blob


def test_choice_frame_prose_surfaces_only_newly_available_routes():
    prose = driver._choice_frame_prose(
        {"routes": [
            {"id": "old", "cue": "接受委托并接过钥匙"},
            {"id": "new", "cue": "追问前租客一家出了什么事"},
        ]},
        previous_affordance_ids=["old"],
    )
    blob = "".join(prose)
    assert "前租客" in blob
    assert "接过钥匙" not in blob


def test_template_filters_synthetic_resume_cues_and_modals_existing_route_storylet():
    actionable_cue = "与档案员 Ruth Blake 套近乎，打听剪报库的年代上限。"
    turn = {
        "choice_frame": {"routes": [
            {
                "route_id": "befriend-ruth",
                "route_type": "npc_question",
                "cue": actionable_cue,
                "status": "open",
                "fork_eligible": True,
            },
            {
                "route_id": "live-scene-thread",
                "route_type": "live_resume_affordance",
                "cue": "当前场景的核心问题仍未解决。",
                "status": "resume",
                "fork_eligible": False,
            },
            {
                "route_id": "live-investigator-angle",
                "route_type": "live_resume_affordance",
                "cue": "调查员仍可从随身记录、装备、现场人物或既有判断重新切入。",
                "status": "resume",
                "fork_eligible": False,
            },
        ]},
        "clue_revealed": [],
        "npc_moves": [],
        "storylet_moves": [{
            "presentation_mode": "existing_route_only",
            "cue": actionable_cue,
            "bound_entities": {"route_id": "befriend-ruth"},
            "rolled_variants": {},
        }],
    }

    text = driver._keeper_turn_text(turn, {}, {})

    assert "可以当前场景的核心问题仍未解决" not in text
    assert "可以调查员仍可" not in text
    assert "当前场景的核心问题仍未解决" not in text
    assert "调查员仍可从随身记录" not in text
    assert text.count("与档案员 Ruth Blake 套近乎") == 1


def test_existing_route_only_storylet_uses_future_modal_when_not_already_surfaced():
    prose = driver._storylet_prose({
        "presentation_mode": "existing_route_only",
        "cue": "与档案员 Ruth Blake 套近乎，打听剪报库的年代上限。",
        "bound_entities": {"route_id": "befriend-ruth"},
        "rolled_variants": {},
        "grounding_contract": {"allow_new_actionable_fact": False},
    }, authorized_route_cues={
        "befriend-ruth": "与档案员 Ruth Blake 套近乎，打听剪报库的年代上限。",
    })

    assert prose == [
        "若要换一条路，还可以考虑：与档案员 Ruth Blake 套近乎，打听剪报库的年代上限。"
    ]


def test_unverified_storylet_renders_only_existing_commission_route():
    unsafe_cue = "一份可靠记录证明某人整晚在场；另一份同样可靠的记录证明他整晚不在。"
    route_cue = "追问这栋宅子的旧账可以从哪些公开记录或知情人查起。"
    turn = {
        "turn": 1,
        "choice_frame": {"routes": [{
            "route_id": "ask-research-options",
            "cue": route_cue,
            "status": "open",
            "fork_eligible": True,
        }]},
        "storylet_moves": [{
            "storylet_id": "low-alive-and-absent-record",
            "title": "在场证明与缺席记录",
            "cue": unsafe_cue,
            "beat": "让两份记录互相拆台。",
            "bound_entities": {
                "scene_id": "commission-briefing",
                "clue_id": "clue-knott-keys",
                "route_id": "ask-research-options",
            },
            "rolled_variants": {
                "sensory_detail_1d6": "远处的脚步声停了一瞬。",
                "complication_1d6": "威胁只露出症状。",
            },
            "grounding_contract": {"allow_new_actionable_fact": False},
        }],
        "clue_revealed": [],
        "npc_moves": [],
        "rule_results": [],
    }

    text = driver._keeper_turn_text(turn, {}, {})

    assert route_cue.rstrip("。") in text
    assert unsafe_cue not in text
    assert "脚步声" not in text
    assert "威胁只露出症状" not in text


def test_source_backed_storylet_fact_renders_in_template():
    cue = "档案管理员把场景原始登记簿推到你面前。"
    prose = driver._storylet_prose({
        "storylet_id": "scenario-authored-ledger",
        "presentation_mode": "source_backed_fact",
        "cue": cue,
        "rolled_variants": {},
        "grounding_contract": {
            "allow_new_actionable_fact": True,
            "fact_authorization": {
                "status": "authorized",
                "storylet_id": "scenario-authored-ledger",
                "scene_id": "archive",
                "source_refs": ["scenario:/scenes/archive/authored_storylets/0"],
            },
        },
    })

    assert prose == [cue]


def test_clue_lookup_prefers_requested_player_language(tmp_path):
    camp = tmp_path / "campaign"
    scenario = camp / "scenario"
    scenario.mkdir(parents=True)
    (scenario / "clue-graph.json").write_text(json.dumps({
        "conclusions": [{"clues": [{
            "clue_id": "c1",
            "player_safe_summary": "Knott hands over the key.",
            "localized_text": {
                "zh-Hans": {"player_safe_summary": "Knott 交出了钥匙。"}
            },
        }]}],
    }), encoding="utf-8")
    assert driver._clue_lookup(camp, "zh-Hans")["c1"] == "Knott 交出了钥匙。"
    assert driver._clue_lookup(camp, "en")["c1"] == "Knott hands over the key."


class _StaticLiveRunner:
    def __init__(self, scene_id, event_types=None):
        self.scene_id = scene_id
        self.event_types = list(event_types or [])

    def run_live_turn(self, *_args, **_kwargs):
        return {
            "turns": [
                {
                    "decision_id": "turn-001",
                    "scene_id": self.scene_id,
                    "action": "REVEAL",
                    "pipeline": "run_live_turn",
                    "apply_path": "coc_director_apply.apply_plan",
                    "event_types": self.event_types,
                }
            ]
        }


class _RunIdCapturingLiveRunner(_StaticLiveRunner):
    def __init__(self, scene_id):
        super().__init__(scene_id)
        self.run_ids = []

    def run_live_turn(self, *_args, **kwargs):
        self.run_ids.append(kwargs.get("run_id"))
        return super().run_live_turn(*_args, **kwargs)


def test_driver_mints_run_id_before_first_turn_and_artifact_reuses_it(
    tmp_path, monkeypatch,
):
    camp, char_path = _build_mini_campaign(tmp_path)
    runner = _RunIdCapturingLiveRunner("scene-1")
    monkeypatch.setattr(driver, "_live_turn_runner", lambda: runner)

    result = driver.run_full_session(
        camp,
        char_path,
        "inv1",
        player_choices=[{"intent": "检查房间", "intent_class": "search"}],
        max_turns=1,
    )
    assert result["run_id"].startswith("coc-run-v1:")
    assert runner.run_ids == [result["run_id"]]

    run_dir = tmp_path / "driver-artifact"
    driver.write_playtest_artifacts(
        run_dir,
        camp,
        char_path,
        "inv1",
        [],
        result,
        generate_report=False,
    )
    metadata = json.loads((run_dir / "playtest.json").read_text())
    identity = json.loads((run_dir / "run-identity.json").read_text())
    assert metadata["run_id"] == result["run_id"]
    assert identity["run_id"] == result["run_id"]


def test_driver_explicit_run_id_reaches_every_top_level_live_turn(
    tmp_path, monkeypatch,
):
    camp, char_path = _build_mini_campaign(tmp_path)
    runner = _RunIdCapturingLiveRunner("scene-1")
    monkeypatch.setattr(driver, "_live_turn_runner", lambda: runner)

    result = driver.run_full_session(
        camp,
        char_path,
        "inv1",
        player_choices=[
            {"intent": "检查房间", "intent_class": "search"},
            {"intent": "继续检查", "intent_class": "search"},
        ],
        max_turns=2,
        run_id="explicit-driver-run",
    )

    assert result["run_id"] == "explicit-driver-run"
    assert runner.run_ids == ["explicit-driver-run", "explicit-driver-run"]


def _write_branching_terminal_graph(camp, active_scene_id):
    story = {
        "scenes": [
            {
                "scene_id": "start",
                "available_clues": [],
                "scene_edges": [{"to": "last-array", "kind": "travel"}],
            },
            {
                "scene_id": "ending-a",
                "available_clues": [],
                "scene_edges": [],
            },
            {
                "scene_id": "last-array",
                "available_clues": [],
                "scene_edges": [{"to": "ending-a", "kind": "travel"}],
            },
        ]
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world_path = camp / "save" / "world-state.json"
    world = json.loads(world_path.read_text())
    world["active_scene_id"] = active_scene_id
    world_path.write_text(json.dumps(world))
    return story, world


def test_driver_reports_terminal_scene_that_is_not_last_in_array(tmp_path, monkeypatch):
    camp, char_path = _build_mini_campaign(tmp_path)
    story, world = _write_branching_terminal_graph(camp, "ending-a")
    monkeypatch.setattr(
        driver,
        "_live_turn_runner",
        lambda: _StaticLiveRunner("ending-a"),
    )

    result = driver.run_full_session(
        camp,
        char_path,
        "inv1",
        player_choices=[{"intent": "收束场景", "intent_class": "reflect"}],
        max_turns=1,
    )

    assert scene_graph.is_terminal_scene(story["scenes"][1], story) is True
    assert result["reached_terminal"] is True
    assert result["terminal_evidence"]["active_scene_id"] == world["active_scene_id"]
    assert result["terminal_evidence"]["graph_terminal"] is True


def test_driver_does_not_treat_last_array_scene_with_outgoing_edge_as_terminal(
    tmp_path,
    monkeypatch,
):
    camp, char_path = _build_mini_campaign(tmp_path)
    story, _world = _write_branching_terminal_graph(camp, "last-array")
    monkeypatch.setattr(
        driver,
        "_live_turn_runner",
        lambda: _StaticLiveRunner("last-array"),
    )

    result = driver.run_full_session(
        camp,
        char_path,
        "inv1",
        player_choices=[{"intent": "继续前进", "intent_class": "move"}],
        max_turns=1,
    )

    assert scene_graph.is_terminal_scene(story["scenes"][2], story) is False
    assert result["reached_terminal"] is False
    assert result["terminal_evidence"]["graph_terminal"] is False


def test_driver_honors_structured_session_ending_evidence(tmp_path, monkeypatch):
    camp, char_path = _build_mini_campaign(tmp_path)
    _write_branching_terminal_graph(camp, "start")
    monkeypatch.setattr(
        driver,
        "_live_turn_runner",
        lambda: _StaticLiveRunner("start", event_types=["session_ending"]),
    )

    result = driver.run_full_session(
        camp,
        char_path,
        "inv1",
        player_choices=[{"intent": "结束本次会话", "intent_class": "reflect"}],
        max_turns=3,
    )

    assert len(result["turns"]) == 1
    assert result["reached_terminal"] is True
    assert result["terminal_evidence"]["session_ending"] is True
    assert result["terminal_evidence"]["graph_terminal"] is False


def test_artifact_packaging_preserves_persisted_structured_ending_without_fallback(
    tmp_path,
):
    camp, char_path = _build_mini_campaign(tmp_path)
    structured = {
        "event_type": "session_ending",
        "scene_id": "scene-1",
        "kind": "retreat",
        "summary": "调查员决定撤离，案件仍未解决。",
    }
    events_path = camp / "logs" / "events.jsonl"
    events_path.write_text(json.dumps(structured, ensure_ascii=False) + "\n")
    result = {
        "turns": [],
        "final_state": {"active_scene": "scene-1"},
        "clue_coverage": {"discovered": []},
        # Exercise the persisted-event fallback rather than relying on the
        # caller to have copied terminal evidence into the result envelope.
        "terminal_evidence": {"session_ending": False},
    }

    run_dir = tmp_path / "playtests" / "structured-ending"
    driver.write_playtest_artifacts(
        run_dir,
        camp,
        char_path,
        "inv1",
        [],
        result,
        generate_report=False,
    )

    packaged_events = [
        json.loads(line)
        for line in (
            run_dir
            / "sandbox"
            / ".coc"
            / "campaigns"
            / "drive"
            / "logs"
            / "events.jsonl"
        ).read_text().splitlines()
        if line.strip()
    ]
    endings = [
        row
        for row in packaged_events
        if row.get("event_type") == "session_ending"
        or row.get("type") == "session_ending"
    ]
    assert endings == [structured]
    assert all(
        "本次驱动实测收束" not in str(row.get("payload", {}).get("summary", ""))
        for row in packaged_events
    )


def test_artifact_packaging_adds_one_fallback_when_no_ending_exists(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    result = {
        "turns": [],
        "final_state": {"active_scene": "scene-1"},
        "clue_coverage": {"discovered": []},
        "terminal_evidence": {"session_ending": False},
    }

    run_dir = tmp_path / "playtests" / "fallback-ending"
    driver.write_playtest_artifacts(
        run_dir,
        camp,
        char_path,
        "inv1",
        [],
        result,
        generate_report=False,
    )

    packaged_events = [
        json.loads(line)
        for line in (
            run_dir
            / "sandbox"
            / ".coc"
            / "campaigns"
            / "drive"
            / "logs"
            / "events.jsonl"
        ).read_text().splitlines()
        if line.strip()
    ]
    endings = [
        row
        for row in packaged_events
        if row.get("event_type") == "session_ending"
        or row.get("type") == "session_ending"
    ]
    assert len(endings) == 1
    assert "本次驱动实测收束" in endings[0]["payload"]["summary"]


def test_driver_reaches_terminal_then_runs_real_payoff_and_session_ending(tmp_path):
    camp, char_path = _build_mini_campaign(tmp_path)
    story = {
        "scenes": [
            {
                "scene_id": "start",
                "scene_type": "investigation",
                "available_clues": [],
                "dramatic_question": "Can the investigator reach the resolution?",
                "scene_edges": [
                    {"to": "ending", "kind": "travel", "when": {"kind": "always"}}
                ],
            },
            {
                "scene_id": "ending",
                "scene_type": "resolution",
                "is_final": True,
                "available_clues": [],
                "dramatic_question": "What does the resolution mean?",
                "scene_edges": [],
            },
        ]
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world_path = camp / "save" / "world-state.json"
    world = json.loads(world_path.read_text())
    world.update(
        {
            "active_scene_id": "start",
            "unlocked_scene_ids": ["start", "ending"],
            "visited_scene_ids": [],
            "exhausted_scene_ids": [],
            "scene_history": [],
        }
    )
    world_path.write_text(json.dumps(world))
    coc_memory.create_memory_card(
        campaign_dir=camp,
        memory_id="ending-payoff",
        privacy="player_safe",
        salience=1.0,
        summary="The investigator carries forward the resolved choice.",
        entities=["ending"],
        tags=["player_interest"],
        reactivation_cues=["ending"],
        source_events=[],
    )
    choices = [
        {
            "intent": "Move to the unlocked resolution scene.",
            "intent_class": "move",
            "player_intent_rich": {
                "primary_intent": "move",
                "target_entities": ["ending"],
                "action_atoms": [],
            },
        },
        {
            "intent": "Reflect on the ending and close this session.",
            "intent_class": "reflect",
            "player_intent_rich": {
                "primary_intent": "reflect",
                "target_entities": ["ending"],
                "action_atoms": [],
            },
        },
    ]

    result = driver.run_full_session(
        camp,
        char_path,
        "inv1",
        player_choices=choices,
        max_turns=3,
        rng_seed=23,
    )

    assert [turn["action"] for turn in result["turns"]] == ["CUT", "PAYOFF"]
    assert "scene_transition" in result["turns"][0]["event_types"]
    assert "session_ending" in result["turns"][1]["event_types"]
    assert result["terminal_evidence"] == {
        "reached_terminal": True,
        "active_scene_id": "ending",
        "graph_terminal": True,
        "session_ending": True,
    }
    logged = [
        json.loads(line)
        for line in (camp / "logs" / "events.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert any(
        row.get("event_type") == "session_ending" or row.get("type") == "session_ending"
        for row in logged
    )


def test_terminal_evidence_contract_accepts_structured_event_records():
    story = {
        "scenes": [
            {
                "scene_id": "continuing",
                "scene_edges": [{"to": "later", "kind": "travel"}],
            },
            {"scene_id": "later", "scene_edges": []},
        ]
    }
    evidence = scene_graph.terminal_evidence(
        story,
        {"active_scene_id": "continuing"},
        [{"event_type": "session_ending", "payload": {"scene_id": "continuing"}}],
    )

    assert evidence["reached_terminal"] is True
    assert evidence["active_scene_id"] == "continuing"
    assert evidence["graph_terminal"] is False
    assert evidence["session_ending"] is True
