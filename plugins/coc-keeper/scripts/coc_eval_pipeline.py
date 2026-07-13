#!/usr/bin/env python3
"""Lane-aware orchestration for canonical model-backed evaluation suites."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable


SCRIPT_DIR = Path(__file__).resolve().parent

import coc_eval_longrun as longrun
import coc_eval_matrix as matrix
import coc_completion_audit as completion_audit


EVAL_SPEC = "eval-spec-v1"
LONG_MEMORY_CASE = Path("evaluation/spec/v1/cases/long-memory.json")
CONTINUITY_LANES = ("continuity-25", "continuity-50")
MODEL_ROLES = {
    "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
    "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
}
VALID_STATUSES = frozenset(
    {"PASS", "FAIL", "INELIGIBLE", "NOT_RUN", "NON_COMPARABLE"}
)
STATUS_RANK = {
    "FAIL": 5,
    "INELIGIBLE": 4,
    "NON_COMPARABLE": 3,
    "NOT_RUN": 2,
    "PASS": 1,
}


def _write_text_atomic(path: Path, text: str) -> Path:
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
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return path


def _write_json_atomic(path: Path, payload: Any) -> Path:
    return _write_text_atomic(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"unreadable JSON: {path}: {exc}") from exc


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _positive_number(value: Any, *, label: str) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
        or float(value) <= 0
    ):
        raise ValueError(f"{label} must be positive")
    return float(value)


def aggregate_lane_status(lanes: dict[str, dict[str, Any]]) -> str:
    """Return the canonical worst status without collapsing nonterminal states."""
    if not lanes:
        return "NOT_RUN"
    statuses: list[str] = []
    for lane_id, lane in lanes.items():
        if not isinstance(lane, dict):
            raise ValueError(f"lane result must be an object: {lane_id}")
        status = lane.get("status")
        if status not in VALID_STATUSES:
            raise ValueError(f"invalid lane status for {lane_id}: {status}")
        statuses.append(str(status))
    return max(statuses, key=STATUS_RANK.__getitem__)


def _matrix_status(results: dict[str, Any]) -> str:
    cells = results.get("cells")
    if not isinstance(cells, list) or not cells:
        return "NOT_RUN"
    return aggregate_lane_status(
        {
            f"cell-{index}": cell
            for index, cell in enumerate(cells, start=1)
            if isinstance(cell, dict)
        }
    )


def _limited_matrix_plan(plan: dict[str, Any], limit: int | None) -> dict[str, Any]:
    if limit is None:
        return plan
    if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
        raise ValueError("matrix_limit must be a positive integer")
    limited = copy.deepcopy(plan)
    cells = list(limited.get("cells") or [])[:limit]
    limited["cells"] = cells
    limited["cell_count"] = len(cells)
    limited["ready_count"] = sum(
        1 for cell in cells if isinstance(cell, dict) and cell.get("status") == "READY"
    )
    limited["not_run_count"] = sum(
        1
        for cell in cells
        if isinstance(cell, dict) and cell.get("status") == "NOT_RUN"
    )
    return limited


def _baseline_matrix_dir(baseline: Path | str | None) -> Path | None:
    if baseline is None:
        return None
    root = Path(baseline).resolve()
    nested = root / "lanes" / "matrix"
    if (nested / "matrix-plan.json").is_file():
        return nested
    return root


def run_matrix(
    *,
    root: Path | str,
    suite: str,
    output: Path | str,
    baseline: Path | str | None,
    matrix_limit: int | None,
    timeout: float,
) -> dict[str, Any]:
    """Execute the real matrix route and add its canonical lane status."""
    timeout_s = _positive_number(timeout, label="timeout")
    plan = matrix.build_matrix_plan(root=root, suite=suite)
    plan = _limited_matrix_plan(plan, matrix_limit)
    results = matrix.execute_matrix_plan(
        plan,
        root=root,
        output=output,
        baseline_dir=_baseline_matrix_dir(baseline),
        judge_timeout_s=timeout_s,
        runner_timeout_s=timeout_s,
    )
    payload = dict(results)
    declared_cells = {
        str(cell.get("cell_id")): cell
        for cell in plan.get("cells") or []
        if isinstance(cell, dict) and isinstance(cell.get("cell_id"), str)
    }
    decorated_cells: list[dict[str, Any]] = []
    for raw_cell in payload.get("cells") or []:
        if not isinstance(raw_cell, dict):
            continue
        cell = dict(raw_cell)
        declared = declared_cells.get(str(cell.get("cell_id")))
        if declared is not None:
            cell["judge_model"] = copy.deepcopy(declared.get("judge_model") or {})
        decorated_cells.append(cell)
    payload["cells"] = decorated_cells
    payload["status"] = _matrix_status(payload)
    if matrix_limit is not None:
        payload["diagnostic"] = {"matrix_limit": matrix_limit}
    return payload


def _continuity_lane(root: Path, lane_id: str) -> dict[str, Any]:
    payload = _read_json(root / LONG_MEMORY_CASE)
    if (
        not isinstance(payload, dict)
        or payload.get("schema_version") != 1
        or payload.get("eval_spec") != EVAL_SPEC
    ):
        raise ValueError("long-memory case contract mismatch")
    lanes = payload.get("lanes")
    if not isinstance(lanes, list):
        raise ValueError("long-memory lanes must be a list")
    for lane in lanes:
        if isinstance(lane, dict) and lane.get("lane_id") == lane_id:
            return dict(lane)
    raise ValueError(f"continuity lane missing: {lane_id}")


def run_continuity(
    lane_id: str,
    *,
    root: Path | str,
    output: Path | str,
    workspace: Path | str,
    timeout: float,
) -> dict[str, Any]:
    """Execute one exact GLM/Luna continuity lane through the canonical runner."""
    timeout_s = _positive_number(timeout, label="timeout")
    lane = _continuity_lane(Path(root).resolve(), lane_id)
    if not hasattr(os, "fork") or not hasattr(os, "setsid"):
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "lane_id": lane_id,
            "status": "NOT_RUN",
            "not_run_reasons": ["lane_supervisor_unsupported"],
        }
    descriptor, sidecar_name = tempfile.mkstemp(
        prefix=f"coc-eval-{lane_id}-", suffix=".json"
    )
    os.close(descriptor)
    sidecar = Path(sidecar_name)
    pid = os.fork()
    if pid == 0:
        exit_code = 1
        try:
            os.setsid()
            result = longrun.run_continuity_lane(
                lane=lane,
                workspace=workspace,
                output=output,
                model_roles=copy.deepcopy(MODEL_ROLES),
            )
            _write_json_atomic(sidecar, {"ok": True, "result": result})
            exit_code = 0
        except BaseException as exc:
            try:
                _write_json_atomic(
                    sidecar,
                    {
                        "ok": False,
                        "error_type": type(exc).__name__,
                    },
                )
            except BaseException:
                pass
        finally:
            os._exit(exit_code)

    timed_out = False
    child_status: int | None = None
    deadline = time.monotonic() + timeout_s
    try:
        while True:
            try:
                waited, status = os.waitpid(pid, os.WNOHANG)
            except InterruptedError:
                continue
            if waited == pid:
                child_status = status
                break
            if time.monotonic() >= deadline:
                timed_out = True
                _terminate_child_process_group(pid)
                break
            time.sleep(min(0.02, max(0.0, deadline - time.monotonic())))
        if timed_out:
            return {
                "schema_version": 1,
                "eval_spec": EVAL_SPEC,
                "lane_id": lane_id,
                "status": "NOT_RUN",
                "not_run_reasons": ["execution_timeout"],
                "timeout_phase": "continuity_lane",
                "timeout_seconds": timeout_s,
            }
        payload = _read_json(sidecar)
        if (
            child_status is None
            or not os.WIFEXITED(child_status)
            or os.WEXITSTATUS(child_status) != 0
            or not isinstance(payload, dict)
            or payload.get("ok") is not True
            or not isinstance(payload.get("result"), dict)
        ):
            error_type = (
                str(payload.get("error_type") or "RuntimeError")
                if isinstance(payload, dict)
                else "RuntimeError"
            )
            if error_type == "ValueError":
                raise ValueError(f"continuity lane failed: {lane_id}")
            raise RuntimeError(f"continuity lane failed: {lane_id}")
        return dict(payload["result"])
    finally:
        sidecar.unlink(missing_ok=True)


def _terminate_child_process_group(pid: int) -> None:
    """Stop and reap a supervised fork plus descendants in its session."""
    try:
        group_id = os.getpgid(pid)
    except ProcessLookupError:
        group_id = None
    try:
        if group_id == pid:
            os.killpg(group_id, signal.SIGTERM)
        else:
            os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    grace_deadline = time.monotonic() + 0.5
    leader_reaped = False
    while time.monotonic() < grace_deadline:
        if not leader_reaped:
            try:
                waited, _status = os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                leader_reaped = True
            except InterruptedError:
                waited = 0
            else:
                if waited == pid:
                    leader_reaped = True
        time.sleep(0.02)
    # The supervised leader may exit while a descendant ignores SIGTERM.
    # Always target the original session group after the grace period.
    try:
        if group_id == pid:
            os.killpg(group_id, signal.SIGKILL)
        else:
            os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    if not leader_reaped:
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass


def _unavailable_lane(lane_id: str, exc: BaseException) -> dict[str, Any]:
    if isinstance(exc, ValueError):
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "lane_id": lane_id,
            "status": "FAIL",
            "findings": ["lane_contract_error"],
        }
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "lane_id": lane_id,
        "status": "NOT_RUN",
        "not_run_reasons": [f"lane_unavailable:{type(exc).__name__}"],
    }


def _call_lane(lane_id: str, callback: Callable[..., dict[str, Any]], **kwargs: Any):
    try:
        result = callback(**kwargs)
    except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as exc:
        return _unavailable_lane(lane_id, exc)
    if not isinstance(result, dict) or result.get("status") not in VALID_STATUSES:
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "lane_id": lane_id,
            "status": "FAIL",
            "findings": ["invalid_lane_result"],
        }
    return dict(result)


def _safe_lane_root(out: Path, lane_id: str, *, create: bool) -> Path:
    if not lane_id or Path(lane_id).name != lane_id:
        raise ValueError(f"unsafe lane id: {lane_id}")
    out = out.resolve()
    lanes_root = out / "lanes"
    if lanes_root.is_symlink():
        raise ValueError("lane artifact root must not be a symlink")
    if lanes_root.exists() and not lanes_root.is_dir():
        raise ValueError("lane artifact root must be a directory")
    lane_root = lanes_root / lane_id
    if lane_root.is_symlink():
        raise ValueError(f"lane artifact root must not be a symlink: {lane_id}")
    if lane_root.exists() and not lane_root.is_dir():
        raise ValueError(f"lane artifact root must be a directory: {lane_id}")
    resolved = lane_root.resolve()
    try:
        resolved.relative_to(out)
    except ValueError as exc:
        raise ValueError(f"lane artifact root escapes output: {lane_id}") from exc
    if create:
        lane_root.mkdir(parents=True, exist_ok=True)
        if lanes_root.is_symlink() or lane_root.is_symlink():
            raise ValueError(f"lane artifact root must not be a symlink: {lane_id}")
    return lane_root


def _lane_files(out: Path, lane_id: str) -> dict[str, str]:
    lane_root = _safe_lane_root(out, lane_id, create=False)
    resolved_lane_root = lane_root.resolve()
    artifacts: dict[str, str] = {}
    for path in sorted(lane_root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"lane artifact must not be a symlink: {lane_id}")
        try:
            path.resolve().relative_to(resolved_lane_root)
        except ValueError as exc:
            raise ValueError(f"lane artifact escapes lane root: {lane_id}") from exc
        if path.is_file():
            artifacts[path.relative_to(out).as_posix()] = _sha256_file(path)
    return artifacts


def _persist_lane(out: Path, lane_id: str, result: dict[str, Any]) -> dict[str, Any]:
    lane_root = _safe_lane_root(out, lane_id, create=True)
    path = lane_root / "lane-result.json"
    _write_json_atomic(path, result)
    artifacts = _lane_files(out, lane_id)
    relative = path.relative_to(out).as_posix()
    return {
        "path": relative,
        "sha256": artifacts[relative],
        "artifacts": artifacts,
    }


def run_completion_audit(
    *,
    root: Path | str,
    suite: str,
    case_results: dict[str, Any],
    matrix_results: dict[str, Any],
    continuity_results: dict[str, Any],
) -> dict[str, Any]:
    """Evaluate the executed lanes as evidence, not merely observed IDs."""
    result = completion_audit.assess_eval_contract_coverage(
        root,
        suite=suite,
        case_results=case_results,
        matrix_results=matrix_results,
        continuity_results=continuity_results,
    )
    payload = dict(result)
    if payload.get("status") == "NOT_RUN" and not payload.get("not_run_reasons"):
        payload["not_run_reasons"] = ["coverage_incomplete"]
    return payload


def _nested_not_run_reasons(lanes: dict[str, dict[str, Any]]) -> list[str]:
    reasons: list[str] = []
    for lane_id, lane in lanes.items():
        candidates = list(lane.get("not_run_reasons") or [])
        for cell in lane.get("cells") or []:
            if isinstance(cell, dict):
                candidates.extend(cell.get("not_run_reasons") or [])
        for reason in candidates:
            if isinstance(reason, str) and reason:
                namespaced = f"{lane_id}:{reason}"
                if namespaced not in reasons:
                    reasons.append(namespaced)
    return reasons


def verify_lane_artifacts(
    output: Path | str, lane_artifacts: dict[str, Any]
) -> dict[str, Any]:
    """Recompute outer lane receipts and detect missing, changed, or extra files."""
    out = Path(output).resolve()
    findings: list[dict[str, Any]] = []
    if not isinstance(lane_artifacts, dict):
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "FAIL",
            "findings": [{"code": "lane_receipts_malformed"}],
        }
    for lane_id, receipt in lane_artifacts.items():
        if (
            not isinstance(lane_id, str)
            or not lane_id
            or Path(lane_id).name != lane_id
            or not isinstance(receipt, dict)
            or not isinstance(receipt.get("artifacts"), dict)
        ):
            findings.append({"code": "lane_receipt_malformed", "lane_id": lane_id})
            continue
        expected = receipt["artifacts"]
        try:
            actual = _lane_files(out, lane_id)
        except (OSError, ValueError):
            findings.append({"code": "lane_artifact_unsafe", "lane_id": lane_id})
            continue
        expected_paths = set(expected)
        actual_paths = set(actual)
        for relative in sorted(expected_paths - actual_paths):
            findings.append(
                {
                    "code": "lane_artifact_missing",
                    "lane_id": lane_id,
                    "path": relative,
                }
            )
        for relative in sorted(actual_paths - expected_paths):
            findings.append(
                {
                    "code": "lane_artifact_unbound",
                    "lane_id": lane_id,
                    "path": relative,
                }
            )
        for relative in sorted(expected_paths & actual_paths):
            if expected.get(relative) != actual[relative]:
                findings.append(
                    {
                        "code": "lane_artifact_hash_mismatch",
                        "lane_id": lane_id,
                        "path": relative,
                    }
                )
        primary = receipt.get("path")
        if (
            not isinstance(primary, str)
            or receipt.get("sha256") != expected.get(primary)
        ):
            findings.append(
                {"code": "lane_primary_receipt_mismatch", "lane_id": lane_id}
            )
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": "FAIL" if findings else "PASS",
        "findings": findings,
    }


def run_extended_suite(
    *,
    root: Path | str,
    suite: str,
    output: Path | str,
    case_results: dict[str, Any],
    baseline: Path | str | None = None,
    matrix_limit: int | None = None,
    timeout: float = 120.0,
) -> dict[str, Any]:
    """Run nightly's registered, matrix, and continuity lanes under one run."""
    if suite != "nightly":
        raise ValueError(f"extended suite is not implemented for: {suite}")
    _positive_number(timeout, label="timeout")
    if matrix_limit is not None and (
        isinstance(matrix_limit, bool)
        or not isinstance(matrix_limit, int)
        or matrix_limit <= 0
    ):
        raise ValueError("matrix_limit must be a positive integer")
    repo = Path(root).resolve()
    out = Path(output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    lanes: dict[str, dict[str, Any]] = {
        "registered-cases": dict(case_results),
    }
    lane_artifacts = {
        "registered-cases": _persist_lane(
            out, "registered-cases", lanes["registered-cases"]
        )
    }

    if lanes["registered-cases"].get("status") != "FAIL":
        matrix_output = _safe_lane_root(out, "matrix", create=True)
        lanes["matrix"] = _call_lane(
            "matrix",
            run_matrix,
            root=repo,
            suite=suite,
            output=matrix_output,
            baseline=baseline,
            matrix_limit=matrix_limit,
            timeout=timeout,
        )
        lane_artifacts["matrix"] = _persist_lane(out, "matrix", lanes["matrix"])
        for lane_id in CONTINUITY_LANES:
            lane_output = _safe_lane_root(out, lane_id, create=True)
            lanes[lane_id] = _call_lane(
                lane_id,
                lambda **kwargs: run_continuity(lane_id, **kwargs),
                root=repo,
                output=lane_output,
                workspace=out / "workspaces" / lane_id,
                timeout=timeout,
            )
            lane_artifacts[lane_id] = _persist_lane(out, lane_id, lanes[lane_id])
        continuity_results = {
            lane_id: lanes[lane_id] for lane_id in CONTINUITY_LANES
        }
        lanes["completion-audit"] = _call_lane(
            "completion-audit",
            run_completion_audit,
            root=repo,
            suite=suite,
            case_results=case_results,
            matrix_results=lanes["matrix"],
            continuity_results=continuity_results,
        )
        lane_artifacts["completion-audit"] = _persist_lane(
            out, "completion-audit", lanes["completion-audit"]
        )

    status = aggregate_lane_status(lanes)
    nested_reasons = _nested_not_run_reasons(lanes)
    missing_baseline = baseline is None or any(
        reason == "matrix:missing_baseline_evidence"
        for reason in nested_reasons
    )
    not_run_reasons: list[str] = []
    if len(lanes) > 1 and missing_baseline:
        not_run_reasons.append("baseline_evidence_missing")
    if len(lanes) > 1 and matrix_limit is not None:
        not_run_reasons.append("diagnostic_matrix_limit")
    not_run_reasons.extend(
        reason for reason in nested_reasons if reason not in not_run_reasons
    )
    if status == "PASS" and not_run_reasons:
        status = "NOT_RUN"

    diagnostic = (
        {"matrix_limit": matrix_limit} if matrix_limit is not None else {}
    )
    summary = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "suite": suite,
        "status": status,
        "lane_statuses": {
            lane_id: lane["status"] for lane_id, lane in lanes.items()
        },
        "not_run_reasons": not_run_reasons,
        "diagnostic": diagnostic,
    }
    summary_path = _write_json_atomic(out / "aggregate-summary.json", summary)
    artifact_hashes = {
        path: digest
        for receipt in lane_artifacts.values()
        for path, digest in receipt["artifacts"].items()
    }
    artifact_hashes[summary_path.relative_to(out).as_posix()] = _sha256_file(
        summary_path
    )
    return {
        **summary,
        "lanes": lanes,
        "lane_artifacts": lane_artifacts,
        "artifact_hashes": artifact_hashes,
    }
