#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


Finding = dict[str, Any]


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

    covered_subsystems = set(context["metadata"].get("subsystems_covered", []))
    if "investigation" not in covered_subsystems:
        findings.append(_finding(
            "subsystem_coverage_missing",
            "test_gap",
            "medium",
            f"subsystems_covered={sorted(covered_subsystems)}.",
            "Declare and exercise at least investigation in every rulebook-alignment playtest; add sanity/combat/chase per scenario.",
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
