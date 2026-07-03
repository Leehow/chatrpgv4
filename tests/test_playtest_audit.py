import importlib.util
import json
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_playtest_audit = load_module("coc_playtest_audit", "plugins/coc-keeper/scripts/coc_playtest_audit.py")


def write_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def write_jsonl(path: Path, events: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(event) for event in events) + "\n")


def create_smoke_run(run_dir: Path):
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "smoke-campaign"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king"
    write_json(run_dir / "playtest.json", {
        "run_id": "smoke-run",
        "campaign_id": "smoke-campaign",
        "scenario": "The Haunting Smoke",
        "player_profile": "careful_investigator",
    })
    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "smoke-campaign",
        "title": "Smoke Campaign",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
    })
    write_json(campaign_dir / "party.json", {
        "investigator_ids": ["ada-king"],
    })
    write_json(campaign_dir / "scenario" / "scenario.json", {
        "scenario_id": "the-haunting-smoke",
        "title": "The Haunting Smoke",
        "summary": "",
        "player_safe_summary": "",
        "current_phase": "intro",
    })
    for name in ["clues", "locations", "npcs", "timeline"]:
        write_json(campaign_dir / "scenario" / f"{name}.json", [])
    write_json(investigator_dir / "character.json", {
        "id": "ada-king",
        "name": "Ada King",
        "characteristics": {"STR": 60, "CON": 55, "SIZ": 65, "DEX": 50, "INT": 70, "POW": 55, "EDU": 75},
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 8},
        "skills": {"Library Use": 60, "Spot Hidden": 55},
    })
    write_jsonl(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "text": "The room is cold."},
        {"turn": 2, "role": "player_simulator", "text": "I search the desk."},
        {"turn": 3, "role": "keeper_under_test", "text": "Make a Library Use roll."},
        {"turn": 4, "role": "system", "text": "Roll result: 80 vs 60 -> failure."},
    ])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {
            "type": "roll",
            "actor": "ada-king",
            "payload": {
                "skill": "Library Use",
                "target": 60,
                "effective_target": 60,
                "difficulty": "regular",
                "roll": 80,
                "outcome": "failure",
            },
        }
    ])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "intro", "summary": "Smoke scene opened."}},
    ])
    (run_dir / "artifacts").mkdir(parents=True)
    (run_dir / "artifacts" / "battle-report.md").write_text(
        "# Battle Report\n\n## Story Recap\n- No story recap recorded.\n\n## Player Feedback On KP\n- No player feedback recorded.\n",
    )


def create_rulebook_shaped_run(run_dir: Path):
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-loop"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king"
    write_json(run_dir / "playtest.json", {
        "run_id": "haunting-loop",
        "campaign_id": "haunting-loop",
        "scenario": "The Haunting",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["investigation", "sanity"],
    })
    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "haunting-loop",
        "title": "The Haunting Loop",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
    })
    write_json(campaign_dir / "party.json", {"investigator_ids": ["ada-king"]})
    write_json(campaign_dir / "scenario" / "scenario.json", {
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "summary": "An investigator traces the history of a haunted Boston house.",
        "player_safe_summary": "The landlord asks the investigator to inspect a supposedly haunted property.",
        "opening_scene": "Mr. Knott hires Ada to investigate the Corbitt House.",
    })
    write_json(campaign_dir / "scenario" / "clues.json", [
        {"id": "clue-corbitt-will", "summary": "A will points toward Walter Corbitt."},
    ])
    write_json(campaign_dir / "scenario" / "locations.json", [
        {"id": "location-library", "name": "Boston Globe clipping files"},
    ])
    write_json(campaign_dir / "scenario" / "npcs.json", [
        {"id": "npc-knott", "name": "Mr. Knott"},
    ])
    write_json(campaign_dir / "scenario" / "timeline.json", [
        {"id": "past-1852", "summary": "Neighbors sue Walter Corbitt."},
    ])
    write_json(investigator_dir / "character.json", {
        "id": "ada-king",
        "name": "Ada King",
        "characteristics": {"STR": 60, "CON": 55, "SIZ": 65, "DEX": 50, "INT": 70, "POW": 55, "EDU": 75},
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 8},
        "skills": {"Library Use": 60, "Spot Hidden": 55, "Psychology": 40},
    })
    write_jsonl(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "mode": "play", "text": "Mr. Knott explains the house has driven away tenants."},
        {"turn": 2, "role": "player_simulator", "mode": "play", "intent": "ask terms and risks", "text": "I ask what happened to the last tenants."},
        {"turn": 3, "role": "keeper_under_test", "mode": "play", "ruling": "no_roll_needed", "text": "He describes illness, bad dreams, and unpaid rent."},
        {"turn": 4, "role": "player_simulator", "mode": "play", "intent": "research house history", "text": "I go to the clipping files and search for Corbitt."},
        {"turn": 5, "role": "keeper_under_test", "mode": "play", "ruling": "library_use_regular", "text": "That is a Library Use roll at Regular difficulty."},
        {"turn": 6, "role": "system", "mode": "roll", "text": "Library Use 42 vs 60 -> regular success."},
        {"turn": 7, "role": "keeper_under_test", "mode": "play", "text": "You find a clipping about lawsuits and the Chapel of Contemplation."},
        {"turn": 8, "role": "player_simulator", "mode": "play", "intent": "inspect suspicious stain", "text": "I look closer at the brown stain on the library floor."},
        {"turn": 9, "role": "keeper_under_test", "mode": "play", "ruling": "san_roll", "text": "The stain smells fresh. Make a SAN roll for the sudden image it evokes."},
        {"turn": 10, "role": "system", "mode": "roll", "text": "SAN 31 vs 55 -> success, lose 0."},
    ])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {
            "type": "roll",
            "actor": "ada-king",
            "payload": {
                "skill": "Library Use",
                "goal": "find the earliest public clue about Walter Corbitt",
                "target": 60,
                "effective_target": 60,
                "difficulty": "regular",
                "difficulty_rationale": "public newspaper clipping files are accessible with focused research",
                "roll": 42,
                "outcome": "regular_success",
                "push_eligible": False,
                "failure_consequence": "lose time and risk missing the Chapel lead until another clue appears",
                "skill_check_earned": True,
            },
        },
        {
            "type": "sanity",
            "actor": "ada-king",
            "payload": {
                "goal": "test reaction to a disturbing omen",
                "target": 55,
                "effective_target": 55,
                "difficulty": "sanity",
                "difficulty_rationale": "SAN rolls use current SAN and no bonus or penalty dice",
                "roll": 31,
                "outcome": "success",
                "san_loss": 0,
                "failure_consequence": "lose 1D3 SAN and freeze for a moment",
            },
        },
    ])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "knott-hiring", "summary": "Mr. Knott hired Ada."}},
        {"type": "clue", "actor": "ada-king", "payload": {"clue_id": "clue-corbitt-will", "summary": "Ada found the Corbitt lawsuit trail."}},
        {"type": "sanity", "actor": "ada-king", "payload": {"summary": "Ada passed a SAN roll and lost no SAN."}},
    ])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [
        {"session_id": "session-1", "summary": "Ada accepted Knott's job, researched Corbitt, and found the first Chapel lead."},
    ])
    write_jsonl(run_dir / "player-feedback.jsonl", [
        {"category": "kp_clarity", "score": 5, "text": "KP explained what I could do and why rolls happened."},
    ])
    (run_dir / "artifacts").mkdir(parents=True)
    (run_dir / "artifacts" / "battle-report.md").write_text(
        "# Battle Report\n\n## Story Recap\n- Ada accepted Knott's job and found the first Chapel lead.\n\n"
        "## Player Feedback On KP\n- kp_clarity: 5 - KP explained what I could do and why rolls happened.\n",
    )


def create_final_rulebook_run(run_dir: Path):
    create_rulebook_shaped_run(run_dir)
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-loop"
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {
            "type": "roll",
            "actor": "ada-king",
            "payload": {
                "skill": "Library Use",
                "goal": "find the earliest public clue about Walter Corbitt",
                "target": 60,
                "effective_target": 60,
                "difficulty": "regular",
                "difficulty_rationale": "public newspaper clipping files are accessible with focused research",
                "roll": 42,
                "outcome": "regular_success",
                "push_eligible": False,
                "failure_consequence": "lose time and risk missing the Chapel lead until another clue appears",
                "skill_check_earned": True,
            },
        },
        {
            "type": "roll",
            "actor": "ada-king",
            "payload": {
                "skill": "Spot Hidden",
                "goal": "notice the important symbol before leaving",
                "target": 55,
                "effective_target": 55,
                "difficulty": "regular",
                "difficulty_rationale": "the clue is visible but easy to overlook",
                "roll": 83,
                "outcome": "failure",
                "push_eligible": True,
                "failure_consequence": "Ada will leave without the symbol unless she spends extra time and risks attention",
                "skill_check_earned": False,
            },
        },
        {
            "type": "roll",
            "actor": "ada-king",
            "payload": {
                "skill": "Spot Hidden",
                "goal": "notice the important symbol before leaving",
                "target": 55,
                "effective_target": 55,
                "difficulty": "regular",
                "difficulty_rationale": "pushed roll keeps the same difficulty after Ada spends extra time",
                "roll": 34,
                "outcome": "regular_success",
                "pushed": True,
                "push_justification": "Ada spends ten more minutes checking the desk underside and accepts that someone may return.",
                "foreshadowed_failure": "If this fails, Ada hears footsteps and loses the chance to search quietly.",
                "failure_consequence": "Ada would be interrupted by footsteps from the hall.",
                "skill_check_earned": True,
            },
        },
        {
            "type": "sanity",
            "actor": "ada-king",
            "payload": {
                "skill": "SAN",
                "goal": "test reaction to a disturbing omen",
                "target": 55,
                "effective_target": 55,
                "difficulty": "sanity",
                "difficulty_rationale": "SAN rolls use current SAN and no bonus or penalty dice",
                "roll": 31,
                "outcome": "success",
                "san_loss": 0,
                "failure_consequence": "lose 1D3 SAN and freeze for a moment",
            },
        },
    ])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "knott-hiring", "summary": "Mr. Knott hired Ada."}},
        {"type": "decision", "actor": "ada-king", "payload": {"summary": "Ada chose to research before entering the house."}},
        {"type": "clue", "actor": "ada-king", "payload": {"clue_id": "clue-corbitt-will", "summary": "Ada found the Corbitt lawsuit trail."}},
        {"type": "sanity", "actor": "ada-king", "payload": {"summary": "Ada passed a SAN roll and lost no SAN."}},
        {"type": "session_ending", "actor": "keeper_under_test", "payload": {"summary": "Session ended with Ada planning to visit the Corbitt House next."}},
    ])
    (run_dir / "artifacts" / "battle-report.md").write_text(
        "# Battle Report\n\n"
        "## Mechanical Log\n"
        "- Library Use: ada-king rolled 42 vs 60 -> regular_success\n"
        "  - Goal: find the earliest public clue about Walter Corbitt\n"
        "  - Difficulty: regular\n"
        "  - Difficulty Rationale: public newspaper clipping files are accessible with focused research\n"
        "  - Failure Consequence: lose time and risk missing the Chapel lead until another clue appears\n"
        "  - Skill Check Earned: yes\n"
        "- Spot Hidden: ada-king rolled 34 vs 55 -> regular_success\n"
        "  - Pushed Roll: yes\n"
        "  - Push Justification: Ada spends ten more minutes checking the desk underside and accepts that someone may return.\n"
        "  - Foreshadowed Failure: If this fails, Ada hears footsteps and loses the chance to search quietly.\n"
        "  - Skill Check Earned: yes\n\n"
        "## Session Ending\n- Session ended with Ada planning to visit the Corbitt House next.\n\n"
        "## Story Recap\n- Ada accepted Knott's job and found the first Chapel lead.\n\n"
        "## Player Feedback On KP\n- kp_clarity: 5 - KP explained what I could do and why rolls happened.\n",
    )


def finding_codes(audit: dict) -> set[str]:
    return {finding["code"] for finding in audit["findings"]}


def finding_causes(audit: dict) -> set[str]:
    return {finding["cause"] for finding in audit["findings"]}


def test_rulebook_audit_classifies_smoke_run_gaps(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "smoke-run"
    create_smoke_run(run_dir)

    audit = coc_playtest_audit.audit_run(run_dir)
    artifact = coc_playtest_audit.generate_rulebook_audit(run_dir)
    text = artifact.read_text()

    assert audit["result"] == "fail"
    assert "scenario_context_missing" in finding_codes(audit)
    assert "conversation_loop_too_thin" in finding_codes(audit)
    assert "roll_protocol_incomplete" in finding_codes(audit)
    assert "report_missing_recorded_play" in finding_codes(audit)
    assert {"test_gap", "system_gap", "report_gap"}.issubset(finding_causes(audit))
    assert "## Root Cause Classification" in text
    assert "[test_gap] scenario_context_missing" in text
    assert "[system_gap] roll_protocol_incomplete" in text
    assert "[report_gap] report_missing_recorded_play" in text
    assert "## Blueprint Cross-Check" in text
    assert "designed_not_implemented" in text
    assert "## Next Loop Fix Target" in text


def test_rulebook_audit_accepts_rulebook_shaped_run(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-loop"
    create_final_rulebook_run(run_dir)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "pass"
    assert audit["findings"] == []


def test_final_audit_requires_pushed_roll_session_end_and_mechanical_detail(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-loop"
    create_rulebook_shaped_run(run_dir)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "pushed_roll_missing" in finding_codes(audit)
    assert "session_ending_missing" in finding_codes(audit)
    assert "mechanical_detail_not_rendered" in finding_codes(audit)
    assert "skill_development_not_rendered" in finding_codes(audit)


def test_final_audit_rejects_raw_payload_rendering(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-loop"
    create_final_rulebook_run(run_dir)
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(report_path.read_text() + "\n- clue: ada - {'summary': 'raw payload leaked'}\n")

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "raw_payload_rendered" in finding_codes(audit)


def test_haunting_module_audit_requires_module_coverage_and_resolution(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-module"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["module_coverage"] = ["knott_hiring", "research_route"]
    metadata["subsystems_covered"] = ["investigation", "sanity"]
    metadata_path.write_text(json.dumps(metadata))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "module_coverage_incomplete" in finding_codes(audit)
    assert "subsystem_coverage_incomplete" in finding_codes(audit)
    assert "combat_resolution_missing" in finding_codes(audit)
    assert "final_state_missing" in finding_codes(audit)
    assert "module_decisions_too_thin" in finding_codes(audit)
    assert "chase_context_missing" in finding_codes(audit)


def test_chase_drill_audit_requires_chase_state_and_resolution(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "chase-drill"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "chase_drill"
    metadata["subsystems_covered"] = ["investigation", "sanity"]
    metadata_path.write_text(json.dumps(metadata))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "chase_subsystem_missing" in finding_codes(audit)
    assert "chase_state_missing" in finding_codes(audit)
    assert "chase_resolution_missing" in finding_codes(audit)
    assert "chase_report_missing_key_moments" in finding_codes(audit)


def test_active_audit_requires_chinese_visible_kp_and_player_dialogue(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-module"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["module_coverage"] = [
        "knott_hiring",
        "research_route",
        "chapel_of_contemplation",
        "old_corbitt_place",
        "bed_attack",
        "basement",
        "floating_knife",
        "corbitt_hiding_place",
        "corbitt_confrontation",
        "conclusion_rewards",
    ]
    metadata["subsystems_covered"] = ["investigation", "social", "pushed_roll", "sanity", "damage", "combat"]
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(report_path.read_text() + "\n## Actual Play Replay\n- Turn 1 KP: \"The room is cold.\"\n")

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "visible_dialogue_not_chinese" in finding_codes(audit)
    assert "player_report_sections_not_chinese" in finding_codes(audit)
    assert "scene_replay_missing" in finding_codes(audit)


def test_active_audit_rejects_thin_scene_replay_when_significant_events_exist(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-module"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report\n\n"
        "## Scene-by-Scene Replay\n"
        "- intro: 这是一条中文场景回放。\n\n"
        "## Actual Play Replay\n"
        "- Turn 1 KP: \"这是中文主持描述。\"\n\n"
        "## Major Player Decisions\n"
        "- Ada 选择继续调查。\n\n"
        "## Story Recap\n"
        "- Ada 接受委托并找到线索。\n\n"
        "## Player Feedback On KP\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "scene_replay_too_thin" in finding_codes(audit)
