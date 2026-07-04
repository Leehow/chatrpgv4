import importlib.util
import hashlib
import json
import shutil
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


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write_workspace_indexes(run_dir: Path, run_id: str, investigator_id: str):
    write_json(run_dir / "sandbox" / ".coc" / "indexes" / "investigators.json", {
        "schema_version": 1,
        "investigators": {
            investigator_id: {
                "id": investigator_id,
                "name": "Ada King",
                "creation_path": f".coc/investigators/{investigator_id}/creation.json",
                "path": f".coc/investigators/{investigator_id}/character.json",
                "history_path": f".coc/investigators/{investigator_id}/history.jsonl",
                "development_path": f".coc/investigators/{investigator_id}/development.jsonl",
                "inventory_history_path": f".coc/investigators/{investigator_id}/inventory-history.jsonl",
            },
        },
    })
    write_json(run_dir / "sandbox" / ".coc" / "indexes" / "campaigns.json", {
        "schema_version": 1,
        "campaigns": {
            run_id: {
                "campaign_id": run_id,
                "title": run_id,
                "status": "playtest",
                "play_language": "zh-Hans",
                "path": f".coc/campaigns/{run_id}/campaign.json",
                "party_path": f".coc/campaigns/{run_id}/party.json",
                "save_path": f".coc/campaigns/{run_id}/save",
                "memory_path": f".coc/campaigns/{run_id}/memory",
                "logs_path": f".coc/campaigns/{run_id}/logs",
                "investigator_ids": [investigator_id],
            },
        },
    })


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
        "inputs": {
            "battle_report": "fixture evidence",
            "scenario": {
                "scenario_id": "fixture-scenario",
                "title": "Fixture Scenario",
                "opening_scene": "Fixture opening scene.",
            },
        },
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
            "reviewed_artifact": "artifacts/semantic-eval-request.json",
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
        lines.append("  - Rule Refs: core.percentile_check, core.success_level, core.difficulty.regular")
        lines.append(f"- Spot Hidden: {investigator_id} rolled 22 vs 55 -> hard_success")
        lines.append("  - Rule Refs: core.percentile_check, core.success_level, core.difficulty.regular, core.pushed_roll")
    return "\n".join(lines)


def battle_report_event_fixture_text() -> str:
    event_summaries = [
        "fixture scene",
        "fixture combat",
        "fixture resource change",
        "fixture sanity",
        "fixture status",
        "fixture ending",
        "fixture chase",
        "fixture item transfer",
        "fixture decision",
    ]
    return "\n".join(f"- {summary}" for summary in event_summaries)


def battle_report_feedback_fixture_text() -> str:
    feedback_rows = [
        (5, "fixture feedback"),
        (5, "fixture careful feedback"),
        (4, "fixture reckless feedback"),
        (5, "fixture skeptical feedback"),
    ]
    return "\n".join(f"- {score}/5: {text}" for score, text in feedback_rows)


def battle_report_feedback_fixture_text_without_scores() -> str:
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
        "- Characteristic Half/Fifth Values: STR 30/12, DEX 25/10",
        "- Age: 32（20-39 岁）",
        "- Age Adjustments: EDU 成长检定 1 次；本次 42 / 75，未提升；属性无降低。",
        "- Occupation: Antiquarian",
        "- Occupation Skill Points: EDU x 4 = 300",
        "- Personal Interest Skill Points: INT x 2 = 140",
        "- Credit Rating: 40 (Rulebook Occupation Range 30-70)",
        "- Living Standard: 普通",
        "- Cash: 80 美元",
        "- Assets: 2000 美元",
        "- Spending Level: 10 美元",
        "- Skill Allocation: Occupation 300/300; Personal Interest 140/140; Unallocated 0/0",
        "- Skill Half/Fifth Values: Library Use 30/12, Spot Hidden 27/11",
        "  - Library Use: Base 20 + Occupation 40 + Personal Interest 0 = 60",
        "  - Spot Hidden: Base 25 + Occupation 30 + Personal Interest 0 = 55",
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


def battle_report_with_localized_chase_difficulty() -> str:
    localized_tracker = battle_report_chase_tracker_fixture_text().replace(
        ", regular,",
        ", 普通,",
    )
    return battle_report_fixture().replace(
        battle_report_chase_tracker_fixture_text(),
        localized_tracker,
    )


def battle_report_handout_fixture_text() -> str:
    return "- Fixture handout title — Fixture handout summary"


def battle_report_character_dossier_fixture_text() -> str:
    return "\n".join([
        "- Ada King (v2-haunting-module-investigator)",
        "- Ada King (v3-chase-drill-investigator)",
        "- Ada King (v4-multi-profile-pressure-investigator)",
        "  - Occupation: Antiquarian",
        "  - Era: 1920s",
        "  - Characteristics: STR: 60, DEX: 50",
        "  - Characteristic Half/Fifth Values: STR 30/12, DEX 25/10",
        "  - Derived: HP: 12, MOV: 8",
        "  - Skills: Spot Hidden: 55, Library Use: 60",
        "  - Skill Half/Fifth Values: Library Use 30/12, Spot Hidden 27/11",
        "  - Backstory:",
        "    - Description: fixture backstory",
        "    - Traits: careful notes; checks exits",
    ])


def battle_report_fixture() -> str:
    return "\n\n".join([
        "# Battle Report <!-- report-anchor: Battle Report -->",
        "## Run Setup <!-- report-anchor: Run Setup -->\n- Run ID: fixture",
        "## Module <!-- report-anchor: Module -->\n- Scenario: fixture",
        "## Handouts <!-- report-anchor: Handouts -->\n"
        + battle_report_handout_fixture_text(),
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
        "- fixture spoiler warning\n"
        "- fixture spoiler confirmation\n"
        "- fixture limited spoiler reveal\n"
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
        "- fixture spoiler warning\n"
        "- fixture spoiler confirmation\n"
        "- fixture limited spoiler reveal\n"
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
        "## Handouts <!-- report-anchor: Handouts -->\n- Fixture handouts.",
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


def battle_report_with_roll_results_only_in_html_comments() -> str:
    hidden_rolls = "\n".join([
        "<!-- roll-source: Spot Hidden: v2-haunting-module-investigator rolled 33 vs 55 -> regular_success -->",
        "- 规则引用：core.percentile_check, core.success_level, core.difficulty.regular",
        "<!-- roll-source: Spot Hidden: v2-haunting-module-investigator rolled 22 vs 55 -> hard_success -->",
        "- 规则引用：core.percentile_check, core.success_level, core.difficulty.regular, core.pushed_roll",
    ])
    return battle_report_fixture().replace(
        "## Mechanical Log <!-- report-anchor: Mechanical Log -->\n"
        + battle_report_mechanical_fixture_text(),
        "## Mechanical Log <!-- report-anchor: Mechanical Log -->\n"
        + hidden_rolls,
    )


def battle_report_with_source_dialogue_only_outside_replay_sections() -> str:
    misplaced_dialogue = "\n".join([
        "- fixture keeper turn",
        "- fixture player turn",
        "- fixture reframed pushed action",
        "- fixture keeper foreshadows pushed risk",
        "- fixture confirms pushed risk",
        "- fixture spoiler warning",
        "- fixture spoiler confirmation",
        "- fixture limited spoiler reveal",
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
            "- fixture spoiler warning\n"
            "- fixture spoiler confirmation\n"
            "- fixture limited spoiler reveal\n"
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
            "- fixture spoiler warning\n"
            "- fixture spoiler confirmation\n"
            "- fixture limited spoiler reveal\n"
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


def battle_report_without_handout_records() -> str:
    return battle_report_fixture().replace(
        "## Handouts <!-- report-anchor: Handouts -->\n"
        + battle_report_handout_fixture_text(),
        "## Handouts <!-- report-anchor: Handouts -->\n- Fixture handout placeholder.",
    )


def battle_report_with_events_only_outside_scene_and_state_sections() -> str:
    return (
        battle_report_fixture()
        .replace(
            "## Scene-by-Scene Replay <!-- report-anchor: Scene-by-Scene Replay -->\n"
            + battle_report_event_fixture_text(),
            "## Scene-by-Scene Replay <!-- report-anchor: Scene-by-Scene Replay -->\n- Fixture scene.",
        )
        .replace(
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text(),
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text()
            + "\n"
            + battle_report_event_fixture_text(),
        )
    )


def battle_report_with_sources_but_without_feedback_text() -> str:
    return battle_report_fixture().replace(
        "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n"
        + battle_report_feedback_fixture_text(),
        "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n- Fixture feedback summary.",
    )


def battle_report_with_feedback_only_outside_feedback_section() -> str:
    return (
        battle_report_fixture()
        .replace(
            "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n"
            + battle_report_feedback_fixture_text(),
            "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n- Fixture feedback summary.",
        )
        .replace(
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text(),
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text()
            + "\n"
            + battle_report_feedback_fixture_text(),
        )
    )


def battle_report_with_feedback_text_but_without_scores() -> str:
    return battle_report_fixture().replace(
        "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n"
        + battle_report_feedback_fixture_text(),
        "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n"
        + battle_report_feedback_fixture_text_without_scores(),
    )


def battle_report_with_sources_but_without_memory_summary() -> str:
    return battle_report_fixture().replace(
        "## Story Recap <!-- report-anchor: Story Recap -->\n"
        + battle_report_memory_fixture_text(),
        "## Story Recap <!-- report-anchor: Story Recap -->\n- Fixture recap.",
    )


def battle_report_with_memory_only_outside_story_recap() -> str:
    return (
        battle_report_fixture()
        .replace(
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text(),
            "## Story Recap <!-- report-anchor: Story Recap -->\n- Fixture recap.",
        )
        .replace(
            "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n"
            + battle_report_feedback_fixture_text(),
            "## Player Feedback On KP <!-- report-anchor: Player Feedback On KP -->\n"
            + battle_report_feedback_fixture_text()
            + "\n"
            + battle_report_memory_fixture_text(),
        )
    )


def battle_report_with_sources_but_without_investigator_chronicle_records() -> str:
    return battle_report_fixture().replace(
        "## Investigator Chronicle <!-- report-anchor: Investigator Chronicle -->\n"
        + battle_report_investigator_chronicle_fixture_text(),
        "## Investigator Chronicle <!-- report-anchor: Investigator Chronicle -->\n- Fixture chronicle.",
    )


def battle_report_with_chronicle_only_outside_chronicle_section() -> str:
    return (
        battle_report_fixture()
        .replace(
            "## Investigator Chronicle <!-- report-anchor: Investigator Chronicle -->\n"
            + battle_report_investigator_chronicle_fixture_text(),
            "## Investigator Chronicle <!-- report-anchor: Investigator Chronicle -->\n- Fixture chronicle.",
        )
        .replace(
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text(),
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text()
            + "\n"
            + battle_report_investigator_chronicle_fixture_text(),
        )
    )


def battle_report_with_sources_but_without_investigator_creation_records() -> str:
    return battle_report_fixture().replace(
        "## Investigator Creation <!-- report-anchor: Investigator Creation -->\n"
        + battle_report_investigator_creation_fixture_text(),
        "## Investigator Creation <!-- report-anchor: Investigator Creation -->\n- Fixture creation record.",
    )


def battle_report_with_creation_only_outside_creation_section() -> str:
    return (
        battle_report_fixture()
        .replace(
            "## Investigator Creation <!-- report-anchor: Investigator Creation -->\n"
            + battle_report_investigator_creation_fixture_text(),
            "## Investigator Creation <!-- report-anchor: Investigator Creation -->\n- Fixture creation record.",
        )
        .replace(
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text(),
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text()
            + "\n"
            + battle_report_investigator_creation_fixture_text(),
        )
    )


def battle_report_with_sources_but_without_chase_tracker_state() -> str:
    return battle_report_fixture().replace(
        "## Chase Tracker <!-- report-anchor: Chase Tracker -->\n"
        + battle_report_chase_tracker_fixture_text(),
        "## Chase Tracker <!-- report-anchor: Chase Tracker -->\n- Fixture chase tracker.",
    )


def battle_report_with_chase_tracker_only_outside_chase_tracker_section() -> str:
    return (
        battle_report_fixture()
        .replace(
            "## Chase Tracker <!-- report-anchor: Chase Tracker -->\n"
            + battle_report_chase_tracker_fixture_text(),
            "## Chase Tracker <!-- report-anchor: Chase Tracker -->\n- Fixture chase tracker.",
        )
        .replace(
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text(),
            "## Story Recap <!-- report-anchor: Story Recap -->\n"
            + battle_report_memory_fixture_text()
            + "\n"
            + battle_report_chase_tracker_fixture_text(),
        )
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
        "## Non-Passing Evaluated Runs\n- none",
        "## Core Coverage Matrix\n- character_dossier: covered",
        "## Coverage Evidence\n- fixture coverage evidence",
        "## Quality Matrix\n- report_completeness: passed",
        "## Quality Evidence\n- fixture quality evidence",
        "## Loop Decision\n- Status: ready_for_completion_audit",
        "## Repair Targets\n- none",
        "## Remaining Gaps\n- No gaps detected.",
        "## Remaining Quality Gaps\n- No quality gaps detected.",
    ]) + "\n"


def rulebook_audit_fixture(run_id: str = "fixture-run", audit_profile: str = "fixture") -> str:
    positive_evidence = ["- Fixture evidence."]
    if audit_profile == "chase_drill":
        positive_evidence.extend([
            "- Chase evidence: 1 chase events; save/chase.json fields present: participants, location_chain, rounds, outcome; Chase Tracker rendered: yes.",
            "- Chase player pressure: careful_investigator, reckless_investigator, skeptical_rules_lawyer.",
            "- Pushed-roll protocol stages: "
            f"{run_id}-pushed-roll=player_reframes_action -> keeper_foreshadows_failure -> player_confirms_risk -> roll_resolved.",
        ])
    if audit_profile == "multi_profile_pressure":
        positive_evidence.extend([
            "- Multi-profile pressure: careful_investigator=谨慎调查员, reckless_investigator=鲁莽调查员, skeptical_rules_lawyer=规则质疑玩家.",
            "- Pushed-roll protocol stages: "
            f"{run_id}-pushed-roll=player_reframes_action -> keeper_foreshadows_failure -> player_confirms_risk -> roll_resolved.",
            "- Spoiler protocol stages: fixture-spoiler-reveal=warning_issued -> player_confirmed -> limited_reveal.",
        ])
    return "\n\n".join([
        "# Rulebook Alignment Audit",
        "## Overall Result\nPASS",
        "## Positive Rulebook Evidence\n" + "\n".join(positive_evidence),
        "## Root Cause Classification\n- No findings.",
        "## Blueprint Cross-Check\n- Current run satisfies the implemented rulebook-audit contract.",
        "## Next Loop Fix Target\n- No fix target.",
    ]) + "\n"


def write_campaign_save_index_fixture(campaign_dir: Path, run_id: str, investigator_id: str, audit_profile: str):
    write_json(campaign_dir / "save" / "world-state.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "scenario_id": "fixture-scenario",
        "status": "playtest",
        "active_scene_id": "fixture-ending",
        "active_subsystem": audit_profile,
        "current_phase": "fixture-ending",
        "discovered_clue_ids": ["fixture-handout"],
        "major_decisions": [{"summary": "fixture decision"}],
        "memory_refs": ["memory/session-summaries.jsonl"],
        "log_refs": ["logs/events.jsonl", "logs/rolls.jsonl"],
        "investigator_state_refs": [f"save/investigator-state/{investigator_id}.json"],
    })
    write_json(campaign_dir / "save" / "active-scene.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "scenario_id": "fixture-scenario",
        "scene_id": "fixture-ending",
        "source_event_type": "session_ending",
        "summary": "fixture ending",
    })
    write_json(campaign_dir / "save" / "flags.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "scenario_id": "fixture-scenario",
        "clues_found": {"fixture-handout": True},
        "decisions": [{"summary": "fixture decision"}],
        "spoiler_reveals": [],
    })
    write_json(campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "investigator_id": investigator_id,
        "character_ref": f"sandbox/.coc/investigators/{investigator_id}/character.json",
        "current_hp": 12,
        "current_san": 55,
        "current_mp": 11,
        "conditions": [],
        "skill_checks_earned": ["Spot Hidden"],
    })
    if audit_profile == "haunting_module":
        write_json(campaign_dir / "save" / "combat.json", {
            "schema_version": 1,
            "campaign_id": run_id,
            "scenario_id": "fixture-scenario",
            "combat_id": "fixture-combat",
            "status": "resolved",
            "combatants": [
                {"id": investigator_id, "role": "investigator", "dex": 50},
                {"id": "walter-corbitt", "role": "npc", "dex": 35},
            ],
            "dex_order": [investigator_id, "walter-corbitt"],
            "rounds": [{"round": 1, "events": ["fixture combat"]}],
        })
    write_json(campaign_dir / "index" / "source-map.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "scenario_id": "fixture-scenario",
        "scenario_files": ["scenario/scenario.json", "scenario/handouts.json"],
        "source_refs": [{"kind": "module_source", "path": "fixture.pdf"}],
        "log_refs": ["logs/events.jsonl", "logs/rolls.jsonl"],
        "memory_refs": ["memory/session-summaries.jsonl"],
    })
    write_json(campaign_dir / "index" / "scene-index.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "scenario_id": "fixture-scenario",
        "active_scene_id": "fixture-ending",
        "scenes": [{"id": "fixture-ending", "summary": "fixture ending"}],
    })
    write_json(campaign_dir / "index" / "npc-index.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "scenario_id": "fixture-scenario",
        "npcs": [{"id": "walter-corbitt", "name": "Walter Corbitt"}],
    })
    write_json(campaign_dir / "index" / "clue-index.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "scenario_id": "fixture-scenario",
        "clues": [{"id": "fixture-handout", "summary": "Fixture handout summary"}],
        "handouts": [{"id": "fixture-handout", "summary": "Fixture handout summary"}],
        "discovered_clue_ids": ["fixture-handout"],
    })
    write_json(campaign_dir / "index" / "rule-ref-index.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "scenario_id": "fixture-scenario",
        "rule_refs": ["core.percentile_check", "core.success_level", "core.difficulty.regular", "core.pushed_roll"],
        "by_ref": {
            "core.percentile_check": [
                {"log": "logs/rolls.jsonl", "row": 1, "type": "roll"},
                {"log": "logs/rolls.jsonl", "row": 2, "type": "roll"},
            ],
            "core.success_level": [
                {"log": "logs/rolls.jsonl", "row": 1, "type": "roll"},
                {"log": "logs/rolls.jsonl", "row": 2, "type": "roll"},
            ],
            "core.difficulty.regular": [
                {"log": "logs/rolls.jsonl", "row": 1, "type": "roll"},
                {"log": "logs/rolls.jsonl", "row": 2, "type": "roll"},
            ],
            "core.pushed_roll": [
                {"log": "logs/rolls.jsonl", "row": 2, "type": "roll"},
            ],
        },
    })


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
        "player_profiles_tested": (
            ["careful_investigator", "reckless_investigator", "skeptical_rules_lawyer"]
            if audit_profile in {"chase_drill", "multi_profile_pressure"}
            else []
        ),
        "play_language": "zh-Hans",
        "language_profile": {
            "language": "zh-Hans",
            "display_name": "Simplified Chinese",
            "term_policy": "Use localized_terms.zh-Hans for people, places, factions, handouts, scenario titles, and special terms.",
            "report_labels": {
                "roll_sentence": "- {skill}：{actor}掷出 {roll} / {target}，结果{outcome}。",
            },
            "outcome_labels": {
                "regular_success": "普通成功",
                "hard_success": "困难成功",
            },
            "speaker_labels": {
                "keeper": "KP",
                "player": "玩家",
                "system": "系统",
            },
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
        {"turn": 6, "role": "system", "speaker": "System", "mode": "roll", "roll_count": 2, "text": "fixture pushed roll resolved", "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "roll_resolved"}},
    ]
    if audit_profile in {"chase_drill", "multi_profile_pressure"}:
        transcript_rows.extend([
            {"turn": 7, "role": "player_simulator", "speaker": "Careful Player", "mode": "play", "player_profile": "careful_investigator", "intent": "careful_planning", "intent_display": "谨慎规划", "text": "fixture careful profile turn"},
            {"turn": 8, "role": "player_simulator", "speaker": "Reckless Player", "mode": "play", "player_profile": "reckless_investigator", "intent": "reckless_risk", "intent_display": "鲁莽冒险", "text": "fixture reckless profile turn"},
            {"turn": 9, "role": "player_simulator", "speaker": "Rules Player", "mode": "meta", "player_profile": "skeptical_rules_lawyer", "intent": "rules_challenge", "intent_display": "规则质疑", "text": "fixture skeptical rules profile turn"},
        ])
    if audit_profile == "multi_profile_pressure":
        transcript_rows.extend([
            {
                "turn": 10,
                "role": "keeper_under_test",
                "speaker": "KP",
                "mode": "meta",
                "text": "fixture spoiler warning",
                "spoiler_protocol": {
                    "spoiler_id": "fixture-spoiler-reveal",
                    "stage": "warning_issued",
                    "keeper_secret_id": "fixture-secret",
                    "scope": "fixture_secret_scope",
                    "requires_confirmation": True,
                },
            },
            {
                "turn": 11,
                "role": "player_simulator",
                "speaker": "Rules Player",
                "mode": "meta",
                "player_profile": "skeptical_rules_lawyer",
                "text": "fixture spoiler confirmation",
                "spoiler_protocol": {
                    "spoiler_id": "fixture-spoiler-reveal",
                    "stage": "player_confirmed",
                    "keeper_secret_id": "fixture-secret",
                    "scope": "fixture_secret_scope",
                    "confirmed": True,
                },
            },
            {
                "turn": 12,
                "role": "keeper_under_test",
                "speaker": "KP",
                "mode": "meta",
                "text": "fixture limited spoiler reveal",
                "spoiler_protocol": {
                    "spoiler_id": "fixture-spoiler-reveal",
                    "stage": "limited_reveal",
                    "keeper_secret_id": "fixture-secret",
                    "scope": "fixture_secret_scope",
                    "confirmed": True,
                },
            },
        ])
    transcript_rows.extend([
        {"turn": 20, "role": "player_simulator", "speaker": "Rules Player", "mode": "meta", "text": "fixture meta player question"},
        {"turn": 21, "role": "keeper_under_test", "speaker": "KP", "mode": "meta", "text": "fixture meta keeper answer"},
    ])
    for row in transcript_rows:
        if row.get("role") == "player_simulator":
            row["speaker_display"] = "玩家"
        elif row.get("role") == "system":
            row["speaker_display"] = "系统"
        else:
            row["speaker_display"] = "KP"
        if row.get("mode") == "roll":
            row["text_display"] = "Spot Hidden：艾达·金掷出 33 / 55，结果普通成功；Spot Hidden：艾达·金掷出 22 / 55，结果困难成功。"
    write_jsonl(run_dir / "transcript.jsonl", transcript_rows)
    write_jsonl(run_dir / "player-view.jsonl", [
        {
            "view": "player",
            "type": "public_character_state",
            "campaign_id": run_id,
            "investigators": [
                {
                    "investigator_id": investigator_id,
                    "name": "艾达·金",
                    "current_state": {
                        "current_hp": 12,
                        "current_san": 55,
                        "current_mp": 11,
                        "conditions": [],
                    },
                },
            ],
        },
        {"view": "player", "type": "transcript_turn", "turn": 2, "role": "player_simulator", "text": "fixture player turn"},
        {
            "view": "player",
            "type": "transcript_turn",
            "turn": 6,
            "role": "system",
            "mode": "roll",
            "roll_count": 2,
            "text": "Spot Hidden：艾达·金掷出 33 / 55，结果普通成功；Spot Hidden：艾达·金掷出 22 / 55，结果困难成功。",
        },
    ])
    write_jsonl(run_dir / "keeper-view.jsonl", [
        {"view": "keeper", "type": "keeper_context", "campaign_id": run_id, "keeper_secret_ids": []},
        {"view": "keeper", "type": "transcript_turn", "turn": 1, "role": "keeper_under_test", "text": "fixture keeper turn"},
    ])
    feedback_rows = [
        {"category": "kp_clarity", "score": 5, "text": "fixture feedback"},
    ]
    if audit_profile in {"chase_drill", "multi_profile_pressure"}:
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
    write_json(campaign_dir / "scenario" / "handouts.json", [
        {"id": "fixture-handout", "title": "Fixture handout title", "summary": "Fixture handout summary"},
    ])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {
            "type": "roll",
            "actor": investigator_id,
            "payload": {
                "skill": "Spot Hidden",
                "target": 55,
                "roll": 33,
                "outcome": "regular_success",
                "rule_refs": ["core.percentile_check", "core.success_level", "core.difficulty.regular"],
            },
        },
        {
            "type": "roll",
            "actor": investigator_id,
            "payload": {
                "skill": "Spot Hidden",
                "target": 55,
                "roll": 22,
                "outcome": "hard_success",
                "rule_refs": ["core.percentile_check", "core.success_level", "core.difficulty.regular", "core.pushed_roll"],
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
            {"type": "resource_change", "actor": "walter-corbitt", "payload": {"summary": "fixture resource change"}},
            {"type": "sanity", "actor": investigator_id, "payload": {"summary": "fixture sanity"}},
            {"type": "status", "actor": investigator_id, "payload": {"summary": "fixture status"}},
            {"type": "session_ending", "actor": "keeper_under_test", "payload": {"summary": "fixture ending"}},
        ])
    elif audit_profile == "chase_drill":
        event_rows.extend([
            {"type": "chase", "actor": investigator_id, "payload": {"summary": "fixture chase"}},
            {
                "type": "item_transfer",
                "actor": investigator_id,
                "payload": {
                    "item_id": "fixture-ledger",
                    "from_actor": "fixture-pursuer",
                    "to_actor": investigator_id,
                    "source_turn": 7,
                    "chase_id": "fixture-chase",
                    "summary": "fixture item transfer",
                },
            },
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
    if audit_profile == "multi_profile_pressure":
        write_jsonl(campaign_dir / "logs" / "audit.jsonl", [
            {
                "type": "spoiler_reveal",
                "spoiler_id": "fixture-spoiler-reveal",
                "keeper_secret_id": "fixture-secret",
                "scope": "fixture_secret_scope",
                "confirmed": True,
                "transcript_turns": [10, 11, 12],
                "payload": {"summary": "fixture limited spoiler reveal"},
            },
        ])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [
        {"session_id": "fixture-session", "summary": "fixture memory"},
    ])
    write_campaign_save_index_fixture(campaign_dir, run_id, investigator_id, audit_profile)
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
            "STR": {"final": 60, "half": 30, "fifth": 12},
            "DEX": {"final": 50, "half": 25, "fifth": 10},
        },
        "age": {
            "years": 32,
            "range": "20-39",
            "edu_improvement_checks_required": 1,
            "edu_improvement_checks": [
                {
                    "roll": 42,
                    "target": 75,
                    "improved": False,
                    "improvement_die": "1D10",
                    "improvement_roll": None,
                    "edu_before": 75,
                    "edu_after": 75,
                },
            ],
            "characteristic_reductions": [],
            "app_reduction": 0,
            "mov_penalty": 0,
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
        "finances": {
            "credit_rating": 40,
            "living_standard": "Average",
            "cash": {"amount": 80, "currency": "USD", "formula": "CR x 2"},
            "assets": {"amount": 2000, "currency": "USD", "formula": "CR x 50"},
            "spending_level": {"amount": 10, "currency": "USD"},
            "period": "1920s",
        },
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
                    "half": 27,
                    "fifth": 11,
                },
                "Library Use": {
                    "base": 20,
                    "occupation_points": 40,
                    "personal_interest_points": 0,
                    "final": 60,
                    "half": 30,
                    "fifth": 12,
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
        "characteristic_thresholds": {
            "STR": {"full": 60, "half": 30, "fifth": 12},
            "DEX": {"full": 50, "half": 25, "fifth": 10},
        },
        "derived": {
            "HP": 12,
            "MOV": 8,
        },
        "skills": {
            "Spot Hidden": 55,
            "Library Use": 60,
        },
        "skill_thresholds": {
            "Spot Hidden": {"full": 55, "half": 27, "fifth": 11},
            "Library Use": {"full": 60, "half": 30, "fifth": 12},
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
        {"campaign_id": run_id, "summary": "fixture development", "skill_checks_earned": ["Spot Hidden"]},
    ])
    write_jsonl(investigator_dir / "inventory-history.jsonl", [
        {"campaign_id": run_id, "summary": "fixture inventory"},
    ])
    write_workspace_indexes(run_dir, run_id, investigator_id)
    write_text(run_dir / "artifacts" / "battle-report.md", battle_report_fixture())
    write_text(run_dir / "artifacts" / "evaluation-report.md", evaluation_report_fixture())
    write_text(run_dir / "artifacts" / "rulebook-audit.md", rulebook_audit_fixture(run_id, audit_profile))
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
    assert audit["goal_completion_gate"]["status"] == "not_complete"
    assert audit["goal_completion_gate"]["completion_signal"] == "artifact_audit_only"
    assert "## Overall Result\nPASS" in markdown
    assert "## Goal Completion Gate" in markdown
    assert "Thread goal: not_complete" in markdown
    assert "virtual_player_pressure: passed" in markdown
    assert "Monitor: ACTIVE" in markdown


def test_completion_audit_fails_when_rules_json_source_tables_are_invalid(tmp_path):
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
    source_rules_dir = Path("plugins/coc-keeper/references/rules-json")
    target_rules_dir = tmp_path / "plugins" / "coc-keeper" / "references" / "rules-json"
    target_rules_dir.mkdir(parents=True)
    for source_path in source_rules_dir.glob("*.json"):
        shutil.copy2(source_path, target_rules_dir / source_path.name)
    rule_index_path = target_rules_dir / "rule-index.json"
    rule_index = json.loads(rule_index_path.read_text())
    rule_index["rules"][0]["source_table"] = "missing-percentile-table.json"
    write_json(rule_index_path, rule_index)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert [finding["code"] for finding in audit["findings"]] == ["rules_json_validation_failed"]
    assert "rule-index source_table missing" in audit["findings"][0]["evidence"]


def test_completion_audit_accepts_active_monitor_without_prompt_phrase(tmp_path):
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
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "监工检查：继续 COC Keeper 战报、规则审计和多玩家画像压力循环。"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "pass"
    assert audit["monitor"]["status"] == "ACTIVE"
    assert audit["findings"] == []


def test_completion_audit_fails_when_workspace_indexes_are_missing(tmp_path):
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
    missing_index = (
        tmp_path
        / ".coc"
        / "playtests"
        / "v2-haunting-module"
        / "sandbox"
        / ".coc"
        / "indexes"
        / "campaigns.json"
    )
    missing_index.unlink()

    coc_completion_audit.generate_completion_audit(tmp_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding_codes = {finding["code"] for finding in audit["findings"]}
    assert "active_run_workspace_index_missing" in finding_codes


def test_completion_audit_fails_when_investigator_index_contains_campaign_state(tmp_path):
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
    run_id = "v2-haunting-module"
    investigator_id = f"{run_id}-investigator"
    index_path = (
        tmp_path
        / ".coc"
        / "playtests"
        / run_id
        / "sandbox"
        / ".coc"
        / "indexes"
        / "investigators.json"
    )
    index = json.loads(index_path.read_text())
    index["investigators"][investigator_id].update({
        "current_hp": 7,
        "current_san": 44,
        "active_scene_id": "fixture-ending",
    })
    write_json(index_path, index)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_workspace_index_missing")
    assert finding["run_id"] == run_id
    assert "investigator index contains campaign state fields for v2-haunting-module-investigator" in finding["missing_evidence"]


def test_completion_audit_fails_when_investigator_index_omits_creation_path(tmp_path):
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
    run_id = "v2-haunting-module"
    investigator_id = f"{run_id}-investigator"
    index_path = (
        tmp_path
        / ".coc"
        / "playtests"
        / run_id
        / "sandbox"
        / ".coc"
        / "indexes"
        / "investigators.json"
    )
    index = json.loads(index_path.read_text())
    index["investigators"][investigator_id].pop("creation_path", None)
    write_json(index_path, index)

    coc_completion_audit.generate_completion_audit(tmp_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_workspace_index_missing")
    assert finding["run_id"] == run_id
    assert (
        "investigator index creation_path does not match expected workspace path for v2-haunting-module-investigator"
        in finding["missing_evidence"]
    )


def test_completion_audit_fails_when_active_evaluator_note_is_medium_or_higher(tmp_path):
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
    write_jsonl(tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "evaluator-notes.jsonl", [
        {
            "severity": "medium",
            "category": "immersion",
            "text": "Fixture evaluator says the active run is not table-ready.",
            "evidence": {"artifact_paths": ["artifacts/battle-report.md"]},
        }
    ])
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert "active_evaluator_note_blocker" in {finding["code"] for finding in audit["findings"]}


def test_completion_audit_fails_when_active_evaluator_note_is_error(tmp_path):
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
    write_jsonl(tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "evaluator-notes.jsonl", [
        {
            "severity": "error",
            "category": "state_integrity",
            "text": "Fixture evaluator found a blocking state error.",
            "evidence": {"artifact_paths": ["artifacts/battle-report.md"]},
        }
    ])
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_evaluator_note_blocker")
    assert finding["severity"] == "error"


def test_completion_audit_fails_when_active_run_rule_refs_are_missing(tmp_path):
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

    campaign_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "sandbox" / ".coc" / "campaigns" / "v2-haunting-module"
    roll_rows = read_jsonl(campaign_dir / "logs" / "rolls.jsonl")
    for row in roll_rows:
        if isinstance(row.get("payload"), dict):
            row["payload"].pop("rule_refs", None)
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", roll_rows)

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_rule_refs_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "sandbox/.coc/campaigns/v2-haunting-module/logs/rolls.jsonl" in finding["incomplete_files"]


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


def test_completion_audit_fails_when_campaign_save_or_index_files_are_missing(tmp_path):
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
    (campaign_dir / "save" / "world-state.json").unlink()
    (campaign_dir / "index" / "rule-ref-index.json").unlink()
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "sandbox/.coc/campaigns/v2-haunting-module/save/world-state.json" in finding["missing_files"]
    assert "sandbox/.coc/campaigns/v2-haunting-module/index/rule-ref-index.json" in finding["missing_files"]


def test_completion_audit_fails_when_campaign_indexes_do_not_resolve_active_state(tmp_path):
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
    scene_index_path = campaign_dir / "index" / "scene-index.json"
    scene_index = json.loads(scene_index_path.read_text())
    scene_index["scenes"] = []
    write_json(scene_index_path, scene_index)
    clue_index_path = campaign_dir / "index" / "clue-index.json"
    clue_index = json.loads(clue_index_path.read_text())
    clue_index["discovered_clue_ids"] = ["missing-clue"]
    write_json(clue_index_path, clue_index)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "campaign_index_integrity_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "active scene id not present in index/scene-index.json" in finding["missing_evidence"]
    assert "discovered clue ids not present in index/clue-index.json" in finding["missing_evidence"]


def test_completion_audit_fails_when_rule_ref_index_is_stale(tmp_path):
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
    write_json(campaign_dir / "index" / "rule-ref-index.json", {
        "schema_version": 1,
        "campaign_id": "v2-haunting-module",
        "scenario_id": "fixture-scenario",
        "rule_refs": [],
        "by_ref": {},
    })
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "campaign_index_integrity_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "source rule refs not present in index/rule-ref-index.json" in finding["missing_evidence"]
    assert "sandbox/.coc/campaigns/v2-haunting-module/index/rule-ref-index.json" in finding["incomplete_files"]


def test_completion_audit_fails_when_source_map_refs_are_stale(tmp_path):
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
    source_map_path = campaign_dir / "index" / "source-map.json"
    source_map = json.loads(source_map_path.read_text())
    source_map["scenario_files"] = ["scenario/missing.json"]
    source_map["log_refs"] = ["logs/missing-events.jsonl"]
    source_map["memory_refs"] = ["memory/missing-summary.jsonl"]
    write_json(source_map_path, source_map)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "campaign_source_map_integrity_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "scenario_files refs do not resolve" in finding["missing_evidence"]
    assert "log_refs do not resolve" in finding["missing_evidence"]
    assert "memory_refs do not resolve" in finding["missing_evidence"]


def test_completion_audit_fails_when_campaign_save_files_disagree(tmp_path):
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
    active_scene_path = campaign_dir / "save" / "active-scene.json"
    active_scene = json.loads(active_scene_path.read_text())
    active_scene["scene_id"] = "stale-scene"
    write_json(active_scene_path, active_scene)
    flags_path = campaign_dir / "save" / "flags.json"
    flags = json.loads(flags_path.read_text())
    flags["clues_found"] = {}
    write_json(flags_path, flags)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "campaign_save_integrity_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "active-scene scene_id does not match world-state active_scene_id" in finding["missing_evidence"]
    assert "flags clues_found does not match world-state discovered_clue_ids" in finding["missing_evidence"]


def test_completion_audit_fails_when_investigator_state_refs_are_stale(tmp_path):
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
    run_id = "v2-haunting-module"
    investigator_id = f"{run_id}-investigator"
    campaign_dir = tmp_path / ".coc" / "playtests" / run_id / "sandbox" / ".coc" / "campaigns" / run_id
    world_state_path = campaign_dir / "save" / "world-state.json"
    world_state = json.loads(world_state_path.read_text())
    world_state["investigator_state_refs"] = ["save/investigator-state/missing-investigator.json"]
    write_json(world_state_path, world_state)
    state_path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    investigator_state = json.loads(state_path.read_text())
    investigator_state["character_ref"] = "sandbox/.coc/investigators/missing-investigator/character.json"
    write_json(state_path, investigator_state)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "campaign_save_integrity_missing")
    assert finding["run_id"] == run_id
    assert "world-state investigator_state_refs do not match party investigator ids" in finding["missing_evidence"]
    assert "world-state investigator_state_refs do not resolve" in finding["missing_evidence"]
    assert "investigator-state character_ref does not resolve" in finding["missing_evidence"]


def test_completion_audit_fails_when_investigator_state_values_are_stale(tmp_path):
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
    run_id = "v2-haunting-module"
    investigator_id = f"{run_id}-investigator"
    campaign_dir = tmp_path / ".coc" / "playtests" / run_id / "sandbox" / ".coc" / "campaigns" / run_id
    event_rows = read_jsonl(campaign_dir / "logs" / "events.jsonl")
    for row in event_rows:
        if row.get("type") == "status" and row.get("actor") == investigator_id:
            row["payload"]["final_hp"] = 7
            row["payload"]["final_san"] = 44
    write_jsonl(campaign_dir / "logs" / "events.jsonl", event_rows)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "campaign_save_integrity_missing")
    assert finding["run_id"] == run_id
    assert "investigator-state current_hp does not match latest status final_hp" in finding["missing_evidence"]
    assert "investigator-state current_san does not match latest status final_san" in finding["missing_evidence"]


def test_completion_audit_fails_when_player_view_current_state_is_stale(tmp_path):
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
    run_id = "v2-haunting-module"
    player_view_path = tmp_path / ".coc" / "playtests" / run_id / "player-view.jsonl"
    player_view = read_jsonl(player_view_path)
    for row in player_view:
        if row.get("type") == "public_character_state":
            row["investigators"][0]["current_state"]["current_hp"] = 7
            row["investigators"][0]["current_state"]["current_san"] = 44
    write_jsonl(player_view_path, player_view)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "player_view_current_state_stale")
    assert finding["run_id"] == run_id
    assert "player-view current_hp does not match campaign save current_hp" in finding["missing_evidence"]
    assert "player-view current_san does not match campaign save current_san" in finding["missing_evidence"]


def test_completion_audit_fails_when_investigator_skill_checks_disagree_with_development(tmp_path):
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
    run_id = "v2-haunting-module"
    investigator_id = f"{run_id}-investigator"
    run_dir = tmp_path / ".coc" / "playtests" / run_id
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / run_id
    state_path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    investigator_state = json.loads(state_path.read_text())
    investigator_state["skill_checks_earned"] = ["Spot Hidden", "DEX"]
    write_json(state_path, investigator_state)
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id
    write_jsonl(investigator_dir / "development.jsonl", [
        {"campaign_id": run_id, "status": "pending_player_rolls", "skill_checks_earned": ["Spot Hidden"]},
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "campaign_save_integrity_missing")
    assert finding["run_id"] == run_id
    assert "investigator-state skill_checks_earned does not match development skill_checks_earned" in finding["missing_evidence"]


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


def test_completion_audit_fails_when_creation_finances_lack_cash_assets_and_spending_level(tmp_path):
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
    creation_path = (
        tmp_path
        / ".coc"
        / "playtests"
        / "v2-haunting-module"
        / "sandbox"
        / ".coc"
        / "investigators"
        / "v2-haunting-module-investigator"
        / "creation.json"
    )
    creation = json.loads(creation_path.read_text())
    creation["finances"] = {
        "credit_rating": 40,
        "living_standard": "Average",
    }
    write_json(creation_path, creation)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v2-haunting-module"
    assert "sandbox/.coc/investigators/v2-haunting-module-investigator/creation.json" in finding["incomplete_files"]
    assert "investigator finance cash" in finding["missing_evidence"]
    assert "investigator finance assets" in finding["missing_evidence"]
    assert "investigator finance spending level" in finding["missing_evidence"]


def test_completion_audit_fails_when_creation_finances_do_not_match_rulebook_table(tmp_path):
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
    creation_path = (
        tmp_path
        / ".coc"
        / "playtests"
        / "v2-haunting-module"
        / "sandbox"
        / ".coc"
        / "investigators"
        / "v2-haunting-module-investigator"
        / "creation.json"
    )
    creation = json.loads(creation_path.read_text())
    creation["finances"]["assets"]["amount"] = 999
    write_json(creation_path, creation)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v2-haunting-module"
    assert "sandbox/.coc/investigators/v2-haunting-module-investigator/creation.json" in finding["incomplete_files"]
    assert "investigator finance assets rulebook value" in finding["missing_evidence"]


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


def test_completion_audit_fails_when_player_view_spoiler_protocol_exposes_scope(tmp_path):
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
    player_view = read_jsonl(run_dir / "player-view.jsonl")
    player_view.append({
        "view": "player",
        "type": "transcript_turn",
        "turn": "13b",
        "role": "keeper_under_test",
        "mode": "meta",
        "text": "这会剧透。你确认要看吗？",
        "spoiler_protocol": {
            "spoiler_id": "fixture-spoiler-reveal",
            "stage": "warning_issued",
            "scope": "fixture_secret_scope",
            "requires_confirmation": True,
        },
    })
    write_jsonl(run_dir / "player-view.jsonl", player_view)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "player_view_secret_leak")
    assert finding["run_id"] == "v4-multi-profile-pressure"
    assert "spoiler_protocol.scope on turn 13b" in finding["missing_evidence"]


def test_completion_audit_fails_when_player_view_roll_text_is_not_localized(tmp_path):
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
        {"view": "player", "type": "public_character_state", "campaign_id": "v2-haunting-module"},
        {"view": "player", "type": "transcript_turn", "turn": 2, "role": "player_simulator", "text": "fixture player turn"},
        {
            "view": "player",
            "type": "transcript_turn",
            "turn": 6,
            "role": "system",
            "mode": "roll",
            "roll_count": 2,
            "text": "Spot Hidden 33 vs 55 -> regular_success. Spot Hidden 22 vs 55 -> hard_success.",
        },
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "player_view_roll_text_not_localized")
    assert finding["run_id"] == "v2-haunting-module"
    assert finding["missing_player_view_roll_samples"] == [
        "Spot Hidden：艾达·金掷出 33 / 55，结果普通成功；Spot Hidden：艾达·金掷出 22 / 55，结果困难成功。"
    ]


def test_completion_audit_fails_when_player_view_public_state_leaks_canonical_terms(tmp_path):
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
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["localized_terms"]["zh-Hans"].update({
        "Fixture Scenario": "《夹具剧本》",
        "Antiquarian": "古物学者",
        "Spot Hidden": "侦查",
    })
    write_json(metadata_path, metadata)
    player_view = [
        row
        for row in read_jsonl(run_dir / "player-view.jsonl")
        if row.get("type") != "public_character_state"
    ]
    write_jsonl(run_dir / "player-view.jsonl", [
        {
            "view": "player",
            "type": "public_character_state",
            "campaign_id": "v2-haunting-module",
            "scenario": {"title": "Fixture Scenario"},
            "investigators": [
                {"name": "Ada King", "occupation": "Antiquarian", "skills": {"Spot Hidden": 55}},
            ],
        },
        *player_view,
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "player_view_public_state_not_localized")
    assert finding["run_id"] == "v2-haunting-module"
    assert set(finding["leaked_public_state_terms"]) == {"Fixture Scenario", "Ada King", "Antiquarian", "Spot Hidden"}


def test_completion_audit_fails_when_player_view_public_state_leaks_english_for_zh_hans(tmp_path):
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
    player_view = [
        row
        for row in read_jsonl(run_dir / "player-view.jsonl")
        if row.get("type") != "public_character_state"
    ]
    write_jsonl(run_dir / "player-view.jsonl", [
        {
            "view": "player",
            "type": "public_character_state",
            "campaign_id": "v2-haunting-module",
            "scenario": {
                "title": "《夹具剧本》",
                "player_safe_summary": "An old house asks for careful research.",
                "current_phase": "opening_phase",
            },
            "investigators": [
                {"name": "艾达·金", "occupation": "古物学者", "skills": {"侦查": 55}},
            ],
        },
        *player_view,
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "player_view_public_state_not_localized")
    assert finding["run_id"] == "v2-haunting-module"
    assert {"house", "careful", "research", "opening_phase"}.issubset(set(finding["english_public_state_tokens"]))


def test_completion_audit_fails_when_player_view_public_state_derived_keys_are_not_localized(tmp_path):
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
    player_view = [
        row
        for row in read_jsonl(run_dir / "player-view.jsonl")
        if row.get("type") != "public_character_state"
    ]
    write_jsonl(run_dir / "player-view.jsonl", [
        {
            "view": "player",
            "type": "public_character_state",
            "campaign_id": "v2-haunting-module",
            "scenario": {"title": "《夹具剧本》"},
            "investigators": [
                {
                    "name": "艾达·金",
                    "occupation": "古物学者",
                    "skills": {"侦查": 55},
                    "derived": {"HP": 12, "damage_bonus": "0", "build": 0},
                },
            ],
        },
        *player_view,
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "player_view_public_state_not_localized")
    assert finding["run_id"] == "v2-haunting-module"
    assert {"damage_bonus", "build"}.issubset(set(finding["english_public_state_tokens"]))


def test_completion_audit_fails_when_player_view_transcript_speakers_are_not_localized(tmp_path):
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
    player_view = read_jsonl(run_dir / "player-view.jsonl")
    write_jsonl(run_dir / "player-view.jsonl", [
        {
            **row,
            "speaker": "Ada King" if row.get("type") == "transcript_turn" else row.get("speaker"),
        }
        for row in player_view
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "player_view_speaker_not_localized")
    assert finding["run_id"] == "v2-haunting-module"
    assert "Ada King" in finding["leaked_player_view_speakers"]
    assert {"Ada", "King"}.issubset(set(finding["english_player_view_speaker_tokens"]))


def test_completion_audit_fails_when_source_transcript_lacks_localized_display_fields(tmp_path):
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
    transcript = read_jsonl(run_dir / "transcript.jsonl")
    write_jsonl(run_dir / "transcript.jsonl", [
        {
            key: value
            for key, value in row.items()
            if key not in {"speaker_display", "text_display"}
        }
        for row in transcript
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "transcript_display_not_localized")
    assert finding["run_id"] == "v2-haunting-module"
    assert "turn 2 speaker_display" in finding["missing_transcript_display_fields"]
    assert "turn 6 text_display" in finding["missing_transcript_display_fields"]
    assert "Spot Hidden：艾达·金掷出 33 / 55，结果普通成功；Spot Hidden：艾达·金掷出 22 / 55，结果困难成功。" in finding["missing_transcript_roll_samples"]


def test_completion_audit_fails_when_source_transcript_display_leaks_protocol_wrappers(tmp_path):
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
    transcript = read_jsonl(run_dir / "transcript.jsonl")
    for row in transcript:
        if row.get("turn") == 20:
            row["text"] = "[meta] fixture meta player question [/meta]"
            row["text_display"] = "[meta] fixture meta player question [/meta]"
    write_jsonl(run_dir / "transcript.jsonl", transcript)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "transcript_display_not_localized")
    assert finding["run_id"] == "v2-haunting-module"
    assert "turn 20 text_display protocol_wrapper" in finding["missing_transcript_display_fields"]


def test_completion_audit_fails_when_source_transcript_display_leaks_canonical_terms(tmp_path):
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
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["localized_terms"]["zh-Hans"]["Spot Hidden"] = "侦查"
    write_json(metadata_path, metadata)

    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "transcript_display_not_localized")
    assert finding["run_id"] == "v2-haunting-module"
    assert "Spot Hidden" in finding["leaked_transcript_display_terms"]


def test_completion_audit_fails_when_source_transcript_localized_text_leaks_canonical_terms(tmp_path):
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
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["localized_terms"]["zh-Hans"]["Climb"] = "攀爬"
    write_json(metadata_path, metadata)
    transcript = read_jsonl(run_dir / "transcript.jsonl")
    transcript[0]["localized_text"] = {"zh-Hans": {"ruling": "Climb 普通难度"}}
    transcript[0]["ruling_display"] = "攀爬普通难度"
    write_jsonl(run_dir / "transcript.jsonl", transcript)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "transcript_localized_text_not_localized")
    assert finding["run_id"] == "v2-haunting-module"
    assert finding["leaked_transcript_localized_text_terms"] == ["Climb"]


def test_completion_audit_fails_when_player_view_transcript_details_lack_display_values(tmp_path):
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
    player_view = read_jsonl(run_dir / "player-view.jsonl")
    write_jsonl(run_dir / "player-view.jsonl", [
        {
            **row,
            "intent": "investigate",
            "intent_display": "investigate",
            "localized_text": {"zh-Hans": {"intent": "调查线索"}},
        }
        if row.get("type") == "transcript_turn" and row.get("role") == "player_simulator"
        else row
        for row in player_view
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "player_view_transcript_details_not_localized")
    assert finding["run_id"] == "v2-haunting-module"
    assert finding["unlocalized_player_view_details"] == ["turn 2 intent"]


def test_completion_audit_fails_when_player_view_localized_text_leaks_canonical_terms(tmp_path):
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
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["localized_terms"]["zh-Hans"]["Spot Hidden"] = "侦查"
    write_json(metadata_path, metadata)
    player_view = read_jsonl(run_dir / "player-view.jsonl")
    write_jsonl(run_dir / "player-view.jsonl", [
        {
            **row,
            "ruling": "spot_hidden_regular",
            "ruling_display": "侦查普通难度",
            "localized_text": {"zh-Hans": {"ruling": "Spot Hidden 普通难度"}},
        }
        if row.get("type") == "transcript_turn" and row.get("role") == "player_simulator"
        else row
        for row in player_view
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "player_view_localized_text_not_localized")
    assert finding["run_id"] == "v2-haunting-module"
    assert finding["leaked_player_view_localized_text_terms"] == ["Spot Hidden"]


def test_completion_audit_fails_when_player_view_text_leaks_protocol_wrappers(tmp_path):
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
    player_view = read_jsonl(run_dir / "player-view.jsonl")
    write_jsonl(run_dir / "player-view.jsonl", [
        {
            **row,
            "text": "[meta] fixture player-visible rules question [/meta]",
        }
        if row.get("type") == "transcript_turn" and row.get("role") == "player_simulator"
        else row
        for row in player_view
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "player_view_protocol_wrapper_leak")
    assert finding["run_id"] == "v2-haunting-module"
    assert finding["leaked_player_view_protocol_wrappers"] == ["[meta]", "[/meta]"]
    assert finding["player_view_protocol_wrapper_samples"] == [
        "turn 2 text: [meta] fixture player-visible rules question [/meta]"
    ]


def test_completion_audit_fails_when_player_profile_display_values_are_missing(tmp_path):
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
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["player_profile_labels"] = {
        "zh-Hans": {
            "careful_investigator": "谨慎调查员",
            "reckless_investigator": "鲁莽调查员",
            "skeptical_rules_lawyer": "规则质疑玩家",
        }
    }
    write_json(metadata_path, metadata)
    player_view = read_jsonl(run_dir / "player-view.jsonl")
    write_jsonl(run_dir / "player-view.jsonl", [
        *player_view,
        {
            "view": "player",
            "type": "transcript_turn",
            "turn": 7,
            "role": "player_simulator",
            "speaker": "玩家[谨慎调查员]",
            "mode": "play",
            "player_profile": "careful_investigator",
            "text": "fixture careful profile visible turn",
        },
    ])
    feedback_rows = read_jsonl(run_dir / "player-feedback.jsonl")
    write_jsonl(run_dir / "player-feedback.jsonl", [
        {**row, "player_profile_display": row["player_profile"]}
        if row.get("player_profile") == "careful_investigator"
        else row
        for row in feedback_rows
    ])
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "player_profile_display_not_localized")
    assert finding["run_id"] == "v4-multi-profile-pressure"
    assert "careful_investigator" in finding["unlocalized_player_profile_displays"]


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
    assert "haunting_module event type resource_change" in by_run["v2-haunting-module"]["missing_evidence"]
    assert "haunting_module event type sanity" in by_run["v2-haunting-module"]["missing_evidence"]
    assert "haunting_module event type status" in by_run["v2-haunting-module"]["missing_evidence"]
    assert "haunting_module event type session_ending" in by_run["v2-haunting-module"]["missing_evidence"]
    assert "chase_drill event type chase" in by_run["v3-chase-drill"]["missing_evidence"]
    assert "chase_drill event type item_transfer" in by_run["v3-chase-drill"]["missing_evidence"]
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


def test_completion_audit_reads_pushed_roll_stages_from_rules_json(monkeypatch, tmp_path):
    def fake_pushed_roll_rule():
        return {
            "maximum_attempts_after_initial_failure": 1,
            "requires_changed_approach": True,
            "requires_keeper_foreshadowed_failure": True,
            "requires_keeper_owned_failure_consequence": True,
            "requires_player_confirmation": True,
            "required_stages": [
                "player_reframes_action",
                "keeper_foreshadows_failure",
                "keeper_restates_risk",
                "player_confirms_risk",
                "roll_resolved",
            ],
        }

    monkeypatch.setattr(coc_completion_audit, "pushed_roll_rule", fake_pushed_roll_rule, raising=False)

    run_dir = tmp_path / "run"
    campaign_dir = tmp_path / "campaign"
    pushed_roll_id = "fixture-pushed-roll"
    write_jsonl(run_dir / "transcript.jsonl", [
        {"turn": 1, "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "player_reframes_action"}},
        {"turn": 2, "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "keeper_foreshadows_failure", "failure_consequence_source": "keeper"}},
        {"turn": 3, "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "player_confirms_risk", "risk_confirmed": True}},
        {"turn": 4, "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "roll_resolved"}},
    ])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {
            "type": "roll",
            "payload": {
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

    findings = coc_completion_audit._pushed_roll_structure_findings(
        "fixture-run",
        run_dir,
        campaign_dir,
        "sandbox/.coc/campaigns/fixture-run/",
        "haunting_module",
    )

    assert findings
    assert findings[0]["code"] == "active_run_source_files_incomplete"
    assert "pushed roll transcript protocol" in findings[0]["missing_evidence"]


def test_completion_audit_fails_when_pushed_roll_transcript_stages_have_wrong_roles(tmp_path):
    run_dir = tmp_path / "run"
    campaign_dir = tmp_path / "campaign"
    pushed_roll_id = "fixture-pushed-roll"
    write_jsonl(run_dir / "transcript.jsonl", [
        {
            "turn": 1,
            "role": "player_simulator",
            "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "player_reframes_action"},
        },
        {
            "turn": 2,
            "role": "player_simulator",
            "pushed_roll_protocol": {
                "roll_id": pushed_roll_id,
                "stage": "keeper_foreshadows_failure",
                "failure_consequence_source": "keeper",
            },
        },
        {
            "turn": 3,
            "role": "keeper_under_test",
            "pushed_roll_protocol": {
                "roll_id": pushed_roll_id,
                "stage": "player_confirms_risk",
                "risk_confirmed": True,
            },
        },
        {
            "turn": 4,
            "role": "system",
            "pushed_roll_protocol": {"roll_id": pushed_roll_id, "stage": "roll_resolved"},
        },
    ])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {
            "type": "roll",
            "payload": {
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

    findings = coc_completion_audit._pushed_roll_structure_findings(
        "fixture-run",
        run_dir,
        campaign_dir,
        "sandbox/.coc/campaigns/fixture-run/",
        "haunting_module",
    )

    assert findings
    assert findings[0]["code"] == "active_run_source_files_incomplete"
    assert "pushed roll transcript stage roles" in findings[0]["missing_evidence"]


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


def test_completion_audit_fails_when_required_spoiler_protocol_is_missing(tmp_path):
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
    rows = [
        {key: value for key, value in row.items() if key != "spoiler_protocol"}
        for row in read_jsonl(run_dir / "transcript.jsonl")
    ]
    write_jsonl(run_dir / "transcript.jsonl", rows)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "spoiler_reveal_protocol_missing")
    assert finding["run_id"] == "v4-multi-profile-pressure"
    assert "transcript.jsonl" in finding["incomplete_files"]
    assert "spoiler warning stage" in finding["missing_evidence"]
    assert "spoiler player confirmation stage" in finding["missing_evidence"]
    assert "spoiler limited reveal stage" in finding["missing_evidence"]


def test_completion_audit_fails_when_spoiler_audit_log_is_missing(tmp_path):
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
    campaign_dir = tmp_path / ".coc" / "playtests" / "v4-multi-profile-pressure" / "sandbox" / ".coc" / "campaigns" / "v4-multi-profile-pressure"
    (campaign_dir / "logs" / "audit.jsonl").unlink()
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "spoiler_reveal_audit_missing")
    assert finding["run_id"] == "v4-multi-profile-pressure"
    assert "sandbox/.coc/campaigns/v4-multi-profile-pressure/logs/audit.jsonl" in finding["incomplete_files"]
    assert "spoiler audit log reveal" in finding["missing_evidence"]


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


def test_completion_audit_accepts_protocol_wrapped_dialogue_rendered_without_wrappers(tmp_path):
    run_dir = tmp_path / "run"
    write_jsonl(run_dir / "transcript.jsonl", [
        {"role": "player_simulator", "text": "[meta] fixture meta turn [/meta]"},
        {"role": "keeper_under_test", "text": "[spoiler_warning] fixture spoiler warning [/spoiler_warning]"},
    ])
    battle_report = "\n".join([
        "## Actual Play Replay <!-- report-anchor: Actual Play Replay -->",
        "- fixture meta turn",
        "- fixture spoiler warning",
        "",
        "## Session Transcript <!-- report-anchor: Session Transcript -->",
        "- fixture meta turn",
        "- fixture spoiler warning",
    ])

    findings = coc_completion_audit._battle_report_source_dialogue_findings("run", run_dir, battle_report)

    assert findings == []


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


def test_completion_audit_fails_when_roll_lines_are_only_html_comments(tmp_path):
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
        battle_report_with_roll_results_only_in_html_comments(),
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


def test_completion_audit_fails_when_battle_report_omits_rule_refs(tmp_path):
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
    battle_report_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "battle-report.md"
    write_text(
        battle_report_path,
        battle_report_path.read_text().replace(
            "\n  - Rule Refs: core.percentile_check, core.success_level, core.difficulty.regular",
            "",
        ).replace(
            "\n  - Rule Refs: core.percentile_check, core.success_level, core.difficulty.regular, core.pushed_roll",
            "",
        ),
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    finding = next(finding for finding in audit["findings"] if finding["code"] == "battle_report_rule_refs_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "core.percentile_check, core.success_level, core.difficulty.regular" in finding["missing_rule_ref_samples"]


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


def test_completion_audit_fails_when_event_summaries_are_outside_scene_and_state_sections(tmp_path):
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
        battle_report_with_events_only_outside_scene_and_state_sections(),
    )
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


def test_completion_audit_fails_when_battle_report_omits_source_handouts(tmp_path):
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
    write_text(run_dir / "artifacts" / "battle-report.md", battle_report_without_handout_records())
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "battle_report_handouts_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "Fixture handout title" in finding["missing_handout_samples"]


def test_completion_audit_fails_when_source_handout_lacks_player_visible_summary(tmp_path):
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
    write_json(run_dir / "sandbox" / ".coc" / "campaigns" / "v2-haunting-module" / "scenario" / "handouts.json", [
        {"id": "fixture-handout", "title": "Fixture handout title"},
    ])
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "source_handout_summary_missing")
    assert finding["run_id"] == "v2-haunting-module"
    assert "fixture-handout" in finding["handout_ids_missing_summary"]


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


def test_completion_audit_fails_when_feedback_text_is_outside_feedback_section(tmp_path):
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
    write_text(
        run_dir / "artifacts" / "battle-report.md",
        battle_report_with_feedback_only_outside_feedback_section(),
    )
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


def test_completion_audit_fails_when_battle_report_omits_source_feedback_scores(tmp_path):
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
    write_text(run_dir / "artifacts" / "battle-report.md", battle_report_with_feedback_text_but_without_scores())
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "battle_report_feedback_score_missing")
    assert finding["run_id"] == "v4-multi-profile-pressure"
    assert "fixture careful feedback" in finding["missing_feedback_score_samples"]
    assert "fixture reckless feedback" in finding["missing_feedback_score_samples"]


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


def test_completion_audit_fails_when_memory_summary_is_outside_story_recap(tmp_path):
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
        battle_report_with_memory_only_outside_story_recap(),
    )
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


def test_completion_audit_fails_when_chronicle_records_are_outside_chronicle_section(tmp_path):
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
        battle_report_with_chronicle_only_outside_chronicle_section(),
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
    assert "Characteristic Half/Fifth Values: STR 30/12, DEX 25/10" in finding["missing_creation_samples"]
    assert "Age: 32（20-39 岁）" in finding["missing_creation_samples"]
    assert "Age Adjustments: EDU 成长检定 1 次；本次 42 / 75，未提升；属性无降低。" in finding["missing_creation_samples"]
    assert "EDU x 4 = 300" in finding["missing_creation_samples"]
    assert "Skill Half/Fifth Values: Library Use 30/12, Spot Hidden 27/11" in finding["missing_creation_samples"]
    assert "Spot Hidden: Base 25 + Occupation 30 + Personal Interest 0 = 55" in finding["missing_creation_samples"]


def test_completion_audit_accepts_localized_creation_allocation_labels(tmp_path):
    creation = {
        "skill_allocation": {
            "skills": {
                "Spot Hidden": {
                    "base": 25,
                    "occupation_points": 30,
                    "personal_interest_points": 0,
                    "final": 55,
                },
            },
        },
    }
    metadata = {
        "play_language": "zh-Hans",
        "localized_terms": {"zh-Hans": {"Spot Hidden": "侦查"}},
        "language_profile": {
            "creation_labels": {
                "Occupation": "职业",
                "Base": "基础",
                "Personal Interest": "个人兴趣",
            },
        },
    }

    required = coc_completion_audit._creation_required_texts(creation, metadata)

    assert "侦查: 基础 25 + 职业 30 + 个人兴趣 0 = 55" in required
    assert "Spot Hidden: base 25 + Occupation 30 + Personal Interest 0 = 55" not in required


def test_completion_audit_fails_when_battle_report_omits_investigator_finance_records(tmp_path):
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
    battle_report = battle_report_fixture()
    for line in [
        "- Living Standard: 普通\n",
        "- Cash: 80 美元\n",
        "- Assets: 2000 美元\n",
        "- Spending Level: 10 美元\n",
    ]:
        battle_report = battle_report.replace(line, "")
    write_text(run_dir / "artifacts" / "battle-report.md", battle_report)
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
    assert "Living Standard: 普通" in finding["missing_creation_samples"]
    assert "Cash: 80 美元" in finding["missing_creation_samples"]
    assert "Assets: 2000 美元" in finding["missing_creation_samples"]
    assert "Spending Level: 10 美元" in finding["missing_creation_samples"]


def test_completion_audit_fails_when_creation_records_are_outside_creation_section(tmp_path):
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
        battle_report_with_creation_only_outside_creation_section(),
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
    assert "Characteristic Half/Fifth Values: STR 30/12, DEX 25/10" in finding["missing_creation_samples"]
    assert "Age: 32（20-39 岁）" in finding["missing_creation_samples"]
    assert "EDU x 4 = 300" in finding["missing_creation_samples"]
    assert "Skill Half/Fifth Values: Library Use 30/12, Spot Hidden 27/11" in finding["missing_creation_samples"]


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


def test_completion_audit_fails_when_chase_tracker_state_is_outside_chase_tracker_section(tmp_path):
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
        battle_report_with_chase_tracker_only_outside_chase_tracker_section(),
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
    assert "quarry escapes" in finding["missing_chase_samples"]


def test_completion_audit_fails_when_chase_transcript_conflicts_with_saved_position(tmp_path):
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
    playtest_path = run_dir / "playtest.json"
    playtest = json.loads(playtest_path.read_text())
    playtest["localized_terms"]["zh-Hans"].update({
        "Nathaniel Crowe": "内森尼尔·克劳",
        "fixture barrier": "上锁屋顶门",
        "fixture finish": "晾衣屋顶",
        "quarry escapes": "被追者逃脱",
    })
    write_json(playtest_path, playtest)
    conflicting_turn = {
        "turn": 22,
        "role": "keeper_under_test",
        "speaker": "KP",
        "mode": "play",
        "text": "被追者逃脱。内森尼尔·克劳从晾衣屋顶另一头冲过去，没有看见你。",
    }
    transcript = read_jsonl(run_dir / "transcript.jsonl")
    transcript.append(conflicting_turn)
    write_jsonl(run_dir / "transcript.jsonl", transcript)
    write_text(
        run_dir / "artifacts" / "battle-report.md",
        battle_report_fixture().replace(
            "- fixture meta keeper answer",
            "- fixture meta keeper answer\n- 被追者逃脱。内森尼尔·克劳从晾衣屋顶另一头冲过去，没有看见你。",
        ),
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(
        finding for finding in audit["findings"]
        if finding["code"] == "chase_transcript_position_conflict"
    )
    assert finding["run_id"] == "v3-chase-drill"
    assert finding["participant_id"] == "fixture-pursuer"
    assert finding["expected_position"] == "fixture-barrier"
    assert finding["conflicting_position"] == "fixture-finish"
    assert "内森尼尔·克劳从晾衣屋顶另一头冲过去" in finding["conflicting_text_samples"][0]


def test_completion_audit_accepts_localized_chase_difficulty_labels(tmp_path):
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
    playtest = json.loads((run_dir / "playtest.json").read_text())
    playtest["language_profile"]["difficulty_labels"] = {"regular": "普通"}
    write_json(run_dir / "playtest.json", playtest)
    write_text(
        run_dir / "artifacts" / "battle-report.md",
        battle_report_with_localized_chase_difficulty(),
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "pass"


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
    assert "Characteristic Half/Fifth Values: STR 30/12, DEX 25/10" in finding["missing_character_samples"]
    assert "Spot Hidden: 55" in finding["missing_character_samples"]
    assert "Skill Half/Fifth Values: Library Use 30/12, Spot Hidden 27/11" in finding["missing_character_samples"]
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


def test_completion_audit_fails_when_multi_profile_rulebook_audit_lacks_protocol_evidence(tmp_path):
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
    write_text(automation_path, 'status = "ACTIVE"\n')
    write_text(
        tmp_path / ".coc" / "playtests" / "v4-multi-profile-pressure" / "artifacts" / "rulebook-audit.md",
        rulebook_audit_fixture(),
    )

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    finding = next(
        finding for finding in audit["findings"]
        if finding["code"] == "rulebook_audit_positive_evidence_missing"
    )
    assert finding["run_id"] == "v4-multi-profile-pressure"
    assert "multi_profile_pressure rulebook-audit profile careful_investigator" in finding["missing_evidence"]
    assert "multi_profile_pressure rulebook-audit pushed protocol v4-multi-profile-pressure-pushed-roll" in finding["missing_evidence"]
    assert "multi_profile_pressure rulebook-audit spoiler protocol fixture-spoiler-reveal" in finding["missing_evidence"]


def test_completion_audit_fails_when_chase_rulebook_audit_lacks_state_evidence(tmp_path):
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
    write_text(automation_path, 'status = "ACTIVE"\n')
    write_text(
        tmp_path / ".coc" / "playtests" / "v3-chase-drill" / "artifacts" / "rulebook-audit.md",
        rulebook_audit_fixture(),
    )

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    finding = next(
        finding for finding in audit["findings"]
        if finding["code"] == "rulebook_audit_positive_evidence_missing"
    )
    assert finding["run_id"] == "v3-chase-drill"
    assert "chase_drill rulebook-audit chase state field participants" in finding["missing_evidence"]
    assert "chase_drill rulebook-audit chase state field location_chain" in finding["missing_evidence"]
    assert "chase_drill rulebook-audit player profile skeptical_rules_lawyer" in finding["missing_evidence"]


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


def test_completion_audit_flags_suite_matrix_refs_to_non_evaluated_runs(tmp_path):
    active_runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    old_run = {"run_id": "old-baseline", "audit_profile": "baseline", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"}
    for run in active_runs + [old_run]:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, active_runs)
    index_path = tmp_path / ".coc" / "playtests" / "index.json"
    loop_path = tmp_path / ".coc" / "playtests" / "loop-decision.json"
    index = json.loads(index_path.read_text())
    loop_decision = json.loads(loop_path.read_text())
    index["runs"].append(old_run)
    index["coverage"]["chase"]["runs"] = ["old-baseline"]
    index["coverage"]["chase"]["reasons"] = {"old-baseline": "stale baseline chase evidence"}
    index["quality"]["actual_play_replay"]["runs"] = ["old-baseline"]
    index["quality"]["actual_play_replay"]["scores"] = {"old-baseline": 5}
    index["quality"]["actual_play_replay"]["reasons"] = {"old-baseline": "stale baseline actual-play score"}
    loop_decision["evaluated_runs"] = [run["run_id"] for run in active_runs]
    loop_decision["ignored_historical_runs"] = ["old-baseline"]
    index["loop_decision"] = loop_decision
    write_json(index_path, index)
    write_json(loop_path, loop_decision)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "suite_matrix_references_non_evaluated_run"
        and finding["matrix"] == "coverage"
        and finding["key"] == "chase"
        and finding["non_evaluated_runs"] == ["old-baseline"]
        for finding in audit["findings"]
    )
    assert any(
        finding["code"] == "suite_matrix_references_non_evaluated_run"
        and finding["matrix"] == "quality"
        and finding["key"] == "actual_play_replay"
        and finding["non_evaluated_runs"] == ["old-baseline"]
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


def test_completion_audit_fails_when_multi_profile_transcript_lacks_intent_evidence(tmp_path):
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
    transcript = read_jsonl(run_dir / "transcript.jsonl")
    for row in transcript:
        if row.get("player_profile") == "skeptical_rules_lawyer":
            row.pop("intent", None)
            row.pop("intent_display", None)
    write_jsonl(run_dir / "transcript.jsonl", transcript)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    finding = next(finding for finding in audit["findings"] if finding["code"] == "active_run_source_files_incomplete")
    assert finding["run_id"] == "v4-multi-profile-pressure"
    assert "multi_profile_pressure transcript intent evidence skeptical_rules_lawyer" in finding["missing_evidence"]


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
        "report_labels": {
            "roll_sentence": "- {skill}：{actor}は {roll} / {target} を振り、結果は{outcome}。",
        },
        "outcome_labels": {
            "regular_success": "レギュラー成功",
            "hard_success": "ハード成功",
        },
        "speaker_labels": {
            "keeper": "KP",
            "player": "プレイヤー",
            "system": "システム",
        },
        "creation_labels": {
            "Age": "年齢",
            "Age Adjustments": "年齢調整",
        },
    }
    metadata["localized_terms"] = {"ja-JP": {"Ada King": "エイダ・キング"}}
    write_json(metadata_path, metadata)
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    battle_report_path = run_dir / "artifacts" / "battle-report.md"
    battle_report = battle_report_path.read_text()
    battle_report = battle_report.replace("- Age: 32（20-39 岁）", "- 年齢: 32（20-39歳）")
    battle_report = battle_report.replace(
        "- Age Adjustments: EDU 成长检定 1 次；本次 42 / 75，未提升；属性无降低。",
        "- 年齢調整: EDU成長判定 1 回；今回は 42 / 75、上昇なし；能力値低下なし。",
    )
    battle_report = battle_report.replace("- Living Standard: 普通", "- Living Standard: 平均")
    battle_report = battle_report.replace("- Cash: 80 美元", "- Cash: 80 ドル")
    battle_report = battle_report.replace("- Assets: 2000 美元", "- Assets: 2000 ドル")
    battle_report = battle_report.replace("- Spending Level: 10 美元", "- Spending Level: 10 ドル")
    write_text(battle_report_path, battle_report)
    transcript = read_jsonl(run_dir / "transcript.jsonl")
    write_jsonl(run_dir / "transcript.jsonl", [
        {
            **row,
            "speaker_display": (
                "プレイヤー"
                if row.get("role") == "player_simulator"
                else "システム"
                if row.get("role") == "system"
                else "KP"
            ),
            **(
                {
                    "text_display": "Spot Hidden：エイダ・キングは 33 / 55 を振り、結果はレギュラー成功；Spot Hidden：エイダ・キングは 22 / 55 を振り、結果はハード成功。"
                }
                if row.get("mode") == "roll"
                else {}
            ),
        }
        for row in transcript
    ])
    write_jsonl(run_dir / "player-view.jsonl", [
        {
            "view": "player",
            "type": "public_character_state",
            "campaign_id": "v2-haunting-module",
            "investigators": [
                {
                    "investigator_id": "v2-haunting-module-investigator",
                    "name": "エイダ・キング",
                    "current_state": {
                        "current_hp": 12,
                        "current_san": 55,
                        "current_mp": 11,
                        "conditions": [],
                    },
                },
            ],
        },
        {"view": "player", "type": "transcript_turn", "turn": 2, "role": "player_simulator", "text": "fixture player turn"},
        {
            "view": "player",
            "type": "transcript_turn",
            "turn": 6,
            "role": "system",
            "mode": "roll",
            "roll_count": 2,
            "text": "Spot Hidden：エイダ・キングは 33 / 55 を振り、結果はレギュラー成功；Spot Hidden：エイダ・キングは 22 / 55 を振り、結果はハード成功。",
        },
    ])
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


def test_completion_audit_fails_when_semantic_reviewed_artifact_is_not_request(tmp_path):
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
    semantic["evaluation_provenance"]["reviewed_artifact"] = "artifacts/battle-report.md"
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_reviewed_artifact_mismatch"
        and finding["run_id"] == "v2-haunting-module"
        for finding in audit["findings"]
    )


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


def test_completion_audit_fails_when_semantic_request_omits_scenario_source(tmp_path):
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
    malformed_request["inputs"].pop("scenario")
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
        and "inputs.scenario" in finding["missing_fields"]
        for finding in audit["findings"]
    )
