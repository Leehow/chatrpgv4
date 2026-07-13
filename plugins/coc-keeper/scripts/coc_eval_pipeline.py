#!/usr/bin/env python3
"""Lane-aware orchestration for canonical model-backed evaluation suites."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable


SCRIPT_DIR = Path(__file__).resolve().parent

import coc_eval_calibration as calibration
import coc_eval_longrun as longrun
import coc_eval_matrix as matrix
import coc_completion_audit as completion_audit

CHAPTER_TRANSITION_CASE = Path("evaluation/spec/v1/cases/chapter-transition.json")
HOLDOUT_MANIFEST_RELATIVE = Path("evaluation/spec/v1/holdout-manifest.json")
RELEASE_EXTERNAL_LANE_ORDER = (
    "chapter_transition",
    "holdout",
    "human_calibration",
)


EVAL_SPEC = "eval-spec-v1"
LONG_MEMORY_CASE = Path("evaluation/spec/v1/cases/long-memory.json")
CONTINUITY_LANES = ("continuity-25", "continuity-50")
CANONICAL_LANE_ORDER = (
    "registered-cases",
    "matrix",
    *CONTINUITY_LANES,
    "completion-audit",
)
MODEL_ROLES = {
    "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
    "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
}
VALID_STATUSES = frozenset(
    {"PASS", "FAIL", "INELIGIBLE", "NOT_RUN", "NON_COMPARABLE"}
)
REGISTERED_CASE_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
REGISTERED_CASE_STATUSES = frozenset({"PASS", "FAIL", "NOT_RUN"})
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


def _reject_symlink_components(path: Path | str, *, label: str) -> Path:
    """Return an absolute lexical path after checking every component."""
    raw = Path(path).absolute()
    for component in reversed((raw, *raw.parents)):
        if component.is_symlink():
            raise ValueError(f"{label} path component must not be a symlink: {component}")
    return raw


def _baseline_matrix_dir(baseline: Path | str | None) -> Path | None:
    if baseline is None:
        return None
    root = _reject_symlink_components(baseline, label="baseline")
    nested = root / "lanes" / "matrix"
    plan = nested / "matrix-plan.json"
    _reject_symlink_components(plan, label="baseline")
    try:
        nested.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError("nested baseline matrix escapes supplied baseline run") from exc
    if plan.is_file():
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


def _continuity_execution_budget(
    root: Path, lane_id: str, override: float | None
) -> float:
    if override is not None:
        return _positive_number(override, label="continuity_timeout")
    lane = _continuity_lane(root, lane_id)
    return _positive_number(
        lane.get("timeout_seconds"),
        label=f"{lane_id}.timeout_seconds",
    )


def _safe_execution_directory(
    value: Path | str,
    *,
    label: str,
    require_empty: bool,
) -> Path:
    raw = _reject_symlink_components(value, label=label)
    if raw.exists() and not raw.is_dir():
        raise ValueError(f"{label} must be a directory")
    raw.mkdir(parents=True, exist_ok=True)
    _reject_symlink_components(raw, label=label)
    if require_empty and any(raw.iterdir()):
        raise ValueError(f"{label} must be new or empty")
    return raw.resolve()


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
    lane_output = _safe_execution_directory(
        output,
        label="continuity output",
        require_empty=False,
    )
    workspace_root = _safe_execution_directory(
        workspace,
        label="continuity workspace",
        require_empty=True,
    )
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
                workspace=workspace_root,
                output=lane_output,
                model_roles=copy.deepcopy(MODEL_ROLES),
            )
            _write_json_atomic(sidecar, {"ok": True, "result": result})
            exit_code = 0
        except BaseException as exc:
            try:
                message = " ".join(str(exc).split())[:500]
                is_contract_error = isinstance(exc, ValueError)
                _write_json_atomic(
                    sidecar,
                    {
                        "ok": False,
                        "error_type": (
                            "ValueError"
                            if is_contract_error
                            else type(exc).__name__
                        ),
                        "error_code": str(
                            getattr(
                                exc,
                                "code",
                                (
                                    "continuity_contract_error"
                                    if is_contract_error
                                    else "continuity_lane_unavailable"
                                ),
                            )
                        ),
                        "error_message": message,
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
            error_code = str(payload.get("error_code") or (
                "continuity_contract_error"
                if error_type == "ValueError"
                else "continuity_lane_unavailable"
            ))
            error_message = str(payload.get("error_message") or "")
            failure = {
                "error_type": error_type,
                "error_code": error_code,
                "message": error_message,
            }
            if error_type == "ValueError":
                return {
                    "schema_version": 1,
                    "eval_spec": EVAL_SPEC,
                    "lane_id": lane_id,
                    "status": "FAIL",
                    "findings": ["lane_contract_error"],
                    "failure": failure,
                }
            return {
                "schema_version": 1,
                "eval_spec": EVAL_SPEC,
                "lane_id": lane_id,
                "status": "NOT_RUN",
                "not_run_reasons": [f"lane_unavailable:{error_type}"],
                "failure": failure,
            }
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


def _safe_workspace_root(out: Path, lane_id: str, *, create: bool) -> Path:
    if not lane_id or Path(lane_id).name != lane_id:
        raise ValueError(f"unsafe lane id: {lane_id}")
    out = out.resolve()
    workspaces_root = out / "workspaces"
    if workspaces_root.is_symlink():
        raise ValueError("workspace root must not be a symlink")
    if workspaces_root.exists() and not workspaces_root.is_dir():
        raise ValueError("workspace root must be a directory")
    workspace_root = workspaces_root / lane_id
    if workspace_root.is_symlink():
        raise ValueError(f"workspace root must not be a symlink: {lane_id}")
    if workspace_root.exists() and not workspace_root.is_dir():
        raise ValueError(f"workspace root must be a directory: {lane_id}")
    resolved = workspace_root.resolve()
    try:
        resolved.relative_to(out)
    except ValueError as exc:
        raise ValueError(f"workspace root escapes output: {lane_id}") from exc
    if create:
        workspace_root.mkdir(parents=True, exist_ok=True)
        if workspaces_root.is_symlink() or workspace_root.is_symlink():
            raise ValueError(f"workspace root must not be a symlink: {lane_id}")
        if any(workspace_root.iterdir()):
            raise ValueError(f"workspace root must be new or empty: {lane_id}")
    return workspace_root


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


def _owned_artifact_relative(lane_id: str, relative: Any) -> str:
    if lane_id != "registered-cases" or not isinstance(relative, str):
        raise ValueError("only registered-cases may own top-level artifacts")
    path = Path(relative)
    normalized = path.as_posix()
    if (
        not relative
        or path.is_absolute()
        or normalized != relative
        or ".." in path.parts
        or not (
            normalized == "case-results.json"
            or (
                len(path.parts) == 3
                and path.parts[0] == "cases"
                and path.name in {"stdout.log", "stderr.log"}
            )
        )
    ):
        raise ValueError(f"unsafe owned artifact path: {relative}")
    return normalized


def _owned_artifact_path(out: Path, lane_id: str, relative: Any) -> Path:
    normalized = _owned_artifact_relative(lane_id, relative)
    candidate = out / normalized
    current = candidate
    while current != out:
        if current.is_symlink():
            raise ValueError(f"owned artifact must not be a symlink: {normalized}")
        current = current.parent
    resolved = candidate.resolve()
    try:
        resolved.relative_to(out)
    except ValueError as exc:
        raise ValueError(f"owned artifact escapes output: {normalized}") from exc
    if not candidate.is_file():
        raise ValueError(f"owned artifact missing: {normalized}")
    return candidate


def _owned_lane_files(
    out: Path, lane_id: str, relatives: list[Any]
) -> dict[str, str]:
    if len(relatives) != len(set(relatives)):
        raise ValueError("owned artifact paths must be unique")
    artifacts: dict[str, str] = {}
    for relative in relatives:
        normalized = _owned_artifact_relative(lane_id, relative)
        artifacts[normalized] = _sha256_file(
            _owned_artifact_path(out, lane_id, normalized)
        )
    return artifacts


def _registered_case_log_files(out: Path) -> dict[str, str]:
    """Enumerate every physical case log while ignoring non-evidence result files."""
    cases_root = out / "cases"
    if not cases_root.exists():
        return {}
    if cases_root.is_symlink() or not cases_root.is_dir():
        raise ValueError("registered case evidence root must be a real directory")
    resolved_root = cases_root.resolve()
    artifacts: dict[str, str] = {}
    for path in sorted(cases_root.rglob("*")):
        if path.is_symlink():
            raise ValueError("registered case evidence must not contain symlinks")
        try:
            path.resolve().relative_to(resolved_root)
        except ValueError as exc:
            raise ValueError("registered case evidence escapes cases root") from exc
        if path.is_file() and path.name in {"stdout.log", "stderr.log"}:
            relative = path.relative_to(out).as_posix()
            normalized = _owned_artifact_relative("registered-cases", relative)
            artifacts[normalized] = _sha256_file(path)
    return artifacts


def _persist_lane(
    out: Path,
    lane_id: str,
    result: dict[str, Any],
    *,
    owned_artifacts: dict[str, str] | None = None,
) -> dict[str, Any]:
    lane_root = _safe_lane_root(out, lane_id, create=True)
    path = lane_root / "lane-result.json"
    _write_json_atomic(path, result)
    artifacts = _lane_files(out, lane_id)
    owned_paths: list[str] = []
    if owned_artifacts is not None:
        if not isinstance(owned_artifacts, dict):
            raise ValueError("owned_artifacts must be an object")
        owned_paths = sorted(owned_artifacts)
        actual_owned = _owned_lane_files(out, lane_id, owned_paths)
        for relative, actual_hash in actual_owned.items():
            expected_hash = owned_artifacts.get(relative)
            if (
                not isinstance(expected_hash, str)
                or len(expected_hash) != 64
                or expected_hash != actual_hash
            ):
                raise ValueError(f"owned artifact hash mismatch: {relative}")
        artifacts.update(actual_owned)
    relative = path.relative_to(out).as_posix()
    receipt = {
        "path": relative,
        "sha256": artifacts[relative],
        "artifacts": artifacts,
    }
    if owned_artifacts is not None:
        receipt["owned_artifacts"] = owned_paths
    return receipt


def declared_registered_case_artifacts(
    manifest: dict[str, Any], lanes: dict[str, Any]
) -> dict[str, str]:
    """Return the exact top-level case artifacts declared by a nightly run."""
    lane = lanes.get("registered-cases")
    outer_hashes = manifest.get("artifact_hashes")
    case_results_path = manifest.get("case_results_path")
    if not isinstance(lane, dict) or not isinstance(outer_hashes, dict):
        raise ValueError("registered case artifact contract missing")
    if case_results_path != "case-results.json":
        raise ValueError("registered case_results_path must be case-results.json")
    expected: dict[str, str] = {}

    def bind(relative: Any, digest: Any) -> None:
        normalized = _owned_artifact_relative("registered-cases", relative)
        if (
            not isinstance(digest, str)
            or re.fullmatch(r"[0-9a-f]{64}", digest) is None
            or outer_hashes.get(normalized) != digest
            or (normalized in expected and expected[normalized] != digest)
        ):
            raise ValueError(f"registered case artifact declaration mismatch: {normalized}")
        expected[normalized] = digest

    bind(case_results_path, outer_hashes.get(case_results_path))
    case_rows = lane.get("cases")
    if not isinstance(case_rows, list) or not case_rows:
        raise ValueError("registered case rows missing or empty")
    seen_case_ids: set[str] = set()
    expected_case_paths: set[str] = set()
    for case in case_rows:
        if not isinstance(case, dict):
            raise ValueError("registered case row malformed")
        case_id = case.get("case_id")
        if (
            not isinstance(case_id, str)
            or REGISTERED_CASE_ID_RE.fullmatch(case_id) is None
            or case_id in seen_case_ids
        ):
            raise ValueError(f"registered case_id invalid or duplicate: {case_id!r}")
        seen_case_ids.add(case_id)
        status = case.get("status")
        if status not in REGISTERED_CASE_STATUSES:
            raise ValueError(f"registered case status invalid: {case_id}")
        if case.get("gate") not in {"hard", "soft", "diagnostic"}:
            raise ValueError(f"registered case gate invalid: {case_id}")
        stdout_path = case.get("stdout_path")
        stderr_path = case.get("stderr_path")
        hashes = case.get("artifact_hashes")
        if not isinstance(hashes, dict):
            raise ValueError("registered case artifact hashes malformed")
        if stdout_path is None and stderr_path is None:
            reasons = case.get("not_run_reasons")
            if (
                status != "NOT_RUN"
                or hashes
                or not isinstance(reasons, list)
                or not reasons
                or not all(isinstance(reason, str) and reason for reason in reasons)
            ):
                raise ValueError(
                    f"registered case without logs must be explicit NOT_RUN: {case_id}"
                )
            continue
        expected_stdout = f"cases/{case_id}/stdout.log"
        expected_stderr = f"cases/{case_id}/stderr.log"
        required_paths = {expected_stdout, expected_stderr}
        if (
            stdout_path != expected_stdout
            or stderr_path != expected_stderr
            or set(hashes) != required_paths
        ):
            raise ValueError(f"registered case log declaration mismatch: {case_id}")
        expected_case_paths.update(required_paths)
        for relative in sorted(required_paths):
            bind(relative, hashes[relative])
    declared_case_paths = {
        relative
        for relative in outer_hashes
        if isinstance(relative, str) and relative.startswith("cases/")
    }
    if declared_case_paths != expected_case_paths:
        raise ValueError("registered case artifact set contains unbound paths")
    return expected


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


def _reason_list(value: Any, *, label: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(
        isinstance(reason, str) and reason for reason in value
    ):
        raise ValueError(f"{label} must be a list of nonempty strings")
    return list(value)


def _nested_not_run_reasons(lanes: dict[str, dict[str, Any]]) -> list[str]:
    reasons: list[str] = []
    lane_ids = [lane_id for lane_id in CANONICAL_LANE_ORDER if lane_id in lanes]
    lane_ids.extend(sorted(set(lanes) - set(lane_ids)))
    for lane_id in lane_ids:
        lane = lanes[lane_id]
        if not isinstance(lane, dict):
            raise ValueError(f"lane result must be an object: {lane_id}")
        candidates = _reason_list(
            lane.get("not_run_reasons"), label=f"{lane_id}.not_run_reasons"
        )
        raw_cells = lane.get("cells")
        if raw_cells is not None and not isinstance(raw_cells, list):
            raise ValueError(f"{lane_id}.cells must be a list")
        for index, cell in enumerate(raw_cells or []):
            if isinstance(cell, dict):
                candidates.extend(
                    _reason_list(
                        cell.get("not_run_reasons"),
                        label=f"{lane_id}.cells[{index}].not_run_reasons",
                    )
                )
        for reason in candidates:
            namespaced = f"{lane_id}:{reason}"
            if namespaced not in reasons:
                reasons.append(namespaced)
    return reasons


def build_aggregate_summary(
    *,
    suite: str,
    lanes: dict[str, dict[str, Any]],
    aggregation_inputs: dict[str, Any],
) -> dict[str, Any]:
    """Build the sole canonical nightly aggregate from bound lane payloads."""
    if suite != "nightly":
        raise ValueError("aggregate suite must be nightly")
    if not isinstance(lanes, dict) or not lanes:
        raise ValueError("aggregate lanes must be a nonempty object")
    if (
        not isinstance(aggregation_inputs, dict)
        or set(aggregation_inputs) != {"baseline_supplied", "matrix_limit"}
        or not isinstance(aggregation_inputs.get("baseline_supplied"), bool)
    ):
        raise ValueError("aggregation_inputs malformed")
    matrix_limit = aggregation_inputs.get("matrix_limit")
    if matrix_limit is not None and (
        isinstance(matrix_limit, bool)
        or not isinstance(matrix_limit, int)
        or matrix_limit <= 0
    ):
        raise ValueError("aggregation_inputs.matrix_limit malformed")
    matrix_lane = lanes.get("matrix")
    if matrix_lane is not None:
        if not isinstance(matrix_lane, dict):
            raise ValueError("matrix lane must be an object")
        diagnostic = matrix_lane.get("diagnostic")
        if diagnostic is None:
            diagnostic = {}
        if not isinstance(diagnostic, dict):
            raise ValueError("matrix lane diagnostic malformed")
        lane_limit = diagnostic.get("matrix_limit")
        if (matrix_limit is None and "matrix_limit" in diagnostic) or (
            matrix_limit is not None and lane_limit != matrix_limit
        ):
            raise ValueError("matrix lane diagnostic contradicts matrix_limit")

    status = aggregate_lane_status(lanes)
    nested_reasons = _nested_not_run_reasons(lanes)
    missing_baseline = not aggregation_inputs["baseline_supplied"] or any(
        reason == "matrix:missing_baseline_evidence" for reason in nested_reasons
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
    diagnostic = {"matrix_limit": matrix_limit} if matrix_limit is not None else {}
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "suite": suite,
        "status": status,
        "lane_statuses": {
            lane_id: lanes[lane_id]["status"]
            for lane_id in CANONICAL_LANE_ORDER
            if lane_id in lanes
        },
        "not_run_reasons": not_run_reasons,
        "diagnostic": diagnostic,
    }


def verify_lane_artifacts(
    output: Path | str,
    lane_artifacts: dict[str, Any],
    *,
    expected_lanes: dict[str, Any] | None = None,
    required_owned_artifacts: dict[str, dict[str, str]] | None = None,
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
            or not all(
                isinstance(relative, str) and isinstance(digest, str)
                for relative, digest in (receipt.get("artifacts") or {}).items()
            )
        ):
            findings.append({"code": "lane_receipt_malformed", "lane_id": lane_id})
            continue
        expected = receipt["artifacts"]
        owned_paths = receipt.get("owned_artifacts", [])
        if not isinstance(owned_paths, list) or not all(
            isinstance(relative, str) for relative in owned_paths
        ):
            findings.append(
                {"code": "lane_owned_artifacts_malformed", "lane_id": lane_id}
            )
            continue
        try:
            actual = _lane_files(out, lane_id)
            actual.update(_owned_lane_files(out, lane_id, owned_paths))
            if lane_id == "registered-cases":
                actual.update(_registered_case_log_files(out))
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
        required_owned = (
            (required_owned_artifacts or {}).get(lane_id)
            if required_owned_artifacts is not None
            else None
        )
        if required_owned is not None:
            required_paths = set(required_owned)
            received_owned = set(owned_paths)
            for relative in sorted(required_paths - received_owned):
                findings.append(
                    {
                        "code": "lane_owned_artifact_missing",
                        "lane_id": lane_id,
                        "path": relative,
                    }
                )
            for relative in sorted(received_owned - required_paths):
                findings.append(
                    {
                        "code": "lane_owned_artifact_unbound",
                        "lane_id": lane_id,
                        "path": relative,
                    }
                )
            for relative in sorted(required_paths & received_owned):
                if expected.get(relative) != required_owned[relative]:
                    findings.append(
                        {
                            "code": "lane_owned_artifact_contract_mismatch",
                            "lane_id": lane_id,
                            "path": relative,
                        }
                    )
        primary = receipt.get("path")
        expected_primary = f"lanes/{lane_id}/lane-result.json"
        if (
            primary != expected_primary
            or receipt.get("sha256") != expected.get(primary)
        ):
            findings.append(
                {"code": "lane_primary_receipt_mismatch", "lane_id": lane_id}
            )
        elif expected_lanes is not None and lane_id in expected_lanes:
            expected_text = (
                json.dumps(
                    expected_lanes[lane_id],
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                + "\n"
            )
            try:
                actual_text = (out / expected_primary).read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                findings.append(
                    {"code": "lane_primary_unreadable", "lane_id": lane_id}
                )
            else:
                if actual_text != expected_text:
                    findings.append(
                        {
                            "code": "lane_primary_payload_mismatch",
                            "lane_id": lane_id,
                        }
                    )
            if lane_id == "registered-cases" and "case-results.json" in owned_paths:
                try:
                    case_results_text = (out / "case-results.json").read_text(
                        encoding="utf-8"
                    )
                except (OSError, UnicodeError):
                    findings.append(
                        {
                            "code": "lane_owned_payload_unreadable",
                            "lane_id": lane_id,
                            "path": "case-results.json",
                        }
                    )
                else:
                    if case_results_text != expected_text:
                        findings.append(
                            {
                                "code": "lane_owned_payload_mismatch",
                                "lane_id": lane_id,
                                "path": "case-results.json",
                            }
                        )
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": "FAIL" if findings else "PASS",
        "findings": findings,
    }


def _load_chapter_requirements(root: Path) -> dict[str, Any]:
    payload = _read_json(root / CHAPTER_TRANSITION_CASE)
    if (
        not isinstance(payload, dict)
        or payload.get("schema_version") != 1
        or payload.get("eval_spec") != EVAL_SPEC
    ):
        raise ValueError("chapter-transition case contract mismatch")
    lanes = payload.get("lanes")
    if not isinstance(lanes, list) or not lanes:
        raise ValueError("chapter-transition lanes missing")
    lane = lanes[0]
    if not isinstance(lane, dict) or not isinstance(lane.get("requirements"), dict):
        raise ValueError("chapter-transition requirements missing")
    return dict(lane["requirements"])


def _missing_lane(lane_id: str, reason: str) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "lane_id": lane_id,
        "status": "NOT_RUN",
        "not_run_reasons": [reason],
    }


def run_release_external_gates(
    *,
    root: Path | str,
    output: Path | str,
    chapter_run: Path | str | None,
    holdout_bundle: Path | str | None,
    calibration_reviews: Path | str | None,
    judge_requests: list[dict[str, Any]] | None = None,
    holdout_manifest: Path | str | None = None,
) -> dict[str, Any]:
    """Aggregate release chapter/holdout/human gates without fabricating evidence."""
    repo = Path(root).resolve()
    out = Path(output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    artifacts_dir = out / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    blind_requests = calibration.sanitize_blind_requests(judge_requests)
    review_bundle = calibration.build_human_review_bundle(
        blind_requests=blind_requests
    )
    bundle_path = _write_json_atomic(
        artifacts_dir / "human-review-bundle.json", review_bundle
    )

    missing: list[str] = []
    lanes: dict[str, dict[str, Any]] = {}

    if chapter_run is None:
        missing.append("chapter_run")
        lanes["chapter_transition"] = _missing_lane(
            "chapter_transition", "chapter_run_missing"
        )
    else:
        requirements = _load_chapter_requirements(repo)
        chapter_result = longrun.validate_chapter_transition(
            chapter_run, requirements
        )
        lanes["chapter_transition"] = dict(chapter_result)
        lanes["chapter_transition"]["lane_id"] = "chapter_transition"

    if holdout_bundle is None:
        missing.append("holdout_bundle")
        lanes["holdout"] = _missing_lane("holdout", "holdout_bundle_missing")
    else:
        manifest_path = (
            Path(holdout_manifest)
            if holdout_manifest is not None
            else repo / HOLDOUT_MANIFEST_RELATIVE
        )
        holdout_result = calibration.validate_holdout_bundle(
            manifest_path, holdout_bundle
        )
        lanes["holdout"] = dict(holdout_result)
        lanes["holdout"]["lane_id"] = "holdout"

    if calibration_reviews is None:
        missing.append("human_calibration")
        lanes["human_calibration"] = _missing_lane(
            "human_calibration", "calibration_reviews_missing"
        )
    else:
        calibration_result = calibration.evaluate_calibration_evidence(
            calibration_reviews
        )
        lanes["human_calibration"] = dict(calibration_result)
        lanes["human_calibration"]["lane_id"] = "human_calibration"

    status = aggregate_lane_status(lanes)
    if status == "PASS" and missing:
        status = "NOT_RUN"
    elif status not in {"FAIL", "INELIGIBLE"} and missing:
        status = "NOT_RUN"

    not_run_reasons: list[str] = []
    for key in ("chapter_run", "holdout_bundle", "human_calibration"):
        if key in missing:
            not_run_reasons.append(f"missing:{key}")
    for lane_id in RELEASE_EXTERNAL_LANE_ORDER:
        lane = lanes[lane_id]
        for reason in _reason_list(
            lane.get("not_run_reasons"), label=f"{lane_id}.not_run_reasons"
        ):
            namespaced = f"{lane_id}:{reason}"
            if namespaced not in not_run_reasons:
                not_run_reasons.append(namespaced)

    artifact_hashes = {
        bundle_path.relative_to(out).as_posix(): _sha256_file(bundle_path)
    }
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "suite": "release",
        "status": status,
        "missing": missing,
        "not_run_reasons": not_run_reasons,
        "lanes": lanes,
        "lane_statuses": {
            lane_id: lanes[lane_id]["status"] for lane_id in RELEASE_EXTERNAL_LANE_ORDER
        },
        "human_review_bundle_path": bundle_path.relative_to(out).as_posix(),
        "artifact_hashes": artifact_hashes,
    }


def run_extended_suite(
    *,
    root: Path | str,
    suite: str,
    output: Path | str,
    case_results: dict[str, Any],
    registered_case_artifacts: dict[str, str] | None = None,
    baseline: Path | str | None = None,
    matrix_limit: int | None = None,
    timeout: float = 120.0,
    continuity_timeout: float | None = None,
) -> dict[str, Any]:
    """Run nightly's registered, matrix, and continuity lanes under one run."""
    if suite != "nightly":
        raise ValueError(f"extended suite is not implemented for: {suite}")
    _positive_number(timeout, label="timeout")
    if continuity_timeout is not None:
        _positive_number(continuity_timeout, label="continuity_timeout")
    if matrix_limit is not None and (
        isinstance(matrix_limit, bool)
        or not isinstance(matrix_limit, int)
        or matrix_limit <= 0
    ):
        raise ValueError("matrix_limit must be a positive integer")
    repo = Path(root).resolve()
    # Reject an unsafe comparison source before creating candidate artifacts or
    # dispatching any model-backed lane.  run_matrix validates again at its own
    # boundary so a path swap between orchestration and execution still fails.
    _baseline_matrix_dir(baseline)
    out = Path(output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    lanes: dict[str, dict[str, Any]] = {
        "registered-cases": dict(case_results),
    }
    lane_artifacts = {
        "registered-cases": _persist_lane(
            out,
            "registered-cases",
            lanes["registered-cases"],
            owned_artifacts=registered_case_artifacts,
        )
    }

    if lanes["registered-cases"].get("status") != "FAIL":
        workspace_roots = {
            lane_id: _safe_workspace_root(out, lane_id, create=True)
            for lane_id in CONTINUITY_LANES
        }
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
        if matrix_limit is not None:
            matrix_diagnostic = dict(lanes["matrix"].get("diagnostic") or {})
            matrix_diagnostic["matrix_limit"] = matrix_limit
            lanes["matrix"]["diagnostic"] = matrix_diagnostic
        lane_artifacts["matrix"] = _persist_lane(out, "matrix", lanes["matrix"])
        continuity_budgets = {
            lane_id: _continuity_execution_budget(
                repo, lane_id, continuity_timeout
            )
            for lane_id in CONTINUITY_LANES
        }
        for lane_id in CONTINUITY_LANES:
            lane_output = _safe_lane_root(out, lane_id, create=True)
            lanes[lane_id] = _call_lane(
                lane_id,
                lambda **kwargs: run_continuity(lane_id, **kwargs),
                root=repo,
                output=lane_output,
                workspace=workspace_roots[lane_id],
                timeout=continuity_budgets[lane_id],
            )
            lanes[lane_id]["execution_budget_seconds"] = continuity_budgets[
                lane_id
            ]
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

    aggregation_inputs = {
        "baseline_supplied": baseline is not None,
        "matrix_limit": matrix_limit,
    }
    summary = build_aggregate_summary(
        suite=suite,
        lanes=lanes,
        aggregation_inputs=aggregation_inputs,
    )
    summary_path = _write_json_atomic(out / "aggregate-summary.json", summary)
    artifact_hashes = {
        path: digest
        for receipt in lane_artifacts.values()
        for path, digest in receipt["artifacts"].items()
    }
    artifact_hashes[summary_path.relative_to(out).as_posix()] = _sha256_file(
        summary_path
    )
    execution_budgets = {
        "matrix_seconds": float(timeout),
        **{
            f"{lane_id}_seconds": _continuity_execution_budget(
                repo, lane_id, continuity_timeout
            )
            for lane_id in CONTINUITY_LANES
        },
    }
    return {
        **summary,
        "aggregation_inputs": aggregation_inputs,
        "lanes": lanes,
        "lane_artifacts": lane_artifacts,
        "artifact_hashes": artifact_hashes,
        "execution_budgets": execution_budgets,
    }
