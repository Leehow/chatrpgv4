#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REQUIRED_AUDIT_PROFILES = ["haunting_module", "chase_drill", "multi_profile_pressure"]
REQUIRED_ARTIFACTS = [
    "battle-report.md",
    "evaluation-report.md",
    "rulebook-audit.md",
    "semantic-eval-request.json",
    "semantic-eval-result.json",
]
REQUIRED_COVERAGE_DIMENSIONS = [
    "character_dossier",
    "kp_player_transcript",
    "mechanical_rolls",
    "combat",
    "chase",
    "sanity",
    "meta_game",
    "player_feedback",
]
REQUIRED_QUALITY_DIMENSIONS = [
    "module_fidelity",
    "rulebook_procedure",
    "immersion_and_pacing",
    "chinese_visible_dialogue",
    "actual_play_replay",
    "state_continuity",
    "spoiler_safety",
    "player_agency",
    "virtual_player_pressure",
    "report_completeness",
]
REQUIRED_EVALUATION_REPORT_SECTIONS = [
    "# Evaluation Report",
    "## Overall Result",
    "## Scorecard",
    "## Passed Test Cases",
    "## Failed Test Cases",
    "## Rule Accuracy Findings",
    "## State Integrity Findings",
    "## Spoiler Safety Findings",
    "## Immersion Findings",
    "## Meta-Game Findings",
    "## Reproducible Bugs",
    "## Recommended Fixes",
    "## Regression Tests To Add",
]
REQUIRED_BATTLE_REPORT_ANCHORS = [
    "Battle Report",
    "Run Setup",
    "Module",
    "Investigator Creation",
    "Character Dossier",
    "Investigator Chronicle",
    "Scene-by-Scene Replay",
    "Actual Play Replay",
    "Session Transcript",
    "Mechanical Log",
    "Chase Tracker",
    "Story Recap",
    "Player Feedback On KP",
]
REQUIRED_SUITE_REPORT_SECTIONS = [
    "# COC Playtest Suite Report",
    "## Run Index",
    "## Non-Passing Runs",
    "## Core Coverage Matrix",
    "## Coverage Evidence",
    "## Quality Matrix",
    "## Quality Evidence",
    "## Loop Decision",
    "## Remaining Gaps",
]
REQUIRED_RULEBOOK_AUDIT_SECTIONS = [
    "# Rulebook Alignment Audit",
    "## Overall Result",
    "## Positive Rulebook Evidence",
    "## Root Cause Classification",
    "## Blueprint Cross-Check",
    "## Next Loop Fix Target",
]
REPORT_ANCHOR_PREFIX = "<!-- report-anchor: "
REPORT_ANCHOR_SUFFIX = " -->"


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
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _json_sha256(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _playtests_dir(root: Path) -> Path:
    return root / ".coc" / "playtests"


def _finding(code: str, cause: str, evidence: str, recommendation: str, **extra: Any) -> dict[str, Any]:
    finding = {
        "code": code,
        "cause": cause,
        "evidence": evidence,
        "recommendation": recommendation,
    }
    finding.update(extra)
    return finding


def _active_runs(index: dict[str, Any], loop_decision: dict[str, Any]) -> list[dict[str, Any]]:
    active_ids = set(loop_decision.get("evaluated_runs", []))
    return [run for run in index.get("runs", []) if run.get("run_id") in active_ids]


def _required_profiles(active_runs: list[dict[str, Any]]) -> dict[str, str | None]:
    profiles: dict[str, str | None] = {profile: None for profile in REQUIRED_AUDIT_PROFILES}
    for run in active_runs:
        audit_profile = run.get("audit_profile")
        if audit_profile in profiles and profiles[audit_profile] is None:
            profiles[audit_profile] = str(run.get("run_id"))
    return profiles


def _monitor_status(automation_path: Path | None) -> tuple[str, str]:
    if automation_path is None:
        automation_path = Path.home() / ".codex" / "automations" / "coc-keeper" / "automation.toml"
    text = _read_text(automation_path)
    if not text:
        return "missing", str(automation_path)
    if 'status = "ACTIVE"' in text and "multi-profile virtual player pressure" in text:
        return "ACTIVE", str(automation_path)
    if 'status = "ACTIVE"' in text:
        return "active_without_latest_prompt", str(automation_path)
    return "inactive", str(automation_path)


def _format_note_evidence(evidence: Any) -> str:
    if not isinstance(evidence, dict):
        return ""
    parts: list[str] = []
    evidence_labels = [
        ("transcript_turns", "transcript turns"),
        ("transcript_event_ids", "transcript events"),
        ("log_paths", "logs"),
        ("state_files", "state"),
        ("artifact_paths", "artifacts"),
    ]
    for key, label in evidence_labels:
        value = evidence.get(key)
        if value in (None, "", [], {}):
            continue
        values = value if isinstance(value, list) else [value]
        parts.append(f"{label} {', '.join(str(item) for item in values)}")
    return "; ".join(parts)


def _evaluation_report_evidence_findings(run_id: str, run_dir: Path, evaluation_report: str) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    notes = _read_jsonl(run_dir / "evaluator-notes.jsonl")
    for index, note in enumerate(notes, start=1):
        evidence_text = _format_note_evidence(note.get("evidence"))
        if not evidence_text:
            findings.append(_finding(
                "evaluation_note_evidence_missing",
                "test_gap",
                f"{run_id} evaluator-notes.jsonl note {index} does not contain structured evidence.",
                "Record transcript_turns, log_paths, state_files, or artifact_paths on evaluator notes so evaluation reports can cite evidence.",
                run_id=run_id,
                note_index=index,
            ))
            continue
        if f"Evidence: {evidence_text}" not in evaluation_report:
            findings.append(_finding(
                "evaluation_report_evidence_missing",
                "report_gap",
                f"{run_id} evaluation-report.md does not cite evidence for evaluator note {index}.",
                "Regenerate evaluation-report.md so each evaluator finding cites transcript turns, log paths, state files, or artifact paths.",
                run_id=run_id,
                note_index=index,
            ))
    return findings


def _evaluation_report_section_findings(run_id: str, evaluation_report: str) -> list[dict[str, Any]]:
    headings = {
        line.strip()
        for line in evaluation_report.splitlines()
        if line.startswith("#")
    }
    missing_sections = [
        section
        for section in REQUIRED_EVALUATION_REPORT_SECTIONS
        if section not in headings
    ]
    if not missing_sections:
        return []
    return [_finding(
        "evaluation_report_sections_missing",
        "report_gap",
        f"{run_id} evaluation-report.md missing sections: {', '.join(missing_sections)}.",
        "Regenerate evaluation-report.md with all required engineering assessment sections from the blueprint.",
        run_id=run_id,
        missing_sections=missing_sections,
    )]


def _battle_report_anchors(battle_report: str) -> set[str]:
    anchors: set[str] = set()
    for line in battle_report.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        marker_start = stripped.find(REPORT_ANCHOR_PREFIX)
        if marker_start == -1:
            continue
        anchor_start = marker_start + len(REPORT_ANCHOR_PREFIX)
        anchor_end = stripped.find(REPORT_ANCHOR_SUFFIX, anchor_start)
        if anchor_end == -1:
            continue
        anchors.add(stripped[anchor_start:anchor_end])
    return anchors


def _battle_report_anchor_findings(run_id: str, battle_report: str) -> list[dict[str, Any]]:
    anchors = _battle_report_anchors(battle_report)
    missing_anchors = [
        anchor
        for anchor in REQUIRED_BATTLE_REPORT_ANCHORS
        if anchor not in anchors
    ]
    if not missing_anchors:
        return []
    return [_finding(
        "battle_report_anchors_missing",
        "report_gap",
        f"{run_id} battle-report.md missing report anchors: {', '.join(missing_anchors)}.",
        "Regenerate battle-report.md with the required actual-play report sections and stable ASCII report-anchor comments.",
        run_id=run_id,
        missing_anchors=missing_anchors,
    )]


def _markdown_headings(markdown: str) -> set[str]:
    return {
        line.strip()
        for line in markdown.splitlines()
        if line.startswith("#")
    }


def _suite_report_section_findings(suite_report: str) -> list[dict[str, Any]]:
    headings = _markdown_headings(suite_report)
    missing_sections = [
        section
        for section in REQUIRED_SUITE_REPORT_SECTIONS
        if section not in headings
    ]
    if not missing_sections:
        return []
    return [_finding(
        "suite_report_sections_missing",
        "report_gap",
        f"suite-report.md missing sections: {', '.join(missing_sections)}.",
        "Regenerate suite-report.md with the required cross-run coverage and quality evidence sections.",
        missing_sections=missing_sections,
    )]


def _rulebook_audit_section_findings(run_id: str, rulebook_audit: str) -> list[dict[str, Any]]:
    headings = _markdown_headings(rulebook_audit)
    missing_sections = [
        section
        for section in REQUIRED_RULEBOOK_AUDIT_SECTIONS
        if section not in headings
    ]
    if not missing_sections:
        return []
    return [_finding(
        "rulebook_audit_sections_missing",
        "report_gap",
        f"{run_id} rulebook-audit.md missing sections: {', '.join(missing_sections)}.",
        "Regenerate rulebook-audit.md with the required rulebook evidence and loop-control sections.",
        run_id=run_id,
        missing_sections=missing_sections,
    )]


def _run_artifact_findings(root: Path, run: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    run_id = str(run.get("run_id"))
    run_dir = _playtests_dir(root) / run_id
    metadata = _read_json(run_dir / "playtest.json", {})
    artifacts_dir = run_dir / "artifacts"

    if run.get("audit_result") != "PASS":
        findings.append(_finding(
            "active_run_audit_not_pass",
            "test_gap",
            f"{run_id} audit_result={run.get('audit_result')}",
            "Regenerate the run and fix rulebook-audit findings before completion audit.",
            run_id=run_id,
        ))

    missing_artifacts = [name for name in REQUIRED_ARTIFACTS if not (artifacts_dir / name).exists()]
    if missing_artifacts:
        findings.append(_finding(
            "active_run_artifacts_missing",
            "report_gap",
            f"{run_id} missing artifacts: {', '.join(missing_artifacts)}",
            "Regenerate battle, evaluation, rulebook audit, and semantic evaluation artifacts.",
            run_id=run_id,
            missing_artifacts=missing_artifacts,
        ))

    play_language = str(metadata.get("play_language") or "")
    if not play_language:
        findings.append(_finding(
            "play_language_missing",
            "system_gap",
            f"{run_id} does not contain play_language.",
            "Persist the selected play_language; default it to zh-Hans unless the player explicitly chose another language.",
            run_id=run_id,
        ))
    language_profile = metadata.get("language_profile")
    if not isinstance(language_profile, dict) or not language_profile:
        findings.append(_finding(
            "language_profile_missing",
            "system_gap",
            f"{run_id} does not contain language_profile.",
            "Persist language_profile with output instruction, name policy, term policy, and report labels for the selected play_language.",
            run_id=run_id,
        ))
    elif language_profile.get("language") != play_language:
        findings.append(_finding(
            "language_profile_mismatch",
            "system_gap",
            f"{run_id} language_profile.language={language_profile.get('language')} play_language={play_language}",
            "Regenerate the run so language_profile.language matches play_language.",
            run_id=run_id,
        ))
    elif f"localized_terms.{play_language}" not in str(language_profile.get("term_policy", "")):
        findings.append(_finding(
            "language_profile_term_policy_missing",
            "system_gap",
            f"{run_id} term_policy={language_profile.get('term_policy')}",
            "Record a term_policy that explicitly points to the selected language localized_terms map.",
            run_id=run_id,
        ))
    localized_terms = metadata.get("localized_terms", {})
    if not isinstance(localized_terms, dict) or not localized_terms.get(play_language):
        findings.append(_finding(
            "localized_terms_missing",
            "system_gap",
            f"{run_id} does not contain localized_terms.{play_language}.",
            "Persist localized_terms for the selected play language.",
            run_id=run_id,
        ))

    battle_report = _read_text(artifacts_dir / "battle-report.md")
    findings.extend(_battle_report_anchor_findings(run_id, battle_report))

    rulebook_audit = _read_text(artifacts_dir / "rulebook-audit.md")
    findings.extend(_rulebook_audit_section_findings(run_id, rulebook_audit))

    evaluation_report = _read_text(artifacts_dir / "evaluation-report.md")
    findings.extend(_evaluation_report_section_findings(run_id, evaluation_report))
    findings.extend(_evaluation_report_evidence_findings(run_id, run_dir, evaluation_report))

    semantic_request = _read_json(artifacts_dir / "semantic-eval-request.json", {})
    semantic = _read_json(artifacts_dir / "semantic-eval-result.json", {})
    if semantic:
        missing_required_fields = [
            field
            for field in ("root_cause_classification", "next_loop_fix_target")
            if field not in semantic
        ]
        if missing_required_fields:
            findings.append(_finding(
                "semantic_required_field_missing",
                "test_gap",
                f"{run_id} semantic-eval-result.json missing fields: {', '.join(missing_required_fields)}.",
                "Regenerate semantic-eval-result.json with all required loop fields.",
                run_id=run_id,
                missing_fields=missing_required_fields,
            ))
        if "root_cause_classification" in semantic and not isinstance(semantic.get("root_cause_classification"), list):
            findings.append(_finding(
                "semantic_required_field_invalid",
                "test_gap",
                f"{run_id} root_cause_classification is not a list.",
                "Regenerate semantic-eval-result.json so root_cause_classification is a list of root-cause labels.",
                run_id=run_id,
                key="root_cause_classification",
            ))
        if (
            "next_loop_fix_target" in semantic
            and (
                not isinstance(semantic.get("next_loop_fix_target"), str)
                or not semantic.get("next_loop_fix_target")
            )
        ):
            findings.append(_finding(
                "semantic_required_field_invalid",
                "test_gap",
                f"{run_id} next_loop_fix_target is not a non-empty string.",
                "Regenerate semantic-eval-result.json so next_loop_fix_target names the next loop action or none.",
                run_id=run_id,
                key="next_loop_fix_target",
            ))
        if semantic.get("evaluator_id") != "codex-llm-semantic-v1":
            findings.append(_finding(
                "semantic_evaluator_unexpected",
                "test_gap",
                f"{run_id} evaluator_id={semantic.get('evaluator_id')}",
                "Use the LLM semantic evaluator artifact for completion-oriented suites.",
                run_id=run_id,
            ))
        if not isinstance(semantic.get("coverage"), dict) or not semantic.get("coverage"):
            findings.append(_finding(
                "semantic_coverage_missing",
                "test_gap",
                f"{run_id} semantic-eval-result.json does not contain a coverage object.",
                "Regenerate semantic-eval-result.json with structured coverage dimensions.",
                run_id=run_id,
            ))
        else:
            for dimension in REQUIRED_COVERAGE_DIMENSIONS:
                coverage_value = semantic["coverage"].get(dimension)
                if not isinstance(coverage_value, dict):
                    findings.append(_finding(
                        "semantic_coverage_dimension_invalid",
                        "test_gap",
                        f"{run_id} coverage.{dimension} is missing or not an object.",
                        "Regenerate semantic-eval-result.json so each coverage dimension has covered and reason.",
                        run_id=run_id,
                        key=dimension,
                    ))
                    continue
                missing_fields = [
                    field
                    for field in ("covered", "reason")
                    if field not in coverage_value
                ]
                if missing_fields:
                    findings.append(_finding(
                        "semantic_coverage_dimension_invalid",
                        "test_gap",
                        f"{run_id} coverage.{dimension} missing fields: {', '.join(missing_fields)}.",
                        "Regenerate semantic-eval-result.json so each coverage dimension has covered and reason.",
                        run_id=run_id,
                        key=dimension,
                        missing_fields=missing_fields,
                    ))
                    continue
                if not isinstance(coverage_value.get("covered"), bool):
                    findings.append(_finding(
                        "semantic_coverage_dimension_invalid",
                        "test_gap",
                        f"{run_id} coverage.{dimension}.covered is not a boolean.",
                        "Regenerate semantic-eval-result.json so each coverage dimension has covered and reason.",
                        run_id=run_id,
                        key=dimension,
                    ))
        if not isinstance(semantic.get("quality"), dict) or not semantic.get("quality"):
            findings.append(_finding(
                "semantic_quality_missing",
                "test_gap",
                f"{run_id} semantic-eval-result.json does not contain a quality object.",
                "Regenerate semantic-eval-result.json with structured quality dimensions.",
                run_id=run_id,
            ))
        else:
            for dimension in REQUIRED_QUALITY_DIMENSIONS:
                quality_value = semantic["quality"].get(dimension)
                if not isinstance(quality_value, dict):
                    findings.append(_finding(
                        "semantic_quality_dimension_invalid",
                        "test_gap",
                        f"{run_id} quality.{dimension} is missing or not an object.",
                        "Regenerate semantic-eval-result.json so each quality dimension has score, passed, and reason.",
                        run_id=run_id,
                        key=dimension,
                    ))
                    continue
                missing_fields = [
                    field
                    for field in ("score", "passed", "reason")
                    if field not in quality_value
                ]
                if missing_fields:
                    findings.append(_finding(
                        "semantic_quality_dimension_invalid",
                        "test_gap",
                        f"{run_id} quality.{dimension} missing fields: {', '.join(missing_fields)}.",
                        "Regenerate semantic-eval-result.json so each quality dimension has score, passed, and reason.",
                        run_id=run_id,
                        key=dimension,
                        missing_fields=missing_fields,
                    ))
                    continue
                if not isinstance(quality_value.get("passed"), bool):
                    findings.append(_finding(
                        "semantic_quality_dimension_invalid",
                        "test_gap",
                        f"{run_id} quality.{dimension}.passed is not a boolean.",
                        "Regenerate semantic-eval-result.json so each quality dimension has score, passed, and reason.",
                        run_id=run_id,
                        key=dimension,
                    ))
        provenance = semantic.get("evaluation_provenance")
        if not isinstance(provenance, dict) or not provenance:
            findings.append(_finding(
                "semantic_provenance_missing",
                "test_gap",
                f"{run_id} semantic-eval-result.json does not contain evaluation_provenance.",
                "Have an LLM semantic evaluator fill semantic-eval-result.json from the matching semantic-eval-request.json and record provenance.",
                run_id=run_id,
            ))
        elif provenance.get("kind") != "llm":
            findings.append(_finding(
                "semantic_provenance_not_llm",
                "test_gap",
                f"{run_id} evaluation_provenance.kind={provenance.get('kind')}",
                "Completion-oriented semantic artifacts must be produced by an LLM semantic evaluator, not a deterministic harness fixture.",
                run_id=run_id,
            ))
        elif not semantic_request:
            findings.append(_finding(
                "semantic_request_missing",
                "test_gap",
                f"{run_id} semantic-eval-request.json is missing or empty.",
                "Write the semantic evaluation request before accepting a semantic result.",
                run_id=run_id,
            ))
        elif provenance.get("request_sha256") != _json_sha256(semantic_request):
            findings.append(_finding(
                "semantic_request_hash_mismatch",
                "test_gap",
                f"{run_id} request_sha256 does not match semantic-eval-request.json.",
                "Regenerate semantic-eval-request.json and have the LLM evaluator refill semantic-eval-result.json from that exact request.",
                run_id=run_id,
            ))

    return findings


def _suite_findings(
    index: dict[str, Any],
    loop_decision: dict[str, Any],
    active_runs: list[dict[str, Any]],
    suite_report: str,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    findings.extend(_suite_report_section_findings(suite_report))
    if loop_decision.get("status") != "ready_for_completion_audit":
        findings.append(_finding(
            "loop_not_ready_for_completion_audit",
            "test_gap",
            f"loop status={loop_decision.get('status')}",
            "Fix loop-decision blockers before running completion audit.",
        ))
    if loop_decision.get("blockers"):
        findings.append(_finding(
            "loop_blockers_present",
            "test_gap",
            f"blockers={loop_decision.get('blockers')}",
            "Resolve loop-decision blockers and rerun the suite.",
        ))
    if index.get("gaps"):
        findings.append(_finding(
            "coverage_gap",
            "test_gap",
            f"coverage gaps={index.get('gaps')}",
            "Add or repair active runs so the semantic coverage matrix has no gaps.",
        ))
    for dimension in REQUIRED_COVERAGE_DIMENSIONS:
        coverage_entry = index.get("coverage", {}).get(dimension)
        if not coverage_entry or coverage_entry.get("status") != "covered":
            findings.append(_finding(
                "required_coverage_not_covered",
                "test_gap",
                f"{dimension} status={coverage_entry.get('status') if coverage_entry else 'missing'}",
                "Use semantic artifacts to prove every required core coverage dimension is covered.",
                key=dimension,
            ))
    for gap in index.get("quality_gaps", []):
        findings.append(_finding(
            "quality_gap",
            "test_gap",
            f"quality gap={gap}",
            "Inspect semantic quality reasons and improve the playtest loop.",
            key=gap,
        ))

    required_profiles = _required_profiles(active_runs)
    for profile, run_id in required_profiles.items():
        if run_id is None:
            findings.append(_finding(
                "required_profile_missing",
                "test_gap",
                f"Missing active audit_profile={profile}",
                "Add an active passing run for each completion-required audit profile.",
                audit_profile=profile,
            ))

    for dimension in REQUIRED_QUALITY_DIMENSIONS:
        quality_entry = index.get("quality", {}).get(dimension)
        if not quality_entry or quality_entry.get("status") != "passed":
            findings.append(_finding(
                "required_quality_not_passed",
                "test_gap",
                f"{dimension} status={quality_entry.get('status') if quality_entry else 'missing'}",
                "Use semantic artifacts to prove every required quality dimension is table-ready.",
                key=dimension,
            ))
    return findings


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _write_markdown(path: Path, audit: dict[str, Any]) -> None:
    result_label = "PASS" if audit["result"] == "pass" else "FAIL"
    lines = [
        "# COC Keeper Completion Audit",
        "",
        "## Overall Result",
        result_label,
        "",
        "## Active Runs",
        *[f"- {run_id}" for run_id in audit["active_runs"]],
        "",
        "## Required Profiles",
    ]
    for profile, run_id in audit["required_profiles"].items():
        lines.append(f"- {profile}: {run_id or 'missing'}")
    lines.extend(["", "## Required Quality"])
    for key, status in audit["required_quality"].items():
        lines.append(f"- {key}: {status}")
    lines.extend([
        "",
        "## Monitor",
        f"- Monitor: {audit['monitor']['status']}",
        f"- Path: {audit['monitor']['path']}",
        "",
        "## Findings",
    ])
    if audit["findings"]:
        for finding in audit["findings"]:
            lines.append(f"- {finding['code']} [{finding['cause']}]: {finding['evidence']}")
            lines.append(f"  - Recommendation: {finding['recommendation']}")
    else:
        lines.append("- No findings.")
    lines.extend([
        "",
        "## Next Action",
        audit["next_action"],
        "",
    ])
    path.write_text("\n".join(lines), encoding="utf-8")


def generate_completion_audit(root: Path, automation_path: Path | None = None) -> Path:
    base = _playtests_dir(root)
    index = _read_json(base / "index.json", {})
    loop_decision = _read_json(base / "loop-decision.json", {})
    active_runs = _active_runs(index, loop_decision)
    findings = _suite_findings(index, loop_decision, active_runs, _read_text(base / "suite-report.md"))
    for run in active_runs:
        findings.extend(_run_artifact_findings(root, run))

    monitor_status, monitor_path = _monitor_status(automation_path)
    if monitor_status != "ACTIVE":
        findings.append(_finding(
            "monitor_not_active",
            "system_gap",
            f"monitor status={monitor_status}; path={monitor_path}",
            "Keep the COC Keeper watchdog automation active and aligned with current completion requirements.",
        ))

    required_quality = {
        key: index.get("quality", {}).get(key, {}).get("status", "missing")
        for key in REQUIRED_QUALITY_DIMENSIONS
    }
    audit = {
        "schema_version": 1,
        "result": "fail" if findings else "pass",
        "active_runs": [str(run.get("run_id")) for run in active_runs],
        "required_profiles": _required_profiles(active_runs),
        "required_quality": required_quality,
        "monitor": {"status": monitor_status, "path": monitor_path},
        "findings": findings,
        "next_action": (
            "Continue the playtest loop by fixing the first finding."
            if findings
            else "No artifact-level completion blockers found; retain goal active unless the full thread-level completion audit is also satisfied."
        ),
    }
    json_path = base / "completion-audit.json"
    markdown_path = base / "completion-audit.md"
    _write_json(json_path, audit)
    _write_markdown(markdown_path, audit)
    return markdown_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--automation-path")
    args = parser.parse_args()
    automation_path = Path(args.automation_path) if args.automation_path else None
    print(generate_completion_audit(Path(args.root), automation_path=automation_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
