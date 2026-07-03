#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


Finding = dict[str, Any]

HAUNTING_MODULE_COVERAGE = [
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

HAUNTING_MODULE_SUBSYSTEMS = [
    "investigation",
    "social",
    "pushed_roll",
    "sanity",
    "damage",
    "combat",
]

HAUNTING_REPORT_MOMENTS = [
    "Mr. Knott",
    "Arty Wilmot",
    "Chapel of Contemplation",
    "The Old Corbitt Place",
    "Bed Attack",
    "The Floating Knife",
    "Corbitt's Hiding Place",
    "Corbitt Attacks",
    "Rewards",
]

CHASE_REPORT_MOMENTS = [
    "speed roll",
    "MOV",
    "movement actions",
    "location chain",
    "DEX order",
    "hazard",
    "barrier",
    "conflict",
    "quarry escapes",
]


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            events.append(json.loads(line))
    return events


def _read_jsonl_files(paths: list[Path]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for path in paths:
        events.extend(_read_jsonl(path))
    return events


def _campaign_dirs(run_dir: Path) -> list[Path]:
    campaigns_dir = run_dir / "sandbox" / ".coc" / "campaigns"
    if not campaigns_dir.exists():
        return []
    return sorted(path for path in campaigns_dir.iterdir() if path.is_dir())


def _select_campaign_dir(run_dir: Path, metadata: dict[str, Any]) -> Path | None:
    campaign_id = metadata.get("campaign_id") or metadata.get("run_id")
    if campaign_id:
        path = run_dir / "sandbox" / ".coc" / "campaigns" / str(campaign_id)
        if path.exists():
            return path
    campaign_dirs = _campaign_dirs(run_dir)
    return campaign_dirs[0] if campaign_dirs else None


def _load_context(run_dir: Path) -> dict[str, Any]:
    metadata = _read_json(run_dir / "playtest.json", {})
    campaign_dir = _select_campaign_dir(run_dir, metadata)
    scenario_dir = campaign_dir / "scenario" if campaign_dir else None
    logs_dir = campaign_dir / "logs" if campaign_dir else None
    memory_dir = campaign_dir / "memory" if campaign_dir else None
    save_dir = campaign_dir / "save" if campaign_dir else None
    return {
        "metadata": metadata,
        "campaign_dir": campaign_dir,
        "scenario": _read_json(scenario_dir / "scenario.json", {}) if scenario_dir else {},
        "clues": _read_json(scenario_dir / "clues.json", []) if scenario_dir else [],
        "locations": _read_json(scenario_dir / "locations.json", []) if scenario_dir else [],
        "npcs": _read_json(scenario_dir / "npcs.json", []) if scenario_dir else [],
        "timeline": _read_json(scenario_dir / "timeline.json", []) if scenario_dir else [],
        "transcript": _read_jsonl(run_dir / "transcript.jsonl"),
        "rolls": _read_jsonl(logs_dir / "rolls.jsonl") if logs_dir else [],
        "events": _read_jsonl(logs_dir / "events.jsonl") if logs_dir else [],
        "memory": _read_jsonl(memory_dir / "session-summaries.jsonl") if memory_dir else [],
        "feedback": _read_jsonl(run_dir / "player-feedback.jsonl"),
        "chase_state": _read_json(save_dir / "chase.json", {}) if save_dir else {},
        "battle_report": _read_text(run_dir / "artifacts" / "battle-report.md"),
    }


def _finding(code: str, cause: str, severity: str, evidence: str, recommendation: str) -> Finding:
    return {
        "code": code,
        "cause": cause,
        "severity": severity,
        "evidence": evidence,
        "blueprint_status": "designed_not_implemented",
        "recommendation": recommendation,
    }


def _nonempty_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _nonempty_list(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 0


def _player_intent_count(transcript: list[dict[str, Any]]) -> int:
    return sum(1 for event in transcript if event.get("role") == "player_simulator" and event.get("intent"))


def _keeper_ruling_count(transcript: list[dict[str, Any]]) -> int:
    return sum(1 for event in transcript if event.get("role") == "keeper_under_test" and event.get("ruling"))


def _event_type_count(events: list[dict[str, Any]], event_type: str) -> int:
    return sum(1 for event in events if event.get("type") == event_type)


def _roll_protocol_gaps(rolls: list[dict[str, Any]]) -> list[str]:
    missing: list[str] = []
    required_payload_fields = [
        "goal",
        "target",
        "effective_target",
        "difficulty",
        "difficulty_rationale",
        "outcome",
        "failure_consequence",
    ]
    if not rolls:
        return ["no rolls recorded"]
    for index, event in enumerate(rolls, start=1):
        payload = event.get("payload", {})
        for field in required_payload_fields:
            if payload.get(field) in (None, "", [], {}):
                missing.append(f"roll {index} missing {field}")
    return missing


def _has_pushed_roll(rolls: list[dict[str, Any]]) -> bool:
    return any(bool(event.get("payload", {}).get("pushed")) for event in rolls)


def _has_skill_check(rolls: list[dict[str, Any]]) -> bool:
    return any(bool(event.get("payload", {}).get("skill_check_earned")) for event in rolls)


def _report_contains_all(text: str, markers: list[str]) -> list[str]:
    return [marker for marker in markers if marker not in text]


def _haunting_module_required(metadata: dict[str, Any]) -> bool:
    return metadata.get("audit_profile") == "haunting_module"


def _chase_drill_required(metadata: dict[str, Any]) -> bool:
    return metadata.get("audit_profile") == "chase_drill"


def _payload_summaries(events: list[dict[str, Any]], event_type: str) -> list[str]:
    summaries: list[str] = []
    for event in events:
        if event.get("type") != event_type:
            continue
        payload = event.get("payload", {})
        summary = payload.get("summary") or payload.get("text") or ""
        summaries.append(str(summary))
    return summaries


def audit_run(run_dir: Path) -> dict[str, Any]:
    context = _load_context(run_dir)
    findings: list[Finding] = []

    scenario = context["scenario"]
    scenario_has_text = all(
        _nonempty_text(scenario.get(field))
        for field in ["summary", "player_safe_summary", "opening_scene"]
    )
    scenario_has_support = all(
        _nonempty_list(context[field])
        for field in ["clues", "locations", "npcs", "timeline"]
    )
    if not scenario_has_text or not scenario_has_support:
        findings.append(_finding(
            "scenario_context_missing",
            "test_gap",
            "high",
            "Scenario sandbox lacks summary/player-safe summary/opening scene or clue/location/NPC/timeline data.",
            "Upgrade the playtest setup to import enough module structure before judging KP behavior.",
        ))

    transcript = context["transcript"]
    if len(transcript) < 8 or _player_intent_count(transcript) < 2 or _keeper_ruling_count(transcript) < 1:
        findings.append(_finding(
            "conversation_loop_too_thin",
            "test_gap",
            "high",
            f"Transcript has {len(transcript)} turns, {_player_intent_count(transcript)} player intents, "
            f"and {_keeper_ruling_count(transcript)} Keeper rulings.",
            "Run enough turns to cover scene framing, player intent, Keeper ruling, result, and consequence.",
        ))

    roll_gaps = _roll_protocol_gaps(context["rolls"])
    if roll_gaps:
        findings.append(_finding(
            "roll_protocol_incomplete",
            "system_gap",
            "high",
            "; ".join(roll_gaps),
            "Record each roll goal, difficulty rationale, target, outcome, and failure consequence in rolls.jsonl.",
        ))

    if not context["clues"] or _event_type_count(context["events"], "clue") < 1:
        findings.append(_finding(
            "clue_flow_missing",
            "system_gap",
            "high",
            "No scenario clue inventory or clue event proves that investigation advanced.",
            "Log clue discovery, missed clues, and alternate clue routes as durable campaign events.",
        ))

    if not _has_pushed_roll(context["rolls"]):
        findings.append(_finding(
            "pushed_roll_missing",
            "test_gap",
            "high",
            "No roll payload is marked as a pushed roll.",
            "Exercise a failed skill roll, the player's push justification, foreshadowed failure, and the pushed result.",
        ))

    if _event_type_count(context["events"], "session_ending") < 1:
        findings.append(_finding(
            "session_ending_missing",
            "system_gap",
            "high",
            "No session_ending event records how the session closed or what remains unresolved.",
            "Record a session ending event with recap, cliffhanger or next-step state, and unresolved questions.",
        ))

    if not context["memory"] or not context["feedback"]:
        findings.append(_finding(
            "memory_or_feedback_missing",
            "test_gap",
            "medium",
            f"Memory summaries: {len(context['memory'])}; player feedback entries: {len(context['feedback'])}.",
            "Have the playtest harness write session-summaries.jsonl and player-feedback.jsonl before report generation.",
        ))

    battle_report = context["battle_report"]
    placeholder_markers = [
        "No story recap recorded.",
        "No player feedback recorded.",
        "No clue extraction in V1 report.",
        "No major decision extraction in V1 report.",
        "Session ending not recorded.",
    ]
    present_placeholders = [marker for marker in placeholder_markers if marker in battle_report]
    if not battle_report or present_placeholders:
        findings.append(_finding(
            "report_missing_recorded_play",
            "report_gap",
            "medium",
            "Battle report is missing or still contains placeholders: " + ", ".join(present_placeholders or ["missing file"]),
            "Render recorded story memory, decisions, clues, and player feedback instead of placeholder text.",
        ))

    if "{'" in battle_report or "'}" in battle_report:
        findings.append(_finding(
            "raw_payload_rendered",
            "report_gap",
            "medium",
            "Battle report contains raw Python/JSON-style payload text.",
            "Format state changes as player-readable summaries rather than dumping payload dictionaries.",
        ))

    missing_mechanical_markers = _report_contains_all(
        battle_report,
        ["Goal:", "Difficulty:", "Difficulty Rationale:", "Failure Consequence:"],
    )
    if missing_mechanical_markers:
        findings.append(_finding(
            "mechanical_detail_not_rendered",
            "report_gap",
            "high",
            "Battle report mechanical log misses: " + ", ".join(missing_mechanical_markers),
            "Render roll goals, difficulty levels, difficulty rationale, and failure consequences for important rolls.",
        ))

    if _has_skill_check(context["rolls"]) and "Skill Check Earned: yes" not in battle_report:
        findings.append(_finding(
            "skill_development_not_rendered",
            "report_gap",
            "medium",
            "At least one roll earned a skill check, but the battle report does not show it.",
            "Render skill check marks and later development-phase outcomes when available.",
        ))

    if _has_pushed_roll(context["rolls"]) and "Pushed Roll: yes" not in battle_report:
        findings.append(_finding(
            "pushed_roll_not_rendered",
            "report_gap",
            "high",
            "A pushed roll exists in rolls.jsonl, but the battle report does not show the push.",
            "Render push justification, foreshadowed failure, and pushed-roll result in the mechanical log.",
        ))

    covered_subsystems = set(context["metadata"].get("subsystems_covered", []))
    if "investigation" not in covered_subsystems:
        findings.append(_finding(
            "subsystem_coverage_missing",
            "test_gap",
            "medium",
            f"subsystems_covered={sorted(covered_subsystems)}.",
            "Declare and exercise at least investigation in every rulebook-alignment playtest; add sanity/combat/chase per scenario.",
        ))

    metadata = context["metadata"]
    if _haunting_module_required(metadata):
        module_coverage = set(metadata.get("module_coverage", []))
        missing_coverage = [
            item for item in HAUNTING_MODULE_COVERAGE
            if item not in module_coverage
        ]
        if missing_coverage:
            findings.append(_finding(
                "module_coverage_incomplete",
                "test_gap",
                "high",
                "Missing The Haunting coverage: " + ", ".join(missing_coverage),
                "Run a module-level harness that reaches the research routes, Chapel, Corbitt House, bed attack, basement knife, Corbitt confrontation, and conclusion.",
            ))

        missing_subsystems = [
            item for item in HAUNTING_MODULE_SUBSYSTEMS
            if item not in covered_subsystems
        ]
        if missing_subsystems:
            findings.append(_finding(
                "subsystem_coverage_incomplete",
                "test_gap",
                "high",
                "Missing subsystem coverage: " + ", ".join(missing_subsystems),
                "Exercise the social, pushed-roll, sanity, damage, and combat procedures that The Haunting introduces.",
            ))

        if len(transcript) < 30 or _player_intent_count(transcript) < 8 or _keeper_ruling_count(transcript) < 6:
            findings.append(_finding(
                "module_transcript_too_thin",
                "test_gap",
                "high",
                f"Transcript has {len(transcript)} turns, {_player_intent_count(transcript)} player intents, "
                f"and {_keeper_ruling_count(transcript)} Keeper rulings.",
                "Simulate enough KP/player exchange to show setup, investigation, exploration, hazards, combat, and aftermath.",
            ))

        decision_count = _event_type_count(context["events"], "decision")
        if decision_count < 5:
            findings.append(_finding(
                "module_decisions_too_thin",
                "report_gap",
                "medium",
                f"Only {decision_count} major player decision events were recorded.",
                "Record the player's major route choices, pushed-roll choices, risk acceptances, and final tactical decisions.",
            ))

        combat_summaries = _payload_summaries(context["events"], "combat")
        combat_text = " ".join(combat_summaries).lower()
        if len(combat_summaries) < 2 or "combat round" not in combat_text or "corbitt" not in combat_text:
            findings.append(_finding(
                "combat_resolution_missing",
                "system_gap",
                "high",
                "Combat summaries do not show a combat round and Corbitt resolution.",
                "Record floating-knife and Corbitt combat rounds, including action order, opposed rolls, damage, and outcome.",
            ))

        status_text = " ".join(_payload_summaries(context["events"], "status"))
        if "Final HP:" not in status_text or "Final SAN:" not in status_text:
            findings.append(_finding(
                "final_state_missing",
                "system_gap",
                "high",
                "No status event records final HP and SAN.",
                "Record final investigator HP, SAN, rewards, and unresolved conditions at the end of a module playthrough.",
            ))

        chase_summaries = _payload_summaries(context["events"], "chase")
        if "chase" not in covered_subsystems and not chase_summaries:
            findings.append(_finding(
                "chase_context_missing",
                "report_gap",
                "medium",
                "No chase event explains whether chase rules were covered or not applicable.",
                "For modules without chase scenes, record an explicit non-applicable chase summary instead of leaving the report empty.",
            ))

        missing_report_moments = _report_contains_all(battle_report, HAUNTING_REPORT_MOMENTS)
        if missing_report_moments:
            findings.append(_finding(
                "module_report_missing_key_moments",
                "report_gap",
                "high",
                "Battle report misses key module moments: " + ", ".join(missing_report_moments),
                "Render the named module beats in the transcript, state changes, combat summary, and ending sections.",
            ))

    if _chase_drill_required(metadata):
        if "chase" not in covered_subsystems:
            findings.append(_finding(
                "chase_subsystem_missing",
                "test_gap",
                "high",
                f"subsystems_covered={sorted(covered_subsystems)}.",
                "Exercise and declare the chase subsystem in a dedicated chase drill playtest.",
            ))

        chase_state = context["chase_state"]
        required_state_fields = ["participants", "location_chain", "rounds", "outcome"]
        missing_state_fields = [
            field for field in required_state_fields
            if chase_state.get(field) in (None, "", [], {})
        ]
        if missing_state_fields:
            findings.append(_finding(
                "chase_state_missing",
                "system_gap",
                "high",
                "save/chase.json is missing or incomplete: " + ", ".join(missing_state_fields),
                "Persist chase participants, location chain, round log, and outcome under save/chase.json.",
            ))

        chase_text = " ".join(_payload_summaries(context["events"], "chase")).lower()
        if (
            "speed roll" not in chase_text
            or "movement actions" not in chase_text
            or "quarry escapes" not in chase_text
        ):
            findings.append(_finding(
                "chase_resolution_missing",
                "system_gap",
                "high",
                "Chase events do not show speed rolls, movement actions, and escape/capture resolution.",
                "Record the chase setup, DEX order, movement action economy, hazards/barriers, conflict, and final outcome.",
            ))

        missing_chase_moments = _report_contains_all(battle_report, CHASE_REPORT_MOMENTS)
        if missing_chase_moments:
            findings.append(_finding(
                "chase_report_missing_key_moments",
                "report_gap",
                "high",
                "Battle report misses chase moments: " + ", ".join(missing_chase_moments),
                "Render speed rolls, MOV, location chain, movement actions, hazards, barriers, conflict, and escape/capture in Chase Summary.",
            ))

    return {
        "run_dir": str(run_dir),
        "result": "fail" if findings else "pass",
        "findings": findings,
    }


def _group_findings(findings: list[Finding]) -> dict[str, list[Finding]]:
    grouped: dict[str, list[Finding]] = {}
    for finding in findings:
        grouped.setdefault(finding["cause"], []).append(finding)
    return grouped


def _next_fix_target(findings: list[Finding]) -> str:
    priority = ["test_gap", "system_gap", "report_gap", "design_gap"]
    grouped = _group_findings(findings)
    for cause in priority:
        if cause in grouped:
            finding = grouped[cause][0]
            return f"{cause}: {finding['recommendation']}"
    return "No fix target. The run passed the current rulebook audit."


def generate_rulebook_audit(run_dir: Path) -> Path:
    audit = audit_run(run_dir)
    output = run_dir / "artifacts" / "rulebook-audit.md"
    output.parent.mkdir(parents=True, exist_ok=True)
    findings = audit["findings"]
    grouped = _group_findings(findings)

    body = [
        "# Rulebook Alignment Audit",
        "",
        "## Overall Result",
        audit["result"].upper(),
        "",
        "## Root Cause Classification",
    ]
    if findings:
        for cause in sorted(grouped):
            body.append(f"### {cause}")
            for finding in grouped[cause]:
                body.extend([
                    f"- [{finding['cause']}] {finding['code']} ({finding['severity']})",
                    f"  - Evidence: {finding['evidence']}",
                    f"  - Recommendation: {finding['recommendation']}",
                ])
    else:
        body.append("- No findings.")

    body.extend([
        "",
        "## Blueprint Cross-Check",
    ])
    if findings:
        for finding in findings:
            body.append(f"- {finding['code']}: {finding['blueprint_status']}")
    else:
        body.append("- Current run satisfies the implemented rulebook-audit contract.")

    body.extend([
        "",
        "## Next Loop Fix Target",
        f"- {_next_fix_target(findings)}",
        "",
    ])
    output.write_text("\n".join(body), encoding="utf-8")
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir")
    args = parser.parse_args()
    output = generate_rulebook_audit(Path(args.run_dir))
    audit = audit_run(Path(args.run_dir))
    print(output)
    return 1 if audit["result"] == "fail" else 0


if __name__ == "__main__":
    raise SystemExit(main())
