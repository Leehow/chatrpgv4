#!/usr/bin/env python3
"""Compatibility facade for continuity APIs and legacy chapter validation."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(filename: str, module_name: str):
    path = SCRIPT_DIR / filename
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


_evidence = _load_sibling(
    "coc_eval_continuity_evidence.py", "coc_eval_longrun_continuity_evidence"
)
_runner = _load_sibling(
    "coc_eval_continuity_runner.py", "coc_eval_longrun_continuity_runner"
)

EVAL_SPEC = _evidence.EVAL_SPEC
CHAPTER_EVIDENCE_FILE = _evidence.CHAPTER_EVIDENCE_FILE
_finding = _evidence._finding
_base_result = _evidence._base_result
_resolve_evidence_path = _evidence._resolve_evidence_path
_read_json = _evidence._read_json
_eligibility_fields = _evidence._eligibility_fields
_secret_audit_ok = _evidence._secret_audit_ok

# Compatibility hooks retained for existing callers and monkeypatched tests.
_load_live_cell = _runner._load_live_cell
_canonical_run_segment = _runner._run_segment


def _run_segment(**kwargs: Any) -> dict[str, Any]:
    original_live_cell = _runner._load_live_cell
    _runner._load_live_cell = globals().get("_load_live_cell", original_live_cell)
    try:
        return _canonical_run_segment(**kwargs)
    finally:
        _runner._load_live_cell = original_live_cell


def validate_continuity_run(
    run_dir: Path | str, requirements: dict[str, Any]
) -> dict[str, Any]:
    return _evidence.validate_continuity_run(run_dir, requirements)


def run_continuity_lane(
    *,
    lane: dict[str, Any],
    workspace: Path | str,
    output: Path | str,
    model_roles: dict[str, dict[str, str]],
) -> dict[str, Any]:
    return _runner.run_continuity_lane(
        lane=lane,
        workspace=workspace,
        output=output,
        model_roles=model_roles,
        segment_executor=globals().get("_run_segment", _canonical_run_segment),
    )


def _attestation_present(attestation: Any) -> bool:
    """Preserve the legacy chapter attestation shape."""
    if not isinstance(attestation, dict) or not attestation:
        return False
    player = attestation.get("player_model")
    kp = attestation.get("kp_model")
    runner = attestation.get("runner")
    return bool(
        isinstance(player, dict)
        and player.get("id")
        and isinstance(kp, dict)
        and kp.get("id")
        and isinstance(runner, str)
        and runner
        and attestation.get("attested") is True
    )


def validate_chapter_transition(
    run_dir: Path | str,
    requirements: dict[str, Any],
) -> dict[str, Any]:
    """Validate structured chapter-transition evidence against contract requirements."""
    if not isinstance(requirements, dict):
        raise ValueError("requirements must be an object")
    path = Path(run_dir)
    findings: list[dict[str, Any]] = []

    if not path.exists() or not path.is_dir():
        findings.append(
            _finding(
                code="run_dir_missing",
                severity="missing_evidence",
                message=f"run directory missing: {path}",
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    evidence_path = _resolve_evidence_path(path, CHAPTER_EVIDENCE_FILE)
    if evidence_path is None:
        findings.append(
            _finding(
                code="chapter_transition_evidence_missing",
                severity="missing_evidence",
                message=f"{CHAPTER_EVIDENCE_FILE} not found under run_dir",
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    try:
        evidence = _read_json(evidence_path)
    except ValueError as exc:
        findings.append(
            _finding(
                code="chapter_transition_evidence_unreadable",
                severity="missing_evidence",
                message=str(exc),
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    if not isinstance(evidence, dict):
        findings.append(
            _finding(
                code="chapter_transition_evidence_invalid",
                severity="contradictory_evidence",
                message="chapter-transition evidence must be a JSON object",
            )
        )
        return _base_result(status="FAIL", findings=findings)

    if evidence.get("schema_version") != 1 or evidence.get("eval_spec") != EVAL_SPEC:
        findings.append(
            _finding(
                code="chapter_transition_version_mismatch",
                severity="contradictory_evidence",
                message="chapter evidence must declare schema_version=1 and eval-spec-v1",
            )
        )

    evidence_class, eligible = _eligibility_fields(evidence, requirements, findings)

    if evidence_class == "external" and not _attestation_present(evidence.get("attestation")):
        findings.append(
            _finding(
                code="external_attestation_missing",
                severity="ineligible",
                message="external chapter-transition lane requires runner/model attestation",
            )
        )
        return _base_result(
            status="INELIGIBLE",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
        )

    expected_module = requirements.get("source_module_id")
    if expected_module and evidence.get("source_module_id") != expected_module:
        findings.append(
            _finding(
                code="source_module_mismatch",
                severity="contradictory_evidence",
                message="source_module_id does not match contract",
                expected=expected_module,
                actual=evidence.get("source_module_id"),
            )
        )

    event_req = requirements.get("chapter_switch_event") or {}
    event = evidence.get("chapter_switch_event")
    if event_req.get("required"):
        if not isinstance(event, dict):
            findings.append(
                _finding(
                    code="chapter_switch_event_missing",
                    severity="contradictory_evidence",
                    message="chapter_switch_event object is required",
                )
            )
            event = {}
        expected_type = event_req.get("event_type")
        if expected_type and event.get("event_type") != expected_type:
            findings.append(
                _finding(
                    code="chapter_switch_event_type_mismatch",
                    severity="contradictory_evidence",
                    message=f"chapter_switch_event.event_type must be {expected_type}",
                )
            )
        if not event.get("event_id"):
            findings.append(
                _finding(
                    code="chapter_switch_event_id_missing",
                    severity="contradictory_evidence",
                    message="chapter_switch_event.event_id is required",
                )
            )

    if evidence.get("pre_active_scenario_id") != requirements.get("pre_active_scenario_id"):
        findings.append(
            _finding(
                code="pre_active_scenario_mismatch",
                severity="contradictory_evidence",
                message="pre_active_scenario_id does not match contract",
                expected=requirements.get("pre_active_scenario_id"),
                actual=evidence.get("pre_active_scenario_id"),
            )
        )
    if evidence.get("post_active_scenario_id") != requirements.get("post_active_scenario_id"):
        findings.append(
            _finding(
                code="post_active_scenario_mismatch",
                severity="contradictory_evidence",
                message="post_active_scenario_id does not match contract",
                expected=requirements.get("post_active_scenario_id"),
                actual=evidence.get("post_active_scenario_id"),
            )
        )

    expected_sidecars = list(requirements.get("preserved_epistemic_sidecars") or [])
    actual_sidecars = evidence.get("preserved_epistemic_sidecars")
    if not isinstance(actual_sidecars, list):
        actual_sidecars = []
        findings.append(
            _finding(
                code="epistemic_sidecars_missing",
                severity="contradictory_evidence",
                message="preserved_epistemic_sidecars list is required",
            )
        )
    for name in expected_sidecars:
        if name not in actual_sidecars:
            findings.append(
                _finding(
                    code="epistemic_sidecar_missing",
                    severity="contradictory_evidence",
                    message=f"missing preserved epistemic sidecar: {name}",
                    sidecar=name,
                )
            )

    for field_name, code in (
        ("investigator_state_continuity", "investigator_continuity_missing"),
        ("campaign_state_continuity", "campaign_continuity_missing"),
        ("item_continuity", "item_continuity_missing"),
    ):
        req = requirements.get(field_name) or {}
        value = evidence.get(field_name)
        if req.get("required") and not isinstance(value, dict):
            findings.append(
                _finding(
                    code=code,
                    severity="contradictory_evidence",
                    message=f"{field_name} object is required",
                )
            )
        elif isinstance(value, dict) and value.get("preserved") is not True:
            findings.append(
                _finding(
                    code=f"{field_name}_not_preserved",
                    severity="contradictory_evidence",
                    message=f"{field_name}.preserved must be true",
                )
            )

    for field_name, code in (
        ("discovered_clues", "discovered_clues_missing"),
        ("relationships", "relationships_missing"),
    ):
        req = requirements.get(field_name) or {}
        value = evidence.get(field_name)
        if req.get("required") and not isinstance(value, list):
            findings.append(
                _finding(
                    code=code,
                    severity="contradictory_evidence",
                    message=f"{field_name} list is required",
                )
            )
        elif isinstance(value, list):
            min_count = req.get("min_count")
            if isinstance(min_count, int) and len(value) < min_count:
                findings.append(
                    _finding(
                        code=f"{field_name}_below_min",
                        severity="contradictory_evidence",
                        message=f"{field_name} below required min_count",
                    )
                )

    invalidated_req = requirements.get("invalidated_segment") or {}
    bridged = evidence.get("code_revision_bridges_checkpoints") is True
    if invalidated_req.get("required_when_code_revision_bridges_checkpoints") and bridged:
        segment = evidence.get("invalidated_segment")
        if not isinstance(segment, dict) or segment.get("recorded") is not True:
            findings.append(
                _finding(
                    code="invalidated_segment_missing",
                    severity="contradictory_evidence",
                    message=(
                        "invalidated_segment evidence is required when a code "
                        "revision bridges checkpoints"
                    ),
                )
            )

    if (requirements.get("secret_leakage_audit") or {}).get("required"):
        _secret_audit_ok(evidence, findings)

    if eligible is False:
        findings.append(
            _finding(
                code="evidence_marked_ineligible",
                severity="ineligible",
                message="evidence.eligible is false",
            )
        )
        return _base_result(
            status="INELIGIBLE",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
        )

    if findings:
        return _base_result(
            status="FAIL",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
        )

    return _base_result(
        status="PASS",
        findings=[],
        evidence_class=evidence_class,
        gameplay_evidence=evidence_class == "external",
        metrics={
            "preserved_sidecar_count": len(actual_sidecars),
            "discovered_clue_count": len(evidence.get("discovered_clues") or []),
            "relationship_count": len(evidence.get("relationships") or []),
        },
    )
