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


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


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

    if metadata.get("play_language") != "zh-Hans":
        findings.append(_finding(
            "play_language_not_default_chinese",
            "system_gap",
            f"{run_id} play_language={metadata.get('play_language')}",
            "Serious localized runs should persist play_language=zh-Hans unless the player explicitly chose another language.",
            run_id=run_id,
        ))
    play_language = str(metadata.get("play_language") or "")
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
    if not isinstance(localized_terms, dict) or not localized_terms.get("zh-Hans"):
        findings.append(_finding(
            "localized_terms_missing",
            "system_gap",
            f"{run_id} does not contain localized_terms.zh-Hans.",
            "Persist localized_terms for the selected play language.",
            run_id=run_id,
        ))

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


def _suite_findings(index: dict[str, Any], loop_decision: dict[str, Any], active_runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
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
    findings = _suite_findings(index, loop_decision, active_runs)
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
