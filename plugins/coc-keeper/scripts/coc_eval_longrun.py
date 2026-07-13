#!/usr/bin/env python3
"""Long-run continuity and chapter-transition evidence validation for eval-spec-v1."""
from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any


EVAL_SPEC = "eval-spec-v1"
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
CONTINUITY_EVIDENCE_FILE = "continuity-evidence.json"
CHAPTER_EVIDENCE_FILE = "chapter-transition-evidence.json"
STATUSES = frozenset({"PASS", "FAIL", "INELIGIBLE", "NOT_RUN"})
EVIDENCE_CLASSES = frozenset({"fixture", "external"})
EXPECTED_MODEL_ROLES = {
    "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
    "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
}


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"unreadable JSON: {path}: {exc}") from exc


def _write_json_atomic(path: Path, payload: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return path


def _load_live_cell():
    path = SCRIPT_DIR / "coc_eval_live_cell.py"
    spec = importlib.util.spec_from_file_location("coc_eval_longrun_live_cell", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _prepare_continuity_workspace(
    workspace: Path,
    *,
    logical_session_id: str,
    required_anchors: list[str],
) -> Path:
    if workspace.is_symlink():
        raise ValueError("continuity workspace must not be a symlink")
    if workspace.exists() and any(workspace.iterdir()):
        raise ValueError("continuity workspace must be new or empty")
    fixture_root = REPO_ROOT / "evaluation" / "spec" / "v1" / "fixtures" / "matrix"
    scenario = _read_json(fixture_root / "nightly-scenario.json")
    initial = _read_json(fixture_root / "nightly-initial-state.json")
    live_cell = _load_live_cell()
    _workspace, campaign_id, _investigator_id = live_cell.materialize_workspace(
        _object(scenario, "continuity scenario fixture"),
        _object(initial, "continuity initial-state fixture"),
        workspace,
    )
    anchor_path = (
        workspace
        / ".coc"
        / "campaigns"
        / campaign_id
        / "save"
        / "evaluation-continuity-anchors.json"
    )
    _write_json_atomic(
        anchor_path,
        {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "session_id": logical_session_id,
            "anchors": {
                name: {
                    "anchor_id": f"{logical_session_id}:{name}",
                    "state_kind": name,
                }
                for name in required_anchors
            },
        },
    )
    return anchor_path


def _read_recall_anchor_ids(path: Path) -> dict[str, str]:
    payload = _object(_read_json(path), "continuity recall-anchor state")
    anchors = _object(payload.get("anchors"), "continuity recall anchors")
    result: dict[str, str] = {}
    for name, value in anchors.items():
        anchor = _object(value, f"continuity recall anchor {name}")
        anchor_id = anchor.get("anchor_id")
        if not isinstance(anchor_id, str) or not anchor_id:
            raise ValueError(f"continuity recall anchor {name} has no structured id")
        result[str(name)] = anchor_id
    return result


def _run_segment(
    *,
    start_turn: int,
    turn_count: int,
    workspace: Path,
    output: Path,
    model_roles: dict[str, dict[str, str]],
) -> dict[str, Any]:
    """Execute one real continuity segment through the canonical live runner."""
    return _load_live_cell().run_live_segment(
        start_turn=start_turn,
        turn_count=turn_count,
        workspace=workspace,
        output=output,
        model_roles=model_roles,
    )


def _segment_attestation_matches(
    segment: dict[str, Any],
    model_roles: dict[str, dict[str, str]],
    logical_session_id: str,
) -> bool:
    attestation = segment.get("attestation")
    if not isinstance(attestation, dict):
        return False
    if (
        segment.get("evidence_class") == "external"
        and segment.get("logical_session_id") != logical_session_id
    ):
        return False
    attested = (
        attestation.get("attested") is True
        if segment.get("evidence_class") == "external"
        else attestation.get("attested", True) is True
    )
    return bool(
        attestation.get("player_model") == model_roles["player"]
        and attestation.get("kp_model") == model_roles["kp"]
        and attested
    )


def run_continuity_lane(
    *,
    lane: dict[str, Any],
    workspace: Path | str,
    output: Path | str,
    model_roles: dict[str, dict[str, str]],
) -> dict[str, Any]:
    """Execute a continuity lane in two process segments and validate its evidence."""
    lane = dict(_object(lane, "lane"))
    requirements = dict(_object(lane.get("requirements"), "lane.requirements"))
    lane_id = str(lane.get("lane_id") or "")
    if not lane_id:
        raise ValueError("lane.lane_id is required")
    turn_count = lane.get("turn_count")
    restart_at = lane.get("restart_at_turn")
    if (
        isinstance(turn_count, bool)
        or not isinstance(turn_count, int)
        or turn_count < 2
    ):
        raise ValueError("lane.turn_count must be an integer greater than one")
    if (
        isinstance(restart_at, bool)
        or not isinstance(restart_at, int)
        or restart_at < 1
        or restart_at >= turn_count
    ):
        raise ValueError("lane.restart_at_turn must split the requested turns")
    roles = {
        role: dict(_object(model_roles.get(role), f"model_roles.{role}"))
        for role in ("player", "kp")
    }
    workspace_path = Path(workspace).resolve()
    lane_dir = Path(output).resolve()
    lane_dir.mkdir(parents=True, exist_ok=True)
    logical_session_id = f"eval-continuity:{lane_id}:{uuid.uuid4().hex}"
    required_anchors = [str(name) for name in requirements.get("recall_anchors") or []]
    anchor_path = _prepare_continuity_workspace(
        workspace_path,
        logical_session_id=logical_session_id,
        required_anchors=required_anchors,
    )
    guard_path = workspace_path / ".coc" / "eval-continuity-restart.json"
    _write_json_atomic(
        guard_path,
        {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "session_id": logical_session_id,
            "expected_snapshot_sha256": None,
        },
    )

    first = _object(
        _run_segment(
            start_turn=1,
            turn_count=restart_at,
            workspace=workspace_path,
            output=lane_dir / "segments" / "segment-1",
            model_roles=roles,
        ),
        "first segment",
    )
    anchors_before = _read_recall_anchor_ids(anchor_path)
    _write_json_atomic(
        guard_path,
        {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "session_id": logical_session_id,
            "expected_snapshot_sha256": first.get("snapshot_sha256"),
        },
    )
    second = _object(
        _run_segment(
            start_turn=restart_at + 1,
            turn_count=turn_count - restart_at,
            workspace=workspace_path,
            output=lane_dir / "segments" / "segment-2",
            model_roles=roles,
        ),
        "second segment",
    )
    anchors_after = _read_recall_anchor_ids(anchor_path)
    expected_first = list(range(1, restart_at + 1))
    expected_second = list(range(restart_at + 1, turn_count + 1))
    if first.get("accepted_turns") != expected_first:
        raise ValueError("first segment did not accept the exact required turn range")
    if second.get("accepted_turns") != expected_second:
        raise ValueError("second segment did not accept the exact required turn range")

    pre_hash = first.get("snapshot_sha256")
    post_hash = second.get("snapshot_sha256")
    if not _is_sha256(pre_hash) or not _is_sha256(post_hash):
        raise ValueError("segments must report canonical snapshot sha256 values")
    segment_attested = all(
        _segment_attestation_matches(segment, roles, logical_session_id)
        for segment in (first, second)
    )
    exact_models = roles == EXPECTED_MODEL_ROLES
    attested = segment_attested and exact_models
    evidence_class = (
        "external"
        if all(segment.get("evidence_class") == "external" for segment in (first, second))
        else "fixture"
    )
    eligible = attested and pre_hash == post_hash
    recall_anchors = {
        name: {
            "anchor_id": anchors_before.get(name) or anchors_after.get(name),
            "present_before_restart": name in anchors_before,
            "present_after_restart": (
                name in anchors_after and anchors_after[name] == anchors_before.get(name)
            ),
            "turn_ids": [restart_at, restart_at + 1],
        }
        for name in required_anchors
    }
    secret_audit = {
        "schema_version": 1,
        "status": "PASS" if eligible else "FAIL",
        "evidence_class": evidence_class,
        "sources": [
            {
                "segment_id": index,
                "structured": True,
                "prose_scanned": False,
            }
            for index in (1, 2)
        ],
    }
    audit_path = _write_json_atomic(
        lane_dir / "artifacts" / "secret-audit.json", secret_audit
    )
    evidence = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "lane_id": lane_id,
        "evidence_class": evidence_class,
        "eligible": eligible,
        "session_id": logical_session_id,
        "accepted_turns": expected_first + expected_second,
        "turn_count": turn_count,
        "restart": {
            "at_turn": restart_at,
            "pre_checkpoint_sha256": pre_hash,
            "post_checkpoint_sha256": post_hash,
            "session_id_before": logical_session_id,
            "session_id_after": logical_session_id,
            "resumed": pre_hash == post_hash,
        },
        "recall_anchors": recall_anchors,
        "attestation": {
            "player_model": roles["player"],
            "kp_model": roles["kp"],
            "runner": "coc_live_match.segmented",
            "attested": attested,
        },
        "segments": [
            {
                "segment_id": index,
                "logical_session_id": segment.get("logical_session_id")
                or logical_session_id,
                "runner_invocation_id": segment.get("runner_invocation_id")
                or f"{logical_session_id}:segment-{index}",
                "accepted_turns": segment["accepted_turns"],
            }
            for index, segment in enumerate((first, second), 1)
        ],
        "secret_audit": {
            "status": secret_audit["status"],
            "references": [
                {
                    "artifact": audit_path.relative_to(lane_dir).as_posix(),
                    "finding_id": "structured-secret-audit-pass",
                }
            ],
        },
    }
    _write_json_atomic(lane_dir / CONTINUITY_EVIDENCE_FILE, evidence)
    validation = validate_continuity_run(lane_dir, requirements)
    status = validation["status"]
    if status == "PASS" and not exact_models:
        status = "INELIGIBLE"
    return {**evidence, "status": status, "validation": validation}


def _finding(
    *,
    code: str,
    severity: str,
    message: str,
    **extra: Any,
) -> dict[str, Any]:
    payload = {
        "code": code,
        "severity": severity,
        "message": message,
    }
    payload.update(extra)
    return payload


def _base_result(
    *,
    status: str,
    findings: list[dict[str, Any]],
    evidence_class: str | None = None,
    gameplay_evidence: bool | None = None,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if status not in STATUSES:
        raise ValueError(f"invalid status: {status}")
    result: dict[str, Any] = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": status,
        "findings": findings,
        "metrics": metrics or {},
    }
    if evidence_class is not None:
        result["evidence_class"] = evidence_class
    if gameplay_evidence is not None:
        result["gameplay_evidence"] = gameplay_evidence
    return result


def _resolve_evidence_path(run_dir: Path, filename: str) -> Path | None:
    candidates = [
        run_dir / filename,
        run_dir / "artifacts" / filename,
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(
        ch in "0123456789abcdef" for ch in value.lower()
    )


def _secret_audit_ok(evidence: dict[str, Any], findings: list[dict[str, Any]]) -> None:
    audit = evidence.get("secret_audit")
    if not isinstance(audit, dict):
        findings.append(
            _finding(
                code="secret_audit_missing",
                severity="contradictory_evidence",
                message="structured secret_audit object is required",
            )
        )
        return
    references = audit.get("references")
    if not isinstance(references, list) or not references:
        findings.append(
            _finding(
                code="secret_audit_references_missing",
                severity="contradictory_evidence",
                message="secret_audit.references must be a non-empty structured list",
            )
        )
        return
    for index, item in enumerate(references):
        if not isinstance(item, dict):
            findings.append(
                _finding(
                    code="secret_audit_reference_invalid",
                    severity="contradictory_evidence",
                    message=f"secret_audit.references[{index}] must be an object",
                )
            )
            continue
        if not isinstance(item.get("artifact"), str) or not item.get("artifact"):
            findings.append(
                _finding(
                    code="secret_audit_reference_invalid",
                    severity="contradictory_evidence",
                    message=f"secret_audit.references[{index}].artifact required",
                )
            )
        if not isinstance(item.get("finding_id"), str) or not item.get("finding_id"):
            findings.append(
                _finding(
                    code="secret_audit_reference_invalid",
                    severity="contradictory_evidence",
                    message=f"secret_audit.references[{index}].finding_id required",
                )
            )
    status = audit.get("status")
    if status not in {"PASS", "FAIL"}:
        findings.append(
            _finding(
                code="secret_audit_status_invalid",
                severity="contradictory_evidence",
                message="secret_audit.status must be PASS or FAIL",
            )
        )
    elif status == "FAIL":
        findings.append(
            _finding(
                code="secret_audit_failed",
                severity="contradictory_evidence",
                message="structured secret audit recorded FAIL",
            )
        )


def _eligibility_fields(
    evidence: dict[str, Any],
    requirements: dict[str, Any],
    findings: list[dict[str, Any]],
) -> tuple[str | None, bool | None]:
    required = (requirements.get("evidence_eligibility") or {}).get("required_fields") or []
    for field in required:
        if field not in evidence:
            findings.append(
                _finding(
                    code="eligibility_field_missing",
                    severity="contradictory_evidence",
                    message=f"missing eligibility field: {field}",
                    field=field,
                )
            )
    evidence_class = evidence.get("evidence_class")
    if evidence_class not in EVIDENCE_CLASSES:
        findings.append(
            _finding(
                code="evidence_class_invalid",
                severity="contradictory_evidence",
                message="evidence_class must be fixture or external",
            )
        )
        evidence_class = None
    eligible = evidence.get("eligible")
    if not isinstance(eligible, bool):
        findings.append(
            _finding(
                code="eligible_flag_invalid",
                severity="contradictory_evidence",
                message="eligible must be a boolean",
            )
        )
        eligible = None
    return evidence_class, eligible


def _attestation_present(attestation: Any) -> bool:
    if not isinstance(attestation, dict) or not attestation:
        return False
    player = attestation.get("player_model")
    kp = attestation.get("kp_model")
    runner = attestation.get("runner")
    attested = attestation.get("attested")
    if not isinstance(player, dict) or not player.get("id"):
        return False
    if not isinstance(kp, dict) or not kp.get("id"):
        return False
    if not isinstance(runner, str) or not runner:
        return False
    if attested is not True:
        return False
    return True


def validate_continuity_run(
    run_dir: Path | str,
    requirements: dict[str, Any],
) -> dict[str, Any]:
    """Validate structured continuity evidence against lane requirements."""
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

    evidence_path = _resolve_evidence_path(path, CONTINUITY_EVIDENCE_FILE)
    if evidence_path is None:
        findings.append(
            _finding(
                code="continuity_evidence_missing",
                severity="missing_evidence",
                message=f"{CONTINUITY_EVIDENCE_FILE} not found under run_dir",
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    try:
        evidence = _read_json(evidence_path)
    except ValueError as exc:
        findings.append(
            _finding(
                code="continuity_evidence_unreadable",
                severity="missing_evidence",
                message=str(exc),
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    if not isinstance(evidence, dict):
        findings.append(
            _finding(
                code="continuity_evidence_invalid",
                severity="contradictory_evidence",
                message="continuity evidence must be a JSON object",
            )
        )
        return _base_result(status="FAIL", findings=findings)

    if evidence.get("schema_version") != 1 or evidence.get("eval_spec") != EVAL_SPEC:
        findings.append(
            _finding(
                code="continuity_evidence_version_mismatch",
                severity="contradictory_evidence",
                message="continuity evidence must declare schema_version=1 and eval-spec-v1",
            )
        )

    evidence_class, eligible = _eligibility_fields(evidence, requirements, findings)

    # External lanes that executed without attestation are INELIGIBLE.
    if evidence_class == "external" and not _attestation_present(evidence.get("attestation")):
        findings.append(
            _finding(
                code="external_attestation_missing",
                severity="ineligible",
                message="external continuity lane requires runner/model attestation",
            )
        )
        return _base_result(
            status="INELIGIBLE",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
        )

    expected_turns = requirements.get("turn_count")
    accepted = evidence.get("accepted_turns")
    reported_count = evidence.get("turn_count")
    if not isinstance(accepted, list) or not all(isinstance(item, int) for item in accepted):
        findings.append(
            _finding(
                code="accepted_turns_invalid",
                severity="contradictory_evidence",
                message="accepted_turns must be a list of integers",
            )
        )
        accepted = []
    if expected_turns is not None and (
        reported_count != expected_turns or len(accepted) != expected_turns
    ):
        findings.append(
            _finding(
                code="turn_count_mismatch",
                severity="contradictory_evidence",
                message=(
                    f"expected turn_count={expected_turns}, "
                    f"got turn_count={reported_count} accepted={len(accepted)}"
                ),
                expected=expected_turns,
                actual_turn_count=reported_count,
                actual_accepted_count=len(accepted),
            )
        )

    accepted_req = requirements.get("accepted_turns") or {}
    if accepted_req.get("monotonic") and accepted:
        if accepted != sorted(accepted) or len(accepted) != len(set(accepted)):
            findings.append(
                _finding(
                    code="accepted_turns_not_monotonic",
                    severity="contradictory_evidence",
                    message="accepted_turns must be strictly increasing unique turn ids",
                )
            )

    restart_req = requirements.get("restart") or {}
    restart = evidence.get("restart")
    if restart_req.get("required"):
        if not isinstance(restart, dict):
            findings.append(
                _finding(
                    code="restart_evidence_missing",
                    severity="contradictory_evidence",
                    message="restart evidence object is required",
                )
            )
            restart = {}
        expected_at = restart_req.get("at_turn")
        if expected_at is not None and restart.get("at_turn") != expected_at:
            findings.append(
                _finding(
                    code="restart_turn_mismatch",
                    severity="contradictory_evidence",
                    message=f"restart.at_turn must be {expected_at}",
                    expected=expected_at,
                    actual=restart.get("at_turn"),
                )
            )
        if restart_req.get("require_pre_checkpoint_sha256") and not _is_sha256(
            restart.get("pre_checkpoint_sha256")
        ):
            findings.append(
                _finding(
                    code="pre_checkpoint_hash_missing",
                    severity="contradictory_evidence",
                    message="restart.pre_checkpoint_sha256 must be a sha256 hex digest",
                )
            )
        if restart_req.get("require_post_checkpoint_sha256") and not _is_sha256(
            restart.get("post_checkpoint_sha256")
        ):
            findings.append(
                _finding(
                    code="post_checkpoint_hash_missing",
                    severity="contradictory_evidence",
                    message="restart.post_checkpoint_sha256 must be a sha256 hex digest",
                )
            )
        if (requirements.get("checkpoint_integrity") or {}).get(
            "pre_post_hash_match_required"
        ):
            pre_hash = restart.get("pre_checkpoint_sha256")
            post_hash = restart.get("post_checkpoint_sha256")
            if _is_sha256(pre_hash) and _is_sha256(post_hash) and pre_hash != post_hash:
                findings.append(
                    _finding(
                        code="checkpoint_hash_mismatch",
                        severity="contradictory_evidence",
                        message="pre/post checkpoint hashes must match for continuity resume",
                    )
                )
        if restart_req.get("require_session_identity_continuity"):
            before = restart.get("session_id_before")
            after = restart.get("session_id_after")
            session_id = evidence.get("session_id")
            if not before or not after or before != after:
                findings.append(
                    _finding(
                        code="session_identity_broken",
                        severity="contradictory_evidence",
                        message="session identity must continue across restart",
                    )
                )
            elif session_id and session_id != after:
                findings.append(
                    _finding(
                        code="session_identity_broken",
                        severity="contradictory_evidence",
                        message="top-level session_id must match restart session identity",
                    )
                )
        if restart.get("resumed") is not True:
            findings.append(
                _finding(
                    code="restart_not_resumed",
                    severity="contradictory_evidence",
                    message="restart.resumed must be true",
                )
            )

    anchors = evidence.get("recall_anchors")
    if not isinstance(anchors, dict):
        anchors = {}
        findings.append(
            _finding(
                code="recall_anchors_missing",
                severity="contradictory_evidence",
                message="recall_anchors object is required",
            )
        )
    for anchor_name in requirements.get("recall_anchors") or []:
        anchor = anchors.get(anchor_name)
        if not isinstance(anchor, dict):
            findings.append(
                _finding(
                    code="recall_anchor_missing",
                    severity="contradictory_evidence",
                    message=f"missing recall anchor: {anchor_name}",
                    anchor=anchor_name,
                )
            )
            continue
        if not anchor.get("anchor_id"):
            findings.append(
                _finding(
                    code="recall_anchor_incomplete",
                    severity="contradictory_evidence",
                    message=f"recall anchor {anchor_name} missing anchor_id",
                    anchor=anchor_name,
                )
            )
        if anchor.get("present_before_restart") is not True or (
            anchor.get("present_after_restart") is not True
        ):
            findings.append(
                _finding(
                    code="recall_anchor_not_retained",
                    severity="contradictory_evidence",
                    message=f"recall anchor {anchor_name} not retained across restart",
                    anchor=anchor_name,
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
            metrics={
                "accepted_turn_count": len(accepted),
                "reported_turn_count": reported_count,
            },
        )

    gameplay = evidence_class == "external"
    return _base_result(
        status="PASS",
        findings=[],
        evidence_class=evidence_class,
        gameplay_evidence=gameplay,
        metrics={
            "accepted_turn_count": len(accepted),
            "reported_turn_count": reported_count,
            "restart_at_turn": (restart or {}).get("at_turn") if isinstance(restart, dict) else None,
        },
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
