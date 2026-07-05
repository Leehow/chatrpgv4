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
coc_playtest_harness = load_module("coc_playtest_harness", "plugins/coc-keeper/scripts/coc_playtest_harness.py")


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


def test_rulebook_audit_rejects_skill_check_on_non_skill_roll(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-loop"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
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
            "skill": "DEX",
            "goal": "push through a dangerous stair descent",
            "target": 50,
            "effective_target": 50,
            "difficulty": "regular",
            "difficulty_rationale": "Ada braces on the stair rail.",
            "roll": 44,
            "outcome": "regular_success",
            "pushed": True,
            "failure_consequence": "Ada would fall down the stairs.",
            "skill_check_earned": True,
        },
    })
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", rolls)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "invalid_skill_check_earned" in finding_codes(audit)


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


def test_rulebook_audit_requires_structured_sanity_prompt_before_san_roll(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "sanity-prompt-gap"
    create_rulebook_shaped_run(run_dir)
    transcript_path = run_dir / "transcript.jsonl"
    transcript = [
        {key: value for key, value in event.items() if key != "ruling"}
        for event in (json.loads(line) for line in transcript_path.read_text().splitlines() if line.strip())
    ]
    write_jsonl(transcript_path, transcript)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert "sanity_prompt_missing" in finding_codes(audit)


def test_rulebook_audit_requires_keeper_prompt_link_for_multi_roll_system_turn(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "multi-roll-prompt-gap"
    create_final_rulebook_run(run_dir)
    transcript_path = run_dir / "transcript.jsonl"
    transcript = [json.loads(line) for line in transcript_path.read_text().splitlines() if line.strip()]
    transcript.append({
        "turn": 11,
        "role": "system",
        "mode": "roll",
        "roll_count": 2,
        "text": "Dodge 19 vs 35 -> success; Fighting 62 vs 45 -> failure.",
    })
    write_jsonl(transcript_path, transcript)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert "multi_roll_prompt_missing" in finding_codes(audit)


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


def test_haunting_module_audit_uses_structured_final_state_fields(tmp_path):
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
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {"type": "decision", "actor": "ada-king", "payload": {"summary": "Ada chose to research before entering the house."}},
        {"type": "decision", "actor": "ada-king", "payload": {"summary": "Ada pushed for archive access."}},
        {"type": "decision", "actor": "ada-king", "payload": {"summary": "Ada entered the chapel."}},
        {"type": "decision", "actor": "ada-king", "payload": {"summary": "Ada entered the basement."}},
        {"type": "decision", "actor": "ada-king", "payload": {"summary": "Ada used Corbitt's dagger."}},
        {
            "type": "combat",
            "actor": "keeper_under_test",
            "payload": {"summary": "combat round against Corbitt resolves."},
        },
        {
            "type": "combat",
            "actor": "ada-king",
            "payload": {
                "summary": "Corbitt is destroyed.",
                "rulebook_exception": "own_dagger_ignores_spells",
                "flesh_ward_bypassed": True,
                "armor_before": 7,
            },
        },
        {
            "type": "resource_change",
            "actor": "walter-corbitt",
            "payload": {
                "resource": "magic_points",
                "reason": "flesh_ward",
                "source_turn": 21,
                "before": 18,
                "cost": 2,
                "delta": -2,
                "after": 16,
                "armor_rolls": [4, 3],
                "armor_points": 7,
            },
        },
        {
            "type": "resource_change",
            "actor": "walter-corbitt",
            "payload": {
                "resource": "magic_points",
                "reason": "floating_knife_attack",
                "source_turn": 40,
                "before": 16,
                "cost": 1,
                "delta": -1,
                "after": 15,
            },
        },
        {
            "type": "resource_change",
            "actor": "walter-corbitt",
            "payload": {
                "resource": "magic_points",
                "reason": "animate_body",
                "source_turn": 46,
                "before": 15,
                "cost": 2,
                "delta": -2,
                "after": 13,
            },
        },
        {
            "type": "status",
            "actor": "ada-king",
            "payload": {
                "summary": "Ada survives and receives the reward.",
                "final_hp": 3,
                "final_san": 49,
                "rewards": ["+4 SAN", "$30 bonus"],
            },
        },
        {
            "type": "chase",
            "actor": "keeper_under_test",
            "payload": {"summary": "This module has no required chase sequence."},
        },
    ])

    audit = coc_playtest_audit.audit_run(run_dir)

    assert "final_state_missing" not in finding_codes(audit)


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


def test_chase_drill_audit_does_not_require_hardcoded_report_moment_text(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "chase-drill"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "chase_drill"
    metadata["play_language"] = "zh-Hans"
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
            {
                "round": 1,
                "turns": [
                    {"actor_id": "nathaniel-crowe", "action": "close_distance"},
                    {"actor_id": "ada-king-chase", "action": "cross_hazard"},
                ],
                "summary": "Round 1 shows speed roll, MOV, movement actions, location chain, and hazard.",
            },
            {
                "round": 2,
                "turns": [
                    {"actor_id": "nathaniel-crowe", "action": "attack"},
                    {"actor_id": "ada-king-chase", "action": "escape"},
                ],
                "summary": "Round 2 shows DEX order, barrier, conflict, and why the quarry escapes.",
            },
        ],
        "outcome": "quarry escapes",
    })
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {
            "type": "chase",
            "actor": "keeper_under_test",
            "payload": {
                "summary": "speed roll, MOV, movement actions, location chain, DEX order, hazard, barrier, conflict, quarry escapes",
            },
        },
    ])
    (run_dir / "artifacts" / "battle-report.md").write_text(
        "# 跑团战报 <!-- report-anchor: Battle Report -->\n\n"
        "## 逐场景回放 <!-- report-anchor: Scene-by-Scene Replay -->\n"
        "- 艾达先判断体力差距，再沿屋脊分段移动；她处理天窗滑落风险、门锁阻挡和短棍追击，最后甩开追赶者。\n\n"
        "## 实际跑团回放 <!-- report-anchor: Actual Play Replay -->\n"
        "- 第 1 轮 KP: \"屋顶上的雨越来越大。\"\n"
        "- 第 2 轮 玩家: \"我抱着账本往晾衣绳那边钻。\"\n\n"
        "## 会话记录 <!-- report-anchor: Session Transcript -->\n"
        "- 第 1 轮 KP: 屋顶上的雨越来越大。\n"
        "- 第 2 轮 玩家: 我抱着账本往晾衣绳那边钻。\n\n"
        "## 玩家关键决定 <!-- report-anchor: Major Player Decisions -->\n"
        "- 艾达选择带着账本冲过屋顶路线。\n\n"
        "## 追逐摘要 <!-- report-anchor: Chase Summary -->\n"
        "- 艾达先判断体力差距，再沿屋脊分段移动；她处理天窗滑落风险、门锁阻挡和短棍追击，最后甩开追赶者。\n\n"
        "## 剧情回顾 <!-- report-anchor: Story Recap -->\n"
        "- 艾达带着账本从屋顶逃离。\n\n"
        "## 玩家对 KP 的反馈 <!-- report-anchor: Player Feedback On KP -->\n"
        "- KP 清晰度 5/5：玩家反馈：“KP 解释清楚。”\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    codes = finding_codes(audit)
    assert "chase_resolution_missing" not in codes
    assert "chase_report_missing_key_moments" not in codes


def test_chase_drill_audit_uses_chase_state_for_resolution_evidence(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "chase-drill"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "chase_drill"
    metadata["play_language"] = "zh-Hans"
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
            {
                "round": 1,
                "turns": [
                    {"actor_id": "nathaniel-crowe", "action": "close_distance"},
                    {"actor_id": "ada-king-chase", "action": "cross_hazard"},
                ],
            },
            {
                "round": 2,
                "turns": [
                    {"actor_id": "nathaniel-crowe", "action": "attack"},
                    {"actor_id": "ada-king-chase", "action": "escape"},
                ],
            },
        ],
        "outcome": "quarry escapes",
    })
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {
            "type": "chase",
            "actor": "keeper_under_test",
            "payload": {"summary": "艾达判断双方脚程，穿过屋顶险处与门锁阻挡后，抱着账本甩开追赶者。"},
        },
    ])

    audit = coc_playtest_audit.audit_run(run_dir)

    assert "chase_state_missing" not in finding_codes(audit)
    assert "chase_resolution_missing" not in finding_codes(audit)


def test_chase_drill_audit_requires_movement_actions_in_chase_state(tmp_path):
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
            {"id": "ada-king-chase", "role": "quarry", "base_mov": 8, "adjusted_mov": 8, "dex": 50},
            {"id": "nathaniel-crowe", "role": "pursuer", "base_mov": 8, "adjusted_mov": 9, "dex": 60},
        ],
        "dex_order": ["nathaniel-crowe", "ada-king-chase"],
        "location_chain": [{"id": "print-shop-roof", "label": "start"}],
        "rounds": [{"round": 1, "turns": [{"actor_id": "nathaniel-crowe"}]}],
        "outcome": "quarry escapes",
    })

    audit = coc_playtest_audit.audit_run(run_dir)

    assert "chase_state_missing" not in finding_codes(audit)
    assert "chase_resolution_missing" in finding_codes(audit)


def test_chase_drill_audit_requires_object_transfer_for_carried_chase_prize(tmp_path):
    run_dir = coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="chase-drill")
    events_path = run_dir / "sandbox" / ".coc" / "campaigns" / "chase-drill" / "logs" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text().splitlines()
        if line.strip()
    ]
    write_jsonl(events_path, [
        event
        for event in events
        if event.get("type") != "item_transfer"
    ])

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "chase_object_transfer_missing" in finding_codes(audit)


def test_chase_drill_audit_requires_hazard_rolls_for_all_hazard_crossings(tmp_path):
    run_dir = coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="chase-drill")
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "chase-drill"
    chase_path = campaign_dir / "save" / "chase.json"
    chase_state = json.loads(chase_path.read_text())
    for chase_round in chase_state["rounds"]:
        for turn in chase_round.get("turns", []):
            if turn.get("actor_id") == "nathaniel-crowe":
                turn.pop("hazard_id", None)
                turn.pop("hazard_roll_id", None)
    chase_path.write_text(json.dumps(chase_state))

    rolls_path = campaign_dir / "logs" / "rolls.jsonl"
    rolls = [
        json.loads(line)
        for line in rolls_path.read_text().splitlines()
        if line.strip()
    ]
    write_jsonl(rolls_path, [
        roll
        for roll in rolls
        if roll.get("payload", {}).get("chase_hazard_id") != "slick-skylight"
        or roll.get("actor") != "nathaniel-crowe"
    ])

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "chase_hazard_resolution_missing" in finding_codes(audit)


def test_chase_drill_audit_requires_barrier_and_hide_roll_links_for_escape(tmp_path):
    run_dir = coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="chase-drill")
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "chase-drill"
    chase_path = campaign_dir / "save" / "chase.json"
    chase_state = json.loads(chase_path.read_text())
    for chase_round in chase_state["rounds"]:
        for turn in chase_round.get("turns", []):
            if turn.get("actor_id") == "ada-king-chase" and turn.get("action") == "pass_barrier_and_hide":
                for field in (
                    "barrier_id",
                    "barrier_roll_id",
                    "hide_attempt_id",
                    "hide_roll_id",
                    "hide_search_actor_id",
                    "hide_search_roll_id",
                ):
                    turn.pop(field, None)
            if turn.get("actor_id") == "nathaniel-crowe":
                turn.pop("hide_attempt_id", None)
                turn.pop("search_roll_id", None)
    chase_path.write_text(json.dumps(chase_state))

    rolls_path = campaign_dir / "logs" / "rolls.jsonl"
    rolls = [
        json.loads(line)
        for line in rolls_path.read_text().splitlines()
        if line.strip()
    ]
    write_jsonl(rolls_path, [
        roll
        for roll in rolls
        if roll.get("payload", {}).get("chase_barrier_id") != "locked-roof-door"
        and roll.get("payload", {}).get("chase_hide_attempt_id") != "laundry-roof-hide"
    ])

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "chase_barrier_hide_resolution_missing" in finding_codes(audit)


def test_chase_drill_audit_rejects_round_turns_out_of_dex_order(tmp_path):
    run_dir = coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="chase-drill")
    chase_path = run_dir / "sandbox" / ".coc" / "campaigns" / "chase-drill" / "save" / "chase.json"
    chase_state = json.loads(chase_path.read_text())
    chase_state["dex_order"] = ["nathaniel-crowe", "ada-king-chase"]
    chase_state["rounds"][0]["turns"] = [
        {"actor_id": "ada-king-chase", "action": "cross_hazard"},
        {"actor_id": "nathaniel-crowe", "action": "close_distance"},
    ]
    chase_path.write_text(json.dumps(chase_state))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "chase_dex_order_not_proven" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_chase_tracker_labels(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "chase-tracker-labels"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "chase_drill"
    metadata["play_language"] = "zh-Hans"
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
            "type": "chase",
            "actor": "keeper_under_test",
            "payload": {
                "summary": "速度检定、MOV、移动行动、位置链、DEX 顺序、危险点、障碍、冲突、被追者逃脱",
            },
        },
    ])
    (run_dir / "artifacts" / "battle-report.md").write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 屋顶追逐结束。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"追逐开始。\"\n"
        "- 第 2 轮 玩家: \"我继续跑。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 追逐开始。\n"
        "  - 模式: play\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择继续追逐。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达完成屋顶追逐。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP 规则解释清楚。\n\n"
        "## Chase Summary / 追逐摘要\n"
        "- 速度检定、MOV、移动行动、位置链、DEX 顺序、危险点、障碍、冲突、被追者逃脱。\n\n"
        "## Chase Tracker / 追逐追踪器\n"
        "- Chase ID: rooftop-chase\n"
        "- Status: resolved\n"
        "- Round: 2\n"
        "- DEX order: nathaniel-crowe -> ada-king-chase\n"
        "- Participants:\n"
        "  - ada-king-chase | quarry | MOV 8 -> 8 | DEX 50 | actions 1 | position laundry-roof\n"
        "  - nathaniel-crowe | pursuer | MOV 8 -> 9 | DEX 60 | actions 2 | position locked-roof-door\n"
        "- Location Chain:\n"
        "  - slick-skylight [hazard, regular, Dodge]\n"
        "  - locked-roof-door [barrier, regular, Locksmith]\n"
        "- Rounds:\n"
        "  - Round 1: Nathaniel has two movement actions.\n"
        "- Outcome: quarry escapes\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "chase_tracker_labels_not_localized" in finding_codes(audit)


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


def test_active_audit_rejects_raw_state_change_prefixes(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-state-changes"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
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
        "# 跑团战报 <!-- report-anchor: Battle Report -->\n\n"
        "## 逐场景回放 <!-- report-anchor: Scene-by-Scene Replay -->\n"
        "- 诺特先生给出委托。\n"
        "- 艾达找到房契旁注。\n"
        "- 本幕结束。\n\n"
        "## 机制日志 <!-- report-anchor: Mechanical Log -->\n"
        "### 状态变化 <!-- report-anchor: State Changes -->\n"
        "- scene: knott-office - 诺特先生给出委托。\n"
        "- clue: deed-note - 艾达找到房契旁注。\n"
        "- session ending: KP - 本幕结束。\n\n"
        "## 实际跑团回放 <!-- report-anchor: Actual Play Replay -->\n"
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n\n"
        "## 玩家关键决定 <!-- report-anchor: Major Player Decisions -->\n"
        "- 艾达选择先查资料。\n\n"
        "## 剧情回顾 <!-- report-anchor: Story Recap -->\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## 玩家对 KP 的反馈 <!-- report-anchor: Player Feedback On KP -->\n"
        "- KP 清晰度 5/5：玩家反馈：“KP 解释清楚。”\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_state_ids_not_localized" in finding_codes(audit)
    assert "report_event_type_labels_not_localized" in finding_codes(audit)


def test_active_audit_rejects_actor_ids_in_state_changes(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-state-actors"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# 跑团战报 <!-- report-anchor: Battle Report -->\n\n"
        "## 逐场景回放 <!-- report-anchor: Scene-by-Scene Replay -->\n"
        "- 艾达接受委托。\n\n"
        "## 机制日志 <!-- report-anchor: Mechanical Log -->\n"
        "### 状态变化 <!-- report-anchor: State Changes -->\n"
        "- ada-king - 艾达接受委托。\n\n"
        "## 实际跑团回放 <!-- report-anchor: Actual Play Replay -->\n"
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n\n"
        "## 玩家关键决定 <!-- report-anchor: Major Player Decisions -->\n"
        "- 艾达选择先查资料。\n\n"
        "## 剧情回顾 <!-- report-anchor: Story Recap -->\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## 玩家对 KP 的反馈 <!-- report-anchor: Player Feedback On KP -->\n"
        "- KP 清晰度 5/5：玩家反馈：“KP 解释清楚。”\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_actor_ids_not_localized" in finding_codes(audit)


def test_active_audit_rejects_memory_ids_in_story_recap(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-memory-ids"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    write_jsonl(run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-loop" / "memory" / "session-summaries.jsonl", [
        {"session_id": "session-1", "summary": "艾达接受委托并找到线索。"},
    ])
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 这是中文场景回放。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 诺特先生给出钥匙。\n"
        "  - 模式: play\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- session-1: 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_memory_ids_not_localized" in finding_codes(audit)


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


def test_active_audit_rejects_actor_dash_prefixes_in_scene_replay(tmp_path):
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
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 艾达·金 - 床铺袭击造成伤害: 5 HP；HP 12 -> 7。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"这是中文主持描述。\"\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达·金选择继续调查。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达·金接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_actor_dash_prefix" in finding_codes(audit)


def test_active_audit_rejects_actor_colon_prefixes_in_subsystem_summaries(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "chase-drill"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "chase_drill"
    metadata["play_language"] = "zh-Hans"
    metadata["localized_terms"] = {"zh-Hans": {"Ada King": "艾达·金"}}
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 艾达·金穿过湿滑天窗。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"这是中文主持描述。\"\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达·金选择继续追逐。\n\n"
        "## Combat Summary / 战斗摘要\n"
        "- KP: 本轮没有触发战斗场面。\n\n"
        "## Chase Summary / 追逐摘要\n"
        "- 艾达·金: 危险点：艾达·金穿过湿滑天窗。\n\n"
        "## Sanity Summary / 理智摘要\n"
        "- 艾达·金: 疯狂发作：艾达·金短暂失控。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达·金完成追逐。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_actor_colon_prefix" in finding_codes(audit)


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
    metadata["player_profile_labels"] = {"zh-Hans": {"careful_investigator": "谨慎风格"}}
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
        "- 谨慎风格选择继续调查。\n\n"
        "## Story Recap\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP\n"
        "- kp_clarity: 5 - careful_investigator: KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "player_profile_labels_not_localized" in finding_codes(audit)


def test_multi_profile_rulebook_audit_lists_pressure_protocol_evidence(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "multi-profile-pressure"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "multi_profile_pressure"
    metadata["play_language"] = "zh-Hans"
    metadata["player_profiles_tested"] = [
        "careful_investigator",
        "reckless_investigator",
        "skeptical_rules_lawyer",
    ]
    metadata["player_profile_labels"] = {
        "zh-Hans": {
            "careful_investigator": "谨慎风格",
            "reckless_investigator": "鲁莽风格",
            "skeptical_rules_lawyer": "规则质疑风格",
        }
    }
    metadata_path.write_text(json.dumps(metadata))
    transcript_path = run_dir / "transcript.jsonl"
    transcript = [
        json.loads(line)
        for line in transcript_path.read_text().splitlines()
        if line.strip()
    ]
    transcript.extend([
        {
            "turn": 11,
            "role": "player_simulator",
            "player_profile": "careful_investigator",
            "mode": "play",
            "intent": "careful planning",
            "text": "我先查资料。",
        },
        {
            "turn": 12,
            "role": "player_simulator",
            "player_profile": "reckless_investigator",
            "mode": "play",
            "intent": "push risk",
            "pushed_roll_protocol": {
                "roll_id": "fixture-push",
                "stage": "player_reframes_action",
            },
            "text": "我换个危险办法再查一次。",
        },
        {
            "turn": 13,
            "role": "keeper_under_test",
            "mode": "play",
            "pushed_roll_protocol": {
                "roll_id": "fixture-push",
                "stage": "keeper_foreshadows_failure",
                "failure_consequence_source": "keeper",
            },
            "text": "如果失败，会先惊动屋里的人。",
        },
        {
            "turn": 14,
            "role": "player_simulator",
            "player_profile": "reckless_investigator",
            "mode": "play",
            "pushed_roll_protocol": {
                "roll_id": "fixture-push",
                "stage": "player_confirms_risk",
                "risk_confirmed": True,
            },
            "text": "确定，我接受这个风险。",
        },
        {
            "turn": 15,
            "role": "system",
            "mode": "roll",
            "pushed_roll_protocol": {
                "roll_id": "fixture-push",
                "stage": "roll_resolved",
            },
            "text": "Spot Hidden 22 vs 55 -> hard_success.",
        },
        {
            "turn": 16,
            "role": "player_simulator",
            "player_profile": "skeptical_rules_lawyer",
            "mode": "meta",
            "intent": "challenge ruling",
            "text": "[meta] 为什么这里能推骰？[/meta]",
        },
        {
            "turn": 17,
            "role": "keeper_under_test",
            "mode": "meta",
            "spoiler_protocol": {
                "spoiler_id": "fixture-spoiler",
                "stage": "warning_issued",
                "keeper_secret_id": "fixture-secret",
                "scope": "fixture_scope",
                "requires_confirmation": True,
            },
            "text": "[spoiler_warning] 这会剧透，确认吗？[/spoiler_warning]",
        },
        {
            "turn": 18,
            "role": "player_simulator",
            "player_profile": "skeptical_rules_lawyer",
            "mode": "meta",
            "spoiler_protocol": {
                "spoiler_id": "fixture-spoiler",
                "stage": "player_confirmed",
                "confirmed": True,
            },
            "text": "[meta] 确认。[/meta]",
        },
        {
            "turn": 19,
            "role": "keeper_under_test",
            "mode": "meta",
            "spoiler_protocol": {
                "spoiler_id": "fixture-spoiler",
                "stage": "limited_reveal",
                "confirmed": True,
            },
            "text": "[meta] 只揭示限定范围。[/meta]",
        },
    ])
    write_jsonl(transcript_path, transcript)

    artifact = coc_playtest_audit.generate_rulebook_audit(run_dir)
    text = artifact.read_text()

    assert "Single-player style pressure: careful_investigator=谨慎风格, reckless_investigator=鲁莽风格, skeptical_rules_lawyer=规则质疑风格." in text
    assert "Multi-profile pressure:" not in text
    assert "Single-player style transcript turns: careful_investigator=1, reckless_investigator=2, skeptical_rules_lawyer=2; skeptical meta turns: 2." in text
    assert "Multi-profile transcript turns:" not in text
    assert "Pushed-roll protocol stages: fixture-push=player_reframes_action -> keeper_foreshadows_failure -> player_confirms_risk -> roll_resolved." in text
    assert "Spoiler protocol stages: fixture-spoiler=warning_issued -> player_confirmed -> limited_reveal." in text


def test_chase_rulebook_audit_lists_pushed_protocol_evidence(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "chase-drill"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "chase_drill"
    metadata["player_profiles_tested"] = [
        "reckless_investigator",
        "skeptical_rules_lawyer",
        "genre_savvy_player",
    ]
    metadata_path.write_text(json.dumps(metadata))
    transcript_path = run_dir / "transcript.jsonl"
    transcript = [
        json.loads(line)
        for line in transcript_path.read_text().splitlines()
        if line.strip()
    ]
    transcript.extend([
        {
            "turn": 11,
            "role": "player_simulator",
            "player_profile": "reckless_investigator",
            "mode": "play",
            "pushed_roll_protocol": {
                "roll_id": "fixture-chase-push",
                "stage": "player_reframes_action",
            },
            "text": "我冒险多看一眼。",
        },
        {
            "turn": 12,
            "role": "keeper_under_test",
            "mode": "play",
            "pushed_roll_protocol": {
                "roll_id": "fixture-chase-push",
                "stage": "keeper_foreshadows_failure",
                "failure_consequence_source": "keeper",
            },
            "text": "如果失败，他会立刻发现你。",
        },
        {
            "turn": 13,
            "role": "player_simulator",
            "player_profile": "reckless_investigator",
            "mode": "play",
            "pushed_roll_protocol": {
                "roll_id": "fixture-chase-push",
                "stage": "player_confirms_risk",
                "risk_confirmed": True,
            },
            "text": "确定。",
        },
        {
            "turn": 14,
            "role": "system",
            "mode": "roll",
            "pushed_roll_protocol": {
                "roll_id": "fixture-chase-push",
                "stage": "roll_resolved",
            },
            "text": "Spot Hidden 33 vs 55 -> regular_success.",
        },
    ])
    write_jsonl(transcript_path, transcript)

    artifact = coc_playtest_audit.generate_rulebook_audit(run_dir)
    text = artifact.read_text()

    assert "Pushed-roll protocol stages: fixture-chase-push=player_reframes_action -> keeper_foreshadows_failure -> player_confirms_risk -> roll_resolved." in text


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


def test_active_audit_rejects_unlocalized_transcript_speaker_and_mode_values(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-transcript-mode-values"
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
        "- 第 1 轮 system: 图书馆使用：艾达·金掷出 42 / 60，结果困难成功。\n"
        "  - 模式: roll\n"
        "- 第 2 轮 KP: \"[meta] 我解释一下推骰风险。[/meta]\"\n"
        "  - 模式: meta\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 system: 图书馆使用：艾达·金掷出 42 / 60，结果困难成功。\n"
        "  - 模式: roll\n"
        "- 第 2 轮 玩家: 我继续查档案。\n"
        "  - 模式: play\n\n"
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


def test_active_audit_rejects_mixed_language_transcript_detail_values(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-mixed-transcript-values"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 这是中文场景回放。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 玩家: \"[meta] 我想确认推骰。[/meta]\"\n"
        "  - 意图: ask 推骰-roll ruling\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 玩家: [meta] 我想确认推骰。[/meta]\n"
        "  - 模式: meta\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "transcript_detail_values_not_localized" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_chronicle_labels(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-chronicle-labels"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Investigator Chronicle / 调查员经历\n"
        "- 艾达·金 (ada-king-haunting)\n"
        "  - History:\n"
        "    - 艾达·金幸存。\n"
        "      - Final HP: 3\n"
        "  - Development:\n"
        "    - Development Phase Summary\n"
        "      - Status: pending_player_rolls\n"
        "      - Skill Checks Earned: Persuade; Spot Hidden\n"
        "      - Carryover Notes: 后续故事入口保留。\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 这是中文场景回放。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 诺特先生给出钥匙。\n"
        "  - 模式: play\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "investigator_chronicle_labels_not_localized" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_feedback_labels(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-feedback-labels"
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
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 诺特先生给出钥匙。\n"
        "  - 模式: play\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- kp_clarity: 5 - 谨慎风格: KP 解释清楚。\n"
        "- agency: 4 - 鲁莽风格: KP 没阻止冒险。\n"
        "- meta_quality: 5 - 规则质疑风格: KP 清楚解释裁定。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "player_feedback_labels_not_localized" in finding_codes(audit)


def test_active_audit_rejects_scorecard_only_player_feedback(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "feedback-scorecard-only"
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
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 诺特先生给出钥匙。\n"
        "  - 模式: 游玩\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP explained what I could do and why rolls happened.\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "player_feedback_voice_missing" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_actual_feedback_categories(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-dynamic-feedback-labels"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    (run_dir / "player-feedback.jsonl").write_text(
        "\n".join([
            json.dumps({"category": "module_fidelity", "score": 4, "text": "覆盖主要模组节点。"}),
            json.dumps({"category": "combat_readability", "score": 4, "text": "战斗轮清楚。"}),
        ])
        + "\n"
    )
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 这是中文场景回放。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 诺特先生给出钥匙。\n"
        "  - 模式: play\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- module_fidelity: 4 - 覆盖主要模组节点。\n"
        "- combat_readability: 4 - 战斗轮清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "player_feedback_labels_not_localized" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_run_setup_values(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-run-setup-values"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata["simulation_method"] = "transcript_driven_virtual_table"
    metadata["dice_mode"] = "codex"
    metadata["spoiler_policy"] = "warn_before_reveal"
    metadata["player_profile"] = "careful_investigator"
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Run Setup / 运行设置\n"
        "- Audit Profile: haunting_module（审计画像）\n"
        "- Simulation Method: transcript_driven_virtual_table（模拟方式）\n"
        "- Dice Mode: codex（骰子模式）\n"
        "- Spoiler Policy: warn_before_reveal（剧透策略）\n"
        "- Play Language: zh-Hans（游玩语言）\n"
        "- Language Profile: Simplified Chinese（语言配置）\n"
        "- Localized Terms: 73 entries (recorded in playtest.json)（本地化术语）\n"
        "- Player Profile: careful_investigator（游玩风格）\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 这是中文场景回放。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 诺特先生给出钥匙。\n"
        "  - 模式: play\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "run_setup_values_not_localized" in finding_codes(audit)


def test_run_setup_value_leaks_rejects_english_localized_terms_summary():
    metadata = {"play_language": "zh-Hans"}
    battle_report = (
        "# 跑团战报 <!-- report-anchor: Battle Report -->\n\n"
        "## 运行设置 <!-- report-anchor: Run Setup -->\n"
        "- 骰子模式: Codex 掷骰\n"
        "- 剧透策略: 剧透前警告\n"
        "- 游玩语言: 简体中文\n"
        "- 语言配置: 简体中文\n"
        "- 本地化术语: 73 entries (recorded in playtest.json)\n"
        "- 游玩风格: 谨慎风格\n\n"
    )

    leaks = coc_playtest_audit._run_setup_value_leaks(battle_report, metadata)

    assert "localized_terms_summary" in leaks


def test_active_audit_rejects_unlocalized_roll_boolean_values(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-roll-booleans"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 这是中文场景回放。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 诺特先生给出钥匙。\n"
        "  - 模式: play\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Rules & Rolls Recap / 规则与掷骰回顾\n"
        "- Persuade：艾达掷出 72 / 55，结果失败。\n"
        "  - 推骰：yes\n"
        "  - 成长标记：no\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_boolean_values_not_localized" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_module_metadata_values(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-module-metadata"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata["campaign_title"] = "The Haunting Module Playthrough"
    metadata["scenario"] = "The Haunting"
    metadata["localized_terms"] = {
        "zh-Hans": {
            "The Haunting Module Playthrough": "《鬼屋》模组实录",
            "The Haunting": "《鬼屋》",
            "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf": "《克苏鲁的呼唤守秘人规则书》40周年纪念版 PDF",
        }
    }
    metadata_path.write_text(json.dumps(metadata))
    scenario_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-loop" / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text())
    scenario["title"] = "The Haunting"
    scenario["module_source"] = "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf"
    scenario_path.write_text(json.dumps(scenario))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Run Setup / 运行设置\n"
        "- Campaign: The Haunting Module Playthrough（战役）\n"
        "- Play Language: zh-Hans（游玩语言）\n\n"
        "## Module / 模组\n"
        "- Scenario: The Haunting（模组）\n"
        "- Source: pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf（来源）\n"
        "- Opening Scene: 诺特先生给出委托。（开场场景）\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 这是中文场景回放。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 诺特先生给出钥匙。\n"
        "  - 模式: play\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "module_metadata_values_not_localized" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_character_derived_value_labels(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-derived-values"
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
        "- Campaign: 《鬼屋》（战役）\n"
        "- Play Language: zh-Hans（游玩语言）\n\n"
        "## Module / 模组\n"
        "- Scenario: 《鬼屋》（模组）\n"
        "- Opening Scene: 诺特先生给出委托。（开场场景）\n\n"
        "## Character Dossier / 角色档案\n"
        "- 艾达·金 (ada-king)\n"
        "  - 职业: 古物学者\n"
        "  - 年代: 1920s\n"
        "  - 属性: STR: 60\n"
        "  - 衍生值: HP: 12, MP: 11, SAN: 55, MOV: 8, damage_bonus: 0, build: 0\n"
        "  - 技能: Library Use: 60\n"
        "  - 背景:\n"
        "    - 描述: 艾达·金是一名古物学者。\n"
        "    - 信念/理念: 公开记录能让真相开口。\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 诺特先生给出委托，艾达选择先查资料。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 诺特先生给出钥匙。\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "character_dossier_derived_labels_not_localized" in finding_codes(audit)


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
        "- Player Profile: careful_investigator（游玩风格）\n\n"
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
        "- Player Profile: careful_investigator（游玩风格）\n\n"
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


def test_active_audit_rejects_unlocalized_player_visible_skill_names(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-skill-names"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata["localized_terms"] = {
        "zh-Hans": {
            "Ada King": "艾达·金",
            "Antiquarian": "古物学者",
            "Library Use": "图书馆使用",
            "Spot Hidden": "侦查",
        }
    }
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Run Setup / 运行设置\n"
        "- Campaign: The Haunting（战役）\n"
        "- Play Language: zh-Hans（游玩语言）\n"
        "- Player Profile: careful_investigator（游玩风格）\n\n"
        "## Module / 模组\n"
        "- Scenario: The Haunting（模组）\n"
        "- Opening Scene: 诺特先生给出委托。（开场场景）\n\n"
        "## Character Dossier / 角色档案\n"
        "- 艾达·金 (ada-king)\n"
        "  - 职业: 古物学者\n"
        "  - 年代: 1920s\n"
        "  - 属性: STR: 60\n"
        "  - 衍生值: HP: 12\n"
        "  - 技能: Library Use: 60; Spot Hidden: 55\n"
        "  - 背景:\n"
        "    - 描述: 艾达·金是一名古物学者。\n"
        "    - 信念/理念: 公开记录能让真相开口。\n\n"
        "## Investigator Chronicle / 调查员经历\n"
        "- 经历: 艾达完成档案调查。\n"
        "  - 获得成长标记: Library Use; Spot Hidden\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 诺特先生给出委托，艾达选择先查资料。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 system: Library Use：艾达·金掷出 42 / 60，结果困难成功。\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 system: Library Use：艾达·金掷出 42 / 60，结果困难成功。\n"
        "  - 模式: roll\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Rules & Rolls Recap / 规则与掷骰回顾\n"
        "- Library Use：艾达·金掷出 42 / 60，结果困难成功。\n"
        "  - 成长标记：是\n"
        "- Spot Hidden：艾达·金掷出 83 / 55，结果失败。\n"
        "  - 成长标记：否\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度: 5 - KP 解释清楚。\n\n"
        "## Mechanical Log\n"
        "- Library Use: ada-king rolled 42 vs 60 -> regular_success\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_skill_names_not_localized" in finding_codes(audit)


def test_active_audit_rejects_unlocalized_mechanical_log_skill_names(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-mechanical-log-skill-names"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata["localized_terms"] = {
        "zh-Hans": {
            "Ada King": "艾达·金",
            "Antiquarian": "古物学者",
            "Library Use": "图书馆使用",
        }
    }
    metadata_path.write_text(json.dumps(metadata))
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# 跑团战报 <!-- report-anchor: Battle Report -->\n\n"
        "## 运行设置 <!-- report-anchor: Run Setup -->\n"
        "- 战役: 《鬼屋》\n"
        "- 游玩语言: 简体中文\n"
        "- 游玩风格: 单人玩家（谨慎风格）\n\n"
        "## 模组 <!-- report-anchor: Module -->\n"
        "- 模组: 《鬼屋》\n"
        "- 开场场景: 诺特先生给出委托。\n\n"
        "## 角色档案 <!-- report-anchor: Character Dossier -->\n"
        "- 艾达·金\n"
        "  - 职业: 古物学者\n"
        "  - 年代: 1920s\n"
        "  - 属性: STR: 60\n"
        "  - 衍生值: HP: 12\n"
        "  - 技能: 图书馆使用: 60\n"
        "  - 背景:\n"
        "    - 描述: 艾达·金是一名古物学者。\n\n"
        "## 调查员经历 <!-- report-anchor: Investigator Chronicle -->\n"
        "- 成长:\n"
        "  - 获得成长标记: 图书馆使用\n\n"
        "## 逐场景回放 <!-- report-anchor: Scene-by-Scene Replay -->\n"
        "- 诺特先生给出委托，艾达选择先查资料。\n\n"
        "## 实际跑团回放 <!-- report-anchor: Actual Play Replay -->\n"
        "- 第 1 轮 系统: 图书馆使用：艾达·金掷出 42 / 60，结果困难成功。\n\n"
        "## 会话记录 <!-- report-anchor: Session Transcript -->\n"
        "- 第 1 轮 系统: 图书馆使用：艾达·金掷出 42 / 60，结果困难成功。\n"
        "  - 模式: 掷骰\n\n"
        "## 规则与掷骰回顾 <!-- report-anchor: Rules & Rolls Recap -->\n"
        "- 图书馆使用：艾达·金掷出 42 / 60，结果困难成功。\n"
        "  - 成长标记：是\n\n"
        "## 机制日志 <!-- report-anchor: Mechanical Log -->\n"
        "- Library Use: ada-king rolled 42 vs 60 -> regular_success\n\n"
        "## 剧情回顾 <!-- report-anchor: Story Recap -->\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## 玩家对 KP 的反馈 <!-- report-anchor: Player Feedback On KP -->\n"
        "- KP 清晰度: 5 - KP 解释清楚。\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "report_skill_names_not_localized" in finding_codes(audit)


def test_active_audit_rejects_missing_status_event_in_scene_replay(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-status-replay"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "zh-Hans"
    metadata_path.write_text(json.dumps(metadata))
    campaign_events_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-loop" / "logs" / "events.jsonl"
    events = [
        json.loads(line)
        for line in campaign_events_path.read_text().splitlines()
        if line.strip()
    ]
    events.append({
        "type": "status",
        "actor": "ada-king",
        "payload": {"summary": "最终 HP: 9；最终 SAN: 52；艾达·金保留房契线索。"},
    })
    write_jsonl(campaign_events_path, events)
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# Battle Report / 跑团战报\n\n"
        "## Scene-by-Scene Replay / 逐场景回放\n"
        "- 诺特先生雇佣艾达调查科比特宅。\n"
        "- 艾达找到科比特诉讼线索。\n"
        "- 艾达通过理智检定，没有失去 SAN。\n"
        "- 本场结束时艾达准备前往科比特宅。\n\n"
        "## Actual Play Replay / 实际跑团回放\n"
        "- 第 1 轮 KP: \"诺特先生给出钥匙。\"\n"
        "  - 模式: 游戏\n\n"
        "## Session Transcript / 会话记录\n"
        "- 第 1 轮 KP: 诺特先生给出钥匙。\n"
        "  - 模式: 游戏\n\n"
        "## Major Player Decisions / 玩家关键决定\n"
        "- 艾达选择先查资料。\n\n"
        "## Story Recap / 剧情回顾\n"
        "- 艾达接受委托并找到线索。\n\n"
        "## Player Feedback On KP / 玩家对 KP 的反馈\n"
        "- KP 清晰度 5/5：玩家反馈：“KP 解释清楚。”\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "status_event_not_rendered" in finding_codes(audit)


def test_active_audit_accepts_localized_status_event_in_scene_replay(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-status-replay"
    create_final_rulebook_run(run_dir)
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["audit_profile"] = "haunting_module"
    metadata["play_language"] = "ja-JP"
    metadata["localized_terms"] = {"ja-JP": {"Ada King": "エイダ・キング"}}
    metadata_path.write_text(json.dumps(metadata))
    campaign_events_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-loop" / "logs" / "events.jsonl"
    events = [
        json.loads(line)
        for line in campaign_events_path.read_text().splitlines()
        if line.strip()
    ]
    events.append({
        "type": "status",
        "actor": "ada-king",
        "payload": {
            "summary": "三种调查风格都保留了有效选择；KP 已说明不同路线的收益、风险和失败后果。",
            "localized_text": {
                "ja-JP": {
                    "summary": "三つの調査スタイルはいずれも有効な選択を残し、KP は各ルートの利益、リスク、失敗時の結果を説明した。"
                }
            },
        },
    })
    write_jsonl(campaign_events_path, events)
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "# プレイ報告 <!-- report-anchor: Battle Report -->\n\n"
        "## シーン別リプレイ <!-- report-anchor: Scene-by-Scene Replay -->\n"
        "- 三つの調査スタイルはいずれも有効な選択を残し、KP は各ルートの利益、リスク、失敗時の結果を説明した。\n\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert "status_event_not_rendered" not in finding_codes(audit)


def test_haunting_module_audit_requires_structured_npc_dialogue(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    transcript_path = run_dir / "transcript.jsonl"
    stripped_events = []
    for line in transcript_path.read_text().splitlines():
        event = json.loads(line)
        event.pop("speaker_role", None)
        stripped_events.append(event)
    transcript_path.write_text("\n".join(json.dumps(event) for event in stripped_events) + "\n")

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "haunting_npc_dialogue_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_vittorio_npc_dialogue(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    transcript_path = run_dir / "transcript.jsonl"
    events = [
        json.loads(line)
        for line in transcript_path.read_text().splitlines()
        if line.strip()
    ]
    filtered_events = [
        event
        for event in events
        if event.get("speaker") != "Vittorio Macario"
    ]
    transcript_path.write_text(
        "\n".join(json.dumps(event, ensure_ascii=False) for event in filtered_events) + "\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "haunting_npc_dialogue_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_inventory_history_for_carryover(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    inventory_path = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king-haunting" / "inventory-history.jsonl"
    inventory_path.write_text("")

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "investigator_inventory_history_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_corbitt_magic_point_tracking(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    events_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-module" / "logs" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text().splitlines()
        if line.strip()
    ]
    write_jsonl(events_path, [event for event in events if event.get("type") != "resource_change"])

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "haunting_corbitt_magic_points_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_flesh_ward_magic_point_tracking(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    events_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-module" / "logs" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text().splitlines()
        if line.strip()
    ]
    write_jsonl(events_path, [
        event for event in events
        if event.get("payload", {}).get("reason") != "flesh_ward"
    ])

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "haunting_corbitt_magic_points_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_own_dagger_flesh_ward_exception(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    events_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-module" / "logs" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text().splitlines()
        if line.strip()
    ]
    for event in events:
        payload = event.get("payload", {})
        if payload.get("rulebook_exception") == "own_dagger_ignores_spells":
            payload.pop("rulebook_exception")
            payload.pop("flesh_ward_bypassed", None)
            payload.pop("armor_before", None)
    write_jsonl(events_path, events)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "haunting_corbitt_own_dagger_exception_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_conclusion_sanity_reward_roll(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    rolls_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-module" / "logs" / "rolls.jsonl"
    rolls = [
        json.loads(line)
        for line in rolls_path.read_text().splitlines()
        if line.strip()
    ]
    write_jsonl(rolls_path, [
        roll
        for roll in rolls
        if roll.get("payload", {}).get("reward_kind") != "sanity"
    ])

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "haunting_conclusion_reward_roll_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_conclusion_sanity_reward_die_faces(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    rolls_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-module" / "logs" / "rolls.jsonl"
    rolls = [
        json.loads(line)
        for line in rolls_path.read_text().splitlines()
        if line.strip()
    ]
    for roll in rolls:
        payload = roll.get("payload", {})
        if payload.get("reward_kind") == "sanity":
            payload.pop("die_rolls", None)
    write_jsonl(rolls_path, rolls)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "haunting_conclusion_reward_roll_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_sanity_before_after_tracking(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    rolls_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-module" / "logs" / "rolls.jsonl"
    rolls = [
        json.loads(line)
        for line in rolls_path.read_text().splitlines()
        if line.strip()
    ]
    for roll in rolls:
        payload = roll.get("payload", {})
        if payload.get("skill") == "SAN":
            payload.pop("san_before", None)
            payload.pop("san_delta", None)
            payload.pop("san_after", None)
    write_jsonl(rolls_path, rolls)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "sanity_resource_delta_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_hp_damage_rolls(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    rolls_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-module" / "logs" / "rolls.jsonl"
    rolls = [
        json.loads(line)
        for line in rolls_path.read_text().splitlines()
        if line.strip()
    ]
    write_jsonl(rolls_path, [
        roll
        for roll in rolls
        if roll.get("payload", {}).get("damage_kind") != "hit_points"
    ])

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "haunting_damage_roll_missing" in finding_codes(audit)


def test_haunting_module_audit_rejects_non_percentile_rolls_rendered_as_targets(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_text = report_path.read_text()
    report_text = report_text.replace(
        "HP 伤害：艾达·金掷出 1D6+2 = 5（骰面 3 + 2），结果造成伤害。",
        "HP 伤害：艾达·金掷出 5 / 8，结果造成伤害。",
    )
    report_text = report_text.replace(
        "HP 伤害：艾达·金掷出 1D4+2 = 4（骰面 2 + 2），结果造成伤害。",
        "HP 伤害：艾达·金掷出 4 / 6，结果造成伤害。",
    )
    report_text = report_text.replace(
        "SAN 奖励：艾达·金掷出 1D6 = 4（骰面 4），结果奖励。",
        "SAN 奖励：艾达·金掷出 4 / 6，结果奖励。",
    )
    report_path.write_text(report_text)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "non_percentile_roll_rendering_invalid" in finding_codes(audit)


def test_haunting_module_audit_requires_investigator_creation_record(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    creation_path = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king-haunting" / "creation.json"
    creation_path.unlink()

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "investigator_creation_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_investigator_finance_details(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    creation_path = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king-haunting" / "creation.json"
    creation = json.loads(creation_path.read_text())
    creation["finances"] = {
        "credit_rating": 40,
        "living_standard": "Average",
    }
    creation_path.write_text(json.dumps(creation))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "investigator_creation_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_investigator_finances_to_match_rulebook_table(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    creation_path = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king-haunting" / "creation.json"
    creation = json.loads(creation_path.read_text())
    creation["finances"]["cash"]["amount"] = 999
    creation_path.write_text(json.dumps(creation))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "investigator_creation_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_investigator_age_step(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    creation_path = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king-haunting" / "creation.json"
    creation = json.loads(creation_path.read_text())
    creation.pop("age", None)
    creation["rulebook_steps"] = [
        step for step in creation["rulebook_steps"]
        if step not in {"choose_age", "apply_age_adjustments"}
    ]
    creation_path.write_text(json.dumps(creation))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "investigator_age_step_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_derived_mov_to_match_rulebook_formula(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king-haunting"
    character_path = investigator_dir / "character.json"
    character = json.loads(character_path.read_text())
    character["derived"]["MOV"] = 8
    character_path.write_text(json.dumps(character))
    creation_path = investigator_dir / "creation.json"
    creation = json.loads(creation_path.read_text())
    creation["derived"]["MOV"]["value"] = 8
    creation["derived"]["MOV"]["formula"] = "STR or DEX equals/exceeds SIZ rule"
    creation_path.write_text(json.dumps(creation))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "derived_movement_rate_mismatch" in finding_codes(audit)


def test_haunting_module_audit_requires_characteristic_half_fifth_values(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king-haunting"
    creation_path = investigator_dir / "creation.json"
    creation = json.loads(creation_path.read_text())
    for value in creation["characteristics"].values():
        value.pop("half", None)
        value.pop("fifth", None)
    creation_path.write_text(json.dumps(creation))
    character_path = investigator_dir / "character.json"
    character = json.loads(character_path.read_text())
    character.pop("characteristic_thresholds", None)
    character_path.write_text(json.dumps(character))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "characteristic_half_fifth_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_skill_half_fifth_values(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king-haunting"
    creation_path = investigator_dir / "creation.json"
    creation = json.loads(creation_path.read_text())
    for value in creation["skill_allocation"]["skills"].values():
        value.pop("half", None)
        value.pop("fifth", None)
    creation_path.write_text(json.dumps(creation))
    character_path = investigator_dir / "character.json"
    character = json.loads(character_path.read_text())
    character.pop("skill_thresholds", None)
    character_path.write_text(json.dumps(character))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "skill_half_fifth_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_investigator_skill_allocation(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    creation_path = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king-haunting" / "creation.json"
    creation = json.loads(creation_path.read_text())
    creation.pop("skill_allocation", None)
    creation_path.write_text(json.dumps(creation))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "investigator_skill_allocation_missing" in finding_codes(audit)


def test_haunting_module_audit_rejects_skill_allocation_character_mismatch(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    character_path = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king-haunting" / "character.json"
    character = json.loads(character_path.read_text())
    character["skills"]["Dodge"] = 35
    character_path.write_text(json.dumps(character))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "investigator_skill_allocation_mismatch" in finding_codes(audit)


def test_haunting_module_audit_requires_view_separation_streams(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    (run_dir / "player-view.jsonl").unlink()

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "view_separation_missing" in finding_codes(audit)


def test_haunting_module_audit_rejects_secret_id_in_player_view(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    with (run_dir / "player-view.jsonl").open("a") as handle:
        handle.write(json.dumps({
            "view": "player",
            "type": "transcript_turn",
            "text": "secret-corbitt-body",
        }) + "\n")

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "player_view_secret_leak" in finding_codes(audit)


def test_chase_drill_audit_requires_multi_profile_pressure(tmp_path):
    run_dir = coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="chase-drill")
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata.pop("player_profiles_tested", None)
    metadata.pop("player_profile_labels", None)
    metadata_path.write_text(json.dumps(metadata))

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "chase_player_profile_pressure_missing" in finding_codes(audit)


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


def test_haunting_module_audit_requires_summary_bout_duration_hours(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    campaign_id = json.loads((run_dir / "playtest.json").read_text())["campaign_id"]
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / campaign_id
    events_path = campaign_dir / "logs" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text().splitlines()
        if line.strip()
    ]
    for event in events:
        if event.get("type") == "bout_of_madness":
            event["payload"].pop("duration_die", None)
            event["payload"].pop("duration_roll", None)
            event["payload"].pop("duration_hours", None)
            break
    write_jsonl(events_path, events)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "temporary_insanity_bout_duration_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_temporary_insanity_final_state(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    campaign_id = json.loads((run_dir / "playtest.json").read_text())["campaign_id"]
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / campaign_id
    events_path = campaign_dir / "logs" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text().splitlines()
        if line.strip()
    ]
    for event in events:
        if event.get("type") == "status" and isinstance(event.get("payload"), dict):
            event["payload"]["unresolved_conditions"] = []
            event["payload"].pop("temporary_insanity_resolved", None)
    write_jsonl(events_path, events)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "temporary_insanity_final_state_missing" in finding_codes(audit)


def test_haunting_module_audit_requires_temporary_insanity_final_state_visible_to_player(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")

    for relative_path in ["transcript.jsonl", "player-view.jsonl", "keeper-view.jsonl"]:
        log_path = run_dir / relative_path
        rows = [
            json.loads(line)
            for line in log_path.read_text().splitlines()
            if line.strip()
        ]
        for row in rows:
            if row.get("role") == "keeper_under_test" and row.get("turn") == 50:
                for key in ["text", "text_display"]:
                    if isinstance(row.get(key), str):
                        row[key] = row[key].replace(
                            "临时疯狂底层状态仍持续，若在 1 小时内再次损失 SAN，会再次触发疯狂发作。",
                            "",
                        )
        write_jsonl(log_path, rows)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "temporary_insanity_final_state_not_player_visible" in finding_codes(audit)


def test_haunting_module_audit_requires_bout_round_sequence(tmp_path):
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
            "summary": "Bout of Madness：Ada loses control for 4 rounds.",
            "duration_die": "1D10",
            "duration_roll": 4,
            "duration_rounds": 4,
            "rounds": [{"round": 1, "control": "keeper"}],
        },
    })
    write_jsonl(campaign_dir / "logs" / "events.jsonl", events)
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        report_path.read_text()
        + "\n## Sanity Summary\n- Bout of Madness：Ada loses control for 4 rounds.\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "temporary_insanity_bout_rounds_missing" in finding_codes(audit)


def test_haunting_module_audit_rejects_realtime_bout_for_solo_corbitt_insanity(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    campaign_id = json.loads((run_dir / "playtest.json").read_text())["campaign_id"]
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / campaign_id
    events_path = campaign_dir / "logs" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text().splitlines()
        if line.strip()
    ]
    for event in events:
        if event.get("type") == "bout_of_madness":
            event["payload"]["mode"] = "real_time"
            event["payload"]["rulebook_ref"] = "Table VII: Bouts of Madness-Real Time"
            break
    write_jsonl(events_path, events)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "temporary_insanity_bout_mode_mismatch" in finding_codes(audit)


def test_haunting_module_audit_requires_involuntary_action_on_failed_san_roll(tmp_path):
    """Keeper Rulebook p.166: failing a SAN roll always causes loss of self-control.

    A failed SAN roll must carry an ``involuntary_action`` block. Removing it
    from any failed SAN roll surfaces ``sanity_failure_involuntary_action_missing``.
    """
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    rolls_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-module" / "logs" / "rolls.jsonl"
    rolls = [json.loads(line) for line in rolls_path.read_text().splitlines() if line.strip()]
    removed = False
    for roll in rolls:
        payload = roll.get("payload", {})
        if roll.get("type") == "sanity" and payload.get("outcome") == "failure":
            payload.pop("involuntary_action", None)
            removed = True
            break
    assert removed, "expected at least one failed SAN roll in the haunting module run"
    write_jsonl(rolls_path, rolls)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "sanity_failure_involuntary_action_missing" in finding_codes(audit)


def test_haunting_module_audit_rejects_unknown_involuntary_action_kind(tmp_path):
    """The involuntary_action.kind must be one of the five rulebook kinds."""
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    rolls_path = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-module" / "logs" / "rolls.jsonl"
    rolls = [json.loads(line) for line in rolls_path.read_text().splitlines() if line.strip()]
    for roll in rolls:
        payload = roll.get("payload", {})
        if roll.get("type") == "sanity" and payload.get("outcome") == "failure":
            payload["involuntary_action"] = {"kind": "scream_and_flee", "summary": "not a rulebook kind"}
            break
    write_jsonl(rolls_path, rolls)

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    assert "sanity_failure_involuntary_action_missing" in finding_codes(audit)


def test_haunting_module_audit_accepts_failed_san_roll_with_involuntary_action(tmp_path):
    """Regression guard: a well-formed haunting module run does not surface the finding."""
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    audit = coc_playtest_audit.audit_run(run_dir)
    assert "sanity_failure_involuntary_action_missing" not in finding_codes(audit)
