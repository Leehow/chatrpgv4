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
    artifact = coc_playtest_audit.generate_rulebook_audit(run_dir)
    text = artifact.read_text()

    assert audit["result"] == "pass"
    assert audit["findings"] == []
    assert "## Positive Rulebook Evidence" in text
    assert "Transcript turns:" in text
    assert "Roll protocol:" in text
    assert "Pushed rolls:" in text


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


def test_chase_drill_audit_requires_chase_tracker_rendering(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "chase-drill"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "chase_drill"
    metadata["subsystems_covered"] = ["investigation", "chase"]
    metadata_path.write_text(json.dumps(metadata))
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-loop"
    write_json(campaign_dir / "save" / "chase.json", {
        "chase_id": "rooftop-chase",
        "status": "resolved",
        "round": 2,
        "participants": [
            {
                "id": "ada-king-chase",
                "role": "quarry",
                "base_mov": 8,
                "adjusted_mov": 8,
                "dex": 50,
                "movement_actions": 1,
                "position": "laundry-roof",
            },
            {
                "id": "nathaniel-crowe",
                "role": "pursuer",
                "base_mov": 8,
                "adjusted_mov": 9,
                "dex": 60,
                "movement_actions": 2,
                "position": "locked-roof-door",
            },
        ],
        "dex_order": ["nathaniel-crowe", "ada-king-chase"],
        "location_chain": [
            {"id": "print-shop-roof", "label": "start"},
            {"id": "slick-skylight", "label": "hazard", "difficulty": "regular", "skill": "Dodge"},
            {"id": "locked-roof-door", "label": "barrier", "difficulty": "regular", "skill": "Locksmith"},
            {"id": "laundry-roof", "label": "escape"},
        ],
        "rounds": [
            {"round": 1, "summary": "Round 1 shows speed roll, MOV, movement actions, location chain, and hazard."},
            {"round": 2, "summary": "Round 2 shows DEX order, barrier, conflict, and why the quarry escapes."},
        ],
        "outcome": "quarry escapes",
    })
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {
            "type": "clue",
            "actor": "ada-king",
            "payload": {"clue_id": "ledger-clue", "summary": "Ada finds the ledger."},
        },
        {
            "type": "chase",
            "actor": "keeper_under_test",
            "payload": {
                "summary": "speed roll, MOV, movement actions, location chain, DEX order, hazard, barrier, conflict, quarry escapes",
            },
        },
        {
            "type": "session_ending",
            "actor": "keeper_under_test",
            "payload": {"summary": "The chase ends with the quarry escapes result."},
        },
    ])
    (run_dir / "artifacts" / "battle-report.md").write_text(
        "# Battle Report\n\n"
        "## Scene-by-Scene Replay\n"
        "- chase: KP - 追逐结束。\n"
        "- session ending: KP - 本幕结束。\n\n"
        "## Actual Play Replay\n"
        "- Turn 1 KP: \"追逐开始。\"\n"
        "- Turn 2 Player: \"我继续跑。\"\n\n"
        "## Major Player Decisions\n"
        "- Ada 选择继续追逐。\n\n"
        "## Story Recap\n"
        "- Ada 完成屋顶追逐。\n\n"
        "## Player Feedback On KP\n"
        "- kp_clarity: 5 - KP 规则解释清楚。\n\n"
        "## Rules & Rolls Recap\n"
        "- Goal: chase drill. Difficulty: regular. Difficulty Rationale: drill. Failure Consequence: escape changes.\n\n"
        "## Chase Summary\n"
        "- speed roll, MOV, movement actions, location chain, DEX order, hazard, barrier, conflict, quarry escapes.\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    codes = finding_codes(audit)
    assert "chase_tracker_not_rendered" in codes
    assert "chase_state_missing" not in codes
    assert "chase_resolution_missing" not in codes
    assert "chase_report_missing_key_moments" not in codes


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


def test_active_audit_rejects_unlocalized_visible_glossary_terms(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-module"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata["localized_terms"] = {
        "zh-Hans": {
            "Ada King": "艾达·金",
            "Mr. Knott": "诺特先生",
            "Walter Corbitt": "沃尔特·科比特",
        }
    }
    metadata_path.write_text(json.dumps(metadata))
    write_jsonl(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "mode": "play", "text": "Mr. Knott 把钥匙交给 Ada King。"},
        {"turn": 2, "role": "player_simulator", "mode": "play", "intent": "ask terms", "text": "我问 Mr. Knott 关于 Walter Corbitt 的事。"},
        {"turn": 3, "role": "keeper_under_test", "mode": "play", "ruling": "no_roll_needed", "text": "这里不需要检定。"},
        {"turn": 4, "role": "player_simulator", "mode": "play", "intent": "continue", "text": "我继续调查。"},
        {"turn": 5, "role": "keeper_under_test", "mode": "play", "ruling": "library_use_regular", "text": "做 Library Use，Regular difficulty。"},
        {"turn": 6, "role": "system", "mode": "roll", "text": "Library Use 42 vs 60 -> regular_success."},
        {"turn": 7, "role": "keeper_under_test", "mode": "play", "text": "你找到线索。"},
        {"turn": 8, "role": "player_simulator", "mode": "play", "intent": "end", "text": "我记录线索。"},
    ])
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report\n\n"
        "## Scene-by-Scene Replay\n"
        "- intro: Mr. Knott 把钥匙交给 Ada King。\n"
        "- clue: Walter Corbitt 的线索出现。\n"
        "- sanity: 艾达保持冷静。\n"
        "- session ending: KP - 本幕结束。\n\n"
        "## Actual Play Replay\n"
        "- Turn 1 KP: \"Mr. Knott 把钥匙交给 Ada King。\"\n"
        "- Turn 2 Player: \"我问 Mr. Knott 关于 Walter Corbitt 的事。\"\n\n"
        "## Major Player Decisions\n"
        "- Ada 选择继续调查。\n\n"
        "## Story Recap\n"
        "- Ada 接受委托并找到线索。\n\n"
        "## Player Feedback On KP\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "visible_glossary_terms_not_localized" in finding_codes(audit)
    assert "report_glossary_terms_not_localized" in finding_codes(audit)


def test_active_audit_rejects_actor_ids_in_player_readable_report_sections(tmp_path):
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
        "- combat: ada-king - 艾达挡开匕首。\n\n"
        "## Actual Play Replay\n"
        "- Turn 1 KP: \"这是中文主持描述。\"\n\n"
        "## Major Player Decisions\n"
        "- Ada 选择继续调查。\n\n"
        "## Combat Summary\n"
        "- ada-king: 艾达挡开匕首。\n\n"
        "## Sanity Summary\n"
        "- ada-king: 艾达保持清醒。\n\n"
        "## Story Recap\n"
        "- Ada 接受委托并找到线索。\n\n"
        "## Player Feedback On KP\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_actor_ids_not_localized" in finding_codes(audit)


def test_active_audit_rejects_state_ids_in_player_readable_report_sections(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-module"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata_path.write_text(json.dumps(metadata))
    write_jsonl(run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-loop" / "logs" / "events.jsonl", [
        {
            "type": "scene",
            "actor": "keeper_under_test",
            "payload": {"scene_id": "knott-office", "summary": "诺特先生给出委托。"},
        },
        {
            "type": "clue",
            "actor": "ada-king",
            "payload": {"clue_id": "deed-note", "summary": "艾达找到房契旁注。"},
        },
        {
            "type": "session_ending",
            "actor": "keeper_under_test",
            "payload": {"summary": "本幕结束。"},
        },
    ])
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- knott-office: 诺特先生给出委托。\n"
        "- clue:deed-note: 艾达找到房契旁注。\n"
        "- session ending: KP - 本幕结束。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- Turn 1 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Clues Found / 已发现线索\n"
        "- deed-note: 艾达找到房契旁注。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_state_ids_not_localized" in finding_codes(audit)


def test_active_audit_rejects_event_type_prefixes_in_scene_replay(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-module"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata_path.write_text(json.dumps(metadata))
    write_jsonl(run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-loop" / "logs" / "events.jsonl", [
        {
            "type": "damage",
            "actor": "ada-king",
            "payload": {"summary": "艾达被床铺撞伤。"},
        },
        {
            "type": "session_ending",
            "actor": "keeper_under_test",
            "payload": {"summary": "本幕结束。"},
        },
    ])
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- damage: 艾达·金 - 艾达被床铺撞伤。\n"
        "- session ending: KP - 本幕结束。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- Turn 1 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_event_type_labels_not_localized" in finding_codes(audit)


def test_active_audit_rejects_repeated_actor_labels_in_report_sections(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-module"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata["localized_terms"] = {"zh-Hans": {"Ada King": "艾达·金"}}
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report\n\n"
        "## Scene-by-Scene Replay\n"
        "- combat: 艾达·金 - 艾达·金挡开匕首。\n\n"
        "## Actual Play Replay\n"
        "- Turn 1 KP: \"这是中文主持描述。\"\n\n"
        "## Major Player Decisions\n"
        "- 艾达·金选择继续调查。\n\n"
        "## Combat Summary\n"
        "- 艾达·金: 艾达·金挡开匕首。\n\n"
        "## Story Recap\n"
        "- 艾达·金接受委托并找到线索。\n\n"
        "## Player Feedback On KP\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_actor_label_repeated" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_empty_subsystem_placeholders(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "multi-profile-pressure"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "multi_profile_pressure"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report\n\n"
        "## Scene-by-Scene Replay\n"
        "- intro: 这是中文场景回放。\n\n"
        "## Actual Play Replay\n"
        "- Turn 1 KP: \"这是中文主持描述。\"\n\n"
        "## Major Player Decisions\n"
        "- 艾达选择继续调查。\n\n"
        "## Combat Summary\n"
        "- No combat summary recorded.\n\n"
        "## Chase Summary\n"
        "- No chase summary recorded.\n\n"
        "## Chase Tracker\n"
        "- No chase tracker recorded.\n\n"
        "## Sanity Summary\n"
        "- No sanity summary recorded.\n\n"
        "## Story Recap\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "localized_empty_placeholders_not_rendered" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_player_profile_ids_in_reports(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "multi-profile-pressure"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "multi_profile_pressure"
    metadata["play_language"] = "zh-Hans"
    metadata["player_profiles_tested"] = ["careful_investigator"]
    metadata["player_profile_labels"] = {"zh-Hans": {"careful_investigator": "谨慎调查员"}}
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report\n\n"
        "## Scene-by-Scene Replay\n"
        "- intro: 这是中文场景回放。\n\n"
        "## Actual Play Replay\n"
        "- Turn 1 Player[careful_investigator]: \"我先查资料。\"\n\n"
        "## Session Transcript\n"
        "- Turn 1 Player[careful_investigator]: 我先查资料。\n\n"
        "## Major Player Decisions\n"
        "- 谨慎玩家选择继续调查。\n\n"
        "## Story Recap\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP\n"
        "- kp_clarity: 5 - careful_investigator: KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "player_profile_labels_not_localized" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_transcript_labels(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-transcript-labels"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "multi_profile_pressure"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 这是中文场景回放。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- Turn 1 KP: \"诺特先生给出钥匙。\"\n"
        "  - Intent: start play\n"
        "  - Ruling: no_roll_needed\n"
        "  - Mode: roll\n\n"
        "## Session Transcript / 会话记录\n"
        "- Turn 1 KP: 诺特先生给出钥匙。\n"
        "  - Mode: play\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "transcript_labels_not_localized" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_transcript_detail_values(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-transcript-values"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "multi_profile_pressure"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 这是中文场景回放。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n"
        "  - 意图: request careful research route\n"
        "  - 裁定: library_use_regular\n"
        "  - 模式: roll\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 诺特先生给出钥匙。\n"
        "  - 模式: play\n"
        "  - 意图: use clue to shape plan\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "transcript_detail_values_not_localized" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_report_shell_for_localized_runs(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-shell"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report\n\n"
        "## Run Setup\n"
        "- Campaign: The Haunting\n"
        "- Play Language: zh-Hans\n\n"
        "## Module\n"
        "- Scenario: The Haunting\n"
        "- Opening Scene: 诺特先生给出委托。\n\n"
        "## Scene-by-Scene Replay\n"
        "- 诺特先生给出委托，艾达选择先查资料。\n\n"
        "## Actual Play Replay\n"
        "- Turn 1 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript\n"
        "- Turn 1 KP: 诺特先生给出钥匙。\n\n"
        "## Major Player Decisions\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_shell_not_localized" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_character_dossier_labels(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-character-dossier"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Run Setup / 运行设置\n"
        "- Campaign: The Haunting（战役）\n"
        "- Play Language: zh-Hans（游玩语言）\n"
        "- Player Profile: careful_investigator（玩家画像）\n\n"
        "## Module / 模组\n"
        "- Scenario: The Haunting（模组）\n"
        "- Opening Scene: 诺特先生给出委托。（开场场景）\n\n"
        "## Character Dossier / 角色档案\n"
        "- 艾达·金 (ada-king)\n"
        "  - Occupation: Antiquarian\n"
        "  - Era: 1920s\n"
        "  - Characteristics: STR: 60\n"
        "  - Derived: HP: 12\n"
        "  - Skills: Library Use: 60\n"
        "  - Backstory:\n"
        "    - Description: 艾达·金是一名古物学者。\n"
        "    - Ideology/Beliefs: 公开记录能让真相开口。\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 诺特先生给出委托，艾达选择先查资料。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- Turn 1 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- Turn 1 KP: 诺特先生给出钥匙。\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "character_dossier_labels_not_localized" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_character_dossier_terms(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-character-terms"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata["localized_terms"] = {"zh-Hans": {"Antiquarian": "古物学者"}}
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Run Setup / 运行设置\n"
        "- Campaign: The Haunting（战役）\n"
        "- Play Language: zh-Hans（游玩语言）\n"
        "- Player Profile: careful_investigator（玩家画像）\n\n"
        "## Module / 模组\n"
        "- Scenario: The Haunting（模组）\n"
        "- Opening Scene: 诺特先生给出委托。（开场场景）\n\n"
        "## Character Dossier / 角色档案\n"
        "- 艾达·金 (ada-king)\n"
        "  - 职业: Antiquarian\n"
        "  - 年代: 1920s\n"
        "  - 属性: STR: 60\n"
        "  - 衍生值: HP: 12\n"
        "  - 技能: Library Use: 60\n"
        "  - 背景:\n"
        "    - 描述: 艾达·金是一名古物学者。\n"
        "    - 信念/理念: 公开记录能让真相开口。\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 诺特先生给出委托，艾达选择先查资料。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- Turn 1 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- Turn 1 KP: 诺特先生给出钥匙。\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- kp_clarity: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "character_dossier_terms_not_localized" in finding_codes(audit)


def test_active_audit_requires_investigator_backstory_fields(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "multi-profile-pressure"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "multi_profile_pressure"
    metadata_path.write_text(json.dumps(metadata))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "character_backstory_missing" in finding_codes(audit)


def test_active_audit_requires_investigator_chronicle_and_development(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "multi-profile-pressure"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "multi_profile_pressure"
    metadata_path.write_text(json.dumps(metadata))
    character_path = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king" / "character.json"
    character = json.loads(character_path.read_text())
    character["backstory"] = {
        "description": "Ada is a careful investigator.",
        "ideology_beliefs": ["Records matter."],
        "significant_people": ["Professor Hart."],
        "meaningful_locations": ["The archive."],
        "treasured_possessions": ["Brass magnifier."],
        "traits": ["Patient"],
    }
    character_path.write_text(json.dumps(character))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "investigator_chronicle_missing" in finding_codes(audit)
    assert "investigator_chronicle_not_rendered" in finding_codes(audit)


def test_haunting_module_audit_requires_temporary_insanity_bout(tmp_path):
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
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-loop"
    rolls = [
        json.loads(line)
        for line in (campaign_dir / "logs" / "rolls.jsonl").read_text().splitlines()
        if line.strip()
    ]
    rolls.extend([
        {
            "type": "sanity",
            "actor": "ada-king",
            "payload": {
                "skill": "SAN",
                "goal": "withstand seeing Corbitt rise",
                "target": 51,
                "effective_target": 51,
                "difficulty": "sanity",
                "difficulty_rationale": "Corbitt rising calls for SAN 1/1D8.",
                "roll": 63,
                "outcome": "failure",
                "failure_consequence": "Ada loses 1D8 SAN and may suffer temporary insanity.",
                "san_loss": 6,
            },
        },
        {
            "type": "roll",
            "actor": "ada-king",
            "payload": {
                "skill": "INT",
                "goal": "determine whether the 5+ SAN loss causes temporary insanity",
                "target": 70,
                "effective_target": 70,
                "difficulty": "regular",
                "difficulty_rationale": "A successful INT roll means Ada comprehends the horror.",
                "roll": 35,
                "outcome": "regular_success",
                "failure_consequence": "On failure, Ada would be shaken but not temporarily insane.",
                "skill_check_earned": False,
                "temporary_insanity_triggered": True,
            },
        },
    ])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", rolls)
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(report_path.read_text() + "\n## Sanity Summary\n- 临时疯狂触发。\n")

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "temporary_insanity_bout_missing" in finding_codes(audit)
    assert "temporary_insanity_bout_not_rendered" in finding_codes(audit)


def test_haunting_module_audit_requires_bout_duration_roll(tmp_path):
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
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-loop"
    rolls = [
        json.loads(line)
        for line in (campaign_dir / "logs" / "rolls.jsonl").read_text().splitlines()
        if line.strip()
    ]
    rolls.append({
        "type": "roll",
        "actor": "ada-king",
        "payload": {
            "skill": "INT",
            "goal": "determine whether the 5+ SAN loss causes temporary insanity",
            "target": 70,
            "effective_target": 70,
            "difficulty": "regular",
            "difficulty_rationale": "A successful INT roll means Ada comprehends the horror.",
            "roll": 35,
            "outcome": "regular_success",
            "failure_consequence": "On failure, Ada would be shaken but not temporarily insane.",
            "skill_check_earned": False,
            "temporary_insanity_triggered": True,
        },
    })
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", rolls)
    events = [
        json.loads(line)
        for line in (campaign_dir / "logs" / "events.jsonl").read_text().splitlines()
        if line.strip()
    ]
    events.append({
        "type": "bout_of_madness",
        "actor": "ada-king",
        "payload": {
            "summary": "Bout of Madness：Ada loses control for 1D10 rounds.",
            "duration_die": "1D10",
        },
    })
    write_jsonl(campaign_dir / "logs" / "events.jsonl", events)
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(report_path.read_text() + "\n## Sanity Summary\n- Bout of Madness：Ada loses control for 1D10 rounds.\n")

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "temporary_insanity_bout_duration_missing" in finding_codes(audit)
