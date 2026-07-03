import importlib.util
import hashlib
import json
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_completion_audit = load_module("coc_completion_audit", "plugins/coc-keeper/scripts/coc_completion_audit.py")
coc_playtest_suite = load_module("coc_playtest_suite", "plugins/coc-keeper/scripts/coc_playtest_suite.py")


def write_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_text(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")


def request_payload(run_id: str) -> dict:
    return {
        "schema_version": 1,
        "kind": "coc_semantic_coverage_request",
        "run_id": run_id,
        "coverage_keys": [
            {"key": key, "label": key}
            for key in coc_playtest_suite.CORE_COVERAGE
        ],
        "quality_dimensions": [
            {"key": key, "label": key}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        ],
        "inputs": {"battle_report": "fixture evidence"},
        "expected_output_schema": {
            "required": [
                "schema_version",
                "run_id",
                "evaluator_id",
                "evaluation_provenance",
                "coverage",
                "quality",
                "root_cause_classification",
                "next_loop_fix_target",
            ]
        },
    }


def request_hash(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def semantic_result(run_id: str, *, virtual_pressure: bool = False) -> dict:
    request = request_payload(run_id)
    quality = {
        key: {
            "score": 5 if key == "virtual_player_pressure" and virtual_pressure else 4,
            "passed": virtual_pressure if key == "virtual_player_pressure" else True,
            "reason": f"{key} checked by semantic fixture.",
        }
        for key in coc_playtest_suite.QUALITY_DIMENSIONS
    }
    return {
        "schema_version": 1,
        "run_id": run_id,
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": request_hash(request),
            "evaluator_note": "Fixture stands in for a completed Codex semantic review.",
        },
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by semantic fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": quality,
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }


def evaluation_report_fixture() -> str:
    return "\n\n".join([
        "# Evaluation Report",
        "## Overall Result\nPASS",
        "## Scorecard\n- rulebook_procedure: 4",
        "## Passed Test Cases\n- fixture pass",
        "## Failed Test Cases\n- none",
        "## Rule Accuracy Findings\n- none",
        "## State Integrity Findings\n- [low] state_integrity: Fixture state agrees with the report. Evidence: artifacts artifacts/battle-report.md",
        "## Spoiler Safety Findings\n- none",
        "## Immersion Findings\n- none",
        "## Meta-Game Findings\n- none",
        "## Reproducible Bugs\n- none",
        "## Recommended Fixes\n- none",
        "## Regression Tests To Add\n- none",
    ]) + "\n"


def battle_report_mechanical_fixture_text() -> str:
    run_ids = ["v2-haunting-module", "v3-chase-drill", "v4-multi-profile-pressure"]
    lines: list[str] = []
    for run_id in run_ids:
        investigator_id = f"{run_id}-investigator"
        lines.append(f"- Spot Hidden: {investigator_id} rolled 33 vs 55 -> regular_success")
        lines.append(f"- Spot Hidden: {investigator_id} rolled 22 vs 55 -> hard_success")
    return "\n".join(lines)


def battle_report_event_fixture_text() -> str:
    event_summaries = [
        "fixture scene",
        "fixture combat",
        "fixture sanity",
        "fixture status",
        "fixture ending",
        "fixture chase",
        "fixture decision",
    ]
    return "\n".join(f"- {summary}" for summary in event_summaries)


def battle_report_feedback_fixture_text() -> str:
    feedback_texts = [
        "fixture feedback",
        "fixture careful feedback",
        "fixture reckless feedback",
        "fixture skeptical feedback",
    ]
    return "\n".join(f"- {text}" for text in feedback_texts)


def battle_report_memory_fixture_text() -> str:
    return "- fixture memory"


def battle_report_investigator_chronicle_fixture_text() -> str:
    return "\n".join([
        "- fixture history",
        "- fixture development",
        "- fixture inventory",
    ])


def battle_report_investigator_creation_fixture_text() -> str:
    return "\n".join([
        "- Fixture creation record.",
        "- Characteristics: STR 60, DEX 50",
        "- Occupation: Antiquarian",
        "- Occupation Skill Points: EDU x 4 = 300",
        "- Personal Interest Skill Points: INT x 2 = 140",
        "- Credit Rating: 40 (Rulebook Occupation Range 30-70)",
        "- Skill Allocation: Occupation 300/300; Personal Interest 140/140; Unallocated 0/0",
        "  - Spot Hidden: base 25 + Occupation 30 + Personal Interest 0 = 55",
        "- Equipment: fixture magnifier; fixture notebook",
    ])


def battle_report_chase_tracker_fixture_text() -> str:
    return "\n".join([
        "- Chase ID: fixture-chase",
        "- Status: resolved",
        "- Round: 2",
        "- DEX order: fixture-pursuer -> v3-chase-drill-investigator",
        "- Participants:",
        "  - Ada King (v3-chase-drill-investigator) | quarry | MOV 8 -> 8 | DEX 50 | movement_actions 1 | position fixture-finish",
        "  - Nathaniel Crowe (fixture-pursuer) | pursuer | MOV 8 -> 9 | DEX 60 | movement_actions 2 | position fixture-barrier",
        "- Location Chain:",
        "  - fixture-start [start]",
        "  - fixture-hazard [hazard, regular, Dodge]",
        "  - fixture-barrier [barrier, regular, Locksmith]",
        "  - fixture-finish [escape]",
        "- Rounds:",
        "  - Round 1: fixture chase round one",
        "  - Round 2: fixture chase round two",
        "- Outcome: quarry escapes",
    ])


def battle_report_character_dossier_fixture_text() -> str:
    return "\n".join([
        "- Ada King (v2-haunting-module-investigator)",
        "- Ada King (v3-chase-drill-investigator)",
        "- Ada King (v4-multi-profile-pressure-investigator)",
        "  - Occupation: Antiquarian",
        "  - Era: 1920s",
        "  - Characteristics: STR: 60, DEX: 50",
        "  - Derived: HP: 12, MOV: 8",
        "  - Skills: Spot Hidden: 55, Library Use: 60",
        "  - Backstory:",
        "    - Description: fixture backstory",
        "    - Traits: careful notes; checks exits",
    ])


def battle_report_fixture() -> str:
    return "\n\n".join([
        "# Battle Report <!-- report-anchor: Battle Report -->",
        "## Run Setup <!-- report-anchor: Run Setup -->\n- Run ID: fixture",
        "## Module <!-- report-anchor: Module -->\n- Scenario: fixture",
        "## Investigator Creation <!-- report-anchor: Investigator Creation -->\n"
        + battle_report_investigator_creation_fixture_text(),
        "## Character Dossier <!-- report-anchor: Character Dossier -->\n"
        + battle_report_character_dossier_fixture_text(),
        "## Investigator Chronicle <!-- report-anchor: Investigator Chronicle -->\n"
        + battle_report_investigator_chronicle_fixture_text(),
        "## Scene-by-Scene Replay <!-- report-anchor: Scene-by-Scene Replay -->\n"
        + battle_report_event_fixture_text(),
        "## Actual Play Replay <!-- report-anchor: Actual Play Replay -->\n"
        "- fixture keeper turn\n"
        "- fixture player turn\n"
        "- fixture reframed pushed action\n"
        "- fixture keeper foreshadows pushed risk\n"
        "- fixture confirms pushed risk\n"
        "- fixture careful profile turn\n"
        "- fixture reckless profile turn\n"
        "- fixture skeptical rules profile turn\n"
        "- fixture meta player question\n"
        "- fixture meta keeper answer",
        "## Session Transcript <!-- report-anchor: Session Transcript -->\n"
        "- fixture keeper turn\n"
        "- fixture player turn\n"
        "- fixture reframed pushed action\n"
        "- fixture keeper foreshadows pushed risk\n"
        "- fixture confirms pushed risk\n"
        "- fixture careful profile turn\n"
        "- fixture reckless profile turn\n"
        "- fixture skeptical rules profile turn\n"
        "- fixture meta player question\n"
        "- fixture meta keeper answer",
        "## Mechanical Log <!-- report-anchor: Mechanical Log -->\n"
        + battle_report_mechanical_fixture_text(),
        "## Chase Tracker <!-- report-anchor: Chase Tracker -->\n"
        + battle_report_chase_tracker_fixture_text(),
        "## Story Recap <!-- report-anchor: Story Recap -->\n"
        + battle_report_memory_fixture_text(),
        "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n"
        + battle_report_feedback_fixture_text(),
    ]) + "\n"


def battle_report_shell_with_required_anchors() -> str:
    return "\n\n".join([
        "# Battle Report <!-- report-anchor: Battle Report -->",
        "## Run Setup <!-- report-anchor: Run Setup -->\n- Run ID: fixture",
        "## Module <!-- report-anchor: Module -->\n- Scenario: fixture",
        "## Investigator Creation <!-- report-anchor: Investigator Creation -->\n- Fixture creation record.",
        "## Character Dossier <!-- report-anchor: Character Dossier -->\n- Fixture character dossier.",
        "## Investigator Chronicle <!-- report-anchor: Investigator Chronicle -->\n- Fixture chronicle.",
        "## Scene-by-Scene Replay <!-- report-anchor: Scene-by-Scene Replay -->\n- Fixture scene.",
        "## Actual Play Replay <!-- report-anchor: Actual Play Replay -->\n- Fixture table turn.",
        "## Session Transcript <!-- report-anchor: Session Transcript -->\n- Fixture transcript.",
        "## Mechanical Log <!-- report-anchor: Mechanical Log -->\n- Fixture roll.",
        "## Chase Tracker <!-- report-anchor: Chase Tracker -->\n- Fixture chase tracker.",
        "## Story Recap <!-- report-anchor: Story Recap -->\n- Fixture recap.",
        "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n- Fixture feedback.",
    ]) + "\n"


def battle_report_with_dialogue_but_without_roll_log() -> str:
    return battle_report_fixture().replace(
        "## Mechanical Log <!-- report-anchor: Mechanical Log -->\n"
        + battle_report_mechanical_fixture_text(),
        "## Mechanical Log <!-- report-anchor: Mechanical Log -->\n- Fixture roll.",
    )


def battle_report_with_roll_results_only_outside_mechanical_log() -> str:
    return (
        battle_report_fixture()
        .replace(
            "## Mechanical Log <!-- report-anchor: Mechanical Log -->\n"
            + battle_report_mechanical_fixture_text(),
            "## Mechanical Log <!-- report-anchor: Mechanical Log -->\n- Fixture roll.",
        )
        .replace(
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text(),
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text()
            + "\n"
            + battle_report_mechanical_fixture_text(),
        )
    )


def battle_report_with_source_dialogue_only_outside_replay_sections() -> str:
    misplaced_dialogue = "\n".join([
        "- fixture keeper turn",
        "- fixture player turn",
        "- fixture reframed pushed action",
        "- fixture keeper foreshadows pushed risk",
        "- fixture confirms pushed risk",
        "- fixture meta player question",
        "- fixture meta keeper answer",
    ])
    return (
        battle_report_fixture()
        .replace(
            "## Actual Play Replay <!-- report-anchor: Actual Play Replay -->\n"
            "- fixture keeper turn\n"
            "- fixture player turn\n"
            "- fixture reframed pushed action\n"
            "- fixture keeper foreshadows pushed risk\n"
            "- fixture confirms pushed risk\n"
            "- fixture careful profile turn\n"
            "- fixture reckless profile turn\n"
            "- fixture skeptical rules profile turn\n"
            "- fixture meta player question\n"
            "- fixture meta keeper answer",
            "## Actual Play Replay <!-- report-anchor: Actual Play Replay -->\n- Fixture table turn.",
        )
        .replace(
            "## Session Transcript <!-- report-anchor: Session Transcript -->\n"
            "- fixture keeper turn\n"
            "- fixture player turn\n"
            "- fixture reframed pushed action\n"
            "- fixture keeper foreshadows pushed risk\n"
            "- fixture confirms pushed risk\n"
            "- fixture careful profile turn\n"
            "- fixture reckless profile turn\n"
            "- fixture skeptical rules profile turn\n"
            "- fixture meta player question\n"
            "- fixture meta keeper answer",
            "## Session Transcript <!-- report-anchor: Session Transcript -->\n- Fixture transcript.",
        )
        .replace(
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text(),
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text()
            + "\n"
            + misplaced_dialogue,
        )
    )


def battle_report_with_dialogue_and_rolls_but_without_events() -> str:
    return battle_report_fixture().replace(
        "## Scene-by-Scene Replay <!-- report-anchor: Scene-by-Scene Replay -->\n"
        + battle_report_event_fixture_text(),
        "## Scene-by-Scene Replay <!-- report-anchor: Scene-by-Scene Replay -->\n- Fixture scene.",
    )


def battle_report_with_sources_but_without_feedback_text() -> str:
    return battle_report_fixture().replace(
        "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n"
        + battle_report_feedback_fixture_text(),
        "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n- Fixture feedback summary.",
    )


def battle_report_with_sources_but_without_memory_summary() -> str:
    return battle_report_fixture().replace(
        "## Story Recap <!-- report-anchor: Story Recap -->\n"
        + battle_report_memory_fixture_text(),
        "## Story Recap <!-- report-anchor: Story Recap -->\n- Fixture recap.",
    )


def battle_report_with_sources_but_without_investigator_chronicle_records() -> str:
    return battle_report_fixture().replace(
        "## Investigator Chronicle <!-- report-anchor: Investigator Chronicle -->\n"
        + battle_report_investigator_chronicle_fixture_text(),
        "## Investigator Chronicle <!-- report-anchor: Investigator Chronicle -->\n- Fixture chronicle.",
    )


def battle_report_with_sources_but_without_investigator_creation_records() -> str:
    return battle_report_fixture().replace(
        "## Investigator Creation <!-- report-anchor: Investigator Creation -->\n"
        + battle_report_investigator_creation_fixture_text(),
        "## Investigator Creation <!-- report-anchor: Investigator Creation -->\n- Fixture creation record.",
    )


def battle_report_with_sources_but_without_chase_tracker_state() -> str:
    return battle_report_fixture().replace(
        "## Chase Tracker <!-- report-anchor: Chase Tracker -->\n"
        + battle_report_chase_tracker_fixture_text(),
        "## Chase Tracker <!-- report-anchor: Chase Tracker -->\n- Fixture chase tracker.",
    )


def battle_report_with_sources_but_without_character_dossier_records() -> str:
    return battle_report_fixture().replace(
        "## Character Dossier <!-- report-anchor: Character Dossier -->\n"
        + battle_report_character_dossier_fixture_text(),
        "## Character Dossier <!-- report-anchor: Character Dossier -->\n- Fixture character dossier.",
    )


def suite_report_fixture() -> str:
    return "\n\n".join([
        "# COC Playtest Suite Report",
        "## Run Index\n- fixture run",
        "## Non-Passing Runs\n- none",
        "## Core Coverage Matrix\n- character_dossier: covered",
        "## Coverage Evidence\n- fixture coverage evidence",
        "## Quality Matrix\n- report_completeness: passed",
        "## Quality Evidence\n- fixture quality evidence",
        "## Loop Decision\n- Status: ready_for_completion_audit",
        "## Repair Targets\n- none",
        "## Remaining Gaps\n- No gaps detected.",
        "## Remaining Quality Gaps\n- No quality gaps detected.",
    ]) + "\n"


def rulebook_audit_fixture() -> str:
    return "\n\n".join([
        "# Rulebook Alignment Audit",
        "## Overall Result\nPASS",
        "## Positive Rulebook Evidence\n- Fixture evidence.",
        "## Root Cause Classification\n- No findings.",
        "## Blueprint Cross-Check\n- Current run satisfies the implemented rulebook-audit contract.",
        "## Next Loop Fix Target\n- No fix target.",
    ]) + "\n"


def write_run(root: Path, run_id: str, audit_profile: str, *, virtual_pressure: bool = False):
    run_dir = root / ".coc" / "playtests" / run_id
    investigator_id = f"{run_id}-investigator"
    write_json(run_dir / "playtest.json", {
        "run_id": run_id,
        "campaign_id": run_id,
        "campaign_title": run_id,
        "scenario": "Fixture Scenario",
        "audit_profile": audit_profile,
        "player_profile": "fixture",
        "play_language": "zh-Hans",
        "language_profile": {
            "language": "zh-Hans",
            "display_name": "Simplified Chinese",
            "term_policy": "Use localized_terms.zh-Hans for people, places, factions, handouts, scenario titles, and special terms.",
        },
        "localized_terms": {"zh-Hans": {"Ada King": "艾达·金"}},
    })
    pushed_roll_id = f"{run_id}-pushed-roll"
    transcript_rows = [
        {"turn": 1, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "open_scene", "text": "fixture keeper turn"},
        {"turn": 2, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "investigate", "text": "fixture player turn"},
        {"turn": 3, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "text": "fixture reframed pushed action", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "player_reframes_action"}},
        {"turn": 4, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "fixture keeper foreshadows pushed risk", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "keeper_foreshadows_failure", "failure_consequence_source": "keeper"}},
        {"turn": 5, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "text": "fixture confirms pushed risk", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "player_confirms_risk", "risk_confirmed": True}},
        {"turn": 6, "role": "system", "speaker": "System", "mode": "roll", "text": "fixture pushed roll resolved", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "roll_resolved"}},
    ]
    if audit_profile == "multi_profile_pressure":
        transcript_rows.extend([
            {"turn": 7, "role": "player_simulator", "speaker": "Careful Player", "mode": "play", "player_profile": "careful_investigator", "text": "fixture careful profile turn"},
            {"turn": 8, "role": "player_simulator", "speaker": "Reckless Player", "mode": "play", "player_profile": "reckless_investigator", "text": "fixture reckless profile turn"},
            {"turn": 9, "role": "player_simulator", "speaker": "Rules Player", "mode": "meta", "player_profile": "skeptical_rules_lawyer", "text": "fixture skeptical rules profile turn"},
        ])
    transcript_rows.extend([
        {"turn": 10, "role": "player_simulator", "speaker": "Rules Player", "mode": "meta", "text": "fixture meta player question"},
        {"turn": 11, "role": "keeper_under_test", "speaker": "KP", "mode": "meta", "text": "fixture meta keeper answer"},
    ])
    write_jsonl(run_dir / "transcript.jsonl", transcript_rows)
    write_jsonl(run_dir / "player-view.jsonl", [
        {"view": "player", "type": "public_character_state", "campaign_id": run_id},
        {"view": "player", "type": "transcript_turn", "turn": 2, "role": "player_simulator", "text": "fixture player turn"},
    ])
    write_jsonl(run_dir / "keeper-view.jsonl", [
        {"view": "keeper", "type": "keeper_context", "campaign_id": run_id, "keeper_secret_ids": []},
        {"view": "keeper", "type": "transcript_turn", "turn": 1, "role": "keeper_under_test", "text": "fixture keeper turn"},
    ])
    feedback_rows = [
        {"category": "kp_clarity", "score": 5, "text": "fixture feedback"},
    ]
    if audit_profile == "multi_profile_pressure":
        feedback_rows.extend([
            {"player_profile": "careful_investigator", "category": "kp_clarity", "score": 5, "text": "fixture careful feedback"},
            {"player_profile": "reckless_investigator", "category": "agency", "score": 4, "text": "fixture reckless feedback"},
            {"player_profile": "skeptical_rules_lawyer", "category": "meta_quality", "score": 5, "text": "fixture skeptical feedback"},
        ])
    write_jsonl(run_dir / "player-feedback.jsonl", feedback_rows)
    write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {
            "severity": "low",
            "category": "state_integrity",
            "text": "Fixture state agrees with the report.",
            "evidence": {"artifact_paths": ["artifacts/battle-report.md"]},
        }
    ])
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / run_id
    write_json(campaign_dir / "campaign.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "title": run_id,
        "status": "playtest",
    })
    write_json(campaign_dir / "party.json", {
        "campaign_id": run_id,
        "investigator_ids": [investigator_id],
        "active_investigator_ids": [investigator_id],
    })
    write_json(campaign_dir / "scenario" / "scenario.json", {
        "schema_version": 1,
        "scenario_id": "fixture-scenario",
        "title": "Fixture Scenario",
    })
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "target": 55, "roll": 33, "outcome": "regular_success"}},
        {
            "type": "roll",
            "actor": investigator_id,
            "payload": {
                "skill": "Spot Hidden",
                "target": 55,
                "roll": 22,
                "outcome": "hard_success",
                "pushed": True,
                "pushed_roll_protocol": {
                    "roll_id": pushed_roll_id,
                    "failure_consequence_source": "keeper",
                    "keeper_foreshadowed_failure": True,
                    "player_confirmation_recorded": True,
                },
            },
        },
    ])
    event_rows = [
        {"type": "scene", "actor": "keeper_under_test", "payload": {"summary": "fixture scene"}},
    ]
    if audit_profile == "haunting_module":
        event_rows.extend([
            {"type": "combat", "actor": investigator_id, "payload": {"summary": "fixture combat"}},
            {"type": "sanity", "actor": investigator_id, "payload": {"summary": "fixture sanity"}},
            {"type": "status", "actor": investigator_id, "payload": {"summary": "fixture status"}},
            {"type": "session_ending", "actor": "keeper_under_test", "payload": {"summary": "fixture ending"}},
        ])
    elif audit_profile == "chase_drill":
        event_rows.extend([
            {"type": "chase", "actor": investigator_id, "payload": {"summary": "fixture chase"}},
            {"type": "status", "actor": investigator_id, "payload": {"summary": "fixture status"}},
            {"type": "session_ending", "actor": "keeper_under_test", "payload": {"summary": "fixture ending"}},
        ])
    elif audit_profile == "multi_profile_pressure":
        event_rows.extend([
            {"type": "decision", "actor": "player_simulator", "payload": {"summary": "fixture decision"}},
            {"type": "status", "actor": investigator_id, "payload": {"summary": "fixture status"}},
            {"type": "session_ending", "actor": "keeper_under_test", "payload": {"summary": "fixture ending"}},
        ])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", event_rows)
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [
        {"session_id": "fixture-session", "summary": "fixture memory"},
    ])
    if audit_profile == "chase_drill":
        write_json(campaign_dir / "save" / "chase.json", {
            "schema_version": 1,
            "chase_id": "fixture-chase",
            "status": "resolved",
            "round": 2,
            "participants": [
                {
                    "id": investigator_id,
                    "name": "Ada King",
                    "role": "quarry",
                    "base_mov": 8,
                    "adjusted_mov": 8,
                    "dex": 50,
                    "movement_actions": 1,
                    "position": "fixture-finish",
                },
                {
                    "id": "fixture-pursuer",
                    "name": "Nathaniel Crowe",
                    "role": "pursuer",
                    "base_mov": 8,
                    "adjusted_mov": 9,
                    "dex": 60,
                    "movement_actions": 2,
                    "position": "fixture-barrier",
                },
            ],
            "dex_order": ["fixture-pursuer", investigator_id],
            "location_chain": [
                {"id": "fixture-start", "label": "start"},
                {"id": "fixture-hazard", "label": "hazard", "difficulty": "regular", "skill": "Dodge"},
                {"id": "fixture-barrier", "label": "barrier", "difficulty": "regular", "skill": "Locksmith"},
                {"id": "fixture-finish", "label": "escape"},
            ],
            "rounds": [
                {"round": 1, "summary": "fixture chase round one"},
                {"round": 2, "summary": "fixture chase round two"},
            ],
            "outcome": "quarry escapes",
        })
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id
    write_json(investigator_dir / "creation.json", {
        "schema_version": 1,
        "investigator_id": investigator_id,
        "characteristics": {
            "STR": {"final": 60},
            "DEX": {"final": 50},
        },
        "occupation": {
            "name": "Antiquarian",
            "skill_point_formula": "EDU x 4",
            "skill_points_available": 300,
            "credit_rating_range": "30-70",
        },
        "personal_interest": {
            "skill_point_formula": "INT x 2",
            "skill_points_available": 140,
        },
        "finances": {"credit_rating": 40},
        "skill_allocation": {
            "occupation_points_spent": 300,
            "personal_interest_points_spent": 140,
            "unallocated_occupation_points": 0,
            "unallocated_personal_interest_points": 0,
            "skills": {
                "Spot Hidden": {
                    "base": 25,
                    "occupation_points": 30,
                    "personal_interest_points": 0,
                    "final": 55,
                },
            },
        },
        "equipment": ["fixture magnifier", "fixture notebook"],
    })
    write_json(investigator_dir / "character.json", {
        "schema_version": 1,
        "investigator_id": investigator_id,
        "id": investigator_id,
        "name": "Ada King",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60,
            "DEX": 50,
        },
        "derived": {
            "HP": 12,
            "MOV": 8,
        },
        "skills": {
            "Spot Hidden": 55,
            "Library Use": 60,
        },
        "backstory": {
            "description": "fixture backstory",
            "traits": ["careful notes", "checks exits"],
        },
    })
    write_jsonl(investigator_dir / "history.jsonl", [
        {"campaign_id": run_id, "summary": "fixture history"},
    ])
    write_jsonl(investigator_dir / "development.jsonl", [
        {"campaign_id": run_id, "summary": "fixture development"},
    ])
    write_jsonl(investigator_dir / "inventory-history.jsonl", [
        {"campaign_id": run_id, "summary": "fixture inventory"},
    ])
    write_text(run_dir / "artifacts" / "battle-report.md", battle_report_fixture())
    write_text(run_dir / "artifacts" / "evaluation-report.md", evaluation_report_fixture())
    write_text(run_dir / "artifacts" / "rulebook-audit.md", rulebook_audit_fixture())
    write_json(run_dir / "artifacts" / "semantic-eval-request.json", request_payload(run_id))
    write_json(run_dir / "artifacts" / "semantic-eval-result.json", semantic_result(run_id, virtual_pressure=virtual_pressure))


def write_index(root: Path, runs: list[dict], *, quality_gap: str | None = None):
    playtests_dir = root / ".coc" / "playtests"
    coverage = {
        key: {
            "label": key,
            "status": "covered",
            "runs": [run["run_id"] for run in runs],
            "reasons": {run["run_id"]: f"{key} covered." for run in runs},
        }
        for key in coc_playtest_suite.CORE_COVERAGE
    }
    quality = {
        key: {
            "label": key,
            "status": "needs_fix" if key == quality_gap else "passed",
            "runs": [run["run_id"] for run in runs if key != quality_gap],
            "scores": {run["run_id"]: 4 for run in runs if key != quality_gap},
            "reasons": {run["run_id"]: f"{key} passed." for run in runs if key != quality_gap},
        }
        for key in coc_playtest_suite.QUALITY_DIMENSIONS
    }
    loop_decision = {
        "schema_version": 1,
        "status": "needs_repair" if quality_gap else "ready_for_completion_audit",
        "evaluated_runs": [run["run_id"] for run in runs],
        "ignored_historical_runs": [],
        "blockers": [] if quality_gap is None else [{
            "type": "quality_gap",
            "key": quality_gap,
            "root_cause_classification": ["test_gap"],
            "next_loop_fix_target": f"Fix {quality_gap}.",
        }],
        "next_action": "Run the full completion audit." if quality_gap is None else f"Fix {quality_gap}.",
    }
    write_json(playtests_dir / "index.json", {
        "schema_version": 1,
        "runs": runs,
        "coverage": coverage,
        "quality": quality,
        "gaps": [],
        "quality_gaps": [] if quality_gap is None else [quality_gap],
        "non_passing_runs": [],
        "loop_decision": loop_decision,
    })
    write_json(playtests_dir / "loop-decision.json", loop_decision)
    write_text(playtests_dir / "suite-report.md", suite_report_fixture())


def test_completion_audit_passes_for_ready_suite_with_active_monitor(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    audit_path = coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())
    markdown = audit_path.read_text()

    assert audit["result"] == "pass"
    assert audit["findings"] == []
    assert audit["active_runs"] == ["v2-haunting-module", "v3-chase-drill", "v4-multi-profile-pressure"]
    assert audit["required_profiles"]["multi_profile_pressure"] == "v4-multi-profile-pressure"
    assert "## Overall Result\nPASS" in markdown
    assert "virtual_player_pressure: passed" in markdown
    assert "Monitor: ACTIVE" in markdown


def test_completion_audit_fails_when_active_run_source_files_are_missing(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    (tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "transcript.jsonl").unlink()
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "transcript.jsonl" in finding["missing_files"]


def test_completion_audit_fails_when_active_run_source_files_are_empty(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    write_text(tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "transcript.jsonl", "")
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_empty")
    assert finding["run_id"] == "v2-haunting-module"
    assert "transcript.jsonl" in finding["empty_files"]


def test_completion_audit_fails_when_active_run_source_files_are_malformed(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    write_text(tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "transcript.jsonl", "{not-json}\n")
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_malformed")
    assert finding["run_id"] == "v2-haunting-module"
    assert "transcript.jsonl" in finding["malformed_files"]


def test_completion_audit_fails_when_transcript_source_lacks_keeper_and_player_turns(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    write_jsonl(tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "transcript.jsonl", [
        {"turn": 1, "role": "system", "mode": "roll", "text": "fixture roll only"},
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v2-haunting-module"
    assert "transcript.jsonl" in finding["incomplete_files"]
    assert "keeper_under_test turn" in finding["missing_evidence"]
    assert "player_simulator turn" in finding["missing_evidence"]


def test_completion_audit_fails_when_feedback_source_lacks_rating_and_comment(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    write_jsonl(tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "player-feedback.jsonl", [
        {"category": "kp_clarity"},
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v2-haunting-module"
    assert "player-feedback.jsonl" in finding["incomplete_files"]
    assert "feedback score" in finding["missing_evidence"]
    assert "feedback text" in finding["missing_evidence"]


def test_completion_audit_fails_when_view_sources_lack_player_and_keeper_evidence(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_jsonl(run_dir / "player-view.jsonl", [
        {"view": "player"},
    ])
    write_jsonl(run_dir / "keeper-view.jsonl", [
        {"view": "keeper"},
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v2-haunting-module"
    assert "player-view.jsonl" in finding["incomplete_files"]
    assert "keeper-view.jsonl" in finding["incomplete_files"]
    assert "player public character state" in finding["missing_evidence"]
    assert "player view transcript turn" in finding["missing_evidence"]
    assert "keeper context" in finding["missing_evidence"]
    assert "keeper view transcript turn" in finding["missing_evidence"]
    assert "keeper secret id list" in finding["missing_evidence"]


def test_completion_audit_fails_when_campaign_logs_and_memory_lack_structured_evidence(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    campaign_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "sandbox" / ".coc" / "campaigns" / "v2-haunting-module"
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [{}])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [{}])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [{}])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v2-haunting-module"
    assert "sandbox/.coc/campaigns/v2-haunting-module/logs/rolls.jsonl" in finding["incomplete_files"]
    assert "sandbox/.coc/campaigns/v2-haunting-module/logs/events.jsonl" in finding["incomplete_files"]
    assert "sandbox/.coc/campaigns/v2-haunting-module/memory/session-summaries.jsonl" in finding["incomplete_files"]
    assert "mechanical roll payload" in finding["missing_evidence"]
    assert "durable event payload" in finding["missing_evidence"]
    assert "session memory summary" in finding["missing_evidence"]


def test_completion_audit_fails_when_profile_event_logs_lack_required_event_types(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
        campaign_dir = tmp_path / ".coc" / "playtests" / run["run_id"] / "sandbox" / ".coc" / "campaigns" / run["run_id"]
        write_jsonl(campaign_dir / "logs" / "events.jsonl", [
            {"type": "scene", "actor": "keeper_under_test", "payload": {"summary": "fixture scene only"}},
        ])
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    findings = [
        finding for finding in audit["findings"]
        if finding["code"] == "active_run_source_files_incomplete"
    ]
    by_run = {finding["run_id"]: finding for finding in findings}
    assert "haunting_module event type combat" in by_run["v2-haunting-module"]["missing_evidence"]
    assert "haunting_module event type sanity" in by_run["v2-haunting-module"]["missing_evidence"]
    assert "haunting_module event type status" in by_run["v2-haunting-module"]["missing_evidence"]
    assert "haunting_module event type session_ending" in by_run["v2-haunting-module"]["missing_evidence"]
    assert "chase_drill event type chase" in by_run["v3-chase-drill"]["missing_evidence"]
    assert "chase_drill event type status" in by_run["v3-chase-drill"]["missing_evidence"]
    assert "chase_drill event type session_ending" in by_run["v3-chase-drill"]["missing_evidence"]
    assert "multi_profile_pressure event type decision" in by_run["v4-multi-profile-pressure"]["missing_evidence"]
    assert "multi_profile_pressure event type status" in by_run["v4-multi-profile-pressure"]["missing_evidence"]
    assert "multi_profile_pressure event type session_ending" in by_run["v4-multi-profile-pressure"]["missing_evidence"]


def test_completion_audit_fails_when_roll_log_lacks_dice_target_and_outcome(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    campaign_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "sandbox" / ".coc" / "campaigns" / "v2-haunting-module"
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {"type": "roll", "actor": "fixture", "payload": {"skill": "Spot Hidden"}},
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v2-haunting-module"
    assert "sandbox/.coc/campaigns/v2-haunting-module/logs/rolls.jsonl" in finding["incomplete_files"]
    assert "mechanical roll result" in finding["missing_evidence"]


def test_completion_audit_fails_when_required_pushed_roll_source_evidence_is_missing(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "v2-haunting-module"
    write_jsonl(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "fixture keeper turn"},
        {"turn": 2, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "investigate", "text": "fixture player turn"},
    ])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {"type": "roll", "actor": "fixture", "payload": {"skill": "Spot Hidden", "target": 55, "roll": 33, "outcome": "regular_success"}},
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v2-haunting-module"
    assert "transcript.jsonl" in finding["incomplete_files"]
    assert "sandbox/.coc/campaigns/v2-haunting-module/logs/rolls.jsonl" in finding["incomplete_files"]
    assert "required pushed roll payload" in finding["missing_evidence"]
    assert "pushed roll transcript protocol" in finding["missing_evidence"]


def test_completion_audit_fails_when_required_meta_game_source_evidence_is_missing(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    pushed_roll_id = "v2-haunting-module-pushed-roll"
    write_jsonl(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "fixture keeper turn"},
        {"turn": 2, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "investigate", "text": "fixture player turn"},
        {"turn": 3, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "text": "fixture reframed pushed action", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "player_reframes_action"}},
        {"turn": 4, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "fixture keeper foreshadows pushed risk", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "keeper_foreshadows_failure", "failure_consequence_source": "keeper"}},
        {"turn": 5, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "text": "fixture confirms pushed risk", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "player_confirms_risk", "risk_confirmed": True}},
        {"turn": 6, "role": "system", "speaker": "System", "mode": "roll", "text": "fixture pushed roll resolved", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "roll_resolved"}},
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v2-haunting-module"
    assert "transcript.jsonl" in finding["incomplete_files"]
    assert "meta player question" in finding["missing_evidence"]
    assert "meta keeper answer" in finding["missing_evidence"]


def test_completion_audit_fails_when_multi_profile_source_lacks_required_player_profiles(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    run_dir = tmp_path / ".coc" / "playtests" / "v4-multi-profile-pressure"
    pushed_roll_id = "v4-multi-profile-pressure-pushed-roll"
    write_jsonl(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "fixture keeper turn"},
        {"turn": 2, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "player_profile": "careful_investigator", "intent": "investigate", "text": "fixture careful player turn"},
        {"turn": 3, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "player_profile": "careful_investigator", "text": "fixture reframed pushed action", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "player_reframes_action"}},
        {"turn": 4, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "fixture keeper foreshadows pushed risk", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "keeper_foreshadows_failure", "failure_consequence_source": "keeper"}},
        {"turn": 5, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "player_profile": "careful_investigator", "text": "fixture confirms pushed risk", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "player_confirms_risk", "risk_confirmed": True}},
        {"turn": 6, "role": "system", "speaker": "System", "mode": "roll", "text": "fixture pushed roll resolved", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "roll_resolved"}},
    ])
    write_jsonl(run_dir / "player-feedback.jsonl", [
        {"player_profile": "careful_investigator", "category": "kp_clarity", "score": 5, "text": "fixture careful feedback"},
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v4-multi-profile-pressure"
    assert "transcript.jsonl" in finding["incomplete_files"]
    assert "player-feedback.jsonl" in finding["incomplete_files"]
    assert "multi_profile_pressure transcript profile reckless_investigator" in finding["missing_evidence"]
    assert "multi_profile_pressure transcript profile skeptical_rules_lawyer" in finding["missing_evidence"]
    assert "multi_profile_pressure feedback profile reckless_investigator" in finding["missing_evidence"]
    assert "multi_profile_pressure feedback profile skeptical_rules_lawyer" in finding["missing_evidence"]


def test_completion_audit_fails_when_investigator_sources_lack_reusable_character_evidence(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    investigator_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "sandbox" / ".coc" / "investigators" / "v2-haunting-module-investigator"
    write_json(investigator_dir / "creation.json", {})
    write_json(investigator_dir / "character.json", {})
    write_jsonl(investigator_dir / "history.jsonl", [{}])
    write_jsonl(investigator_dir / "development.jsonl", [{}])
    write_jsonl(investigator_dir / "inventory-history.jsonl", [{}])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v2-haunting-module"
    assert "sandbox/.coc/investigators/v2-haunting-module-investigator/creation.json" in finding["incomplete_files"]
    assert "sandbox/.coc/investigators/v2-haunting-module-investigator/character.json" in finding["incomplete_files"]
    assert "sandbox/.coc/investigators/v2-haunting-module-investigator/history.jsonl" in finding["incomplete_files"]
    assert "sandbox/.coc/investigators/v2-haunting-module-investigator/development.jsonl" in finding["incomplete_files"]
    assert "sandbox/.coc/investigators/v2-haunting-module-investigator/inventory-history.jsonl" in finding["incomplete_files"]
    assert "investigator skill allocation" in finding["missing_evidence"]
    assert "investigator character skills" in finding["missing_evidence"]
    assert "investigator history summary" in finding["missing_evidence"]
    assert "investigator development record" in finding["missing_evidence"]
    assert "investigator inventory summary" in finding["missing_evidence"]


def test_completion_audit_fails_when_battle_report_missing_required_anchors(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(
        run_dir / "artifacts" / "battle-report.md",
        "\n\n".join([
            "# Battle Report <!-- report-anchor: Battle Report -->",
            "## Actual Play Replay <!-- report-anchor: Actual Play Replay -->\n- Fixture table turn.",
            "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n- Fixture feedback.",
        ]) + "\n",
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "battle_report_anchors_missing")
    assert "Run Setup" in finding["missing_anchors"]
    assert "Mechanical Log" in finding["missing_anchors"]


def test_completion_audit_fails_when_battle_report_omits_source_dialogue_text(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(run_dir / "artifacts" / "battle-report.md", battle_report_shell_with_required_anchors())
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "battle_report_source_dialogue_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "fixture keeper turn" in finding["missing_dialogue_samples"]
    assert "fixture player turn" in finding["missing_dialogue_samples"]


def test_completion_audit_fails_when_source_dialogue_is_outside_replay_sections(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(
        run_dir / "artifacts" / "battle-report.md",
        battle_report_with_source_dialogue_only_outside_replay_sections(),
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "battle_report_source_dialogue_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "fixture keeper turn" in finding["missing_dialogue_samples"]
    assert "fixture player turn" in finding["missing_dialogue_samples"]


def test_completion_audit_fails_when_battle_report_omits_source_roll_results(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(run_dir / "artifacts" / "battle-report.md", battle_report_with_dialogue_but_without_roll_log())
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "battle_report_mechanical_log_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "Spot Hidden: v2-haunting-module-investigator rolled 33 vs 55 -> regular_success" in finding["missing_roll_samples"]
    assert "Spot Hidden: v2-haunting-module-investigator rolled 22 vs 55 -> hard_success" in finding["missing_roll_samples"]


def test_completion_audit_fails_when_roll_results_are_outside_mechanical_log(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(
        run_dir / "artifacts" / "battle-report.md",
        battle_report_with_roll_results_only_outside_mechanical_log(),
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "battle_report_mechanical_log_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "Spot Hidden: v2-haunting-module-investigator rolled 33 vs 55 -> regular_success" in finding["missing_roll_samples"]


def test_completion_audit_fails_when_battle_report_omits_source_event_summaries(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(run_dir / "artifacts" / "battle-report.md", battle_report_with_dialogue_and_rolls_but_without_events())
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "battle_report_event_summaries_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "fixture scene" in finding["missing_event_samples"]
    assert "fixture combat" in finding["missing_event_samples"]


def test_completion_audit_fails_when_battle_report_omits_source_feedback_text(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v4-multi-profile-pressure"
    write_text(run_dir / "artifacts" / "battle-report.md", battle_report_with_sources_but_without_feedback_text())
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "battle_report_feedback_text_missing")
    assert finding["run_id"] == "v4-multi-profile-pressure"
    assert "fixture careful feedback" in finding["missing_feedback_samples"]
    assert "fixture reckless feedback" in finding["missing_feedback_samples"]
    assert "fixture skeptical feedback" in finding["missing_feedback_samples"]


def test_completion_audit_fails_when_battle_report_omits_source_memory_summaries(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(run_dir / "artifacts" / "battle-report.md", battle_report_with_sources_but_without_memory_summary())
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "battle_report_memory_summaries_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "fixture memory" in finding["missing_memory_samples"]


def test_completion_audit_fails_when_battle_report_omits_investigator_chronicle_records(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(
        run_dir / "artifacts" / "battle-report.md",
        battle_report_with_sources_but_without_investigator_chronicle_records(),
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(
        finding for finding in audit["findings"]
        if finding["code"] == "battle_report_investigator_chronicle_missing"
    )
    assert finding["run_id"] == "v2-haunting-module"
    assert "fixture history" in finding["missing_chronicle_samples"]
    assert "fixture development" in finding["missing_chronicle_samples"]
    assert "fixture inventory" in finding["missing_chronicle_samples"]


def test_completion_audit_fails_when_battle_report_omits_investigator_creation_records(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(
        run_dir / "artifacts" / "battle-report.md",
        battle_report_with_sources_but_without_investigator_creation_records(),
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(
        finding for finding in audit["findings"]
        if finding["code"] == "battle_report_investigator_creation_missing"
    )
    assert finding["run_id"] == "v2-haunting-module"
    assert "STR 60" in finding["missing_creation_samples"]
    assert "EDU x 4 = 300" in finding["missing_creation_samples"]
    assert "Spot Hidden: base 25 + Occupation 30 + Personal Interest 0 = 55" in finding["missing_creation_samples"]


def test_completion_audit_fails_when_battle_report_omits_chase_tracker_state(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v3-chase-drill"
    write_text(
        run_dir / "artifacts" / "battle-report.md",
        battle_report_with_sources_but_without_chase_tracker_state(),
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(
        finding for finding in audit["findings"]
        if finding["code"] == "battle_report_chase_tracker_missing"
    )
    assert finding["run_id"] == "v3-chase-drill"
    assert "fixture-chase" in finding["missing_chase_samples"]
    assert "fixture chase round one" in finding["missing_chase_samples"]
    assert "quarry escapes" in finding["missing_chase_samples"]


def test_completion_audit_fails_when_battle_report_omits_character_dossier_records(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(
        run_dir / "artifacts" / "battle-report.md",
        battle_report_with_sources_but_without_character_dossier_records(),
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(
        finding for finding in audit["findings"]
        if finding["code"] == "battle_report_character_dossier_missing"
    )
    assert finding["run_id"] == "v2-haunting-module"
    assert "Ada King" in finding["missing_character_samples"]
    assert "STR: 60" in finding["missing_character_samples"]
    assert "Spot Hidden: 55" in finding["missing_character_samples"]
    assert "fixture backstory" in finding["missing_character_samples"]


def test_completion_audit_accepts_localized_investigator_chronicle_spacing(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    playtest = json.loads((run_dir / "playtest.json").read_text())
    playtest["localized_terms"]["zh-Hans"]["Fixture Scenario"] = "《夹具剧本》"
    write_json(run_dir / "playtest.json", playtest)
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "v2-haunting-module-investigator"
    write_jsonl(investigator_dir / "history.jsonl", [
        {"campaign_id": "v2-haunting-module", "summary": "fixture history 在 Fixture Scenario 中完成"},
    ])
    write_text(
        run_dir / "artifacts" / "battle-report.md",
        battle_report_fixture().replace("fixture history", "fixture history 在《夹具剧本》中完成"),
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "pass"


def test_completion_audit_fails_when_suite_report_missing_required_sections(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    write_text(
        tmp_path / ".coc" / "playtests" / "suite-report.md",
        "\n\n".join([
            "# COC Playtest Suite Report",
            "## Run Index\n- fixture run",
            "## Core Coverage Matrix\n- character_dossier: covered",
            "## Loop Decision\n- Status: ready_for_completion_audit",
        ]) + "\n",
    )
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "suite_report_sections_missing")
    assert "## Coverage Evidence" in finding["missing_sections"]
    assert "## Quality Evidence" in finding["missing_sections"]


def test_completion_audit_fails_when_rulebook_audit_missing_required_sections(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(
        run_dir / "artifacts" / "rulebook-audit.md",
        "# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n",
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "rulebook_audit_sections_missing")
    assert "## Positive Rulebook Evidence" in finding["missing_sections"]
    assert "## Next Loop Fix Target" in finding["missing_sections"]


def test_completion_audit_fails_when_rulebook_audit_artifact_is_not_pass(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(
        run_dir / "artifacts" / "rulebook-audit.md",
        "\n\n".join([
            "# Rulebook Alignment Audit",
            "## Overall Result\nFAIL",
            "## Positive Rulebook Evidence\n- Fixture evidence.",
            "## Root Cause Classification\n- report_gap",
            "## Blueprint Cross-Check\n- designed_not_implemented",
            "## Next Loop Fix Target\n- Regenerate report.",
        ]) + "\n",
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "rulebook_audit_result_not_pass" and finding["run_id"] == "v2-haunting-module"
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_required_coverage_dimension_missing_from_index(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    index_path = tmp_path / ".coc" / "playtests" / "index.json"
    index = json.loads(index_path.read_text())
    index["coverage"].pop("combat")
    index["gaps"] = []
    write_json(index_path, index)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "required_coverage_not_covered" and finding["key"] == "combat"
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_index_coverage_is_not_supported_by_semantic_artifacts(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
        semantic_path = tmp_path / ".coc" / "playtests" / run["run_id"] / "artifacts" / "semantic-eval-result.json"
        semantic = json.loads(semantic_path.read_text())
        semantic["coverage"]["combat"]["covered"] = False
        semantic["coverage"]["combat"]["reason"] = "Fixture no longer supports combat coverage."
        write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_artifacts_do_not_support_coverage"
        and finding["key"] == "combat"
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_index_coverage_run_list_is_not_supported(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    semantic_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic["coverage"]["combat"]["covered"] = False
    semantic["coverage"]["combat"]["reason"] = "Fixture says this run no longer supports combat coverage."
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    index_path = tmp_path / ".coc" / "playtests" / "index.json"
    index = json.loads(index_path.read_text())
    index["coverage"]["combat"]["runs"] = ["v2-haunting-module"]
    write_json(index_path, index)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_artifacts_do_not_support_coverage"
        and finding["key"] == "combat"
        and finding["index_runs"] == ["v2-haunting-module"]
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_index_quality_is_not_supported_by_semantic_artifacts(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
        semantic_path = tmp_path / ".coc" / "playtests" / run["run_id"] / "artifacts" / "semantic-eval-result.json"
        semantic = json.loads(semantic_path.read_text())
        semantic["quality"]["report_completeness"]["score"] = 3
        semantic["quality"]["report_completeness"]["passed"] = True
        semantic["quality"]["report_completeness"]["reason"] = "Fixture score is below the completion threshold."
        write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_artifacts_do_not_support_quality"
        and finding["key"] == "report_completeness"
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_index_quality_run_list_is_not_supported(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    index_path = tmp_path / ".coc" / "playtests" / "index.json"
    index = json.loads(index_path.read_text())
    index["quality"]["virtual_player_pressure"]["runs"] = ["v2-haunting-module"]
    write_json(index_path, index)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_artifacts_do_not_support_quality"
        and finding["key"] == "virtual_player_pressure"
        and finding["index_runs"] == ["v2-haunting-module"]
        for finding in audit["findings"]
    )


def test_completion_audit_fails_without_multi_profile_pressure(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(tmp_path, run["run_id"], run["audit_profile"])
    write_index(tmp_path, runs, quality_gap="virtual_player_pressure")

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=tmp_path / "missing.toml")
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(finding["code"] == "required_profile_missing" for finding in audit["findings"])
    assert any(finding["code"] == "quality_gap" and finding["key"] == "virtual_player_pressure" for finding in audit["findings"])


def test_completion_audit_fails_without_language_profile(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    metadata_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata.pop("language_profile")
    write_json(metadata_path, metadata)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(finding["code"] == "language_profile_missing" for finding in audit["findings"])


def test_completion_audit_accepts_selected_non_default_play_language(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    metadata_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["play_language"] = "ja-JP"
    metadata["language_profile"] = {
        "language": "ja-JP",
        "display_name": "Japanese",
        "term_policy": "Use localized_terms.ja-JP for people, places, factions, handouts, scenario titles, and special terms.",
    }
    metadata["localized_terms"] = {"ja-JP": {"Ada King": "エイダ・キング"}}
    write_json(metadata_path, metadata)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "pass"
    assert audit["findings"] == []


def test_completion_audit_fails_when_evaluation_report_omits_note_evidence(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {
            "severity": "low",
            "category": "state_integrity",
            "text": "State files agree with the transcript.",
            "evidence": {
                "transcript_turns": [1, 2],
                "log_paths": ["sandbox/.coc/campaigns/v2-haunting-module/logs/events.jsonl"],
                "state_files": ["sandbox/.coc/investigators/ada-king/character.json"],
            },
        }
    ])
    write_text(
        run_dir / "artifacts" / "evaluation-report.md",
        "# Evaluation Report\n\n## State Integrity Findings\n- [low] state_integrity: State files agree with the transcript.\n",
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(finding["code"] == "evaluation_report_evidence_missing" for finding in audit["findings"])


def test_completion_audit_fails_when_evaluation_report_missing_required_sections(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_jsonl(run_dir / "evaluator-notes.jsonl", [])
    write_text(
        run_dir / "artifacts" / "evaluation-report.md",
        "# Evaluation Report\n\n## Overall Result\nPASS\n\n## Scorecard\n- state_integrity: 5\n",
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(finding["code"] == "evaluation_report_sections_missing" for finding in audit["findings"])


def test_completion_audit_fails_when_evaluation_report_artifact_is_not_pass(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(
        run_dir / "artifacts" / "evaluation-report.md",
        "\n\n".join([
            "# Evaluation Report",
            "## Overall Result\nFAIL",
            "## Scorecard\n- rulebook_procedure: 4",
            "## Passed Test Cases\n- fixture pass",
            "## Failed Test Cases\n- fixture failure",
            "## Rule Accuracy Findings\n- none",
            "## State Integrity Findings\n- none",
            "## Spoiler Safety Findings\n- none",
            "## Immersion Findings\n- none",
            "## Meta-Game Findings\n- none",
            "## Reproducible Bugs\n- none",
            "## Recommended Fixes\n- repair fixture",
            "## Regression Tests To Add\n- fixture regression",
        ]) + "\n",
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "evaluation_report_result_not_pass" and finding["run_id"] == "v2-haunting-module"
        for finding in audit["findings"]
    )


def test_completion_audit_requires_evaluation_sections_as_markdown_headings(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_text(
        run_dir / "artifacts" / "evaluation-report.md",
        "\n".join([
            "# Evaluation Report",
            "## Overall Result",
            "PASS",
            "## Scorecard",
            "- The remaining required sections are mentioned, but not rendered as headings:",
            "- ## Passed Test Cases",
            "- ## Failed Test Cases",
            "- ## Rule Accuracy Findings",
            "- ## State Integrity Findings",
            "- ## Spoiler Safety Findings",
            "- ## Immersion Findings",
            "- ## Meta-Game Findings",
            "- ## Reproducible Bugs",
            "- ## Recommended Fixes",
            "- ## Regression Tests To Add",
        ]) + "\n",
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "evaluation_report_sections_missing")
    assert "## Passed Test Cases" in finding["missing_sections"]


def test_completion_audit_fails_without_llm_semantic_provenance(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    semantic_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic.pop("evaluation_provenance")
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(finding["code"] == "semantic_provenance_missing" for finding in audit["findings"])


def test_completion_audit_fails_when_semantic_quality_dimension_missing_required_fields(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    semantic_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic["quality"]["rulebook_procedure"].pop("passed")
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_quality_dimension_invalid"
        and finding["run_id"] == "v2-haunting-module"
        and finding["key"] == "rulebook_procedure"
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_semantic_quality_reason_is_not_a_non_empty_string(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    semantic_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic["quality"]["rulebook_procedure"]["reason"] = ""
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_quality_dimension_invalid"
        and finding["run_id"] == "v2-haunting-module"
        and finding["key"] == "rulebook_procedure"
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_semantic_coverage_dimension_missing_required_fields(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    semantic_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic["coverage"]["chase"] = True
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_coverage_dimension_invalid"
        and finding["run_id"] == "v2-haunting-module"
        and finding["key"] == "chase"
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_semantic_coverage_reason_is_not_a_non_empty_string(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    semantic_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic["coverage"]["combat"]["reason"] = None
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_coverage_dimension_invalid"
        and finding["run_id"] == "v2-haunting-module"
        and finding["key"] == "combat"
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_semantic_loop_fields_are_missing(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    semantic_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic.pop("root_cause_classification")
    semantic.pop("next_loop_fix_target")
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_required_field_missing"
        and finding["run_id"] == "v2-haunting-module"
        and set(finding["missing_fields"]) == {"root_cause_classification", "next_loop_fix_target"}
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_semantic_request_contract_is_incomplete(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    request_path = run_dir / "artifacts" / "semantic-eval-request.json"
    malformed_request = request_payload("v2-haunting-module")
    malformed_request.pop("coverage_keys")
    write_json(request_path, malformed_request)
    semantic_path = run_dir / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic["evaluation_provenance"]["request_sha256"] = request_hash(malformed_request)
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_request_contract_invalid"
        and finding["run_id"] == "v2-haunting-module"
        and "coverage_keys" in finding["missing_fields"]
        for finding in audit["findings"]
    )
