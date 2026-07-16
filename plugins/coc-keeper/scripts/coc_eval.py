#!/usr/bin/env python3
"""Canonical host-neutral entry point for COC Keeper evaluation."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_eval_cases as cases
import coc_eval_calibration as calibration
import coc_eval_compare as compare
import coc_eval_contract as contract
import coc_eval_matrix as matrix
import coc_eval_packs as packs
import coc_eval_pipeline as pipeline
import coc_eval_replay as replay
import coc_playtest_route_compare as route_compare


EXIT_BY_STATUS = {
    "PASS": 0,
    "FAIL": 1,
    "INELIGIBLE": 2,
    "NOT_RUN": 2,
    "NON_COMPARABLE": 2,
}
NIGHTLY_FULL_LANE_IDS = frozenset(
    {
        "registered-cases",
        "matrix",
        "continuity-25",
        "continuity-50",
        "completion-audit",
    }
)
NIGHTLY_SHORT_CIRCUIT_LANE_IDS = frozenset({"registered-cases"})


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_print(payload: Any, *, stream=None) -> None:
    target = stream or sys.stdout
    target.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git_head(root: Path) -> str | None:
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    value = (proc.stdout or "").strip()
    return value if proc.returncode == 0 and value else None


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _default_output(root: Path, suite: str) -> Path:
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    return root / ".coc" / "evaluations" / f"{suite}-{stamp}-{os.getpid()}"


def _positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a positive integer") from exc
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def _positive_float(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a positive number") from exc
    if not math.isfinite(parsed) or parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive number")
    return parsed


def _canonical_json_text(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _registered_case_projection_findings(
    manifest: dict[str, Any], lanes: dict[str, Any]
) -> tuple[str | None, list[dict[str, Any]]]:
    findings: list[dict[str, Any]] = []
    lane = lanes.get("registered-cases")
    if not isinstance(lane, dict):
        return None, findings
    rows = lane.get("cases")
    if not isinstance(rows, list) or not rows:
        findings.append({"code": "registered_case_rows_malformed"})
        return None, findings
    case_ids: list[str] = []
    rows_valid = True
    for row in rows:
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("case_id"), str)
            or cases.CASE_ID_RE.fullmatch(row["case_id"]) is None
            or row.get("gate") not in cases.VALID_GATES
            or row.get("status") not in pipeline.REGISTERED_CASE_STATUSES
        ):
            rows_valid = False
            break
        case_ids.append(row["case_id"])
    if not rows_valid or len(case_ids) != len(set(case_ids)):
        findings.append({"code": "registered_case_rows_malformed"})
        return None, findings
    if manifest.get("case_results") != rows:
        findings.append({"code": "registered_case_results_mismatch"})
    if manifest.get("case_ids") != case_ids:
        findings.append({"code": "registered_case_ids_mismatch"})
    if lane.get("suite") != manifest.get("suite"):
        findings.append({"code": "registered_case_suite_mismatch"})
    canonical_status = cases.aggregate_suite_status(rows)
    if lane.get("status") != canonical_status:
        findings.append({"code": "registered_case_status_mismatch"})
    return canonical_status, findings


def _aggregate_contract_findings(
    directory: Path,
    manifest: dict[str, Any],
    lanes: dict[str, Any],
) -> list[dict[str, Any]]:
    if manifest.get("suite") != "nightly":
        return [{"code": "aggregate_contract_suite_mismatch"}]
    try:
        expected = pipeline.build_aggregate_summary(
            suite="nightly",
            lanes=lanes,
            aggregation_inputs=manifest.get("aggregation_inputs"),
        )
    except ValueError:
        return [{"code": "aggregate_inputs_malformed"}]
    findings: list[dict[str, Any]] = []
    for field in ("status", "not_run_reasons", "diagnostic"):
        if manifest.get(field) != expected[field]:
            findings.append(
                {"code": "aggregate_manifest_mismatch", "field": field}
            )
    summary_path = directory / "aggregate-summary.json"
    if summary_path.is_symlink() or not summary_path.is_file():
        findings.append({"code": "aggregate_summary_missing"})
        return findings
    expected_text = _canonical_json_text(expected)
    try:
        actual_text = summary_path.read_text(encoding="utf-8")
        actual_digest = _sha256(summary_path)
    except (OSError, UnicodeError):
        findings.append({"code": "aggregate_summary_unreadable"})
        return findings
    if actual_text != expected_text:
        findings.append({"code": "aggregate_summary_payload_mismatch"})
    artifact_hashes = manifest.get("artifact_hashes")
    if (
        not isinstance(artifact_hashes, dict)
        or artifact_hashes.get("aggregate-summary.json") != actual_digest
    ):
        findings.append({"code": "aggregate_summary_hash_mismatch"})
    return findings


def _safe_suite_child_directory(
    directory: Path,
    relative: Path,
    *,
    label: str,
) -> tuple[Path | None, dict[str, Any] | None]:
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        return None, {"code": "suite_report_path_unsafe", "report_id": label}
    candidate = directory / relative
    current = candidate
    while current != directory:
        if current.is_symlink():
            return None, {
                "code": "suite_report_path_unsafe",
                "report_id": label,
            }
        current = current.parent
    resolved = candidate.resolve()
    try:
        resolved.relative_to(directory)
    except ValueError:
        return None, {"code": "suite_report_path_unsafe", "report_id": label}
    if not resolved.is_dir():
        return None, {"code": "suite_report_run_missing", "report_id": label}
    return resolved, None


def _read_object(path: Path) -> dict[str, Any] | None:
    if path.is_symlink() or not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _nightly_report_runs(
    directory: Path, manifest: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    lanes = manifest.get("lanes")
    if not isinstance(lanes, dict):
        return [], [{"code": "suite_report_lanes_missing"}]
    reports: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []

    matrix_lane = lanes.get("matrix")
    if isinstance(matrix_lane, dict):
        cells = matrix_lane.get("cells")
        if not isinstance(cells, list):
            if matrix_lane.get("status") in {"PASS", "INELIGIBLE"}:
                findings.append({"code": "matrix_report_cells_missing"})
        else:
            for cell in cells:
                if not isinstance(cell, dict):
                    findings.append({"code": "matrix_report_cell_malformed"})
                    continue
                cell_id = cell.get("cell_id")
                if (
                    not isinstance(cell_id, str)
                    or not cell_id
                    or Path(cell_id).name != cell_id
                ):
                    findings.append({"code": "matrix_report_cell_malformed"})
                    continue
                report_id = f"matrix:{cell_id}"
                cell_relative = Path("lanes") / "matrix" / "cells" / cell_id
                cell_dir, finding = _safe_suite_child_directory(
                    directory, cell_relative, label=report_id
                )
                if finding is not None:
                    findings.append(finding)
                    continue
                assert cell_dir is not None
                cell_manifest = _read_object(cell_dir / "run-manifest.json")
                if cell_manifest is None:
                    findings.append(
                        {"code": "matrix_report_manifest_missing", "report_id": report_id}
                    )
                    continue
                canonical = cell_manifest.get("canonical_run_dir")
                runner_result = cell.get("runner_result")
                executed = isinstance(runner_result, dict) and runner_result.get(
                    "status"
                ) in {"PASS", "INELIGIBLE"}
                if not isinstance(canonical, str) or not canonical:
                    if executed:
                        findings.append(
                            {
                                "code": "canonical_report_run_not_declared",
                                "report_id": report_id,
                            }
                        )
                    continue
                run_relative = cell_relative / canonical
                run_dir, finding = _safe_suite_child_directory(
                    directory, run_relative, label=report_id
                )
                if finding is not None:
                    findings.append(finding)
                    continue
                reports.append(
                    {
                        "report_id": report_id,
                        "kind": "matrix_cell",
                        "run_dir": run_dir,
                    }
                )

    for lane_id in ("continuity-25", "continuity-50"):
        lane = lanes.get(lane_id)
        if not isinstance(lane, dict):
            continue
        segments = lane.get("segments")
        if not isinstance(segments, list):
            if lane.get("status") in {"PASS", "INELIGIBLE"}:
                findings.append(
                    {"code": "continuity_report_segments_missing", "lane_id": lane_id}
                )
            continue
        for index, segment in enumerate(segments, 1):
            report_id = f"{lane_id}:segment-{index}"
            receipt = segment.get("receipt") if isinstance(segment, dict) else None
            artifact = receipt.get("artifact") if isinstance(receipt, dict) else None
            if not isinstance(artifact, str) or not artifact:
                findings.append(
                    {"code": "continuity_report_receipt_missing", "report_id": report_id}
                )
                continue
            receipt_relative = Path(artifact)
            if receipt_relative.name != "continuity-segment.json":
                findings.append(
                    {"code": "continuity_report_receipt_unsafe", "report_id": report_id}
                )
                continue
            run_relative = Path("lanes") / lane_id / receipt_relative.parent
            run_dir, finding = _safe_suite_child_directory(
                directory, run_relative, label=report_id
            )
            if finding is not None:
                findings.append(finding)
                continue
            reports.append(
                {
                    "report_id": report_id,
                    "kind": "continuity_segment",
                    "run_dir": run_dir,
                }
            )

    unique: dict[Path, dict[str, Any]] = {}
    for report in reports:
        unique.setdefault(Path(report["run_dir"]), report)
    return list(unique.values()), findings


def _verify_suite_report_contract(
    directory: Path, manifest: dict[str, Any]
) -> dict[str, Any]:
    report_runs, findings = _nightly_report_runs(directory, manifest)
    reports: list[dict[str, Any]] = []
    for item in report_runs:
        run_dir = Path(item["run_dir"])
        result = contract.verify_report_contract(run_dir)
        entry = {
            "report_id": item["report_id"],
            "kind": item["kind"],
            "run_dir": run_dir.relative_to(directory).as_posix(),
            **dict(result),
        }
        for key in (
            "report_path",
            "evaluation_report_path",
            "report_completeness_path",
        ):
            value = entry.get(key)
            if value in (None, ""):
                continue
            path = Path(str(value)).resolve()
            try:
                entry[key] = path.relative_to(directory).as_posix()
            except ValueError:
                findings.append(
                    {
                        "code": "suite_report_artifact_escaped",
                        "report_id": item["report_id"],
                        "field": key,
                    }
                )
                entry[key] = None
        reports.append(entry)

    statuses = [str(report.get("status") or "FAIL") for report in reports]
    if findings or "FAIL" in statuses:
        status = "FAIL"
    elif "INELIGIBLE" in statuses:
        status = "INELIGIBLE"
    elif reports and all(value == "PASS" for value in statuses):
        status = "PASS"
    else:
        status = "NOT_RUN"
    verification = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "nightly",
        "status": status,
        "mode": "verify",
        "report_count": len(reports),
        "reports": reports,
        "findings": findings,
    }
    return {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "report_scope": "suite",
        "status": status,
        "suite_report_verification": verification,
    }


def report_run_contract(run_dir: Path | str) -> dict[str, Any]:
    """Compile one playtest report or verify declared nightly child reports."""
    directory = Path(run_dir).resolve()
    manifest_path = directory / "run-manifest.json"
    manifest = _read_object(manifest_path)
    if manifest_path.is_file() and manifest is None:
        raise ValueError("run manifest unreadable")
    if isinstance(manifest, dict) and manifest.get("suite") == "nightly":
        # Nightly child reports are compiled before lane hashes are sealed.  A
        # post-run report command verifies those children without regenerating
        # narrative artifacts behind the signed lane receipts.
        return _verify_suite_report_contract(directory, manifest)
    return dict(contract.compile_report_contract(directory, generate_base_report=True))


def verify_run_contract(run_dir: Path | str) -> dict[str, Any]:
    """Verify the report contract plus any aggregate nightly lane receipts."""
    directory = Path(run_dir).resolve()
    manifest_path = directory / "run-manifest.json"
    if not manifest_path.is_file():
        return dict(contract.verify_report_contract(directory))
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        payload = dict(contract.verify_report_contract(directory))
        payload["status"] = "FAIL"
        payload["lane_artifact_verification"] = {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "status": "FAIL",
            "findings": [{"code": "run_manifest_unreadable"}],
        }
        return payload
    if not isinstance(manifest, dict):
        payload = dict(contract.verify_report_contract(directory))
        payload["status"] = "FAIL"
        payload["lane_artifact_verification"] = {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "status": "FAIL",
            "findings": [{"code": "run_manifest_malformed"}],
        }
        return payload
    lane_artifacts = (
        manifest.get("lane_artifacts") if isinstance(manifest, dict) else None
    )
    lanes = manifest.get("lanes") if isinstance(manifest, dict) else None
    manifest_suite = manifest.get("suite") if isinstance(manifest, dict) else None
    artifact_hashes = manifest.get("artifact_hashes")
    aggregate_summary_path = directory / "aggregate-summary.json"
    has_aggregate_contract = bool(
        manifest_suite == "nightly"
        or manifest.get("case_id") == "suite:nightly"
        or "lanes" in manifest
        or "lane_artifacts" in manifest
        or "aggregation_inputs" in manifest
        or (
            isinstance(artifact_hashes, dict)
            and "aggregate-summary.json" in artifact_hashes
        )
        or aggregate_summary_path.exists()
        or aggregate_summary_path.is_symlink()
    )
    # Aggregate evaluation directories are not gameplay-run artifacts and do
    # not carry playtest.json.  Verify their declared aggregate contract first;
    # only ordinary gameplay runs enter the metadata-requiring report verifier.
    payload = (
        _verify_suite_report_contract(directory, manifest)
        if has_aggregate_contract
        else dict(contract.verify_report_contract(directory))
    )
    if not has_aggregate_contract:
        return payload
    if not (isinstance(lanes, dict) and lanes):
        payload["status"] = "FAIL"
        payload["lane_artifact_verification"] = {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "status": "FAIL",
            "findings": [{"code": "lane_contract_missing"}],
        }
        return payload
    if not (isinstance(lane_artifacts, dict) and lane_artifacts):
        payload["status"] = "FAIL"
        payload["lane_artifact_verification"] = {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "status": "FAIL",
            "findings": [{"code": "lane_receipts_missing"}],
        }
        return payload
    required_owned_artifacts: dict[str, dict[str, str]] = {}
    contract_findings: list[dict[str, Any]] = []
    canonical_registered_status: str | None = None
    if isinstance(lanes, dict):
        canonical_registered_status, projection_findings = (
            _registered_case_projection_findings(manifest, lanes)
        )
        contract_findings.extend(projection_findings)
    contract_findings.extend(
        _aggregate_contract_findings(directory, manifest, lanes)
    )
    if (
        manifest_suite == "nightly"
        and isinstance(lanes, dict)
        and isinstance(lane_artifacts, dict)
    ):
        registered_lane = lanes.get("registered-cases")
        if "registered-cases" not in lanes:
            contract_findings.append({"code": "registered_cases_lane_missing"})
        if "registered-cases" not in lane_artifacts:
            contract_findings.append({"code": "registered_cases_receipt_missing"})
        expected_topology = (
            NIGHTLY_SHORT_CIRCUIT_LANE_IDS
            if canonical_registered_status == "FAIL"
            else NIGHTLY_FULL_LANE_IDS
        )
        lane_ids = set(lanes)
        receipt_ids = set(lane_artifacts)
        if lane_ids != expected_topology or receipt_ids != expected_topology:
            contract_findings.append(
                {
                    "code": "nightly_lane_topology_mismatch",
                    "expected_lane_ids": sorted(expected_topology),
                    "lane_ids": sorted(str(lane_id) for lane_id in lane_ids),
                    "receipt_ids": sorted(
                        str(lane_id) for lane_id in receipt_ids
                    ),
                }
            )
    if isinstance(lanes, dict) and "registered-cases" in lanes:
        try:
            required_owned_artifacts["registered-cases"] = (
                pipeline.declared_registered_case_artifacts(manifest, lanes)
            )
        except ValueError:
            contract_findings.append(
                {"code": "registered_case_artifact_contract_malformed"}
            )
    lane_verification = pipeline.verify_lane_artifacts(
        directory,
        lane_artifacts,
        expected_lanes=lanes if isinstance(lanes, dict) else None,
        required_owned_artifacts=required_owned_artifacts,
    )
    lane_verification["findings"].extend(contract_findings)
    if isinstance(lanes, dict) and isinstance(lane_artifacts, dict):
        expected_lanes = set(lanes)
        received_lanes = set(lane_artifacts)
        for lane_id in sorted(expected_lanes - received_lanes, key=str):
            lane_verification["findings"].append(
                {"code": "lane_receipt_missing", "lane_id": lane_id}
            )
        for lane_id in sorted(received_lanes - expected_lanes, key=str):
            lane_verification["findings"].append(
                {"code": "lane_receipt_unbound", "lane_id": lane_id}
            )
        if lane_verification["findings"]:
            lane_verification["status"] = "FAIL"
    payload["lane_artifact_verification"] = lane_verification
    if lane_verification.get("status") != "PASS":
        payload["status"] = "FAIL"
    return payload


def _missing_capabilities(
    manifest: dict[str, Any], suite_definition: dict[str, Any]
) -> list[str]:
    implemented = {
        str(item) for item in manifest.get("implemented_capabilities", [])
    }
    required = {
        str(item) for item in suite_definition.get("required_capabilities", [])
    }
    return sorted(required - implemented)


def _base_run_manifest(
    *,
    manifest: dict[str, Any],
    suite: str,
    host_id: str,
    run_id: str,
    root: Path,
    started_at: str,
) -> dict[str, Any]:
    payload = {
        "schema_version": 1,
        "eval_spec": manifest["eval_spec"],
        "benchmark_version": manifest["benchmark_version"],
        "report_schema_version": manifest["report_schema_version"],
        "run_id": run_id,
        "suite": suite,
        "case_id": f"suite:{suite}",
        "host_id": host_id,
        "seed": None,
        "initial_state_sha256": None,
        "candidate_commit": _git_head(root),
        "started_at": started_at,
        "completed_at": None,
        "status": "NOT_RUN",
        "case_ids": [],
        "case_results_path": None,
        "commands": [],
        "artifact_hashes": {},
    }
    pack_path = root / packs.PACK_REGISTRY_PATH
    if pack_path.is_file():
        registry = packs.load_benchmark_pack_registry(root, manifest=manifest)
        payload["benchmark_pack_registry_version"] = registry["registry_version"]
        payload["benchmark_pack_registry_sha256"] = _sha256(pack_path)
        payload["benchmark_pack_ids"] = [
            pack["pack_id"]
            for pack in registry["packs"]
            if suite in pack["suites"]
        ]
    return payload


def _run_registered_cases(
    *,
    root: Path,
    out: Path,
    manifest: dict[str, Any],
    suite: str,
    timeout: float | None,
) -> tuple[str, list[dict[str, Any]], Path]:
    registry = cases.load_case_registry(root)
    selected = cases.resolve_suite_cases(manifest, registry, suite)
    if not selected:
        raise ValueError(f"suite has no registered cases: {suite}")
    implemented = {
        str(value) for value in manifest.get("implemented_capabilities", [])
    }
    env = {"PYTHONDONTWRITEBYTECODE": "1"}
    results = [
        cases.run_case(
            case,
            root=root,
            output=out,
            implemented_capabilities=implemented,
            env=env,
            timeout=timeout,
        )
        for case in selected
    ]
    status = cases.aggregate_suite_status(results)
    payload = {
        "schema_version": 1,
        "eval_spec": manifest["eval_spec"],
        "benchmark_version": manifest["benchmark_version"],
        "registry_version": registry["registry_version"],
        "suite": suite,
        "status": status,
        "cases": results,
    }
    path = out / "case-results.json"
    _write_json(path, payload)
    return status, results, path


def _run_legacy_commands(
    *,
    root: Path,
    out: Path,
    commands: list[list[str]],
) -> tuple[str, list[dict[str, Any]]]:
    command_results: list[dict[str, Any]] = []
    all_passed = True
    env = dict(os.environ)
    env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    for index, command in enumerate(commands, start=1):
        started = time.monotonic()
        try:
            proc = subprocess.run(
                command,
                cwd=root,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            returncode = int(proc.returncode)
            stdout = proc.stdout or ""
            stderr = proc.stderr or ""
        except OSError as exc:
            returncode = 127
            stdout = ""
            stderr = f"{type(exc).__name__}: {exc}"
        duration = time.monotonic() - started
        stdout_path = out / f"command-{index:02d}.stdout.log"
        stderr_path = out / f"command-{index:02d}.stderr.log"
        stdout_path.write_text(stdout, encoding="utf-8")
        stderr_path.write_text(stderr, encoding="utf-8")
        command_result = {
            "index": index,
            "argv": list(command),
            "returncode": returncode,
            "duration_seconds": round(duration, 6),
            "stdout_path": stdout_path.name,
            "stderr_path": stderr_path.name,
            "stdout_sha256": _sha256(stdout_path),
            "stderr_sha256": _sha256(stderr_path),
        }
        command_results.append(command_result)
        if returncode != 0:
            all_passed = False
            break
    status = "PASS" if all_passed and len(command_results) == len(commands) else "FAIL"
    return status, command_results


def run_suite(
    *,
    root: Path,
    suite: str,
    output: Path | None,
    host_id: str,
    baseline: Path | None = None,
    matrix_limit: int | None = None,
    timeout: float | None = None,
    continuity_timeout: float | None = None,
    matrix_workers: int | None = None,
    chapter_run: Path | None = None,
    holdout_bundle: Path | None = None,
    calibration_reviews: Path | None = None,
) -> dict[str, Any]:
    root = root.resolve()
    manifest = contract.load_benchmark_manifest(root)
    suite_definition = contract.resolve_suite(manifest, suite)
    out = (output or _default_output(root, suite)).resolve()
    out.mkdir(parents=True, exist_ok=True)
    started_at = _utc_now()
    run_id = out.name
    run_manifest = _base_run_manifest(
        manifest=manifest,
        suite=suite,
        host_id=host_id,
        run_id=run_id,
        root=root,
        started_at=started_at,
    )
    manifest_path = out / "run-manifest.json"
    _write_json(manifest_path, run_manifest)

    missing = _missing_capabilities(manifest, suite_definition)
    if missing:
        run_manifest.update(
            {
                "completed_at": _utc_now(),
                "status": "NOT_RUN",
                "missing_capabilities": missing,
                "reason": "suite requires capabilities not implemented by this benchmark version",
            }
        )
        _write_json(manifest_path, run_manifest)
        return run_manifest

    if suite == "release":
        external = pipeline.run_release_external_gates(
            root=root,
            output=out,
            chapter_run=chapter_run,
            holdout_bundle=holdout_bundle,
            calibration_reviews=calibration_reviews,
            judge_requests=[],
        )
        run_manifest.update(
            {
                "completed_at": _utc_now(),
                "status": external["status"],
                "missing_capabilities": [],
                "missing": list(external.get("missing") or []),
                "not_run_reasons": list(external.get("not_run_reasons") or []),
                "lanes": external.get("lanes") or {},
                "lane_statuses": external.get("lane_statuses") or {},
                "human_review_bundle_path": external.get("human_review_bundle_path"),
                "artifact_hashes": dict(external.get("artifact_hashes") or {}),
                "reason": (
                    "release external evidence incomplete"
                    if external["status"] == "NOT_RUN"
                    else None
                ),
            }
        )
        if run_manifest["reason"] is None:
            run_manifest.pop("reason", None)
        _write_json(manifest_path, run_manifest)
        return run_manifest

    registry_path = root / cases.CASE_REGISTRY_PATH
    if registry_path.is_file():
        status, case_results, case_results_path = _run_registered_cases(
            root=root,
            out=out,
            manifest=manifest,
            suite=suite,
            timeout=timeout,
        )
        artifact_hashes: dict[str, str] = {
            case_results_path.name: _sha256(case_results_path)
        }
        for result in case_results:
            artifact_hashes.update(
                {
                    str(path): str(digest)
                    for path, digest in (result.get("artifact_hashes") or {}).items()
                }
            )
        extended: dict[str, Any] | None = None
        if suite == "nightly":
            case_payload = json.loads(case_results_path.read_text(encoding="utf-8"))
            extended = pipeline.run_extended_suite(
                root=root,
                suite=suite,
                output=out,
                case_results=case_payload,
                registered_case_artifacts=dict(artifact_hashes),
                baseline=baseline,
                matrix_limit=matrix_limit,
                timeout=timeout,
                continuity_timeout=continuity_timeout,
                matrix_workers=matrix_workers,
            )
            status = str(extended["status"])
            artifact_hashes.update(
                {
                    str(path): str(digest)
                    for path, digest in extended["artifact_hashes"].items()
                }
            )
        update = {
            "completed_at": _utc_now(),
            "status": status,
            "missing_capabilities": [],
            "case_ids": [str(result["case_id"]) for result in case_results],
            "case_results_path": case_results_path.name,
            "case_results": case_results,
            "commands": [],
            "artifact_hashes": artifact_hashes,
        }
        if extended is not None:
            update.update(
                {
                    "lanes": extended["lanes"],
                    "lane_artifacts": extended["lane_artifacts"],
                    "aggregation_inputs": extended["aggregation_inputs"],
                    "not_run_reasons": extended["not_run_reasons"],
                    "diagnostic": extended["diagnostic"],
                    "metric_results_path": extended["metric_results_path"],
                    "execution_budgets": extended["execution_budgets"],
                }
            )
        run_manifest.update(
            update
        )
        _write_json(manifest_path, run_manifest)
        return run_manifest

    commands = suite_definition.get("commands") or []
    if not commands:
        run_manifest.update(
            {
                "completed_at": _utc_now(),
                "status": "NOT_RUN",
                "missing_capabilities": [],
                "reason": "suite has no registered or legacy executable cases",
            }
        )
        _write_json(manifest_path, run_manifest)
        return run_manifest

    status, command_results = _run_legacy_commands(
        root=root,
        out=out,
        commands=commands,
    )
    artifact_hashes = {
        result["stdout_path"]: result["stdout_sha256"]
        for result in command_results
    }
    artifact_hashes.update(
        {
            result["stderr_path"]: result["stderr_sha256"]
            for result in command_results
        }
    )
    run_manifest.update(
        {
            "completed_at": _utc_now(),
            "status": status,
            "missing_capabilities": [],
            "commands": command_results,
            "artifact_hashes": artifact_hashes,
        }
    )
    _write_json(manifest_path, run_manifest)
    return run_manifest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="coc_eval.py",
        description="Run and verify the versioned COC Keeper evaluation contract.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    run = subparsers.add_parser("run", help="run a named canonical evaluation suite")
    run.add_argument("--suite", required=True)
    run.add_argument("--root", type=Path, default=Path.cwd())
    run.add_argument("--output", type=Path)
    run.add_argument("--baseline", type=Path)
    run.add_argument("--matrix-limit", type=_positive_int)
    run.add_argument(
        "--timeout",
        type=_positive_float,
        help="override both versioned matrix runner and judge timeouts",
    )
    run.add_argument(
        "--matrix-workers",
        type=_positive_int,
        help="override the versioned bounded matrix worker count",
    )
    run.add_argument(
        "--continuity-timeout",
        type=_positive_float,
        help=(
            "nightly only: override each continuity lane's versioned total "
            "execution budget"
        ),
    )
    run.add_argument(
        "--chapter-run",
        type=Path,
        help="release only: directory containing chapter-transition evidence",
    )
    run.add_argument(
        "--holdout-bundle",
        type=Path,
        help="release only: directory containing separately supplied holdout artifacts",
    )
    run.add_argument(
        "--calibration-reviews",
        type=Path,
        help="release only: path to genuine human calibration reviews JSON",
    )
    run.add_argument(
        "--host-id",
        default=os.environ.get("COC_EVAL_HOST_ID", "local"),
        choices=("codex", "zcode", "cursor", "ci", "local"),
    )

    report = subparsers.add_parser(
        "report", help="generate the base report and apply report schema v2"
    )
    report.add_argument("run_dir", type=Path)

    verify = subparsers.add_parser(
        "verify", help="recompute report completeness from current source evidence"
    )
    verify.add_argument("run_dir", type=Path)

    compare_parser = subparsers.add_parser(
        "compare",
        help="compare baseline and candidate identities, hard gates, and dimensions",
    )
    compare_parser.add_argument("--baseline", type=Path, required=True)
    compare_parser.add_argument("--candidate", type=Path, required=True)
    compare_parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="repository root used to load evaluation thresholds",
    )

    baseline = subparsers.add_parser(
        "baseline", help="write a normalized baseline manifest from a verified run"
    )
    baseline.add_argument("--from", dest="source", type=Path, required=True)
    baseline.add_argument("--output", type=Path, required=True)

    matrix_parser = subparsers.add_parser(
        "matrix",
        help="plan or execute the AI-player persona matrix for nightly|release",
    )
    matrix_parser.add_argument(
        "--suite",
        required=True,
        choices=("nightly", "release"),
    )
    matrix_parser.add_argument("--root", type=Path, default=Path.cwd())
    matrix_parser.add_argument("--output", type=Path)
    matrix_parser.add_argument(
        "--configuration",
        type=Path,
        help=(
            "diagnostic-only custom matrix JSON; it may reuse one evaluation "
            "profile across multiple modules but is not an official named-suite claim"
        ),
    )
    matrix_parser.add_argument(
        "--baseline",
        type=Path,
        help="baseline matrix directory for paired semantic comparison",
    )
    matrix_parser.add_argument(
        "--plan-only",
        action="store_true",
        help="write matrix-plan.json without executing READY cells",
    )
    matrix_parser.add_argument("--runner-timeout", type=_positive_float)
    matrix_parser.add_argument("--judge-timeout", type=_positive_float)
    matrix_parser.add_argument("--max-workers", type=_positive_int)

    calibrate = subparsers.add_parser(
        "calibrate",
        help="validate blinded human calibration reviews and compute agreement",
    )
    calibrate.add_argument(
        "--reviews",
        type=Path,
        required=True,
        help="path to a reviews JSON file or directory of review JSON files",
    )
    calibrate.add_argument("--root", type=Path, default=Path.cwd())

    holdouts = subparsers.add_parser(
        "holdouts",
        help="validate a separately supplied holdout bundle against the repository manifest",
    )
    holdouts.add_argument(
        "--manifest",
        type=Path,
        help="holdout manifest path (defaults to evaluation/spec/v1/holdout-manifest.json)",
    )
    holdouts.add_argument(
        "--bundle",
        type=Path,
        required=True,
        help="directory containing holdout artifacts referenced by the manifest",
    )
    holdouts.add_argument("--root", type=Path, default=Path.cwd())

    replay_parser = subparsers.add_parser(
        "replay",
        help="run one versioned fixed-replay case through the canonical eval CLI",
    )
    replay_parser.add_argument("--case", type=Path, required=True)
    replay_parser.add_argument("--output", type=Path, required=True)
    replay_parser.add_argument("--root", type=Path, default=Path.cwd())

    route_parser = subparsers.add_parser(
        "route-compare",
        help="compare two actual-play route ledgers with bound semantic evidence",
    )
    route_parser.add_argument(
        "--run-a", type=Path, required=True,
        help="spoiler-aware run directory containing artifacts/route-ledger.json",
    )
    route_parser.add_argument(
        "--run-b", type=Path, required=True,
        help="spoiler-blind run directory containing artifacts/route-ledger.json",
    )
    route_parser.add_argument("--semantic-result", type=Path, required=True)
    route_parser.add_argument("--request", type=Path)
    route_parser.add_argument("--output", type=Path, required=True)
    return parser


def _read_json_object(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise FileNotFoundError(f"{label} not found: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must contain a JSON object")
    return payload


def _exit_code(payload: dict[str, Any]) -> int:
    return EXIT_BY_STATUS.get(str(payload.get("status") or "FAIL"), 1)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            payload = run_suite(
                root=args.root,
                suite=args.suite,
                output=args.output,
                host_id=args.host_id,
                baseline=args.baseline,
                matrix_limit=args.matrix_limit,
                timeout=args.timeout,
                continuity_timeout=args.continuity_timeout,
                matrix_workers=args.matrix_workers,
                chapter_run=getattr(args, "chapter_run", None),
                holdout_bundle=getattr(args, "holdout_bundle", None),
                calibration_reviews=getattr(args, "calibration_reviews", None),
            )
        elif args.command == "report":
            payload = report_run_contract(args.run_dir)
        elif args.command == "verify":
            payload = verify_run_contract(args.run_dir)
        elif args.command == "compare":
            payload = compare.compare_cli_runs(
                args.baseline,
                args.candidate,
                root=args.root,
                identity_compare=contract.compare_run_manifests,
            )
        elif args.command == "baseline":
            payload = contract.write_baseline_manifest(
                args.source, args.output
            )
        elif args.command == "matrix":
            payload = matrix.run_matrix_cli(
                root=args.root,
                suite=args.suite,
                output=args.output,
                plan_only=bool(args.plan_only),
                configuration=args.configuration,
                baseline=args.baseline,
                runner_timeout_s=args.runner_timeout,
                judge_timeout_s=args.judge_timeout,
                max_workers=args.max_workers,
            )
        elif args.command == "calibrate":
            payload = calibration.run_calibrate_cli(
                reviews=args.reviews,
                root=args.root,
            )
        elif args.command == "holdouts":
            manifest = args.manifest
            if manifest is None:
                manifest = (
                    Path(args.root) / "evaluation" / "spec" / "v1" / "holdout-manifest.json"
                )
            payload = calibration.run_holdouts_cli(
                manifest=manifest,
                bundle=args.bundle,
                root=args.root,
            )
        elif args.command == "replay":
            payload = replay.run_fixed_replay(
                _read_json_object(args.case, "fixed replay case"),
                root=args.root,
                output=args.output,
            )
        elif args.command == "route-compare":
            args.output.mkdir(parents=True, exist_ok=True)
            outcome = route_compare.compare_routes(
                args.output,
                _read_json_object(
                    args.run_a / "artifacts" / "route-ledger.json",
                    "run A route ledger",
                ),
                _read_json_object(
                    args.run_b / "artifacts" / "route-ledger.json",
                    "run B route ledger",
                ),
                _read_json_object(args.semantic_result, "route semantic result"),
                request=(
                    _read_json_object(args.request, "route comparison request")
                    if args.request else None
                ),
            )
            payload = {"schema_version": 1, "status": "PASS", **outcome}
        else:
            raise ValueError(f"unsupported command: {args.command}")
    except (ValueError, FileNotFoundError, RuntimeError) as exc:
        sys.stderr.write(f"{exc}\n")
        return 1
    _json_print(payload)
    return _exit_code(payload)


if __name__ == "__main__":
    raise SystemExit(main())
